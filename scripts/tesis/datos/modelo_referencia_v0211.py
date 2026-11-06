# -*- coding: utf-8 -*-
"""Implementación de referencia, en Python, de las fórmulas de la tesis (secciones 3.5.6 y 3.7), escenario B.

Es la misma lógica que tendrán CostingService y ForecastService en la Entrega 3; aquí se usa para la
evaluación con los datos del periodo histórico y para la prueba de paridad PP-01. Lee los CSV que
exporta MauiDesk (GET /api/inventory/export), sin acceder a la base de datos.

Cambios frente a la versión de la v0.2.7:
- cuatro insumos críticos: pescado, calamar, mixtura de mariscos y limón;
- recetas en gramos de producto limpio, convertidas a la unidad de compra con el rendimiento (r);
- ventas perdidas con datos diarios (Fórmula 4): venta habitual del mismo día de la semana menos lo vendido;
- series de días de atención (martes a domingo): estacionalidad de 6 días;
- margen de seguridad con la desviación del error acumulado en los H días (σ_H).
"""
import csv
import io
import math
import os
import re
import unicodedata
from dataclasses import dataclass

import numpy as np
import pandas as pd

S = os.path.dirname(os.path.abspath(__file__))
INSUMOS = ['PESCADO', 'CALAMAR', 'MIXTURA', 'LIMON']
NOMBRE = {'PESCADO': 'Pescado', 'CALAMAR': 'Calamar', 'MIXTURA': 'Mixtura de mariscos', 'LIMON': 'Limón'}
RENDIMIENTO = {'PESCADO': 0.80, 'CALAMAR': 1.0, 'MIXTURA': 1.0, 'LIMON': 1.0}
NIVEL = {'PESCADO': 0.99, 'CALAMAR': 0.90, 'MIXTURA': 0.95, 'LIMON': 0.95}
VIDA_UTIL = {'PESCADO': 7, 'CALAMAR': 6, 'MIXTURA': 3, 'LIMON': 10}
TIPO_GASTO = {'alquiler': 'fijo', 'sueldos': 'fijo', 'luz': 'fijo', 'agua': 'fijo', 'internet': 'fijo',
              'gas': 'variable', 'descartables': 'variable'}
M_EST = 6            # estacionalidad semanal en días de atención (martes a domingo)
COL_G = {'PESCADO': 'pescado_g', 'CALAMAR': 'calamar_g', 'MIXTURA': 'mixtura_g', 'LIMON': 'limon_g'}


def slug(s):
    s = ''.join(c for c in unicodedata.normalize('NFKD', s) if not unicodedata.combining(c)).lower()
    return re.sub(r'[^a-z0-9]+', '_', s).strip('_')


def sku_key(plato, variante):
    return slug(plato) + ('__' + variante if variante else '')


def sku_nombre(plato, variante):
    return plato + (f' ({variante.capitalize()})' if variante else '')


def cargar_carta():
    """SKU de la carta: clave, nombre en el sistema, categoría, plato, variante y precio."""
    out = []
    for r in csv.DictReader(open(os.path.join(S, 'carta_maui.csv'), encoding='utf-8-sig')):
        out.append({'key': sku_key(r['plato'], r['variante']), 'nombre': sku_nombre(r['plato'], r['variante']),
                    'cat': r['categoria'], 'plato': r['plato'], 'variante': r['variante'], 'precio': float(r['precio'])})
    return out


def cargar_recetas_g():
    """Gramos de producto limpio por porción de cada SKU (porciones aproximadas aprobadas por el propietario)."""
    out = {}
    for r in csv.DictReader(open(os.path.join(S, 'recetas_aproximadas.csv'), encoding='utf-8-sig')):
        k = sku_nombre(r['plato'], r['variante'])
        out[k] = {c: float(r[COL_G[c]]) for c in INSUMOS if float(r[COL_G[c]]) > 0}
    return out


def receta_compra(g, c):
    """Kilogramos en la unidad de compra por porción: gramos de producto limpio / (1000 × rendimiento)."""
    return g / 1000.0 / RENDIMIENTO[c]


CARTA = cargar_carta()
RECETAS_G = cargar_recetas_g()
RECETAS = {p: {c: receta_compra(g, c) for c, g in r.items()} for p, r in RECETAS_G.items()}
PRECIO = {s['nombre']: s['precio'] for s in CARTA}


def z_of(alpha):
    from statistics import NormalDist
    return NormalDist().inv_cdf(alpha)


def read_export(text):
    return pd.read_csv(io.StringIO(text.lstrip('﻿')), comment='#')


# ---------------------------------------------------------------- 3.7: costeo
def costo_promedio(stock_prev, p_prev, compra, p_compra):
    """Fórmula 8. Costo promedio ponderado del insumo después de la compra del día."""
    if stock_prev + compra <= 0:
        return p_compra if compra > 0 else p_prev
    return (stock_prev * p_prev + compra * p_compra) / (stock_prev + compra)


def consumo_real(A, I, M, A_sig):
    """Fórmula 7. Consumo real del día: apertura + ingresos − merma − apertura del día de atención siguiente."""
    return A + I - M - A_sig


@dataclass
class Rentabilidad:
    ventas: float
    costo_vendido: float
    utilidad_bruta: float
    gastos: float
    gastos_fijos: float
    utilidad_operativa: float
    food_cost: float
    merma_kg: dict
    merma_pct: dict
    merma_soles: float
    ventas_equilibrio: float


def tabla_diaria(daily, dias):
    """Por insumo y día de atención: apertura (A), ingresos (I), merma imputada (M), precio y apertura siguiente."""
    out = {}
    for code in INSUMOS:
        d = daily[daily.insumo_codigo == code].set_index('fecha').reindex(dias)
        A = d['quedaba'].astype(float)
        I = d['compraste'].fillna(0).astype(float) - d['enviaste'].fillna(0) + d['recibiste'].fillna(0)
        price = d['precio_unitario'].astype(float)
        M = d['botaste'].fillna(0).astype(float).shift(-1).fillna(0)
        out[code] = pd.DataFrame({'A': A, 'I': I, 'M': M, 'precio': price, 'A_sig': A.shift(-1)})
    return out


def costo_insumos(td, dias, consumo_teorico=None):
    """Fórmulas 7 a 9 por día e insumo. Si falta un conteo, el consumo se toma del consumo teórico
    (ventas × receta × factor), que se informa como día imputado."""
    filas = []
    for code in INSUMOS:
        t = td[code]
        p = np.nan
        for d in dias:
            r = t.loc[d]
            A = 0.0 if pd.isna(r.A) else r.A
            if pd.isna(p) and not pd.isna(r.precio):
                p = r.precio
            if r.I > 0 and not pd.isna(r.precio):
                p = costo_promedio(A, p if not pd.isna(p) else r.precio, r.I, r.precio)
            C = np.nan if pd.isna(r.A) or pd.isna(r.A_sig) else consumo_real(A, r.I, r.M, r.A_sig)
            imp = False
            if pd.isna(C) and consumo_teorico is not None:
                C = consumo_teorico.get((d, code), np.nan)
                imp = True
            filas.append({'fecha': d, 'insumo': code, 'A': r.A, 'I': r.I, 'M': r.M, 'C': C, 'imputado': imp, 'pbar': p,
                          'costo': (C + r.M) * p if not pd.isna(C) and not pd.isna(p) else np.nan})
    return pd.DataFrame(filas)


def rentabilidad(df_ins, ventas_dia, otros_dia, gastos_mes, dias):
    """Fórmulas 9 a 11 y 15 para un periodo T (lista de días de atención)."""
    sel = df_ins[df_ins.fecha.isin(dias)]
    cv_ins = sel['costo'].sum()
    otros = otros_dia.reindex(dias).fillna(0).sum()
    CV = cv_ins + otros
    V = ventas_dia.reindex(dias).fillna(0).sum()
    G = GF = 0.0
    for mes, gm in gastos_mes.items():
        dm = gm['dias_atencion']
        n = sum(1 for d in dias if d[:7] == mes)
        for cat, monto in gm['montos'].items():
            G += monto * n / dm
            if TIPO_GASTO.get(cat, 'fijo') == 'fijo':
                GF += monto * n / dm
    UB = V - CV
    UO = UB - G
    mkg = sel.groupby('insumo')['M'].sum().to_dict()
    ing = sel.groupby('insumo')['I'].sum().to_dict()
    mpct = {k: (100 * mkg[k] / ing[k] if ing.get(k, 0) > 0 else np.nan) for k in mkg}
    msol = float((sel['M'] * sel['pbar']).sum())
    Veq = GF / (1 - CV / V) if V > 0 else np.nan
    return Rentabilidad(V, CV, UB, G, GF, UO, 100 * CV / V if V > 0 else np.nan, mkg, mpct, msol, Veq)


def factores(df_ins, porciones, dias):
    """Fórmula 12: factor de calibración = consumo real / consumo según receta, en los días B con conteo."""
    f = {}
    for code in INSUMOS:
        C = df_ins[(df_ins.insumo == code) & df_ins.fecha.isin(dias) & (~df_ins.imputado)].set_index('fecha')['C']
        teo = real = 0.0
        for d in dias:
            if d not in C.index or pd.isna(C.loc[d]):
                continue
            teo += sum(n * RECETAS.get(p, {}).get(code, 0) for p, n in porciones.get(d, {}).items())
            real += C.loc[d]
        f[code] = real / teo if teo > 0 else np.nan
    return f


def costo_plato(f, pbar, o_por_sol=0.0):
    """Fórmula 13: insumos críticos × factor × costo promedio, más los otros insumos asignados por precio."""
    return {p: sum(q * f[i] * pbar[i] for i, q in r.items()) + o_por_sol * PRECIO[p] for p, r in RECETAS.items()}


def ingenieria_menu(porciones, margen):
    """Tabla de ingeniería de menú (Kasavana y Smith): popularidad ≥ 0.7/n y margen frente al promedio ponderado."""
    n = len(porciones)
    tot = sum(porciones.values())
    mprom = sum(porciones[p] * margen[p] for p in porciones) / tot
    out = {}
    for p in porciones:
        pop = porciones[p] / tot >= 0.7 / n
        alto = margen[p] > mprom
        out[p] = {(True, True): 'Estrella', (True, False): 'Caballo de batalla',
                  (False, True): 'Rompecabezas', (False, False): 'Perro'}[(pop, alto)]
    return out, mprom


def beneficio_potencial(mp_real, cm_real, mp_sug, cm_sug):
    """Fórmula 16: (margen perdido + costo de la merma) con la compra real − lo mismo con la sugerida."""
    return (mp_real + cm_real) - (mp_sug + cm_sug)


# ---------------------------------------------------------------- 3.5.6: demanda y pronóstico
def ventas_perdidas_plato(habitual, vendidas):
    """Fórmula 4 por plato: venta habitual del mismo día de la semana menos lo vendido el día del quiebre."""
    return max(0.0, habitual - vendidas)


def ventas_perdidas(code, agotados_dia, habitual, vendidas, f):
    """Fórmula 4: Σ max(0, v̄ − v) × receta × factor, sobre los platos agotados que usan el insumo."""
    L = 0.0
    for p in agotados_dia:
        q = RECETAS.get(p, {}).get(code, 0)
        if q:
            L += ventas_perdidas_plato(habitual.get(p, 0.0), vendidas.get(p, 0)) * q * f
    return L


def snaive(y, h, m=M_EST):
    return np.array([y[-m + ((k - 1) % m)] for k in range(1, h + 1)])


def smean(y, h, m=M_EST):
    out = []
    for k in range(1, h + 1):
        vals = [y[-m * w + ((k - 1) % m)] for w in range(1, 5) if len(y) >= m * w]
        out.append(np.mean(vals))
    return np.array(out)


def ets(y, h, m=M_EST):
    from statsmodels.tsa.holtwinters import ExponentialSmoothing
    import warnings
    with warnings.catch_warnings():
        warnings.simplefilter('ignore')
        mod = ExponentialSmoothing(np.asarray(y, float), trend=None, seasonal='add', seasonal_periods=m,
                                   initialization_method='estimated').fit()
    return np.maximum(mod.forecast(h), 0)


def reg(y, h, dows, feriado, dows_f, feriado_f, n_max=48):
    """Regresión con calendario: día de la semana, feriado o evento y tendencia, últimos 48 días de atención."""
    n = min(len(y), n_max)
    yy = np.asarray(y[-n:], float)
    niveles = sorted(set(dows))[1:]
    X = [[1.0, t] + [1.0 if dows[-n + t] == k else 0.0 for k in niveles] + [feriado[-n + t]] for t in range(n)]
    beta, *_ = np.linalg.lstsq(np.array(X), yy, rcond=None)
    Xf = [[1.0, n - 1 + k] + [1.0 if dows_f[k - 1] == j else 0.0 for j in niveles] + [feriado_f[k - 1]] for k in range(1, h + 1)]
    return np.maximum(np.array(Xf) @ beta, 0)


METODOS = ['Ingenuo estacional', 'Promedio estacional', 'Suavizado exponencial', 'Regresión con calendario']


def pronosticar(metodo, y, h, dows, feriado, dows_f, feriado_f):
    if metodo == 'Ingenuo estacional':
        return snaive(y, h)
    if metodo == 'Promedio estacional':
        return smean(y, h)
    if metodo == 'Suavizado exponencial':
        return ets(y, h)
    return reg(y, h, dows, feriado, dows_f, feriado_f)


def escala_mase(y_train, m=M_EST):
    """Denominador de la Fórmula 3: MAE del ingenuo estacional dentro de la muestra."""
    y = np.asarray(y_train, float)
    return np.mean(np.abs(y[m:] - y[:-m]))


def cantidad_sugerida_H(F, sigmaH, H, alpha, A):
    """Fórmula 2: Σ pronósticos de los H días + z·σ_H − lo disponible; nunca negativa."""
    return max(0.0, float(np.sum(F[:H])) + z_of(alpha) * sigmaH - A)


# ---------------------------------------------------------------- funciones auxiliares de las pruebas PU
def alerta_factor(f, lo=0.7, hi=1.3):
    return not (lo <= f <= hi)


def costo_plato_unidad(q, f, pbar, o_p):
    return q * f * pbar + o_p


def stock_teorico(A, I, f, q, porciones):
    """Fórmula 6: apertura + ingresos − factor × cantidad de la receta × porciones vendidas hasta t."""
    return A + I - f * q * porciones


def cobertura(dias_pedidos, vida_util):
    return min(dias_pedidos, vida_util)
