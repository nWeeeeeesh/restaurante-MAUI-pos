# MauiDesk — Guía para Claude Code

POS para Cevichería MAUI (Tacna, Perú). Despliegue local en Raspberry Pi 5, sin nube. Usuarios: dueño, cajero, mozos — todos operando desde celulares en la LAN del local.

## Stack

- **Server**: Node.js + Express 5 + TypeScript + Drizzle ORM + `@libsql/client` (SQLite local) + Socket.io 4 + Zod (validación)
- **Client**: React 19 + Vite 8 + Tailwind 4 + Zustand + React Router 7 + axios + socket.io-client + Lucide icons
- **Auth**: JWT en `localStorage`, middleware en HTTP (`requireAuth`) y Socket.io (`io.use`)
- **DB**: SQLite local (`server/mauidisk.db`). Migraciones idempotentes en `server/src/db/migrate.ts` corridas al startup.
- **Impresión térmica**: ESC/POS sobre TCP (Ethernet) — modelo configurado en `server/.env`. La rama Windows existe solo para desarrollo en la PC.

## Comandos

Desde la raíz del repo:

```bash
# Desarrollo (dos terminales separadas)
npm run dev:server   # tsx watch src/index.ts en :3001
npm run dev:client   # vite en :5173 (proxy /api → :3001)

# Base de datos
npm run db:push      # aplicar schema de drizzle (idempotente)
npm run db:seed      # sembrar usuarios + menú demo (solo si DB vacía)
```

Cliente compila con `npm run build` desde `client/` → genera `client/dist/`, que el server sirve estático en producción.

## Cuentas seed por defecto

Solo para desarrollo. **Cambiarlas en producción tras el primer login.**

| Usuario | Password | Rol |
|---|---|---|
| `admin` | `admin123` | owner |
| `cajero` | `cajero123` | cashier |
| `mozo1` | `mozo123` | waiter |

## Estructura

```
server/src/
  index.ts           startup: valida JWT_SECRET, configura CORS, monta rutas, autentica sockets
  middleware/
    auth.ts          requireAuth, requireRole — JWT en header Authorization
    validate.ts      validateBody(schema) — middleware Zod genérico
  routes/            REST endpoints (auth, menu, orders, bills, split, tables, reports, print, users)
  schemas/           Schemas Zod por recurso — usados en validateBody
  db/
    schema.ts        tablas drizzle
    migrate.ts       migraciones idempotentes (corren al startup)
    seed.ts          datos de demostración
    index.ts         cliente drizzle + libsql
  utils/printer.ts   ESC/POS: TCP (cross-platform) y Windows (dev only)

client/src/
  pages/             POS, Cash, Tables, Reports, BillsHistory, Login, admin/{MenuAdmin,Users}
  components/        ToastHost, ReconnectBanner, ProtectedRoute, ConfirmDialog, PrinterStatus, etc.
  store/             zustand: auth, order (draft), orders (activos), receipt, toast, connection
  api/               client.ts (axios + interceptors 401), socket.ts (auth handshake, listeners)
```

## Convenciones y gotchas

### Auth
- Todo endpoint HTTP que no sea `/api/auth/*` o `/api/health` exige `Authorization: Bearer <jwt>`.
- Socket.io exige el mismo JWT en `socket.handshake.auth.token` — lo pasa `client/src/api/socket.ts`.
- 401 en cualquier respuesta → el interceptor de axios borra el token y redirige a `/login`.
- `JWT_SECRET` se valida al startup: si falta o es < 32 chars, el server **aborta**.

### Validación
- Todas las rutas POST/PATCH usan `validateBody(SchemaX)`. Si recibís un body con tipos inválidos, responde 400 con `issues` detallados (Zod).
- Nunca volver a `req.body as any` — usar el tipo `infer<typeof Schema>` o el `XxxInput` exportado por el schema.

### Concurrencia
- Cobrar (`POST /api/bills`) y dividir cuenta (`POST /api/orders/:id/split`) corren dentro de `db.transaction(...)`. No agregar mutaciones nuevas a esas rutas fuera de la transacción.
- El número de boleta se genera atómicamente con `SELECT MAX(...)` dentro de la transacción. Si colisiona (race extrema), el server responde 409 `RECEIPT_TAKEN` y el cajero recibe un toast para reintentar.

### Socket
- Events emitidos por el server: `order:new`, `order:updated`, `order:removed`, `kitchen:print-result`.
- Estado de conexión vive en `client/src/store/connection.ts`. El banner sticky [ReconnectBanner.tsx](client/src/components/ReconnectBanner.tsx) aparece cuando el socket está caído.
- Hoy todos los eventos van a todos los sockets autenticados. Si más adelante se segmenta por rol, hay que cambiar `io.emit` por `io.to('role:X').emit` y hacer que los sockets se unan a salas según su payload JWT al conectar.

### UX
- Errores y avisos van por toasts (`useToastStore.push({...})`). **Nunca usar `alert()` ni `console.error` en flujos visibles**.
- Los inputs numéricos que mostramos en celular tienen `inputMode="decimal"`. Los de teléfono tienen `inputMode="tel"`.

### Impresora
- El flujo de impresión hace `checkPrinterStatus()` ANTES de mandar el buffer ESC/POS. Si la impresora no responde, devolvemos error inmediato (no encolamos trabajos).
- En producción (Pi) usamos `PRINTER_TYPE=tcp`. En desarrollo Windows el dev puede usar `PRINTER_TYPE=windows` con `PRINTER_NAME`.
- La cocina **no tiene pantalla** — solo recibe la comanda impresa. La ruta `/kitchen` está deshabilitada intencionalmente en [App.tsx](client/src/App.tsx).

### DB migrations
- Drizzle config: `server/drizzle.config.ts`.
- Para schema changes: editar `server/src/db/schema.ts`, después `npm run db:push` (idempotente).
- Las migraciones en `migrate.ts` corren al startup y son seguras de re-ejecutar (chequean si la columna/tabla existe primero).

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

## Deploy

Guía paso a paso en [DEPLOYMENT.md](DEPLOYMENT.md). Objetivo: Raspberry Pi 5 + SSD USB + systemd, impresora POS-D Basic 200 por Ethernet, Tailscale para acceso remoto del dueño, backup diario por cron.
