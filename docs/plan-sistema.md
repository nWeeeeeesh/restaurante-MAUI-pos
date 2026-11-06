# Plan de implementación: sistema completo (incrementos 2 y 3)

> **Para Claude Code.** Este plan completa MauiDesk para la tesis «Sistema de pronóstico de demanda y cálculo de rentabilidad operativa para la cevichería MAUI empleando el modelo incremental». Ejecútalo **en orden, una tarea a la vez**. Cada tarea tiene objetivo, archivos, pasos, criterios de aceptación y verificación. No pases a la siguiente si la verificación falla: corrige o detente y reporta.
>
> Redactado el 2026-11-05 a partir de la rama `feat/inventario-fase0` (commit `d77aab2`), del Capítulo III de la tesis (v0.2.11) y de la implementación de referencia en Python usada en la tesis.

---

## 0. Cómo trabajar

1. Lee primero `CLAUDE.md`, `docs/architecture/architecture.md`, `server/src/db/schema.ts`, `server/src/db/migrate.ts`, `server/src/services/inventory-daily.service.ts`, `server/src/utils/study.ts` y `server/src/__tests__/helpers/`.
2. Trabaja en la rama `feat/sistema-completo`, creada desde `feat/inventario-fase0`. **No** hagas merge a `main` ni despliegues.
3. **Un commit por tarea**, con el formato `tipo(ámbito): Tn — descripción` (por ejemplo, `feat(costeo): T6 — fórmulas de costeo puras con pruebas PU`). Antes de cada commit: `npm run ci` en verde.
4. Marca la casilla de la tarea en este archivo (`- [x]`) en el mismo commit.
5. Cada prueba nueva lleva en su nombre el ID del requisito o del caso entre corchetes, por ejemplo `it('[PU-07][RF09] factor de calibración', …)`. La tarea T22 genera con eso la matriz de trazabilidad para el Capítulo IV.
6. Reglas que no se negocian:
   - **Cambios aditivos al esquema (RNF07):** solo `CREATE TABLE IF NOT EXISTS` y `ALTER TABLE … ADD`. Nunca borres ni renombres columnas o tablas existentes; las que quedan sin uso se marcan como obsoletas en un comentario.
   - **RD01:** el conteo de apertura nunca se prellena con el stock teórico ni muestra sugerencias. `GET /api/inventory/daily/:date` responde igual con o sin pronóstico (hay prueba).
   - **RD02:** un plato solo queda agotado si una persona lo confirma.
   - **RD04:** un pronóstico guardado no se modifica.
   - **RD06:** cada local tiene su instancia; todo registro nuevo lleva `local_id`.
   - El servidor es la única autoridad de los cálculos; el cliente solo muestra.
7. Si algo de este plan contradice el código real, gana el código: ajusta la tarea, anótalo en la sección «Desviaciones» al final y sigue.

## 1. Decisiones ya tomadas (no reabrir)

| Tema | Decisión |
|---|---|
| Metodología de la tesis | Modelo incremental. Incremento 1 (registro) ya existe; este plan construye el 2 (rentabilidad) y el 3 (pronóstico). |
| Estudio por grupos (plan v3) | Se **retira**: ya no hay preprueba ni posprueba. Los traslados se habilitan con una fecha de apertura del segundo local (ajuste normal). |
| Datos | No hay datos reales del periodo. Se usan **12 semanas de datos simulados** (72 días de atención, martes a domingo), deterministas y versionados en el repositorio. |
| Selección del método de pronóstico | El sistema prueba cuatro métodos y elige, por insumo, el de menor **MAE** con origen móvil en los últimos días de atención (no se usa MASE). |
| Cuándo calcula | Rentabilidad: al consultarla. Pronóstico y lista de compra: tarea nocturna, más ejecución a pedido. |
| Referencia en Python | `scripts/tesis/` (solo biblioteca estándar). Genera los resultados esperados en JSON, que se versionan; las pruebas de Vitest comparan contra ellos y no necesitan Python. |
| Gastos (RF06) | Cada categoría de gasto se clasifica como fija o variable, editable por el propietario; por defecto, fija. |
| Insumos críticos | Pescado (`PESCADO`), calamar (`CALAMAR`), mixtura de mariscos (`MIXTURA`) y limón (`LIMON`). Pulpo, langostino y conchas pasan a otros insumos. |

## 2. Arquitectura objetivo

```
client/src/api/<modulo>.ts        llamadas HTTP tipadas (sin lógica)
client/src/hooks/use<Modulo>.ts   estado de carga, error y datos
client/src/pages/...              solo presentación
        │  HTTP (asíncrono)
server/src/routes/<modulo>.ts     requireAuth → requireRole → validate (Zod) → servicio → respuesta
server/src/services/<modulo>.service.ts   coordina: recibe (ex: Executor, ctx: { localId, ... }), llama al repositorio y al dominio
server/src/repositories/<modulo>.repo.ts  ÚNICO que conoce el esquema: consultas por lote para todo el periodo
server/src/domain/<modulo>.ts     funciones PURAS: sin db, sin process.env, sin reloj; reciben todo por parámetro
server/src/jobs/nightly.ts        tarea nocturna (pronóstico)
```

Reglas:
- `domain/` no importa nada de `db/`, `services/`, `utils/local` ni usa `new Date()` sin parámetro. Son las fórmulas de la tesis, una función por fórmula, y se prueban con los casos PU.
- Los repositorios leen **una vez por tabla y periodo** (sin consultas por día ni por insumo dentro de bucles).
- Los servicios reciben `ex: Executor` (por defecto `db`), el `localId` y el periodo como parámetros; no leen `process.env` (el `localId` lo resuelve la ruta con `currentLocalId()`).
- Este es el diseño que muestra la nueva Figura 12 de la tesis: `PanelRentabilidad → ProfitabilityRouter → ProfitabilityService → ProfitabilityRepository → Base de datos`, y `ProfitabilityService → Calculadora (domain/costing)`.

### Convenciones de dominio
- **Unidad de compra:** kg del insumo tal como se compra (pescado entero). La receta se guarda en **gramos de producto limpio** y se convierte con el rendimiento: `kg por porción = g / 1000 / rendimiento`.
- **Día de atención:** fecha local `YYYY-MM-DD` con ventas, o sin ventas pero sin nota `cerrado`; el local atiende de martes a domingo. Las series del pronóstico usan solo días de atención (estacionalidad m = 6).
- **Merma por deterioro:** la de la «Compra del día» ya se imputa al día operativo anterior (`supply_waste.wasted_at`). Usa esa fecha.
- **Redondeo:** se calcula en precisión completa; `roundMoney` solo al responder.
- **Periodo sin ventas:** food cost y ventas de equilibrio son `null` («no aplica»), nunca `NaN` ni error.

---

## Fase A. Cierre del incremento 1 y limpieza

### - [x] T1. Rama y línea base
- `git switch -c feat/sistema-completo` desde `feat/inventario-fase0`.
- Ejecuta `npm run ci` y anota en «Desviaciones» el número de pruebas que pasan (esperado: 174).

**Acepta:** rama creada; CI en verde.

### - [x] T2. Retirar el estudio por grupos
**Objetivo:** que el código ya no dependa del diseño cuasi experimental.

Pasos:
1. Crea la tabla `app_settings (key TEXT PRIMARY KEY, value TEXT, updated_by INTEGER, updated_at TEXT)` en `schema.ts` y `migrate.ts`. Migra, si existe, la clave de apertura del segundo local desde `study_config` a `app_settings.second_local_opened_on` (paso idempotente).
2. Nuevo `services/settings.service.ts`: `readSettings(ex)`, `saveSettings(ex, input, userId)` con auditoría. Reemplaza `transfersEnabledIn(readStudyConfig…)` por `transfersEnabled(settings, date)` (función pura en `domain/settings.ts`).
3. Elimina `isGroupActive`, `areGlobalIndicatorsVisible`, `studyOverview`, `saveStudyConfig`, la restricción de `inventory.service.updateSupply` que impide desactivar insumos «durante el estudio», las rutas `GET/PUT /api/inventory/study` (reemplázalas por `GET/PUT /api/settings`, solo propietario para escribir) y `client/src/pages/inventory/StudySection.tsx` (reemplázala por una sección «Ajustes» con la fecha de apertura del segundo local).
4. Deja `study_config` y `supplies.study_group` en la base, sin uso, con un comentario `// Obsoleto desde T2: el estudio por grupos se retiró`.
5. Actualiza o elimina `__tests__/study.test.ts` y ajusta `inventory.transfers.test.ts` a la nueva configuración.
6. Docs: en `CLAUDE.md` reemplaza el párrafo «Excepción: inventario de la tesis» por uno que apunte a este plan y diga que la tesis evalúa el desarrollo con el modelo incremental. Agrega al inicio de `docs/plan-inventario-tesis.md` y de `docs/tesis/README.md`: «Superado por docs/plan-sistema.md (2026-11-05)».

**Acepta:** `grep -rn "isGroupActive\|studyOverview\|study_group" server/src client/src` solo encuentra comentarios de obsolescencia o el esquema; los traslados siguen rechazándose antes de la fecha de apertura; CI en verde.

### - [x] T3. «Hoy no compré» (RF02, PI-02)
1. Agrega `daily_parts.no_purchase INTEGER NOT NULL DEFAULT 0` (aditivo).
2. En la parte «compra» de `saveDaily`, acepta `noPurchase: boolean`. Si es `true`, no exige ítems, guarda la fila de `daily_parts` con `no_purchase = 1` y deja los ítems críticos en 0 con modo `default`. Una compra posterior del mismo día (otro guardado) vuelve `no_purchase` a 0.
3. En el cliente, un botón «Hoy no compré» en la tarjeta «Al volver de comprar».
4. Exporta la columna en la tabla `daily_parts` del export (sube la versión del dataset, ver T21).

**Acepta:** prueba `[PI-02][RF02]` que cubre la marca y su reversión; CI en verde.

### - [x] T4. Servicios de inventario con el ejecutor por parámetro
1. Los servicios de `inventory*.service.ts` y `settings.service.ts` reciben `ex: Executor = db` como primer parámetro, como ya hacen `order.service` y `report.service`. Las rutas pasan `db`.
2. Extrae los cálculos de `getDaily` (totales, precio unitario, referencia) a funciones puras en `domain/daily.ts`.
3. Cambia `purchaseReference` para leer las compras de todos los insumos en una sola consulta.

**Acepta:** sin cambios de comportamiento (las pruebas existentes pasan sin tocarlas, salvo la firma); `getDaily` hace una cantidad fija de consultas, sin importar el número de insumos.

---

## Fase B. Datos simulados e implementación de referencia

### - [x] T5. Simulador de 12 semanas e implementación de referencia en Python
**Objetivo:** un conjunto de prueba determinista y los resultados esperados para las pruebas de paridad.

Archivos nuevos:
- `scripts/tesis/simulador.py`: solo biblioteca estándar (`random` con semilla fija `20260610`, `csv`, `json`, `math`, `statistics`).
- `scripts/tesis/referencia.py`: las fórmulas de la sección 4 de este plan, en Python estándar (sin numpy, pandas ni statsmodels).
- `scripts/tesis/README.md`: cómo regenerar.
- `server/src/__tests__/fixtures/sim12/`: los CSV y `esperado.json` generados (versionados).

Insumos del simulador (vienen de la tesis):
- **Carta:** `carta_maui.csv` (35 platos y 7 bebidas, 51 variantes) y **recetas aprobadas** `recetas_aproximadas.csv` (44 variantes con gramos de producto limpio de pescado, calamar, mixtura y limón). Ya están en `scripts/tesis/datos/`, junto con `modelo_referencia_v0211.py`, la referencia anterior de la tesis (usa pandas y statsmodels): sirve de guía, pero la nueva referencia debe usar solo la biblioteca estándar y el Holt-Winters de la sección 4.2.
- **Insumos** (Tabla 1 y Tabla 20 de la tesis):

| Código | Rendimiento | Vida útil (días) | Nivel de servicio | Precio base (S/ por kg) |
|---|---|---|---|---|
| PESCADO | 0.80 | 7 | 0.99 | 10 (8 a 12) |
| CALAMAR | 1.00 | 6 | 0.90 | 5.50 (5 a 10) |
| MIXTURA | 1.00 | 3 | 0.95 | 28 (25 a 32) |
| LIMON | 1.00 | 10 | 0.95 | 4 (2.5 a 8) |

- **Calendario:** del martes 2026-06-16 al domingo 2026-09-06 (12 semanas, 72 días de atención; lunes cerrado). Incluye al menos un feriado (`day_notes.kind = 'feriado'`, 2026-07-28 y 2026-07-29) con +30 % de demanda.
- **Demanda por plato:** Poisson con media = base del plato × factor del día de la semana (mar 0.8, mié 0.8, jue 0.9, vie 1.1, sáb 1.6, dom 1.8) × factor de feriado. Las bases se calibran para que las ventas diarias queden entre S/ 900 y S/ 1 100 de lunes a jueves y se dupliquen el fin de semana.
- **Compras:** martes, jueves y sábado; cantidad = consumo esperado hasta la siguiente compra × (1 + ruido uniforme ±15 %), redondeada a 0.5 kg; precio con variación diaria acotada al rango.
- **Consumo real:** porciones × receta × **factor real** (pescado 1.04, calamar 1.08, mixtura 1.03, limón 1.10), para que la calibración tenga algo que recuperar.
- **Conteos de apertura:** todos los días de atención, salvo 3 días sin conteo (para probar la imputación).
- **Merma:** solo cuando el stock supera la vida útil (lotes FIFO), registrada al día siguiente.
- **Agotados:** cuando el stock de un insumo no alcanza para una porción, el plato se marca agotado a esa hora y deja de venderse; genera filas en `lost_sales` y en la auditoría de disponibilidad.
- **Otros insumos:** monto diario = 18 % de las ventas ± 10 %.
- **Gastos mensuales:** alquiler 3 000, sueldos 9 000, luz 500, agua 200, internet 100 (fijos); gas 700 y descartables 500 (variables).

Salidas: un CSV por tabla con las columnas del export (T21), más `ventas_items.csv` (fecha, hora, plato, variante, cantidad, precio) y `esperado.json` con:
- rentabilidad por semana y por mes (CV, V, G, GF, UB, UO, food cost, merma kg y S/, ventas de equilibrio);
- factores de calibración con las semanas 1 a 4;
- costo y margen por plato y su categoría de ingeniería de menú (periodo completo);
- para cada noche de las semanas 9 a 12: método elegido por insumo, pronósticos de los horizontes 1 a 3, σ_H y cantidad sugerida con cobertura 2.

**Acepta:** `python3 scripts/tesis/simulador.py && python3 scripts/tesis/referencia.py` regenera exactamente los mismos archivos (prueba de determinismo: dos ejecuciones dan el mismo hash); los 18 casos PU de la sección 5 pasan en `python3 scripts/tesis/pruebas_pu.py`.

### - [x] T6. Cargador de los datos simulados
1. `server/src/__tests__/helpers/sim.ts`: `loadSim(ex, dir)` lee los CSV de `fixtures/sim12` y los inserta con Drizzle en una base de prueba (usuarios, carta, recetas, ventas como pedidos y boletas pagadas, compras, conteos, merma, otros insumos, gastos, agotados y notas). Inserta directo en tablas, porque `saveDaily` solo acepta 7 días atrás.
2. `server/scripts/load-sim.ts` y el script `npm run db:sim` (en `server/package.json`): crea `server/mauidisk-sim.db` con esos datos para demostraciones locales. **Nunca** debe apuntar a la base de producción; verifica que `DATABASE_URL` termine en `-sim.db` o aborta.

**Acepta:** prueba que carga `sim12` y verifica los conteos de filas por tabla contra los CSV; `npm run db:sim` crea la base de demostración.

---

## Fase C. Incremento 2: cálculo de la rentabilidad operativa

### - [x] T7. Esquema del incremento 2
Aditivo, en `schema.ts` y `migrate.ts` (con prueba en `schema.test.ts`):
- `supplies`: `yield REAL NOT NULL DEFAULT 1` (rendimiento), `shelf_life_days INTEGER`, `service_level REAL`.
- `recipe_items (id, dish_id → dishes, variant TEXT NULL, supply_id → supplies, grams_clean REAL NOT NULL, updated_by, updated_at)`, con un índice único (`dish_id`, `variant`, `supply_id`). Si la carta modela las variantes como modificadores, `variant` guarda el nombre de la opción; revisa `modifier_options` antes de decidir y anota la decisión.
- `recipe_calibrations (id, local_id, supply_id, factor REAL NOT NULL, from_date, to_date, computed_at, computed_by)`; el vigente es el último por insumo.
- `expense_categories (category TEXT PRIMARY KEY, kind TEXT CHECK(kind IN ('fijo','variable')) NOT NULL DEFAULT 'fijo', updated_by, updated_at)`.
- Seed: los cuatro insumos críticos con su rendimiento, vida útil y nivel de servicio (tabla de T5); las categorías de gasto existentes como `fijo`, salvo gas y descartables, `variable`.

**Acepta:** migrar dos veces no cambia nada; una base de la versión anterior migra sin perder datos (prueba con una copia).

### - [x] T8. Dominio de costeo (funciones puras)
`server/src/domain/costing.ts` implementa, con tipos explícitos, las fórmulas de la sección 4.1. Pruebas en `__tests__/domain.costing.test.ts` con los casos **PU-01 a PU-12 y PU-17** de la sección 5 (tolerancia de 0.01).

**Acepta:** todas las funciones son puras (no importan `db`); los casos PU pasan.

### - [x] T9. Repositorio y servicio de rentabilidad
1. `repositories/profitability.repo.ts`: `leerPeriodo(ex, { localId, from, to })` devuelve `DatosPeriodo` con lecturas por lote:
   - conteos de apertura de `[from, siguienteDíaDeAtención(to)]`;
   - compras e ingresos netos por traslados;
   - merma por deterioro;
   - otros insumos;
   - ventas por plato, variante y día local (ítems de boletas pagadas, por `order_items.bill_id`, igual que `report.service`);
   - ventas totales;
   - gastos de los meses tocados, con su tipo;
   - recetas, factores vigentes, insumos y platos.
2. `services/profitability.service.ts`:
   - `obtenerRentabilidad(ex, { localId, from, to, groupBy: 'day'|'week'|'month' })`: llama al repositorio y luego a `costearInsumos`, `calcularResultado` y `analizarCarta`. Devuelve los totales del periodo, la serie por grupo, la merma por insumo, el costo y margen por plato, la ingeniería de menú, los días imputados y las advertencias (platos sin receta, factor fuera de 0.7 a 1.3, días sin conteo).
   - `calibrar(ex, { localId, from, to }, userId)`: aplica la Fórmula 12 con los días de atención con conteo, guarda en `recipe_calibrations` y audita.
3. Un plato sin receta no interrumpe el cálculo: su costo de insumos críticos es 0, solo lleva otros insumos, y aparece en las advertencias.

**Acepta:** prueba de paridad `[PP-01][RF12]`: con `sim12` cargado, la rentabilidad semanal y mensual, los factores, los costos por plato y las categorías coinciden con `esperado.json` (tolerancia de S/ 0.01 y 0.0001 en los factores). Prueba `[PI-09][RF14]`: los totales coinciden con la suma de los registros del periodo.

### - [x] T10. API del incremento 2
- `GET /api/profitability?from&to&groupBy` (propietario).
- `GET /api/recipes`, `PUT /api/recipes/:dishId` (propietario; cuerpo: lista de `{ variant, supplyId, gramsClean }`; reemplaza la receta del plato y audita).
- `POST /api/recipes/calibrate` con `{ from, to }` (propietario).
- `PATCH /api/inventory/supplies/:id`: acepta además `yield`, `shelfLifeDays` y `serviceLevel` (propietario).
- `GET /api/reports/expense-categories` y `PUT /api/reports/expense-categories/:category` con `{ kind }` (propietario).
- Esquemas Zod en `schemas/profitability.ts` y `schemas/recipes.ts`; el rango máximo del periodo es de 366 días.

**Acepta:** pruebas HTTP de cada ruta; `[PI-15][RNF06]` amplía `permissions.test.ts` (401 sin sesión, 403 con roles sin permiso); `[PI-06][RF06]` y `[PI-08][RF08]` pasan.

### - [x] T11. Cliente del incremento 2
- `client/src/api/profitability.ts`, `client/src/api/recipes.ts` y los hooks `useProfitability` y `useRecipes`, con estado de carga y de error.
- Página **Rentabilidad** (solo propietario, en el menú del Layout):
  - selector de periodo (hoy, semana, mes, rango);
  - tarjetas de ventas, costo de lo vendido, food cost, utilidad bruta y operativa, merma en S/ y ventas de equilibrio;
  - gráfico de la serie con `recharts`;
  - tabla de platos con costo, margen y categoría;
  - advertencias.
- Página **Recetas**: lista de platos; por variante, gramos de producto limpio de cada insumo crítico; botón «Calibrar con …» y factores vigentes con la advertencia del rango.
- En **Insumos**: campos de rendimiento, vida útil y nivel de servicio.
- En **Reportes / Gastos**: selector fijo o variable por categoría.
- Cada campo de captura lleva su ayuda de una línea (RNF02).

**Acepta:** `npm run ci` (el cliente pasa tsc y eslint); revisión manual con `npm run db:sim` levantado, anotada en «Desviaciones» si algo no se pudo verificar.

### - [x] T12. Rendimiento del incremento 2 (RNF09)
`server/scripts/perf.ts` (`npm run perf`): con `mauidisk-sim.db`, mide 20 veces `obtenerRentabilidad` de un mes y de las 12 semanas, y guarda la mediana y el p95 en `docs/tesis/rendimiento.json`.

**Acepta:** p95 del mes ≤ 3 000 ms en la PC (la medición en la Raspberry Pi queda como prueba de aceptación PA-07, manual).

---

## Fase D. Incremento 3: pronóstico de demanda y cantidad sugerida

### - [x] T13. Esquema del incremento 3
- `demand_forecasts (id, local_id, supply_id, made_on TEXT, target_date TEXT, horizon INTEGER, method TEXT, value_kg REAL, sigma_h REAL NULL, model_version TEXT, created_at)`, con un índice único (`local_id`, `supply_id`, `made_on`, `target_date`).
- `purchase_suggestions (id, local_id, supply_id, date, coverage_days, forecast_sum, safety_stock, available, quantity, service_level, model_version, created_by, created_at)`.
- `forecast_runs (id, local_id, made_on, started_at, finished_at, status, error)`.

**Acepta:** migración idempotente con prueba.

### - [x] T14. Dominio de pronóstico (funciones puras)
`server/src/domain/forecast.ts`, sección 4.2 de este plan. Pruebas en `__tests__/domain.forecast.test.ts`:
- casos **PU-13 a PU-16 y PU-18**;
- **casos de resultado conocido:**
  - demanda constante 10 → los cuatro métodos pronostican 10;
  - patrón semanal exacto [8, 8, 9, 11, 16, 18] repetido 4 semanas → el ingenuo estacional y el promedio estacional lo reproducen exactamente, y el método elegido tiene MAE 0;
  - un día con agotado (habitual 12, vendidas 9, receta 0.25, f = 1) → la demanda no censurada suma 0.75 kg;
  - historial menor que 2 semanas → se usa el método de respaldo;
  - demanda cero → pronóstico 0 y cantidad sugerida no negativa;
  - z(0.85) = 1.0364 y z(0.99) = 2.3263 con 4 decimales.

**Acepta:** todas pasan; ninguna función importa `db` ni usa el reloj.

### - [x] T15. Repositorio, servicio y tarea nocturna
1. `repositories/forecast.repo.ts`: demanda diaria por insumo (consumo real o imputado más las ventas perdidas) de los últimos N días de atención; pronósticos guardados; último conteo; ventas del día hasta la hora t.
2. `services/forecast.service.ts`:
   - `generarPronosticos(ex, { localId, madeOn })`: para cada insumo crítico construye la serie de días de atención hasta `madeOn` inclusive, elige el método (MAE con origen móvil en los últimos 24 días de atención, horizontes 1 a 3), pronostica los 3 siguientes días de atención y guarda con `model_version = 'mauidesk-forecast-1'`. **Idempotente:** si ya existe el pronóstico de esa noche, no lo modifica (RD04). Registra la ejecución en `forecast_runs`.
   - `listaCompra(ex, { localId, date, coverageDays? })`: cobertura por defecto de 2 días de atención, limitada por la vida útil. Toma los pronósticos de la noche anterior a `date` (si faltan, los genera); A = conteo de apertura de `date` o, si no hay, el stock teórico al cierre anterior. Aplica la Fórmula 2 y guarda cada sugerencia mostrada en `purchase_suggestions`.
   - `stockTeorico(ex, { localId, at })` (Fórmula 6) y `avisos(ex, { localId, at, umbralPorciones = 5 })`: platos cuya receta no alcanza para más de `umbral` porciones con el stock teórico de algún insumo.
3. `jobs/nightly.ts`: programador en el mismo proceso, sin dependencias nuevas. Cada día a las 23:30 hora local ejecuta `generarPronosticos` del día. Al arrancar, si falta la ejecución de la noche anterior, la corre. Se desactiva con `NIGHTLY_JOBS=off` (los tests lo apagan). Lo arranca `index.ts`, no `app.ts`.

**Acepta:**
- `[PI-10][RF16][RD04]`: guarda los cuatro insumos × 3 horizontes y una segunda ejecución no cambia nada.
- `[PP-02][RF16]`: con `sim12`, para cada noche de las semanas 9 a 12, el método elegido coincide y los pronósticos difieren de `esperado.json` en 0.01 kg o menos.
- `[PP-03][RF17]`: lo mismo con σ_H y la cantidad sugerida.
- `[PI-11][RD01]`: `GET /api/inventory/daily/:date` responde idéntico antes y después de generar pronósticos.

### - [x] T16. API del incremento 3
- `GET /api/forecast/purchase-list?date&coverageDays` (propietario y encargado).
- `POST /api/forecast/purchase-list/print` (propietario y encargado): imprime en la ticketera con una nueva plantilla `printPurchaseList` en `utils/printer.ts`.
- `POST /api/forecast/run` con `{ madeOn }` (propietario): ejecución a pedido.
- `GET /api/forecast/history?supplyId&from&to` (propietario): pronóstico frente a demanda, solo para consulta.
- `GET /api/forecast/alerts` (todos los roles del POS).
- Evento de socket `inventory:low-portions` con `{ dishId, portionsLeft, supplyCode }` cuando un cobro deja un plato bajo el umbral. Se emite desde el servicio de cobro **después** de confirmar la transacción, sin bloquearla.
- Propuesta de agotado (RF19): el aviso incluye «¿Marcar como agotado?». La confirmación usa el `PATCH /api/menu/dishes/:id/availability` existente, con `source: 'propuesta_confirmada'` en la auditoría. Sin confirmación no cambia nada (RD02).

**Acepta:** `[PI-12][RF17]` (lista e impresión con la impresora simulada en tests), `[PI-13][RF18]` (aviso al cruzar el umbral), `[PI-14][RF19][RD02]` (la disponibilidad no cambia sin confirmación) y los permisos de cada ruta.

### - [x] T17. Cliente del incremento 3
- `client/src/api/forecast.ts` y el hook `usePurchaseList`.
- Página **Lista de compra** (propietario y encargado):
  - fecha;
  - cobertura editable por insumo (con el máximo de la vida útil);
  - por insumo: cantidad sugerida, pronóstico de los días cubiertos, stock disponible y stock de seguridad;
  - botón **Imprimir**.
- **POS:** banner discreto con los platos de pocas porciones (evento de socket y `GET /api/forecast/alerts` al conectar) y botón «Marcar agotado», que pide confirmación.
- La «Compra del día» **no** muestra nada de esto (RD01).

**Acepta:** CI en verde; revisión manual con la base simulada.

### - [x] T18. Rendimiento del incremento 3 (RNF09)
Amplía `npm run perf`: `generarPronosticos` de una noche con las 12 semanas y `listaCompra`, 20 repeticiones, mediana y p95 en `docs/tesis/rendimiento.json`.

**Acepta:** p95 de la tarea nocturna ≤ 60 s en la PC; lista de compra ≤ 3 000 ms.

---

## Fase E. Cierre

### - [ ] T19. Exportación y diccionario v2 (RF07, RD05)
1. Agrega al export las tablas `recipe_items`, `recipe_calibrations`, `demand_forecasts`, `purchase_suggestions`, `expense_categories` y `app_settings`, y la columna `no_purchase`. Quita la tabla del estudio.
2. Sube `DATASET_VERSION` a `v2` y actualiza `docs/diccionario-datos-tesis.md` con una sección «Cambios de v1 a v2».

**Acepta:** `[PI-07][RF07][RD05]`: los encabezados coinciden con el diccionario v2.

### - [ ] T20. Pruebas de aceptación documentadas
`docs/tesis/aceptacion.md`: guion para el propietario con los criterios de aceptación de los tres incrementos y una tabla para anotar el resultado y la fecha. Cubre PA-01 a PA-08 y la revisión de cada pantalla. Las pruebas manuales que se puedan hacer en la PC (PA-02, PA-03, PA-04, PA-05 y PA-06) se ejecutan ahora y se anotan con su evidencia (comando o captura).

### - [ ] T21. Documentación técnica
Actualiza `docs/architecture/api.md`, `data-model.md`, `modules.md` y `architecture.md` (capas reales después de este plan) y el vault si existe el script. Agrega un diagrama de secuencia de la rentabilidad en Mermaid que coincida con el código.

### - [ ] T22. Evidencias para el Capítulo IV
`server/scripts/trazabilidad.ts` (`npm run report:tesis`):
1. Ejecuta Vitest con el reporter JSON.
2. Agrupa las pruebas por las etiquetas `[RFxx]`, `[RNFxx]`, `[RDxx]`, `[PU-xx]`, `[PI-xx]` y `[PP-xx]`.
3. Escribe `docs/tesis/evidencias.md` con:
   - la matriz requisito → pruebas → estado;
   - el total de pruebas por nivel (unitarias, integración, paridad);
   - los resultados de `rendimiento.json`;
   - los requisitos sin prueba.

**Acepta:** `evidencias.md` muestra los 19 RF y 10 RNF; todo RF tiene al menos una prueba en verde, salvo los que dependen de una aceptación manual, marcados como tales.

---

## 4. Especificación de las fórmulas

### 4.1 Costeo (`domain/costing.ts`)

| Función | Fórmula (tesis) | Definición |
|---|---|---|
| `kgPorPorcion(g, rendimiento)` | — | `g / 1000 / rendimiento` |
| `costoPromedio(stockPrev, pPrev, compra, pCompra)` | F8 | Si `stockPrev + compra ≤ 0`: `pCompra` si hubo compra, si no `pPrev`. Si no: `(stockPrev·pPrev + compra·pCompra) / (stockPrev + compra)`. Sin compra, el costo no cambia. |
| `consumoReal(A, I, M, Asig)` | F7 | `A + I − M − Asig`. `I` = compras − enviado + recibido. `Asig` = apertura del siguiente día de atención. Si falta `A` o `Asig`: consumo teórico (ventas × receta × factor), con el día marcado como imputado. |
| `costoLoVendido(dias)` | F9 | `Σ_d Σ_i (C_{i,d} + M_{i,d}) · p̄_{i,d} + O_T` |
| `prorratearGastos(gastosMes, diasAtencionMes, diasPeriodo)` | — | Cada gasto mensual se reparte entre los días de atención del mes; devuelve G y GF (solo las categorías fijas). |
| `resultado(V, CV, G, GF)` | F10, F15 | `UB = V − CV`; `UO = UB − G`; `foodCost = CV/V·100`; `Veq = GF / (1 − CV/V)`; si `V = 0`, `foodCost` y `Veq` son `null`. |
| `merma(M, I, p̄)` | F11 | `MD% = ΣM / ΣI · 100` (null si ΣI = 0); `MD S/ = Σ M · p̄` |
| `factorCalibracion(consumoReal[], consumoReceta[])` | F12 | `Σ C / Σ (porciones × kgPorPorcion)` solo en los días con conteo; `fueraDeRango = f < 0.7 ∨ f > 1.3` |
| `costoPlato(receta, f, p̄, otrosPorSol, precio)` | F13 | `Σ_i q_{p,i} · f_i · p̄_i + O_T/V_T · precio` |
| `margen(precio, costo)` | F14 | `MC = precio − costo`; `MC% = MC/precio·100` |
| `ingenieriaMenu(porciones, margen)` | Kasavana y Smith | popular si `porciones_p / Σ ≥ 0.7 / n`; margen alto si `MC_p > Σ(porciones·MC)/Σporciones`; categorías Estrella, Caballo de batalla, Rompecabezas y Perro |

### 4.2 Pronóstico (`domain/forecast.ts`)

- **Serie:** demanda diaria no censurada por insumo en los días de atención, ordenada; m = 6.
- **Ventas perdidas (F4):** `L_{i,d} = Σ_{p agotado} max(0, v̄_{p,dow} − V_{p,d}) · q_{p,i} · f_i`, donde `v̄` es el promedio de las porciones del plato el mismo día de la semana en las 4 semanas anteriores con ventas.
- **Demanda (F5):** `D = C + L`. Los días imputados entran en la serie pero no en el cálculo del error.
- **Métodos:**
  1. **Ingenuo estacional:** `ŷ_{t+k} = y_{t+k−m·⌈k/m⌉}`.
  2. **Promedio estacional:** promedio de los mismos días de la semana en las últimas 4 semanas disponibles (mínimo 1).
  3. **Holt-Winters aditivo sin tendencia:**
     - nivel inicial = promedio de la primera temporada; estacionales iniciales = desvío de cada día respecto de ese promedio;
     - `ℓ_t = α(y_t − s_{t−m}) + (1−α)ℓ_{t−1}`; `s_t = γ(y_t − ℓ_t) + (1−γ)s_{t−m}`; `ŷ_{t+k} = ℓ_t + s_{t+k−m⌈k/m⌉}`;
     - α y γ se eligen por **búsqueda en rejilla** en {0.05, 0.10, …, 0.95} minimizando la suma de errores al cuadrado a un paso; en empate, el menor α y luego el menor γ;
     - recorte en 0.
     - Este algoritmo exacto también va en la referencia en Python, para la paridad (no uses statsmodels).
  4. **Regresión con calendario:** mínimos cuadrados con intercepto, tendencia lineal, 5 variables del día de la semana (martes como base) y feriado, con los últimos 48 días de atención; resuelve por ecuaciones normales con eliminación de Gauss y pivoteo; recorte en 0.
- **Selección:** origen móvil sobre los últimos `W = min(24, n − 12)` días de atención. Para cada origen, cada método se ajusta con la historia hasta ese día y pronostica los horizontes 1 a 3; error = MAE promedio de los tres horizontes, sin los días imputados. Gana el menor; en empate, el orden de la lista de arriba.
- **Respaldo:** con menos de 12 días de atención, promedio estacional si hay ≥ 6, o promedio simple si hay menos; sin datos, 0.
- **σ_H:** desviación estándar muestral de los errores del pronóstico acumulado en H días del método elegido, en el mismo origen móvil (mínimo 6 errores; si hay menos, 25 % del promedio de la demanda × √H).
- **z(α):** inversa de la normal estándar (algoritmo de Acklam o similar, con error < 1e−6).
- **Cantidad sugerida (F2):** `Q = max(0, Σ_{k=1}^{H} D̂_k + z_α·σ_H − A)`, con `H = min(cobertura pedida, vida útil)` y redondeo al alza a 0.5 kg solo para mostrar.
- **Stock teórico (F6):** `S_{i,t} = A + I − f_i · Σ_p q_{p,i} · V_{p,[d,t]}`.

## 5. Casos de prueba unitarios (valores de la tesis, Tabla 26)

| ID | Qué verifica | Entrada | Esperado | Req. |
|---|---|---|---|---|
| PU-01 | Consumo real (F7) | A = 6.0; I = 10.0; M = 0.5; apertura siguiente = 4.0 | 11.5 kg | RF12 |
| PU-02 | Costo promedio con compra (F8) | 6.0 kg a 22.00; compra de 10.0 kg a 24.00 | 23.25 | RF10 |
| PU-03 | Costo promedio sin compra | 6.0 kg a 22.00; sin compras | 22.00 | RF10 |
| PU-04 | Costo de lo vendido (F9) | PU-01 y PU-02; otros insumos 120.00 | 399.00 | RF12 |
| PU-05 | Prorrateo y utilidad (F10) | V = 1450; gastos 9000, 2400 y 600 al mes; mes de 30 días | G = 400.00; UO = 651.00 | RF12 |
| PU-06 | Merma (F11) | M = 0.5; ingresos 10.0; p̄ = 23.25 | 5.00 %; S/ 11.63 | RF12 |
| PU-07 | Factor de calibración (F12) | C = 11.5; 42 porciones de 0.25 kg | 1.0952 | RF09 |
| PU-08 | Factor fuera de rango | f = 1.45 | advertencia «revisar receta» | RF09 |
| PU-09 | Costo y margen del plato (F13, F14) | receta 0.25 kg; precio 30.00; f y p̄ de PU-07 y PU-02; otros insumos 120/1450 por sol | c = 8.85; MC = 21.15 | RF11 |
| PU-10 | Ventas de equilibrio (F15) | GF = 400; CV = 399; V = 1450 | 551.86 | RF12 |
| PU-11 | Periodo sin ventas | V = 0 | food cost y Veq `null`, sin error | RF12 |
| PU-12 | Ingeniería de menú | porciones 42, 30, 8, 10; márgenes 21.15, 15.00, 22.00, 12.00 | Estrella, Caballo de batalla, Rompecabezas, Perro | RF13 |
| PU-13 | Ventas perdidas y demanda (F4, F5) | habitual 12, vendidas 9; 0.25 kg; f = 1; C = 11.5 | L = 0.75; D = 12.25 | RF16 |
| PU-14 | Stock teórico (F6) | A = 6.0; I = 10.0; f = 1.0952; 30 porciones de 0.25 kg | 7.79 | RF15 |
| PU-15 | Cantidad sugerida (F2) | H = 2; pronósticos 12.0 y 11.0; σ_H = 2.0; nivel 85 % (z = 1.0364); A = 4.0 | 21.07 | RF17 |
| PU-16 | Cobertura limitada | pedida 5; vida útil 3 | 3 | RF17 |
| PU-17 | Receta en la unidad de compra | 180 g; r = 0.80 | 0.225 kg | RF08 |
| PU-18 | Beneficio potencial | (120 + 15) real − (40 + 25) sugerida | 70.00 | RF17 |

> Nota sobre PU-09: c = 0.25 × 1.0952 × 23.25 + (120 / 1450) × 30 = 6.366 + 2.483 = 8.85. Si tu implementación da otro valor, revisa la asignación de otros insumos.
> PU-18 queda como función del dominio (`beneficioPotencial`), aunque la tesis ya no lo usa como indicador.

## 6. Requisitos que este plan cubre

| Requisito | Tarea |
|---|---|
| RF01 a RF05, RF07 | Existentes (incremento 1); RF02 se completa en T3 y RF07 se amplía en T19 |
| RF06 | T7, T10 y T11 |
| RF08 a RF14 | T7 a T12 |
| RF15 a RF19 | T13 a T18 |
| RNF01 a RNF08, RNF10 | Existentes; se verifican en T20 |
| RNF09 | T12, T18 y PA-07 |
| RD01 a RD06 | T15 (RD01, RD04), T16 (RD02), T19 (RD05), todas (RD06) |

## 7. Desviaciones y notas de la ejecución

_(Claude Code: anota aquí, con fecha, cada desviación del plan, la decisión que tomaste y por qué; y la línea base de T1.)_

- **2026-11-05 · T1.** Rama `feat/sistema-completo` creada desde `feat/inventario-fase0` (`d77aab2`). Línea base de `npm run ci`: servidor 23 archivos y **174 pruebas** en verde (14 warnings de lint previos); cliente sin errores (65 warnings previos). Coincide con lo esperado.
- **2026-11-05 · T2.** `limaDate` pasó de `utils/study.ts` (eliminado) a `utils/dates.ts`, porque la tarea nocturna de T15 la necesitará. La migración ya no asigna `study_group` por código (queda vacío en las bases nuevas). Hasta T19 el export conserva la tabla `study_config` y la columna `grupo` de `supplies` (vacía), para no tocar el dataset dos veces; T19 las quita al subir a v2. Se retira la prueba del invariante de activación; la de RD01 frente al pronóstico llega en T15. La sección «Ajustes» queda en la pestaña Insumos (solo el dueño). Pruebas: 168 en verde.
- **2026-11-05 · T3.** «Dejar los ítems críticos en 0 con modo `default`» se implementa sin crear filas de compra en 0: `GET /daily/:date` devuelve `purchased = 0` y `purchasedMode = 'default'` cuando el último guardado de la parte fue «no compré»; el dato queda en `daily_parts.no_purchase`. «No compré» junto con compras u otros insumos responde 400 `NO_PURCHASE_CONFLICT`; los traslados sí se aceptan. La columna se exporta como `no_compro` en `daily_parts`; la versión del dataset sube en T19 (el número de tarea que cita T3, «T21», es el de la documentación). Pruebas: 169.
- **2026-11-05 · T4.** Siguiendo la convención de `order.service`, los servicios que escriben reciben `db: DB` (necesitan `.transaction` para `withWriteLock`) y los que leen `db: Executor`, ambos con la base por defecto; `settings.service` ya recibía el ejecutor. Las referencias de [Usar] salen de dos consultas por lote (compras y otros insumos anteriores a la fecha) y se calculan en `domain/daily.ts`. Los servicios del incremento 1 siguen leyendo `MAUI_LOCAL_ID` con `currentLocalId()`; recibir el `localId` desde la ruta se aplica a los servicios nuevos (T9 en adelante). Prueba nueva `[RNF09]`: `getDaily` hace las mismas consultas con 3 y con 8 insumos críticos. Pruebas: 170.
- **2026-11-05 · T5.** Datos y referencia en `scripts/tesis/` (README con el contrato de la paridad):
  - **Archivos.** Las fórmulas están en `formulas.py`, aparte de `referencia.py`, para que `pruebas_pu.py` las pruebe sin leer datos.
  - **Variantes como platos.** Cada variante de la carta es un plato propio («Plato (Variante)», como en la referencia anterior). T7 decide si `recipe_items.variant` hace falta para la carta real.
  - **Columnas.** `ventas_items.csv` lleva además la columna `boleta`. Hay archivos que no son tablas del export: `carta.csv`, `insumos.csv` (con rendimiento, vida útil y nivel de servicio, sin `grupo`), `recetas.csv` y `gastos.csv`. Los gastos usan las categorías alquiler, sueldos, luz, agua, internet, gas y descartables; el seed de T7 debe clasificarlas. No se generan filas de `daily_parts`.
  - **Regla de compra.** La regla literal («consumo esperado hasta la siguiente compra ± 15 %») no descuenta lo que quedaba: el pescado se acumulaba (59 kg) y la cantidad sugerida daba siempre 0. Se compra lo esperado × (1.15 ± 0.15) menos lo que quedaba. Resultado: 22 de 72 días tienen algún agotado (102 marcas) y hay 14 mermas.
  - **Días sin conteo.** Uno cae en las semanas 2 a 4, para que la calibración pruebe la exclusión de los días imputados.
  - **Precisiones de §4 que el plan no fija.**
    - p̄ (F8) se recorre desde el primer registro. Si falta el conteo, la apertura se estima con el día anterior.
    - p̄ del periodo para el costo del plato: promedio ponderado por el consumo.
    - Gastos: el mes calendario completo pone el denominador.
    - v̄ de F4: d − 7k entre los días con ventas.
    - Regresión: se omiten las columnas sin variación en la ventana (si no, el sistema es singular), y si no tiene solución se usa el promedio estacional.
    - Con H > 3, σ_H usa los orígenes cuyos H días caen dentro de la serie.
    - El pronóstico de la noche N solo usa los conteos hasta N.
    - Las sumas van de izquierda a derecha (`sum()` de Python 3.12+ es compensada).
  - **Resultado de la simulación.**
    - Ventas: S/ 98 845; food cost: 33.6 %.
    - Factores recuperados: 1.0400, 1.0800, 1.0297 y 1.1000.
    - Métodos elegidos en las 96 noches × insumo: Holt-Winters 44, promedio estacional 27, regresión 25.
    - Dos ejecuciones dan los mismos hashes, y los 18 casos PU pasan.
  - **Para T9.** `expenses` no tiene `local_id`: la rentabilidad por local tendrá que tratar los gastos como del local 1, o T7 agrega la columna.
- **2026-11-05 · T6.** `loadSim(db)` en `helpers/sim.ts` y `npm run db:sim` (`server/scripts/load-sim.ts`):
  - **Recetas.** Todavía no se cargan, porque `recipe_items` llega en T7. T7 amplía el cargador con las recetas y los parámetros de los insumos.
  - **Ventas.** Cada boleta del simulador es un pedido `dine_in` sin mesa, `paid`, cobrado en efectivo. `paid_at` es la hora del último ítem, pasada a UTC con −05:00 fijo (Lima no tiene horario de verano).
  - **Agotados.** Se cargan como dos eventos `dish.availability` (`source: 'manual'`), como los escribe `/availability`.
  - **Usuarios.** Se llaman Dueño, Encargada y Cajero, como `registrado_por`.
  - **`db:sim`.** No lee `server/.env`: usa `DATABASE_URL` del entorno o `file:./mauidisk-sim.db`, y aborta si la URL no termina en `-sim.db`.
  - **Zona horaria.** `vitest.config.ts` fija `TZ=America/Lima`, porque el export y los días locales dependen de la zona del proceso.
  - **Saltos de línea.** `.gitattributes` fija LF en los fixtures, para que el hash no cambie al hacer checkout en Windows.
  - **Corrección al simulador.** `duracion_min` truncaba los minutos y el export los redondea. Se corrigió el simulador: solo cambió `stockouts.csv`; `esperado.json` quedó igual.
  - **Prueba.** `sim.test.ts` compara las filas por tabla, las ventas por día local y el export de compras, conteos, merma y agotados contra los CSV. Pruebas: 174.
- **2026-11-05 · T7.** Esquema del incremento 2:
  - **`recipe_items.variant`.** Es `TEXT NOT NULL DEFAULT ''`, no `NULL`: en SQLite un índice único trata cada NULL como distinto y permitiría dos recetas base del mismo plato e insumo. `''` es la receta del plato; un texto es el nombre de la opción de modificador (`modifier_options.name`, guardado como `optionName` en `order_items.modifiers`) que reemplaza esa receta. Así sirve si la carta real modela «pescado/calamar» como modificador. En `sim12` cada variante es un plato y todas sus recetas llevan `''`.
  - **Parámetros de los críticos.** La migración pone rendimiento, vida útil y nivel de servicio a PESCADO, CALAMAR, MIXTURA y LIMON solo si siguen sin configurar (`yield = 1` y los otros dos en null), así que no pisa lo que cambie el dueño. **No cambia `critical`:** en el local, el dueño debe marcar mixtura y limón como críticos y desmarcar pulpo, langostino y conchas en Insumos (pendiente para el despliegue). `seed.ts` (desarrollo) ya los crea así.
  - **`expense_categories`.** Se siembra con las categorías existentes como `fijo`, gas y descartables como `variable`, y siempre con filas para `gas` y `descartables`. Una categoría sin fila cuenta como fija (T9). La restricción CHECK se declara con `check()` de drizzle. Ojo para T9: los gastos de la categoría `ingredientes` duplicarían las compras de insumos.
  - **Migración probada en copias.** Probé con una copia de `server/mauidisk.db` (anterior al inventario) y de `mauidisk-sim.db` (versión T6): ninguna tabla existente perdió filas y migrar dos veces no cambia nada.
  - **Cargador.** `loadSim` carga ahora las recetas y los parámetros de los insumos. Pruebas: 175.
- **2026-11-05 · T8.** `domain/costing.ts` replica `scripts/tesis/formulas.py` función por función, con las mismas sumas de izquierda a derecha (`suma`). Además de las de §4.1 tiene `consumoTeorico` (el respaldo de F7) y `RANGO_FACTOR`. Las entradas por insumo o plato son `Map`, para no atar el dominio a ids o códigos. `costoPromedio` devuelve `null` si nunca hubo compra; el servicio decide qué hacer. Una prueba verifica que el archivo no importa `db`, servicios ni `utils/local`, y que no usa el reloj ni `process.env`. Pruebas: 189.
- **2026-11-06 · T9.** Repositorio y servicio de rentabilidad:
  - **Estructura.** Además del repositorio y el servicio hay dos módulos puros: `domain/calendar.ts` (días de atención, semanas y meses) y `domain/profitability.ts`. Este último tiene `costearInsumo`, `calcularPeriodo` y `analizarCarta`, que son los «costearInsumos, calcularResultado y analizarCarta» del plan, más la resolución de variantes y el consumo según receta.
  - **Lecturas.** El repositorio lee de una vez la historia hasta el fin del periodo (más 31 días de conteos, notas y ventas, para hallar el siguiente día de atención y los días de cada mes). Así lo exige F8, que se recorre desde el primer registro. Son 14 consultas, ninguna dentro de un bucle.
  - **Ventas.** Son los ítems de boletas pagadas por `bill_id`, sin los pedidos cancelados. El día local es `date(paid_at, '-5 hours')`: Lima con zona explícita, como `limaDate`.
  - **Gastos.** Son de la instancia: `expenses` no tiene `local_id`, y cada local tiene su propia base (RD06).
  - **Variantes por modificador.** Si la opción elegida tiene receta propia, se usa esa receta; si no, la del plato. El precio de la variante es el promedio cobrado en el periodo.
  - **Traslados.** Las recepciones entran a F8 a su costo (o al último precio de compra); los envíos solo restan stock.
  - **Advertencias.** Además de las del plan: `NOT_CALIBRATED` (insumo sin factor, se usa 1) y `NO_PURCHASE_PRICE` (consumo sin precio de compra).
  - **Respuesta.** Las claves de la API van en inglés, como el resto. El dinero se redondea con `roundMoney`, los kg a 3 decimales y los factores a 6.
  - **Defecto en la referencia.** La paridad encontró un defecto en `referencia.py`: un `defaultdict` daba «receta» vacía a las bebidas, y quedaban sin la marca de plato sin receta. Se corrigió en Python y se regeneró `esperado.json` (solo cambió `sin_receta` de 7 platos). La referencia también define ahora el primer registro como la primera venta, conteo o compra; el resultado no cambia.
  - **Paridad.** PP-01 coincide en las 12 semanas, los 4 meses, los 4 factores (±0.0001) y los 51 platos (costo, margen, categoría).
  - **Pureza.** La prueba de pureza revisa todos los archivos de `domain/`. Pruebas: 196.
- **2026-11-06 · T10.** API del incremento 2:
  - **Rutas nuevas.** `routes/profitability.ts` y `routes/recipes.ts`. Los tipos de gasto van en `routes/reports.ts`. Recetas y tipos de gasto están en `services/recipes.service.ts`.
  - **`PUT /api/recipes/:dishId`.** El cuerpo es la lista de ítems, como dice el plan. Solo acepta insumos críticos (400 `SUPPLY_NOT_CRITICAL`: los demás van en «otros insumos») y rechaza un insumo repetido en la misma variante.
  - **`GET /api/recipes`.** Devuelve la carta sin archivados, cada ítem con su `kgPerPortion` (en la unidad de compra) y el factor vigente de cada crítico con su periodo y si está fuera de rango.
  - **Tipos de gasto.** `PUT /expense-categories/:category` también acepta una categoría que todavía no tiene gastos, para clasificarla antes de usarla.
  - **Insumos.** `PATCH /supplies/:id` admite rendimiento en (0, 1], vida útil de 1 a 365 días (null la borra) y nivel de servicio de 0.50 a 0.999.
  - **Pruebas.** Las de API usan `sim12`. PI-06: pasar «luz» a variable baja GF de 12 800 a 12 300 y baja las ventas de equilibrio. PI-08: 180 g limpios con rendimiento 0.80 dan 0.225 kg. PI-15: 401 sin sesión y 403 para los roles sin permiso en las seis rutas y en el PATCH de parámetros. Pruebas: 206.
- **2026-11-06 · T11.** Cliente del incremento 2:
  - **Estructura.** Los módulos `api/profitability.ts` y `api/recipes.ts` solo hacen las llamadas. Los hooks `useProfitability` y `useRecipes` derivan «cargando» de la consulta pendiente, sin `setState` síncrono en el efecto, para no sumar warnings de lint.
  - **Páginas nuevas.** Están en `pages/profitability/`, solo para el dueño, con entradas en el Layout:
    - **Rentabilidad.** Hoy, semana, mes o rango con agrupación; 8 tarjetas, cada una con su ayuda; serie con `recharts` (ventas, costo de lo vendido, utilidad operativa); tabla de insumos y tabla de platos con categoría, ordenable. Las advertencias agrupan en una línea los platos sin receta.
    - **Recetas.** Calibración con rango y factores vigentes (con el aviso de fuera de rango), y un editor por plato: una fila por variante y una columna por crítico, en gramos limpios.
  - **Insumos.** Rendimiento, vida útil y nivel de servicio en %, solo en los críticos, cada uno con su ayuda.
  - **Reportes.** La sección «Tipo de gasto» (fijo o variable) aparece solo para el dueño, y se agregaron las etiquetas de auditoría nuevas.
  - **Revisión manual.** La hice con `npm run db:sim`, el servidor y Vite, y capturas sin interfaz (Playwright con el Chromium local) en 1280 px y 390 px: Rentabilidad, Recetas (calibrando desde la UI), Tipo de gasto y Editar insumo, sin errores de consola. Después de calibrar con las semanas 1 a 4, la pantalla muestra UO = S/ 27 169.74, igual que `esperado.json`.
  - **Sin verificar en un celular real.** El menú inferior móvil, que ya tenía más entradas de las que caben, no se revisó en un teléfono.
  - **CI.** Cliente sin errores y con los mismos 65 warnings de antes.
- **2026-11-06 · T12.** `npm run perf` (`server/scripts/perf.ts`):
  - **Cómo mide.** Usa solo la base simulada (aborta si la URL no termina en `-sim.db` o si el archivo no existe). Hace una ejecución de calentamiento que no cuenta y 20 repeticiones. El p95 es por rango más cercano.
  - **Archivo de resultados.** `docs/tesis/rendimiento.json` conserva las secciones de otras ejecuciones, para que T18 agregue el incremento 3 sin pisar el 2. El script exporta `medir()` para T18.
  - **Resultado en la PC** (Ryzen 7 7700X, Node 24):
    - Agosto por semana: mediana 28.9 ms, p95 41.6 ms.
    - Las 12 semanas: mediana 26.8 ms, p95 30.0 ms.
    - Límite: 3 000 ms; cumple con amplio margen.
  - **Pendiente.** La medición en la Raspberry Pi sigue siendo PA-07.
- **2026-11-06 · T13.** Tablas `demand_forecasts` (índice único `uq_demand_forecasts_night`, requerido porque de él depende RD04), `purchase_suggestions` y `forecast_runs`, cada una con su índice. Se agregó la columna nulable `purchase_suggestions.available_source` (`conteo` | `teorico`): guarda de dónde salió el disponible A, para la trazabilidad de cada valor. `forecast_runs.status` es `running` | `ok` | `error`. La migración es idempotente y tiene prueba. Pruebas: 207.
- **2026-11-06 · T14.** `domain/forecast.ts` replica `formulas.py` con el mismo orden de operaciones:
  - **Rejilla y empates.** Se arma con `k·5/100`, que da los mismos doubles que `round(0.05·k, 2)`. El pivote de Gauss toma el primero en empate, como el `max` de Python. El método elegido es el primero con el MAE menor.
  - **Funciones agregadas.** `demandaNoCensurada` (F5), `redondearMedioKilo` (al alza, solo para mostrar), `beneficioPotencial` (PU-18), `MODEL_VERSION` y `gauss`, exportada para probarla.
  - **Pruebas.** Cubren PU-13 a PU-16 y PU-18, los casos de resultado conocido (demanda constante, patrón semanal con MAE 0 y elección del ingenuo en empate, respaldo con historia corta, demanda cero, z con 4 decimales) y dos más: un día imputado no entra en el error, y Gauss con un sistema singular.
  - **Corrección a mi propia prueba.** El caso de respaldo esperaba un promedio de dos semanas, pero con menos de 12 días solo hay una semana previa por día. Corregí la expectativa; el código ya hacía lo correcto.
  - Pruebas: 219.
- **2026-11-06 · T15.** Repositorio, servicio y tarea nocturna del pronóstico:
  - **Lecturas.** `forecast.repo.ts` reutiliza `leerPeriodo` de la rentabilidad (el consumo real o imputado necesita lo mismo) y agrega: agotados por día local desde `dish.availability`, parámetros de los insumos, pronósticos guardados, últimos conteos y ventas hasta una hora.
  - **Serie de demanda.** La arman F4 y F5 en `domain/demand.ts` (`serieDemanda` y `pronosticoNoche`), que es puro. Un agotado marca todas las variantes con receta de ese plato.
  - **σ por horizonte.** Cada fila de `demand_forecasts` guarda en `sigma_h` el σ del error acumulado de su horizonte (σ₁, σ₂, σ₃). `seleccionarMulti` los calcula en una pasada, y σ₂ es idéntico al de la referencia. Así la lista de compra acepta una cobertura de 1 a 3 días sin recalcular.
  - **Cobertura.** El máximo es min(3, vida útil), porque se pronostican 3 días de atención; el plan hablaba del máximo de la vida útil, que llega a 10 en el limón. Un insumo sin nivel de servicio usa 0.95. Con el método de respaldo, σ queda en null y Q usa 0.
  - **Idempotencia (RD04).** `generarPronosticos` no toca los insumos que ya tienen el pronóstico de esa noche: inserta con `onConflictDoNothing` sobre `uq_demand_forecasts_night` y registra cada ejecución en `forecast_runs`.
  - **Lista de compra.** `listaCompra` toma los pronósticos de la noche anterior a la fecha (`anteriorAtencion`) y, si faltan, los genera. Guarda cada sugerencia con `available_source`.
  - **Stock teórico y avisos.** `stockTeorico` aplica F6 en un instante, desde el último conteo y con las ventas hasta esa hora. `avisos` solo lista los platos disponibles con pocas porciones; no marca agotados (RD02).
  - **Tarea nocturna.** `jobs/nightly.ts` corre a las 23:30 de Lima (04:30 UTC) solo los días de atención. Al arrancar corre la última noche cerrada si no tiene una ejecución `ok`. Hay `NIGHTLY_JOBS=off` en `.env.example` y en `vitest.config.ts`.
  - **Pruebas.**
    - **PP-02 y PP-03:** las 24 noches × 4 insumos coinciden con `esperado.json` en método, día objetivo, kg (±0.01), σ₂, origen y valor de A, y Q. Corren en unos 6 s.
    - **PI-10:** 12 filas por noche; una segunda ejecución, aun con los conteos cambiados, no cambia nada.
    - **PI-11:** `GET /daily/:date` responde idéntico antes y después de pronosticar y de pedir la lista.
    - **Tarea:** hora de la próxima ejecución, puesta al día y lunes cerrado.
    - Pruebas: 227.
- **2026-11-06 · T16.** API del incremento 3 (`routes/forecast.ts`, `schemas/forecast.ts`):
  - **Lista de compra.** La fecha por defecto es hoy en Lima. La cobertura va de 1 a 3 días (ver T15) y puede ser una para todos (`coverageDays`) o una por insumo (`coverage=id:días,…` en la URL, un objeto en el cuerpo). La impresión arma la lista en el servidor con `printPurchaseList` (502 `PRINTER_UNAVAILABLE` sin impresora). `run` rechaza noches futuras.
  - **Evento `inventory:low-portions`.** Se emite desde la ruta del cobro, junto a los otros emits posteriores al commit, sin esperar: un error del aviso no afecta el cobro. Así lo hace el resto del código (los emits viven en las rutas); el plan decía «desde el servicio de cobro». Para no repetir, solo se emite cuando cambian las porciones de ese plato desde el último aviso del día (memoria del proceso). El umbral es 5.
  - **Propuesta de agotado.** `PATCH /availability` acepta `source: 'manual' | 'propuesta_confirmada'` (por defecto `manual`) y lo guarda en la auditoría. El aviso nunca cambia la disponibilidad (RD02).
  - **Defecto encontrado por la prueba.** `floor(1.2 / 0.2)` daba 5 porciones en vez de 6 por coma flotante; se suma 1e-9 antes del `floor`.
  - **Pruebas.**
    - **PI-12:** la lista con un servidor TCP como impresora simulada, y el 502.
    - **PI-13:** los avisos al cruzar el umbral, con 6, 5 y 4 porciones.
    - **PI-14:** sin confirmación no cambia nada; con confirmación queda `propuesta_confirmada`.
    - **PI-15:** 401 y 403 en las cinco rutas.
    - Además: idempotencia de `run` y el historial.
    - Pruebas: 234.
- **2026-11-06 · T17.** Cliente del incremento 3:
  - **Estructura.** `api/forecast.ts` y el hook `usePurchaseList` (carga derivada de la consulta, sin warnings nuevos).
  - **Lista de compra.** La página `pages/forecast/PurchaseList.tsx` es para el dueño y el encargado, con su entrada en el Layout. Por insumo muestra:
    - lo que hay que comprar, al alza en medios kilos;
    - la cobertura con − y +, hasta min(3, vida útil);
    - «Se usará» (la suma del pronóstico), «Hay» (contado o estimado) y «Por si acaso» (el stock de seguridad, con el nivel de servicio);
    - el pronóstico de cada día.
    Abajo está el botón Imprimir.
  - **Aviso en el POS.** `LowPortionsBanner` va bajo el encabezado del POS y aparece plegado. Se actualiza con `GET /api/forecast/alerts` al montar y al reconectar, y con el evento `inventory:low-portions`. Cuando llega `menu:availability` con agotado, el plato sale del aviso. «Marcar agotado» (dueño, encargado y cajero) pide confirmación y envía `source: 'propuesta_confirmada'`. El mozo ve el aviso pero no puede marcar.
  - **RD01.** La «Compra del día» no cambió.
  - **Revisión manual.** Con `db:sim` y capturas en 1280 px y 390 px (lista del 2026-08-20, cobertura del limón llevada a 3 días, POS con el aviso desplegado), sin errores de consola.
  - **Observación.** Con la base simulada, «hoy» parte del último conteo (8 de septiembre) y el aviso lista muchos platos con mixtura en 0. Es correcto para esos datos; con el uso diario el conteo es del mismo día.
  - **CI.** Cliente con los mismos 65 warnings.
- **2026-11-06 · T18.** `npm run perf` también mide el incremento 3.
  - **Tarea nocturna.** `generarPronosticos` de la noche del 2026-09-06, con las 12 semanas y 4 insumos. Como es idempotente, antes de cada repetición (fuera del tiempo medido) se borran los pronósticos de esa noche en la base simulada. Para eso `medir()` acepta ahora un paso previo.
  - **Lista de compra.** `listaCompra` del 2026-09-08 con cobertura 2.
  - **Resultados en la PC:**
    - Tarea nocturna: mediana 43.8 ms, p95 49.7 ms (límite 60 s).
    - Lista de compra: mediana 34.9 ms, p95 43.9 ms (límite 3 s).
    - El incremento 2 se volvió a medir: p95 de 30.5 ms (mes) y 29.5 ms (12 semanas).
  - **Pendiente.** La Raspberry Pi sigue siendo PA-07.
