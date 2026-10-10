# Testing

> Parte de la [documentación de arquitectura](README.md). Snapshot `main` @ `85664bb` (2026-09-23).

## 1. Herramientas y scripts

| Paquete | Framework | Configuración | Scripts |
|---|---|---|---|
| `server/` | Vitest 4.1.8 (entorno `node`) | `server/vitest.config.ts`: incluye `src/**/*.test.ts`, timeout de 15 s | `test`, `test:watch`, `ci` = `tsc --noEmit && vitest run && eslint src` |
| `client/` | **Ninguno** | — | `ci` = `tsc -b --noEmit && eslint .` |
| raíz | — | — | `ci` = ejecuta el `ci` de server y luego el de client |

- No hay herramienta de cobertura configurada (ni `@vitest/coverage-*` ni `c8`).
- **No hay pipeline de CI** en el repositorio (no existe `.github/workflows` ni equivalente). El "CI" del commit `85664bb` es el script `npm run ci`, que se ejecuta a mano.
- ESLint excluye `src/__tests__/**` en el servidor (`server/eslint.config.mjs:7`).

## 2. Tests existentes

Un único archivo: `server/src/__tests__/billing.test.ts`, que prueba `createBill` de `server/src/services/billing.service.ts` contra un archivo SQLite temporal por test (`__tests__/helpers/db.ts`).

| # | Test | Escenario |
|---|---|---|
| 1 | cobra todos los items en efectivo y cierra la orden | Cobro total, vuelto, número `B001-00001`, orden `paid`, mesa `free` |
| 2 | cobra con yape | Sin `cashReceived` ni `changeAmount` |
| 3 | cobra solo algunos items | Cobro parcial por `itemIds`; la orden sigue abierta |
| 4 | cobra el resto tras un cobro parcial | Segundo cobro cierra la orden; número `B001-00002` |
| 5 | números correlativos en órdenes separadas | Numeración global |
| 6 | cobra un billGroup y lo marca como paid | Sub-cuenta |
| 7 | 404 si la orden no existe | Error de negocio |
| 8 | 400 si no hay items pendientes | Error de negocio |
| 9 | 400 si el efectivo es insuficiente | Pago fallido por monto |
| 10 | 409 si el billGroup ya fue cobrado | Sub-cuenta repetida |
| 11 | BillingError es instancia de Error | Tipo de error |

### Resultado de ejecución (2026-09-23, copia aislada del repo)

| Verificación | Resultado |
|---|---|
| `vitest run` (server) | **11/11 pasan** (~4 s) |
| `tsc --noEmit` (server) | Sin errores |
| `eslint src` (server) | 0 errores · 19 warnings (`no-explicit-any`) |
| `tsc -b --noEmit` (client) | Sin errores |
| `eslint .` (client) | 0 errores · 53 warnings (32 `no-explicit-any`, 10 `react-hooks/set-state-in-effect`, 8 `react-hooks/exhaustive-deps`, 3 `react-refresh/only-export-components`) |

### Limitaciones de la infraestructura de tests
- El DDL de `helpers/db.ts:7-101` se escribe a mano: **no incluye FK** y omite `modifier_groups`, `modifier_options` y `layout_items`, aunque el comentario dice "Refleja exactamente schema.ts" (TD-26). Los tests no detectan violaciones de FK ni se enteran de cambios de esquema.
- Los routers importan `io` desde `index.ts` (TD-20), que arranca el servidor al importarse; por eso **ningún router es testeable** tal como está, y no hay tests HTTP.

## 3. Cobertura por módulo

Estimación por inspección; no hay medición instrumentada.

| Módulo | Archivos | Cobertura |
|---|---|---|
| Cobro (servicio) | `services/billing.service.ts` | Alta en caminos felices y errores de negocio; **sin concurrencia** |
| Cobro (HTTP), boletas, historial | `routes/bills.ts` | Ninguna |
| Pedidos | `routes/orders.ts` | Ninguna |
| División de cuenta (router) | `routes/split.ts` | Ninguna (el test 6 arma los grupos a mano) |
| Menú, mesas, usuarios, auth | `routes/menu.ts`, `tables.ts`, `users.ts`, `auth.ts` | Ninguna |
| Reportes | `routes/reports.ts` | Ninguna |
| Middleware (auth, roles, validación) | `middleware/*.ts` | Ninguna |
| Utilidades | `utils/dates.ts`, `math.ts`, `printer.ts` | Ninguna directa (`sumItems` se ejerce vía cobro) |
| Cliente completo | `client/src/**` | Ninguna |

## 4. Escenarios críticos de un POS

| Escenario | ¿Cubierto? | Notas |
|---|---|---|
| Venta exitosa | ⚠️ Parcial | Solo el cobro en el servicio; la creación del pedido (`POST /orders`) no tiene tests |
| Venta sin stock | N/A | No existe inventario (GAP-05). Tampoco se prueba "plato no disponible", que hoy **no se valida** (TD-01) |
| Venta concurrente | ❌ | Sin tests. Las verificaciones V2 y V5 muestran defectos reales (TD-11, TD-03) |
| Cancelación | ❌ | Sin tests; sin reglas que probar (TD-02) |
| Devolución | N/A | No existe (GAP-02) |
| Pago fallido | ⚠️ Parcial | Efectivo insuficiente ✓, sub-cuenta repetida ✓; `SQLITE_BUSY` ✗; fallo tras el commit ✗ |
| Cierre de caja | N/A | No existe (GAP-01) |
| Diferencias de caja | N/A | No existe (GAP-01) |
| Actualización de inventario | N/A | No existe (GAP-05) |
| Permisos de usuario | ❌ | Ningún test de `requireRole` ni de la matriz de [security.md](security.md#3-autorización) |
| Numeración de boletas | ✅ | Tests 1, 4, 5 (sin colisión concurrente) |
| Cuenta dividida | ⚠️ Parcial | Cobro de sub-cuenta ✓; creación y deshacer de la división ✗ |
| Precio del ítem | ❌ | Sin tests (y sin regla, TD-01) |
| Reportes (totales, top platos, días) | ❌ | Las verificaciones V3 y V4 muestran defectos (TD-09, TD-10) |
| Agregar ítems a pedidos cerrados | ❌ | TD-07 |

## 5. Verificaciones ejecutadas durante el análisis

Para confirmar hallazgos del análisis estático se ejecutó código del repositorio contra bases SQLite temporales, en una **copia aislada** de `server/` fuera del repositorio (con `npm ci`). **Estos scripts no forman parte del repo** ni modificaron el proyecto. Se recomienda convertirlos en tests de regresión ([REC-15](recommendations.md#rec-15--ampliar-la-red-de-tests)).

| ID | Qué se probó | Método | Resultado | Hallazgo |
|---|---|---|---|---|
| V1 | ¿Se aplican las FK con `@libsql/client`? | `PRAGMA foreign_keys` + insert huérfano en tabla con `REFERENCES` | `foreign_keys = 1`; insert rechazado con `SQLITE_CONSTRAINT: FOREIGN KEY constraint failed` | Las FK **sí** se aplican ([data-model.md](data-model.md)) |
| V2 | Dos `createBill` simultáneos sobre la misma orden | `Promise.allSettled` de dos llamadas | 1.ª → `B001-00001`; 2.ª → `SQLITE_BUSY: database is locked`; 1 boleta de S/ 56 | TD-11 |
| V3 | Consulta "top platos" de `reports.ts` con una orden cobrada en 2 boletas (S/ 28 + S/ 8) | Copia literal de la query | Ceviche 2 u. / S/ 56 y Chicha 2 u. / S/ 16 (real: 1 u. c/u; ventas S/ 36) | TD-09 |
| V4 | `date()` de SQLite sobre `paid_at` UTC de una venta a las 20:00 de Lima | `SELECT date('2026-06-06 01:00:00')` | `2026-06-06` (día local real: 2026-06-05) | TD-10 |
| V5 | Segundo cobro cuya transacción arranca después del commit del primero | Proxy que retrasa 50 ms `db.transaction` en la 2.ª llamada | `B001-00001` y `B001-00002` (S/ 112 en total) para un consumo de S/ 56; los ítems apuntan a la boleta 2 | TD-03 |
| V6 | ¿`drizzle-kit push` conserva los índices de `migrate.ts`? | `push` → `applyStartupMigrations()` → `push --verbose` | El 2.º `push` ejecuta `DROP INDEX` de `idx_bills_paid_at`, `idx_order_items_bill_id`, `idx_order_items_order_id` e `idx_orders_table_status` | TD-18 |

## 6. Casos prioritarios sin cobertura

En orden de valor, alineado con [REC-15](recommendations.md#rec-15--ampliar-la-red-de-tests):

1. Regresiones de V2, V3, V4 y V5 (cobro concurrente, top platos, día local).
2. Creación de pedido con precios tomados de la BD y rechazo de platos no disponibles (tras REC-01).
3. Reglas de cancelación y cierre por rol y estado (tras REC-02).
4. Agregar ítems a pedidos cerrados o inexistentes → 404/409.
5. Un solo pedido activo por mesa bajo concurrencia (tras REC-04).
6. Matriz de permisos por endpoint (tests HTTP con `supertest`; requiere separar `createApp()`).
7. Flujo de división de cuenta completo (crear, cobrar una sub-cuenta, agregar ítems, deshacer).
8. `utils/dates.ts` con distintas zonas horarias.
9. Stores del cliente (`orders`, `order`) y cálculo de totales en la UI.
