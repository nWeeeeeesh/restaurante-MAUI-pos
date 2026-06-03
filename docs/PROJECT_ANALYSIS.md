# PROJECT_ANALYSIS.md — MauiDesk (POS Cevichería MAUI)

> Informe técnico generado a partir del análisis del repositorio real. Toda
> conclusión está anclada a archivos concretos del proyecto. Documentos
> relacionados: [DATABASE_ANALYSIS.md](DATABASE_ANALYSIS.md),
> [BUSINESS_RULES.md](BUSINESS_RULES.md), [ARCHITECTURE_MAP.md](ARCHITECTURE_MAP.md),
> [../CLAUDE.md](../CLAUDE.md), [../DEPLOYMENT.md](../DEPLOYMENT.md).

---

## 1. Resumen ejecutivo

**MauiDesk** es un sistema POS (Point of Sale) monolítico, *self-hosted*, para una
cevichería en Tacna, Perú. Está diseñado para correr **100% en la LAN del local**
sobre una Raspberry Pi 5, sin dependencia de la nube. Todos los usuarios (dueño,
cajero, mozos) operan desde el navegador de sus **celulares** conectados al WiFi
del restaurante.

El sistema cubre el ciclo operativo completo de un restaurante:

- **Toma de pedidos** por mesa (dine-in) o delivery — [client/src/pages/POS.tsx](../client/src/pages/POS.tsx)
- **Comanda impresa** automáticamente en cocina vía impresora térmica ESC/POS — [server/src/utils/printer.ts](../server/src/utils/printer.ts)
- **Cobro** con efectivo / Yape / Plin, incluyendo **división de cuenta** y **cobro parcial** — [client/src/pages/Cash.tsx](../client/src/pages/Cash.tsx), [server/src/routes/bills.ts](../server/src/routes/bills.ts)
- **Plano visual de mesas** editable (drag & drop, zonas, etiquetas) — [client/src/pages/Tables.tsx](../client/src/pages/Tables.tsx)
- **Reportes** de ventas, gastos y balance con exportación CSV/HTML — [client/src/pages/Reports.tsx](../client/src/pages/Reports.tsx)
- **Administración** de menú, usuarios y roles — [client/src/pages/admin/](../client/src/pages/admin/)
- **Sincronización en tiempo real** entre dispositivos vía Socket.io

**Estado de madurez:** producto funcional y bastante pulido (manejo de errores por
toasts, validación Zod en todo POST/PATCH, transacciones atómicas en cobro/split,
reconexión de socket, soft-delete con preservación de historial). Se observan
varias correcciones de seguridad ya aplicadas y comentadas en código (marcadas
`C3`, `C5`, `C6`, `C7`, `C9`, `A2`). **No tiene tests automatizados.**

| Métrica | Valor |
|---|---|
| Lenguaje | TypeScript (servidor y cliente) |
| Líneas de dominio relevante | ~5.000 (cliente concentrado en `Cash.tsx` y `Tables.tsx`) |
| Endpoints REST | ~40 (9 routers) |
| Tablas en BD | 11 |
| Eventos socket | 4 (`order:new`, `order:updated`, `order:removed`, `kitchen:print-result`) |
| Roles | 3 (owner, cashier, waiter) |
| Tests | 0 |

---

## 2. Arquitectura identificada

### 2.1 Estilo arquitectónico

**Monolito cliente-servidor** con separación física en dos paquetes npm
independientes (`server/` y `client/`) más un `package.json` raíz que orquesta
scripts de desarrollo.

```
┌──────────────────── Navegador (celular en LAN) ────────────────────┐
│  React 19 SPA (Vite build)                                          │
│  Zustand stores ── axios (HTTP /api) ── socket.io-client (WS)       │
└───────────────────────────┬────────────────────────────────────────┘
                            │ HTTP + WebSocket
┌───────────────────────────▼────────────────────────────────────────┐
│  Node.js + Express 5  (server/src/index.ts)                         │
│   • CORS allowlist + express.json()                                 │
│   • requireAuth (JWT) en HTTP / io.use (JWT) en Socket.io           │
│   • 9 routers REST  ──►  Drizzle ORM  ──►  SQLite (libsql)          │
│   • Socket.io (io.emit broadcast a todos)                           │
│   • Sirve client/dist estático en producción (SPA fallback)        │
│   • utils/printer.ts ──► ESC/POS por TCP:9100 (o Windows en dev)    │
└─────────────────────────────────────────────────────────────────────┘
```

En **producción** el mismo proceso Express sirve el bundle estático del cliente
([server/src/index.ts:104-113](../server/src/index.ts)) — un solo origen, un solo
puerto (3001). En **desarrollo** son dos procesos: Vite (5173) con proxy `/api` y
`/socket.io` hacia 3001 ([client/vite.config.ts](../client/vite.config.ts)).

### 2.2 Capas del servidor

| Capa | Ubicación | Responsabilidad |
|---|---|---|
| Entry / bootstrap | [server/src/index.ts](../server/src/index.ts) | Valida `JWT_SECRET`, configura CORS, monta routers, autentica sockets, corre migraciones, levanta HTTP |
| Middleware | [server/src/middleware/](../server/src/middleware/) | `requireAuth`, `requireRole` (JWT), `validateBody`/`validateQuery` (Zod) |
| Rutas (controladores) | [server/src/routes/](../server/src/routes/) | Lógica de negocio + acceso a datos (no hay capa de servicio separada) |
| Validación | [server/src/schemas/](../server/src/schemas/) | Schemas Zod por recurso |
| Datos | [server/src/db/](../server/src/db/) | Schema Drizzle, cliente libsql, migraciones idempotentes, seed |
| Utilidades | [server/src/utils/](../server/src/utils/) | Impresión ESC/POS + bitmap de logo |

> **Observación:** no existe una capa de *servicios/repositorios* separada. Cada
> handler de ruta contiene la lógica de negocio y las queries Drizzle inline. Para
> el tamaño actual es aceptable, pero la lógica de cobro/split (la más compleja)
> vive directamente en los routers.

### 2.3 Capas del cliente

| Capa | Ubicación | Responsabilidad |
|---|---|---|
| Routing / shell | [client/src/App.tsx](../client/src/App.tsx), [components/Layout.tsx](../client/src/components/Layout.tsx), [components/ProtectedRoute.tsx](../client/src/components/ProtectedRoute.tsx) | Rutas, guardias por rol, navegación |
| Páginas | [client/src/pages/](../client/src/pages/) | Vistas: POS, Cash, Tables, Reports, BillsHistory, Login, admin/{MenuAdmin,Users} |
| Estado | [client/src/store/](../client/src/store/) | Zustand: `auth`, `order` (borrador), `orders` (activos + socket), `receipt`, `toast`, `connection` |
| Acceso API | [client/src/api/](../client/src/api/) | `client.ts` (axios + interceptor 401), `socket.ts` (handshake JWT) |
| Tipos | [client/src/types/index.ts](../client/src/types/index.ts) | Tipos compartidos del dominio cliente |

---

## 3. Mapa de módulos

### 3.1 Stack tecnológico (de `package.json` reales)

**Servidor** ([server/package.json](../server/package.json)):
Express 5.2, Drizzle ORM 0.45 + `@libsql/client` 0.17 (SQLite), Socket.io 4.8,
Zod 4.4, `jsonwebtoken` 9, `bcryptjs` 3, `jimp` 0.22 (generación del bitmap del
logo para ESC/POS), `dotenv`. Dev: `tsx` (watch + run), `drizzle-kit`,
TypeScript 6.

**Cliente** ([client/package.json](../client/package.json)):
React 19.2, Vite 8, Tailwind 4 (`@tailwindcss/vite`), Zustand 5,
React Router 7, axios 1.15, `socket.io-client` 4.8, `recharts` 3.8 (gráficos de
reportes), `@dnd-kit/*` (drag&drop de la cocina/plano), `lucide-react` (íconos).

### 3.2 Módulos funcionales

| Módulo | Frontend | Backend | Tablas |
|---|---|---|---|
| **Autenticación** | [Login.tsx](../client/src/pages/Login.tsx), [store/auth.ts](../client/src/store/auth.ts) | [routes/auth.ts](../server/src/routes/auth.ts), [middleware/auth.ts](../server/src/middleware/auth.ts) | `users` |
| **Menú** | [POS.tsx](../client/src/pages/POS.tsx), [admin/MenuAdmin.tsx](../client/src/pages/admin/MenuAdmin.tsx) | [routes/menu.ts](../server/src/routes/menu.ts) | `categories`, `dishes`, `modifier_groups`, `modifier_options` |
| **Pedidos** | [POS.tsx](../client/src/pages/POS.tsx), [store/order.ts](../client/src/store/order.ts), [store/orders.ts](../client/src/store/orders.ts) | [routes/orders.ts](../server/src/routes/orders.ts) | `orders`, `order_items` |
| **Mesas / Plano** | [Tables.tsx](../client/src/pages/Tables.tsx) | [routes/tables.ts](../server/src/routes/tables.ts) | `tables`, `layout_items` |
| **Cobro / Caja** | [Cash.tsx](../client/src/pages/Cash.tsx), [store/receipt.ts](../client/src/store/receipt.ts) | [routes/bills.ts](../server/src/routes/bills.ts), [routes/split.ts](../server/src/routes/split.ts) | `bills`, `bill_groups`, `order_items` |
| **Reportes / Gastos** | [Reports.tsx](../client/src/pages/Reports.tsx), [BillsHistory.tsx](../client/src/pages/BillsHistory.tsx), [utils/reportHTML.ts](../client/src/utils/reportHTML.ts) | [routes/reports.ts](../server/src/routes/reports.ts) | `bills`, `expenses`, `order_items` |
| **Impresión** | [components/PrinterStatus.tsx](../client/src/components/PrinterStatus.tsx) | [routes/print.ts](../server/src/routes/print.ts), [utils/printer.ts](../server/src/utils/printer.ts) | — |
| **Usuarios** | [admin/Users.tsx](../client/src/pages/admin/Users.tsx), [components/ChangePasswordModal.tsx](../client/src/components/ChangePasswordModal.tsx) | [routes/users.ts](../server/src/routes/users.ts) | `users` |
| **Infra tiempo real** | [store/connection.ts](../client/src/store/connection.ts), [components/ReconnectBanner.tsx](../client/src/components/ReconnectBanner.tsx), [api/socket.ts](../client/src/api/socket.ts) | `io` en [index.ts](../server/src/index.ts) | — |

---

## 4. Flujo principal de negocio

El ciclo de vida de un pedido es el corazón del sistema:

```
1. TOMAR PEDIDO (mozo, POS.tsx)
   ├─ Mesa libre → crea Order (POST /api/orders) → mesa pasa a 'occupied'
   ├─ o Delivery → crea Order con datos de cliente
   └─ Server: inserta order + order_items (status 'pending')
        └─ autoPrintKitchen() imprime COMANDA NUEVA en cocina
        └─ io.emit('order:new')  ──►  todos los dispositivos actualizan

2. AGREGAR ITEMS (opcional, mozo vuelve a la mesa ocupada)
   └─ POST /api/orders/:id/items
        └─ imprime "++ ITEMS AGREGADOS ++" (solo los nuevos)
        └─ si la orden tiene cuenta dividida, auto-asigna a sub-cuenta
        └─ io.emit('order:updated')

3. (Pre-cuenta opcional, cajero)
   └─ POST /api/print/pre-receipt  → ticket "PRE-CUENTA · No es comprobante"

4. COBRAR (cajero, Cash.tsx)
   ├─ Cobro simple: POST /api/bills (todos los items no facturados)
   ├─ Cobro parcial: itemIds específicos
   └─ Cuenta dividida: POST /api/orders/:id/split (crea bill_groups) →
                       luego POST /api/bills por sub-cuenta (billGroupId)
        └─ Server (transacción atómica):
            • genera receiptNumber (pre-check colisión → 409 RECEIPT_TAKEN)
            • inserta bill + marca order_items.billId
            • si quedan 0 items sin facturar → order 'paid', mesa 'free'
            • emite order:removed (si fullyPaid) u order:updated
        └─ Cliente imprime boleta (POST /api/print/receipt)

5. REPORTES (dueño)
   └─ /reports: ventas, top platos, métodos de pago, ventas diarias, gastos,
      balance neto. Export CSV / reporte HTML imprimible.
```

**Punto crítico de concurrencia:** el cobro (`POST /bills`) y la división
(`POST /split`) corren dentro de `db.transaction(...)` para que dos cobros
simultáneos no facturen el mismo ítem dos veces ([bills.ts:202](../server/src/routes/bills.ts),
[split.ts:80](../server/src/routes/split.ts)). Ver detalle en
[BUSINESS_RULES.md](BUSINESS_RULES.md).

---

## 5. Entidades y relaciones (resumen)

Detalle completo en [DATABASE_ANALYSIS.md](DATABASE_ANALYSIS.md). Diagrama lógico:

```
users ──< orders ──< order_items >── dishes >── categories
                │          │
                │          ├──> bill_groups (sub-cuentas)
                │          └──> bills
                └──> tables
dishes ──< modifier_groups ──< modifier_options
tables / layout_items   (plano)
expenses                (gastos, independiente)
```

Relaciones clave:
- Una `order` activa por mesa (regla de unicidad en [orders.ts:117-123](../server/src/routes/orders.ts), no constraint de BD).
- `order_items.billId` y `order_items.billGroupId` modelan facturación parcial y división.
- `bills.receiptNumber` es `UNIQUE` — único candado de integridad sobre la numeración.

---

## 6. Posibles problemas arquitectónicos

| # | Problema | Evidencia | Severidad |
|---|---|---|---|
| P1 | **Numeración de boletas generada en el cliente** (`localStorage`), no en el servidor. Cada dispositivo lleva su propio `lastNumber`. | [store/receipt.ts](../client/src/store/receipt.ts), `nextReceiptNumber()` en [Cash.tsx:619](../client/src/pages/Cash.tsx) | Alta |
| P2 | **Definición de "hoy" inconsistente** entre módulos: `bills.ts` usa medianoche **local**, `reports.ts` usa medianoche **UTC**. En Perú (UTC-5) los reportes "hoy" arrancan a las 19:00 del día anterior. | [bills.ts:108-115](../server/src/routes/bills.ts) vs [reports.ts:11-23](../server/src/routes/reports.ts) | Media |
| P3 | **`POST /api/bills` no exige rol** — cualquier autenticado (incluido un mozo) puede registrar un cobro vía API. La UI lo restringe a owner/cashier, pero el endpoint no. | [bills.ts:125](../server/src/routes/bills.ts) (solo `requireAuth`) | Media |
| P4 | **Lógica de negocio en los controladores.** No hay capa de servicio; el cobro/split (lo más delicado) está inline en routers. Dificulta testear y reutilizar. | [bills.ts](../server/src/routes/bills.ts), [split.ts](../server/src/routes/split.ts) | Media |
| P5 | **Montos como `real` (punto flotante).** Precios y totales en coma flotante exponen a errores de redondeo acumulado. | [db/schema.ts](../server/src/db/schema.ts) (`price`, `total`, etc. `real`) | Media |
| P6 | **Broadcast global de eventos socket** (`io.emit` a todos). No hay segmentación por rol/sala. | [orders.ts](../server/src/routes/orders.ts), [bills.ts](../server/src/routes/bills.ts) | Baja (escala actual) |
| P7 | **Datos de impresión enviados por el cliente**, no reconstruidos desde la BD. El server confía en el shape recibido (validado por Zod, pero con valores arbitrarios). | [routes/print.ts](../server/src/routes/print.ts), nota en [schemas/print.ts:4-6](../server/src/schemas/print.ts) | Baja |
| P8 | **Sin índices explícitos** más allá de PK y los `UNIQUE`. Consultas como `order_items` por `orderId` hacen scan. | [db/schema.ts](../server/src/db/schema.ts) | Baja (volumen bajo) |

---

## 7. Deuda técnica encontrada

1. **Código muerto:**
   - [client/src/data/mockData.ts](../client/src/data/mockData.ts) — datos de prototipo, no se importa en ninguna parte (POS consume el API real).
   - [client/src/pages/Kitchen.tsx](../client/src/pages/Kitchen.tsx) — pantalla KDS completa pero deshabilitada: la ruta `/kitchen` redirige a `/tables` ([App.tsx:43](../client/src/App.tsx)). La cocina opera solo con comanda impresa (decisión de negocio documentada en [../CLAUDE.md](../CLAUDE.md)).
   - [client/src/pages/Placeholder.tsx](../client/src/pages/Placeholder.tsx) — no referenciado en el router.
2. **`validateQuery` existe pero no se usa** de forma consistente: `reports.ts` y `bills.ts` parsean `req.query` a mano en vez de usar el middleware. [middleware/validate.ts:24](../server/src/middleware/validate.ts).
3. **Inconsistencia de nomenclatura `dine_in` vs `dine-in`:** el dominio usa `dine_in` (guion bajo) en BD/órdenes y `dine-in` (guion) en los schemas/funciones de impresión. Se mapea en cada handler. [schemas/orders.ts:21](../server/src/schemas/orders.ts) vs [schemas/print.ts:23](../server/src/schemas/print.ts).
4. **Sin tests** (unitarios, integración o e2e). La lógica de cobro/split, la más propensa a regresiones, no tiene red de seguridad.
5. **Migraciones en dos lugares:** `drizzle-kit push` (schema) + migraciones idempotentes manuales en [db/migrate.ts](../server/src/db/migrate.ts) al startup. Funciona, pero la fuente de verdad del schema queda dividida.
6. **`expenses` sin endpoints de edición/borrado** — solo alta y listado vía `reports.ts`. Un gasto mal cargado no se puede corregir desde la app.
7. **Validación de contraseña divergente:** el server exige mínimo 8 caracteres ([schemas/users.ts:3](../server/src/schemas/users.ts)) pero la UI de admin dice "Mínimo 4 caracteres" ([admin/Users.tsx:229,278](../client/src/pages/admin/Users.tsx)). El server rechazará contraseñas de 4-7 chars con un 400.
8. **`useReceiptStore` y `useOrderStore` persisten en `localStorage`** — el borrador de pedido y el contador de boletas sobreviven recargas, pero también pueden quedar "pegados" entre turnos/usuarios en el mismo dispositivo.

---

## 8. Riesgos potenciales

| Riesgo | Impacto | Mitigación existente | Recomendación |
|---|---|---|---|
| **Hardware único (Pi 5 + microSD)** sin redundancia | Caída total del POS si muere la SD | Backup diario cron + `.backup` atómico ([../DEPLOYMENT.md](../DEPLOYMENT.md) Fase 11) | Migrar a SSD USB; probar restore real |
| **Colisión de número de boleta** entre dispositivos | Cobro rechazado / confusión del cajero | Pre-check en transacción → 409 `RECEIPT_TAKEN` + resync ([bills.ts:204](../server/src/routes/bills.ts), [Cash.tsx:959](../client/src/pages/Cash.tsx)) | Mover numeración 100% al servidor |
| **Cumplimiento fiscal (SUNAT):** las "boletas" son documentos internos, no comprobantes electrónicos | Legal/tributario | Ninguna (el ticket dice solo "Boleta") | Evaluar integración con facturación electrónica si aplica al régimen |
| **Sin internet → sin Tailscale** (acceso remoto del dueño) | El dueño no ve reportes desde fuera | Operación local no depende de internet | Aceptable; documentado |
| **JWT de 12h en `localStorage`** sin refresh ni revocación | Sesión robada válida hasta 12h; re-login al expirar | CORS allowlist, validación de `JWT_SECRET` ≥ 32 chars | Aceptable para LAN; considerar refresh si crece |
| **Autorización de cobro débil (P3)** | Un mozo podría cobrar vía API | UI lo oculta | Agregar `requireRole('owner','cashier')` a `POST /bills` |
| **Corrupción de SQLite por corte de luz** | Pérdida de datos | `.backup` atómico, recomendación de UPS | UPS mini (ya contemplado) |

---

## 9. Recomendaciones de mejora (priorizadas)

**Prioridad alta (correctitud / seguridad):**
1. **Mover la generación del `receiptNumber` al servidor** dentro de la transacción de cobro (ya existe `GET /bills/next-number` atómico; falta que el server *asigne* el número en vez de recibirlo del cliente). Elimina P1 y la clase de bug de colisión.
2. **Unificar la definición de "hoy"** (P2): que `reports.ts` use límites de día locales como `bills.ts`, o centralizar en un helper compartido `dateRange.ts`.
3. **Añadir `requireRole('owner','cashier')`** a `POST /api/bills` y revisar autorización de `orders` mutaciones (P3).

**Prioridad media (mantenibilidad):**
4. **Extraer una capa de servicios** para cobro/split (`billing.service.ts`) y cubrirla con tests de integración sobre una SQLite en memoria.
5. **Representar dinero en centavos (`integer`)** o usar utilidades de redondeo consistentes (P5).
6. **Eliminar código muerto** (`mockData.ts`, `Placeholder.tsx`) y decidir el futuro de `Kitchen.tsx` (borrar o documentar como "feature dormida").
7. **Alinear la validación de contraseña** UI ↔ servidor (deuda #7).

**Prioridad baja (robustez / DX):**
8. Usar `validateQuery` en `reports`/`bills`.
9. Agregar índices en `order_items(order_id)`, `order_items(bill_id)`, `bills(paid_at)`.
10. Endpoints de edición/borrado de `expenses`.
11. Introducir un linter/formatter compartido para el server (el cliente ya tiene ESLint) y un mínimo de CI.

---

## 10. Cómo correr el proyecto (referencia rápida)

```bash
# Desde la raíz
npm run dev:server   # tsx watch  → :3001
npm run dev:client   # vite       → :5173 (proxy /api y /socket.io → :3001)
npm run db:push      # aplica schema Drizzle (idempotente)
npm run db:seed      # siembra usuarios + menú demo (solo si BD vacía)
```

Variables de entorno críticas en [../server/.env.example](../server/.env.example):
`JWT_SECRET` (≥32 chars, obligatorio), `ALLOWED_ORIGINS`, `DATABASE_URL`,
`PRINTER_TYPE` + (`PRINTER_HOST`/`PRINTER_PORT` o `PRINTER_NAME`).

Despliegue completo en Raspberry Pi 5: [../DEPLOYMENT.md](../DEPLOYMENT.md).
