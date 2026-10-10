# Seguridad

> Parte de la [documentación de arquitectura](README.md). Snapshot `main` @ `85664bb` (2026-09-23).
> Análisis estático y funcional. No se realizaron pruebas de explotación contra una instancia en ejecución.

## 1. Modelo de amenazas asumido

El servidor corre en una Raspberry Pi dentro de la LAN del local. Los usuarios son empleados con celulares. El dueño accede de forma remota por Tailscale (`DEPLOYMENT.md`, Fase 10). Por eso, los riesgos más relevantes son **internos** (un empleado con más permisos de los que debería) y **de red local** (cualquier dispositivo conectado a la misma WiFi). Si la WiFi del POS es la misma que usan los clientes **no puede determinarse con la evidencia disponible**; `DEPLOYMENT.md` no lo menciona.

## 2. Autenticación

| Aspecto | Implementación | Evidencia |
|---|---|---|
| Credenciales | Usuario + contraseña; `bcryptjs` con costo 10 | `server/src/routes/users.ts:58`, `server/src/routes/auth.ts:22` |
| Política de contraseña | ≥ 8 caracteres en el servidor y la UI (alineadas en H1) | `server/src/schemas/users.ts:3`; `client/src/pages/admin/Users.tsx:229`, `278` |
| Token | JWT (HS256 por defecto de `jsonwebtoken`), 12 h, payload `{id, username, role, name}` | `auth.ts:28-32` |
| Secreto | `JWT_SECRET` obligatorio y ≥ 32 caracteres; si falta, el servidor aborta | `server/src/index.ts:27-36` |
| Almacenamiento en el cliente | `localStorage['mauideskToken']` | `client/src/store/auth.ts:34`, `client/src/api/client.ts:9` |
| Expiración / 401 | El interceptor de axios borra el token y redirige a `/login` | `client/src/api/client.ts:14-23` |
| Socket.io | Mismo JWT en `handshake.auth.token`, validado solo **al conectar** | `index.ts:74-86`, `client/src/api/socket.ts:10-13` |
| Revocación / refresh | **No existe.** `requireAuth` no consulta la BD: inhabilitar, cambiar el rol o cambiar la contraseña no afecta los tokens vigentes. Un socket abierto sigue recibiendo eventos después de expirar el token | `server/src/middleware/auth.ts:19-32` (TD-13) |
| Fuerza bruta | Sin límite de intentos ni bloqueo | `auth.ts:13-35` (TD-15) |
| Cuentas por defecto | `admin/admin123`, `cajero/cajero123`, `mozo1/mozo123`, publicadas en el repo; no se fuerza el cambio | `server/src/db/seed.ts:16-20`, `CLAUDE.md` (TD-15) |
| Cierre de sesión | Solo en el cliente (borra el token) | `client/src/store/auth.ts:38-43` |

## 3. Autorización

Tres roles fijos (`owner`, `cashier`, `waiter`), sin permisos granulares. El servidor aplica `requireRole` por endpoint y el cliente oculta rutas con `ProtectedRoute` (`client/src/App.tsx:36-58`) y el menú de `Layout.tsx:12-20`. **La autorización real es la del servidor**; la de la UI es solo presentación.

### Matriz de permisos efectivos en el servidor

| Operación | owner | cashier | waiter | Observación |
|---|:-:|:-:|:-:|---|
| Ver menú, mesas y pedidos activos | ✓ | ✓ | ✓ | |
| Crear pedido / agregar ítems | ✓ | ✓ | ✓ | Con precio libre (TD-01) |
| **Cancelar pedido / marcar `paid`** | ✓ | ✓ | **✓** | TD-02 |
| Dividir cuenta | ✓ | ✓ | ✓ | La UI no la muestra a mozos (`/cash`) |
| Cobrar (`POST /bills`) | ✓ | ✓ | ✗ | Corregido en H1 |
| Historial de boletas | todo | solo hoy | solo hoy | `bills.ts:37-44` |
| Imprimir boleta arbitraria (`/print/receipt`) | ✓ | ✓ | **✓** | TD-14 |
| Reportes (`/reports/*` GET) | ✓ | ✓ | ✗ | La UI solo lo muestra al dueño |
| Crear gasto | ✓ | ✓ | ✗ | |
| Editar o borrar gasto | ✓ | ✗ | ✗ | Sin UI |
| Administrar menú, mesas y plano | ✓ | ✗ | ✗ | `GET /menu/dishes` también para cashier |
| Administrar usuarios | ✓ | ✗ | ✗ | Impide dejar el sistema sin dueño activo (`users.ts:86-98`) |
| Limpiar cola de impresión | ✓ | ✓ | ✗ | Solo en modo Windows |

**Discrepancias UI ↔ servidor:** el mozo ve "Cobrar" en el POS (`POS.tsx:578-586`), pero `/cash` lo redirige; el cajero tiene acceso a los reportes en la API pero no en la UI; cualquier rol ve "Cancelar pedido".

## 4. Validación de entradas e inyección

| Vector | Estado | Evidencia |
|---|---|---|
| Body | Zod en todos los POST/PATCH con body (`validateBody`), con límites de longitud y rangos | `server/src/schemas/*.ts` |
| Query | Zod en `bills` y `reports` | `bills.ts:32`, `reports.ts:16`, `59`, `71` |
| Parámetros de ruta | Sin validar (`Number()` puede dar `NaN`); el efecto es una consulta vacía, no una inyección | todos los routers |
| Inyección SQL | **No se encontraron vectores.** Drizzle parametriza; las plantillas `sql` solo interpolan referencias a columnas; `migrate.ts` usa SQL estático | `bills.ts:25`, `reports.ts:33-53`, `billing.service.ts:101` |
| Inyección de comandos | `printer.ts` ejecuta PowerShell con `PRINTER_NAME` (variable de entorno, comillas escapadas) y una ruta temporal propia. Solo en modo Windows (desarrollo) | `server/src/utils/printer.ts:78-141`, `187-257` |
| Integridad de datos de negocio | Zod valida la forma, **no** la veracidad: precio, nombre y contenido de lo impreso vienen del cliente | TD-01, TD-14 |

## 5. XSS

- React escapa por defecto y no hay `dangerouslySetInnerHTML` en el cliente.
- **Vulnerable:** `client/src/utils/reportHTML.ts` interpola sin escapar `dishName`, `category`, `description` y `customerName`, y `Reports.tsx:193-200` lo escribe con `document.write` en una ventana `about:blank` del **mismo origen**. Un mozo puede persistir una carga útil en `dishName` o `customerName` (hasta 200 caracteres, `schemas/orders.ts:12`, `22`) que se ejecuta cuando el dueño abre el reporte, con acceso a su token (TD-05).
- **No vulnerable:** el respaldo de impresión de `Cash.tsx:47-67` copia `innerHTML` de un nodo que React ya renderizó escapado.
- No hay Content-Security-Policy (no se usa `helmet` ni se envían cabeceras de seguridad).

## 6. CORS y CSRF

- **CORS:** allowlist desde `ALLOWED_ORIGINS`, con valores de desarrollo por defecto; `*` es opcional y desactiva `credentials` (`index.ts:42-58`). Aplica igual a Socket.io (`index.ts:63-69`). En producción, el cliente se sirve desde el mismo origen (`index.ts:105-113`), por lo que CORS no interviene en el uso normal.
- **CSRF:** no aplica. La autenticación usa un header `Authorization` puesto por JavaScript, no cookies.

## 7. Exposición de información

| Punto | Estado |
|---|---|
| Hash de contraseñas | No se expone (`publicShape` en `users.ts:17-22`; `bills.ts:98` selecciona campos) ✅ |
| Errores no controlados | Página HTML por defecto de Express, con stack si `NODE_ENV≠production`. `DEPLOYMENT.md` define `production` ✅, pero no hay manejador propio (TD-21) |
| Estado de la impresora | `GET /api/print/status` devuelve IP y puerto a cualquier rol (bajo impacto) |
| Datos de clientes de delivery | Nombre, teléfono y dirección visibles para todos los roles en pedidos activos (no hay minimización por rol) |
| Transporte | HTTP sin TLS en la LAN; el tráfico remoto va cifrado por Tailscale. Si la WiFi es compartida, las credenciales viajan en claro dentro de ella |

## 8. Secretos y configuración

- `.env` está en `.gitignore`. El historial de git **no contiene** `.env` ni archivos `.db` (revisado con `git log --all --diff-filter=A`).
- `server/.env.example` solo tiene valores de ejemplo y documenta cómo generar `JWT_SECRET`.
- En los archivos versionados no hay claves ni tokens; las únicas credenciales son las de la seed (TD-15).

## 9. Operaciones críticas: control de acceso

| Operación crítica | Control actual | Suficiente |
|---|---|---|
| Cobrar | Rol owner/cashier + transacción | ⚠️ falta idempotencia (TD-03) |
| Cancelar / cerrar pedido | Solo autenticación | ❌ TD-02 |
| Fijar precio de venta | Ninguno (lo define el cliente) | ❌ TD-01 |
| Cambiar precios del menú | Rol owner | ✅ (sin auditoría, TD-16) |
| Anular boleta | No existe | — (GAP-02) |
| Administrar usuarios | Rol owner + salvaguarda del último dueño | ✅ (sin revocación, TD-13) |
| Borrar gastos | Rol owner | ✅ (borrado físico sin auditoría) |

## 10. Riesgos priorizados

| Riesgo | Severidad | Referencia | Mitigación propuesta |
|---|---|---|---|
| Venta alterada o eliminada por un empleado sin rastro | Crítico | TD-01, TD-02, TD-16 | REC-01, REC-02, REC-07 |
| Escalada mozo → dueño vía XSS en el reporte | Alto | TD-05 | REC-06 |
| Sesiones que sobreviven a la inhabilitación | Medio | TD-13 | REC-06 |
| Credenciales seed y fuerza bruta | Medio | TD-15 | REC-06 |
| Boletas impresas falsificables | Medio | TD-14 | REC-06, REC-12 |
| POS accesible desde la WiFi de clientes | No determinado | — | REC-06 (segmentar la red) |
