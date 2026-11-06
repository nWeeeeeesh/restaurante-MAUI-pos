# Evidencias para el Capítulo IV

> Generado por `npm run report:tesis` (`server/scripts/trazabilidad.ts`) el 2026-11-06. No editar a mano: se regenera desde las pruebas (Vitest), `docs/tesis/rendimiento.json` y la lista de requisitos del script.

## 1. Resumen

| | Cantidad |
|---|---|
| Pruebas automáticas | 241 (241 en verde) |
| Unitarias (`domain.*.test.ts`: fórmulas puras) | 26 |
| Integración (servicios, API HTTP, migraciones) | 209 |
| Paridad con la referencia en Python (`[PP-xx]`) | 6 |
| Casos unitarios de la tesis cubiertos | 18 de 18 (PU-01, PU-02, PU-03, PU-04, PU-05, PU-06, PU-07, PU-08, PU-09, PU-10, PU-11, PU-12, PU-13, PU-14, PU-15, PU-16, PU-17, PU-18) |
| Casos de integración | PI-02, PI-06, PI-07, PI-08, PI-09, PI-10, PI-11, PI-12, PI-13, PI-14, PI-15 |
| Casos de paridad | PP-01, PP-02, PP-03 |

Los casos PU-01 a PU-18 también corren en Python sobre la implementación de referencia (`python scripts/tesis/pruebas_pu.py`).

## 2. Matriz requisito → pruebas → estado

### Requisitos funcionales (19)

| Requisito | Descripción | Pruebas | Estado | Si no hay prueba |
|---|---|---|---|---|
| RF01 | Registro de la «Compra del día» (incremento 1) | — | — | Aceptación manual: PA-01 |
| RF02 | «Hoy no compré» | 1 (PI-02) | ✅ en verde |  |
| RF03 | Registro del incremento 1 | — | — | Aceptación manual: PA-01 |
| RF04 | Registro del incremento 1 | — | — | Aceptación manual: PA-01 |
| RF05 | Traslados entre locales | 1 | ✅ en verde |  |
| RF06 | Tipo de gasto fijo o variable | 1 (PI-06) | ✅ en verde |  |
| RF07 | Exportación del dataset | 20 (PI-07) | ✅ en verde |  |
| RF08 | Recetas en gramos limpios y unidad de compra | 4 (PI-08, PU-17) | ✅ en verde |  |
| RF09 | Calibración de recetas (F12) | 4 (PI-08, PP-01, PU-07, PU-08) | ✅ en verde |  |
| RF10 | Costo promedio ponderado (F8) | 2 (PU-02, PU-03) | ✅ en verde |  |
| RF11 | Costo y margen por plato (F13, F14) | 2 (PP-01, PU-09) | ✅ en verde |  |
| RF12 | Rentabilidad operativa del periodo (F9, F10, F11, F15) | 10 (PP-01, PU-01, PU-04, PU-05, PU-06, PU-10, PU-11) | ✅ en verde |  |
| RF13 | Ingeniería de menú | 2 (PP-01, PU-12) | ✅ en verde |  |
| RF14 | Totales trazables a los registros | 3 (PI-09, PU-11) | ✅ en verde |  |
| RF15 | Stock teórico (F6) | 3 (PU-14) | ✅ en verde |  |
| RF16 | Pronóstico de demanda (F4, F5, métodos y selección) | 6 (PI-10, PP-02, PU-13) | ✅ en verde |  |
| RF17 | Cantidad sugerida y lista de compra (F2) | 8 (PI-12, PP-03, PU-15, PU-16, PU-18) | ✅ en verde |  |
| RF18 | Aviso de pocas porciones | 3 (PI-13) | ✅ en verde |  |
| RF19 | Propuesta de agotado confirmada por una persona | 1 (PI-14) | ✅ en verde |  |

### Requisitos no funcionales (10)

| Requisito | Descripción | Pruebas | Estado | Si no hay prueba |
|---|---|---|---|---|
| RNF01 | — | — | — | Aceptación manual: PA (revisión manual, T20) |
| RNF02 | Ayuda de una línea en cada campo de captura | — | — | Aceptación manual: Revisión de pantallas (T20) |
| RNF03 | — | — | — | Aceptación manual: PA (revisión manual, T20) |
| RNF04 | — | — | — | Aceptación manual: PA (revisión manual, T20) |
| RNF05 | — | — | — | Aceptación manual: PA (revisión manual, T20) |
| RNF06 | Permisos por rol (401 / 403) | 4 (PI-15) | ✅ en verde |  |
| RNF07 | Esquema solo aditivo | 3 | ✅ en verde |  |
| RNF08 | — | — | — | Aceptación manual: PA (revisión manual, T20) |
| RNF09 | Tiempos de respuesta | 1 | ✅ en verde |  |
| RNF10 | — | — | — | Aceptación manual: PA (revisión manual, T20) |

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

- **RF01** (Registro de la «Compra del día» (incremento 1)): se acepta de forma manual (PA-01).
- **RF03** (Registro del incremento 1): se acepta de forma manual (PA-01).
- **RF04** (Registro del incremento 1): se acepta de forma manual (PA-01).
- **RNF01** (—): se acepta de forma manual (PA (revisión manual, T20)).
- **RNF02** (Ayuda de una línea en cada campo de captura): se acepta de forma manual (Revisión de pantallas (T20)).
- **RNF03** (—): se acepta de forma manual (PA (revisión manual, T20)).
- **RNF04** (—): se acepta de forma manual (PA (revisión manual, T20)).
- **RNF05** (—): se acepta de forma manual (PA (revisión manual, T20)).
- **RNF08** (—): se acepta de forma manual (PA (revisión manual, T20)).
- **RNF10** (—): se acepta de forma manual (PA (revisión manual, T20)).

Los requisitos del incremento 1 sin etiqueta (RF01, RF03, RF04) tienen pruebas en `inventory.daily.test.ts`, `inventory.test.ts` y `inventory.transfers.test.ts`, pero sin el ID en el nombre, porque el repositorio no define a qué corresponde cada uno. Al ponerles la etiqueta, este informe los cuenta.

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
| `report.service.test.ts` | 3 | 3 |
| `schema.test.ts` | 9 | 9 |
| `settings.test.ts` | 5 | 5 |
| `sim.test.ts` | 4 | 4 |
| `split.test.ts` | 4 | 4 |
| `tables.number.test.ts` | 5 | 5 |
| `write-lock.test.ts` | 5 | 5 |
