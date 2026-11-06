# Datos simulados e implementación de referencia (plan-sistema T5)

Solo biblioteca estándar de Python (3.10 o más reciente; en Windows el comando es `python`).

```bash
python3 scripts/tesis/simulador.py     # escribe los CSV en server/src/__tests__/fixtures/sim12/
python3 scripts/tesis/referencia.py    # lee esos CSV y escribe esperado.json (unos 10 s)
python3 scripts/tesis/pruebas_pu.py    # casos PU-01 a PU-18 y de resultado conocido
```

Las dos primeras son deterministas: con la semilla `20260610`, dos ejecuciones dan los mismos archivos byte a byte. Los CSV y `esperado.json` se versionan, y las pruebas de paridad del servidor (PP-01, PP-02, PP-03) los leen. **Si cambias el simulador o la referencia, regenera los dos y haz commit de los fixtures.**

| Archivo | Qué es |
|---|---|
| `formulas.py` | Las fórmulas de la sección 4 del plan, una función por fórmula, puras. Es la contraparte de `server/src/domain/costing.ts` y `forecast.ts`. |
| `simulador.py` | 12 semanas de operación (del 2026-06-16 al 2026-09-06, 72 días de atención). |
| `referencia.py` | Arma los datos como el repositorio y aplica las fórmulas: rentabilidad, factores, carta y pronósticos. |
| `pruebas_pu.py` | Casos de la Tabla 26 de la tesis (§5 del plan). |
| `datos/` | Carta, recetas aprobadas y la referencia anterior (`modelo_referencia_v0211.py`, con pandas y statsmodels; solo como guía). |

## Qué genera el simulador (`fixtures/sim12/`)

- `carta.csv`: las 51 variantes de `carta_maui.csv`. Cada variante es un plato (`sku` = «Plato (Variante)», como en la referencia anterior).
- `insumos.csv`: los cuatro críticos con rendimiento, vida útil y nivel de servicio; pulpo, langostino y conchas como no críticos (van en «otros insumos»).
- `recetas.csv`: gramos de producto limpio por plato e insumo crítico. Hay 44 variantes; las 7 bebidas no tienen receta.
- `ventas_items.csv`: `fecha, hora, boleta, plato, variante, cantidad, precio`. La columna `boleta` agrupa los ítems de una misma boleta pagada.
- `purchases.csv`, `waste.csv`, `counts.csv`, `lost_sales.csv`, `stockouts.csv`, `day_notes.csv` y `other_costs.csv`: con las columnas del export de la tesis.
- `gastos.csv`: los siete gastos mensuales con su tipo (`fijo` o `variable`), fechados el día 1 de cada mes.

En el servidor, `loadSim(db)` (`server/src/__tests__/helpers/sim.ts`) carga estos archivos en una base de prueba recién creada. `npm run db:sim` (desde `server/`) crea `server/mauidisk-sim.db` para demostraciones, con los usuarios `sim-dueno`, `sim-encargada` y `sim-cajero` (contraseña `sim12345`); se levanta con `DATABASE_URL=file:./mauidisk-sim.db npm run dev`. El script no lee `server/.env` y aborta si la URL no termina en `-sim.db`.

El modelo de generación:
- La demanda de cada plato sigue una Poisson. Su media es la base del plato (peso de la categoría × variante × un factor fijo por plato) × el factor del día de la semana × 1.30 en los feriados (28 y 29 de julio). Así, de martes a jueves se vende alrededor de S/ 1 000, y el fin de semana el doble.
- Cada porción pedida es un evento con hora y se atiende en orden. Si un insumo no alcanza para la porción, el plato se marca agotado y deja de venderse ese día. Se habilita a las 10:00 del siguiente día de atención. «No había» se registra la mitad de las veces.
- El consumo real es porciones × receta / rendimiento × **factor real**: pescado 1.04, calamar 1.08, mixtura 1.03 y limón 1.10. La calibración debe recuperar esos factores.
- Las compras se hacen martes, jueves y sábado. La cantidad cubre lo esperado hasta la siguiente compra × (1.15 ± 0.15), menos lo que quedaba, en medios kilos. El precio diario sigue un paseo aleatorio acotado al rango de cada insumo.
- Los conteos de apertura se toman todos los días de atención y el martes 2026-09-08, salvo en 3 días: uno en las semanas 2 a 4 y dos después.
- La merma son los lotes FIFO que estarán vencidos al abrir el siguiente día de atención. Se imputa al día de atención en que se descartan y se registra al día siguiente.
- Otros insumos: 18 % de las ventas del día ± 10 %.

## Convenciones que el servidor debe reproducir (contrato de la paridad)

**Días de atención.** Un día es de atención si tiene ventas, o si cae de martes a domingo y no tiene nota `cerrado`. El siguiente día de atención de una fecha se busca con la misma regla.

**Costeo, por insumo crítico.** Se recorren los días de atención desde el primer registro hasta el fin del periodo.
- `S` es la apertura usada: el conteo, o si falta, `S_prev + I_prev − M_prev − C_prev` (mínimo 0).
- `I` son las compras del día. `p_compra` es el costo total entre la cantidad.
- `p̄ = costoPromedio(S, p̄_prev, I, p_compra)` (F8).
- `M` es la merma con `fecha` (es decir, `wasted_at`) ese día.
- `C = A + I − M − A_sig` si hay conteo ese día y el siguiente día de atención. Si falta alguno, `C` es teórico: `f × Σ porciones × kg por porción`, y el día queda marcado como imputado.

**Periodo.**
- `CV = Σ (C + M) · p̄ + otros insumos`.
- `V` son las ventas de las boletas por día local.
- Merma: kg, `Σ M · p̄` y `ΣM / ΣI`.
- Gastos: cada mes se reparte entre todos sus días de atención (el mes calendario completo), y el periodo toma los días que tiene en ese mes. `GF` cuenta solo los `fijo`.
- Semanas de lunes a domingo, meses calendario, recortados al periodo.

**Factores.** Los factores (F12) se calculan con las semanas 1 a 4, solo con los días no imputados, y se aplican a todo lo demás: al consumo imputado, al costo del plato y a las ventas perdidas.

**Carta.**
- `p̄` del insumo en el periodo es `Σ C·p̄ / Σ C`.
- Costo del plato: `Σ kg · f · p̄ + (O/V) · precio` (F13). Un plato sin receta solo lleva los otros insumos.
- La ingeniería de menú se aplica a los platos con ventas en el periodo, todos juntos.

**Pronóstico de la noche N, por insumo.**
- Solo se usan los conteos hasta N, así que el consumo de N siempre es teórico.
- Serie: `D = C + L` en los días de atención desde el primer registro hasta N. `L` es F4 sobre los platos con agotado ese día. `v̄` es el promedio de las porciones del plato en `d − 7k` (k = 1 a 4) entre los días con ventas, con 0 si no se vendió; sin días previos, `v̄ = 0`.
- Selección (`formulas.seleccionar`):
  - Orígenes `o = n−3−W … n−4`, con `W = min(24, n−12)`.
  - MAE: promedio de todos los errores absolutos de los horizontes 1 a 3 sin días imputados. En empate gana el orden ingenuo estacional, promedio estacional, Holt-Winters, regresión.
  - `σ_H` (con H = 2): desviación estándar muestral de `Σ real − Σ pronóstico` en los H días siguientes de cada origen sin imputados.
- Holt-Winters: rejilla α, γ ∈ {0.05, …, 0.95}; SSE a un paso desde t = m; en empate gana el primero (menor α, luego menor γ).
- Regresión: últimos 48 días; columnas: intercepto, `t` (0…n−1 en la ventana), los días de la semana 2 a 6 (miércoles a domingo, martes como base) que aparecen en la ventana y `feriado` si varía en la ventana. Si el sistema es singular o hay tan pocos datos como columnas, se usa el promedio estacional.
- Cantidad: la lista es para el siguiente día de atención. `A` es su conteo de apertura o, si falta, el stock teórico (F6) desde el último conteo hasta N. `Q = max(0, Σ D̂_1..H + z·σ_H − A)`.

**Sumas.** Todas las sumas van de izquierda a derecha (`formulas.suma`), en el mismo orden que `reduce` en TypeScript. Desde Python 3.12, `sum()` de floats es compensada y podría cambiar un empate.
