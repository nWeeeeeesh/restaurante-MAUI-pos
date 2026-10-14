# Plan: Inventario de insumos perecibles (tesis de rentabilidad)

> Encargo para Claude Code. Léelo completo antes de empezar, junto con `CLAUDE.md`.
> Navegación del código: `graphify-out/obsidian/00 Inicio.md` y las notas de `Módulos/`.

## 1. Contexto

La tesis de Cesar evalúa el **impacto de un módulo de inventario de insumos perecibles en la rentabilidad** de la Cevichería MAUI. El diseño es preprueba/posprueba:

- **Fase 0 (línea base):** solo *registrar* compras, merma, conteos de cierre y ventas perdidas. Sin alertas ni sugerencias, para medir el "antes".
- **Fase 2 (intervención):** recetas, stock teórico, alertas, sugerencia de compra y costeo.

El dueño hoy **no registra nada** de compras ni merma. Los insumos críticos son **pescado, calamar y mariscos** (lo demás lo compra en el mercado de al lado y casi nunca le falta). El caso típico de quiebre: se acaba el calamar y el "chicharrón de calamar" deja de venderse.

**Este encargo cubre la Capa 0 y la Capa 1 (Fase 0).** La Capa 2 está descrita al final solo como referencia: **no implementarla todavía.**

MauiDesk sigue en piloto con el cliente: se puede modificar la BD y desplegar, pero **todas las reglas de `CLAUDE.md` siguen vigentes** (migraciones aditivas e idempotentes en `migrate.ts` + `schema.ts`, `withWriteLock` + transacción, `validateBody` con Zod, `DomainError`, `audit()` en la misma transacción, toasts, sin `alert/confirm`, comentarios en español, sin punto y coma).

## 2. Capa 0 — Prerrequisitos

### 2.1 Separar "agotado" de "eliminado" (TD-31)
- Hoy `DELETE /api/menu/dishes/:id` con historial pone `available=false`, lo mismo que "agotado".
- Agregar columna aditiva `dishes.archived` (boolean, default false). El borrado con historial pone `archived=true` (no toca `available`) y registra `audit(... action: 'dish.archive')`.
- `GET /api/menu` y el POS excluyen platos `archived`. `MenuAdmin` no los lista (o los muestra aparte).
- `available=false` queda **solo** para "agotado". Así `audit_log` con `action='dish.availability'` es una medida limpia de quiebres.
- Test: borrar un plato con historial no cambia `available` y sí `archived`.

### 2.2 Backup y restauración
- Documentar en `DEPLOYMENT.md` el procedimiento de **restauración** del backup diario (hoy solo está el backup) y agregar un script `server/scripts/restore-backup.sh` que restaure un `.gz` a una ruta indicada sin pisar la BD activa.

## 3. Capa 1 — Registro mínimo (Fase 0)

### 3.1 Tablas nuevas (`schema.ts` + paso requerido en `migrate.ts`)

```
supplies                       -- catálogo de insumos
  id            integer PK
  name          text NOT NULL UNIQUE
  unit          text NOT NULL  enum: 'kg' | 'unit' | 'l'
  perishable    boolean default true
  critical      boolean default false   -- insumos que entran al estudio
  active        boolean default true
  created_at    text default datetime('now')

supply_purchases               -- compras
  id            integer PK
  supply_id     integer NOT NULL FK supplies
  quantity      real NOT NULL          -- en la unidad del insumo
  total_cost    real NOT NULL          -- S/ pagados (precio unitario = total/quantity)
  purchased_at  text NOT NULL          -- fecha local 'YYYY-MM-DD'
  notes         text
  created_by    integer FK users
  created_at    text default datetime('now')

supply_waste                   -- merma
  id            integer PK
  supply_id     integer NOT NULL FK supplies
  quantity      real NOT NULL
  reason        text NOT NULL  enum: 'deterioro' | 'sobra_comensal' | 'preparacion' | 'otro'
  wasted_at     text NOT NULL          -- fecha local
  notes         text
  created_by    integer FK users
  created_at    text default datetime('now')

supply_counts                  -- conteo físico de cierre
  id            integer PK
  supply_id     integer NOT NULL FK supplies
  quantity      real NOT NULL
  counted_on    text NOT NULL          -- fecha local
  created_by    integer FK users
  created_at    text default datetime('now')
  UNIQUE (supply_id, counted_on)       -- un conteo por insumo y día (re-registrar = corregir)

lost_sales                     -- "pidieron X y no había"
  id            integer PK
  dish_id       integer FK dishes      -- null si se registra por insumo
  supply_id     integer FK supplies    -- opcional
  quantity      integer default 1      -- porciones pedidas
  occurred_at   text default datetime('now')   -- UTC, como el resto
  created_by    integer FK users
```

Índices: por fecha en compras, merma y lost_sales; declarados también en `schema.ts` con el mismo nombre.

### 3.2 Endpoints (`server/src/routes/inventory.ts`, servicio `services/inventory.service.ts`, schemas `schemas/inventory.ts`)

| Método | Ruta | Roles | Nota |
|---|---|---|---|
| GET | `/api/inventory/supplies` | autenticado | activos |
| POST/PATCH | `/api/inventory/supplies[/:id]` | owner | audit en PATCH |
| GET | `/api/inventory/purchases?from&to` | owner, manager | |
| POST | `/api/inventory/purchases` | owner, manager | |
| PATCH/DELETE | `/api/inventory/purchases/:id` | owner, manager | **motivo obligatorio** + audit (igual que gastos) |
| GET/POST | `/api/inventory/waste` | owner, manager | |
| PATCH/DELETE | `/api/inventory/waste/:id` | owner, manager | motivo + audit |
| GET | `/api/inventory/counts?date` | owner, manager | |
| PUT | `/api/inventory/counts/:date` | owner, manager | upsert de varios insumos en una transacción |
| POST | `/api/inventory/lost-sales` | **cualquier rol** | lo usa el mozo desde el POS |
| GET | `/api/inventory/lost-sales?from&to` | owner, manager | |
| GET | `/api/inventory/export?from&to` | owner, manager | CSV por tabla para el análisis de la tesis |

Montarlo en `app.ts`. Validar cantidades > 0, costo ≥ 0, fechas `YYYY-MM-DD` (usar `utils/dates.ts`, día local de Lima).

### 3.3 Pantallas (cliente, pensadas para celular)

- **`/inventory`** (owner, manager), nueva entrada en `Layout`:
  - Pestaña **Compras**: formulario rápido (insumo, cantidad, total S/, fecha = hoy por defecto) + lista del día/semana.
  - Pestaña **Merma**: insumo, cantidad, motivo (botones grandes), fecha.
  - Pestaña **Cierre del día**: lista de insumos `critical` con un input numérico cada uno (`inputMode="decimal"`), un solo botón "Guardar conteo".
  - Pestaña **Insumos** (solo owner): CRUD del catálogo, marcar `critical`.
- **POS**: botón "No había" en el detalle del plato (y en platos agotados) → `POST /lost-sales`. Debe costar un toque; toast de confirmación.
- Reutilizar `ConfirmDialog` para borrar con motivo, toasts para errores, botones con estado "enviando".

### 3.4 Seed

Agregar al seed (solo si la tabla está vacía) los insumos iniciales: pescado (kg, critical), calamar (kg, critical), langostino, pulpo, conchas (critical), limón (kg), cebolla (kg), camote (kg), choclo (kg). El dueño los ajusta luego.

### 3.5 Tests (Vitest, siguiendo `helpers/http.ts`)

- Permisos por rol de cada endpoint (agregar a `permissions.test.ts`).
- Compra/merma: validación, borrado exige motivo y escribe `audit_log`.
- Conteo: upsert del mismo día reemplaza, no duplica.
- `lost-sales`: un mozo puede registrar; no puede listar.
- Export CSV: respeta el rango de fechas local.

### 3.6 Criterio de terminado

- `npm run ci` en verde.
- Migración probada sobre una copia de la BD de producción (arranca, no pierde datos).
- Flujo manual en celular: registrar compra, merma, cierre y "No había" en menos de 30 s cada uno.
- Actualizar `CLAUDE.md` (estructura, roles, endpoints), `docs/architecture/api.md` y `data-model.md`.
- Asignar los archivos nuevos al módulo correcto en `scripts/vault/build_vault.py` (crear módulo **"Inventario"**) y regenerar: `graphify update .` + `python scripts/vault/build_vault.py`.

## 4. Capa 2 — Intervención (NO implementar aún, solo referencia)

- **Recetas**: `recipe_items (dish_id, supply_id, quantity_per_portion)`.
- **Stock teórico**: inicial + compras − consumo por ventas (recetas × `order_items` cobrados) − merma; comparar con conteo físico (diferencia = merma no registrada).
- **Alertas** en el POS de stock bajo y "agotado" automático al llegar a 0.
- **Sugerencia de compra** diaria: pronóstico por día de la semana (promedio / promedio móvil / suavizado exponencial) + stock de seguridad − stock actual.
- **Costeo**: costo por plato con el último precio de compra, food cost %, margen por plato.
- **Panel de rentabilidad** con los indicadores de la tesis: % merma por insumo, quiebres (`dish.availability` en `audit_log`), ventas perdidas, food cost %, margen, utilidad (ventas − compras − `expenses`).

Para que la Fase 0 sirva de línea base, la Capa 2 debe poder activarse después **sin cambiar** cómo se registran los datos de la Capa 1.
