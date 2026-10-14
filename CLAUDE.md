# MauiDesk — Guía para Claude Code

POS para Cevichería MAUI (Tacna, Perú). Despliegue local en Raspberry Pi 5, sin nube. Usuarios: dueño, encargado, cajero y mozos, todos operando desde celulares en la LAN del local.

**Estado del proyecto:** MAUI v1.1 está en **modo mantenimiento** (solo correcciones). Las funcionalidades nuevas van al producto POS que nace de la etiqueta `maui-v1.1`. Plan y decisiones: [docs/plan-maui-v1.1.md](docs/plan-maui-v1.1.md). Arquitectura: [docs/architecture/README.md](docs/architecture/README.md).

**Excepción: inventario de la tesis.** El módulo de inventario de insumos perecibles se desarrolla aquí porque se mide en el local (diseño preprueba/posprueba). Plan: [docs/plan-inventario-tesis.md](docs/plan-inventario-tesis.md) (v2). Instrumento de medición: [docs/diccionario-datos-tesis.md](docs/diccionario-datos-tesis.md) (v1, **congelado**). Hecho: fase 0 v2 (solo registro; rutina = «Compra del día»). La fase 2 (recetas, stock teórico, sugerencia de compra, alertas) **no se implementa** hasta que el plan lo indique.

## Stack

- **Server**: Node.js (≥ 22; producción con 24 LTS) + Express 5 + TypeScript + Drizzle ORM + `@libsql/client` (SQLite local) + Socket.io 4 + Zod
- **Client**: React 19 + Vite 8 + Tailwind 4 + Zustand + React Router 7 + axios + socket.io-client + Lucide icons
- **Auth**: JWT en `localStorage`; `requireAuth` y el handshake de Socket.io verifican además que el usuario siga activo en la BD
- **DB**: SQLite local (`server/mauidisk.db`), modo WAL. Migraciones idempotentes en `server/src/db/migrate.ts` al arrancar.
- **Impresión térmica**: ESC/POS sobre TCP (Ethernet), configurada en `server/.env`. La rama Windows existe solo para desarrollo en la PC.
- **Tests**: Vitest + supertest (servidor). El cliente se verifica con typecheck, lint y pruebas manuales.

## Comandos

Desde la raíz del repo:

```bash
# Desarrollo (dos terminales separadas)
npm run dev:server   # tsx watch src/index.ts en :3001
npm run dev:client   # vite en :5173 (proxy /api → :3001)

# Base de datos
npm run db:push      # SOLO en desarrollo o primera instalación: aplica schema.ts
npm run db:seed      # sembrar usuarios + menú demo (solo si DB vacía)
cd server && npm run db:migrate   # aplica migrate.ts sin levantar el server (despliegues)

# Verificación (antes de cada commit)
npm run ci           # server: tsc + vitest + eslint · client: tsc + eslint
```

Cliente compila con `npm run build` desde `client/` → genera `client/dist/`, que el server sirve estático en producción.

## Cuentas seed por defecto

Solo para desarrollo. **Cambiarlas en producción tras el primer login** (el server avisa al arrancar si siguen con la contraseña por defecto).

| Usuario | Password | Rol |
|---|---|---|
| `admin` | `admin123` | owner |
| `cajero` | `cajero123` | cashier |
| `mozo1` | `mozo123` | waiter |

## Roles y permisos

Cuatro roles: `owner` (dueño), `manager` (encargado: el dueño le delega el local), `cashier`, `waiter`. La barrera real es el servidor (`requireRole` + reglas en los servicios); la UI solo oculta. Matriz completa en [docs/plan-maui-v1.1.md §2](docs/plan-maui-v1.1.md#2-decisiones) y en `server/src/__tests__/permissions.test.ts`. Resumen:
- Mozo: pedidos, agregar ítems, "pedir cuenta", reimprimir comanda.
- Cajero: + cobrar, dividir, pre-cuenta, reimprimir boletas del día, cancelar pedidos **sin cobros**, marcar platos agotados.
- Encargado: + cancelar pedidos con cobros, gastos, reportes, historial completo, inventario («Compra del día», compras, merma, export).
- Dueño: todo, incluidos precios, menú, mesas/plano, usuarios y el catálogo de insumos.
- "No había" (`POST /inventory/lost-sales`) lo registra cualquier rol desde el POS.

## Estructura

```
server/src/
  index.ts           bootstrap: valida entorno, crea io, migra (fail-fast), avisos de arranque, escucha
  app.ts             createApp(): CORS, JSON, routers, manejador de errores (usado también en tests)
  realtime.ts        setIo / emit / disconnectUser — los routers NO importan index.ts
  errors.ts          DomainError(message, status, code, details)
  startup-checks.ts  avisos: zona horaria ≠ Lima, cuentas seed con contraseña por defecto
  middleware/
    auth.ts          requireAuth (JWT + usuario activo en BD), requireRole
    validate.ts      validateBody / validateQuery (Zod)
    error.ts         errores → JSON (DomainError, SQLITE_BUSY → 503, JSON inválido → 400)
  routes/            controladores delgados (auth, menu, orders, bills, split, tables, reports, print, users, inventory)
  services/
    order.service.ts     precios desde el catálogo, crear pedido, agregar ítems, estados, cancelar
    billing.service.ts   cobro atómico (lecturas dentro de la tx, guardia bill_id IS NULL)
    split.service.ts     sub-cuentas
    report.service.ts    resumen de ventas (top platos por bill_id, días locales)
    receipt.service.ts   boleta armada desde la BD
    order.serializer.ts  forma única del pedido (incluye tableNumber)
    audit.ts             audit(tx, …) — registro en audit_log
    inventory.service.ts insumos, compras, merma, conteos sueltos, ventas perdidas
    inventory-daily.service.ts   «Compra del día»: apertura + merma + compras + notas en una tx
    inventory-export.service.ts  CSV del instrumento de la tesis (columnas congeladas)
  schemas/           Schemas Zod por recurso
  db/
    schema.ts        tablas drizzle (incluye índices declarados)
    migrate.ts       migraciones idempotentes: requeridas (fallo = no arranca) y opcionales
    migrate-cli.ts   npm run db:migrate
    write-lock.ts    withWriteLock (mutex de escrituras) + withBusyRetry
    seed.ts          datos de demostración
    index.ts         cliente drizzle + libsql; tipo Executor (BD o tx)
  utils/
    printer.ts       ESC/POS: TCP (cross-platform) y Windows (dev only)
    tickets.ts       etiqueta de pedido, datos de comanda, selección de reimpresión
    dates.ts / math.ts / csv.ts / codes.ts (código estable de insumo)
  __tests__/         Vitest; helpers/db.ts (esquema real), helpers/http.ts (app + usuarios por rol)

server/scripts/
  restore-backup.sh  restaura un backup en otra ruta sin pisar nada (ver DEPLOYMENT.md)

client/src/
  pages/             POS, Cash, Tables, Reports, BillsHistory, Login, admin/{MenuAdmin,Users},
                     inventory/{Inventory, DailyTab, PurchasesTab, WasteTab, SuppliesTab, model, ui}
  components/        ToastHost, ReconnectBanner, ProtectedRoute, ConfirmDialog, PrinterStatus, etc.
  store/             zustand: auth, order (borrador), orders (activos + resync), toast, connection
  api/               client.ts (axios + interceptor 401), socket.ts (auth handshake, listeners)
  utils/             dates.ts (parseDbUtc), reportHTML.ts (escapeHtml)
```

## Convenciones y gotchas

### Auth
- Todo endpoint HTTP que no sea `/api/auth/login` o `/api/health` exige `Authorization: Bearer <jwt>`.
- `requireAuth` consulta el usuario en cada request: rol y nombre salen de la BD, no del token. Inhabilitar o cambiar el rol surte efecto de inmediato (y `PATCH /users/:id` corta sus sockets).
- Login: 5 fallos por IP+usuario en 5 min → 429.
- `JWT_SECRET` se valida al startup: si falta o es < 32 chars, el server **aborta**.

### Precios y pedidos
- **El cliente nunca define precios ni nombres.** Envía `dishId`, `quantity`, `modifiers` (`groupId`, `optionId`, `freeText`) y `notes`; `resolveItems` calcula `unitPrice = precio + priceAdjustment` desde el catálogo. Plato agotado → 409 `DISH_UNAVAILABLE`.
- Estados del pedido: activos `pending` y `paying` ("por cobrar"); cerrados `paid` (solo lo pone el cobro) y `cancelled` (solo `POST /orders/:id/cancel` con motivo). `preparing`/`ready` son heredados y se tratan como `pending`.
- Un pedido activo por mesa: verificado en la transacción y por el índice único parcial `uq_orders_active_table`.
- Lo visible o impreso usa `tableNumber` (número de la mesa), nunca `tableId`.

### Validación
- Todas las rutas POST/PATCH usan `validateBody(SchemaX)`. Body inválido → 400 con `issues` (Zod).
- Errores de negocio: lanzar `DomainError(mensaje, status, code)` desde el servicio; el manejador global responde JSON.
- Nunca volver a `req.body as any` — usar el tipo `infer<typeof Schema>` o el `XxxInput` exportado por el schema.

### Concurrencia
- **Toda escritura de varios pasos va dentro de `withWriteLock(() => db.transaction(...))`**. `@libsql/client` no encola transacciones (la segunda falla con `SQLITE_BUSY`) y un `PRAGMA busy_timeout` se pierde tras cada transacción, por eso el mutex. **No anidar** `withWriteLock` (se bloquea).
- Las precondiciones se leen **dentro** de la transacción (ver `billing.service.ts`). Al marcar ítems como cobrados se exige `bill_id IS NULL` y se verifica la cantidad de filas.
- La impresión (lenta) ocurre **fuera** del candado; solo el `UPDATE` posterior va dentro.
- El número de boleta se genera con `MAX+1` dentro de la transacción; el `UNIQUE` + reintento ×3 cubre colisiones.

### Auditoría
- Operaciones sensibles escriben en `audit_log` con `audit(tx, …)` **en la misma transacción**: cancelaciones, correcciones/borrados de gastos (con motivo), precios, disponibilidad y bajas de platos, cambios de usuarios y mesas, y en el inventario correcciones/borrados de compras y merma, correcciones de conteos y cambios del catálogo de insumos. El dueño lo ve en Reportes → "Cancelaciones y correcciones".

### Inventario (Fase 0 de la tesis)
- **El instrumento está congelado** ([diccionario](docs/diccionario-datos-tesis.md) v1): no cambiar columnas, orden ni semántica del export ni de lo que registra la «Compra del día». `inventory.export.test.ts` fija los encabezados y falla a propósito; un cambio exige versión nueva del diccionario y de `DATASET_VERSION`.
- La única rutina es la **«Compra del día»** (`POST /inventory/daily`, dueño/encargado): una transacción por fecha con apertura (`supply_counts.moment='apertura'`), merma por deterioro (imputada al **día operativo anterior** = último día con boletas), compras y notas del día. Es idempotente: reemplaza solo lo que creó (`source='daily'`, `source_date`) y audita `daily.update` si cambia algo. Hasta 7 días atrás.
- El mozo y el cajero no hacen nada obligatorio; «No había» es opcional. Sin stock teórico ni alertas: la fase 2 se calculará desde estas tablas **sin cambiar cómo se registran** (requisito de la línea base).
- `supplies.code` es el identificador estable del insumo (no editable); `local_id` existe en las tablas de hechos (siempre 1) y no se muestra en la UI.
- Fechas de compra, merma y conteo: **día local** `YYYY-MM-DD` (no futuro). `lost_sales.occurred_at`: UTC como el resto; los rangos se convierten con `parseDayBoundary`.
- Corregir o borrar exige motivo y audita el registro anterior (como los gastos). En la merma, `reason` es la causa y el motivo de la corrección va en `correctionReason`.
- `available=false` es solo "agotado"; la baja de un plato con historial es `archived=true`. `dish.availability` en `audit_log` (la medida de quiebres) se escribe solo en transiciones reales, desde `/availability` o desde la edición del dueño. No romper esto: es un indicador de la tesis.
- `GET /api/menu` devuelve los agotados (el POS los muestra con "No había") y excluye los archivados.

### Socket
- Eventos del server: `order:new`, `order:updated`, `order:removed`, `kitchen:print-result`. Se emiten con `emit()` de `realtime.ts`, después del commit.
- El cliente vuelve a pedir `/orders/active` al reconectar y al volver la app al frente (más de 30 s).
- Estado de conexión en `client/src/store/connection.ts`; banner en [ReconnectBanner.tsx](client/src/components/ReconnectBanner.tsx).
- Todos los eventos van a todos los sockets autenticados (segmentar por rol queda para el producto).

### UX
- Errores y avisos van por toasts (`useToastStore.push({...})`). **Nunca usar `alert()`, `confirm()` ni `console.error` en flujos visibles**; para confirmar, `ConfirmDialog` (admite un campo de motivo como `children`).
- Botones que envían datos tienen estado "enviando" y se deshabilitan durante el request.
- Inputs numéricos con `inputMode="decimal"`; teléfono con `inputMode="tel"`.
- Fechas de la BD (UTC sin zona): mostrarlas siempre con `formatDbDateTime`/`parseDbUtc` de `client/src/utils/dates.ts`.
- Todo HTML generado con texto de usuarios pasa por `escapeHtml`.

### Impresora
- Ningún endpoint de impresión acepta el contenido del ticket: el cliente indica qué imprimir (`/print/reprint/:billId`, `/print/pre-receipt/:orderId`, `/orders/:id/reprint-kitchen`) y el servidor lo arma desde la BD.
- `checkPrinterStatus()` corre ANTES de mandar el buffer; si la impresora no responde, error inmediato (502 `PRINTER_UNAVAILABLE`, no se encola).
- `kitchen_printed` indica si el ítem llegó a la comanda; el POS muestra "Sin comanda" y permite reintentar solo lo pendiente.
- En producción (Pi) `PRINTER_TYPE=tcp`. En desarrollo Windows se puede usar `PRINTER_TYPE=windows` con `PRINTER_NAME`.
- La cocina **no tiene pantalla**: solo recibe la comanda impresa. `/kitchen` está deshabilitada en [App.tsx](client/src/App.tsx).

### DB migrations
- Para cambios de esquema: editar `server/src/db/schema.ts` **y** agregar el paso idempotente en `migrate.ts` (producción no usa `db:push`).
- Solo cambios **aditivos** (tablas, columnas nulables, índices): así volver a la versión anterior del código funciona con la BD nueva.
- Todo índice va también en `schema.ts` con el mismo nombre; si no, `drizzle-kit push` lo borra. (`push` siempre propone recrear el índice parcial `uq_orders_active_table`: es inocuo.)
- Pasos requeridos de `migrate.ts` que fallan → el server no arranca. Los opcionales avisan y siguen.

### Tests
- Esquema de tests generado desde `schema.ts` (`helpers/db.ts`); tests HTTP con `setupHttpApp()` y `ctx.as(rol)` (`helpers/http.ts`). Un archivo de test HTTP no debe importar estáticamente nada que importe `src/db`.
- Al corregir un defecto: primero el test que lo reproduce.

### Estilo de código
- Comentarios en español. Solo explican el *porqué*, no el *qué*.
- Sin punto y coma al final de línea en TS (estilo establecido).
- Tailwind en JSX, paleta principal: `#0077B6` (azul), `#F4792B` (naranja delivery), `#EEF3F8` (gris claro fondo).

## Entornos esperados

Ver [server/.env.example](server/.env.example) — variables documentadas una por una. Las críticas:
- `JWT_SECRET` (obligatorio, ≥ 32 chars)
- `ALLOWED_ORIGINS` (CORS allowlist; vacío = defaults de dev)
- `DATABASE_URL` (en Pi: ruta absoluta al SSD)
- `PRINTER_TYPE` + (`PRINTER_HOST`/`PRINTER_PORT` o `PRINTER_NAME`)
- Zona horaria del proceso: `TZ=America/Lima` (en la unidad systemd)

## Deploy

Guía paso a paso en [DEPLOYMENT.md](DEPLOYMENT.md): Raspberry Pi 5 + SSD + systemd, impresora POS-D Basic 200 por Ethernet, Tailscale para acceso remoto del dueño, backup diario fuera del local, restauración con `server/scripts/restore-backup.sh` y procedimiento de actualización con rollback.

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:
- When graphify-out/graph.json exists, run `graphify query "<question>"` before your first grep, search or source-file read for a codebase question, and put this rule in every subagent prompt that explores code. Read raw files only for lines the graph or an earlier read already located. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Vault de navegación por módulos: `graphify-out/obsidian/`. Para ubicar un módulo, archivo, endpoint, tabla o evento, lee primero `00 Inicio.md` y la nota del módulo en `Módulos/`; cada archivo tiene su nota en `Código/<ruta>.md` con símbolos y líneas. Referencias: `Referencia/API.md`, `Base de datos.md`, `Permisos.md`, `Índice de símbolos.md`.
- Tras modificar código: `graphify update .` y luego `python scripts/vault/build_vault.py`. Si agregas un archivo, asígnalo a su módulo en `MODULES` de ese script.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).
- A committed graphify-out/graph.json is rewritten whole on every build, so a large diff to it in a pull request is expected. Do not flag it as churn or suggest skipping the graph rebuild or its hooks.
