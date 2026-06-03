# ARCHITECTURE_MAP.md — MauiDesk (Mapa de conocimiento)

> Memoria interna del sistema: función de cada archivo importante, dependencias
> entre módulos, responsabilidades, flujo de ejecución y puntos críticos. Pensado
> como referencia rápida para futuras tareas. Relacionado:
> [PROJECT_ANALYSIS.md](PROJECT_ANALYSIS.md), [DATABASE_ANALYSIS.md](DATABASE_ANALYSIS.md),
> [BUSINESS_RULES.md](BUSINESS_RULES.md).

---

## 1. Árbol anotado del repositorio

```
restaurante-MAUI-pos/
├── package.json                 Orquesta scripts dev:server / dev:client / db:*
├── CLAUDE.md                    Instrucciones del proyecto (auto-cargadas por Claude Code)
├── DEPLOYMENT.md                Guía de despliegue Raspberry Pi 5
├── scripts/generate-pwa-icons.js  Genera iconos PWA 192/512 desde el logo
├── docs/                        ← este análisis (PROJECT/DATABASE/BUSINESS/ARCHITECTURE)
│
├── server/                      Backend Express + Drizzle + Socket.io
│   ├── drizzle.config.ts        Config drizzle-kit (sqlite)
│   ├── .env.example             Variables documentadas una por una
│   └── src/
│       ├── index.ts             ★ ENTRY: bootstrap, CORS, auth socket, routers, migrate, listen
│       ├── middleware/
│       │   ├── auth.ts          requireAuth / requireRole (JWT) + tipo AuthPayload
│       │   └── validate.ts      validateBody / validateQuery (Zod)
│       ├── routes/              Controladores + lógica + queries (sin capa de servicio)
│       │   ├── auth.ts          POST /login, GET /me
│       │   ├── menu.ts          CRUD categorías/platos/modificadores
│       │   ├── orders.ts        ★ CRUD pedidos + autoPrintKitchen + toggles
│       │   ├── split.ts         ★ dividir/deshacer cuenta (transacción)
│       │   ├── bills.ts         ★ cobrar (transacción) + historial + next-number
│       │   ├── reports.ts       summary / expenses / bills por período
│       │   ├── print.ts         status / test / receipt / pre-receipt / kitchen / reprint / clear-queue
│       │   ├── tables.ts        CRUD mesas + layout (plano)
│       │   └── users.ts         CRUD usuarios + cambio de contraseña
│       ├── schemas/             Zod por recurso (auth, menu, orders, bills, split, print, tables, users, reports)
│       ├── db/
│       │   ├── schema.ts        ★ 11 tablas Drizzle (fuente de verdad)
│       │   ├── index.ts         Cliente drizzle + libsql (export db)
│       │   ├── migrate.ts       Migraciones idempotentes al startup
│       │   └── seed.ts          Datos demo (solo si BD vacía)
│       └── utils/
│           ├── printer.ts       ★ ESC/POS: TCP + Windows, pre-check, sanitize, layouts
│           └── logo_bitmap.ts   LOGO_CMD (bitmap del logo para ESC/POS)
│
└── client/                      Frontend React 19 + Vite + Tailwind
    ├── vite.config.ts           Proxy /api y /socket.io → :3001 en dev
    └── src/
        ├── main.tsx             Render raíz
        ├── App.tsx              ★ Router + guardias por rol; /kitchen deshabilitada
        ├── types/index.ts       Tipos de dominio del cliente
        ├── api/
        │   ├── client.ts        axios baseURL /api, interceptor 401, Bearer token
        │   └── socket.ts        socket.io-client, handshake JWT, estados de conexión
        ├── store/               Zustand
        │   ├── auth.ts          ★ sesión (login/logout/init), token en localStorage
        │   ├── order.ts         Borrador de pedido (persist localStorage)
        │   ├── orders.ts        ★ pedidos activos + listeners socket + acciones
        │   ├── receipt.ts       Contador de boletas B001-NNNNN (persist)
        │   ├── connection.ts    Estado del socket (banner)
        │   └── toast.ts         Cola de toasts + printerErrorMessage()
        ├── pages/
        │   ├── Login.tsx        Formulario de acceso
        │   ├── POS.tsx          ★ Toma de pedidos (menú + modificadores + mesa/delivery)
        │   ├── Tables.tsx       ★ Plano editable (drag&drop, zonas, áreas) + lista
        │   ├── Cash.tsx         ★ Cobro: pago, split modal, parcial, recibo
        │   ├── BillsHistory.tsx Historial + detalle + reimpresión
        │   ├── Reports.tsx      Dashboards (recharts) + gastos + export CSV/HTML
        │   ├── Kitchen.tsx      KDS — IMPLEMENTADO PERO DESHABILITADO (ruta redirige)
        │   ├── Placeholder.tsx  Código muerto (no enrutado)
        │   └── admin/{MenuAdmin,Users}.tsx  Administración (owner)
        ├── components/
        │   ├── Layout.tsx       Shell: sidebar/bottom-nav por rol, perfil, logout
        │   ├── ProtectedRoute.tsx  Guardia: espera init(), valida token+rol
        │   ├── ToastHost.tsx    Render de toasts
        │   ├── ReconnectBanner.tsx  Banner sticky de socket caído
        │   ├── PrinterStatus.tsx    Pill de estado de impresora (poll 30s) + limpiar cola
        │   ├── ConfirmDialog.tsx    Diálogo de confirmación reutilizable
        │   └── ChangePasswordModal.tsx  Cambio de contraseña propia
        ├── utils/reportHTML.ts  Genera el HTML del reporte imprimible
        └── data/mockData.ts     Código muerto (datos de prototipo, no importado)

★ = archivo crítico / de alta densidad de lógica
```

---

## 2. Responsabilidad de cada archivo crítico

| Archivo | Responsabilidad única | Depende de | Lo usan |
|---|---|---|---|
| [server/src/index.ts](../server/src/index.ts) | Bootstrap del proceso: valida config, CORS, autentica sockets, monta routers, corre migraciones, sirve `client/dist`. **Exporta `io`.** | todos los routers, `migrate`, `auth` | — (entry) |
| [middleware/auth.ts](../server/src/middleware/auth.ts) | Verificar JWT (HTTP) y exponer `req.user`; `requireRole` | `jsonwebtoken` | todos los routers, index (socket) |
| [middleware/validate.ts](../server/src/middleware/validate.ts) | Validar `req.body`/`req.query` con Zod; sanea body | `zod` | todos los routers con POST/PATCH |
| [db/index.ts](../server/src/db/index.ts) | Instanciar y exportar `db` (Drizzle) | `@libsql/client`, `schema` | todos los routers, seed |
| [db/schema.ts](../server/src/db/schema.ts) | Definición de las 11 tablas | `drizzle-orm` | `db`, routers, migrate |
| [routes/orders.ts](../server/src/routes/orders.ts) | Ciclo de vida del pedido + auto-impresión de comanda + emisión socket | `db`, `io`, `printer`, schemas | montado en index |
| [routes/bills.ts](../server/src/routes/bills.ts) | Cobro atómico, numeración, cierre de orden/sub-cuenta, historial | `db`, `io`, schemas | montado en index |
| [routes/split.ts](../server/src/routes/split.ts) | Crear/deshacer sub-cuentas (transacción) | `db`, `io`, schemas | montado en index (`/orders/:id/split`) |
| [utils/printer.ts](../server/src/utils/printer.ts) | Generar buffers ESC/POS y enviarlos (TCP/Windows) con pre-check | `net`, `child_process`, `logo_bitmap` | `orders`, `print` |
| [client/src/store/orders.ts](../client/src/store/orders.ts) | Estado de pedidos activos + listeners socket + acciones optimistas | `api/client`, `api/socket`, `toast` | POS, Cash, Tables, Kitchen |
| [client/src/store/auth.ts](../client/src/store/auth.ts) | Sesión, login/logout/init, resetea otros stores al salir | `api/client`, `orders`, `order` | App, Login, Layout, ProtectedRoute |
| [client/src/api/client.ts](../client/src/api/client.ts) | axios con Bearer + manejo global de 401 | `axios` | todos los stores/páginas |
| [client/src/api/socket.ts](../client/src/api/socket.ts) | socket.io-client con handshake JWT + estados | `socket.io-client`, `connection` | `store/orders` |
| [client/src/pages/Cash.tsx](../client/src/pages/Cash.tsx) | UI de cobro (la más compleja): pago, split, parcial, recibo | stores orders/receipt/auth/toast, api | ruta `/cash` |
| [client/src/pages/Tables.tsx](../client/src/pages/Tables.tsx) | Plano de mesas editable + vista lista por áreas | store orders/auth/toast, api | ruta `/tables` |

---

## 3. Dependencias entre módulos

### 3.1 Servidor (grafo de imports)
```
index.ts
 ├─► middleware/auth.ts ───────────► jsonwebtoken
 ├─► db/migrate.ts ───────────────► @libsql/client
 └─► routes/*  ──┬─► db/index.ts ─► db/schema.ts ─► drizzle-orm
                 ├─► middleware/{auth,validate}
                 ├─► schemas/*  (Zod)
                 ├─► index.ts  (import { io })   ⚠ ciclo controlado
                 └─► utils/printer.ts ─► utils/logo_bitmap.ts
```
> **Ciclo controlado:** los routers importan `io` desde `index.ts`, e `index.ts`
> importa los routers. Funciona porque `io` se crea antes de montar las rutas y los
> handlers usan `io` en tiempo de request (no de import). Es el único acoplamiento
> notable del backend.

### 3.2 Cliente (grafo de stores)
```
App.tsx
 ├─► store/auth.ts ──► api/client.ts ──► (interceptor 401 → /login)
 │        └─ logout() resetea ──► store/orders.ts + store/order.ts
 ├─► store/orders.ts ─┬─► api/client.ts (HTTP)
 │                    ├─► api/socket.ts ──► store/connection.ts
 │                    └─► store/toast.ts (kitchen:print-result → toast)
 ├─► ProtectedRoute ──► store/auth.ts (+ Layout)
 └─► pages/* ──► stores correspondientes + api/client.ts
```

### 3.3 Acoplamientos a vigilar
- **`store/orders.ts` es el hub del tiempo real**: registra los 4 listeners socket
  y centraliza el estado de pedidos. Cambiar el shape de un evento socket impacta
  POS, Cash, Tables (y Kitchen si se reactiva).
- **`store/auth.ts` conoce a `orders` y `order`** (para resetearlos en logout):
  acoplamiento intencional, dirección auth → orders/order.
- **Contrato de impresión** está duplicado conceptualmente: las interfaces de datos
  viven en [printer.ts](../server/src/utils/printer.ts) y los schemas en
  [schemas/print.ts](../server/src/schemas/print.ts); deben mantenerse en sync.

---

## 4. Flujo de ejecución principal

### 4.1 Arranque del servidor
```
node dist/index.js
 1. dotenv.config()
 2. Validar JWT_SECRET (≥32 chars) → si falla, process.exit(1)
 3. Construir allowlist CORS (ALLOWED_ORIGINS o defaults dev)
 4. Crear app Express + httpServer + io (Socket.io)
 5. io.use(...) → verificar JWT en handshake de cada socket
 6. Montar middlewares (cors, json) y los 9 routers + /api/health
 7. Si existe client/dist → servir estático + SPA fallback
 8. applyStartupMigrations() → luego httpServer.listen(PORT)
```

### 4.2 Arranque del cliente
```
main.tsx → App.tsx
 1. useAuthStore.init()  → GET /auth/me con token guardado (o marca initialized)
 2. Si hay token → useOrdersStore.init():
      GET /orders/active  →  socket.connect()  →  registra 4 listeners
 3. ProtectedRoute espera initialized; valida token+rol; renderiza Layout+página
```

### 4.3 Ruta de un request HTTP autenticado
```
axios (Bearer) → CORS → express.json → router
  → requireAuth (verifica JWT, set req.user)
  → [requireRole(...)]            (si aplica)
  → validateBody(Schema)          (Zod; 400 con issues si falla)
  → handler: queries Drizzle [+ db.transaction]
  → [io.emit(...)] post-commit
  → res.json(...)
(401 en cualquier punto → interceptor borra token → redirect /login)
```

### 4.4 Propagación en tiempo real
```
Dispositivo A crea/cobra pedido
  → server muta BD (transacción)
  → io.emit('order:new' | 'order:updated' | 'order:removed')
  → TODOS los sockets autenticados reciben el evento
  → store/orders.ts actualiza su array → re-render en B, C, ...
```

---

## 5. Puntos críticos del sistema

> Lugares donde un cambio mal hecho rompe correctitud, dinero o disponibilidad.
> Tratar con cuidado y, idealmente, con tests antes de tocar.

1. **Transacción de cobro** — [bills.ts:202-262](../server/src/routes/bills.ts).
   Atomicidad del cobro + numeración + cierre de orden. No agregar mutaciones fuera
   del `tx`. No mover el `io.emit` dentro del `tx` (debe ser post-commit).
2. **Transacción de split** — [split.ts:80-108](../server/src/routes/split.ts).
   Reescribe grupos abiertos preservando los pagados. Ventana de huérfanos si se
   saca del `tx`.
3. **Numeración de boletas** — [store/receipt.ts](../client/src/store/receipt.ts) +
   [bills.ts:15-25,204-208](../server/src/routes/bills.ts). Generación cliente +
   candado UNIQUE + 409. Es la deuda P1; cualquier rediseño debe preservar el
   manejo de colisión.
4. **Auto-impresión de comanda** — [orders.ts:20-82](../server/src/routes/orders.ts).
   No debe bloquear la creación del pedido si la impresora falla.
5. **Pre-check de impresora** — [printer.ts:299-305](../server/src/utils/printer.ts).
   Evita encolar trabajos cuando la impresora no responde.
6. **Sincronización mesa ↔ orden** — [orders.ts:294-298](../server/src/routes/orders.ts)
   y `getTableStatus` en [store/orders.ts:243-248](../client/src/store/orders.ts).
   El estado visible de la mesa deriva de la orden activa.
7. **Manejo de zona horaria** — `todayStart/End` en [bills.ts](../server/src/routes/bills.ts)
   vs `periodStart` en [reports.ts](../server/src/routes/reports.ts). Inconsistencia
   conocida (P2). Tocar fechas sin entender esto produce reportes corridos.
8. **Autenticación del socket** — [index.ts:74-86](../server/src/index.ts). Si se
   rompe, o cualquiera escucha eventos, o nadie se conecta.
9. **Guardias de ruta y `initialized`** — [ProtectedRoute.tsx](../client/src/components/ProtectedRoute.tsx).
   El flag evita que un F5 deslogee al usuario antes de validar el token.

---

## 6. Contratos / interfaces clave

### 6.1 `AuthPayload` (JWT) — [middleware/auth.ts:4](../server/src/middleware/auth.ts)
`{ id, username, role: 'owner'|'cashier'|'waiter', name }`. Firmado con 12h de
expiración. Mismo token para HTTP y socket.

### 6.2 Eventos Socket.io (server → todos)
| Evento | Payload | Emitido por |
|---|---|---|
| `order:new` | orden completa (con items + billGroups) | [orders.ts:168](../server/src/routes/orders.ts) |
| `order:updated` | orden completa | orders, bills, split |
| `order:removed` | `orderId` (number) | orders, bills (al pagar/cancelar) |
| `kitchen:print-result` | `{ orderId, ok, isAddition, label, itemCount, reason?, manual? }` | [orders.ts:63,73](../server/src/routes/orders.ts) |

> No hay segmentación por sala/rol: todo va a todos (`io.emit`). Para segmentar en
> el futuro: unir sockets a salas `role:X` en `connection` y usar `io.to(...)`
> (nota en [../CLAUDE.md](../CLAUDE.md)).

### 6.3 Forma de "orden completa" (server → cliente)
`getFullOrder()` ([orders.ts:85-96](../server/src/routes/orders.ts)) devuelve la
orden + `items` (con `modifiers` ya parseado de JSON) + `billGroups`, y normaliza
`createdAt` a ISO con `'Z'`. Es el shape que consume `store/orders.ts`.

---

## 7. Convenciones del proyecto (para mantener consistencia)

- **Comentarios en español**, explican el *porqué* (no el qué).
- **Sin punto y coma** al final de línea en TS.
- **Errores de usuario por toasts** (`useToastStore.push`), nunca `alert()`.
- **Validación Zod obligatoria** en todo POST/PATCH (`validateBody`); usar el tipo
  inferido, nunca `req.body as any`.
- **Paleta Tailwind:** `#0077B6` (azul), `#F4792B` (naranja delivery),
  `#EEF3F8` (fondo gris claro).
- **Snapshots de precio/nombre** en `order_items` — preservar al modificar el flujo
  de pedidos.
- **Migraciones idempotentes** en `migrate.ts` deben chequear existencia antes de
  alterar (seguras de re-ejecutar).

---

## 8. Glosario de dominio

| Término | Significado en el código |
|---|---|
| **Order** | Pedido de una mesa o delivery |
| **Order item** | Línea de pedido (plato + cantidad + modificadores + nota) |
| **Modifier (spice/preference)** | Nivel de picante (opción) o preferencia (texto libre) |
| **Bill** | Boleta/cobro (puede cubrir parte de una orden) |
| **Bill group / sub-cuenta** | Agrupación de items para dividir la cuenta |
| **Comanda** | Ticket impreso para cocina (no es boleta) |
| **Pre-cuenta** | Ticket informativo del total (no comprobante de pago) |
| **paying** | Estado de UI "en caja"; no se persiste (BD lo guarda como `preparing`) |
| **layout_items** | Etiquetas y zonas decorativas del plano |
| **area / grupo** | Zona lógica de mesas (salón, terraza, barra, o personalizada) |
