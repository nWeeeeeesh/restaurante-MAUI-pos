# -*- coding: utf-8 -*-
"""Fórmulas de la tesis (docs/plan-sistema.md, sección 4), en Python estándar.

Es la implementación de referencia de server/src/domain/costing.ts y
server/src/domain/forecast.ts: las pruebas de paridad comparan el sistema contra lo
que estas funciones producen con los datos simulados. Solo biblioteca estándar.
Todas son puras: reciben todo por parámetro.
"""
import math

M_EST = 6  # estacionalidad: días de atención por semana (martes a domingo)
METODOS = ['ingenuo_estacional', 'promedio_estacional', 'holt_winters', 'regresion_calendario']
REJILLA = [round(0.05 * k, 2) for k in range(1, 20)]  # 0.05, 0.10, …, 0.95


def suma(xs):
    """Suma de izquierda a derecha, como `reduce` en JavaScript.

    Desde Python 3.12, sum() de floats usa suma compensada y daría otros últimos
    dígitos que el servidor; con eso podría cambiar un empate del método elegido.
    """
    t = 0.0
    for x in xs:
        t += x
    return t


# ─────────────────────────────── 4.1 Costeo ───────────────────────────────

def kg_por_porcion(g, rendimiento):
    """Receta en gramos de producto limpio → kg en la unidad de compra."""
    return g / 1000.0 / rendimiento


def costo_promedio(stock_prev, p_prev, compra, p_compra):
    """F8. Costo promedio ponderado después de la compra del día. Sin compra no cambia."""
    if compra <= 0:
        return p_prev
    if stock_prev + compra <= 0 or p_prev is None:
        return p_compra
    return (stock_prev * p_prev + compra * p_compra) / (stock_prev + compra)


def consumo_real(A, I, M, A_sig):
    """F7. Apertura + ingresos − merma − apertura del siguiente día de atención."""
    return A + I - M - A_sig


def prorratear_gastos(gastos_mes, dias_atencion_mes, dias_periodo_por_mes):
    """Reparte cada gasto mensual entre los días de atención del mes.

    gastos_mes: {mes: [(categoria, monto, tipo)]}; dias_atencion_mes: {mes: n};
    dias_periodo_por_mes: {mes: días de atención del periodo en ese mes}.
    Devuelve (G, GF): total y solo las categorías fijas.
    """
    G = GF = 0.0
    for mes, n in dias_periodo_por_mes.items():
        if n <= 0:
            continue
        for _cat, monto, tipo in gastos_mes.get(mes, []):
            parte = monto * n / dias_atencion_mes[mes]
            G += parte
            if tipo == 'fijo':
                GF += parte
    return G, GF


def resultado(V, CV, G, GF):
    """F10 y F15. Con V = 0, food cost y ventas de equilibrio no aplican (None)."""
    UB = V - CV
    UO = UB - G
    if V == 0:
        return {'UB': UB, 'UO': UO, 'food_cost': None, 'Veq': None}
    margen = 1 - CV / V
    return {'UB': UB, 'UO': UO, 'food_cost': CV / V * 100, 'Veq': GF / margen if margen > 0 else None}


def merma(M, I, pbar):
    """F11 sobre listas por día: % de merma frente a los ingresos y su costo en S/."""
    sm = suma(M)
    si = suma(I)
    return {'pct': (sm / si * 100) if si > 0 else None, 'soles': suma(m * p for m, p in zip(M, pbar))}


def factor_calibracion(consumos_reales, consumos_receta):
    """F12: Σ consumo real / Σ consumo según receta (solo días con conteo)."""
    teo = suma(consumos_receta)
    if teo <= 0:
        return None
    f = suma(consumos_reales) / teo
    return f


def fuera_de_rango(f, lo=0.7, hi=1.3):
    return f < lo or f > hi


def costo_plato(receta_kg, f, pbar, otros_por_sol, precio):
    """F13. receta_kg, f y pbar son dicts por insumo."""
    return suma(q * f.get(i, 1.0) * (pbar.get(i) or 0.0) for i, q in receta_kg.items()) + otros_por_sol * precio


def margen(precio, costo):
    """F14."""
    mc = precio - costo
    return {'MC': mc, 'MC_pct': mc / precio * 100 if precio > 0 else None}


def ingenieria_menu(porciones, margenes):
    """Kasavana y Smith. porciones y margenes: dicts por plato (solo platos vendidos)."""
    n = len(porciones)
    tot = suma(porciones.values())
    if n == 0 or tot == 0:
        return {}
    mprom = suma(porciones[p] * margenes[p] for p in porciones) / tot
    out = {}
    for p in porciones:
        popular = porciones[p] / tot >= 0.7 / n
        alto = margenes[p] > mprom
        out[p] = {(True, True): 'Estrella', (True, False): 'Caballo de batalla',
                  (False, True): 'Rompecabezas', (False, False): 'Perro'}[(popular, alto)]
    return out


def beneficio_potencial(mp_real, cm_real, mp_sug, cm_sug):
    """Margen perdido + costo de la merma con la compra real, menos lo mismo con la sugerida."""
    return (mp_real + cm_real) - (mp_sug + cm_sug)


# ─────────────────────────────── 4.2 Pronóstico ───────────────────────────────

def ventas_perdidas(platos_agotados, habitual, vendidas, receta_kg_insumo, f):
    """F4. Σ max(0, v̄ − V) · q · f sobre los platos agotados que usan el insumo."""
    L = 0.0
    for p in platos_agotados:
        q = receta_kg_insumo.get(p, 0.0)
        if q:
            L += max(0.0, habitual.get(p, 0.0) - vendidas.get(p, 0)) * q * f
    return L


def stock_teorico(A, I, f, consumo_receta):
    """F6. A + I − f · Σ q · V (consumo_receta = Σ porciones × kg por porción)."""
    return A + I - f * consumo_receta


def cobertura(pedida, vida_util):
    return min(pedida, vida_util) if vida_util else pedida


def cantidad_sugerida(pronosticos, sigma_h, z, A):
    """F2. Σ pronósticos de los H días + z·σ_H − disponible; nunca negativa."""
    return max(0.0, suma(pronosticos) + z * sigma_h - A)


def z_normal(p):
    """Inversa de la normal estándar (Acklam, error relativo < 1.15e-9)."""
    if p <= 0 or p >= 1:
        raise ValueError('p debe estar en (0, 1)')
    a = [-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02,
         1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00]
    b = [-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02,
         6.680131188771972e+01, -1.328068155288572e+01]
    c = [-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00,
         -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00]
    d = [7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00, 3.754408661907416e+00]
    plow = 0.02425
    if p < plow:
        q = math.sqrt(-2 * math.log(p))
        return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / \
               ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
    if p > 1 - plow:
        q = math.sqrt(-2 * math.log(1 - p))
        return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / \
                ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
    q = p - 0.5
    r = q * q
    return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / \
           (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1)


def ingenuo_estacional(y, h, m=M_EST):
    n = len(y)
    return [y[n - 1 + k - m * math.ceil(k / m)] for k in range(1, h + 1)]


def promedio_estacional(y, h, m=M_EST):
    """Promedio del mismo día de la semana en las últimas 4 semanas disponibles."""
    n = len(y)
    out = []
    for k in range(1, h + 1):
        base = n - 1 + k - m * math.ceil(k / m)
        vals = [y[base - m * w] for w in range(0, 4) if base - m * w >= 0]
        out.append(suma(vals) / len(vals))
    return out


def _hw_ajuste(y, alfa, gamma, m):
    """Holt-Winters aditivo sin tendencia. Devuelve (SSE a un paso, nivel final, estacionales)."""
    nivel = suma(y[:m]) / m
    est = [y[i] - nivel for i in range(m)]
    sse = 0.0
    for t in range(m, len(y)):
        s_prev = est[t - m]
        pred = nivel + s_prev
        e = y[t] - pred
        sse += e * e
        nuevo = alfa * (y[t] - s_prev) + (1 - alfa) * nivel
        est.append(gamma * (y[t] - nuevo) + (1 - gamma) * s_prev)
        nivel = nuevo
    return sse, nivel, est


def holt_winters(y, h, m=M_EST):
    """α y γ por rejilla minimizando el SSE a un paso; en empate, menor α y luego menor γ."""
    mejor = None
    for alfa in REJILLA:
        for gamma in REJILLA:
            sse = _hw_ajuste(y, alfa, gamma, m)[0]
            if mejor is None or sse < mejor[0]:
                mejor = (sse, alfa, gamma)
    _sse, nivel, est = _hw_ajuste(y, mejor[1], mejor[2], m)
    n = len(y)
    return [max(0.0, nivel + est[n - 1 + k - m * math.ceil(k / m)]) for k in range(1, h + 1)]


def _gauss(A, b):
    """Resuelve A·x = b con eliminación de Gauss y pivoteo parcial. None si es singular."""
    n = len(A)
    M = [row[:] + [b[i]] for i, row in enumerate(A)]
    for col in range(n):
        piv = max(range(col, n), key=lambda r: abs(M[r][col]))
        if abs(M[piv][col]) < 1e-10:
            return None
        M[col], M[piv] = M[piv], M[col]
        for r in range(col + 1, n):
            factor = M[r][col] / M[col][col]
            if factor:
                for c2 in range(col, n + 1):
                    M[r][c2] -= factor * M[col][c2]
    x = [0.0] * n
    for r in range(n - 1, -1, -1):
        x[r] = (M[r][n] - suma(M[r][c2] * x[c2] for c2 in range(r + 1, n))) / M[r][r]
    return x


def _fila(t, dow, feriado, columnas):
    fila = [1.0, float(t)]
    for c in columnas:
        if c == 'feriado':
            fila.append(1.0 if feriado else 0.0)
        else:
            fila.append(1.0 if dow == c else 0.0)
    return fila


def regresion_calendario(y, h, dows, feriados, dows_fut, feriados_fut, n_max=48):
    """Intercepto, tendencia, días de la semana (martes = base) y feriado, últimos 48 días.

    dows: día de la semana de cada observación (1 = martes … 6 = domingo). Las columnas
    que no varían en la ventana se omiten; si el sistema es singular, None.
    """
    n = min(len(y), n_max)
    yy = y[-n:]
    dd = dows[-n:]
    ff = feriados[-n:]
    columnas = [d for d in range(2, 7) if any(x == d for x in dd)]
    if any(ff) and not all(ff):
        columnas.append('feriado')
    X = [_fila(t, dd[t], ff[t], columnas) for t in range(n)]
    p = len(X[0])
    if n <= p:
        return None
    XtX = [[suma(X[r][i] * X[r][j] for r in range(n)) for j in range(p)] for i in range(p)]
    Xty = [suma(X[r][i] * yy[r] for r in range(n)) for i in range(p)]
    beta = _gauss(XtX, Xty)
    if beta is None:
        return None
    out = []
    for k in range(1, h + 1):
        fila = _fila(n - 1 + k, dows_fut[k - 1], feriados_fut[k - 1], columnas)
        out.append(max(0.0, suma(b * x for b, x in zip(beta, fila))))
    return out


def pronosticar(metodo, y, h, dows, feriados, dows_fut, feriados_fut):
    if metodo == 'ingenuo_estacional':
        return ingenuo_estacional(y, h)
    if metodo == 'promedio_estacional':
        return promedio_estacional(y, h)
    if metodo == 'holt_winters':
        return holt_winters(y, h)
    r = regresion_calendario(y, h, dows, feriados, dows_fut, feriados_fut)
    # Sin solución (ventana sin variación suficiente): se comporta como el promedio estacional
    return r if r is not None else promedio_estacional(y, h)


def respaldo(y, h, m=M_EST):
    """Con menos de 12 días de atención: promedio estacional si hay ≥ 6, si no promedio simple."""
    if len(y) == 0:
        return [0.0] * h
    if len(y) >= m:
        return promedio_estacional(y, h, m)
    prom = suma(y) / len(y)
    return [prom] * h


def seleccionar(y, imputado, dows, feriados, H, h_max=3, w_max=24, min_hist=12):
    """Elige el método por MAE con origen móvil y calcula σ_H del error acumulado en H días.

    Orígenes: los últimos W = min(24, n − 12) días cuyos h_max días siguientes están en la
    serie (o = n−h_max−W … n−h_max−1). En cada origen, cada método se ajusta con la
    historia hasta o y pronostica max(h_max, H) días. MAE = promedio de todos los errores
    absolutos de los horizontes 1…h_max, sin los días imputados; gana el menor y, en
    empate, el primero de METODOS. σ_H: desviación estándar muestral de (Σ real − Σ
    pronóstico) en los H días siguientes, en los mismos orígenes cuyos H días están en la
    serie y no tienen imputados; con menos de 6, 25 % del promedio de la serie × √H.
    """
    n = len(y)
    if n < min_hist:
        return None
    W = min(w_max, n - min_hist)
    hh = max(h_max, H)
    errores = {m: [] for m in METODOS}
    acumulados = {m: [] for m in METODOS}
    for o in range(n - h_max - W, n - h_max):
        objetivos = [t for t in range(o + 1, o + 1 + hh) if t < n]
        futuros_d = [dows[t] for t in objetivos] + [None] * (hh - len(objetivos))
        futuros_f = [feriados[t] for t in objetivos] + [False] * (hh - len(objetivos))
        for metodo in METODOS:
            f = pronosticar(metodo, y[:o + 1], hh, dows[:o + 1], feriados[:o + 1],
                            _completar_dows(dows[o], futuros_d), futuros_f)
            for k in range(h_max):
                t = o + 1 + k
                if not imputado[t]:
                    errores[metodo].append(abs(y[t] - f[k]))
            if o + H < n and not any(imputado[t] for t in range(o + 1, o + 1 + H)):
                acumulados[metodo].append(suma(y[t] for t in range(o + 1, o + 1 + H)) - suma(f[:H]))
    mae = {m: (suma(e) / len(e) if e else math.inf) for m, e in errores.items()}
    elegido = min(METODOS, key=lambda m: (mae[m], METODOS.index(m)))
    errs = acumulados[elegido]
    if len(errs) >= 6:
        prom = suma(errs) / len(errs)
        sigma = math.sqrt(suma((e - prom) * (e - prom) for e in errs) / (len(errs) - 1))
    else:
        sigma = 0.25 * (suma(y) / n) * math.sqrt(H)
    return {'metodo': elegido, 'mae': mae, 'sigma_h': sigma}


def _completar_dows(ultimo, futuros):
    """Días de la semana de los objetivos que caen fuera de la serie: siguen el ciclo 1…6."""
    out = []
    prev = ultimo
    for d in futuros:
        if d is None:
            d = 1 if prev == 6 else prev + 1
        out.append(d)
        prev = d
    return out
