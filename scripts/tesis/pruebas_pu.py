# -*- coding: utf-8 -*-
"""Casos de prueba unitarios PU-01 a PU-18 (plan-sistema §5, Tabla 26 de la tesis) sobre
formulas.py, más los casos de resultado conocido del pronóstico (T14).

Uso: python scripts/tesis/pruebas_pu.py   (sale con código 1 si alguno falla)
"""
import sys

import formulas as F

fallos = []


def caso(id_, descripcion, obtenido, esperado, tol=0.01):
    if isinstance(esperado, (int, float)) and not isinstance(esperado, bool) and obtenido is not None:
        ok = abs(obtenido - esperado) <= tol
    else:
        ok = obtenido == esperado
    print(f"{'ok ' if ok else 'MAL'} {id_:6} {descripcion}: {obtenido!r} (esperado {esperado!r})")
    if not ok:
        fallos.append(id_)


# ── Costeo ──
C = F.consumo_real(6.0, 10.0, 0.5, 4.0)
caso('PU-01', 'consumo real (F7)', C, 11.5)
p = F.costo_promedio(6.0, 22.00, 10.0, 24.00)
caso('PU-02', 'costo promedio con compra (F8)', p, 23.25)
caso('PU-03', 'costo promedio sin compra', F.costo_promedio(6.0, 22.00, 0.0, None), 22.00)
CV = (C + 0.5) * p + 120.00
caso('PU-04', 'costo de lo vendido (F9)', CV, 399.00)
G, GF = F.prorratear_gastos({'2026-06': [('sueldos', 9000, 'fijo'), ('alquiler', 2400, 'fijo'), ('luz', 600, 'fijo')]},
                            {'2026-06': 30}, {'2026-06': 1})
caso('PU-05', 'prorrateo (G)', G, 400.00)
caso('PU-05', 'utilidad operativa (F10)', F.resultado(1450, CV, G, GF)['UO'], 651.00)
m = F.merma([0.5], [10.0], [p])
caso('PU-06', 'merma %', m['pct'], 5.00)
caso('PU-06', 'merma S/ (F11)', m['soles'], 11.63)
f = F.factor_calibracion([11.5], [42 * 0.25])
caso('PU-07', 'factor de calibración (F12)', f, 1.0952, tol=0.0001)
caso('PU-08', 'factor fuera de rango', F.fuera_de_rango(1.45), True)
c = F.costo_plato({'PESCADO': 0.25}, {'PESCADO': f}, {'PESCADO': p}, 120 / 1450, 30.00)
caso('PU-09', 'costo del plato (F13)', c, 8.85)
caso('PU-09', 'margen (F14)', F.margen(30.00, c)['MC'], 21.15)
caso('PU-10', 'ventas de equilibrio (F15)', F.resultado(1450, CV, 400, 400)['Veq'], 551.86)
r0 = F.resultado(0, 0, 0, 0)
caso('PU-11', 'periodo sin ventas', (r0['food_cost'], r0['Veq']), (None, None))
caso('PU-12', 'ingeniería de menú',
     F.ingenieria_menu({'a': 42, 'b': 30, 'c': 8, 'd': 10}, {'a': 21.15, 'b': 15.00, 'c': 22.00, 'd': 12.00}),
     {'a': 'Estrella', 'b': 'Caballo de batalla', 'c': 'Rompecabezas', 'd': 'Perro'})

# ── Pronóstico ──
L = F.ventas_perdidas(['x'], {'x': 12}, {'x': 9}, {'x': 0.25}, 1.0)
caso('PU-13', 'ventas perdidas (F4)', L, 0.75)
caso('PU-13', 'demanda no censurada (F5)', 11.5 + L, 12.25)
caso('PU-14', 'stock teórico (F6)', F.stock_teorico(6.0, 10.0, f, 30 * 0.25), 7.79)
caso('PU-15', 'cantidad sugerida (F2)', F.cantidad_sugerida([12.0, 11.0], 2.0, F.z_normal(0.85), 4.0), 21.07)
caso('PU-16', 'cobertura limitada', F.cobertura(5, 3), 3)
caso('PU-17', 'receta en la unidad de compra', F.kg_por_porcion(180, 0.80), 0.225, tol=0.0001)
caso('PU-18', 'beneficio potencial', F.beneficio_potencial(120, 15, 40, 25), 70.00)

# ── Resultado conocido (T14) ──
semana = [1, 2, 3, 4, 5, 6]
dows = semana * 4
fer = [False] * 24
fut = ([1, 2, 3], [False] * 3)
cte = [10.0] * 24
for metodo in F.METODOS:
    caso('C-01', f'demanda constante, {metodo}', F.pronosticar(metodo, cte, 3, dows, fer, *fut), [10.0, 10.0, 10.0])
patron = [8, 8, 9, 11, 16, 18] * 4
caso('C-02', 'patrón semanal, ingenuo estacional', F.ingenuo_estacional(patron, 3), [8, 8, 9])
caso('C-02', 'patrón semanal, promedio estacional', F.promedio_estacional(patron, 3), [8, 8, 9])
sel = F.seleccionar([float(x) for x in patron], [False] * 24, dows, fer, 2)
caso('C-02', 'patrón semanal, MAE del elegido', sel['mae'][sel['metodo']], 0.0, tol=1e-9)
caso('C-03', 'historial corto: sin selección (respaldo)', F.seleccionar([5.0] * 10, [False] * 10, dows[:10], fer[:10], 2), None)
caso('C-03', 'respaldo con 10 días', F.respaldo([5.0] * 10, 2), [5.0, 5.0])
cero = [0.0] * 24
caso('C-04', 'demanda cero: pronóstico', F.pronosticar('holt_winters', cero, 2, dows, fer, *fut), [0.0, 0.0, 0.0][:2])
caso('C-04', 'demanda cero: cantidad no negativa', F.cantidad_sugerida([0.0, 0.0], 0.0, 2.0, 3.0), 0.0)
caso('C-05', 'z(0.85)', round(F.z_normal(0.85), 4), 1.0364, tol=1e-9)
caso('C-05', 'z(0.99)', round(F.z_normal(0.99), 4), 2.3263, tol=1e-9)

print(f'\n{len(fallos)} fallos' if fallos else '\ntodos los casos pasan')
sys.exit(1 if fallos else 0)
