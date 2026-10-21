# Plan: Inventario de insumos perecibles (tesis de rentabilidad) · v3

> Encargo para Claude Code. Léelo completo junto con `CLAUDE.md` antes de tocar código.
> Navegación: `graphify-out/obsidian/00 Inicio.md` y `Módulos/`.
> Diseño de la investigación (fuente de verdad): `docs/tesis/Plan_de_Tesis_MAUI_v3.docx`. Resumen para desarrollo: `docs/tesis/README.md`.
> **La v3 consolida y reemplaza a la v2.2.** La §2.10 de la v2.2 nunca se implementó: no la busques en el código; todo lo pendiente está aquí.
> Rigen las reglas de `CLAUDE.md`: cambios **aditivos** en `schema.ts` + paso idempotente en `migrate.ts`, `withWriteLock` + transacción, `validateBody`, `DomainError`, `audit()` en la misma transacción, toasts, sin `alert/confirm`, comentarios en español, sin punto y coma. **Primero el test** de cada regla nueva.

## 0. Entregas y fechas

| Entrega | Fecha límite | Contenido |
|---|---|---|
| **E1. Fase 0 v3** (instrumento final) | **Desplegada en la Pi antes del 2026-11-09** (inicio de la línea base) | Registro diario en dos partes, configuración del estudio por grupos, trazabilidad, traslados (ocultos hasta habilitarse), otros insumos, export de ventas, diccionario v1 final |
| **E2. Segundo local** | Antes de su apertura (prevista ~2026-12-28) | Segunda instancia con `MAUI_LOCAL_ID=2`, catálogo copiado, traslados habilitados en ambos locales |
| **E3. Fase 2** (intervención) | Desplegada y probada **antes del 2027-01-11**, sin ningún grupo activo | Recetas calibradas, stock teórico, pronóstico en segundo plano, lista de compra, avisos, propuesta de agotado, panel por grupo |
| **E4. Fin del estudio** | 2027-04-05 (automático por fecha) | Se activan los mariscos y se muestran los indicadores globales |

Prioridad absoluta: **E1**. Si algo no alcanza para el 9 de noviembre, se recorta de E1 lo que no sea instrumento (por ejemplo, estilos), nunca lo que se registra.

## 1. Contexto

### 1.1 La tesis, en lo que afecta al código
Título: «Sistema de gestión de insumos perecibles con pronóstico de demanda integrado al punto de venta y su efecto en la rentabilidad operativa de la cevichería MAUI, Tacna».

- **Unidad de estudio:** el local principal (`local_id = 1`). El segundo local solo aporta datos descriptivos y el costo de replicación.
- **Diseño:** series de tiempo interrumpidas con grupo de comparación y activación escalonada.
  - Grupos por familia de insumo (`study_group`): `calamar` (CALAMAR), `pescado` (PESCADO), `mariscos` (PULPO, LANGOSTINO, CONCHAS).
  - Calamar y pescado se activan en el orden que salga del sorteo: el primero el **2027-01-11** (semana 10) y el segundo el **2027-02-01** (semana 13).
  - **Mariscos es el grupo de comparación:** no recibe nada de la intervención hasta el fin del estudio (se activa el 2027-04-05).
  - Línea base desde el **2026-11-09**. Fin de la recolección: **2027-04-04**.
- **Indicador principal (se calcula en el análisis, no en el sistema):** utilidad bruta atribuible a cada grupo por semana = ventas de los platos con esos insumos (asignadas según el costo de la receta) − costo de los insumos consumidos, a precios constantes. Necesita del sistema: ventas por plato y hora, ingresos y conteos por insumo, recetas.
- **Controles que salen de los datos:** ventas de bebidas y de platos sin insumos críticos (afluencia), día de la semana, `day_notes` (feriados, Cuaresma, Semana Santa, ausencia del dueño), precio por kg.
- **Condición previa:** desde el 9 de noviembre, **todas** las ventas del local 1 se registran en MauiDesk.

### 1.2 Invariantes del instrumento (no negociables)
1. **Registro idéntico en todas las fases.** La «Compra del día» nunca muestra sugerencias, stock teórico, alertas ni nada de la fase 2. `GET /daily/:date` responde igual antes y después de activar un grupo (hay test).
2. **Nada de la intervención llega a un grupo antes de su fecha**, ni al grupo de comparación durante el estudio. Toda función de la fase 2 pasa por `isGroupActive(group, date)`.
3. **«Agotado» lo confirma siempre una persona** durante el estudio. La fase 2 solo propone.
4. **Indicadores del negocio en conjunto ocultos** mientras `date <= study_ends_on` (o si no está configurado).
5. **Trazabilidad:** cada parte del registro guarda autor, hora, duración y si cada valor se escribió o se copió de la referencia.
6. **Export congelado desde el 2026-11-09.** Hasta esa fecha se puede cambiar la versión `v1` del dataset (y su test de encabezados) para incluir lo de E1; desde ese día, cualquier cambio exige `v2`.
7. **Sin servidor central:** cada local tiene su instancia y su base; `local_id` sale de la variable de entorno `MAUI_LOCAL_ID` (por defecto 1).

### 1.3 Estado actual (implementado)
- v1 (capas 0 y 1): `feee721`, `25028c9`, `8489a45`, `13b2b09`.
- v2 (fase 0): `a220021`, `4a190fe`, `407ebc1`. «Compra del día» (`POST /inventory/daily`, idempotente con `source='daily'` y `source_date`), `supply_counts.moment`, `day_notes`, `supplies.code` y `sort_order`, `local_id` con default 1, export v1 congelado (`inventory-export.service.ts`, `DATASET_VERSION='v1'`).
- v2.1: `98709ee`, `705037b`, `7147d32`. Pestañas Hoy · Historial · Insumos; «Compraste» vacío con [Usar]; cajero marca «Se agotó» desde el POS (evento `menu:availability`); en la línea base no se muestran alertas, totales ni costeo.
- **No implementado:** todo lo de este plan.

## 2. E1 · Fase 0 v3 (antes del 2026-11-09)

### 2.1 Modelo de datos (aditivo)

| Cambio | Detalle |
|---|---|
| `supplies.study_group` | `'calamar' \| 'pescado' \| 'mariscos'` o null. La migración lo asigna por `code` cuando es null (CALAMAR → calamar; PESCADO → pescado; PULPO, LANGOSTINO, CONCHAS → mariscos). |
| tabla `study_config` | `key` (PK), `value`, `updated_by`, `updated_at`. Claves: `baseline_starts_on`, `study_ends_on`, `activation_order` (p. ej. `pescado,calamar`), `activates_calamar`, `activates_pescado`, `activates_mariscos`, `second_local_opens_on`, `protocol_url`. Fechas `YYYY-MM-DD`, hora de Lima. |
| tabla `daily_parts` | `id`, `date`, `local_id`, `part` (`'apertura' \| 'compra'`), `completed_by`, `completed_at`, `duration_ms`, `is_correction`, `client_version`. Una fila por guardado de cada parte. Índice `(date, local_id, part)`. |
| `entry_mode` | `'typed' \| 'copied' \| 'default'` en `supply_counts`, `supply_waste` y `supply_purchases` (cantidad), y `price_entry_mode` en `supply_purchases`. `copied` = vino de [Usar] o del precio prellenado sin cambiar; `default` = no se tocó (Botaste en 0). |
| tabla `supply_transfers` | `id`, `date`, `supply_id`, `direction` (`'envio' \| 'recepcion'`), `quantity`, `unit_cost` (opcional en recepción), `other_local_id`, `local_id`, `source`, `entry_mode`, `created_by`, `created_at`. Cada instancia registra solo su lado; la conciliación se hace en el análisis por fecha y `code`. |
| tabla `other_supply_costs` | `id`, `date`, `amount`, `local_id`, `source`, `entry_mode`, `created_by`, `created_at`; único `(date, local_id, source)`. Monto en S/ de todo lo no crítico del día. |
| `day_notes.kind` | Agregar `'dueno_ausente'` al enum (Drizzle y Zod). Chip «El dueño no estuvo». |
| `MAUI_LOCAL_ID` | Variable de entorno (default 1) que se escribe en `local_id` de todo lo nuevo. Documentarla en `.env.example` y `DEPLOYMENT.md`. |

### 2.2 «Compra del día» en dos partes
La pestaña **Hoy** se divide en dos tarjetas que se guardan por separado. Cualquiera de los dos roles (`owner`, `manager`) puede llenar cualquiera de las dos; lo que importa es que quede registrado **quién y cuándo**.

**Parte A · «Al abrir»** (normalmente el encargado):
- Por insumo crítico, en `sort_order`: **Quedaba** (vacío, obligatorio para guardar la parte; ayuda: «cuenta o pesa antes de que llegue la compra») y **Botaste** (0 por defecto; ayuda: «pésalo en la balanza»).
- Notas del día (chips): feriado, evento, cerrado, proveedor, otro y **«El dueño no estuvo»**.

**Parte B · «Al volver de comprar»** (normalmente el dueño):
- Por insumo crítico: **Compraste** (vacío + [Usar] con la compra del mismo día de la semana anterior, como hoy) y **precio por kg** (prellenado con el último precio).
- Proveedor plegado, como hoy.
- **Otros insumos del día (S/):** un campo vacío con [Usar]. Ayuda: «todo lo demás que compraste hoy para este local (limón, cebolla, abarrotes…), sin contar lo de arriba».
- Solo si `second_local_opens_on <= fecha`:
  - En el local 1: **Enviaste al otro local** por insumo (vacío = 0).
  - En el local 2: **Recibiste del local principal** por insumo, además de «Compraste» por si se compra ahí.

**Reglas:**
- `POST /api/inventory/daily` recibe `part: 'apertura' | 'compra'` y `duration_ms`. Cada parte es idempotente por `(date, part)` y reemplaza solo sus propias filas (`source='daily'`). Una parte no borra lo de la otra.
- En la misma transacción: filas de la parte, fila en `daily_parts` (`is_correction` si ya existía esa parte para la fecha) y `audit()`.
- Merma imputada al día operativo anterior, como hoy. Fechas hasta 7 días atrás, como hoy.
- La tarjeta muestra el estado de la otra parte: «Al abrir ✓ (nombre, 08:10) · Al volver de comprar: pendiente».
- `duration_ms`: del primer render de la tarjeta al guardado exitoso.
- El indicador discreto de «ayer falta» se mantiene, por parte.
- **Invariante 1:** nada de la fase 2 aparece aquí.

**Definición nueva (diccionario):** ingresos del día al local = compras − enviado + recibido. Consumo real(d) = apertura(d) + ingresos(d) − merma(d) − apertura(d+1).

### 2.3 Configuración del estudio
- **`PUT /api/inventory/study`** (solo `owner`): escribe `study_config` en una transacción con `audit('study.configure')` (antes y después).
  - Bloqueos: no se puede cambiar la fecha de activación de un grupo que ya llegó (`DomainError('study.activation_locked')`) ni `baseline_starts_on` una vez alcanzada.
  - Validación: `activates_mariscos` > `study_ends_on`.
- **`GET /api/inventory/study`** (`owner`, `manager`): configuración y, por grupo, `{ group, activates_on, active_today, supplies: [codes] }`.
- **Helpers** en `inventory.service.ts` (o un `study.service.ts`):
  - `isGroupActive(group, date)`: `true` si hay fecha de activación para ese grupo y `date >= fecha`.
  - `areGlobalIndicatorsVisible(date)`: `true` solo si `study_ends_on` existe y `date > study_ends_on`.
  - Fechas siempre en hora de Lima (cuidado con la medianoche UTC; hay test).
- **UI:** sección «Estudio» en la pestaña Insumos, solo para el dueño. Fechas, orden sorteado y apertura del segundo local; confirmación con el modal de la app. Para el resto, el grupo de cada insumo y su fecha de activación en solo lectura.
- **Valores que se cargarán** (los pone Cesar tras el sorteo, no van en el seed): línea base 2026-11-09; primer grupo 2027-01-11; segundo 2027-02-01; mariscos 2027-04-05; fin 2027-04-04; segundo local ~2026-12-28. Si la apertura se posterga, todas las fechas se corren una sola vez antes de la primera activación.

### 2.4 Quiebres y ventas
- `dish.availability` en `audit_log` guarda `source: 'manual'` (la fase 2 agregará `'propuesta_confirmada'`).
- Export `stockouts`: agregar la columna `origen`.
- **Export nuevo `sales`**, una fila por ítem vendido:
  - columnas `local_id`, `fecha`, `hora`, `boleta_id`, `plato_id`, `plato`, `categoria_id`, `categoria`, `cantidad`, `precio_unitario`, `total`, `anulado`;
  - fecha y hora del cobro, en hora de Lima.
  - Es la base del indicador principal, del control de afluencia (bebidas) y del quiebre inferido (cuándo deja de venderse un plato). Revisa los nombres reales en `schema.ts` (`bills.paid_at`, `order_items`, `dishes.category_id`) y respeta cancelaciones y correcciones de la v1.1.

### 2.5 Export y diccionario (versión v1 final)
- **Tablas nuevas exportables:** `study_config`, `daily_parts`, `transfers`, `other_costs` y `sales`.
- **Columnas nuevas:**
  - `daily`: `apertura_por`, `apertura_en`, `compra_por`, `compra_en`, `enviaste`, `recibiste`, `modo_quedaba`, `modo_compraste`, `modo_precio`;
  - `purchases`, `counts` y `waste`: `modo_entrada`;
  - `supplies`: `grupo`;
  - `stockouts`: `origen`.
- Actualizar `docs/diccionario-datos-tesis.md` con:
  - las definiciones nuevas: grupo, estado de activación, ingresos, parte del registro, modo de entrada, otros insumos, traslado, dueño ausente;
  - las columnas nuevas;
  - la nota de que el indicador principal y los precios constantes se calculan en el análisis.
- Se mantiene `DATASET_VERSION = 'v1'` (la línea base aún no empezó). Actualiza el test de encabezados. En la cabecera del diccionario, escribir «congelado el 2026-11-09».

### 2.6 Tests mínimos (además de los existentes)
- **Partes del registro:**
  - cada parte es idempotente;
  - guardar la parte B no borra la A, ni al revés;
  - `daily_parts` marca `is_correction`;
  - los modos de entrada se guardan;
  - `duration_ms` se guarda.
- **Otros insumos y traslados:**
  - `other_supply_costs` es idempotente;
  - los traslados solo se aceptan si `second_local_opens_on <= fecha`;
  - el local 1 solo crea `envio` y el local 2 solo `recepcion`, según `MAUI_LOCAL_ID`.
- **Invariante 1:** `GET /daily/:date` es idéntico antes y después de activar un grupo.
- **Configuración del estudio:**
  - `PUT /study` solo lo usa el dueño;
  - bloquea tras la fecha;
  - deja audit;
  - rechaza `activates_mariscos <= study_ends_on`.
- **Helpers:**
  - `isGroupActive`: el día anterior es falso y el mismo día es verdadero; borde de medianoche Lima/UTC;
  - `areGlobalIndicatorsVisible` es falso sin configuración y hasta `study_ends_on` inclusive.
- **Export:**
  - encabezados nuevos fijados;
  - `sales` excluye o marca los ítems anulados según la regla documentada.
- **Migración:** `study_group` asignado por código; `kind='dueno_ausente'` válido.

### 2.7 Terminado cuando
- `npm run ci` en verde; migración probada sobre una copia de la BD de producción.
- Prueba en celular: cada parte en 60 s o menos según `duration_ms`; corregir una parte no duplica ni toca la otra.
- `CLAUDE.md` (sección Inventario y matriz de permisos), `docs/architecture/api.md`, `data-model.md`, `DEPLOYMENT.md` (`MAUI_LOCAL_ID`) y el diccionario actualizados.
- Archivos nuevos asignados en `scripts/vault/build_vault.py` (módulo Inventario); `graphify update .` y luego `python scripts/vault/build_vault.py`.
- Desplegado en la Pi **antes del 2026-11-09**.
- Checklist operativo para Cesar (no es código; déjalo listado en tu resumen final):
  - sorteo del orden;
  - estudio configurado;
  - personal capacitado (balanza y «Se agotó»);
  - todas las ventas pasan por MauiDesk;
  - nota `otro` «inicio de la línea base» el 2026-11-09.

## 3. E2 · Segundo local (antes de su apertura, ~2026-12-28)
- Instalar una segunda Raspberry Pi con la misma versión y `MAUI_LOCAL_ID=2`, con su propia base. Documentar el procedimiento en `DEPLOYMENT.md`.
- Copiar el catálogo (insumos con los **mismos `code`**, categorías, platos) con un script de exportar e importar catálogo que respete `code`. No se copian ventas ni registros.
- En ambas instancias: `second_local_opens_on`. En el local 2 **no** se configuran activaciones: allí todo es descriptivo.
- Crear `docs/tesis/replicacion-local-2.md` con una tabla para que Cesar anote horas, hardware y capacitación (costo de replicación `c` de la tesis).

## 4. E3 · Fase 2 (desarrollo en las semanas 1 a 9; desplegada antes del 2027-01-11 sin grupos activos)
Todo actúa **solo sobre grupos activos** (`isGroupActive`), salvo el registro del pronóstico en segundo plano. Mientras ningún grupo esté activo, el personal no debe notar ningún cambio.

| Pieza | Regla |
|---|---|
| **Recetas** (`recipe_items`: `dish_id`, `supply_id`, `grams_per_portion`) | UI para dueño y encargado. Se cargan durante la línea base; el personal no lo ve. |
| **Calibración** (`recipe_calibrations`: `supply_id`, `factor`, `from`, `to`, `computed_at`) | Factor por insumo = consumo real / consumo teórico (recetas × ventas) en las semanas de línea base. Se calcula con un comando o un botón del dueño, queda guardado y se exporta. El stock teórico usa recetas × factor. |
| **Stock teórico** = apertura + ingresos − consumo calibrado − merma | Solo para avisos y «quedan ~N». **Nunca prellena «Quedaba».** |
| **Nivel de servicio** (`supplies.service_level`, p. ej. 0.85) | Lo fija el dueño por insumo según cuánto cuesta quedarse corto frente a excederse. |
| **Pronóstico → `purchase_suggestions`** | Columnas `target_date`, `supply_id`, `forecast_kg`, `safety_stock_kg`, `available_kg`, `suggested_kg`, `model`, `model_version`, `shown`, `local_id`, `created_at`; único `(supply_id, target_date, model_version)`. Job diario a las 23:30 de Lima, más generación bajo demanda. Se guarda para **todos** los críticos con `shown = isGroupActive(grupo, target_date)`. Modelo intercambiable; empezar con el promedio de los mismos días de las últimas 4 semanas sobre el consumo real, más las ventas perdidas estimadas en kg. El modelo final se elige fuera del sistema por MASE. Stock de seguridad según el error histórico y `service_level`. |
| **«Lista de compra»** (dueño, encargado) | Pantalla aparte, solo grupos activos, con botón para imprimir en la ticketera ESC/POS. Nunca dentro de la «Compra del día». |
| **Aviso en el POS** «quedan ~N porciones» | Solo platos cuyo insumo pertenece a un grupo activo. |
| **Propuesta de agotado** | El cajero o el encargado la confirma con un toque, y `dish.availability` queda con `source='propuesta_confirmada'`. Nunca se marca solo: `auto_mark_enabled` apagado y bloqueado hasta después de `study_ends_on`. |
| **Panel por grupo** (quiebres, food cost, merma, utilidad atribuible del grupo) | Solo grupos activos. |
| **Panel global** (food cost total, margen y utilidad del local, resumen semanal) | Solo si `areGlobalIndicatorsVisible(hoy)`; si no, «disponible al terminar el estudio». |

**Export:** `purchase_suggestions`, `recipe_items` y `recipe_calibrations`. Como es posterior al congelamiento, se agrega como tablas nuevas sin tocar las existentes y se documenta en el diccionario como **adenda v1.1**. No se cambian columnas existentes.

**Tests:**
- sugerencias de grupos inactivos guardadas con `shown=0` y fuera de la lista;
- sin avisos para grupos inactivos (incluido mariscos durante el estudio);
- la propuesta no cambia la disponibilidad sin confirmación;
- el panel global está oculto;
- la «Compra del día» no cambia al activar.

## 5. E4 · Fin del estudio
Sin código nuevo. Por fecha:
- el 2027-04-05, mariscos queda activo;
- desde el día siguiente a `study_ends_on`, se ven los indicadores globales;
- `auto_mark_enabled` puede encenderlo el dueño si quiere.

## 6. Lo que no se construye
- Servidor central o consolidación entre locales.
- Optimización de la distribución entre locales (trabajo futuro de la tesis).
- Matriz de menú.
- Antigüedad del lote (se resuelve rotulando las bolsas con la fecha).
- Comparación con POS comerciales.
- Facturación SUNAT.

## 7. Calendario de referencia

| Semana | Fechas | Hito |
|---|---|---|
| antes | hasta el 08-nov | E1 desplegada; sorteo; estudio configurado; capacitación |
| 1 a 6 | 09-nov a 20-dic | Línea base de los tres grupos; carga de recetas |
| 7 y 8 | 21-dic a 03-ene | Fiestas; apertura del local 2 (E2) |
| 9 | 04 a 10-ene | Adaptación; E3 desplegada sin grupos activos; protocolo registrado |
| 10 | 11-ene | Se activa el primer grupo sorteado |
| 13 | 01-feb | Se activa el segundo grupo |
| 14 a 20 | 08-feb a 28-mar | Cuaresma y Semana Santa (notas del día) |
| 21 | hasta 04-abr | Fin de la recolección |
| 22 | 05-abr | Mariscos activo; indicadores globales visibles |

Durante el estudio no se cambia la «Compra del día» salvo errores; cualquier cambio visible para el personal se anota en `day_notes` (`kind='otro'`).
