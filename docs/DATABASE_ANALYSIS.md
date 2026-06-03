# DATABASE_ANALYSIS.md — MauiDesk

> Análisis de la capa de datos. Fuente de verdad del schema:
> [../server/src/db/schema.ts](../server/src/db/schema.ts) (Drizzle ORM).
> Relacionado: [PROJECT_ANALYSIS.md](PROJECT_ANALYSIS.md),
> [BUSINESS_RULES.md](BUSINESS_RULES.md), [ARCHITECTURE_MAP.md](ARCHITECTURE_MAP.md).

---

## 1. Motor y acceso

- **Motor:** SQLite local, vía `@libsql/client` (libsql).
- **ORM:** Drizzle ORM (`drizzle-orm/libsql`).
- **Cliente:** [../server/src/db/index.ts](../server/src/db/index.ts) crea `createClient({ url: DATABASE_URL })` y lo envuelve en `drizzle(client, { schema })`.
- **Ruta de la BD:** `DATABASE_URL` (dev: `file:./mauidisk.db`; Pi: ruta absoluta al SSD, ver [../DEPLOYMENT.md](../DEPLOYMENT.md)).
- **Config Drizzle:** [../server/drizzle.config.ts](../server/drizzle.config.ts) — dialect `sqlite`, schema en `./src/db/schema.ts`, salida de migraciones en `./src/db/migrations`.
- **Aplicación de schema:** `npm run db:push` (drizzle-kit) + migraciones idempotentes al startup en [../server/src/db/migrate.ts](../server/src/db/migrate.ts).

> **Nota sobre fechas:** las columnas `*_at` y `date` se guardan como **TEXT** con
> `datetime('now')` de SQLite, que es **UTC** con formato `YYYY-MM-DD HH:MM:SS`.
> El código del cliente reconstruye hora local agregando `'Z'` antes de
> `new Date(...)` (ej. [BillsHistory.tsx:52](../client/src/pages/BillsHistory.tsx),
> [orders.ts:92](../server/src/routes/orders.ts)). Esto es un punto recurrente de
> bugs de zona horaria — ver P2 en [PROJECT_ANALYSIS.md](PROJECT_ANALYSIS.md).

---

## 2. Diagrama Entidad-Relación (lógico)

```
                         ┌──────────────┐
                         │   users      │
                         │ id (PK)      │
                         │ username (U) │
                         │ role enum    │
                         └──────┬───────┘
              created_by │      │ created_by
        ┌────────────────┘      └───────────────┐
        ▼                                        ▼
┌──────────────┐                          ┌──────────────┐
│   orders     │                          │   bills      │
│ id (PK)      │── orderId ──────────────►│ id (PK)      │
│ tableId (FK) │◄──┐                      │ orderId (FK) │
│ type enum    │   │                      │ receiptNumber│ (UNIQUE)
│ status enum  │   │                      │ paymentMethod│
└──────┬───────┘   │                      └──────────────┘
       │ orderId    │ tableId
       ▼            │
┌──────────────┐   │   ┌──────────────┐
│ order_items  │   │   │   tables     │
│ id (PK)      │   └───│ id (PK)      │
│ orderId (FK) │       │ number (U)   │
│ dishId (FK)  │       │ status enum  │
│ billId       │       │ active       │
│ billGroupId  │       └──────────────┘
│ status enum  │
└──────┬───────┘       ┌──────────────┐
       │ billGroupId   │ layout_items │  (decoraciones del plano)
       ▼               │ id (PK)      │
┌──────────────┐       │ type enum    │
│ bill_groups  │       └──────────────┘
│ id (PK)      │
│ orderId (FK) │       ┌──────────────┐
│ status enum  │       │  expenses    │  (gastos, sin FK a órdenes)
│ billId       │       │ id (PK)      │
└──────────────┘       │ createdBy(FK)│
                       └──────────────┘
       dishes ──< modifier_groups ──< modifier_options
         │                                  
         └──> categories (categoryId FK)
```

---

## 3. Tablas (detalle)

### 3.1 `users` — [schema.ts:4](../server/src/db/schema.ts)
| Columna | Tipo | Notas |
|---|---|---|
| id | integer PK autoincrement | |
| name | text NOT NULL | Nombre mostrado |
| username | text NOT NULL **UNIQUE** | Login |
| passwordHash | text NOT NULL | bcrypt (10 rounds) |
| role | text enum `owner`/`cashier`/`waiter` NOT NULL | |
| active | integer (boolean) default true | Soft-disable |
| createdAt | text default `datetime('now')` (UTC) | |

Reglas: no se puede inhabilitar/degradar al **último owner activo**
([users.ts:87-98](../server/src/routes/users.ts)). Contraseñas hasheadas con
bcrypt; nunca se devuelve `passwordHash` (función `publicShape`).

### 3.2 `categories` — [schema.ts:14](../server/src/db/schema.ts)
`id`, `name`, `displayOrder` (orden en POS), `active` (boolean). Borrado bloqueado
si tiene platos asociados → 409 ([menu.ts:75-87](../server/src/routes/menu.ts)).

### 3.3 `dishes` — [schema.ts:21](../server/src/db/schema.ts)
| Columna | Tipo | Notas |
|---|---|---|
| id | integer PK | |
| categoryId | integer FK → categories.id | |
| name | text NOT NULL | |
| description | text NULL | |
| **price** | **real** NOT NULL | ⚠ punto flotante |
| available | integer (boolean) default true | |
| hasSpiceLevel | integer (boolean) default true | Si true, se crean grupos de modificadores |
| createdAt | text (UTC) | |

Borrado: si el plato está usado en `order_items`, se hace **soft-disable**
(`available=false`) para no romper historial; si no, DELETE real + limpieza de
modificadores ([menu.ts:143-160](../server/src/routes/menu.ts)).

### 3.4 `modifier_groups` — [schema.ts:32](../server/src/db/schema.ts)
`dishId` FK, `name`, `type` enum `spice`|`preference`, `required`, `multiple`,
`displayOrder`. Al crear un plato con `hasSpiceLevel`, se generan automáticamente:
un grupo **spice** ("Nivel de Picante", requerido, 5 opciones) y un grupo
**preference** ("Preferencias", opcional, texto libre, sin opciones)
([menu.ts:109-123](../server/src/routes/menu.ts), también en [seed.ts:52-79](../server/src/db/seed.ts)).

### 3.5 `modifier_options` — [schema.ts:42](../server/src/db/schema.ts)
`groupId` FK, `name`, `priceAdjustment` (real, default 0 — **definido en schema
pero no se suma al total en el cobro actual**), `displayOrder`.

### 3.6 `tables` — [schema.ts:50](../server/src/db/schema.ts)
| Columna | Tipo | Notas |
|---|---|---|
| id | integer PK | |
| number | integer NOT NULL **UNIQUE** | Número visible |
| area | text default `'salon'` | Grupo/zona (texto libre) |
| capacity | integer default 4 | |
| status | text enum `free`/`occupied`/`paying` default `free` | Sincronizado con la orden |
| posX, posY | real NULL | Posición en el canvas virtual 1200×700 del plano |
| active | integer (boolean) default true | Soft-disable (agregada por migración) |

Borrado ([tables.ts:83-110](../server/src/routes/tables.ts)): ocupada/por-cobrar →
409; con historial → soft-disable (`active=false`); sin historial → DELETE real
(con fallback a soft-disable si la FK bloquea).

### 3.7 `layout_items` — [schema.ts:65](../server/src/db/schema.ts)
Decoraciones del plano: `type` enum `label`|`zone`, `text`, `posX`/`posY`
(NOT NULL), `width`/`height` (solo zones), `color`. Se reemplazan en bloque al
guardar el layout ([tables.ts:133-146](../server/src/routes/tables.ts)). Creada
por migración idempotente ([migrate.ts:24-39](../server/src/db/migrate.ts)).

### 3.8 `orders` — [schema.ts:76](../server/src/db/schema.ts)
| Columna | Tipo | Notas |
|---|---|---|
| id | integer PK | |
| tableId | integer FK → tables.id NULL | NULL para delivery |
| type | text enum `dine_in`/`delivery` NOT NULL | |
| status | text enum `pending`/`preparing`/`ready`/`paid`/`cancelled` default `pending` | ⚠ el estado de UI `paying` NO se persiste; se mapea a `preparing` en BD ([orders.ts:288](../server/src/routes/orders.ts)) |
| customerName/Phone/Address | text NULL | Datos de delivery |
| notes | text NULL | |
| createdBy | integer FK → users.id | |
| createdAt / updatedAt | text (UTC) | |

### 3.9 `order_items` — [schema.ts:90](../server/src/db/schema.ts)
| Columna | Tipo | Notas |
|---|---|---|
| id | integer PK | |
| orderId | integer FK → orders.id | |
| dishId | integer FK → dishes.id | |
| dishName | text NOT NULL | **Snapshot** del nombre (sobrevive si el plato cambia/borra) |
| unitPrice | real NOT NULL | **Snapshot** del precio al momento del pedido |
| quantity | integer default 1 | |
| modifiers | text default `'[]'` | **JSON serializado** (no relacional) |
| notes | text NULL | Nota para cocina |
| status | text enum `pending`/`preparing`/`ready` default `pending` | |
| kitchenPrinted | integer (boolean) default false | Si ya salió la comanda |
| billId | integer NULL | NULL = no facturado; set = pertenece a esa boleta |
| billGroupId | integer NULL | Sub-cuenta asignada (división) |

> **Diseño clave:** `dishName` y `unitPrice` son *snapshots*. Esto desacopla el
> historial de cobros de cambios futuros en el menú (buena práctica). El precio de
> los modificadores (`priceAdjustment`) **no** se snapshotea ni se suma — el total
> se calcula como `unitPrice * quantity` ([bills.ts:181](../server/src/routes/bills.ts)).
>
> `modifiers` se guarda como **JSON en TEXT**, no como filas relacionales. Se
> parsea con `JSON.parse(i.modifiers ?? '[]')` en cada lectura. Trade-off:
> simplicidad vs imposibilidad de consultar por modificador en SQL.

### 3.10 `bill_groups` — [schema.ts:105](../server/src/db/schema.ts)
Sub-cuentas para división. `orderId` FK NOT NULL, `label` (ej. "Cuenta A"),
`status` enum `open`|`paid`, `billId` (la boleta que la pagó). Coexisten grupos
pagados e *open* en una misma orden (ver lógica en [split.ts](../server/src/routes/split.ts)).

### 3.11 `bills` — [schema.ts:114](../server/src/db/schema.ts)
| Columna | Tipo | Notas |
|---|---|---|
| id | integer PK | |
| orderId | integer FK → orders.id | |
| subtotal / total | real NOT NULL | (iguales hoy; no hay impuestos/descuentos) |
| paymentMethod | text enum `cash`/`yape`/`plin` NOT NULL | |
| cashReceived / changeAmount | real NULL | Solo efectivo |
| **receiptNumber** | text NOT NULL **UNIQUE** | Formato `B001-NNNNN`; única garantía de no-duplicado |
| paidAt | text default `datetime('now')` (UTC) | |
| createdBy | integer FK → users.id | Cajero |

### 3.12 `expenses` — [schema.ts:127](../server/src/db/schema.ts)
`description`, `amount` (real), `category` (default `'general'`), `date`
(text `YYYY-MM-DD`), `notes`, `createdBy` FK, `createdAt`. **Sin FK a órdenes** —
entidad independiente para el balance neto en reportes. Solo soporta alta y
listado (no update/delete).

---

## 4. Restricciones, índices y claves

| Tipo | Dónde | Detalle |
|---|---|---|
| PRIMARY KEY | todas las tablas | `integer autoincrement` |
| UNIQUE | `users.username` | Login único |
| UNIQUE | `tables.number` | Número de mesa único |
| UNIQUE | `bills.receiptNumber` | **Candado anti-duplicado de boletas** |
| FOREIGN KEY | múltiples (`.references(...)`) | Declaradas en Drizzle; SQLite requiere `PRAGMA foreign_keys=ON` para enforcement (no se observa que se active explícitamente) |
| ÍNDICES secundarios | — | **No hay** índices definidos más allá de PK/UNIQUE |

> **Recomendación:** agregar índices en `order_items(order_id)`,
> `order_items(bill_id)`, `bills(paid_at)` y `orders(table_id, status)`. A volumen
> actual (≈50 pedidos/día) no es crítico, pero abarata las consultas de
> `/orders/active`, cobro y reportes.

> **Sobre FKs:** las relaciones están declaradas pero el borrado real de mesas
> tiene un *fallback defensivo* ([tables.ts:104-109](../server/src/routes/tables.ts))
> que asume que la FK podría bloquear el DELETE — señal de que el enforcement de
> FK puede o no estar activo según el entorno. Conviene fijar `foreign_keys=ON`
> explícitamente y diseñar `ON DELETE` con intención.

---

## 5. Estrategia de migraciones

Dos mecanismos conviven:

1. **`drizzle-kit push`** (`npm run db:push`): sincroniza el schema declarado en
   [schema.ts](../server/src/db/schema.ts) contra la BD. Idempotente.
2. **Migraciones idempotentes al startup** ([migrate.ts](../server/src/db/migrate.ts)),
   ejecutadas desde [index.ts:122](../server/src/index.ts) antes de `listen`:
   - Agrega `tables.active` si no existe (`PRAGMA table_info` + `ALTER TABLE`).
   - `CREATE TABLE IF NOT EXISTS layout_items`.
   - Si fallan, el server arranca igual (degradación elegante, con warning).

> Esto permite desplegar `git pull` + restart sin un paso de migración manual,
> ideal para el Pi. El costo es que el schema "real" se define en dos sitios.

---

## 6. Seed de datos — [../server/src/db/seed.ts](../server/src/db/seed.ts)

`npm run db:seed` siembra **solo si la BD está vacía** (guard sobre `categories`):
- 3 usuarios demo (`admin`/`cajero`/`mozo1`, bcrypt) — **cambiar en producción**.
- 5 categorías, 12 platos (con/ sin picante).
- Grupos de modificadores para platos con picante (5 niveles + preferencias).
- 15 mesas (8 salón, 5 terraza, 2 barra).

---

## 7. Integridad y concurrencia (resumen)

- **Cobro y división corren en `db.transaction(...)`** → atomicidad
  ([bills.ts:202](../server/src/routes/bills.ts), [split.ts:80](../server/src/routes/split.ts)).
- **Número de boleta**: se valida colisión *dentro* de la transacción y se calcula
  el máximo con SQL atómico (`MAX(CAST(SUBSTR(...)))`) en
  [bills.ts:19-25](../server/src/routes/bills.ts). Colisión → 409 `RECEIPT_TAKEN`.
- **Facturación parcial**: `order_items.billId` distingue facturado/no-facturado;
  una orden pasa a `paid` solo cuando **no quedan items con `billId` nulo**.

Detalle de reglas de negocio asociadas: [BUSINESS_RULES.md](BUSINESS_RULES.md).
