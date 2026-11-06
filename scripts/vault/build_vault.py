#!/usr/bin/env python3
"""Genera el vault de Obsidian de MauiDesk organizado por módulos funcionales.

Combina el grafo de graphify (graphify-out/graph.json: símbolos, líneas y llamadas
entre archivos) con un análisis directo del código (imports, endpoints, tablas,
eventos Socket.io, llamadas a la API desde el cliente).

Uso (desde la raíz del repo):
    graphify update .                 # refresca graph.json (sin costo de LLM)
    python scripts/vault/build_vault.py

Salida: graphify-out/obsidian/ (se borra y regenera todo menos .obsidian/).
Solo usa la biblioteca estándar de Python (3.9+).
"""
from __future__ import annotations

import json
import re
import shutil
import subprocess
import sys
from collections import Counter, defaultdict
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
GRAPH = ROOT / "graphify-out" / "graph.json"
OUT = ROOT / "graphify-out" / "obsidian"

CODE_EXT = {".ts", ".tsx", ".js", ".mjs", ".cjs"}
CONFIG_NAMES = {"package.json", "tsconfig.json", "tsconfig.app.json", "tsconfig.node.json",
                ".env.example", "index.html", "manifest.webmanifest"}
SKIP = re.compile(r"(package-lock\.json$|^client/public/|\.(png|jpe?g|ico|svg|webp)$|graphify-out/)")

# ----------------------------------------------------------------------------
# Módulos funcionales. Los archivos se asignan explícitamente: un archivo nuevo
# sin asignar aparece en "Sin módulo" en la nota de inicio para clasificarlo aquí.
# ----------------------------------------------------------------------------
MODULES = [
    {
        "id": "pedidos", "name": "Pedidos",
        "summary": "Toma de pedidos de salón y delivery desde el celular del mozo: ítems con modificadores, estados del pedido, un pedido activo por mesa y envío de la comanda a cocina.",
        "rules": [
            "El cliente **nunca** define precios ni nombres: envía `dishId`, `quantity`, `modifiers` y `notes`; el servidor calcula `unitPrice = precio + priceAdjustment` desde el catálogo (`resolveItems`). Plato agotado → 409 `DISH_UNAVAILABLE`.",
            "Estados: activos `pending` y `paying` (\"por cobrar\"); cerrados `paid` (solo el cobro) y `cancelled` (solo `POST /orders/:id/cancel` con motivo). `preparing`/`ready` son heredados y se tratan como `pending`.",
            "Un pedido activo por mesa: verificado en la transacción y por el índice único parcial `uq_orders_active_table`.",
            "Lo visible o impreso usa `tableNumber`, nunca `tableId`. `order.serializer.ts` es la forma única del pedido.",
            "El borrador del pedido vive en `store/order.ts` (localStorage); los pedidos activos en `store/orders.ts`, que se resincroniza al reconectar.",
        ],
        "docs": [("architecture/business-flows", "§1 Venta, §2 Agregar ítems, §5 Cancelación"), ("architecture/api", "§2 Endpoints /orders")],
        "files": [
            "server/src/routes/orders.ts", "server/src/services/order.service.ts", "server/src/services/order.serializer.ts",
            "server/src/schemas/orders.ts", "client/src/pages/POS.tsx", "client/src/store/order.ts", "client/src/store/orders.ts",
            "server/src/__tests__/orders.create.test.ts", "server/src/__tests__/orders.lifecycle.test.ts",
            "server/src/__tests__/orders.pricing.test.ts", "server/src/__tests__/order.serializer.test.ts",
        ],
    },
    {
        "id": "cobro", "name": "Cobro y boletas",
        "summary": "Cobro en caja (efectivo, Yape, Plin) con 4 modos (sub-cuenta + ítems, sub-cuenta completa, ítems específicos, todo lo pendiente), emisión de la boleta interna B001-NNNNN e historial de boletas.",
        "rules": [
            "Cobro atómico en `billing.service.ts`: `withWriteLock(() => db.transaction(...))`, precondiciones leídas **dentro** de la transacción.",
            "Al marcar ítems como cobrados se exige `bill_id IS NULL` y se verifica la cantidad de filas afectadas.",
            "Número de boleta: `MAX+1` dentro de la transacción; `UNIQUE` + reintento ×3 cubre colisiones.",
            "Eventos Socket.io (`order:updated` / `order:removed`) se emiten **después** del commit.",
            "La boleta se arma desde la BD (`receipt.service.ts`); el cliente nunca envía su contenido.",
            "Un pedido puede tener N boletas (cobros parciales/divididos). Un método de pago por boleta.",
        ],
        "docs": [("architecture/business-flows", "§3 Pago / cobro"), ("architecture/data-model", "§6 Cadena de venta")],
        "files": [
            "server/src/routes/bills.ts", "server/src/services/billing.service.ts", "server/src/services/receipt.service.ts",
            "server/src/schemas/bills.ts", "client/src/pages/Cash.tsx", "client/src/pages/BillsHistory.tsx",
            "server/src/__tests__/billing.test.ts", "server/src/__tests__/receipt.test.ts",
        ],
    },
    {
        "id": "division", "name": "Cuenta dividida",
        "summary": "División de un pedido en sub-cuentas (A–F, tabla `bill_groups`) para cobrar por separado.",
        "rules": [
            "Dividir es parte del cobro: solo `owner`, `manager`, `cashier` (`canSplit`).",
            "El modal de división vive en `pages/Cash.tsx` (`SplitBillModal`); el store llama a `/orders/:id/split`.",
            "Tras guardar o borrar la división se re-emite el pedido completo (`order:updated`).",
        ],
        "docs": [("architecture/business-flows", "§4 Cuenta dividida")],
        "files": ["server/src/routes/split.ts", "server/src/services/split.service.ts", "server/src/schemas/split.ts",
                  "server/src/__tests__/split.test.ts"],
    },
    {
        "id": "menu", "name": "Menú",
        "summary": "Catálogo: categorías, platos, grupos de modificadores (picante / preferencia) y disponibilidad (\"agotado\").",
        "rules": [
            "Precios, alta/baja de platos y modificadores: solo `owner`. Marcar agotado: `owner` y `manager`.",
            "Cambios de precio y disponibilidad se registran en `audit_log`.",
            "`available=false` es solo \"agotado\"; borrar un plato con historial lo archiva (`archived=true`, TD-31). `GET /api/menu` devuelve los agotados (el POS muestra \"No había\") y excluye los archivados.",
            "`dish.availability` en `audit_log` se escribe solo en transiciones reales: es la medida de quiebres de la tesis.",
            "`order_items` guarda snapshot de nombre y precio: cambiar el menú no altera pedidos pasados.",
        ],
        "docs": [("architecture/modules", "§1 Productos / menú"), ("architecture/api", "§6 Cambios en el menú")],
        "files": ["server/src/routes/menu.ts", "server/src/schemas/menu.ts", "client/src/pages/admin/MenuAdmin.tsx",
                  "server/src/__tests__/menu.archive.test.ts", "server/src/__tests__/menu.realtime.test.ts"],
    },
    {
        "id": "mesas", "name": "Mesas y plano",
        "summary": "Mesas del salón (número visible vs id interno), áreas, plano arrastrable y decoraciones (`layout_items`).",
        "rules": [
            "Editar mesas y plano: solo `owner`.",
            "Mostrar siempre `number`, no `id` (los datos reales tienen mesas con id ≠ number).",
            "Borrar una mesa con historial la desactiva en vez de eliminarla.",
        ],
        "docs": [("architecture/modules", "§1 Mesas y plano")],
        "files": ["server/src/routes/tables.ts", "server/src/schemas/tables.ts", "client/src/pages/Tables.tsx",
                  "server/src/__tests__/tables.number.test.ts"],
    },
    {
        "id": "reportes", "name": "Reportes y gastos",
        "summary": "Resumen de ventas por periodo, top de platos, listado de boletas, registro de gastos (egresos) y vista de auditoría; exportación a HTML imprimible.",
        "rules": [
            "Acceso: `owner` y `manager`.",
            "Días calculados en hora local de Lima (`utils/dates.ts`); la BD guarda UTC `YYYY-MM-DD HH:MM:SS`.",
            "Corregir o borrar un gasto exige motivo y queda en `audit_log`.",
            "La tabla `expenses` registra los egresos generales; las compras de insumos van en el módulo Inventario (aún sin costo por plato).",
            "Todo HTML generado con texto de usuarios pasa por `escapeHtml` (`reportHTML.ts`).",
        ],
        "docs": [("architecture/business-flows", "§7 Gastos")],
        "files": ["server/src/routes/reports.ts", "server/src/services/report.service.ts", "server/src/schemas/reports.ts",
                  "client/src/pages/Reports.tsx", "client/src/utils/reportHTML.ts", "server/src/__tests__/report.service.test.ts"],
    },
    {
        "id": "inventario", "name": "Inventario",
        "summary": "Inventario de insumos perecibles para la tesis (Fase 0, solo registro): catálogo de insumos, compras, merma, conteo de cierre, ventas perdidas (\"No había\" desde el POS) y export CSV.",
        "rules": [
            "Fase 0 = solo registro: sin stock teórico, recetas ni alertas. La fase 2 se calculará desde estas tablas sin cambiar cómo se registran (plan-inventario-tesis v2).",
            "Instrumento congelado: columnas del export fijadas en diccionario-datos-tesis v1 e inventory.export.test.ts.",
            "La única rutina es la «Compra del día» en dos partes (POST /inventory/daily con part 'apertura' | 'compra'): una tx por fecha y parte, idempotente (reemplaza solo sus filas source='daily'), con daily_parts (autor, hora, duración, corrección) y modo de entrada de cada valor.",
            "Reglas de plan-sistema: RD01 (la «Compra del día» nunca muestra el pronóstico), RD02 (agotado lo confirma una persona), RD04 (pronóstico guardado no se modifica), RD06 (local_id desde MAUI_LOCAL_ID). El estudio por grupos se retiró en T2.",
            "En la línea base la UI solo refleja lo registrado (plan §2.9): «Hoy empezaste con», historial sin totales; «Compraste» nunca se prellena (botón [Usar]).",
            "«Compra del día», compras, merma, listados y export: `owner` y `manager`. Catálogo de insumos: solo `owner`. \"No había\" (opcional): cualquier rol. Marcar agotado: también `cashier`.",
            "Fechas de compra, merma y conteo en día local `YYYY-MM-DD` (no futuro); `lost_sales.occurred_at` en UTC.",
            "Corregir o borrar exige motivo y queda en `audit_log` con el registro anterior; en la merma el motivo de la corrección va en `correctionReason`.",
            "Un conteo por insumo y día (`uq_supply_counts_supply_day`): volver a guardarlo lo corrige.",
            "El CSV escapa textos que empiezan con `= + - @` para que la hoja de cálculo no los ejecute.",
        ],
        "docs": [("plan-inventario-tesis", "completo (v2)"), ("diccionario-datos-tesis", "instrumento congelado v1"),
                 ("architecture/api", "§6 Inventario"), ("architecture/data-model", "§9 Inventario")],
        "files": ["server/src/routes/inventory.ts", "server/src/services/inventory.service.ts", "server/src/schemas/inventory.ts",
                  "server/src/services/inventory-daily.service.ts", "server/src/services/inventory-export.service.ts",
                  "server/src/services/settings.service.ts", "server/src/domain/settings.ts", "server/src/domain/daily.ts", "server/src/schemas/settings.ts", "server/src/routes/settings.ts", "server/src/utils/local.ts",
                  "server/src/utils/csv.ts", "server/src/utils/codes.ts", "server/src/__tests__/inventory.test.ts",
                  "server/src/__tests__/inventory.daily.test.ts", "server/src/__tests__/inventory.export.test.ts",
                  "server/src/__tests__/inventory.transfers.test.ts", "server/src/__tests__/settings.test.ts",
                  "client/src/pages/inventory/Inventory.tsx", "client/src/pages/inventory/DailyTab.tsx",
                  "client/src/pages/inventory/HistoryTab.tsx", "client/src/pages/inventory/forms.tsx",
                  "client/src/pages/inventory/SettingsSection.tsx",
                  "client/src/pages/inventory/SuppliesTab.tsx", "client/src/pages/inventory/model.ts",
                  "client/src/pages/inventory/ui.tsx"],
    },
    {
        "id": "impresion", "name": "Impresión",
        "summary": "Impresora térmica ESC/POS por TCP: comanda de cocina, pre-cuenta, boleta y reimpresiones; estado de la impresora.",
        "rules": [
            "Ningún endpoint acepta el contenido del ticket: el servidor lo arma desde la BD.",
            "`checkPrinterStatus()` corre antes de enviar; si no responde → 502 `PRINTER_UNAVAILABLE` (no se encola).",
            "La impresión ocurre **fuera** del `withWriteLock`; solo el `UPDATE` posterior va dentro.",
            "`kitchen_printed` indica si el ítem llegó a la comanda; se puede reimprimir solo lo pendiente.",
            "Producción: `PRINTER_TYPE=tcp`. La rama Windows es solo para desarrollo.",
        ],
        "docs": [("architecture/business-flows", "§6 Pre-cuenta, reimpresión y comanda")],
        "files": ["server/src/routes/print.ts", "server/src/utils/printer.ts", "server/src/utils/tickets.ts",
                  "server/src/utils/logo_bitmap.ts", "server/src/schemas/print.ts", "client/src/components/PrinterStatus.tsx",
                  "server/scripts/convert-logo.mjs", "server/src/__tests__/kitchen.reprint.test.ts"],
    },
    {
        "id": "usuarios", "name": "Usuarios y autenticación",
        "summary": "Login con JWT, 4 roles (owner, manager, cashier, waiter), protección de rutas y administración de usuarios.",
        "rules": [
            "La barrera real es el servidor (`requireAuth` + `requireRole` + reglas en servicios); la UI solo oculta.",
            "`requireAuth` consulta el usuario en cada request: rol y nombre salen de la BD. Inhabilitar o cambiar rol surte efecto de inmediato y corta sus sockets (`disconnectUser`).",
            "Login: 5 fallos por IP+usuario en 5 min → 429. `JWT_SECRET` < 32 chars → el server aborta.",
            "Token en localStorage `mauideskToken`; el interceptor 401 de `api/client.ts` cierra sesión.",
        ],
        "docs": [("architecture/security", "§2 Autenticación, §3 Autorización"), ("plan-maui-v1.1", "§2 Decisiones (matriz de permisos)")],
        "files": ["server/src/routes/auth.ts", "server/src/routes/users.ts", "server/src/middleware/auth.ts",
                  "server/src/schemas/auth.ts", "server/src/schemas/users.ts", "client/src/pages/Login.tsx",
                  "client/src/pages/admin/Users.tsx", "client/src/store/auth.ts", "client/src/components/ProtectedRoute.tsx",
                  "client/src/components/ChangePasswordModal.tsx", "server/src/__tests__/auth.session.test.ts",
                  "server/src/__tests__/permissions.test.ts"],
    },
    {
        "id": "tiempo-real", "name": "Tiempo real",
        "summary": "Socket.io: difusión de cambios de pedidos a todos los dispositivos y resincronización al reconectar.",
        "rules": [
            "Eventos: `order:new`, `order:updated`, `order:removed`, `kitchen:print-result`, emitidos con `emit()` de `realtime.ts` después del commit.",
            "Los routers no importan `index.ts` (evita la dependencia circular).",
            "El cliente vuelve a pedir `/orders/active` al reconectar y al volver la app al frente (> 30 s).",
            "Todos los eventos van a todos los sockets autenticados.",
        ],
        "docs": [("architecture/architecture", "§5 Tiempo real"), ("architecture/api", "§3 Eventos Socket.io")],
        "files": ["server/src/realtime.ts", "client/src/api/socket.ts", "client/src/store/connection.ts",
                  "client/src/components/ReconnectBanner.tsx"],
    },
    {
        "id": "auditoria", "name": "Auditoría",
        "summary": "Registro `audit_log` de operaciones sensibles, visible en Reportes → \"Cancelaciones y correcciones\".",
        "rules": [
            "`audit(tx, …)` se llama **en la misma transacción** que la operación.",
            "Se auditan: cancelaciones, correcciones/borrados de gastos (con motivo), precios, disponibilidad y bajas de platos, cambios de usuarios y mesas, y en el inventario correcciones/borrados de compras y merma, correcciones de conteos y cambios de insumos.",
        ],
        "docs": [("architecture/data-model", "§5 Borrado lógico, historial y auditoría")],
        "files": ["server/src/services/audit.ts", "server/src/__tests__/audit.test.ts"],
    },
    {
        "id": "bd", "name": "Base de datos",
        "summary": "SQLite (libsql) con Drizzle: esquema, migraciones idempotentes al arrancar, mutex de escritura y seed.",
        "rules": [
            "Toda escritura de varios pasos: `withWriteLock(() => db.transaction(...))`. **No anidar** `withWriteLock`.",
            "Cambio de esquema = editar `schema.ts` **y** agregar el paso idempotente en `migrate.ts` (producción no usa `db:push`).",
            "Solo cambios aditivos (tablas, columnas nulables, índices). Todo índice va también en `schema.ts`.",
            "Pasos requeridos de `migrate.ts` que fallan → el server no arranca.",
            "Dinero en `REAL`; timestamps UTC sin zona.",
        ],
        "docs": [("architecture/data-model", "completo")],
        "files": ["server/src/db/schema.ts", "server/src/db/migrate.ts", "server/src/db/migrate-cli.ts",
                  "server/src/db/write-lock.ts", "server/src/db/seed.ts", "server/src/db/index.ts",
                  "server/drizzle.config.ts", "server/src/__tests__/schema.test.ts", "server/src/__tests__/write-lock.test.ts"],
    },
    {
        "id": "nucleo-server", "name": "Núcleo del servidor",
        "summary": "Arranque, armado de la app Express, validación Zod, manejo global de errores y utilidades compartidas.",
        "rules": [
            "`index.ts` valida entorno, crea `io`, migra (fail-fast), avisa y escucha; `app.ts` (`createApp`) arma Express y se usa también en tests.",
            "Errores de negocio: `throw new DomainError(msg, status, code)`; `middleware/error.ts` responde JSON (SQLITE_BUSY → 503).",
            "Todas las rutas POST/PATCH usan `validateBody(Schema)`; nunca `req.body as any`.",
        ],
        "docs": [("architecture/architecture", "§3 Capas, §4 Flujo de una petición, §7 Errores")],
        "files": ["server/src/index.ts", "server/src/app.ts", "server/src/errors.ts", "server/src/startup-checks.ts",
                  "server/src/middleware/error.ts", "server/src/middleware/validate.ts", "server/src/utils/dates.ts",
                  "server/src/utils/math.ts", "server/src/__tests__/http.test.ts"],
    },
    {
        "id": "nucleo-client", "name": "Núcleo del cliente",
        "summary": "Shell de la PWA: rutas, layout y navegación, toasts, diálogos de confirmación, cliente HTTP, tipos y fechas.",
        "rules": [
            "Errores y avisos por toasts (`useToastStore.push`); nunca `alert()`/`confirm()`. Para confirmar: `ConfirmDialog`.",
            "Fechas de la BD: mostrar siempre con `formatDbDateTime`/`parseDbUtc`.",
            "Botones que envían datos se deshabilitan durante el request.",
        ],
        "docs": [("architecture/modules", "§3 Módulos técnicos: cliente")],
        "files": ["client/src/main.tsx", "client/src/App.tsx", "client/src/components/Layout.tsx",
                  "client/src/components/ToastHost.tsx", "client/src/components/ConfirmDialog.tsx", "client/src/store/toast.ts",
                  "client/src/api/client.ts", "client/src/types/index.ts", "client/src/utils/dates.ts",
                  "client/src/index.css", "client/index.html"],
    },
    {
        "id": "tests", "name": "Infraestructura de tests",
        "summary": "Vitest + supertest en el servidor. Los tests de cada módulo están en su nota de módulo; aquí solo los helpers.",
        "rules": [
            "Esquema de tests generado desde `schema.ts` (`helpers/db.ts`); tests HTTP con `setupHttpApp()` y `ctx.as(rol)`.",
            "Un test HTTP no debe importar estáticamente nada que importe `src/db`.",
            "Al corregir un defecto: primero el test que lo reproduce.",
        ],
        "docs": [("architecture/testing", "completo")],
        "files": ["server/src/__tests__/helpers/db.ts", "server/src/__tests__/helpers/http.ts", "server/vitest.config.ts"],
    },
    {
        "id": "config", "name": "Build y configuración",
        "summary": "Paquetes npm, TypeScript, ESLint, Vite, variables de entorno y scripts auxiliares.",
        "rules": [
            "`npm run ci` (raíz): server tsc + vitest + eslint · client tsc + eslint. Correr antes de cada commit.",
            "Variables críticas en `server/.env.example`: `JWT_SECRET`, `ALLOWED_ORIGINS`, `DATABASE_URL`, `PRINTER_*`, `TZ=America/Lima`.",
        ],
        "docs": [],
        "files": ["package.json", "server/package.json", "client/package.json", "server/tsconfig.json",
                  "client/tsconfig.json", "client/tsconfig.app.json", "client/tsconfig.node.json", "server/eslint.config.mjs",
                  "client/eslint.config.js", "client/vite.config.ts", "server/.env.example", "scripts/generate-pwa-icons.js",
                  "client/public/manifest.webmanifest"],
    },
]
MOD_BY_ID = {m["id"]: m for m in MODULES}

# Preguntas frecuentes → símbolo (se resuelve a archivo:línea con el grafo).
QUICK = [
    ("Cálculo del precio de cada ítem", "resolveItems"),
    ("Crear un pedido", "createOrder"),
    ("Cancelar un pedido", "cancelOrder"),
    ("Forma única del pedido que viaja al cliente", "getFullOrder"),
    ("Cobro atómico de una boleta", "createBill"),
    ("Transacción del cobro", "billInTransaction"),
    ("Guardar la división en sub-cuentas", "saveSplit"),
    ("Resumen de ventas para reportes", "salesSummary"),
    ("Armar la boleta desde la BD", "buildReceipt"),
    ("Mutex de escrituras", "withWriteLock"),
    ("Reintento ante SQLITE_BUSY", "withBusyRetry"),
    ("Registrar en audit_log", "audit"),
    ("Autenticación de cada request", "requireAuth"),
    ("Autorización por rol", "requireRole"),
    ("Validación Zod del body", "validateBody"),
    ("Error de negocio tipado", "DomainError"),
    ("Manejo global de errores", "errorHandler"),
    ("Emitir evento Socket.io", "emit"),
    ("Cortar sockets de un usuario", "disconnectUser"),
    ("Verificar impresora antes de imprimir", "checkPrinterStatus"),
    ("Imprimir comanda de cocina", "printKitchenTicket"),
    ("Imprimir pre-cuenta", "printPreReceipt"),
    ("Migraciones al arrancar", "applyStartupMigrations"),
    ("Armado de la app Express", "createApp"),
    ("Store de pedidos activos (cliente)", "useOrdersStore"),
    ("Store de sesión (cliente)", "useAuthStore"),
    ("Toasts (cliente)", "useToastStore"),
    ("Fechas UTC de la BD → hora local (cliente)", "parseDbUtc"),
    ("HTML del reporte imprimible", "generateReportHTML"),
]

TYPE_BY_DIR = [
    ("server/src/routes/", "ruta"), ("server/src/services/", "servicio"), ("server/src/schemas/", "schema-zod"),
    ("server/src/middleware/", "middleware"), ("server/src/db/", "bd"), ("server/src/__tests__/", "test"),
    ("server/src/utils/", "utilidad"), ("client/src/pages/", "pagina"), ("client/src/components/", "componente"),
    ("client/src/store/", "store"), ("client/src/api/", "api"), ("client/src/utils/", "utilidad"),
    ("client/src/types/", "tipos"),
]


# ----------------------------------------------------------------------------
def git_files() -> list[str]:
    out = subprocess.run(["git", "ls-files"], cwd=ROOT, capture_output=True, text=True, check=True).stdout
    return [f for f in out.splitlines() if f and not SKIP.search(f)]


def read(rel: str) -> str:
    try:
        return (ROOT / rel).read_text(encoding="utf-8")
    except (UnicodeDecodeError, FileNotFoundError):
        return ""


def note_path(rel: str) -> str:
    return f"Código/{rel}"


def link(rel: str, alias: str | None = None) -> str:
    alias = alias or short(rel)
    return f"[[{note_path(rel)}|{alias}]]"


def short(rel: str) -> str:
    parts = rel.split("/")
    for prefix in ("server/src/", "client/src/"):
        if rel.startswith(prefix):
            return rel[len(prefix):]
    return "/".join(parts[-2:]) if len(parts) > 1 else rel


def mlink(mid: str) -> str:
    m = MOD_BY_ID[mid]
    return f"[[Módulos/{m['name']}|{m['name']}]]"


def dlink(doc: str, alias: str | None = None) -> str:
    return f"[[Docs/{doc}|{alias or doc.split('/')[-1]}]]"


def layer(rel: str) -> str:
    if rel.startswith("server/"):
        return "server"
    if rel.startswith("client/"):
        return "client"
    return "raiz"


def ftype(rel: str) -> str:
    for prefix, t in TYPE_BY_DIR:
        if rel.startswith(prefix):
            return t
    if Path(rel).suffix in CODE_EXT and "config" not in rel:
        return "script" if "scripts/" in rel else "entrada"
    return "config"


def line_of(text: str, idx: int) -> int:
    return text.count("\n", 0, idx) + 1


def resolve_import(src: str, spec: str, files: set[str]) -> str | None:
    if not spec.startswith("."):
        return None
    base = (Path(src).parent / spec)
    parts: list[str] = []
    for p in base.as_posix().split("/"):
        if p == "..":
            if parts:
                parts.pop()
        elif p not in (".", ""):
            parts.append(p)
    cand = "/".join(parts)
    for suffix in ("", ".ts", ".tsx", ".js", ".mjs", "/index.ts", "/index.tsx"):
        if cand + suffix in files:
            return cand + suffix
    return None


IMPORT_RE = re.compile(r"^\s*(?:import|export)\s+(?:type\s+)?(?:([\s\S]*?)\s+from\s+)?['\"]([^'\"]+)['\"]", re.M)
DYN_IMPORT_RE = re.compile(r"import\(\s*['\"]([^'\"]+)['\"]\s*\)")


def parse_imports(rel: str, text: str, files: set[str]):
    internal: dict[str, set[str]] = defaultdict(set)
    external: set[str] = set()
    specs = [(m.group(1) or "", m.group(2)) for m in IMPORT_RE.finditer(text)]
    specs += [("(dinámico)", m.group(1)) for m in DYN_IMPORT_RE.finditer(text)]
    for names, spec in specs:
        target = resolve_import(rel, spec, files)
        clean = re.sub(r"\s+", " ", names.replace("type ", "")).strip()
        idents = set(re.findall(r"[A-Za-z_$][\w$]*", clean)) - {"as", "default", "from"}
        if target:
            internal[target] |= idents
        elif not spec.startswith("."):
            pkg = "/".join(spec.split("/")[:2]) if spec.startswith("@") else spec.split("/")[0]
            external.add(pkg)
    return internal, external


# ----------------------------------------------------------------------------
def main() -> int:
    if not GRAPH.exists():
        print("Falta graphify-out/graph.json. Corre primero: graphify update .", file=sys.stderr)
        return 1
    graph = json.loads(GRAPH.read_text(encoding="utf-8"))
    files = git_files()
    fileset = set(files)
    code_files = [f for f in files if Path(f).suffix in CODE_EXT or Path(f).name in CONFIG_NAMES or f.endswith(".css")]
    doc_files = [f for f in files if f.endswith(".md") and f != "client/README.md"]

    module_of: dict[str, str] = {}
    for m in MODULES:
        for f in m["files"]:
            module_of[f] = m["id"]
    unassigned = [f for f in code_files if f not in module_of]

    texts = {f: read(f) for f in code_files}
    nlines = {f: texts[f].count("\n") + (0 if texts[f].endswith("\n") or not texts[f] else 1) for f in code_files}

    # --- imports
    imports: dict[str, dict[str, set[str]]] = {}
    externals: dict[str, set[str]] = {}
    for f in code_files:
        if Path(f).suffix in CODE_EXT:
            imports[f], externals[f] = parse_imports(f, texts[f], fileset)
        else:
            imports[f], externals[f] = {}, set()
    imported_by: dict[str, dict[str, set[str]]] = defaultdict(dict)
    for src, deps in imports.items():
        for tgt, names in deps.items():
            imported_by[tgt][src] = names

    # --- símbolos desde el grafo
    nodes = {n["id"]: n for n in graph["nodes"]}
    symbols: dict[str, list[tuple[int, str, str]]] = defaultdict(list)
    sym_index: dict[str, list[tuple[str, int]]] = defaultdict(list)
    for n in graph["nodes"]:
        sf, label = n.get("source_file"), n.get("label", "")
        if n.get("file_type") != "code" or not sf or sf not in texts or Path(sf).suffix not in CODE_EXT:
            continue
        if re.search(r"\.(ts|tsx|js|mjs|json)$", label):
            continue
        loc = n.get("source_location") or "L0"
        ln = int(re.sub(r"\D", "", loc) or 0)
        kind = "función" if label.endswith("()") else ("clase/tipo" if n.get("_callable_class") or label[:1].isupper() else "valor")
        if (ln, label) not in {(s[0], s[1]) for s in symbols[sf]}:
            symbols[sf].append((ln, label, kind))
            sym_index[label.rstrip("()")].append((sf, ln))
    for f in symbols:
        symbols[f].sort()

    # --- llamadas entre archivos (aristas calls del grafo)
    calls_out: dict[str, dict[str, set[str]]] = defaultdict(lambda: defaultdict(set))
    calls_in: dict[str, dict[str, set[str]]] = defaultdict(lambda: defaultdict(set))
    for e in graph.get("links", []):
        if e.get("relation") not in ("calls", "indirect_call"):
            continue
        s, t = nodes.get(e["source"]), nodes.get(e["target"])
        if not s or not t:
            continue
        sf, tf = s.get("source_file"), t.get("source_file")
        if sf and tf and sf != tf and sf in texts and tf in texts:
            calls_out[sf][tf].add(t["label"])
            calls_in[tf][sf].add(t["label"])

    # --- endpoints
    app_text = texts.get("server/src/app.ts", "")
    router_var_file = {m.group(1): f"server/src/routes/{m.group(2)}.ts"
                       for m in re.finditer(r"import (\w+) from '\./routes/(\w+)'", app_text)}
    mounts = {router_var_file[m.group(2)]: m.group(1)
              for m in re.finditer(r"app\.use\('([^']+)',\s*(\w+)\)", app_text) if m.group(2) in router_var_file}
    endpoints = []  # dict(method, path, roles, auth, schemas, file, line, desc)
    for f, prefix in mounts.items():
        t = texts.get(f, "")
        role_consts = {m.group(1): m.group(2) for m in re.finditer(r"const (\w+) = requireRole\(([^)]*)\)", t)}
        pat = re.compile(r"router\.(get|post|put|patch|delete)\(\s*'([^']*)'([\s\S]*?)(?:async\s*\(|\(\s*_?req\b)")
        for m in pat.finditer(t):
            method, sub, mw = m.group(1).upper(), m.group(2), m.group(3)
            roles = []
            for r in re.findall(r"requireRole\(([^)]*)\)", mw):
                roles += re.findall(r"'(\w+)'", r)
            for name, r in role_consts.items():
                if re.search(rf"\b{name}\b", mw):
                    roles += re.findall(r"'(\w+)'", r)
            schemas = re.findall(r"validate(?:Body|Query)\((\w+)\)", mw)
            before = t[:m.start()].rstrip().splitlines()
            desc = ""
            if before and before[-1].strip().startswith("//"):
                desc = before[-1].strip().lstrip("/").strip()
                desc = re.sub(r"^(GET|POST|PUT|PATCH|DELETE)\s+\S+\s*[—-]?\s*", "", desc)
            full = (prefix + ("" if sub == "/" else sub)).rstrip("/") or prefix
            endpoints.append(dict(method=method, path=full, roles=roles, auth="requireAuth" in mw,
                                  schemas=schemas, file=f, line=line_of(t, m.start()), desc=desc, consumers=[]))
    endpoints.append(dict(method="GET", path="/api/health", roles=[], auth=False, schemas=[],
                          file="server/src/app.ts", line=line_of(app_text, app_text.find("/api/health")),
                          desc="Salud del servidor", consumers=[]))

    # --- llamadas a la API desde el cliente
    api_calls: dict[str, list[tuple[str, str, int]]] = defaultdict(list)
    call_re = re.compile(r"api\.(get|post|patch|put|delete)(?:<[^()]*?>)?\(\s*([`'\"])(.*?)\2(\s*\+)?", re.S)
    for f in code_files:
        if not f.startswith("client/"):
            continue
        for m in call_re.finditer(texts[f]):
            p = re.sub(r"\$\{[^}]*\}", ":x", m.group(3)).split("?")[0]
            if m.group(4):
                p = p.rstrip("/") + "/:x"
            api_calls[f].append((m.group(1).upper(), "/api" + p, line_of(texts[f], m.start())))

    def match_ep(method: str, path: str):
        segs = path.strip("/").split("/")
        best = None
        for ep in endpoints:
            es = ep["path"].strip("/").split("/")
            if ep["method"] != method or len(es) != len(segs):
                continue
            score = 0
            for a, b in zip(es, segs):
                if a == b:
                    score += 2
                elif a.startswith(":") or b == ":x":
                    score += 0
                else:
                    break
            else:
                if best is None or score > best[0]:
                    best = (score, ep)
        return best[1] if best else None

    unmatched_calls = []
    for f, calls in api_calls.items():
        for method, p, ln in calls:
            ep = match_ep(method, p)
            if ep:
                ep["consumers"].append((f, ln))
            else:
                unmatched_calls.append((f, method, p, ln))

    # --- tablas
    schema_text = texts.get("server/src/db/schema.ts", "")
    tables = []  # (ident, sqlname, line, columns)
    tmatches = list(re.finditer(r"export const (\w+) = sqliteTable\('(\w+)'", schema_text))
    for i, m in enumerate(tmatches):
        end = tmatches[i + 1].start() if i + 1 < len(tmatches) else len(schema_text)
        body = schema_text[m.end():end]
        cols = []
        for c in re.finditer(r"^\s+(\w+):\s*(text|integer|real)\('(\w+)'([^\n]*)", body, re.M):
            flags = []
            rest = c.group(4)
            if "primaryKey" in rest: flags.append("PK")
            if "notNull" in rest: flags.append("NOT NULL")
            if ".unique()" in rest: flags.append("UNIQUE")
            ref = re.search(r"references\(\(\) => (\w+)\.(\w+)\)", rest)
            if ref: flags.append(f"FK→{ref.group(1)}")
            enum = re.search(r"enum: \[([^\]]*)\]", rest)
            if enum: flags.append("enum " + enum.group(1).replace("'", ""))
            cols.append((c.group(3), c.group(2), ", ".join(flags)))
        tables.append((m.group(1), m.group(2), line_of(schema_text, m.start()), cols))
    table_ids = {t[0] for t in tables}
    tables_used: dict[str, set[str]] = defaultdict(set)
    for f, deps in imports.items():
        names = deps.get("server/src/db/schema.ts", set())
        for n in names & table_ids:
            tables_used[n].add(f)

    # --- eventos socket
    emits: dict[str, list[tuple[str, int]]] = defaultdict(list)
    listens: dict[str, list[tuple[str, int]]] = defaultdict(list)
    for f in code_files:
        t = texts[f]
        for m in re.finditer(r"\bemit\('([\w:-]+)'", t):
            emits[m.group(1)].append((f, line_of(t, m.start())))
        if f.startswith("client/"):
            for m in re.finditer(r"socket\.on\('([\w:-]+)'", t):
                listens[m.group(1)].append((f, line_of(t, m.start())))

    # --- rutas del cliente
    app_tsx = texts.get("client/src/App.tsx", "")
    client_routes = []
    for m in re.finditer(r"<Route path=\"([^\"]+)\" element=\{([\s\S]*?)\}\s*/>", app_tsx):
        el = m.group(2)
        roles = re.findall(r"'(\w+)'", (re.search(r"roles=\{\[([^\]]*)\]", el) or [None, ""])[1] if re.search(r"roles=\{\[", el) else "")
        nav = re.search(r"Navigate to=\"([^\"]+)\"", el)
        comp = [c for c in re.findall(r"<(\w+)", el) if c not in ("ProtectedRoute", "Navigate")]
        page = None
        if comp:
            imp = re.search(rf"import {comp[0]} from '\./([^']+)'", app_tsx)
            if imp:
                page = resolve_import("client/src/App.tsx", "./" + imp.group(1), fileset)
        client_routes.append(dict(path=m.group(1), roles=roles, redirect=nav.group(1) if nav else None,
                                  comp=comp[0] if comp else None, file=page, line=line_of(app_tsx, m.start())))

    # tests que cubren cada archivo
    tested_by: dict[str, set[str]] = defaultdict(set)
    for f in code_files:
        if "/__tests__/" in f and "/helpers/" not in f:
            for tgt in imports.get(f, {}):
                if "/__tests__/" not in tgt:
                    tested_by[tgt].add(f)

    # ------------------------------------------------------------------ escribir
    if OUT.exists():
        for child in OUT.iterdir():
            if child.name == ".obsidian":
                continue
            shutil.rmtree(child) if child.is_dir() else child.unlink()
    OUT.mkdir(parents=True, exist_ok=True)

    def write(rel: str, content: str):
        p = OUT / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        # En tablas de Obsidian el "|" del alias de un wikilink debe escaparse.
        lines = [re.sub(r"\[\[([^\]|]*)\|([^\]]*)\]\]", r"[[\1\\|\2]]", ln) if ln.startswith("|") else ln
                 for ln in content.rstrip().split("\n")]
        p.write_text("\n".join(lines) + "\n", encoding="utf-8", newline="\n")

    def roles_txt(roles):
        return ", ".join(f"`{r}`" for r in dict.fromkeys(roles)) if roles else "cualquier rol autenticado"

    commit = graph.get("built_at_commit", "")[:8]
    today = date.today().isoformat()
    gen_note = f"> Generado por `scripts/vault/build_vault.py` el {today} (grafo del commit `{commit}`). No editar a mano: se regenera."

    # --- notas de archivo
    for f in code_files:
        mid = module_of.get(f)
        t = ftype(f)
        fm = ["---", f"path: \"{f}\"", f"modulo: \"{MOD_BY_ID[mid]['name'] if mid else 'Sin módulo'}\"",
              f"capa: {layer(f)}", f"tipo: {t}", f"lineas: {nlines[f]}", "tags:",
              f"  - maui/{layer(f)}", f"  - maui/{t}", f"  - modulo/{mid or 'sin-modulo'}", "---"]
        body = [f"# {short(f)}", "",
                f"`{f}` · {mlink(mid) if mid else 'Sin módulo'} · {t} · {nlines[f]} líneas", ""]
        eps = [e for e in endpoints if e["file"] == f]
        if eps:
            body += ["## Endpoints", "", "| Método | Ruta | Roles | Valida | Línea | Consumido por |", "|---|---|---|---|---|---|"]
            for e in sorted(eps, key=lambda e: e["line"]):
                cons = ", ".join(sorted({link(c) for c, _ in e["consumers"]})) or "—"
                body.append(f"| {e['method']} | `{e['path']}` | {roles_txt(e['roles']) if e['auth'] else 'pública'} | "
                            f"{', '.join(e['schemas']) or '—'} | L{e['line']} | {cons} |")
            body.append("")
        if symbols.get(f):
            body += ["## Símbolos", ""]
            body += [f"- `{label}` — {kind}, L{ln}" for ln, label, kind in symbols[f]]
            body.append("")
        used = sorted(tid for tid, fs in tables_used.items() if f in fs)
        if used:
            body += ["## Tablas que usa", "", ", ".join(f"[[Referencia/Base de datos#{tid}|{tid}]]" for tid in used), ""]
        ev_out = sorted({ev for ev, locs in emits.items() for lf, _ in locs if lf == f})
        ev_in = sorted({ev for ev, locs in listens.items() for lf, _ in locs if lf == f})
        if ev_out or ev_in:
            body += ["## Eventos en tiempo real", ""]
            if ev_out: body.append("- Emite: " + ", ".join(f"`{e}`" for e in ev_out))
            if ev_in: body.append("- Escucha: " + ", ".join(f"`{e}`" for e in ev_in))
            body.append("")
        if api_calls.get(f):
            body += ["## Llama a la API", ""]
            for method, p, ln in api_calls[f]:
                ep = match_ep(method, p)
                where = f" → {link(ep['file'])} L{ep['line']}" if ep else " → (sin endpoint encontrado)"
                body.append(f"- L{ln}: `{method} {p}`{where}")
            body.append("")
        if imports.get(f) or externals.get(f):
            body += ["## Importa", ""]
            for tgt, names in sorted(imports[f].items()):
                body.append(f"- {link(tgt)}" + (f" — {', '.join(sorted(names))}" if names else ""))
            if externals.get(f):
                body.append("- Paquetes: " + ", ".join(f"`{x}`" for x in sorted(externals[f])))
            body.append("")
        if imported_by.get(f):
            body += ["## Importado por", ""]
            for src, names in sorted(imported_by[f].items()):
                body.append(f"- {link(src)}" + (f" — {', '.join(sorted(names))}" if names else ""))
            body.append("")
        if calls_out.get(f) or calls_in.get(f):
            body += ["## Llamadas entre archivos (grafo)", ""]
            for tgt, labels in sorted(calls_out[f].items()):
                body.append(f"- → {link(tgt)}: " + ", ".join(f"`{x}`" for x in sorted(labels)))
            for src, labels in sorted(calls_in[f].items()):
                body.append(f"- ← {link(src)} usa: " + ", ".join(f"`{x}`" for x in sorted(labels)))
            body.append("")
        if tested_by.get(f):
            body += ["## Tests que lo importan", "", ", ".join(link(x) for x in sorted(tested_by[f])), ""]
        write(note_path(f) + ".md", "\n".join(fm + [""] + body + ["", gen_note]))

    # --- notas de módulo
    mod_files = {m["id"]: [f for f in m["files"] if f in texts] for m in MODULES}
    mod_deps: Counter = Counter()
    for src, deps in imports.items():
        for tgt in deps:
            a, b = module_of.get(src), module_of.get(tgt)
            if a and b and a != b:
                mod_deps[(a, b)] += 1
    for m in MODULES:
        fs = mod_files[m["id"]]
        total = sum(nlines[f] for f in fs)
        body = ["---", f"modulo: \"{m['name']}\"", f"archivos: {len(fs)}", f"lineas: {total}",
                "tags:", "  - maui/modulo", f"  - modulo/{m['id']}", "---", "", f"# {m['name']}", "", m["summary"], ""]
        if m["rules"]:
            body += ["## Reglas que no se rompen", ""] + [f"- {r}" for r in m["rules"]] + [""]
        groups = [("Servidor", lambda f: f.startswith("server/") and "/__tests__/" not in f),
                  ("Cliente", lambda f: f.startswith("client/")),
                  ("Tests", lambda f: "/__tests__/" in f),
                  ("Otros", lambda f: not f.startswith(("server/", "client/")))]
        body += ["## Archivos", ""]
        for title, pred in groups:
            sel = [f for f in fs if pred(f)]
            if not sel:
                continue
            body += [f"### {title}", "", "| Archivo | Tipo | Líneas | Símbolos clave |", "|---|---|---|---|"]
            for f in sel:
                syms = [s[1] for s in symbols.get(f, []) if s[2] == "función" and not s[1].startswith(".")][:6]
                body.append(f"| {link(f)} | {ftype(f)} | {nlines[f]} | {', '.join(f'`{s}`' for s in syms) or '—'} |")
            body.append("")
        eps = [e for e in endpoints if e["file"] in fs]
        if eps:
            body += ["## Endpoints", "", "| Método | Ruta | Roles | Archivo |", "|---|---|---|---|"]
            for e in sorted(eps, key=lambda e: (e["path"], e["method"])):
                body.append(f"| {e['method']} | `{e['path']}` | {roles_txt(e['roles']) if e['auth'] else 'pública'} | {link(e['file'])} L{e['line']} |")
            body.append("")
        used = sorted({tid for tid, ufs in tables_used.items() if ufs & set(fs)})
        if used:
            body += ["## Tablas", "", ", ".join(f"[[Referencia/Base de datos#{tid}|{tid}]]" for tid in used), ""]
        crs = [r for r in client_routes if r["file"] in fs]
        if crs:
            body += ["## Pantallas", ""] + [f"- `{r['path']}` → {link(r['file'])} ({roles_txt(r['roles'])})" for r in crs] + [""]
        out_d = [(b, n) for (a, b), n in mod_deps.items() if a == m["id"]]
        in_d = [(a, n) for (a, b), n in mod_deps.items() if b == m["id"]]
        if out_d or in_d:
            body += ["## Dependencias entre módulos", ""]
            if out_d: body.append("- Usa: " + ", ".join(f"{mlink(b)} ({n})" for b, n in sorted(out_d, key=lambda x: -x[1])))
            if in_d: body.append("- Lo usan: " + ", ".join(f"{mlink(a)} ({n})" for a, n in sorted(in_d, key=lambda x: -x[1])))
            body.append("")
        if m["docs"]:
            body += ["## Documentación", ""] + [f"- {dlink(d)} — {sec}" for d, sec in m["docs"]] + [""]
        write(f"Módulos/{m['name']}.md", "\n".join(body + [gen_note]))

    # --- referencia: API
    body = ["# API HTTP", "", f"{len(endpoints)} endpoints. Todos exigen `Authorization: Bearer <jwt>` salvo los marcados como públicos.", ""]
    by_prefix: dict[str, list] = defaultdict(list)
    for e in endpoints:
        by_prefix["/".join(e["path"].split("/")[:3])].append(e)
    for prefix in sorted(by_prefix):
        mid = module_of.get(by_prefix[prefix][0]["file"])
        body += [f"## {prefix}", "", f"Módulo: {mlink(mid) if mid else '—'}", "",
                 "| Método | Ruta | Roles | Valida | Definido en | Consumido por | Nota |", "|---|---|---|---|---|---|---|"]
        for e in sorted(by_prefix[prefix], key=lambda e: (e["path"], e["method"])):
            cons = ", ".join(sorted({link(c) for c, _ in e["consumers"]})) or "**sin consumidor en la UI**"
            body.append(f"| {e['method']} | `{e['path']}` | {roles_txt(e['roles']) if e['auth'] else 'pública'} | "
                        f"{', '.join(e['schemas']) or '—'} | {link(e['file'])} L{e['line']} | {cons} | {e['desc'].replace('|', '/')} |")
        body.append("")
    if unmatched_calls:
        body += ["## Llamadas del cliente sin endpoint reconocido", ""]
        body += [f"- {link(f)} L{ln}: `{mth} {p}`" for f, mth, p, ln in unmatched_calls] + [""]
    write("Referencia/API.md", "\n".join(body + [gen_note]))

    # --- referencia: BD
    body = ["# Base de datos", "", f"{len(tables)} tablas en {link('server/src/db/schema.ts')}. Módulo: {mlink('bd')}.", ""]
    for ident, sqlname, ln, cols in tables:
        users = sorted(tables_used.get(ident, set()))
        body += [f"## {ident}", "", f"Tabla SQL `{sqlname}` · schema.ts L{ln}", "",
                 "| Columna | Tipo | Restricciones |", "|---|---|---|"]
        body += [f"| `{c}` | {t} | {fl or '—'} |" for c, t, fl in cols]
        body += ["", "Usada por: " + (", ".join(link(u) for u in users) or "—"), ""]
    write("Referencia/Base de datos.md", "\n".join(body + [gen_note]))

    # --- referencia: tiempo real
    body = ["# Eventos en tiempo real (Socket.io)", "", f"Módulo: {mlink('tiempo-real')}.", "",
            "| Evento | Emitido en | Escuchado en |", "|---|---|---|"]
    for ev in sorted(set(emits) | set(listens)):
        if ev in ("connect", "disconnect"):
            continue
        e_out = "<br>".join(f"{link(f)} L{ln}" for f, ln in emits.get(ev, [])) or "—"
        e_in = "<br>".join(f"{link(f)} L{ln}" for f, ln in listens.get(ev, [])) or "—"
        body.append(f"| `{ev}` | {e_out} | {e_in} |")
    write("Referencia/Tiempo real.md", "\n".join(body + ["", gen_note]))

    # --- referencia: pantallas
    body = ["# Pantallas del cliente", "", f"Definidas en {link('client/src/App.tsx')}.", "",
            "| Ruta | Componente | Roles | Módulo |", "|---|---|---|---|"]
    for r in client_routes:
        if r["redirect"]:
            body.append(f"| `{r['path']}` | redirige a `{r['redirect']}` | — | — |")
        else:
            mid = module_of.get(r["file"]) if r["file"] else None
            body.append(f"| `{r['path']}` | {link(r['file'], r['comp']) if r['file'] else r['comp']} | "
                        f"{roles_txt(r['roles'])} | {mlink(mid) if mid else '—'} |")
    write("Referencia/Pantallas.md", "\n".join(body + ["", gen_note]))

    # --- referencia: permisos
    roles_all = ["owner", "manager", "cashier", "waiter"]
    body = ["# Roles y permisos (servidor)", "",
            "Matriz derivada de `requireRole` en las rutas. Un endpoint sin `requireRole` admite cualquier rol autenticado; "
            "algunas reglas extra viven en los servicios (p. ej., cancelar pedidos con cobros).", "",
            "| Endpoint | " + " | ".join(roles_all) + " |", "|---|" + "---|" * len(roles_all)]
    for e in sorted(endpoints, key=lambda e: (e["path"], e["method"])):
        if not e["auth"]:
            continue
        cells = ["✓" if (not e["roles"] or r in e["roles"]) else "" for r in roles_all]
        body.append(f"| `{e['method']} {e['path']}` | " + " | ".join(cells) + " |")
    write("Referencia/Permisos.md", "\n".join(body + ["", gen_note]))

    # --- referencia: índice de símbolos
    body = ["# Índice de símbolos", "", "Todos los símbolos del grafo con su archivo y línea. Útil para buscar con Ctrl+F.", ""]
    for name in sorted(sym_index, key=str.lower):
        locs = ", ".join(f"{link(f)} L{ln}" for f, ln in sorted(set(sym_index[name])))
        body.append(f"- `{name}` — {locs}")
    write("Referencia/Índice de símbolos.md", "\n".join(body + ["", gen_note]))

    # --- glosario
    write("Referencia/Glosario.md", "\n".join([
        "# Glosario del dominio", "",
        "- **Pedido (order)**: unidad operativa de mesa o delivery. Tabla `orders`.",
        "- **Ítem (order item)**: línea del pedido con snapshot de nombre y precio. Tabla `order_items`.",
        "- **Modificador**: nivel de picante (obligatorio si `hasSpiceLevel`) o preferencia en texto libre.",
        "- **Boleta (bill)**: venta contable interna, numerada `B001-NNNNN` en el servidor. Un pedido puede tener varias.",
        "- **Sub-cuenta (bill group)**: división de un pedido para cobrar por separado (A–F).",
        "- **Comanda**: ticket de cocina impreso. No es una boleta.",
        "- **Pre-cuenta**: ticket informativo, \"no es comprobante de pago\".",
        "- **Gasto (expense)**: egreso registrado manualmente por el dueño o encargado.",
        "- **layout_items**: decoraciones del plano del salón.",
        "- **Roles**: `owner` dueño · `manager` encargado · `cashier` cajero · `waiter` mozo.",
        "", gen_note]))

    # --- docs copiados
    for d in doc_files:
        dst = "Docs/" + (d[len("docs/"):] if d.startswith("docs/") else d)
        write(dst, f"> Copia de `{d}` hecha por el generador. Edita el original en el repo.\n\n" + read(d))

    # --- canvas de módulos
    cols, w, h, gx, gy = 4, 320, 140, 420, 260
    cnodes, cedges = [], []
    for i, m in enumerate(MODULES):
        cnodes.append({"id": m["id"], "type": "file", "file": f"Módulos/{m['name']}.md",
                       "x": (i % cols) * gx, "y": (i // cols) * gy, "width": w, "height": h})
    for (a, b), n in mod_deps.items():
        cedges.append({"id": f"{a}->{b}", "fromNode": a, "toNode": b, "fromSide": "bottom", "toSide": "top",
                       "label": str(n)})
    write("Mapa de módulos.canvas", json.dumps({"nodes": cnodes, "edges": cedges}, ensure_ascii=False, indent=1))

    # --- inicio
    body = [
        "# MauiDesk — Mapa del código", "",
        "POS self-hosted de la Cevichería MAUI (Tacna): Express + Socket.io + SQLite en una Raspberry Pi 5, "
        "cliente React (PWA) en los celulares del local. Estado y decisiones: " + dlink("CLAUDE", "CLAUDE.md") + ".", "",
        "## Cómo navegar", "",
        "1. **Por módulo** (tabla de abajo): cada nota resume el propósito, las reglas que no se rompen, archivos, endpoints, tablas y docs.",
        "2. **Por archivo**: carpeta `Código/` replica el repo; cada nota lista símbolos con línea, endpoints, tablas, imports y quién lo usa.",
        "3. **Por referencia**: [[Referencia/API|API]] · [[Referencia/Base de datos|Base de datos]] · "
        "[[Referencia/Tiempo real|Tiempo real]] · [[Referencia/Pantallas|Pantallas]] · [[Referencia/Permisos|Permisos]] · "
        "[[Referencia/Índice de símbolos|Índice de símbolos]] · [[Referencia/Glosario|Glosario]]",
        "4. **Visual**: abre `Mapa de módulos.canvas` o la vista de grafo filtrando `path:Código` o `tag:#maui/modulo`.", "",
        "## Módulos", "", "| Módulo | Archivos | Líneas | Endpoints | Qué hace |", "|---|---|---|---|---|",
    ]
    for m in MODULES:
        fs = mod_files[m["id"]]
        n_ep = sum(1 for e in endpoints if e["file"] in fs)
        body.append(f"| {mlink(m['id'])} | {len(fs)} | {sum(nlines[f] for f in fs)} | {n_ep or '—'} | {m['summary'].split('. ')[0].rstrip('.')} |")
    body += ["", "## ¿Dónde está…?", "", "| Pregunta | Símbolo | Ubicación |", "|---|---|---|"]
    for q, sym in QUICK:
        locs = [(f, ln) for f, ln in sym_index.get(sym, []) if "/__tests__/" not in f]
        if locs:
            f, ln = sorted(set(locs))[0]
            body.append(f"| {q} | `{sym}` | {link(f)} L{ln} |")
    body += ["", "## Capas de una petición", "",
             "`pages/*` → `store/*` → `api/client.ts` / `api/socket.ts` → `middleware` (requireAuth → requireRole → validateBody) "
             "→ `routes/*` → `services/*` → `db` (withWriteLock + transacción) → SQLite; tras el commit `realtime.emit()` avisa a todos.", ""]
    if unassigned:
        body += ["## Sin módulo asignado", "", "Archivos nuevos que hay que clasificar en `MODULES` de `scripts/vault/build_vault.py`:", ""]
        body += [f"- {link(f)}" for f in unassigned] + [""]
    body += ["## Mantener al día", "", "```", "graphify update .", "python scripts/vault/build_vault.py", "```", "",
             f"Grafo: `graphify-out/graph.json` (commit `{commit}`). Consultas puntuales: `graphify explain \"createBill\"`, "
             "`graphify path \"POS()\" \"createBill()\"`.", "", gen_note]
    write("00 Inicio.md", "\n".join(body))

    print(f"Vault: {OUT} · {len(code_files)} archivos · {len(MODULES)} módulos · {len(endpoints)} endpoints · "
          f"{len(tables)} tablas · {len(doc_files)} docs")
    if unassigned:
        print("Sin módulo: " + ", ".join(unassigned))
    if unmatched_calls:
        print("Llamadas sin endpoint: " + ", ".join(f"{m} {p}" for _, m, p, _ in unmatched_calls))
    return 0


if __name__ == "__main__":
    sys.exit(main())
