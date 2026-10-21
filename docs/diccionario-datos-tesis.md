# Diccionario de datos de la tesis — v1 (congelado el 2026-11-09)

> Instrumento de medición de la tesis de inventario de insumos perecibles (Cevichería MAUI). Plan de desarrollo: [plan-inventario-tesis.md](plan-inventario-tesis.md) (v3). Diseño de la investigación: [tesis/README.md](tesis/README.md).
> **Dataset `v1`, congelado el 2026-11-09** (inicio de la línea base). Desde ese día, cambiar una definición o una columna exige una versión nueva de este documento y del encabezado de los CSV (`# maui-tesis dataset v2 …`). El test `server/src/__tests__/inventory.export.test.ts` falla a propósito si un encabezado cambia. Lo que la fase 2 agregue (recetas, calibración, sugerencias) va como **adenda v1.1** en tablas nuevas, sin tocar las existentes.
> Si MAUI migra al producto (nwish-pos-core), el export debe seguir produciendo exactamente estos archivos.

## 1. Definiciones

| Término | Definición | Cómo se obtiene |
|---|---|---|
| **Día operativo** | Fecha local (America/Lima) en que el local atendió. Un día sin ventas no es operativo | Fechas locales con al menos una boleta (`bills.paid_at`) |
| **Local** (`local_id`) | Número del local que registró el dato. Cada local tiene su propia instancia y su base; sale de la variable de entorno `MAUI_LOCAL_ID` (1 = local principal, unidad de estudio; 2 = segundo local, solo descriptivo) | Columna `local_id` |
| **Grupo del estudio** (`study_group`) | Familia de insumos que recibe la intervención en conjunto: `calamar` (CALAMAR), `pescado` (PESCADO), `mariscos` (PULPO, LANGOSTINO, CONCHAS). Mariscos es el grupo de comparación. Los demás insumos quedan fuera del estudio | Columna `grupo` de `supplies` |
| **Estado de activación** | Un grupo está **activo** en la fecha d si tiene fecha de activación y d ≥ esa fecha (hora de Lima). Antes de su fecha, el grupo no recibe nada de la intervención. Los indicadores del negocio en conjunto solo se muestran después de `study_ends_on` | Tabla `study_config` (`activates_<grupo>`, `study_ends_on`) |
| **Parte del registro** | La «Compra del día» tiene dos partes que se guardan por separado: **apertura** («Al abrir»: quedaba, botaste y notas) y **compra** («Al volver de comprar»: compras, otros insumos y traslados). Cada guardado deja autor, hora, duración y si fue corrección | Tabla `daily_parts` |
| **Apertura** (`moment='apertura'`) | Stock físico de un insumo crítico al inicio del día, **antes** de la compra y **después** de descartar lo deteriorado. Es obligatoria para todos los críticos activos al guardar la parte «Al abrir» | Campo «Quedaba» |
| **Cierre** (`moment='cierre'`) | Conteo al cerrar. **No forma parte del instrumento**: los registros `cierre` anteriores a la v2 fueron pruebas | — |
| **Merma por deterioro** | Lo descartado al revisar en la mañana. Se imputa al **día operativo anterior** a la fecha del registro (si no hay ninguno, al día calendario anterior). Se guarda **también en 0** para distinguir «no boté nada» (`typed`) de «no lo toqué» (`default`) | Campo «Botaste» (`supply_waste`, `reason='deterioro'`, `source='daily'`) |
| **Merma (otras causas)** | `sobra_comensal`, `preparacion`, `otro` y deterioros registrados fuera de la rutina | Historial → Otra merma (`source='manual'`) |
| **Compra** | Insumo adquirido en una fecha, con su costo total. En la «Compra del día» la cantidad **nunca se prellena**: cada compra la confirmó el usuario (escribiéndola o con [Usar]) | «Compraste» (`source='daily'`) o Historial → Otra compra (`source='manual'`) |
| **Otros insumos** | Monto en S/ de todo lo no crítico comprado ese día para el local (limón, cebolla, abarrotes…), sin desglose | «Otros insumos del día» (`other_supply_costs`) |
| **Traslado** | Insumo que pasa de un local al otro. Cada local registra solo su lado: el local 1 el **envío**, el local 2 la **recepción**. Existen desde `second_local_opens_on`; la conciliación se hace en el análisis por fecha y código | «Enviaste al otro local» / «Recibiste del local principal» (`supply_transfers`) |
| **Ingresos del día al local** | compras(d) − enviado(d) + recibido(d) | Calculado en el análisis |
| **Consumo real del día d** | apertura(d) + ingresos(d) − merma(d) − apertura(d+1) | Calculado en el análisis |
| **Modo de entrada** | Cómo llegó cada valor: `typed` (lo escribió una persona), `copied` (vino de [Usar] o del precio prellenado sin cambiar), `default` (no se tocó: «Botaste» en 0). Vacío en los registros anteriores a la v3 | Columnas `modo_*` |
| **Dueño ausente** | Nota del día `dueno_ausente` («El dueño no estuvo»): variable de control | `day_notes` |
| **Precio unitario** | `costo_total / cantidad` de cada compra. Para costeo: promedio ponderado de la semana | Calculado (columna `costo_unitario`) |
| **Venta** | Cada ítem **cobrado** (con boleta), en la fecha y hora local del cobro. Lo no cobrado nunca fue venta. Lo cobrado de un pedido que después se canceló sale con `anulado = 1` (en la v1.1 no existe anulación de boletas; el dinero sí entró): el análisis decide si lo excluye | Export `sales` |
| **Quiebre** | Intervalo en que un plato estuvo agotado (`available=false`). Lo marca siempre una persona durante el estudio: `origen = manual` (la fase 2 agregará `propuesta_confirmada`) | `audit_log`, acción `dish.availability`, solo transiciones reales |
| **Venta perdida registrada** | Cada «No había» del POS. **Opcional**: sirve para calibrar la estimación | `lost_sales` |
| **Venta perdida estimada** | Venta habitual del plato en ese día y franja × duración del quiebre (cota superior) | Calculada en el análisis, no en el sistema |
| **Registro tardío** | `registrado_en` − fecha del hecho > 1 día. Indicador de constancia | Calculado desde el CSV |
| **Adherencia (fase 0)** | Días operativos con las dos partes registradas / días operativos | `daily_parts` y `sales` |
| **Origen** (`source`) | `daily` = creado por la «Compra del día»; `manual` = Historial y pestañas de detalle | Columna `origen` |

**Indicador principal y precios constantes.** La utilidad bruta atribuible a cada grupo por semana (ventas de los platos con esos insumos, asignadas según el costo de la receta, − costo de los insumos consumidos, a precios constantes) **se calcula en el análisis**, no en el sistema. El sistema aporta las ventas por plato y hora (`sales`), los ingresos y conteos por insumo (`daily`, `purchases`, `transfers`, `counts`, `waste`) y, desde la fase 2, las recetas.

**Unidades:** cantidades en la unidad del insumo (`kg`, `unit`, `l`) con 2 decimales; montos en soles (S/) con 2 decimales. **Fechas:** `fecha` es el día local del hecho (`YYYY-MM-DD`); `registrado_en`, `inicio`, `fin`, `apertura_en` y `compra_en` son fecha y hora locales (`YYYY-MM-DD HH:MM:SS`).

## 2. Formato de los archivos

- `GET /api/inventory/export?table=<tabla>&from=YYYY-MM-DD&to=YYYY-MM-DD` (dueño y encargado). Un CSV por tabla y por local (cada instancia exporta lo suyo).
- UTF-8 con BOM, separador coma, fin de línea CRLF, decimales con punto.
- **Primera línea:** `# maui-tesis dataset v1 · <tabla> · desde <from> · hasta <to> · generado <YYYY-MM-DD HH:MM> America/Lima`. Al leerlo con pandas: `pd.read_csv(f, comment='#')` o `skiprows=1`.
- **Segunda línea:** encabezado con las columnas en el orden fijo de la §3.
- Textos que empiezan con `= + - @` se anteponen con `'` para que la hoja de cálculo no los ejecute.
- El rango filtra por la fecha del hecho (`fecha`); en `stockouts`, por los intervalos que se superponen con el rango; en `sales`, por la fecha local del cobro; `study_config` sale completa.

## 3. Tablas exportables

### `daily` — vista por día e insumo de la «Compra del día»
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
Un intervalo por quiebre. `fin` y `duracion_min` vacíos si el plato sigue agotado al exportar. `origen`: `manual` (los eventos anteriores a la v3, sin origen guardado, fueron todos manuales).

### `lost_sales` — ventas perdidas registradas («No había»)
`local_id, id, fecha, hora, plato_id, plato, insumo_id, insumo_codigo, insumo, porciones, registrado_por`
El momento del hecho es el del registro (un toque en el POS), por eso no hay `registrado_en` aparte.

### `day_notes` — notas del día (variables de contexto)
`local_id, id, fecha, tipo, texto, registrado_por, registrado_en`
`tipo`: `feriado`, `cerrado`, `evento`, `proveedor`, `dueno_ausente`, `otro`. El inicio de la línea base se anota como `otro`.

### `daily_parts` — partes del registro
`local_id, id, fecha, parte, registrado_por, registrado_en, duracion_ms, es_correccion, version_cliente`
Una fila por cada guardado. `parte`: `apertura` o `compra`. `duracion_ms`: del primer render de la tarjeta (o del guardado anterior) al guardado exitoso. `es_correccion` = 1 si esa parte ya estaba guardada para la fecha.

### `study_config` — configuración del estudio
`clave, valor, actualizado_por, actualizado_en`
Claves: `baseline_starts_on`, `study_ends_on`, `activation_order`, `activates_calamar`, `activates_pescado`, `activates_mariscos`, `second_local_opens_on`, `protocol_url`. Los cambios quedan en `audit_log` (`study.configure`).

### `supplies` — catálogo de insumos
`id, codigo, nombre, unidad, perecible, critico, activo, orden, grupo`
Sin `local_id`: el catálogo es del negocio. `codigo` no cambia aunque cambie el nombre; el segundo local usa los mismos códigos.

## 4. Variables de control y fuentes fuera del inventario

| Variable | Fuente |
|---|---|
| Día de la semana | Derivado de `fecha` |
| Feriados, días cerrados, eventos, cambios de proveedor, Cuaresma y Semana Santa, ausencia del dueño | `day_notes` |
| Afluencia | `sales` de bebidas y de platos sin insumos críticos |
| Precio por kg | `purchases.costo_unitario` |
| Gastos generales | Reportes → Gastos (`expenses`) |
