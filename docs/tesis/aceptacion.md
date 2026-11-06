# Pruebas de aceptación — guion para el propietario

Sistema de pronóstico de demanda y cálculo de rentabilidad operativa para la cevichería MAUI (modelo incremental). Este guion lo sigue el **propietario** (o quien él designe) para aceptar cada incremento. Las pruebas automáticas que respaldan cada criterio llevan su ID entre corchetes en `server/src/__tests__/` (`npm run ci`).

> **Numeración de las PA.** El plan del sistema fija que PA-07 es el rendimiento en la Raspberry Pi y que PA-02 a PA-06 se pueden hacer en la PC. El resto de la numeración se propuso aquí por incremento. Si la tabla de pruebas de aceptación de la tesis numera distinto, ajusta solo la columna «PA» y conserva los criterios.

## Cómo preparar la prueba

| Dónde | Preparación |
|---|---|
| PC (PA-02 a PA-06) | `cd server && npm run db:sim` crea `mauidisk-sim.db` con 12 semanas simuladas (2026-06-16 a 2026-09-06). Levanta el servidor con `DATABASE_URL=file:./mauidisk-sim.db npm run dev` y el cliente con `npm run dev:client`. Usuarios: `sim-dueno`, `sim-encargada` y `sim-cajero`, contraseña `sim12345`. |
| Local (PA-01, PA-07, PA-08) | La Raspberry Pi del local con la versión desplegada (DEPLOYMENT.md), la ticketera y los celulares del personal. |

## Resumen

| PA | Incremento | Qué se acepta | Requisitos | Dónde | Resultado | Fecha | Evidencia |
|---|---|---|---|---|---|---|---|
| PA-01 | 1 | El encargado registra la «Compra del día» completa desde su celular | RF01–RF05, RNF02 | Local | Pendiente | | |
| PA-02 | 1 | «Hoy no compré» y export del dataset v2 | RF02, RF07, RD05 | PC | **Aceptada** | 2026-11-06 | Pruebas `[PI-02]`, `[PI-07]` |
| PA-03 | 2 | La rentabilidad de un periodo coincide con el cálculo de referencia | RF10, RF12, RF14 | PC | **Aceptada** | 2026-11-06 | `[PP-01]`, `[PI-09]`; [captura](capturas/rentabilidad-desktop.png) |
| PA-04 | 2 | Recetas, calibración, costo y margen por plato, tipo de gasto | RF06, RF08, RF09, RF11, RF13 | PC | **Aceptada** | 2026-11-06 | `[PI-06]`, `[PI-08]`; [recetas](capturas/recetas-desktop.png), [gasto](capturas/gastos-mobile.png), [insumo](capturas/insumo-mobile.png) |
| PA-05 | 3 | Lista de compra con pronóstico, cobertura editable e impresión | RF15, RF16, RF17, RD04 | PC | **Aceptada** | 2026-11-06 | `[PP-02]`, `[PP-03]`, `[PI-10]`, `[PI-12]`; [captura](capturas/lista-desktop.png) |
| PA-06 | 3 | Aviso de pocas porciones; el agotado lo confirma una persona; la «Compra del día» no muestra el pronóstico | RF18, RF19, RD01, RD02 | PC | **Aceptada** | 2026-11-06 | `[PI-11]`, `[PI-13]`, `[PI-14]`; [captura](capturas/pos-mobile.png) |
| PA-07 | 2 y 3 | Tiempos de respuesta en la Raspberry Pi | RNF09 | Local | Pendiente | | `npm run perf` en la Pi |
| PA-08 | 3 | La tarea nocturna corre sola una semana y cada rol ve solo lo suyo | RF16, RNF06 | Local | Pendiente | | `forecast_runs`, celulares por rol |

## Criterios por prueba

### PA-01 · Registro diario en el local (incremento 1)
1. El encargado abre **Inventario → Hoy** en su celular antes de comprar y completa **«Al abrir»**: lo que quedaba de cada crítico y lo botado (también 0). Guarda.
2. Al volver del mercado completa **«Al volver de comprar»**: cantidad, precio y proveedor de cada compra, y el monto de otros insumos. Guarda.
3. Un día sin compras usa **«Hoy no compré»**.

**Se acepta si:** cada parte se guarda en menos de 3 minutos (`daily_parts.duracion_ms`); al día siguiente el «Hoy empezaste con» muestra lo registrado; el export `daily` del día tiene una fila por crítico.

### PA-02 · «Hoy no compré» y dataset v2 (PC)
1. En **Hoy**, «Al volver de comprar» → **Hoy no compré**. Con una compra escrita, el botón queda deshabilitado.
2. **Inventario → Exportar**: descarga `daily_parts`, `recipe_items`, `demand_forecasts` y `purchase_suggestions`.

**Se acepta si:** `daily_parts.no_compro = 1` en ese guardado; cada CSV empieza con `# maui-tesis dataset v2` y sus columnas son las del [diccionario v2](../diccionario-datos-tesis.md).
**Resultado (2026-11-06):** aceptada. `npx vitest run -t "PI-02|PI-07"` en verde: marcar, conflicto con compras (400) y revertir; encabezados de las 18 tablas iguales a la §3 del diccionario.

### PA-03 · Rentabilidad (PC)
1. **Rentabilidad → Rango** del 16/06/2026 al 06/09/2026, **Por semana**.
2. Revisa las tarjetas, la serie semanal y la sección «Revisa».

**Se acepta si:** las cifras coinciden con las de la referencia en Python (`server/src/__tests__/fixtures/sim12/esperado.json`) con una diferencia de S/ 0.01 o menos; un periodo sin ventas muestra «no aplica» en food cost y ventas de equilibrio; las bebidas aparecen como platos sin receta sin interrumpir el cálculo.
**Resultado (2026-11-06):** aceptada. Después de calibrar con las semanas 1 a 4, la pantalla muestra ventas S/ 98 845.00 y utilidad operativa S/ 27 169.74, igual que `esperado.json` ([captura](capturas/rentabilidad-desktop.png), [celular](capturas/rentabilidad-mobile.png)). `[PP-01]` compara las 12 semanas, los 4 meses, los 4 factores y los 51 platos; `[PI-09]` compara los totales con los registros.

### PA-04 · Recetas, calibración y gastos (PC)
1. **Recetas**: abre «Ceviche clásico de pescado», cambia los gramos de pescado y guarda.
2. **Recetas → Calibrar** con el 16/06/2026 al 12/07/2026 y confirma.
3. **Inventario → Insumos → Editar** Pescado: rendimiento 80 %, vida útil 7, nivel de servicio 99 %.
4. **Reportes → Tipo de gasto**: pasa «luz» a variable.
5. Vuelve a **Rentabilidad**.

**Se acepta si:** la receta muestra los gramos nuevos; los factores quedan en 1.040, 1.080, 1.030 y 1.100 sin aviso de rango (los factores reales de la simulación son 1.04, 1.08, 1.03 y 1.10); el gasto fijo baja y las ventas de equilibrio bajan; cada cambio aparece en Reportes → «Cancelaciones y correcciones».
**Resultado (2026-11-06):** aceptada ([recetas y calibración](capturas/recetas-desktop.png), [tipo de gasto](capturas/gastos-mobile.png), [insumo](capturas/insumo-mobile.png)). `[PI-06]`: «luz» a variable baja el gasto fijo de julio de S/ 12 800 a S/ 12 300. `[PI-08]`: 180 g limpios con rendimiento 0.80 = 0.225 kg por porción.

### PA-05 · Lista de compra (PC)
1. Entra como **sim-encargada** → **Lista de compra**, fecha 20/08/2026.
2. Sube la cobertura del limón a 3 días; intenta pasar de la vida útil.
3. **Imprimir**.

**Se acepta si:** cada crítico muestra cuánto comprar (en medios kilos), lo que se usará, lo que hay y el «por si acaso»; la cobertura no pasa de min(3, vida útil); la ticketera imprime la lista; pedir la lista dos veces no cambia el pronóstico de esa noche.
**Resultado (2026-11-06):** aceptada ([captura](capturas/lista-desktop.png), [celular](capturas/lista-mobile.png)). `[PP-02]` y `[PP-03]`: en las 24 noches de las semanas 9 a 12, método, pronósticos, σ y cantidad sugerida iguales a la referencia en los 4 insumos. `[PI-10]`: una segunda ejecución no cambia nada (RD04). `[PI-12]`: la impresión con una ticketera simulada por TCP, y 502 sin impresora. La impresión en la ticketera real queda para PA-08.

### PA-06 · Avisos y agotados (PC)
1. Entra como **sim-cajero** → **Pedidos**. Despliega el aviso «Quedan pocas porciones».
2. **Marcar agotado** en un plato → confirma.
3. Entra como encargado a **Inventario → Hoy**.

**Se acepta si:** el aviso no cambia nada por sí solo; solo al confirmar el plato queda agotado en todos los celulares, y la auditoría lo registra como `propuesta_confirmada`; la «Compra del día» no muestra pronósticos, sugerencias ni stock teórico.
**Resultado (2026-11-06):** aceptada ([captura](capturas/pos-mobile.png)). `[PI-13]`: con 6 porciones no avisa; al cobrar avisa con 5 y luego con 4. `[PI-14]`: la disponibilidad no cambia sin confirmación. `[PI-11]`: `GET /api/inventory/daily/:date` responde idéntico antes y después de pronosticar.

### PA-07 · Rendimiento en la Raspberry Pi (local)
1. En la Pi: `cd server && npm run db:sim && npm run perf`.

**Se acepta si:** el p95 de la rentabilidad de un mes y de la lista de compra es ≤ 3 000 ms y el de la tarea nocturna ≤ 60 s (`docs/tesis/rendimiento.json`). En la PC (Ryzen 7 7700X) dieron 30.5 ms, 43.9 ms y 49.7 ms.

### PA-08 · Una semana de operación (local)
1. Durante 7 días de atención, el sistema queda encendido sin tocar nada.
2. Cada mañana, el encargado imprime la lista de compra.
3. El mozo, el cajero, el encargado y el dueño revisan su menú en su celular.

**Se acepta si:** hay una fila `ok` en `forecast_runs` por cada noche de atención; la lista se imprime en la ticketera real; el mozo no ve Rentabilidad, Recetas ni Lista de compra; el cajero y el encargado no ven Rentabilidad ni Recetas.

## Revisión de cada pantalla

| Pantalla | Rol | Qué revisar | Resultado | Fecha |
|---|---|---|---|---|
| Inventario → Hoy | Encargado | Las dos partes, «Hoy no compré», sin pronósticos ni sugerencias (RD01) | | |
| Inventario → Insumos | Dueño | Rendimiento, vida útil y nivel de servicio, cada uno con su ayuda | Revisada en la PC | 2026-11-06 |
| Rentabilidad | Dueño | Periodos, tarjetas con ayuda, serie, insumos, platos, advertencias | Revisada en la PC | 2026-11-06 |
| Recetas | Dueño | Editor por variante, calibración y aviso de rango | Revisada en la PC | 2026-11-06 |
| Reportes → Tipo de gasto | Dueño | Fijo y variable | Revisada en la PC | 2026-11-06 |
| Lista de compra | Dueño y encargado | Cobertura, cantidades, Imprimir | Revisada en la PC | 2026-11-06 |
| Pedidos (aviso de porciones) | Todos (marca: cajero, encargado, dueño) | Aviso plegado, «Marcar agotado» con confirmación | Revisada en la PC | 2026-11-06 |
| Menú inferior en el celular | Todos | Que las entradas nuevas no tapen las de siempre | | |
