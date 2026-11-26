# Evidencias para el Capítulo IV

> Generado por `npm run report:tesis` (`server/scripts/trazabilidad.ts`) el 2026-11-26. No editar a mano: se regenera desde las pruebas (Vitest), `docs/tesis/rendimiento.json` y la lista de requisitos del script.

## 1. Resumen

| | Cantidad |
|---|---|
| Pruebas automáticas | 248 (248 en verde) |
| Unitarias (`domain.*.test.ts`: fórmulas puras) | 26 |
| Integración (servicios, API HTTP, migraciones) | 216 |
| Paridad con la referencia en Python (`[PP-xx]`) | 6 |
| Casos unitarios de la tesis cubiertos | 18 de 18 (PU-01, PU-02, PU-03, PU-04, PU-05, PU-06, PU-07, PU-08, PU-09, PU-10, PU-11, PU-12, PU-13, PU-14, PU-15, PU-16, PU-17, PU-18) |
| Casos de integración | PI-02, PI-06, PI-07, PI-08, PI-09, PI-10, PI-11, PI-12, PI-13, PI-14, PI-15 |
| Casos de paridad | PP-01, PP-02, PP-03 |

Los casos PU-01 a PU-18 también corren en Python sobre la implementación de referencia (`python scripts/tesis/pruebas_pu.py`).

## 2. Matriz requisito → pruebas → estado

### Requisitos funcionales (19)

| Requisito | Descripción | Pruebas | Estado | Si no hay prueba |
|---|---|---|---|---|
| RF01 | Registrar al abrir, por insumo crítico, lo que quedaba y lo que se botó, con las notas del día | 5 | ✅ en verde |  |
| RF02 | Registrar al volver de comprar lo comprado y su precio por kg, o «Hoy no compré» | 6 (PI-02) | ✅ en verde |  |
| RF03 | Registrar el monto diario de otros insumos | 2 | ✅ en verde |  |
| RF04 | Registrar lo enviado al otro local y lo recibido (traslados) | 4 | ✅ en verde |  |
| RF05 | Marcar y desmarcar un plato como agotado desde el POS, con autor y hora | 5 | ✅ en verde |  |
| RF06 | Configurar por insumo la vida útil y el nivel de servicio, y clasificar los gastos en fijos y variables | 2 (PI-06) | ✅ en verde |  |
| RF07 | Exportar los datos con columnas fijas y diccionario | 20 (PI-07) | ✅ en verde |  |
| RF08 | Registrar las recetas (gramos limpios por porción) y el rendimiento de cada insumo | 12 (PI-08, PU-17) | ✅ en verde |  |
| RF09 | Calcular el factor de calibración de cada insumo | 4 (PI-08, PP-01, PU-07, PU-08) | ✅ en verde |  |
| RF10 | Calcular el costo promedio ponderado con cada compra | 2 (PU-02, PU-03) | ✅ en verde |  |
| RF11 | Calcular el costo y el margen de contribución de cada plato | 2 (PP-01, PU-09) | ✅ en verde |  |
| RF12 | Calcular por día, semana y mes el costo de lo vendido, food cost, utilidad bruta y operativa, merma y punto de equilibrio | 10 (PP-01, PU-01, PU-04, PU-05, PU-06, PU-10, PU-11) | ✅ en verde |  |
| RF13 | Clasificar los platos según la ingeniería de menú | 2 (PP-01, PU-12) | ✅ en verde |  |
| RF14 | Mostrar el panel de rentabilidad con los indicadores de RF11 a RF13 | 6 (PI-09, PU-11) | ✅ en verde |  |
| RF15 | Calcular el stock teórico de cada insumo durante el día | 3 (PU-14) | ✅ en verde |  |
| RF16 | Pronosticar cada noche la demanda diaria de los insumos críticos y guardarla | 6 (PI-10, PP-02, PU-13) | ✅ en verde |  |
| RF17 | Mostrar e imprimir la lista de compra para los días que cubrirá la compra | 8 (PI-12, PP-03, PU-15, PU-16, PU-18) | ✅ en verde |  |
| RF18 | Avisar en el POS cuando queden pocas porciones de un plato | 3 (PI-13) | ✅ en verde |  |
| RF19 | Proponer marcar un plato como agotado, sin marcarlo hasta que una persona lo confirme | 1 (PI-14) | ✅ en verde |  |

### Requisitos no funcionales (10)

| Requisito | Descripción | Pruebas | Estado | Si no hay prueba |
|---|---|---|---|---|
| RNF01 | Cada parte del registro se completa en 60 s o menos desde un celular | — | — | Aceptación manual: PA-01 |
| RNF02 | Cada campo tiene una ayuda de una línea | — | — | Aceptación manual: revisión de pantallas |
| RNF03 | Opera sin internet dentro de la red local | — | — | Aceptación manual: PA-08 |
| RNF04 | Cada guardado es atómico; volver a guardar una parte la reemplaza sin duplicarla | 5 | ✅ en verde |  |
| RNF05 | Respaldo diario con restauración probada | — | — | Aceptación manual: PA-08 (restauración del respaldo) |
| RNF06 | Cada función exige su rol y cada cambio queda en la auditoría | 5 (PI-15) | ✅ en verde |  |
| RNF07 | Cambios al esquema solo aditivos; cada regla con prueba automatizada | 3 | ✅ en verde |  |
| RNF08 | Un nuevo local se instala con la misma versión y su propio identificador | — | — | Aceptación manual: instalación con instalar.sh (DEPLOYMENT.md) |
| RNF09 | Panel de un mes ≤ 3 s en la Raspberry Pi; tarea nocturna antes de la apertura | 1 | ✅ en verde |  |
| RNF10 | Funciona en el navegador del celular y comparte el servidor con el POS sin afectarlo | — | — | Aceptación manual: PA-08 |

### Reglas de diseño

| Requisito | Descripción | Pruebas | Estado | Si no hay prueba |
|---|---|---|---|---|
| RD01 | La «Compra del día» nunca muestra el pronóstico | 1 (PI-11) | ✅ en verde |  |
| RD02 | Un plato solo queda agotado cuando lo confirma una persona | 1 (PI-14) | ✅ en verde |  |
| RD03 | No está definida en el repositorio | — | — | Aceptación manual: según la tesis |
| RD04 | Un pronóstico guardado no se modifica | 1 (PI-10) | ✅ en verde |  |
| RD05 | Dataset versionado y documentado | 20 (PI-07) | ✅ en verde |  |
| RD06 | Cada registro nuevo lleva local_id | 1 | ✅ en verde |  |

## 3. Rendimiento (RNF09)

Equipo: AMD Ryzen 7 7700X 8-Core Processor, 16 núcleos, win32 10.0.26200, Node v24.18.0. Datos: fixtures/sim12 (72 días de atención, npm run db:sim). Medido: 2026-11-06T14:43:53.988Z.

| Incremento | Operación | Repeticiones | Mediana (ms) | p95 (ms) | Límite (ms) | Cumple |
|---|---|---|---|---|---|---|
| 2 | obtenerRentabilidad (agosto, por semana) | 20 | 26.6 | 30.5 | 3000 | ✅ |
| 2 | obtenerRentabilidad (12 semanas, por semana) | 20 | 26.8 | 29.5 | 3000 | ✅ |
| 3 | generarPronosticos (noche del 2026-09-06, 4 insumos) | 20 | 43.8 | 49.7 | 60000 | ✅ |
| 3 | listaCompra (2026-09-08, cobertura 2) | 20 | 34.9 | 43.9 | 3000 | ✅ |

La medición en la Raspberry Pi es la prueba de aceptación PA-07 ([aceptacion.md](aceptacion.md)).

## 4. Requisitos sin prueba automática

- **RNF01** (Cada parte del registro se completa en 60 s o menos desde un celular): se acepta de forma manual (PA-01).
- **RNF02** (Cada campo tiene una ayuda de una línea): se acepta de forma manual (revisión de pantallas).
- **RNF03** (Opera sin internet dentro de la red local): se acepta de forma manual (PA-08).
- **RNF05** (Respaldo diario con restauración probada): se acepta de forma manual (PA-08 (restauración del respaldo)).
- **RNF08** (Un nuevo local se instala con la misma versión y su propio identificador): se acepta de forma manual (instalación con instalar.sh (DEPLOYMENT.md)).
- **RNF10** (Funciona en el navegador del celular y comparte el servidor con el POS sin afectarlo): se acepta de forma manual (PA-08).

## 5. Pruebas por archivo

| Archivo | Pruebas | En verde |
|---|---|---|
| `audit.test.ts` | 5 | 5 |
| `auth.session.test.ts` | 5 | 5 |
| `billing.test.ts` | 16 | 16 |
| `domain.costing.test.ts` | 14 | 14 |
| `domain.forecast.test.ts` | 12 | 12 |
| `forecast.api.test.ts` | 7 | 7 |
| `forecast.test.ts` | 8 | 8 |
| `http.test.ts` | 6 | 6 |
| `inventory.daily.test.ts` | 12 | 12 |
| `inventory.export.test.ts` | 26 | 26 |
| `inventory.test.ts` | 13 | 13 |
| `inventory.transfers.test.ts` | 4 | 4 |
| `kitchen.reprint.test.ts` | 6 | 6 |
| `menu.archive.test.ts` | 7 | 7 |
| `menu.realtime.test.ts` | 2 | 2 |
| `order.serializer.test.ts` | 3 | 3 |
| `orders.create.test.ts` | 6 | 6 |
| `orders.lifecycle.test.ts` | 11 | 11 |
| `orders.pricing.test.ts` | 8 | 8 |
| `permissions.test.ts` | 14 | 14 |
| `profitability.api.test.ts` | 8 | 8 |
| `profitability.test.ts` | 7 | 7 |
| `receipt.test.ts` | 6 | 6 |
| `recipes-import.test.ts` | 7 | 7 |
| `report.service.test.ts` | 3 | 3 |
| `schema.test.ts` | 9 | 9 |
| `settings.test.ts` | 5 | 5 |
| `sim.test.ts` | 4 | 4 |
| `split.test.ts` | 4 | 4 |
| `tables.number.test.ts` | 5 | 5 |
| `write-lock.test.ts` | 5 | 5 |
