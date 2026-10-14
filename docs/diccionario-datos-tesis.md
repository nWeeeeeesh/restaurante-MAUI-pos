# Diccionario de datos de la tesis — v1

> Instrumento de medición de la tesis de inventario de insumos perecibles (Cevichería MAUI). Plan: [plan-inventario-tesis.md](plan-inventario-tesis.md) (v2).
> **Versión `v1`, congelada al iniciar la línea base.** Cambiar una definición o una columna exige una versión nueva de este documento y del encabezado de los CSV (`# maui-tesis dataset v2 …`). El test `server/src/__tests__/inventory.export.test.ts` falla a propósito si un encabezado cambia.
> Si MAUI migra al producto (nwish-pos-core), el export debe seguir produciendo exactamente estos archivos.

## 1. Definiciones

| Término | Definición | Cómo se obtiene |
|---|---|---|
| **Día operativo** | Fecha local (America/Lima) en que el local atendió. Un día sin ventas no es operativo | Fechas locales con al menos una boleta (`bills.paid_at`) |
| **Apertura** (`moment='apertura'`) | Stock físico de un insumo crítico al inicio del día, **antes** de la compra y **después** de descartar lo deteriorado | Campo «Quedaba» de la «Compra del día» |
| **Cierre** (`moment='cierre'`) | Conteo al cerrar. **No forma parte del instrumento v1**: los registros `cierre` previos a la v2 fueron pruebas | — |
| **Merma por deterioro** | Lo descartado al revisar en la mañana. Se imputa al **día operativo anterior** a la fecha de la «Compra del día» (si no hay ninguno, al día calendario anterior) | Campo «Botaste» (`supply_waste`, `reason='deterioro'`, `source='daily'`) |
| **Merma (otras causas)** | `sobra_comensal`, `preparacion`, `otro` y deterioros registrados fuera de la rutina | Pestaña Merma (`source='manual'`) |
| **Compra** | Insumo adquirido en una fecha, con su costo total | «Compraste» (`source='daily'`) o pestaña Compras (`source='manual'`) |
| **Consumo real del día d** | apertura(d) + compras(d) − merma(d) − apertura(d+1) | Calculado en el análisis |
| **Precio unitario** | `costo_total / cantidad` de cada compra. Para costeo: promedio ponderado de la semana | Calculado (columna `costo_unitario`) |
| **Quiebre** | Intervalo en que un plato estuvo agotado (`available=false`) | `audit_log`, acción `dish.availability`, solo transiciones reales |
| **Venta perdida registrada** | Cada «No había» del POS. **Opcional**: sirve para calibrar la estimación | `lost_sales` |
| **Venta perdida estimada** | Venta habitual del plato en ese día y franja × duración del quiebre | Calculada en el análisis, no en el sistema (fase 0) |
| **Registro tardío** | `registrado_en` − fecha del hecho > 1 día. Indicador de constancia | Calculado desde el CSV |
| **Adherencia (fase 0)** | Días operativos con «Compra del día» / días operativos | Calculado desde `daily` y las boletas |
| **Origen** (`source`) | `daily` = creado por la «Compra del día»; `manual` = pestañas de detalle | Columna `origen` |
| **Local** (`local_id`) | Siempre `1` en la tesis. Existe para no mapear datos si hay más sucursales | Columna `local_id` |

**Unidades:** cantidades en la unidad del insumo (`kg`, `unit`, `l`) con 2 decimales; montos en soles (S/) con 2 decimales. **Fechas:** `fecha` es el día local del hecho (`YYYY-MM-DD`); `registrado_en`, `inicio` y `fin` son fecha y hora locales (`YYYY-MM-DD HH:MM:SS`).

## 2. Formato de los archivos

- `GET /api/inventory/export?table=<tabla>&from=YYYY-MM-DD&to=YYYY-MM-DD` (dueño y encargado). Un CSV por tabla.
- UTF-8 con BOM, separador coma, fin de línea CRLF, decimales con punto.
- **Primera línea:** `# maui-tesis dataset v1 · <tabla> · desde <from> · hasta <to> · generado <YYYY-MM-DD HH:MM> America/Lima`. Al leerlo con pandas: `pd.read_csv(f, comment='#')` o `skiprows=1`.
- **Segunda línea:** encabezado con las columnas en el orden fijo de la §3.
- Textos que empiezan con `= + - @` se anteponen con `'` para que la hoja de cálculo no los ejecute.
- El rango filtra por la fecha del hecho (`fecha`); en `stockouts`, por los intervalos que se superponen con el rango.

## 3. Tablas exportables

### `daily` — vista por día e insumo de la «Compra del día»
Una fila por fecha de «Compra del día» e insumo con algún dato. `botaste` es lo que se registró **ese día** (su fecha imputada está en `waste`).

| Columna | Tipo | Descripción |
|---|---|---|
| `local_id` | entero | Local |
| `fecha` | fecha | Fecha de la «Compra del día» |
| `insumo_id` | entero | Id del insumo |
| `insumo_codigo` | texto | Código estable (`CALAMAR`) |
| `insumo` | texto | Nombre al exportar |
| `unidad` | texto | `kg`, `unit` o `l` |
| `quedaba` | decimal o vacío | Apertura; vacío si no se contó |
| `botaste` | decimal | Merma por deterioro registrada ese día (0 si nada) |
| `compraste` | decimal | Cantidad comprada (0 si nada) |
| `precio_unitario` | decimal o vacío | `costo_total / compraste` |
| `costo_total` | decimal o vacío | S/ pagados |
| `proveedor` | texto o vacío | Proveedor de la compra |

### `purchases` — compras
`local_id, id, fecha, insumo_id, insumo_codigo, insumo, unidad, cantidad, costo_total, costo_unitario, proveedor, origen, notas, registrado_por, registrado_en`

### `waste` — merma
`local_id, id, fecha, insumo_id, insumo_codigo, insumo, unidad, cantidad, motivo, origen, notas, registrado_por, registrado_en`
`fecha` es la fecha imputada (para `origen=daily`, el día operativo anterior). `motivo`: `deterioro`, `sobra_comensal`, `preparacion`, `otro`.

### `counts` — conteos físicos
`local_id, fecha, momento, insumo_id, insumo_codigo, insumo, unidad, cantidad, registrado_por, registrado_en`
`momento`: `apertura` (instrumento v1) o `cierre` (fuera del instrumento).

### `lost_sales` — ventas perdidas registradas («No había»)
`local_id, id, fecha, hora, plato_id, plato, insumo_id, insumo_codigo, insumo, porciones, registrado_por`
El momento del hecho es el del registro (un toque en el POS), por eso no hay `registrado_en` aparte.

### `stockouts` — quiebres
`local_id, plato_id, plato, inicio, fin, duracion_min, marcado_por, habilitado_por`
Un intervalo por quiebre. `fin` y `duracion_min` vacíos si el plato sigue agotado al exportar.

### `day_notes` — notas del día (variables de contexto)
`local_id, id, fecha, tipo, texto, registrado_por, registrado_en`
`tipo`: `feriado`, `cerrado`, `evento`, `proveedor`, `otro`. El inicio de la línea base se anota como `otro`.

### `supplies` — catálogo de insumos
`id, codigo, nombre, unidad, perecible, critico, activo, orden`
Sin `local_id`: el catálogo es del negocio, no de un local. `codigo` no cambia aunque cambie el nombre.

## 4. Variables de control y fuentes fuera del inventario

| Variable | Fuente |
|---|---|
| Día de la semana | Derivado de `fecha` |
| Feriados, días cerrados, eventos, cambios de proveedor | `day_notes` |
| Precio por kg | `purchases.costo_unitario` |
| Ventas (ingresos, platos vendidos) | Boletas: Reportes → exportar, o la BD (`bills`, `order_items`) |
| Gastos generales | Reportes → Gastos (`expenses`) |
