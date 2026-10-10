# Deuda técnica y problemas detectados

> Parte de la [documentación de arquitectura](README.md). Snapshot del código en `main` @ `85664bb` (análisis del 2026-09-23).
> Los IDs `TD-xx` y `GAP-xx` se usan en todos los documentos. Las soluciones están en [recommendations.md](recommendations.md).

## Criterio de severidad

| Severidad | Criterio |
|---|---|
| **Crítico** | Permite alterar montos de venta o hacer desaparecer ventas **durante la operación normal**, sin herramientas especiales. Rompe la integridad del registro de ventas. |
| **Alto** | Pérdida o corrupción de datos de venta, escalada de privilegios o fallo operativo directo (cocina/caja) bajo condiciones plausibles pero no rutinarias. |
| **Medio** | Datos de reporte incorrectos, fallos con mensaje genérico, riesgos de seguridad con mitigación parcial o deuda que dificulta corregir problemas mayores. |
| **Bajo** | Mantenibilidad, código muerto, inconsistencias menores. |

"Verificado" significa que el comportamiento se reprodujo ejecutando código del repositorio contra una base SQLite temporal (ver [testing.md](testing.md#5-verificaciones-ejecutadas-durante-el-análisis)). El resto proviene de análisis estático.

---

## Estado tras MAUI v1.1

El registro de abajo describe el snapshot analizado (`85664bb`). Esta tabla indica qué se hizo después en la rama `release/maui-v1.1` ([plan](../plan-maui-v1.1.md)). **Resuelto** = corregido y cubierto por tests; **Parcial** = mitigado, con un resto anotado; **Producto** = se resuelve en el nuevo proyecto.

| ID | Estado | Cómo | Commit |
|---|---|---|---|
| TD-01 | Resuelto | Precios y nombres desde el catálogo (`order.service.resolveItems`); `priceAdjustment` aplicado | `d3aa557` |
| TD-02 | Resuelto | `POST /orders/:id/cancel` con rol, motivo y auditoría; `PATCH status` solo `pending`/`paying`; eliminados `DELETE`, `toggle`, `ready` | `97aa093` |
| TD-03 | Resuelto | Lecturas dentro de la transacción + guardia `bill_id IS NULL` + candado; regresiones V2/V5 | `0bb7c9f` |
| TD-04 | Resuelto | Creación en transacción bajo candado, índice único parcial, botones con estado "enviando" | `abd982b` |
| TD-05 | Resuelto | `escapeHtml` en el reporte HTML (verificado con carga XSS) | `c5a448b` |
| TD-06 | Resuelto | `tableNumber` en serializador, comandas, boletas, caja, reportes e historial | `1467f78` |
| TD-07 | Resuelto | Agregar ítems a pedidos cerrados → 409; inexistentes → 404 | `97aa093` |
| TD-08 | Resuelto | `paying` se persiste y llega a todos por socket; el mozo "pide la cuenta" | `97aa093` |
| TD-09 | Resuelto | Top platos por `order_items.bill_id` (regresión V3) | `c27c68f` |
| TD-10 | Resuelto | Serie diaria por día local; `parseDbUtc` en el cliente (regresión V4) | `c27c68f` |
| TD-11 | Resuelto | `withWriteLock` + `withBusyRetry`; `SQLITE_BUSY` residual → 503; WAL | `daf98f5`, `0bb7c9f`, `4aecfa3` |
| TD-12 | Resuelto | `refresh()` al reconectar y al volver la app al frente. **Verificación manual pendiente** | `80e47f4` |
| TD-13 | Parcial | Rol y estado se leen de la BD en cada request y socket; se cortan sockets al cambiar rol. **Falta:** invalidar tokens al cambiar la contraseña (producto) | `2e1a405` |
| TD-14 | Resuelto | Boleta y pre-cuenta armadas en el servidor; eliminados `/print/receipt` y `/print/kitchen` | `cf93109` |
| TD-15 | Parcial | Límite de intentos (429) y aviso de contraseñas por defecto al arrancar. **Falta:** verificar en producción (O1) | `2e1a405`, `4aecfa3` |
| TD-16 | Resuelto | `audit_log` para cancelaciones, gastos, precios, disponibilidad, usuarios y mesas; vista en Reportes | `97aa093`, `b126e19`, `f948b68`, `844133c` |
| TD-17 | Resuelto | Aviso "Sin comanda" y reintento/reimpresión desde el POS | `75e1d49` |
| TD-18 | Parcial | Índices declarados en `schema.ts`, migraciones requeridas fail-fast, `npm run db:migrate`. **Producto:** migraciones versionadas | `9af9aae`, `4aecfa3` |
| TD-19 | Producto | Solo se agregó el índice único parcial (T4); `CHECK` y FK en `bill_id` requieren recrear tablas | — |
| TD-20 | Parcial | Servicios de pedidos, cobro, división, reportes y boleta; `realtime.ts`; `createApp`. **Producto:** menú, mesas y usuarios siguen en routers | `8ef2f8b` … `82c087b` |
| TD-21 | Resuelto | Manejador global de errores en JSON | `daf98f5` |
| TD-22 | Producto | Componentes grandes sin cambios | — |
| TD-23 | Resuelto | División, plano y alta de plato en transacción | `82c087b` |
| TD-24 | Resuelto | Endpoints, dependencias, assets y tipos sin uso eliminados (CRUD de categorías/modificadores se conserva para el producto) | `97aa093`, `6875723` |
| TD-25 | Parcial | `confirm()` reemplazado; Reportes con manejo de errores; "boletas" en vez de "pedidos". **Producto:** `dine_in`/`dine-in`, formato de `updatedAt` | `97aa093`, `c27c68f` |
| TD-26 | Resuelto | Tests con el esquema real (`pushSQLiteSchema`) | `cd79812` |
| TD-27 | Resuelto | Aviso al arrancar + `TZ=America/Lima` en systemd | `4aecfa3` |
| TD-28 | Resuelto | `CLAUDE.md` y `DEPLOYMENT.md` actualizados (O6) | este commit |
| TD-29 | Producto | Montos siguen como `REAL` (sumas redondeadas en reportes) | — |
| TD-30 | Resuelto | `jimp` en devDependencies; `@dnd-kit/*` eliminado | `6875723` |
| TD-31 | Parcial | `priceAdjustment` se aplica. **Producto:** modificadores genéricos, separar "agotado" de "eliminado" | `d3aa557` |
| TD-32 | Producto | Broadcast global | — |
| TD-33 | Producto | N+1 en pedidos activos | — |
| TD-34 | Resuelto | `engines >=22`; guía con Node 24 LTS | `4aecfa3` |

---

## Registro

| ID | Problema | Ubicación | Severidad | Impacto | Evidencia |
|---|---|---|---|---|---|
| TD-01 | El servidor acepta el precio (`unitPrice`) y el nombre (`dishName`) de cada ítem tal como los envía el cliente | `server/src/routes/orders.ts` (POST `/`, POST `/:id/items`), `server/src/schemas/orders.ts` | **Crítico** | Cualquier usuario autenticado (incluido un mozo) puede registrar precios arbitrarios. Los borradores persistidos en el navegador conservan precios viejos después de un cambio de precio | `schemas/orders.ts:10-17`; `orders.ts:139-150` y `177-188` insertan sin consultar `dishes`; `client/src/pages/POS.tsx:113`; `client/src/store/order.ts:32-57` (persist `mauideskOrder`) |
| TD-02 | Cancelar un pedido o cambiar su estado no exige rol, no valida el estado previo y no deja rastro | `server/src/routes/orders.ts` (DELETE `/:id`, PATCH `/:id/status`), `client/src/pages/POS.tsx` | **Crítico** | Un pedido cobrado en efectivo "por fuera" puede cancelarse sin boleta. Un mozo puede marcar `paid` sin cobro. No queda registro de quién ni cuándo | `orders.ts:346-355` (sin `requireRole`, sin chequear boletas ni estado; no actualiza `updatedAt`); `orders.ts:282-307` + `schemas/orders.ts:33-35` (acepta `paid`/`cancelled`); `POS.tsx:361-366` (botón visible para todos los roles) |
| TD-03 | Doble cobro: los ítems se leen **fuera** de la transacción y se marcan con un `UPDATE` sin la condición `bill_id IS NULL` | `server/src/services/billing.service.ts` | **Alto** | Dos boletas por el mismo consumo: ventas infladas y una boleta huérfana sin ítems | `billing.service.ts:41-76` (lectura fuera de la tx), `117-119` (UPDATE sin guardia). **Verificado (V5):** 2 boletas por S/ 112 para un consumo de S/ 56 |
| TD-04 | Pedidos e ítems duplicados por doble toque o por dos mozos simultáneos | `client/src/pages/POS.tsx`, `server/src/routes/orders.ts` | **Alto** | Comandas duplicadas en cocina, ítems cobrados dos veces, dos pedidos activos en la misma mesa | `POS.tsx:283-327` y `562-576` (sin estado "enviando"; los botones siguen activos durante el request); `orders.ts:117-157` (verifica y luego inserta, sin transacción ni índice único) |
| TD-05 | XSS almacenado en el "Reporte" HTML, que permite robar el token del dueño | `client/src/utils/reportHTML.ts`, `client/src/pages/Reports.tsx` | **Alto** | Un mozo puede inyectar HTML/JS en `dishName` o `customerName`. El código se ejecuta en el origen de la app cuando el dueño abre el reporte y puede leer `localStorage` | `reportHTML.ts:77`, `105-106`, `132` (interpolación sin escapar); `Reports.tsx:193-200` (`window.open('')` + `document.write`); `client/src/api/client.ts:9` (token en `localStorage`) |
| TD-06 | La mesa se identifica por `tables.id` en lugar de `tables.number` en la comanda, la boleta, la caja y los reportes | `server/src/utils/printer.ts`, `server/src/routes/orders.ts`, `client/src/pages/Cash.tsx`, `client/src/pages/Reports.tsx` | **Alto** | Cuando `id ≠ number`, la cocina (que no tiene pantalla) recibe la comanda con otra mesa | `printer.ts:356`, `438`, `490`; `orders.ts:30-32`; `Cash.tsx:120`, `393`, `1079`; `Reports.tsx:112`. Divergencia: `tables.ts:101-102` (DELETE físico), AUTOINCREMENT no reutiliza ids y `tables.ts:50-54` asigna número = máximo + 1 |
| TD-07 | Se pueden agregar ítems a pedidos pagados, cancelados o inexistentes | `server/src/routes/orders.ts:173-227` | Medio | Un pedido cerrado vuelve a `pending` y la mesa queda `free` con un pedido activo. Un id inexistente produce un 500 por la FK | No hay `SELECT` previo de la orden; `orders.ts:214` fuerza `status='pending'` |
| TD-08 | El estado "Por cobrar" no persiste y `tables.status` se escribe pero nadie lo lee | `server/src/routes/orders.ts:286-305`, `client/src/store/orders.ts:192-219`, `client/src/pages/Tables.tsx:286-290` | Medio | "Por cobrar" solo se ve un instante en el dispositivo que lo marcó: el `order:updated` siguiente trae `preparing`. Un mozo puede marcarlo y luego es redirigido fuera de `/cash` | `orders.ts:288-289` (`paying` → `preparing`); estado de la mesa derivado de los pedidos (`store/orders.ts:214-219`); `POS.tsx:578-586` + `App.tsx:44-46` |
| TD-09 | "Top platos" multiplica las cantidades cuando un pedido tiene varias boletas | `server/src/routes/reports.ts:30-42` | Medio | Ranking e ingresos por plato inflados en cuentas divididas o cobros parciales. También cuenta ítems aún no cobrados | JOIN por `bills.orderId` en vez de `order_items.bill_id`. **Verificado (V3):** Ceviche 2 u. / S/ 56 cuando se vendió 1 u. / S/ 28 |
| TD-10 | Fechas: la serie diaria se agrupa por día UTC y algunas horas se muestran sin convertir | `server/src/routes/reports.ts:44-53`, `client/src/pages/Reports.tsx:202-203`, `client/src/utils/reportHTML.ts:50`, `Reports.tsx:113` | Medio | Las ventas posteriores a las 19:00 (hora de Lima) caen en el día siguiente. Las horas en Reportes/CSV aparecen desfasadas 5 h | **Verificado (V4):** `date('2026-06-06 01:00:00')` → `2026-06-06` para una venta del 05/06 a las 20:00 locales. `BillsHistory.tsx:50-56` sí agrega `'Z'` (inconsistencia) |
| TD-11 | Las escrituras concurrentes fallan con `SQLITE_BUSY` y devuelven 500 | `server/src/db/index.ts`, `server/src/services/billing.service.ts:96-156`, `server/src/routes/bills.ts:115-123` | Medio | Un cobro que coincide con otra transacción falla con "Error interno". No hay reintento ni `busy_timeout` | **Verificado (V2):** el 2.º cobro concurrente lanza `SQLITE_BUSY: database is locked`; el reintento solo cubre `UNIQUE` (`billing.service.ts:153`) |
| TD-12 | No se resincronizan los pedidos al reconectar el socket | `client/src/store/orders.ts:105-163`, `client/src/api/socket.ts:18` | Medio | Los pedidos creados o cobrados durante un corte de WiFi no aparecen hasta recargar la página | `init()` hace un único `GET /orders/active`; no hay manejador de `connect` que refresque |
| TD-13 | Las sesiones JWT no se pueden revocar durante 12 h | `server/src/middleware/auth.ts:19-32`, `server/src/routes/auth.ts:28-32`, `server/src/index.ts:74-86` | Medio | Un usuario inhabilitado, degradado o con la contraseña cambiada mantiene acceso (HTTP y socket) hasta que el token expira | `requireAuth` no consulta `users`; el rol viaja dentro del token |
| TD-14 | La boleta impresa se arma con datos enviados por el cliente | `server/src/routes/print.ts:62-87`, `client/src/pages/Cash.tsx:69-96` | Medio | Cualquier rol puede imprimir una "boleta" con número y total arbitrarios. La boleta del cobro puede diferir de lo registrado | `schemas/print.ts:3-6` lo reconoce en un comentario; solo la reimpresión usa la BD (`print.ts:90-147`) |
| TD-15 | Login sin límite de intentos; cuentas seed con contraseñas públicas | `server/src/routes/auth.ts:13-35`, `server/src/db/seed.ts:16-20` | Medio | Fuerza bruta sin freno en la LAN. Si no se cambian las cuentas seed, hay acceso inmediato de dueño | Contraseñas publicadas en `CLAUDE.md` y `seed.ts`; no hay rate limiting en `index.ts` |
| TD-16 | Sin auditoría de operaciones sensibles | `server/src/db/schema.ts` (no hay tabla de auditoría) | Medio | No se sabe quién canceló un pedido, cambió un precio, borró un gasto o inhabilitó un usuario | `orders.ts:352` (solo `status`); `reports.ts:109-129`; `menu.ts:129-141`; `users.ts:71-105` |
| TD-17 | Si la comanda falla, no se puede reimprimir desde la UI | `server/src/routes/orders.ts:230-279` (el endpoint existe), `client/src/store/orders.ts:145-162` | Medio | El mozo ve un toast de error pero no tiene botón para reintentar; la cocina no se entera del pedido | Ninguna llamada a `reprint-kitchen` en `client/src`; `kitchenPrinted` no se muestra en ninguna pantalla |
| TD-18 | El esquema tiene dos fuentes de verdad, `db:push` borra índices y el server arranca aunque fallen las migraciones | `server/src/db/migrate.ts`, `server/drizzle.config.ts`, `server/src/index.ts:122-127` | Medio | Faltan índices entre un `db:push` y el siguiente reinicio; el servidor puede arrancar con el esquema incompleto | **Verificado (V6):** un 2.º `drizzle-kit push` ejecuta `DROP INDEX` de los 4 `idx_*`. `drizzle.config.ts:7` apunta a `src/db/migrations`, que no existe |
| TD-19 | La integridad declarativa de la BD es débil | `server/src/db/schema.ts` | Medio | La BD acepta estados, roles y métodos de pago inválidos, montos negativos, `bill_id` inexistentes y dos pedidos activos por mesa | Enums solo en TypeScript (sin `CHECK`, confirmado en el DDL generado); `order_items.bill_id`, `bill_group_id` y `bill_groups.bill_id` sin FK (`schema.ts:101-102`, `110`) |
| TD-20 | La lógica de negocio y el acceso a datos viven en los routers, con dependencia circular con `index.ts` | `server/src/routes/*.ts`, `server/src/index.ts:63` | Medio | Solo el cobro es testeable. La serialización del pedido está duplicada en 3 lugares. Importar un router arranca el servidor | `orders.ts:85-96`, `split.ts:13-26`, `bills.ts:130-137`; `import { io } from '../index'` en orders, split y bills |
| TD-21 | Sin manejador global de errores | `server/src/index.ts` | Bajo | Los errores de BD no controlados devuelven la página HTML por defecto de Express (con stack si `NODE_ENV≠production`) | No hay `app.use((err, req, res, next) => …)`; ej.: violación de FK en `orders.ts:177` |
| TD-22 | Componentes de página sobredimensionados | `client/src/pages/Cash.tsx` (1175 líneas), `Tables.tsx` (1348), `POS.tsx` (595) | Bajo | Difíciles de probar y modificar; la orquestación del cobro está mezclada con la UI | `Cash.tsx` contiene 3 componentes y la lógica de cobro/división |
| TD-23 | Operaciones de varios pasos sin transacción | `server/src/routes/split.ts:122-148`, `tables.ts:121-152`, `menu.ts:90-127` | Bajo | Estado parcial si fallan a mitad (p. ej., decoraciones del plano borradas y no reinsertadas) | Escrituras secuenciales sin `db.transaction` |
| TD-24 | Código, endpoints, dependencias y assets sin uso | Ver [modules.md](modules.md#5-elementos-sin-uso-aparente) | Bajo | Superficie de mantenimiento y de ataque innecesaria | `bills.ts:19-29` (`next-number`), `toggle`/`ready`, CRUD de categorías y modificadores sin UI, `@dnd-kit/*`, `hero.png`, `react.svg`, `vite.svg`, `App.css`, `public/icons.svg` |
| TD-25 | Convenciones inconsistentes | Varios | Bajo | Experiencia de uso irregular | `POS.tsx:331` usa `confirm()` (CLAUDE.md lo prohíbe para `alert`); `Reports.tsx:137-170` sin manejo de errores; `dine_in` vs `dine-in`; `updatedAt` en ISO vs `datetime('now')`; `orderCount` cuenta boletas, no pedidos |
| TD-26 | El helper de tests no replica el esquema real | `server/src/__tests__/helpers/db.ts:7-101` | Bajo | Los tests no detectan violaciones de FK y no incluyen tablas de menú ni de plano | DDL sin `REFERENCES`, aunque el comentario dice "Refleja exactamente schema.ts" |
| TD-27 | Dependencia implícita de la zona horaria del proceso | `server/src/utils/dates.ts`, `server/src/utils/printer.ts`, `server/src/routes/orders.ts:38-41` | Bajo | Si el SO no está en America/Lima, "hoy" y las horas impresas se desplazan | Usa `setHours`/`toLocaleString` locales; la zona horaria solo se fija en el Imager (`DEPLOYMENT.md`, Fase 1) |
| TD-28 | Documentación desalineada con el código | `CLAUDE.md`, `DEPLOYMENT.md`, commit `85664bb` | Bajo | Lleva a decisiones erróneas | `CLAUDE.md` menciona `store/receipt` (eliminado en `e89587d`) y el 409 `RECEIPT_TAKEN` (ya no existe: hoy reintenta ×3 y responde 500). El "CI" del commit es un script, no hay pipeline |
| TD-29 | Dinero almacenado como `REAL` y redondeo parcial | `server/src/db/schema.ts`, `server/src/routes/reports.ts:22-28`, cálculos del cliente | Bajo | Errores de centavos en sumatorias. Hoy está acotado porque los precios son múltiplos de S/ 0.50 | `roundMoney` solo se aplica en `billing.service.ts:80` |
| TD-30 | Dependencias mal ubicadas | `server/package.json` (`jimp`), `client/package.json` (`@dnd-kit/*`), `scripts/generate-pwa-icons.js` | Bajo | Instalación de producción más pesada; el script de la raíz depende de `server/node_modules` | `jimp` solo lo usan `server/scripts/convert-logo.mjs` y `scripts/generate-pwa-icons.js` |
| TD-31 | Semántica ambigua en el menú | `server/src/routes/menu.ts:129-151`, `schema.ts:46` | Bajo | "Borrar" y "agotado" comparten `available=false`; cambiar `hasSpiceLevel` no crea ni borra grupos; `priceAdjustment` nunca se aplica al precio | `menu.ts:146-151`; `POS.tsx:113` usa solo `dish.price` |
| TD-32 | Difusión global de eventos por socket | `io.emit` en `orders.ts`, `split.ts`, `bills.ts` | Bajo | Todos los roles reciben todos los eventos; no hay salas | Reconocido en `CLAUDE.md` |
| TD-33 | Consultas N+1 en `GET /api/orders/active` | `server/src/routes/orders.ts:99-104` | Bajo | 3 consultas por pedido activo | Irrelevante al volumen actual |
| TD-34 | La guía de despliegue instala Node.js 20, fuera de soporte desde abril de 2026, y ningún `package.json` fija `engines` | `DEPLOYMENT.md:102-103`, `package.json` (raíz, server, client) | Bajo | Runtime sin parches de seguridad en producción; versión distinta a la de desarrollo | `setup_20.x` de NodeSource; sin campo `engines` |

---

## Brechas funcionales (no son defectos: funcionalidad ausente)

| ID | Funcionalidad | Estado | Evidencia |
|---|---|---|---|
| GAP-01 | Caja: apertura, cierre, arqueo, movimientos de efectivo, diferencias | No existe | No hay tablas ni endpoints. La pantalla "Caja" (`client/src/pages/Cash.tsx`) es solo el cobro |
| GAP-02 | Anulación de boletas, devoluciones, notas de crédito | No existe | No hay endpoint que modifique o anule `bills` |
| GAP-03 | Descuentos, cortesías, propinas | No existe | `bills.subtotal` = `bills.total` (`billing.service.ts:108-109`) |
| GAP-04 | Impuestos (IGV) y comprobante electrónico | No existe; **aplicabilidad legal no determinada con la evidencia disponible** | La "boleta" es un ticket interno (`printer.ts:335-400`); no hay RUC, IGV ni integración con SUNAT |
| GAP-05 | Inventario, stock, kardex | No existe | Ninguna tabla de stock; `dishes` no tiene cantidad |
| GAP-06 | Clientes | No existe | Solo `customer_name/phone/address` en `orders` para delivery |
| GAP-07 | Configuración del negocio | Hardcodeada | Nombre y ciudad en `printer.ts:345-347`; serie `B001` en `billing.service.ts:104`; métodos de pago como enum en código |
| GAP-08 | UI de categorías, modificadores y edición/borrado de gastos | Solo backend | Endpoints en `menu.ts:50-87`, `163-186` y `reports.ts:109-129` sin llamadas desde `client/src` |
| GAP-09 | Reportes por usuario/cajero y de utilidad (margen) | No existe | `reports.ts` agrega solo por período y método de pago; "Balance neto" = ventas − gastos (`Reports.tsx:173`) |

---

## Detalle de los problemas críticos y altos

### TD-01 — Precios definidos por el cliente
- **Problema:** `OrderItemInputSchema` exige `unitPrice` y `dishName` en el body, y el handler los inserta tal cual. El `dishId` solo se valida por FK (que exista), no por disponibilidad ni por precio.
- **Evidencia:** `server/src/schemas/orders.ts:10-17`, `server/src/routes/orders.ts:139-150`, `177-188`, `client/src/pages/POS.tsx:113`, `client/src/store/order.ts:56`.
- **Impacto:** el total cobrado (`billing.service.ts:80`) se calcula sobre esos precios. Un mozo con las devtools del navegador puede cobrar un ceviche a S/ 0.01. Sin mala fe también ocurre: si el dueño cambia un precio, el borrador persistido en `localStorage` o un POS abierto hace horas envía el precio viejo.
- **Riesgo:** probabilidad media (el borrador obsoleto es un caso realista); impacto directo sobre los ingresos.
- **Solución:** [REC-01](recommendations.md#rec-01--precios-autoritativos-en-el-servidor).

### TD-02 — Cancelación y cierre sin control
- **Problema:** `DELETE /api/orders/:id` y `PATCH /api/orders/:id/status` solo exigen estar autenticado. No verifican si el pedido tiene boletas, si ya está `paid`, ni siquiera si existe (responde 204 igual). `PATCH status=paid` cierra el pedido sin boleta. No se registra quién canceló ni por qué.
- **Evidencia:** `server/src/routes/orders.ts:282-307`, `346-355`; `server/src/schemas/orders.ts:33-35`; botón "Cancelar pedido" para todos los roles en `client/src/pages/POS.tsx:361-366`, confirmado con `confirm()` nativo (`POS.tsx:331`).
- **Impacto:** los reportes suman `bills`, así que una venta cancelada o cerrada sin boleta no existe contablemente. Es el vector clásico de fraude interno en un POS ("cobro en efectivo y anulo").
- **Riesgo:** probabilidad media (no requiere conocimientos técnicos); impacto alto y sin trazabilidad.
- **Solución:** [REC-02](recommendations.md#rec-02--máquina-de-estados-del-pedido-y-control-de-cancelaciones) y [REC-07](recommendations.md#rec-07--registro-de-auditoría).

### TD-03 — Doble cobro por lecturas obsoletas
- **Problema:** `createBill` resuelve `targetItems` y el estado del grupo **antes** de `db.transaction`. Dentro de la transacción, `UPDATE order_items SET bill_id = ? WHERE id IN (…)` no exige `bill_id IS NULL` ni comprueba cuántas filas cambió.
- **Evidencia:** `server/src/services/billing.service.ts:41-78`, `117-119`. Verificación V5: con la segunda transacción iniciando después del commit de la primera, se crean `B001-00001` y `B001-00002` (S/ 112 en total) para un consumo de S/ 56; los ítems quedan apuntando a la boleta 2 y la boleta 1 queda huérfana.
- **Impacto:** ventas infladas en reportes y en el total por método de pago; un número de boleta consumido sin ítems.
- **Riesgo:** probabilidad baja (requiere dos cobros del mismo pedido casi simultáneos: dueño y cajero en `/cash`, o reintento manual con el primer request aún en curso); el botón ya se protege contra doble clic (`Cash.tsx:621-629`). Impacto crítico.
- **Solución:** [REC-03](recommendations.md#rec-03--cobro-atómico-e-idempotente).

### TD-04 — Pedidos e ítems duplicados
- **Problema:** "Enviar a cocina" y "Agregar a pedido existente" no tienen estado de envío ni se deshabilitan durante el request. En el servidor, la regla de "un pedido activo por mesa" es un `SELECT` seguido de un `INSERT` sin transacción, y no existe restricción en la BD.
- **Evidencia:** `client/src/pages/POS.tsx:283-327`, `562-576`; `server/src/routes/orders.ts:117-157`.
- **Impacto:** un doble toque en el celular produce dos comandas y ítems duplicados que luego se cobran. Dos requests casi simultáneos sobre la misma mesa pueden crear dos pedidos activos: `getTableOrder` solo muestra el primero (`store/orders.ts:221`), así que el segundo queda "invisible" en Mesas pero aparece en Caja.
- **Riesgo:** probabilidad media (uso táctil en celulares con WiFi lento); impacto en cocina y en el monto cobrado.
- **Solución:** [REC-04](recommendations.md#rec-04--creación-de-pedidos-sin-duplicados).

### TD-05 — XSS en el reporte HTML
- **Problema:** `generateReportHTML` interpola strings de usuario sin escapar y el resultado se escribe con `document.write` en una ventana `about:blank` abierta por la app, que hereda el origen.
- **Evidencia:** `client/src/utils/reportHTML.ts:77` (`d.dishName`), `105-106` (`e.category`, `e.description`), `132` (`b.customerName`); `client/src/pages/Reports.tsx:193-200`. `dishName` y `customerName` los controla cualquier mozo (`server/src/schemas/orders.ts:12`, `22`).
- **Impacto:** ejecución de JS con acceso a `localStorage.mauideskToken` del dueño, es decir, escalada de mozo a dueño.
- **Riesgo:** probabilidad baja (requiere intención); impacto alto.
- **Solución:** [REC-06](recommendations.md#rec-06--endurecimiento-de-seguridad).

### TD-06 — Número de mesa incorrecto en comandas y boletas
- **Problema:** la API entrega `tableId` y todas las salidas imprimen o muestran `Mesa ${tableId}`. El número visible de la mesa es `tables.number`. Hoy coinciden solo porque el seed crea las mesas 1–15 con ids 1–15.
- **Evidencia:** `server/src/utils/printer.ts:356`, `438`, `490`; `server/src/routes/orders.ts:30-32`; `client/src/pages/Cash.tsx:120`, `393`, `1079`; `client/src/pages/Reports.tsx:112`. En cambio, `POS.tsx:357` y `Tables.tsx:1087` usan `number` correctamente.
- **Impacto:** al borrar una mesa sin historial y crear otra (flujo habitual del editor de plano), la mesa "15" obtiene el id 16 y la comanda sale como "MESA 16". Como la cocina no tiene pantalla, el plato se entrega en la mesa equivocada.
- **Riesgo:** probabilidad media (en cuanto el dueño edita mesas); impacto operativo directo.
- **Solución:** [REC-05](recommendations.md#rec-05--identificar-la-mesa-por-su-número).

---

## Estado de los hallazgos del análisis anterior

Existe un análisis previo en la rama remota `docs/analisis-y-roadmap` (commit `d9c40e4`, basado en `24edfa9`), **no fusionado a `main`**. Estado actual de sus hallazgos:

| Hallazgo previo | Estado en `85664bb` |
|---|---|
| P1: número de boleta generado en el cliente | **Resuelto** en `e89587d` (se genera en el servidor, dentro de la transacción) |
| P2: definición de "hoy" inconsistente | **Parcial**: los límites de día están unificados en `utils/dates.ts`, pero la serie diaria sigue en UTC (TD-10) |
| P3: `POST /bills` sin rol | **Resuelto** para cobros; las mutaciones de pedidos siguen sin rol (TD-02) |
| P4: lógica en controladores | **Parcial**: solo se extrajo `billing.service.ts` (TD-20) |
| P5: montos como `real` | Abierto (TD-29) |
| P6: broadcast global | Abierto (TD-32) |
| P7: impresión con datos del cliente | Abierto (TD-14) |
| P8: sin índices | **Resuelto** en `85664bb`, pero `db:push` los elimina (TD-18) |
| Duda sobre si las FK se aplican | **Aclarada:** `@libsql/client` activa `PRAGMA foreign_keys=1` y rechaza huérfanos (verificación V1) |
| Sin tests | **Parcial**: 11 tests del servicio de cobro ([testing.md](testing.md)) |
