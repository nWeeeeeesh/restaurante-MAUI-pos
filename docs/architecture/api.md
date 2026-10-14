# API HTTP y eventos en tiempo real

> Parte de la [documentación de arquitectura](README.md). Snapshot `main` @ `85664bb` (2026-09-23).
> Fuente: `server/src/index.ts:91-101` (montaje de routers), `server/src/routes/*.ts`, `server/src/schemas/*.ts`. La columna "UI" indica si `client/src` llama al endpoint.
> **Posterior al snapshot:** el inventario de insumos (2026-10) y sus cambios en el menú están en la [§6](#6-inventario-de-insumos-2026-10-fase-0-de-la-tesis).

## 1. Convenciones

| Aspecto | Comportamiento real | Evidencia |
|---|---|---|
| Base | `/api`, JSON (`express.json()`, límite por defecto de 100 kB) | `index.ts:89` |
| Autenticación | `Authorization: Bearer <jwt>` en todo excepto `/api/auth/login` y `/api/health` | `middleware/auth.ts:19-32` |
| Autorización | `requireRole(...)` por endpoint; 3 roles fijos | `middleware/auth.ts:34-42` |
| Validación de body | `validateBody(ZodSchema)` → 400 `{ error: 'Validación fallida', issues[] }`; reemplaza `req.body` por el dato parseado | `middleware/validate.ts:7-21` |
| Validación de query | `validateQuery` → 400 `{ error: 'Parámetros inválidos', issues[] }`; **no** reemplaza `req.query` | `middleware/validate.ts:24-39` |
| Parámetros de ruta | **Sin validar**: `Number(req.params.id)` puede ser `NaN` | todos los routers |
| Errores de negocio | `{ error: string }` con 400/403/404/409; la impresión usa `{ ok: false, error }` | routers |
| Errores no controlados | No hay manejador global: Express 5 responde 500 con su página HTML por defecto | `index.ts` (TD-21) |
| Códigos | 200, 201 (creación), 204 (algunos borrados), 400, 401, 403, 404, 409, 500 | routers |

## 2. Endpoints

**Autenticación:** "Pública" = sin token · "JWT" = cualquier rol autenticado · "JWT + rol" = `requireRole`.

### Auth y salud
| Método | Endpoint | Módulo | Autenticación | Descripción | UI |
|---|---|---|---|---|---|
| POST | `/api/auth/login` | auth | Pública | Login con `LoginSchema`; devuelve `{token, user}` (JWT de 12 h). Sin límite de intentos | ✓ |
| GET | `/api/auth/me` | auth | JWT | Devuelve el payload del token (no consulta la BD) | ✓ |
| GET | `/api/health` | index | Pública | `{status:'ok'}` | — |

### Menú (`routes/menu.ts`)
| Método | Endpoint | Módulo | Autenticación | Descripción | UI |
|---|---|---|---|---|---|
| GET | `/api/menu` | menú | JWT | Categorías activas → platos disponibles → grupos → opciones. *Desde 2026-10: incluye los agotados y excluye los archivados (§6)* | ✓ |
| GET | `/api/menu/dishes` | menú | JWT + owner/cashier | Todas las categorías y platos (incluye no disponibles) | ✓ |
| POST | `/api/menu/categories` | menú | JWT + owner | Crea categoría | — |
| PATCH | `/api/menu/categories/:id` | menú | JWT + owner | Edita nombre, orden o `active` | — |
| DELETE | `/api/menu/categories/:id` | menú | JWT + owner | Borrado físico; 409 si tiene platos | — |
| POST | `/api/menu/dishes` | menú | JWT + owner | Crea plato y, con `hasSpiceLevel`, sus modificadores (sin transacción) | ✓ |
| PATCH | `/api/menu/dishes/:id` | menú | JWT + owner | Edita campos del plato (la UI solo envía precio y disponibilidad) | ✓ |
| DELETE | `/api/menu/dishes/:id` | menú | JWT + owner | Físico si no tiene pedidos; si tiene, `available=false` y `{deactivated:true}`. *Desde 2026-10: `archived=true` y `{archived:true}` (§6)* | ✓ |
| GET | `/api/menu/dishes/:id/modifiers` | menú | JWT | Grupos y opciones de un plato | — |
| POST | `/api/menu/modifier-groups/:groupId/options` | menú | JWT + owner | Crea una opción (no verifica que el grupo exista) | — |
| DELETE | `/api/menu/modifier-options/:id` | menú | JWT + owner | Borra una opción | — |

### Pedidos (`routes/orders.ts`)
| Método | Endpoint | Módulo | Autenticación | Descripción | UI |
|---|---|---|---|---|---|
| GET | `/api/orders/active` | pedidos | JWT | Pedidos no `paid`/`cancelled` con ítems y sub-cuentas (N+1) | ✓ |
| GET | `/api/orders/:id` | pedidos | JWT | Pedido completo | — |
| POST | `/api/orders` | pedidos | JWT | Crea pedido + ítems (`CreateOrderSchema`). **Precio y nombre los envía el cliente** (TD-01); 409 si la mesa ya tiene pedido activo (sin atomicidad, TD-04); imprime comanda en segundo plano; emite `order:new` | ✓ |
| POST | `/api/orders/:id/items` | pedidos | JWT | Agrega ítems (`AddItemsSchema`), asigna sub-cuenta si corresponde y fuerza `status=pending`. No valida existencia ni estado (TD-07). Emite `order:updated` | ✓ |
| POST | `/api/orders/:id/reprint-kitchen` | pedidos | JWT | Reimprime los ítems no `ready` (en la práctica, todos) | — (TD-17) |
| PATCH | `/api/orders/:id/status` | pedidos | JWT | `UpdateOrderStatusSchema`: acepta `paid` y `cancelled` desde cualquier rol (TD-02); `paying` se guarda como `preparing` (TD-08) | ✓ (solo `paying`) |
| PATCH | `/api/orders/:id/items/:itemId/toggle` | pedidos | JWT | Alterna `ready`/`preparing` de un ítem (resto de la pantalla de cocina) | — |
| PATCH | `/api/orders/:id/ready` | pedidos | JWT | Marca todos los ítems `ready` (resto de la pantalla de cocina) | — |
| DELETE | `/api/orders/:id` | pedidos | JWT | **Cancela** (`status=cancelled`) y libera la mesa, sin rol ni validación; 204 aunque el pedido no exista (TD-02) | ✓ |

### Cuenta dividida (`routes/split.ts`, montado en `/api/orders/:id/split`, `index.ts:94`)
| Método | Endpoint | Módulo | Autenticación | Descripción | UI |
|---|---|---|---|---|---|
| GET | `/api/orders/:id/split` | división | JWT | Lista las sub-cuentas | — |
| POST | `/api/orders/:id/split` | división | JWT | Reemplaza las sub-cuentas abiertas (`SplitGroupsSchema`); valida fuera y escribe dentro de una transacción | ✓ |
| DELETE | `/api/orders/:id/split` | división | JWT | Deshace las sub-cuentas abiertas (sin transacción, TD-23) | ✓ |

### Boletas (`routes/bills.ts`)
| Método | Endpoint | Módulo | Autenticación | Descripción | UI |
|---|---|---|---|---|---|
| GET | `/api/bills/next-number` | cobro | JWT | Último número de boleta. Obsoleto desde que el servidor genera el número (H1) | — |
| GET | `/api/bills` | cobro | JWT | Historial; `owner` puede filtrar `from`/`to` (`DateRangeQuerySchema`), el resto solo ve hoy | ✓ |
| GET | `/api/bills/:id` | cobro | JWT | Detalle con ítems; quien no es `owner` solo ve boletas de hoy (403) | ✓ |
| POST | `/api/bills` | cobro | JWT + owner/cashier | Cobro total, parcial (`itemIds`) o por sub-cuenta (`billGroupId`) vía `billing.service`. 201 con la boleta y `fullyPaid`; 400/404/409 de negocio; 500 ante `SQLITE_BUSY` (TD-11) | ✓ |

### Reportes y gastos (`routes/reports.ts`)
| Método | Endpoint | Módulo | Autenticación | Descripción | UI |
|---|---|---|---|---|---|
| GET | `/api/reports/summary?period=` | reportes | JWT + owner/cashier | Total, cantidad de boletas, montos por método, top platos (TD-09), serie diaria (TD-10) | ✓ (UI solo para owner) |
| GET | `/api/reports/bills?period=` | reportes | JWT + owner/cashier | Boletas del período con tipo, mesa (id) y cliente | ✓ (UI solo para owner) |
| GET | `/api/reports/expenses?period=` | gastos | JWT + owner/cashier | Gastos desde el inicio del período | ✓ (UI solo para owner) |
| POST | `/api/reports/expenses` | gastos | JWT + owner/cashier | Registra un gasto (`CreateExpenseSchema`) | ✓ |
| PATCH | `/api/reports/expenses/:id` | gastos | JWT + owner | Edita un gasto (`UpdateExpenseSchema`) | — |
| DELETE | `/api/reports/expenses/:id` | gastos | JWT + owner | Borrado físico sin auditoría | — |

### Impresión (`routes/print.ts`)
| Método | Endpoint | Módulo | Autenticación | Descripción | UI |
|---|---|---|---|---|---|
| GET | `/api/print/status` | impresión | JWT | Diagnóstico de conectividad (TCP o cola de Windows); la UI lo consulta cada 30 s | ✓ |
| POST | `/api/print/clear-queue` | impresión | JWT + owner/cashier | Limpia la cola de Windows (solo desarrollo) | ✓ |
| GET | `/api/print/test` | impresión | JWT | **Imprime** una página de prueba (GET con efecto secundario) | — |
| POST | `/api/print/receipt` | impresión | JWT | Imprime una boleta **con los datos que envía el cliente** (TD-14) | ✓ |
| POST | `/api/print/pre-receipt` | impresión | JWT | Imprime una pre-cuenta con los datos que envía el cliente | ✓ |
| POST | `/api/print/kitchen` | impresión | JWT | Imprime una comanda con los datos que envía el cliente | — |
| POST | `/api/print/reprint/:billId` | impresión | JWT | Reimprime una boleta **desde la BD**; quien no es `owner` solo puede reimprimir las de hoy | ✓ |

### Mesas y plano (`routes/tables.ts`)
| Método | Endpoint | Módulo | Autenticación | Descripción | UI |
|---|---|---|---|---|---|
| GET | `/api/tables` | mesas | JWT | Todas las mesas (incluye inactivas) | ✓ |
| POST | `/api/tables` | mesas | JWT + owner | Crea una mesa (número = máximo + 1 si no se envía) | ✓ |
| PATCH | `/api/tables/:id` | mesas | JWT + owner | Edita número, área, capacidad, posición o `active` | ✓ (solo `active`) |
| DELETE | `/api/tables/:id` | mesas | JWT + owner | 409 si está ocupada; lógico si tiene historial; físico si no | ✓ |
| POST | `/api/tables/layout` | mesas | JWT + owner | Guarda posiciones y reemplaza las decoraciones (sin transacción) | ✓ |
| GET | `/api/tables/layout-items` | mesas | JWT | Decoraciones del plano | ✓ |

### Usuarios (`routes/users.ts`)
| Método | Endpoint | Módulo | Autenticación | Descripción | UI |
|---|---|---|---|---|---|
| POST | `/api/users/me/password` | usuarios | JWT | Cambia la contraseña propia (exige la actual) | ✓ |
| GET | `/api/users` | usuarios | JWT + owner | Lista sin `password_hash` (`publicShape`) | ✓ |
| POST | `/api/users` | usuarios | JWT + owner | Crea un usuario (contraseña ≥ 8) | ✓ |
| PATCH | `/api/users/:id` | usuarios | JWT + owner | Edita nombre, usuario, rol o `active`; impide dejar el sistema sin dueño activo | ✓ |
| POST | `/api/users/:id/password` | usuarios | JWT + owner | Restablece la contraseña de otro usuario | ✓ |

**Total: 54 endpoints.** 16 no tienen consumidor en la UI, sin contar `/api/health`.

## 3. Eventos Socket.io

Autenticación en el handshake con el mismo JWT (`index.ts:74-86`). Todos los eventos se emiten con `io.emit` a **todos** los sockets autenticados (TD-32). El cliente no envía eventos al servidor.

| Evento | Emisor | Payload | Consumidor |
|---|---|---|---|
| `order:new` | `orders.ts:168` | Pedido completo | `store/orders.ts:125-131` (inserta o reemplaza) |
| `order:updated` | `orders.ts:225`, `304`, `331`, `341`; `split.ts:24`; `bills.ts:132` | Pedido completo | `store/orders.ts:133-139` |
| `order:removed` | `orders.ts:302`, `353`; `bills.ts:128` | `orderId` | `store/orders.ts:141-143` |
| `kitchen:print-result` | `orders.ts:63-81`, `268-276` | `{orderId, ok, isAddition, label, itemCount, reason?, manual?}` | `store/orders.ts:145-162` (toast) |

No hay números de versión ni resincronización al reconectar (TD-12).

## 4. Endpoints sin consumidor en la UI

| Endpoint | Situación |
|---|---|
| `GET /api/bills/next-number` | Obsoleto (la numeración está en el servidor desde `e89587d`) |
| `PATCH /api/orders/:id/items/:itemId/toggle`, `PATCH /api/orders/:id/ready` | Restos de la pantalla de cocina eliminada en `5200066` |
| `POST /api/orders/:id/reprint-kitchen` | Útil pero sin botón (TD-17) |
| `GET /api/orders/:id`, `GET /api/orders/:id/split`, `GET /api/menu/dishes/:id/modifiers` | Lecturas sin uso |
| CRUD de categorías (3) y de opciones de modificador (2) | Sin pantalla de administración (GAP-08) |
| `PATCH`/`DELETE /api/reports/expenses/:id` | Agregados en H3 sin UI (GAP-08) |
| `GET /api/print/test`, `POST /api/print/kitchen` | Sin uso; aceptan contenido arbitrario o producen efectos |

## 5. Inconsistencias y responsabilidades mal ubicadas

1. **Gastos bajo `/api/reports`:** es un recurso de escritura (CRUD) montado en el router de reportes.
2. **Mutaciones de pedidos sin autorización por rol**, mientras el cobro sí la tiene: cancelar o cerrar pedidos es tan sensible como cobrar (TD-02).
3. **`GET` con efecto secundario:** `/api/print/test`.
4. **Respuestas de borrado heterogéneas:** 204 (categorías, pedidos), `{deactivated}` o 204 (platos), `{ok, deleted|disabled}` (mesas), `{ok:true}` (gastos).
5. **Formato de error heterogéneo:** `{error}` vs `{ok:false, error}` (impresión) vs página HTML (errores no controlados).
6. **Nomenclatura del tipo de pedido:** `dine_in` en pedidos, `dine-in` en los schemas de impresión (`schemas/print.ts:23`).
7. **Estado que no existe en la BD:** `paying` se acepta en `UpdateOrderStatusSchema`, pero se persiste como `preparing`.
8. **El cliente define contenido que el servidor debería derivar:** precios (TD-01) y contenido de lo impreso (TD-14).
9. **Permisos UI ≠ servidor:** el cajero tiene acceso a `/api/reports/*` en el servidor, pero la ruta `/reports` de la UI es solo para `owner` (`App.tsx:50-52`). El mozo ve el botón "Cobrar", pero `/cash` lo redirige (`App.tsx:44-46`).
10. **La división de cuenta es un router aparte** montado bajo `/api/orders/:id/split`, con su propia copia de la serialización del pedido (`split.ts:13-26`).

## 6. Inventario de insumos (2026-10, Fase 0 de la tesis)

Plan: [docs/plan-inventario-tesis.md](../plan-inventario-tesis.md). Fase 0 = **solo registro** (compras, merma, conteos de cierre, ventas perdidas), sin stock teórico ni alertas. Router `server/src/routes/inventory.ts`, servicio `services/inventory.service.ts`, schemas `schemas/inventory.ts`, montado en `/api/inventory` (`app.ts`).

Reglas comunes: escrituras con `withWriteLock` + transacción; fechas de compra, merma y conteo en **día local** `YYYY-MM-DD`, válidas y no futuras; cantidades > 0 (el conteo admite 0); costo ≥ 0. Corregir o borrar exige motivo (≥ 3 caracteres) y escribe `audit_log` en la misma transacción, igual que los gastos. Errores de negocio con `DomainError`: `SUPPLY_NOT_FOUND` (404), `SUPPLY_INACTIVE` (409), `SUPPLY_EXISTS` (409), `INVALID_RANGE` (400), `FUTURE_DATE` (400). Rango por defecto de los listados: últimos 7 días locales.

| Método | Endpoint | Roles | Descripción | Auditoría |
|---|---|---|---|---|
| GET | `/api/inventory/supplies[?all=true]` | todos | Insumos activos, críticos primero. `all=true` (solo el dueño) incluye los desactivados | — |
| POST | `/api/inventory/supplies` | owner | Alta (`name` único sin distinguir mayúsculas, `unit` `kg`/`unit`/`l`, `critical`, `perishable`) | — |
| PATCH | `/api/inventory/supplies/:id` | owner | Edita nombre, unidad, `critical`, `perishable` o `active` | `supply.update` |
| GET | `/api/inventory/purchases?from&to` | owner, manager | Compras del rango con nombre del insumo y de quien registró | — |
| POST | `/api/inventory/purchases` | owner, manager | `supplyId`, `quantity`, `totalCost`, `purchasedAt` (hoy por defecto), `notes` | — |
| PATCH | `/api/inventory/purchases/:id` | owner, manager | Corrige campos; `reason` obligatorio | `purchase.update` (antes/después) |
| DELETE | `/api/inventory/purchases/:id` | owner, manager | Body `{reason}`; la compra completa queda en el registro | `purchase.delete` |
| GET | `/api/inventory/waste?from&to` | owner, manager | Merma del rango | — |
| POST | `/api/inventory/waste` | owner, manager | `supplyId`, `quantity`, `reason` (`deterioro`, `sobra_comensal`, `preparacion`, `otro`), `wastedAt`, `notes` | — |
| PATCH | `/api/inventory/waste/:id` | owner, manager | Corrige campos; el motivo de la corrección va en `correctionReason` porque `reason` es la causa de la merma | `waste.update` |
| DELETE | `/api/inventory/waste/:id` | owner, manager | Body `{reason}` | `waste.delete` |
| GET | `/api/inventory/daily?date` | owner, manager | «Compra del día» de una fecha: críticos activos en `sort_order` con lo guardado y el prellenado (`suggestion`: compra del mismo día de la semana anterior o la última, último precio y proveedor), `wasteDate` (día operativo anterior) y notas | — |
| POST | `/api/inventory/daily` | owner, manager | `{date?, items:[{supplyId, opening?, wasted?, purchased?, unitPrice?, totalCost?, supplier?}], notes?:[{kind, text?}]}`. Una transacción: apertura, merma por deterioro, compras y notas. Idempotente por fecha (reemplaza solo `source='daily'`); sin `notes` las notas no se tocan. Hasta 7 días atrás (`DATE_OUT_OF_RANGE`) | `daily.update` si cambia algo |
| GET | `/api/inventory/daily/pending` | owner, manager | `{date, pending}`: ayer hubo ventas y no hay «Compra del día» (indicador del Layout) | — |
| GET | `/api/inventory/counts?date&moment` | owner, manager | Conteos del día (hoy por defecto) | — |
| PUT | `/api/inventory/counts/:date` | owner, manager | Conteo suelto `{moment?, items}` (por defecto `cierre`); upsert por insumo, día y momento | `count.update` (solo si cambia el valor) |
| POST | `/api/inventory/lost-sales` | todos | "No había" desde el POS: `dishId` y/o `supplyId`, `quantity` (1 por defecto) | — |
| GET | `/api/inventory/lost-sales?from&to` | owner, manager | Ventas perdidas del rango (límites del día local convertidos a UTC) | — |
| GET | `/api/inventory/export?table&from&to` | owner, manager | Dataset de la tesis: `daily`, `purchases`, `waste`, `counts`, `lost_sales`, `stockouts` (intervalos), `day_notes`, `supplies`. Primera línea `# maui-tesis dataset v1 · …`; columnas congeladas en el [diccionario](../diccionario-datos-tesis.md) | — |

**Cambios en el menú (Capa 0, TD-31):**
- `DELETE /api/menu/dishes/:id` con historial pone `archived=true` (no toca `available`), responde `{archived:true}` y audita `dish.archive`. Sin historial sigue siendo borrado físico (ahora en una transacción).
- `GET /api/menu` excluye los archivados e **incluye los agotados** (`available=false`): el POS los muestra deshabilitados con el botón "No había". `resolveItems` rechaza archivados y agotados con 409 `DISH_UNAVAILABLE`.
- `PATCH /api/menu/dishes/:id` acepta `{archived:false}` para restaurar (archivar es solo `DELETE`).
- Desde la v2 del plan, el **cajero** también puede marcar agotado (`PATCH /dishes/:id/availability`, `GET /dishes`).
- **Evento Socket.io `menu:availability`** (`{dishId, available}`, v2.1): se emite después del commit en cada transición real de disponibilidad, desde `/availability` o desde `PATCH /dishes/:id`. El POS actualiza el menú sin recargar y quita el plato agotado de los borradores.
- `GET /api/inventory/daily`: `suggestion.fromDate` indica de qué compra sale la cantidad de referencia; la pantalla la ofrece con [Usar] y no la prellena (plan §2.9).
- **Quiebres:** `dish.availability` en `audit_log` se escribe solo en transiciones reales (marcar agotado dos veces cuenta como un solo quiebre), venga de `PATCH /dishes/:id/availability` o de la edición del dueño (`PATCH /dishes/:id` con `available`).

