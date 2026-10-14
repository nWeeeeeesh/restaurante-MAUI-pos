# Plan: Inventario de insumos perecibles (tesis de rentabilidad) — v2.1

> Encargo para Claude Code. Léelo completo junto con `CLAUDE.md` antes de tocar código.
> Navegación: `graphify-out/obsidian/00 Inicio.md` y `Módulos/`.
> La v1 de este plan (capas 0 y 1) ya está implementada: commits `feee721`, `25028c9`, `8489a45`, `13b2b09`. Esta v2 **ajusta** lo construido; no lo reescribe.
> **v2.1** (§2.9): ajustes de diseño para que sea intuitivo y viable para dueño y cajero, decididos tras revisar la v2 en uso.

## 1. Contexto

### 1.1 La tesis
Cesar evalúa el **impacto de un sistema de inventario de insumos perecibles con pronóstico de demanda en la rentabilidad** de la Cevichería MAUI (Tacna). Diseño preexperimental con preprueba y posprueba:

- **Fase 0 — línea base (preprueba, ~8 semanas):** el sistema solo *registra*. Sin alertas, sin sugerencias.
- **Fase 1 — desarrollo:** recetas, stock teórico, pronóstico, panel (en paralelo con la fase 0).
- **Fase 2 — intervención (posprueba, ~8 semanas):** control y sugerencia de compra activos.

La rentabilidad se mide en cinco dimensiones: **merma**, **disponibilidad** (quiebres y ventas perdidas), **costo de insumos / ventas**, **margen** y **beneficio-costo**. Además se mide la **adherencia** (cuánto se usa realmente el sistema) y variables de control (día de la semana, feriados, precio por kg).

### 1.2 Decisiones que cambian respecto a la v1
1. **Una sola sucursal.** La tesis no depende del segundo local. No se construye nada multisucursal; solo se deja el dato `local_id` para no tener que mapear después.
2. **Cero sensación de "tarea".** Es el requisito principal de diseño:
   - Casi todo se **deriva** de lo que ya ocurre (ventas del POS, eventos de «agotado» en `audit_log`).
   - **Una sola interacción diaria obligatoria**, del dueño, en un momento que ya existe en su rutina: cuando vuelve de comprar.
   - Todo **prellenado**; el usuario solo confirma o corrige.
   - El mozo y el cajero **no hacen nada nuevo obligatorio**.
3. **Se elimina el conteo de cierre.** Se reemplaza por el conteo **antes de comprar** (apertura), dentro de la «Compra del día». Matemáticamente da el mismo consumo diario.
4. **Ventas perdidas: estimadas, no registradas.** Se calculan desde los intervalos de «agotado» y la venta habitual del plato. El botón «No había» queda como **opcional** (sirve para calibrar la estimación).
5. **El instrumento de medición se congela.** Antes de empezar la línea base se fija el diccionario de datos (§4) y el formato del CSV exportado. Si más adelante MAUI migra al producto (nwish-pos-core), debe seguir produciendo exactamente lo mismo.

### 1.3 Estado actual (lo que ya existe)
- Tablas: `supplies`, `supply_purchases`, `supply_waste`, `supply_counts` (hoy semántica «cierre»), `lost_sales`; `dishes.archived` separado de `available` (TD-31).
- API `/api/inventory/*`: CRUD de insumos, compras, merma, conteos (`PUT /counts/:date`), ventas perdidas, export CSV (incluye `stockouts` desde `audit_log`).
- Cliente: `/inventory` con pestañas Compras · Merma · Cierre · Insumos, export; botón «No había» en el POS.
- Restauración de backups documentada.

**La línea base aún no ha empezado.** Es el último momento para cambiar qué y cómo se registra.

## 2. Encargo (fase 0 v2)

Todas las reglas de `CLAUDE.md` siguen vigentes: cambios **aditivos** en `schema.ts` + paso idempotente en `migrate.ts`, `withWriteLock` + transacción, `validateBody`, `DomainError`, `audit()` en la misma transacción, toasts, sin `alert/confirm`, comentarios en español, sin punto y coma. Primero el test que reproduce cada regla nueva.

### 2.1 Modelo de datos (aditivo)
| Cambio | Detalle |
|---|---|
| `supplies.code` | texto, único, estable (`PESCADO`, `CALAMAR`, `PULPO`…). Migración: generar desde `name` (mayúsculas, sin tildes ni espacios) para los existentes. No editable desde la UI una vez creado. |
| `supplies.sort_order` | entero; orden en la «Compra del día». |
| `supply_purchases.supplier` | texto opcional (nombre libre del proveedor o puesto). |
| `local_id` | entero `NOT NULL DEFAULT 1` en `supply_purchases`, `supply_waste`, `supply_counts`, `lost_sales` y `day_notes`. **No se muestra en la UI.** |
| `supply_counts.moment` | `'apertura' \| 'cierre'`, default `'apertura'`. Los registros previos quedan como `'cierre'` (fueron pruebas; documentarlo). El índice único pasa a `(supply_id, counted_on, moment)`; declararlo igual en `schema.ts`. |
| tabla `day_notes` | `id`, `date` (YYYY-MM-DD, local), `kind` (`feriado` \| `cerrado` \| `evento` \| `proveedor` \| `otro`), `text`, `local_id`, `created_by`, `created_at`. Varias notas por día permitidas. |

Las fechas del hecho ya existen (`purchased_at`, `wasted_at`, `counted_on`) y la de registro es `created_at`: no tocar, pero el export debe incluir ambas.

### 2.2 «Compra del día» — la única pantalla obligatoria
Nueva pestaña **por defecto** en `/inventory` (owner, manager). Una lista con **solo los insumos `critical`**, en `sort_order`. Por cada insumo, una fila con tres campos:

| Campo | Significado | Prellenado |
|---|---|---|
| **Quedaba** | Stock físico **antes de comprar** (después de botar lo que no sirve) | Vacío la primera vez; luego el stock teórico si existe (fase 2), si no vacío |
| **Botaste** | Merma por deterioro descubierta al revisar | `0` |
| **Compraste** | Cantidad comprada hoy | **Vacío** (v2.1). Al lado se ofrece lo comprado el **mismo día de la semana anterior** (si no hay, la última compra) con un botón **[Usar]**: un toque, pero la compra la confirma el usuario. En fase 2: la sugerencia del sistema, con el mismo botón |

Más, por insumo comprado: **precio por kg/unidad**, prellenado con el último precio de ese insumo; el total se calcula solo (cantidad × precio) y es editable. Proveedor: un campo opcional plegado («+ proveedor»), que recuerda el último usado.

Al pie: **Notas del día** opcional (chips: feriado, evento, cambio de proveedor, otro + texto).

Un solo botón **Guardar**: `POST /api/inventory/daily` en **una transacción** que:
- hace upsert de `supply_counts` (`moment='apertura'`, `counted_on = fecha`);
- crea `supply_waste` con `reason='deterioro'` y `wasted_at = día operativo anterior` (lo que se bota en la mañana pertenece al periodo anterior; ver §4) solo si `botaste > 0`;
- crea `supply_purchases` solo si `compraste > 0`;
- crea `day_notes` si hay;
- es **idempotente por fecha**: volver a guardar el mismo día corrige (reemplaza lo creado por esta pantalla ese día), no duplica. Marcar el origen (`source='daily'`) en compras y merma para poder reemplazar solo lo suyo.

Requisitos de UX:
- Selector de fecha visible, por defecto hoy; se permite registrar hasta **7 días atrás** (si se olvidó un día).
- Inputs `inputMode="decimal"`, botones grandes, cero campos obligatorios salvo que si hay compra debe haber cantidad y precio.
- Meta: **≤ 60 s** para 5 insumos en un celular.
- Sin recordatorios insistentes: como máximo un indicador discreto en el `Layout` del dueño/encargado si **ayer** no tiene «Compra del día». Nada de toasts repetidos.

### 2.3 Lo que pasa a segundo plano
- Pestañas **Compras**, **Merma**, **Insumos** se mantienen como *detalle/corrección* (para compras de no críticos, otros motivos de merma, editar con motivo). No son parte de la rutina. *(v2.1: Compras y Merma se unen en **Historial**, ver §2.9.)*
- Pestaña **Cierre**: se quita de la navegación (el endpoint puede quedar; `moment='cierre'` sigue siendo válido).
- **«No había»** en el POS: se mantiene, explícitamente opcional (texto de ayuda breve). No agregar más pasos al mozo.

### 2.4 Quiebres de stock
- Permitir que **`cashier`** marque/desmarque «agotado» además de owner/manager (hoy solo owner/manager). Precios y altas siguen siendo del dueño. Actualizar la matriz en `permissions.test.ts` y en `CLAUDE.md`.
- El export `stockouts` debe dar intervalos: `dish_id`, `dish_name`, `inicio`, `fin` (o null si sigue agotado), `marcado_por`, `local_id`.

### 2.5 Export y diccionario (el instrumento congelado)
- Crear `docs/diccionario-datos-tesis.md` con el contenido de §4 y versión `v1`.
- Cada CSV lleva en la primera línea un comentario `# maui-tesis dataset v1 · tabla · desde · hasta · generado` y columnas en orden fijo, incluyendo `local_id`, fecha del hecho y `created_at`.
- Nuevas tablas exportables: `daily` (vista por día e insumo: quedaba, botaste, compraste, precio, total), `day_notes`.
- Un test que fije el encabezado de cada CSV (si cambia, el test falla a propósito).

### 2.6 Seed
Insumos iniciales con `code` y `sort_order`: PESCADO, CALAMAR, PULPO, LANGOSTINO, CONCHAS (critical); LIMON, CEBOLLA, CAMOTE, CHOCLO (no critical). Solo si la tabla está vacía.

### 2.7 Tests mínimos
- `POST /daily`: crea lo correcto; repetir el mismo día no duplica; `botaste=0` y `compraste=0` no crean filas; merma fechada el día operativo anterior; fecha > 7 días atrás → 400.
- Permisos: owner/manager pueden `/daily`; cashier y waiter no. Cashier sí puede marcar agotado.
- Migración: `code` generado para insumos existentes; registros previos de conteo quedan `moment='cierre'`.
- Encabezados de CSV fijos.

### 2.8 Terminado cuando
- `npm run ci` en verde.
- Migración probada sobre una copia de la BD de producción.
- Prueba manual en celular: «Compra del día» de 5 insumos en ≤ 60 s; corregir el mismo día no duplica.
- `CLAUDE.md`, `docs/architecture/api.md` y `data-model.md` actualizados; archivos nuevos asignados en `scripts/vault/build_vault.py` (módulo **Inventario**); `graphify update .` + `python scripts/vault/build_vault.py`.
- Desplegado en la Pi **antes** de iniciar la línea base (anotar la fecha de inicio en `day_notes`).

### 2.9 Ajustes de diseño v2.1 (implementados)

Revisión de la v2 en uso: el dueño registraba cada día sin recibir nada a cambio, el prellenado de compras podía guardar compras que no ocurrieron y marcar agotado quedaba lejos de quien se entera primero.

**Regla para la línea base:** en la fase 0 el sistema solo **refleja lo registrado**. Nada de alertas, colores de stock bajo, sugerencias, totales o tendencias de merma ni costeo: eso es la intervención (§3) y mostrarlo antes mezcla el "antes" con el "después".

| Cambio | Detalle | ¿Cambia el dataset v1? |
|---|---|---|
| **A. «Hoy empezaste con»** | Tarjeta en la pestaña Hoy, una vez guardada la compra del día: por insumo crítico, quedaba + compraste. Rotulada «no descuenta lo vendido» | No (es la suma de lo registrado) |
| **B. «Compraste» vacío + [Usar]** | La cantidad no se prellena; la compra de referencia se muestra con su fecha y un botón [Usar]. Precio y proveedor sí vienen prellenados (solo se usan si hay compra) | No; los datos quedan más limpios |
| **C. Agotado desde el POS** | Cajero, encargado y dueño marcan «Se agotó» en el detalle del plato y «Habilitar» en la tarjeta agotada. Evento `menu:availability`: los demás POS se actualizan sin recargar y el plato agotado sale de los borradores | No (sigue siendo `dish.availability`) |
| **D. Historial** | Compras y Merma se unen en una lista por día con filtros, «Otra compra» / «Otra merma» plegados y corrección con motivo. Sin totales | No (solo UI) |

Pestañas de `/inventory`: **Hoy** (por defecto) · **Historial** · **Insumos** (dueño).

**Para la fase 2 (no ahora):** «Ahora te queda ~N» en vivo (requiere recetas), aviso al mozo y existencias para el cajero. La carga de recetas puede hacerse en paralelo con la línea base porque el personal no la ve.

## 3. Fase 2 — referencia (NO implementar aún)

Se activa al terminar la línea base. Debe poder encenderse **sin cambiar** cómo se registra lo de la fase 0.

| Pieza | Para qué | Esfuerzo del usuario |
|---|---|---|
| **Recetas** (`recipe_items`: plato, insumo, cantidad por porción) | Consumo teórico y costo por plato | Una tarde de configuración (Cesar + dueño), solo platos con insumos críticos |
| **Stock teórico** = apertura + compras − consumo(ventas × receta) − merma | Prellenar «Quedaba»; la diferencia con lo contado revela merma no registrada y ajusta recetas | Ninguno |
| **Sugerencia de compra** = pronóstico por día de la semana + stock de seguridad − stock | Prellenar «Compraste» | Confirmar con un toque |
| **`purchase_suggestions`** (fecha, insumo, sugerido, modelo, creado) | **Adherencia** = comprado vs sugerido, sin preguntar nada | Ninguno |
| **Aviso al mozo** «quedan ~N» y agotado automático en 0 | Menos promesas incumplidas, menos ventas perdidas | Ninguno |
| **Antigüedad del lote** («el pescado del martes tiene 2 días») | Menos merma por deterioro | Ninguno |
| **Resumen semanal** al dueño (vendiste, botaste, plato más rentable, pérdida por agotados) | Convertir intuición en números | Leerlo |
| **Matriz de menú mensual** (popularidad × margen) | La palanca de margen más grande: precios y recomendación | Decidir |
| **Ventas perdidas estimadas** (venta habitual del plato en ese día y franja × duración del agotado) | Dimensión de disponibilidad | Ninguno |

## 4. Diccionario de datos v1 (resumen; el detalle va en `docs/diccionario-datos-tesis.md`)

- **Día operativo:** fecha local (America/Lima) en que el local atendió. Los días sin ventas no son operativos.
- **Apertura (`moment='apertura'`):** stock físico de un insumo crítico al inicio del día, antes de la compra y después de descartar lo deteriorado.
- **Merma por deterioro:** lo descartado al revisar en la mañana; se imputa al **día operativo anterior**.
- **Consumo real del día d** = apertura(d) + compras(d) − merma(d) − apertura(d+1).
- **Precio unitario** = `total_cost / quantity` de cada compra; para costeo se usa el promedio ponderado de la semana.
- **Quiebre:** intervalo en que un plato estuvo `available=false` (de `audit_log`, acción `dish.availability`).
- **Venta perdida registrada:** cada «No había» (opcional). **Venta perdida estimada:** se calcula en el análisis, no en el sistema (fase 0).
- **Registro tardío:** `created_at` − fecha del hecho > 1 día. Se reporta como indicador de constancia.
- Unidades: kg con 2 decimales, S/ con 2 decimales.
