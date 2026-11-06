# Diccionario de datos de la tesis — v2

> Instrumento de la tesis «Sistema de pronóstico de demanda y cálculo de rentabilidad operativa para la cevichería MAUI empleando el modelo incremental». Plan de desarrollo: [plan-sistema.md](plan-sistema.md).
> **Dataset `v2`** (plan-sistema T19, 2026-11-06). Reemplaza a la v1 antes del inicio de la línea base: retira el estudio por grupos y agrega las tablas de los incrementos 2 (rentabilidad) y 3 (pronóstico). Los cambios están en la §5. Cambiar una definición o una columna exige una versión nueva de este documento y del encabezado de los CSV (`# maui-tesis dataset v3 …`). El test `server/src/__tests__/inventory.export.test.ts` lee la §3 de este documento y falla si un encabezado no coincide.
> Si MAUI migra al producto (nwish-pos-core), el export debe seguir produciendo exactamente estos archivos.

## 1. Definiciones

| Término | Definición | Cómo se obtiene |
|---|---|---|
| **Día operativo** | Fecha local (America/Lima) en que el local atendió. Un día sin ventas no es operativo | Fechas locales con al menos una boleta (`bills.paid_at`) |
| **Local** (`local_id`) | Número del local que registró el dato. Cada local tiene su propia instancia y su base; sale de la variable de entorno `MAUI_LOCAL_ID` (1 = local principal, unidad de estudio; 2 = segundo local, solo descriptivo) | Columna `local_id` |
| **Insumo crítico** | Pescado (`PESCADO`), calamar (`CALAMAR`), mixtura de mariscos (`MIXTURA`) y limón (`LIMON`). Pulpo, langostino y conchas van en «otros insumos» | Columna `critico` de `supplies` |
| **Día de atención** | Fecha local con ventas, o de martes a domingo sin nota `cerrado`. Las series del pronóstico usan solo días de atención | Calculado (plan-sistema §2) |
| **Parte del registro** | La «Compra del día» tiene dos partes que se guardan por separado: **apertura** («Al abrir»: quedaba, botaste y notas) y **compra** («Al volver de comprar»: compras, otros insumos y traslados). Cada guardado deja autor, hora, duración y si fue corrección | Tabla `daily_parts` |
| **Apertura** (`moment='apertura'`) | Stock físico de un insumo crítico al inicio del día, **antes** de la compra y **después** de descartar lo deteriorado. Es obligatoria para todos los críticos activos al guardar la parte «Al abrir» | Campo «Quedaba» |
| **Cierre** (`moment='cierre'`) | Conteo al cerrar. **No forma parte del instrumento**: los registros `cierre` anteriores a la v2 fueron pruebas | — |
| **Merma por deterioro** | Lo descartado al revisar en la mañana. Se imputa al **día operativo anterior** a la fecha del registro (si no hay ninguno, al día calendario anterior). Se guarda **también en 0** para distinguir «no boté nada» (`typed`) de «no lo toqué» (`default`) | Campo «Botaste» (`supply_waste`, `reason='deterioro'`, `source='daily'`) |
| **Merma (otras causas)** | `sobra_comensal`, `preparacion`, `otro` y deterioros registrados fuera de la rutina | Historial → Otra merma (`source='manual'`) |
| **Compra** | Insumo adquirido en una fecha, con su costo total. En la «Compra del día» la cantidad **nunca se prellena**: cada compra la confirmó el usuario (escribiéndola o con [Usar]) | «Compraste» (`source='daily'`) o Historial → Otra compra (`source='manual'`) |
| **Otros insumos** | Monto en S/ de todo lo no crítico comprado ese día para el local (limón, cebolla, abarrotes…), sin desglose | «Otros insumos del día» (`other_supply_costs`) |
| **Traslado** | Insumo que pasa de un local al otro. Cada local registra solo su lado: el local 1 el **envío**, el local 2 la **recepción**. Existen desde el ajuste `second_local_opened_on` (`app_settings`); la conciliación se hace en el análisis por fecha y código | «Enviaste al otro local» / «Recibiste del local principal» (`supply_transfers`) |
| **Ingresos del día al local** | compras(d) − enviado(d) + recibido(d) | Calculado en el análisis |
| **Consumo real del día d** | apertura(d) + ingresos(d) − merma(d) − apertura(d+1) | Calculado en el análisis |
| **Modo de entrada** | Cómo llegó cada valor: `typed` (lo escribió una persona), `copied` (vino de [Usar] o del precio prellenado sin cambiar), `default` (no se tocó: «Botaste» en 0). Vacío en los registros anteriores a la v3 | Columnas `modo_*` |
| **Dueño ausente** | Nota del día `dueno_ausente` («El dueño no estuvo»): variable de control | `day_notes` |
| **Precio unitario** | `costo_total / cantidad` de cada compra. Para costeo: promedio ponderado de la semana | Calculado (columna `costo_unitario`) |
| **Venta** | Cada ítem **cobrado** (con boleta), en la fecha y hora local del cobro. Lo no cobrado nunca fue venta. Lo cobrado de un pedido que después se canceló sale con `anulado = 1` (en la v1.1 no existe anulación de boletas; el dinero sí entró): el análisis decide si lo excluye | Export `sales` |
| **Quiebre** | Intervalo en que un plato estuvo agotado (`available=false`). Lo marca siempre una persona (RD02): `origen = manual`, o `propuesta_confirmada` cuando confirmó el aviso de pocas porciones | `audit_log`, acción `dish.availability`, solo transiciones reales |
| **Venta perdida registrada** | Cada «No había» del POS. **Opcional**: sirve para calibrar la estimación | `lost_sales` |
| **Venta perdida estimada** | Venta habitual del plato en ese día y franja × duración del quiebre (cota superior) | Calculada en el análisis, no en el sistema |
| **Registro tardío** | `registrado_en` − fecha del hecho > 1 día. Indicador de constancia | Calculado desde el CSV |
| **Adherencia (fase 0)** | Días operativos con las dos partes registradas / días operativos | `daily_parts` y `sales` |
| **Origen** (`source`) | `daily` = creado por la «Compra del día»; `manual` = Historial y pestañas de detalle | Columna `origen` |
| **Receta** | Gramos de **producto limpio** de cada insumo crítico por porción. En la unidad de compra: `kg por porción = g / 1000 / rendimiento` | `recipe_items` y `supplies.rendimiento` |
| **Factor de calibración** | Σ consumo real / Σ consumo según la receta, con los días de atención que tienen conteo ese día y el siguiente (Fórmula 12). El vigente es el último por local e insumo; fuera de 0.70–1.30 se advierte «revisar receta» | `recipe_calibrations` |
| **Tipo de gasto** | `fijo` (entra en las ventas de equilibrio) o `variable`. Una categoría sin clasificar cuenta como fija | `expense_categories` |
| **Pronóstico** | Demanda no censurada (consumo + ventas perdidas estimadas) de un insumo para cada uno de los 3 días de atención siguientes, hecho la noche `noche` con lo registrado hasta ese día. Se elige el método de menor MAE; una vez guardado no se modifica (RD04). `sigma_h` es la desviación del error acumulado en `horizonte` días | `demand_forecasts` |
| **Cantidad sugerida** | `max(0, Σ pronóstico de los días cubiertos + z·σ − disponible)` (Fórmula 2). Disponible = conteo de apertura de la fecha o el stock teórico al cierre anterior. Cada sugerencia mostrada queda guardada | `purchase_suggestions` |

**Indicadores.** El sistema calcula la rentabilidad operativa (costo de lo vendido, utilidades, merma, ventas de equilibrio, costo y margen por plato) al consultarla, a partir de estas tablas; no se guarda. Para reproducirla en el análisis basta con el export: ventas por ítem (`sales`), movimientos y conteos por insumo (`daily`, `purchases`, `transfers`, `counts`, `waste`), otros insumos, recetas, calibraciones y el tipo de cada gasto. La referencia en Python está en `scripts/tesis/`.

**Unidades:** cantidades en la unidad del insumo (`kg`, `unit`, `l`) con 2 decimales; montos en soles (S/) con 2 decimales. **Fechas:** `fecha` es el día local del hecho (`YYYY-MM-DD`); `registrado_en`, `inicio`, `fin`, `apertura_en` y `compra_en` son fecha y hora locales (`YYYY-MM-DD HH:MM:SS`).

## 2. Formato de los archivos

- `GET /api/inventory/export?table=<tabla>&from=YYYY-MM-DD&to=YYYY-MM-DD` (dueño y encargado). Un CSV por tabla y por local (cada instancia exporta lo suyo).
- UTF-8 con BOM, separador coma, fin de línea CRLF, decimales con punto.
- **Primera línea:** `# maui-tesis dataset v2 · <tabla> · desde <from> · hasta <to> · generado <YYYY-MM-DD HH:MM> America/Lima`. Al leerlo con pandas: `pd.read_csv(f, comment='#')` o `skiprows=1`.
- **Segunda línea:** encabezado con las columnas en el orden fijo de la §3.
- Textos que empiezan con `= + - @` se anteponen con `'` para que la hoja de cálculo no los ejecute.
- El rango filtra por la fecha del hecho (`fecha`); en `stockouts`, por los intervalos que se superponen con el rango; en `sales`, por la fecha local del cobro; en `demand_forecasts`, por la noche del pronóstico. `supplies`, `recipe_items`, `recipe_calibrations`, `expense_categories` y `app_settings` salen completas.

## 3. Tablas exportables

### `daily` — vista por día e insumo de la «Compra del día»
`local_id, fecha, insumo_id, insumo_codigo, insumo, unidad, quedaba, botaste, compraste, precio_unitario, costo_total, proveedor, enviaste, recibiste, modo_quedaba, modo_botaste, modo_compraste, modo_precio, apertura_por, apertura_en, compra_por, compra_en`

Una fila por fecha de registro, insumo y local con algún dato. `botaste` es lo que se registró **ese día** (su fecha imputada está en `waste`).

| Columna | Tipo | Descripción |
|---|---|---|
| `local_id` | entero | Local |
| `fecha` | fecha | Fecha de la «Compra del día» |
| `insumo_id` | entero | Id del insumo |
| `insumo_codigo` | texto | Código estable (`CALAMAR`) |
| `insumo` | texto | Nombre al exportar |
| `unidad` | texto | `kg`, `unit` o `l` |
| `quedaba` | decimal o vacío | Apertura; vacío si no se registró la parte «Al abrir» |
| `botaste` | decimal | Merma por deterioro registrada ese día (0 si nada) |
| `compraste` | decimal | Cantidad comprada (0 si nada) |
| `precio_unitario` | decimal o vacío | `costo_total / compraste` |
| `costo_total` | decimal o vacío | S/ pagados |
| `proveedor` | texto o vacío | Proveedor de la compra |
| `enviaste` | decimal | Enviado al otro local (0 si nada) |
| `recibiste` | decimal | Recibido del local principal (0 si nada) |
| `modo_quedaba` | texto o vacío | Modo de entrada de «Quedaba» |
| `modo_botaste` | texto o vacío | Modo de entrada de «Botaste» (`default` = no se tocó) |
| `modo_compraste` | texto o vacío | Modo de entrada de la cantidad comprada (`copied` = [Usar]) |
| `modo_precio` | texto o vacío | Modo de entrada del precio (`copied` = el último precio sin cambiar) |
| `apertura_por`, `apertura_en` | texto, fecha y hora | Quién guardó «Al abrir» y cuándo (el primer guardado; las correcciones están en `daily_parts`) |
| `compra_por`, `compra_en` | texto, fecha y hora | Ídem para «Al volver de comprar» |

### `purchases` — compras
`local_id, id, fecha, insumo_id, insumo_codigo, insumo, unidad, cantidad, costo_total, costo_unitario, proveedor, origen, modo_entrada, modo_precio, notas, registrado_por, registrado_en`

### `waste` — merma
`local_id, id, fecha, insumo_id, insumo_codigo, insumo, unidad, cantidad, motivo, origen, modo_entrada, notas, registrado_por, registrado_en`
`fecha` es la fecha imputada (para `origen=daily`, el día operativo anterior). `motivo`: `deterioro`, `sobra_comensal`, `preparacion`, `otro`. Las filas con `cantidad = 0` y `origen = daily` registran que «Botaste» se dejó en 0.

### `counts` — conteos físicos
`local_id, fecha, momento, insumo_id, insumo_codigo, insumo, unidad, cantidad, modo_entrada, registrado_por, registrado_en`
`momento`: `apertura` (instrumento) o `cierre` (fuera del instrumento).

### `transfers` — traslados entre locales
`local_id, id, fecha, insumo_id, insumo_codigo, insumo, unidad, direccion, cantidad, costo_unitario, otro_local_id, origen, modo_entrada, registrado_por, registrado_en`
`direccion`: `envio` (local 1) o `recepcion` (local 2). `costo_unitario` solo en recepción y opcional.

### `other_costs` — otros insumos del día
`local_id, id, fecha, monto, origen, modo_entrada, registrado_por, registrado_en`
Uno por día y local. Sin fila = no se registró.

### `sales` — ventas por ítem cobrado
`local_id, fecha, hora, boleta_id, plato_id, plato, categoria_id, categoria, cantidad, precio_unitario, total, anulado`
`plato` es el nombre al momento de la venta; `categoria` la categoría actual del plato. `anulado`: ver **Venta** en la §1.

### `stockouts` — quiebres
`local_id, plato_id, plato, inicio, fin, duracion_min, origen, marcado_por, habilitado_por`
Un intervalo por quiebre. `fin` y `duracion_min` vacíos si el plato sigue agotado al exportar. `origen`: `manual` o `propuesta_confirmada` (los eventos sin origen guardado fueron manuales).

### `lost_sales` — ventas perdidas registradas («No había»)
`local_id, id, fecha, hora, plato_id, plato, insumo_id, insumo_codigo, insumo, porciones, registrado_por`
El momento del hecho es el del registro (un toque en el POS), por eso no hay `registrado_en` aparte.

### `day_notes` — notas del día (variables de contexto)
`local_id, id, fecha, tipo, texto, registrado_por, registrado_en`
`tipo`: `feriado`, `cerrado`, `evento`, `proveedor`, `dueno_ausente`, `otro`. El inicio de la línea base se anota como `otro`.

### `daily_parts` — partes del registro
`local_id, id, fecha, parte, registrado_por, registrado_en, duracion_ms, es_correccion, version_cliente, no_compro`
Una fila por cada guardado. `parte`: `apertura` o `compra`. `no_compro` = 1 si la parte «compra» se guardó con «Hoy no compré» (RF02). `duracion_ms`: del primer render de la tarjeta (o del guardado anterior) al guardado exitoso. `es_correccion` = 1 si esa parte ya estaba guardada para la fecha.

### `supplies` — catálogo de insumos
`id, codigo, nombre, unidad, perecible, critico, activo, orden, rendimiento, vida_util_dias, nivel_servicio`
Sin `local_id`: el catálogo es del negocio. `codigo` no cambia aunque cambie el nombre; el segundo local usa los mismos códigos. `rendimiento`: kg limpios por kg comprado (1 si no se configuró). `vida_util_dias` y `nivel_servicio` vacíos si no se configuraron.

### `recipe_items` — recetas
`plato_id, plato, variante, insumo_id, insumo_codigo, insumo, gramos_limpios, kg_por_porcion, actualizado_por, actualizado_en`
La receta vigente. `variante` vacía = la receta del plato; un texto = la opción de modificador que la reemplaza. `kg_por_porcion` = gramos / 1000 / rendimiento actual del insumo. Los cambios anteriores quedan en `audit_log` (`recipe.update`).

### `recipe_calibrations` — factores de calibración
`local_id, id, insumo_id, insumo_codigo, factor, desde, hasta, calculado_por, calculado_en`
Todas las calibraciones; el factor vigente es el de mayor `id` por local e insumo. `desde` y `hasta`: el periodo usado.

### `demand_forecasts` — pronósticos
`local_id, id, insumo_id, insumo_codigo, noche, fecha_objetivo, horizonte, metodo, pronostico_kg, sigma_h, version_modelo, creado_en`
Un pronóstico por local, insumo, noche y día objetivo (`horizonte` 1 a 3). `metodo`: `ingenuo_estacional`, `promedio_estacional`, `holt_winters`, `regresion_calendario` o `respaldo` (historial menor que 12 días). `sigma_h` vacío con el respaldo. `version_modelo`: `mauidesk-forecast-1`.

### `purchase_suggestions` — cantidades sugeridas
`local_id, id, fecha, insumo_id, insumo_codigo, cobertura_dias, pronostico_kg, stock_seguridad_kg, disponible_kg, origen_disponible, cantidad_kg, nivel_servicio, version_modelo, registrado_por, registrado_en`
Una fila por cada vez que se mostró la lista de compra de `fecha`. `pronostico_kg` = suma de los días cubiertos; `stock_seguridad_kg` = z·σ; `origen_disponible`: `conteo` o `teorico`. `cantidad_kg` sin redondear (la pantalla la sube al medio kilo).

### `expense_categories` — tipo de gasto
`categoria, tipo, actualizado_por, actualizado_en`
`tipo`: `fijo` o `variable`. Los cambios quedan en `audit_log` (`expense_category.update`).

### `app_settings` — ajustes del local
`clave, valor, actualizado_por, actualizado_en`
Claves: `second_local_opened_on` (desde esa fecha se registran traslados). Los cambios quedan en `audit_log` (`settings.update`).

## 4. Variables de control y fuentes fuera del inventario

| Variable | Fuente |
|---|---|
| Día de la semana | Derivado de `fecha` |
| Feriados, días cerrados, eventos, cambios de proveedor, Cuaresma y Semana Santa, ausencia del dueño | `day_notes` |
| Afluencia | `sales` de bebidas y de platos sin insumos críticos |
| Precio por kg | `purchases.costo_unitario` |
| Gastos generales | Reportes → Gastos (`expenses`), con su tipo en `expense_categories` |

## 5. Cambios de v1 a v2

| Cambio | Motivo |
|---|---|
| Línea de versión `# maui-tesis dataset v2 …` | Cambiaron tablas y columnas |
| Se quita la tabla `study_config` y la columna `grupo` de `supplies` | El estudio por grupos se retiró (plan-sistema T2). La tabla y la columna siguen en la base, sin uso (RNF07) |
| `supplies` agrega `rendimiento`, `vida_util_dias` y `nivel_servicio` | Receta en la unidad de compra (incremento 2) y cantidad sugerida (incremento 3) |
| `daily_parts` agrega `no_compro` | «Hoy no compré» (RF02, T3) |
| Tablas nuevas `recipe_items`, `recipe_calibrations`, `expense_categories` | Incremento 2: rentabilidad operativa |
| Tablas nuevas `demand_forecasts`, `purchase_suggestions` | Incremento 3: pronóstico y cantidad sugerida |
| Tabla nueva `app_settings` | Reemplaza a `study_config` para la apertura del segundo local |
| `stockouts.origen` admite `propuesta_confirmada` | El aviso de pocas porciones propone el agotado y una persona lo confirma (RF19, RD02) |
| Definiciones: fuera «grupo del estudio» y «estado de activación»; nuevas «insumo crítico», «día de atención», «receta», «factor de calibración», «tipo de gasto», «pronóstico» y «cantidad sugerida» | Plan de la tesis vigente (modelo incremental) |
