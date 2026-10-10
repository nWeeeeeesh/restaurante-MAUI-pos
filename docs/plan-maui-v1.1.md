# Plan MAUI v1.1 — dejar MAUI estable antes de crear el producto

> **Objetivo:** corregir lo crítico de MAUI, dejarlo en "modo mantenimiento" y etiquetar `maui-v1.1` como punto de partida del producto POS. Referencias `TD-xx` / `GAP-xx`: [architecture/technical-debt.md](architecture/technical-debt.md). Contexto de la decisión: separar ahora y reunificar después (MAUI será el primer cliente del producto).
>
> **Cómo usar este documento:** las tareas se ejecutan en el orden indicado. Cada una tiene casillas que se marcan al terminarla, archivos a tocar, cambios concretos, criterios de aceptación y notas de implementación. Las decisiones de negocio pendientes están en la [sección 2](#2-decisiones); mientras no se confirmen, se usan los valores por defecto.

## Estado de ejecución (2026-10-09)

Rama `release/maui-v1.1`. Estado detallado por problema en [technical-debt.md → Estado tras MAUI v1.1](architecture/technical-debt.md#estado-tras-maui-v11).

| Bloque | Estado |
|---|---|
| Fase 0 (P1, P3–P7) | ✅ Hecho |
| Fase 1–3 (T1–T12) | ✅ Hecho, con tests |
| Fase 4 (M1–M11) | ✅ Hecho (M8 quedó dentro de T8) |
| O6 documentación | ✅ Hecho |
| `npm run ci` | ✅ Verde: 102 tests, `tsc` y ESLint sin errores |
| Prueba de humo contra servidor real | ✅ 18/18 pasos (BD sembrada, sin impresora) |
| **P2** revisión de datos de producción | ⏳ Necesita una copia del backup de la Pi |
| **Verificación manual en dispositivos** | ⏳ T4 (doble toque), T6 (impresora apagada/encendida), T7 (corte de WiFi), D2 (pedir cuenta), M10/M11 en pantalla |
| **O1–O5** (contraseñas, SSD, backup externo + restauración, UPS/Tailscale, despliegue) | ⏳ Del lado del usuario, con el procedimiento de `DEPLOYMENT.md` |
| **O7** merge a `main` + etiqueta `maui-v1.1` | ⏳ Tras el despliegue y una jornada sin incidentes |

## 0. Leyenda y reglas

| Marca | Significado |
|---|---|
| 🔴 **Corregir** | Obligatorio para cerrar v1.1. Afecta dinero, operación o seguridad |
| 🟡 **Mejorar** | Recomendado en v1.1 porque es barato y reduce riesgo o trabajo futuro. Si se complica, pasa al producto |
| 🔧 **Habilitador** | No corrige un defecto por sí solo, pero es prerrequisito para corregir y probar los demás |
| ⚪ **Producto** | **No se toca en MAUI.** Se resuelve en el nuevo proyecto |

**Reglas para todas las tareas**
1. **Test primero:** un test que reproduce el defecto (falla), luego la corrección (pasa). Excepción: UI sin infraestructura de tests → verificación manual descrita en la tarea.
2. **Cambios de BD solo aditivos:** tablas, índices o valores nuevos. Nada de recrear tablas, `CHECK` ni renombrar columnas. Así, volver a la versión anterior del código funciona con la BD nueva (rollback sin restaurar datos).
3. **Nunca `npm run db:push` en producción.** Los cambios de esquema se aplican con `migrate.ts` al arrancar y también se declaran en `schema.ts`.
4. **Convenciones del repo** (`CLAUDE.md`): comentarios en español que explican el *porqué*, sin punto y coma, `validateBody` con Zod, toasts (nunca `alert`/`confirm`), dinero dentro de transacciones.
5. **Rama `release/maui-v1.1`**, un commit por tarea con formato `fix(v1.1): T1 cobro atómico (TD-03, TD-11)`. Antes de cada commit, `npm run ci` en verde.
6. **Fuera de alcance:** todo lo ⚪. Si una tarea empieza a pedir UUIDs, multi-tenant, temas, modificadores genéricos o refactor de `Cash.tsx`/`Tables.tsx`, se detiene y se anota para el producto.

## 1. Resumen

| Fase | Tareas | Tipo |
|---|---|---|
| 0. Preparación | P1 docs · P2 datos de producción · P3 esquema real en tests · P4 realtime + serializador · P5 candado de escritura + errores · P6 `createApp` + tests HTTP · P7 índices en el esquema | 🔧 / 🔴 |
| 1. Dinero | T1 cobro atómico · T2 precios desde la BD · T3 estados y cancelación · T4 pedidos sin duplicados | 🔴 |
| 2. Operación | T5 número de mesa · T6 reimprimir comanda · T7 resincronizar · T8 boleta desde la BD | 🔴 |
| 3. Reportes y seguridad | T9 reportes correctos · T10 XSS · T11 sesiones y login · T12 permisos de gastos, reportes y agotados | 🔴 / 🟡 |
| 4. Mejoras baratas | M1 … M11 | 🟡 |
| 5. Cierre | O1 … O7 | 🔴 / 🟡 |

### Clasificación de todos los problemas registrados

| ID | Problema (resumen) | Clasificación | Tarea |
|---|---|---|---|
| TD-01 | Precio y nombre los define el cliente | 🔴 Corregir | T2 |
| TD-02 | Cancelar/cerrar pedidos sin rol ni rastro | 🔴 Corregir | T3 |
| TD-03 | Doble cobro por lecturas fuera de la tx | 🔴 Corregir | T1 |
| TD-04 | Pedidos e ítems duplicados | 🔴 Corregir | T4 |
| TD-05 | XSS en reporte HTML | 🔴 Corregir | T10 |
| TD-06 | Se imprime `tables.id` en vez del número | 🔴 Corregir | T5 |
| TD-07 | Agregar ítems a pedidos cerrados | 🔴 Corregir | T3 |
| TD-08 | "Por cobrar" no persiste | 🔴 Corregir (va con la máquina de estados) | T3 |
| TD-09 | Top platos sobrecuenta | 🔴 Corregir | T9 |
| TD-10 | Serie diaria en UTC, horas desfasadas | 🔴 Corregir | T9 |
| TD-11 | `SQLITE_BUSY` → 500 | 🔴 Corregir | P5 + T1 |
| TD-12 | Sin resincronización al reconectar | 🔴 Corregir | T7 |
| TD-13 | Sesiones irrevocables | 🟡 Mejorar | T11 |
| TD-14 | Boleta impresa con datos del cliente | 🔴 Corregir | T8 |
| TD-15 | Login sin límite + contraseñas seed | 🔴 verificar en producción (O1) · 🟡 límite de intentos (T11) | O1, T11 |
| TD-16 | Sin auditoría | 🔴 cancelaciones (T3) · 🟡 resto (M3) | T3, M3 |
| TD-17 | Comanda fallida sin reimpresión en la UI | 🔴 Corregir | T6 |
| TD-18 | Dos fuentes de esquema; `push` borra índices | 🔴 índices en el esquema (P7) · 🟡 migraciones fail-fast (M6) | P7, M6 |
| TD-19 | Sin `CHECK` ni FK en `bill_id` | ⚪ Producto (requiere recrear tablas) | — |
| TD-20 | Lógica en routers, import circular | 🔧 solo lo necesario (P4, P6, `order.service`) · ⚪ el resto | P4, P6, T2–T4 |
| TD-21 | Sin manejador global de errores | 🔧 (lo necesitan los nuevos 409/503) | P5 |
| TD-22 | Componentes gigantes | ⚪ Producto | — |
| TD-23 | Multi-paso sin transacción | 🟡 Mejorar | M1 |
| TD-24 | Código y assets sin uso | 🟡 Mejorar (toggle/ready se eliminan en T3) | T3, M2 |
| TD-25 | Convenciones inconsistentes | 🔴 `confirm()` (T3) y errores de Reportes (T9) · ⚪ `dine_in`/`dine-in` | T3, T9 |
| TD-26 | Helper de tests sin el esquema real | 🔧 Habilitador | P3 |
| TD-27 | Dependencia implícita de zona horaria | 🟡 Mejorar | M4 |
| TD-28 | Documentación desalineada | 🔴 al cierre | O6 |
| TD-29 | Dinero como `REAL` | ⚪ Producto | — |
| TD-30 | Dependencias mal ubicadas | 🟡 Mejorar | M2 |
| TD-31 | Semántica del menú (`priceAdjustment`, etc.) | 🔴 `priceAdjustment` se aplica en T2 · ⚪ modificadores genéricos | T2 |
| TD-32 | Broadcast global | ⚪ Producto | — |
| TD-33 | N+1 en pedidos activos | ⚪ Producto | — |
| TD-34 | Node 20 fuera de soporte | 🟡 Mejorar | M7 |
| GAP-01…09 | Caja, anulaciones, descuentos, SUNAT, inventario, clientes, configuración, UI faltante, reportes por usuario | ⚪ Producto | — |

---

## 2. Decisiones

### De negocio (confirmar con el cliente; mientras tanto se usa el valor por defecto)

| ID | Pregunta | Valor por defecto | Afecta |
|---|---|---|---|
| D1 | ¿Quién puede cancelar un pedido? | ✅ **Confirmado:** sin cobros → cajero, encargado o dueño; con cobros → **encargado o dueño**. Siempre con motivo obligatorio. El mozo no cancela (le pide al cajero). Si el dueño está fuera y no hay encargado, el dueño cancela por Tailscale | T3 |
| D2 | ¿Qué hace el botón "Cobrar" del mozo? | El mozo ve **"Pedir cuenta"**: marca la mesa "Por cobrar" y vuelve a Mesas. Cajero, encargado y dueño ven "Cobrar" (marca y va a Caja) | T3 |
| D3 | Si un plato se agotó entre que se armó el pedido y se envió | Se rechaza el envío completo (409) indicando qué platos están agotados; el POS los quita del borrador y el mozo reenvía | T2 |
| D4 | ¿Quién puede reimprimir la comanda? | Todos los roles | T6 |
| D5 | Rol **Encargado** (`manager`) para cuando el dueño delega el local | ✅ **Confirmado.** Encargado = cajero + cancelar pedidos con cobros + gastos + reportes e historial completos + marcar platos agotados. **No** administra usuarios ni cambia precios | T3, T12 |
| D6 | ¿Quién registra gastos? | ✅ **Confirmado:** solo encargado y dueño registran, corrigen o borran gastos (correcciones y borrados con motivo y registro). El cajero solo maneja ingresos. **Regla operativa:** solo se paga desde el cajón con autorización del encargado; si la cajera paga en una urgencia, guarda el comprobante y el encargado lo registra ese mismo día. En el producto: "solicitud de egreso" del cajero con aprobación | T12 |

**Matriz de permisos resultante (v1.1)**

| Acción | Mozo | Cajero | Encargado | Dueño |
|---|:-:|:-:|:-:|:-:|
| Tomar pedidos, agregar ítems, pedir cuenta, reimprimir comanda | ✓ | ✓ | ✓ | ✓ |
| Cobrar, dividir cuenta, pre-cuenta, reimprimir boleta | ✗ | ✓ | ✓ | ✓ |
| Cancelar pedido sin cobros | ✗ | ✓ | ✓ | ✓ |
| Cancelar pedido con cobros | ✗ | ✗ | ✓ | ✓ |
| Registrar, corregir o borrar gastos | ✗ | ✗ | ✓ | ✓ |
| Historial de boletas | hoy | hoy | completo | completo |
| Reportes | ✗ | ✗ | ✓ | ✓ |
| Marcar platos agotados | ✗ | ✗ | ✓ | ✓ |
| Precios y altas/bajas del menú, mesas y plano, usuarios | ✗ | ✗ | ✗ | ✓ |

### Técnicas (tomadas, con evidencia)

| ID | Decisión | Motivo |
|---|---|---|
| DT1 | Serializar las escrituras con un **candado en memoria** (`withWriteLock`) en vez de `busy_timeout` | Verificado: `PRAGMA busy_timeout` se pierde tras cada transacción, porque `@libsql/client` entrega la conexión a la transacción y abre otra nueva sin el pragma. Un solo proceso Node → un mutex es suficiente y determinista |
| DT2 | Cancelar pasa de `DELETE /api/orders/:id` a `POST /api/orders/:id/cancel` con `{ reason }` | Un body en `DELETE` es frágil; el endpoint viejo se elimina para que no quede una vía sin controles |
| DT3 | `paying` se guarda tal cual en `orders.status` | La columna no tiene `CHECK` (verificado en el DDL): es solo un cambio de tipo en TS, sin migración |
| DT4 | Índice único parcial "un pedido activo por mesa" como defensa adicional; si falla al crearse por datos duplicados, se registra una advertencia y se sigue | Con el candado y la transacción, la verificación en la app ya no tiene carrera; el índice es una segunda barrera. No debe impedir que el local arranque |
| DT5 | Migraciones fail-fast (M6) solo junto con el procedimiento de despliegue de O5 | Arrancar sin `audit_log` provocaría 500 en cancelaciones; con el procedimiento, un fallo se detecta antes de abrir |

---

## 3. Fase 0 — Preparación

### P1 · Versionar la documentación 🔧
- [x] Crear la rama `release/maui-v1.1` desde `main`.
- [x] Commit de `docs/architecture/` y de este plan (con autorización del usuario).

### P2 · Revisar los datos de producción (solo lectura) 🔴
Objetivo: saber si los defectos **ya causaron daño** antes de corregir. Requiere una copia del último backup de la Pi; **no se commitea** (`*.db` ya está en `.gitignore`) y se trata como confidencial (contiene datos de clientes de delivery).

```sql
-- Abrir en solo lectura: sqlite3 -readonly copia.db
-- 1. Boletas sin ítems (posible doble cobro histórico, TD-03)
SELECT b.id, b.receipt_number, b.total, b.paid_at FROM bills b
WHERE NOT EXISTS (SELECT 1 FROM order_items i WHERE i.bill_id = b.id);
-- 2. Pedidos "pagados" sin ninguna boleta (cerrados por PATCH, TD-02)
SELECT o.id, o.updated_at FROM orders o
WHERE o.status = 'paid' AND NOT EXISTS (SELECT 1 FROM bills b WHERE b.order_id = o.id);
-- 3. Pedidos cancelados que tenían cobros (TD-02)
SELECT DISTINCT o.id FROM orders o JOIN bills b ON b.order_id = o.id WHERE o.status = 'cancelled';
-- 4. Mesas con más de un pedido activo (TD-04) → limpiar ANTES de desplegar T4
SELECT table_id, COUNT(*) FROM orders
WHERE table_id IS NOT NULL AND status NOT IN ('paid','cancelled') GROUP BY table_id HAVING COUNT(*) > 1;
-- 5. Pedidos activos sin ítems (falla a mitad de POST /orders)
SELECT o.id FROM orders o WHERE o.status NOT IN ('paid','cancelled')
AND NOT EXISTS (SELECT 1 FROM order_items i WHERE i.order_id = o.id);
-- 6. Mesas con id ≠ número (impacto real de TD-06)
SELECT id, number, active FROM tables WHERE id <> number;
-- 7. Distribución de estados (valores heredados preparing/ready)
SELECT status, COUNT(*) FROM orders GROUP BY status;
-- 8. Precios cobrados distintos al menú vigente (indicio de TD-01; puede ser un cambio de precio legítimo)
SELECT i.dish_name, i.unit_price, d.price FROM order_items i JOIN dishes d ON d.id = i.dish_id
WHERE i.unit_price <> d.price GROUP BY i.dish_id, i.unit_price;
-- 9. Modo de journal real (DT1 / M5)
PRAGMA journal_mode;
```
- [ ] Ejecutar las consultas y anotar los resultados en este documento (sección 8).
- [ ] Si la 1, 2 o 3 devuelven filas: informar al dueño, porque los reportes históricos están afectados.
- [ ] Si la 4 devuelve filas: definir con el cajero qué pedido queda activo antes de desplegar.

### P3 · Esquema real en los tests (TD-26) 🔧
**Archivos:** `server/src/__tests__/helpers/db.ts`, `server/src/db/migrate.ts`.
- [x] `createTestDb()` crea el esquema desde `schema.ts` con `pushSQLiteSchema` de `drizzle-kit/api` (verificado que existe en 0.31.10). Alternativa si la firma no encaja: `generateSQLiteMigration(generateSQLiteDrizzleJson({}), generateSQLiteDrizzleJson(schema))` y ejecutar las sentencias.
- [x] `applyStartupMigrations(client?)` acepta un cliente por parámetro (hoy crea el suyo desde `DATABASE_URL`) para poder aplicarlo en tests.
- [x] Borrar el DDL escrito a mano.

**Aceptación:** los 11 tests actuales pasan; un test nuevo comprueba que insertar un `order_item` con `order_id` inexistente falla por FK.

### P4 · `realtime.ts` y serializador único (TD-20 parcial) 🔧
**Archivos:** nuevo `server/src/realtime.ts`; nuevo `server/src/services/order.serializer.ts`; `index.ts`, `routes/orders.ts`, `routes/split.ts`, `routes/bills.ts`.
- [x] `realtime.ts`: `setIo(io)`, `emit(event, payload)` (no hace nada si no hay `io`, útil en tests) y `disconnectUser(userId)` (para T11).
- [x] `index.ts` llama a `setIo(io)`; los routers importan `emit` desde `../realtime`. **Ningún archivo importa `../index`.**
- [x] `getFullOrder(db, orderId)` único: pedido + ítems (modificadores parseados) + sub-cuentas + **`tableNumber`** (JOIN con `tables`). Reemplaza `orders.ts:85-96`, `split.ts:13-26` y `bills.ts:130-137`.

**Aceptación:** `tsc` limpio; test del serializador con una mesa de id 16 y número 15 → `tableNumber = 15`.

### P5 · Candado de escritura y manejador de errores (TD-11, TD-21) 🔧
**Archivos:** nuevo `server/src/db/write-lock.ts`; nuevo `server/src/errors.ts`; `index.ts`; `services/billing.service.ts`.
- [x] `withWriteLock(fn)`: mutex basado en una cadena de promesas, más reintento ante `SQLITE_BUSY` (3 intentos con 50/100/200 ms) como defensa para escrituras que no pasen por el candado.
- [x] `DomainError(message, statusCode, code?, details?)`; `BillingError` pasa a extenderla (sin romper los tests actuales).
- [x] Manejador global al final de `index.ts`: `DomainError` → `{error, code, details}` con su status; `SQLITE_BUSY` → 503 `{error:'Servidor ocupado, reintenta', code:'DB_BUSY'}`; resto → 500 `{error:'Error interno'}`, con el detalle solo en el log.

**Aceptación:** test de que dos funciones bajo `withWriteLock` no se solapan; test de reintento ante un error `SQLITE_BUSY` simulado.

### P6 · `createApp()` y tests HTTP (TD-20 parcial) 🔧
**Archivos:** nuevo `server/src/app.ts`; `index.ts`; `server/package.json` (`supertest`, `@types/supertest` como devDependencies).
- [x] `app.ts` exporta `createApp()` (CORS, JSON, routers, manejador de errores) sin `listen` ni migraciones. `index.ts` queda como bootstrap: valida el entorno, crea el server e `io`, migra y escucha.
- [x] El `db` sigue siendo un singleton. Para tests HTTP, `DATABASE_URL` apunta a un archivo temporal antes de importar `app`; documentar el patrón en el helper.
- [x] Helper `tokenFor(role)` que firma un JWT de prueba (`JWT_SECRET` de prueba en el setup de Vitest).

**Aceptación:** test HTTP de humo (`GET /api/health` 200, `GET /api/orders/active` sin token → 401).

### P7 · Índices declarados en el esquema (TD-18 parcial) 🔴
**Archivos:** `server/src/db/schema.ts`, `server/src/db/migrate.ts`.
- [x] Declarar en `schema.ts` los 4 índices de `migrate.ts:42-52` con los **mismos nombres**.
- [x] `migrate.ts` los sigue creando con `IF NOT EXISTS` (para BDs existentes).

**Aceptación:** repetir la verificación V6 (`push` → migrar → `push --verbose`): el 2.º `push` **no** propone `DROP INDEX`.

---

## 4. Fase 1 — Dinero

### T1 · Cobro atómico (TD-03, TD-11) 🔴
**Archivos:** `server/src/services/billing.service.ts`, `server/src/routes/bills.ts`, `server/src/__tests__/billing.test.ts`.
- [x] Test rojo V5: segunda transacción iniciada tras el commit de la primera → hoy crea 2 boletas.
- [x] Test rojo V2: dos cobros simultáneos → hoy `SQLITE_BUSY`.
- [x] Todo `createBill` corre dentro de `withWriteLock(() => db.transaction(tx => …))`. **Las lecturas** (pedido, sub-cuenta, ítems) se hacen con `tx`, dentro de la transacción.
- [x] Rechazar pedidos `paid` o `cancelled` → 409.
- [x] `UPDATE order_items SET bill_id = ? WHERE id IN (…) AND bill_id IS NULL RETURNING id`; si la cantidad devuelta ≠ `targetItems.length` → `BillingError 409 'ITEMS_ALREADY_BILLED'` (rollback).
- [x] El resultado incluye los ítems cobrados y `tableNumber` (los usa T8).
- [x] `bills.ts` emite eventos con `realtime.emit` + `getFullOrder`.

**Aceptación:** V2 y V5 → exactamente 1 boleta y suma de boletas = consumo; un pedido cancelado → 409; los 11 tests originales siguen pasando.

### T2 · Precios desde la BD (TD-01, `priceAdjustment` de TD-31) 🔴
**Archivos:** nuevo `server/src/services/order.service.ts` (función `resolveItems`), `server/src/schemas/orders.ts`, `server/src/routes/orders.ts`, `client/src/pages/POS.tsx`, `client/src/store/order.ts`, `client/src/store/orders.ts`.
- **Servidor**
  - [x] `OrderItemInputSchema` = `{ dishId, quantity, modifiers?: [{ groupId, optionId?, freeText? }], notes? }`. Se elimina `unitPrice`/`dishName`; Zod descarta claves extra, así que una pestaña con el bundle viejo sigue funcionando.
  - [x] `resolveItems(tx, items)`: carga platos, grupos y opciones con `inArray`. Plato inexistente o `available=false` → `DomainError 409 'DISH_UNAVAILABLE'` con `details.dishes` (D3).
  - [x] Validaciones: la opción pertenece al grupo y el grupo al plato → si no, 400. Grupo `required` sin opción → 400. Grupo con `multiple=false` y más de una opción → 400.
  - [x] `unitPrice = roundMoney(dish.price + Σ priceAdjustment)`, `dishName = dish.name`, `modifiers` armados desde la BD con la misma forma de hoy (`{groupId, groupName, optionId, optionName}` / `{groupId, groupName, freeText}`).
- **Cliente**
  - [x] Enviar solo `dishId`, `quantity`, `modifiers` (`groupId`, `optionId`, `freeText`) y `notes`.
  - [x] Al cargar el menú en el POS, sincronizar el borrador: actualizar `unitPrice`/`dishName` y quitar los platos que ya no estén, con un toast.
  - [x] Manejar el 409 `DISH_UNAVAILABLE`: toast con los nombres y quitarlos del borrador.

**Aceptación (tests de servicio y HTTP):** un precio manipulado en el body → se guarda el precio de la BD; plato no disponible → 409; opción de otro plato → 400; falta el picante obligatorio → 400; `priceAdjustment` se suma. **Manual:** crear un pedido desde el POS y verificar precios y modificadores en la comanda.

### T3 · Máquina de estados, cancelación controlada y auditoría mínima (TD-02, TD-07, TD-08, TD-16 parcial) 🔴
**Archivos:** `server/src/db/schema.ts` + `migrate.ts` (tabla `audit_log`), `server/src/services/order.service.ts`, nuevo `server/src/services/audit.ts`, `server/src/routes/orders.ts`, `server/src/schemas/orders.ts`, `client/src/pages/POS.tsx`, `client/src/store/orders.ts`, `client/src/pages/Tables.tsx`, `client/src/pages/Cash.tsx`.
- **Rol Encargado (D5)**
  - [x] Agregar `manager` al enum de `users.role` en `schema.ts` (sin cambio de BD: la columna es texto sin `CHECK`), en `AuthPayload` y en los schemas de usuarios.
  - [x] Cliente: tipo `Role`, etiqueta "Encargado" en `Layout.tsx` y en `admin/Users.tsx` (crear y editar), y rutas habilitadas según la matriz de la sección 2.
  - [x] La salvaguarda del último dueño activo (`users.ts:86-98`) no cambia: un encargado no cuenta como dueño.
- **Base de datos (aditivo)**
  - [x] `audit_log(id INTEGER PK AUTOINCREMENT, at TEXT DEFAULT (datetime('now')), user_id INTEGER REFERENCES users(id), action TEXT NOT NULL, entity TEXT NOT NULL, entity_id INTEGER, data TEXT)` en `schema.ts` y en `migrate.ts` (`CREATE TABLE IF NOT EXISTS`).
  - [x] `audit(tx, {userId, action, entity, entityId, data})`, escrito **dentro** de la misma transacción.
- **Estados**
  - [x] Activos: `pending`, `paying`, más los heredados `preparing`/`ready` (tratados como `pending`). Cerrados: `paid`, `cancelled`.
  - [x] `PATCH /:id/status` acepta solo `pending` | `paying`. 404 si el pedido no existe, 409 si está cerrado. Persiste `paying` (DT3) y sincroniza `tables.status`.
  - [x] `POST /:id/items`: 404 si no existe, 409 `ORDER_CLOSED` si está cerrado; si estaba `paying`, vuelve a `pending`. Corre con `withWriteLock` + transacción; la comanda se imprime después del commit.
  - [x] `POST /:id/cancel` `{ reason }` (Zod: 3–200 caracteres) con la política D1. Rechaza pedidos `paid`/`cancelled` (409). Libera la mesa, actualiza `updatedAt` y registra `audit('order.cancel', {reason, billedTotal, unbilledTotal, items})`.
  - [x] **Eliminar** `DELETE /:id`, `PATCH /:id/items/:itemId/toggle` y `PATCH /:id/ready`.
- **Cliente**
  - [x] "Cancelar pedido" visible según D1, con `ConfirmDialog` y motivo obligatorio (reemplaza `confirm()` de `POS.tsx:331`).
  - [x] Botón del mozo "Pedir cuenta" / dueño y cajero "Cobrar" (D2). Esperar la respuesta y mostrar un toast si falla (hoy es una promesa sin manejar en `store/orders.ts:192-197`).
  - [x] Tipos y badges con `paying` en el store, Mesas y Caja; los estados heredados se muestran como "Pendiente".

**Aceptación (HTTP):** mozo cancela → 403; cajero cancela un pedido con cobros → 403; encargado y dueño cancelan un pedido con cobros → 200 + fila en `audit_log`; cancelar un pagado → 409; agregar a pagado/cancelado → 409; a inexistente → 404; `PATCH status=paid` → 400; "Por cobrar" persiste y revierte al agregar ítems. **Manual:** dos dispositivos ven "Por cobrar" en la misma mesa.

### T4 · Pedidos sin duplicados (TD-04) 🔴
**Archivos:** `server/src/services/order.service.ts`, `server/src/routes/orders.ts`, `server/src/db/schema.ts`, `server/src/db/migrate.ts`, `client/src/pages/POS.tsx`.
- [x] `createOrder` con `withWriteLock` + transacción: verifica la mesa, inserta el pedido y los ítems (vía T2), marca la mesa; comanda y evento después del commit.
- [x] Índice parcial `uq_orders_active_table ON orders(table_id) WHERE table_id IS NOT NULL AND status NOT IN ('paid','cancelled')` en `schema.ts` (`uniqueIndex().on().where()`, verificado en Drizzle 0.45) y en `migrate.ts`. Si falla por duplicados → advertencia con los ids y se continúa (DT4).
- [x] POS: estado `sending` que deshabilita "Enviar a cocina" y "Agregar a pedido" y muestra un spinner.

**Aceptación:** dos `createOrder` simultáneos sobre la misma mesa → uno 201 y otro 409, con 1 solo pedido activo; tras cancelar, se puede crear otro. **Manual:** doble toque rápido en "Enviar" → 1 pedido y 1 comanda.

---

## 5. Fase 2 — Operación

### T5 · Número de mesa en todas las salidas (TD-06) 🔴
**Archivos:** `server/src/utils/printer.ts`, `server/src/routes/orders.ts`, `bills.ts`, `print.ts`, `reports.ts`; `client/src/pages/Cash.tsx`, `Reports.tsx`, `BillsHistory.tsx`, `client/src/utils/reportHTML.ts`, `client/src/store/orders.ts`.
- [x] En `printer.ts`, renombrar `tableId` → `tableNumber` en `ReceiptData`, `PreReceiptData` y `KitchenTicketData` (el compilador señala cada llamada).
- [x] Etiquetas de `autoPrintKitchen` y de la reimpresión con `tableNumber`.
- [x] `GET /bills`, `GET /bills/:id` y `GET /reports/bills` incluyen `tableNumber` (LEFT JOIN con `tables`).
- [x] Cliente: `Mesa ${tableNumber}` en Caja (lista, división, boleta), Reportes (tabla, CSV, HTML) e Historial (vista y búsqueda).
- [x] Extraer `buildKitchenTicketData(order, items, waiter)` como función pura para poder testearla.

**Aceptación:** test con una mesa de id 16 y número 15 → comanda "MESA 15"; `grep "Mesa \${.*tableId"` en `client/src` sin resultados.

### T6 · Reimprimir la comanda desde la UI (TD-17) 🔴
**Archivos:** `server/src/routes/orders.ts` (o `order.service`), `server/src/schemas/orders.ts`, `server/src/utils/printer.ts`, `client/src/pages/POS.tsx`, `client/src/store/orders.ts`.
- [x] `POST /:id/reprint-kitchen` `{ onlyUnprinted?: boolean }`: si `onlyUnprinted`, solo los ítems con `kitchen_printed = 0`; si no, todos. Tras imprimir, `kitchen_printed = 1` (hoy la reimpresión no lo actualiza). La impresión ocurre **fuera** del candado; solo el `UPDATE` va dentro.
- [x] La comanda lleva la cabecera "-- REIMPRESION --".
- [x] POS, modo pedido existente: aviso "N ítems no llegaron a cocina" + botón "Reintentar comanda" (`onlyUnprinted`) y "Reimprimir comanda completa" (permisos según D4).
- [x] El toast de fallo de `kitchen:print-result` indica dónde reintentar.

**Aceptación:** test de la selección de ítems (función pura). **Manual:** con la impresora apagada, crear un pedido → aviso visible → encender → "Reintentar" imprime solo lo faltante.

### T7 · Resincronizar al reconectar (TD-12) 🔴
**Archivos:** `client/src/store/orders.ts`.
- [x] Extraer `refresh()` = `GET /orders/active` → reemplaza `orders`.
- [x] Handler con nombre propio en `socket.on('connect')` que llama a `refresh()` en las **reconexiones** (no en la primera conexión). `reset()` lo quita con `socket.off('connect', handler)`, sin borrar el handler de `api/socket.ts`.
- [x] `visibilitychange` → si la app vuelve al frente y pasaron más de 30 s desde el último refresh → `refresh()`.

**Aceptación (manual):** cortar el WiFi de un celular, crear un pedido desde otro, reconectar → el pedido aparece sin recargar la página.

### T8 · La boleta impresa sale de la BD (TD-14) 🔴
**Archivos:** `server/src/routes/bills.ts`, `server/src/routes/print.ts`, `server/src/schemas/print.ts`, `client/src/pages/Cash.tsx`.
- [x] La respuesta de `POST /bills` incluye los ítems cobrados, `tableNumber` y el nombre del cajero (vienen de T1).
- [x] `ReceiptModal` muestra los datos del servidor, y "Imprimir" llama a `POST /print/reprint/:billId`.
- [x] Eliminar `POST /print/receipt`, `POST /print/kitchen` y sus schemas.

**Aceptación:** la vista previa y el ticket coinciden con `GET /bills/:id`. **Manual:** cobro parcial → la boleta impresa muestra solo los ítems cobrados.

---

## 6. Fase 3 — Reportes y seguridad

### T9 · Reportes correctos (TD-09, TD-10, TD-25 parcial) 🔴
**Archivos:** nuevo `server/src/services/report.service.ts`, `server/src/routes/reports.ts`, `server/src/utils/dates.ts`, nuevo `client/src/utils/dates.ts`, `client/src/pages/Reports.tsx`, `client/src/utils/reportHTML.ts`, `client/src/pages/BillsHistory.tsx`.
- [x] Top platos: `FROM order_items JOIN bills ON bills.id = order_items.bill_id` (sin pasar por `orders`).
- [x] Serie diaria: `date(paid_at, <desfase>)`, con el desfase calculado en `utils/dates.ts` a partir de la zona del proceso (Perú no tiene horario de verano).
- [x] Sumas con `roundMoney`; `orderCount` pasa a `billCount` y la UI dice "boletas".
- [x] Cliente: `parseDbUtc()` compartido, usado en Reportes, el reporte HTML, el CSV (hora local) y el Historial.
- [x] `Reports.tsx`: `load` y `handleAdd` muestran un toast si fallan.

**Aceptación:** regresión V3 (Ceviche 1 u. / S/ 28) y V4 (venta de las 20:00 locales cae en su día) sobre `report.service`. **Manual:** el total de "Hoy" en Reportes coincide con el total de Historial.

### T10 · Escapar el reporte HTML (TD-05) 🔴
**Archivos:** `client/src/utils/reportHTML.ts`.
- [x] Función `escapeHtml()` aplicada a **todo** valor interpolado de origen de usuario: `dishName`, `category`, `description`, `customerName`, `receiptNumber` y la etiqueta de `barRow`.

**Aceptación (manual):** un gasto con descripción `<img src=x onerror=alert(1)>` se muestra como texto en el reporte.

### T11 · Sesiones y login (TD-13, TD-15) 🟡
**Archivos:** `server/src/middleware/auth.ts`, `server/src/index.ts` (o `app.ts`), `server/src/routes/auth.ts`, `server/src/routes/users.ts`, `server/src/realtime.ts`.
- [x] `requireAuth` consulta el usuario por id: si no existe o está inactivo → 401. El rol y el nombre se toman **de la BD**, no del token.
- [x] `io.use` hace la misma verificación; al inhabilitar un usuario o cambiar su rol → `disconnectUser(id)`.
- [x] Límite de intentos de login en memoria: 5 fallos por IP+usuario cada 5 minutos → 429; se reinicia con un login correcto.

**Aceptación (HTTP):** token de un usuario inhabilitado → 401; usuario degradado a mozo → 403 al cobrar; 6.º intento fallido → 429.

### T12 · Permisos de gastos, reportes y platos agotados (D5, D6) 🔴
**Archivos:** `server/src/routes/reports.ts`, `server/src/routes/menu.ts`, `server/src/routes/bills.ts`, `server/src/routes/print.ts`, `client/src/App.tsx`, `client/src/components/Layout.tsx`, `client/src/pages/Reports.tsx`, `client/src/pages/admin/MenuAdmin.tsx`.
- [x] Gastos: `POST /reports/expenses` → `requireRole('owner','manager')` (hoy acepta cajero). `PATCH`/`DELETE` → dueño y encargado, con `reason` obligatorio y `audit('expense.update' | 'expense.delete', {antes, después, reason})`. El borrado queda auditado (los datos del gasto se guardan en el registro).
- [x] Reportes (`/reports/*` GET): dueño y encargado (hoy acepta cajero y no encargado). Ruta `/reports` del cliente para ambos.
- [x] Historial: encargado con rango de fechas como el dueño (`bills.ts:37-44`, `print.ts:96`, `bills.ts:79-84`).
- [x] Platos agotados: `PATCH /menu/dishes/:id/availability` `{ available }` para dueño y encargado, auditado. `PATCH /menu/dishes/:id` (precio, nombre, categoría) sigue siendo solo del dueño. En el cliente, el encargado ve en Menú solo el interruptor de disponibilidad.
- [x] Revisar cada `requireRole` del servidor contra la matriz de la sección 2 (la UI no es una barrera de seguridad).

**Aceptación (HTTP):** cajero registra gasto → 403; encargado registra, corrige con motivo y borra → 200 + filas en `audit_log`; cajero pide reportes → 403; encargado cambia un precio → 403 y marca agotado → 200. Test de matriz: un caso por celda de la tabla de la sección 2.

---

## 7. Fase 4 — Mejoras baratas 🟡

| ID | Mejora | Archivos | Aceptación |
|---|---|---|---|
| M1 | Transacción + candado en `DELETE /split`, guardado del plano y alta de plato; la validación de `POST /split` pasa dentro de la transacción (TD-23) | `routes/split.ts`, `tables.ts`, `menu.ts` | Tests de división: crear, deshacer, cobrar una sub-cuenta y agregar ítems |
| M2 | Limpieza: eliminar `GET /bills/next-number`, `@dnd-kit/*`, `hero.png`, `react.svg`, `vite.svg`, `App.css`, `public/icons.svg`, tipos sin uso; `jimp` → devDependencies; reemplazar `client/README.md` de plantilla (TD-24, TD-30). **Se mantienen** los endpoints de categorías, modificadores y gastos (el producto les hará UI) | varios | `npm run ci` + build del cliente sin advertencias nuevas |
| M3 | Auditoría ampliada: cambios de precio/disponibilidad, rol/activo/contraseña de usuarios, edición/borrado de gastos, baja de mesas (TD-16) | `menu.ts`, `users.ts`, `reports.ts`, `tables.ts` | Test: cambiar un precio deja una fila en `audit_log` |
| M4 | Zona horaria: advertencia al arrancar si el desfase ≠ −300 min; `Environment=TZ=America/Lima` en la unidad systemd (TD-27) | `index.ts`, `DEPLOYMENT.md` | Log visible al arrancar con otra zona |
| M5 | `PRAGMA journal_mode=WAL` en `migrate.ts` (persistente). Verificado: hoy el modo es `delete`, por lo que los lectores pueden recibir `SQLITE_BUSY` durante un commit | `migrate.ts` | `PRAGMA journal_mode` → `wal`; el backup con `.backup` sigue funcionando |
| M6 | Migraciones fail-fast + script `npm run db:migrate` para correrlas antes de reiniciar (TD-18, DT5) | `index.ts`, nuevo `db/migrate-cli.ts`, `package.json` | Una migración rota detiene el arranque con un mensaje claro |
| M7 | Node 24 LTS en `DEPLOYMENT.md` y `engines` en los `package.json` (TD-34) | `DEPLOYMENT.md`, `package.json` ×3 | `npm ci` avisa si la versión no coincide |
| M8 | Pre-cuenta armada en el servidor: `POST /print/pre-receipt/:orderId` (opcionalmente `billGroupId`) | `print.ts`, `Cash.tsx` | La pre-cuenta coincide con lo pendiente en la BD |
| M9 | Aviso al arrancar si alguna cuenta seed conserva su contraseña por defecto (`bcrypt.compare` con las conocidas) | `index.ts` | Log de advertencia con la BD seed |
| M10 | Vista "Cancelaciones y correcciones" en Reportes (dueño y encargado): lista de `audit_log` del período con quién, cuándo, motivo y montos. Es la herramienta para que el dueño revise lo hecho en su ausencia | nuevo `GET /reports/audit`, `Reports.tsx` | La cancelación de una prueba aparece con su motivo y monto |
| M11 | Pantalla de gastos para el encargado: registrar, corregir y borrar con motivo (hoy el formulario solo está en Reportes y sin edición) | `Reports.tsx` | Flujo manual completo con el usuario encargado |

---

## 8. Fase 5 — Operación y cierre

| ID | Tarea | Tipo | Quién |
|---|---|---|---|
| O1 | Verificar que en producción **no** funcionen `admin/admin123`, `cajero/cajero123` ni `mozo1/mozo123`; si funcionan, cambiarlas ya | 🔴 | Usuario (en el local) |
| O2 | Reemplazar la microSD por un SSD (clonar, arrancar, verificar) | 🔴 | Usuario |
| O3 | Backup automático fuera del local (rclone → Drive o B2) + **prueba de restauración** en otro equipo, comparando totales del Historial | 🔴 | Usuario + asistencia |
| O4 | UPS para la Pi y el router · Tailscale con MagicDNS + `tailscale serve` (una sola URL HTTPS para el dueño) | 🟡 | Usuario |
| O5 | **Despliegue de v1.1** con el procedimiento de abajo | 🔴 | Usuario + asistencia |
| O6 | Actualizar `CLAUDE.md` (quitar `store/receipt` y el 409 `RECEIPT_TAKEN`; agregar precios desde la BD, máquina de estados, `withWriteLock`, `audit_log`, `realtime.ts`, "nunca `db:push` en producción"), `DEPLOYMENT.md` (SSD, Node 24, TZ, procedimiento de actualización, backup fuera del local, restauración) y `docs/architecture/technical-debt.md` (estado de cada TD) | 🔴 | Asistente |
| O7 | Merge a `main`, etiqueta `maui-v1.1`, MAUI en modo mantenimiento | 🔴 | Usuario (autoriza) |

### Procedimiento de despliegue de v1.1 (O5)
1. Elegir un momento sin servicio y avisar al personal.
2. `sqlite3 mauidisk.db ".backup '/home/mauidesk/backups/pre-v1.1.db'"` y copiarlo fuera de la Pi.
3. Si P2 mostró mesas con dos pedidos activos, resolverlas antes.
4. `sudo systemctl stop mauidesk` → `git fetch --tags && git checkout maui-v1.1`.
5. `cd server && npm ci && npm run build` · `cd ../client && npm ci && npm run build`. **No** ejecutar `db:push`.
6. `npm run db:migrate` (M6) → revisar advertencias → `sudo systemctl start mauidesk` → `journalctl -u mauidesk -n 50`.
7. Prueba de humo (abajo). Si falla algo crítico, hacer rollback.
8. **Rollback:** `stop` → `git checkout 85664bb` → rebuild → `start`. Como los cambios de BD son aditivos, la versión anterior funciona con la BD nueva; restaurar `pre-v1.1.db` solo si los datos se dañaron.

**Prueba de humo (con un dispositivo por rol):**
- [ ] Login de dueño, cajero y mozo.
- [ ] Pedido en mesa → la comanda sale con el **número** de mesa correcto.
- [ ] Agregar ítems → comanda "ITEMS AGREGADOS".
- [ ] Mozo: "Pedir cuenta" → "Por cobrar" visible en otro dispositivo.
- [ ] Pre-cuenta impresa.
- [ ] Cobro parcial, después cobro del resto → boletas correlativas; la mesa queda libre.
- [ ] Cuenta dividida: cobrar una sub-cuenta.
- [ ] Reimprimir una boleta desde el Historial.
- [ ] Mozo no ve "Cancelar"; cajero cancela con motivo un pedido sin cobros → fila en `audit_log`.
- [ ] Cajero no puede cancelar un pedido con cobros; el encargado sí, con motivo.
- [ ] Cajero no ve el registro de gastos; el encargado registra uno y lo corrige con motivo.
- [ ] Encargado marca un plato como agotado y no puede cambiar su precio.
- [ ] Dueño ve las cancelaciones y correcciones del día en Reportes (M10).
- [ ] Reportes "Hoy" = total del Historial.
- [ ] Dueño desde fuera del local (Tailscale) ve Mesas y Reportes.

### Resultados de P2 (completar)
| Consulta | Resultado | Acción |
|---|---|---|
| 1. Boletas sin ítems | | |
| 2. Pagados sin boleta | | |
| 3. Cancelados con cobros | | |
| 4. Mesas con 2+ pedidos activos | | |
| 5. Activos sin ítems | | |
| 6. Mesas id ≠ número | | |
| 7. Estados | | |
| 8. Precios ≠ menú | | |
| 9. journal_mode | | |

---

## 9. Definición de "MAUI listo" (criterio para crear el producto)

- [ ] Todas las tareas 🔴 cerradas; las 🟡 cerradas o anotadas como "pasa al producto".
- [ ] `npm run ci` en verde, con tests de: cobro (incl. V2/V5), precios, estados y cancelación, pedidos concurrentes, número de mesa, reportes (V3/V4) y permisos HTTP.
- [ ] v1.1 desplegada en el local, con la prueba de humo completa y **una jornada real sin incidentes**.
- [ ] SSD instalado, backup fuera del local funcionando y **una restauración probada**.
- [ ] Documentación actualizada (O6) y etiqueta `maui-v1.1` creada.
- [ ] **Propiedad del código acordada con el cliente** por escrito (requisito para usar este código en el producto, no para v1.1).

Al cumplirse: crear el repositorio del producto desde `maui-v1.1` con historial completo, y a partir de ahí MAUI solo recibe correcciones (cherry-pick mientras ambos códigos se parezcan).

## 10. Orden de ejecución y dependencias

```text
P1 ─► P2 (en paralelo, cuando haya backup) ─► resultados en §8
P1 ─► P3 ─► P4 ─► P5 ─► P6 ─► P7
                          │
                          ├─► T1 ─► T8
                          ├─► T2 ─► T3 ─► T4
                          ├─► T5 (necesita P4) ─► T6
                          ├─► T7 (independiente, solo cliente)
                          ├─► T9 ─► T10
                          ├─► T11 (necesita P6)
                          └─► T12 (necesita T3: rol encargado y audit_log)
T1…T12 ─► M1…M11 ─► O6 ─► O5 (despliegue) ─► O7
O1, O2, O3, O4: en paralelo, del lado del usuario, desde ya
```

Tamaño relativo (para planificar sesiones): **S** = P1, P7, T7, T10, M2, M4, M5, M7, M9 · **M** = P3, P4, P5, P6, T1, T4, T5, T6, T8, T9, T11, T12, M1, M3, M6, M8, M10, M11, O6 · **L** = T2, T3.
