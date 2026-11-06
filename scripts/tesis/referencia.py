# -*- coding: utf-8 -*-
"""Implementación de referencia de la rentabilidad y el pronóstico (plan-sistema T5).

Lee los CSV que deja simulador.py en server/src/__tests__/fixtures/sim12/ y escribe
esperado.json con los resultados que el servidor debe reproducir en las pruebas de
paridad PP-01, PP-02 y PP-03. Las fórmulas están en formulas.py (sección 4 del plan);
aquí solo se arman los datos y se aplican las convenciones del dominio. Solo
biblioteca estándar.

Uso: python scripts/tesis/referencia.py
"""
import csv
import datetime as dt
import json
import os
from collections import defaultdict

import formulas as F
from formulas import suma

AQUI = os.path.dirname(os.path.abspath(__file__))
SIM = os.path.normpath(os.path.join(AQUI, '..', '..', 'server', 'src', '__tests__', 'fixtures', 'sim12'))
MODELO = 'mauidesk-forecast-1'
CALIBRACION = ('2026-06-16', '2026-07-12')        # semanas 1 a 4
PERIODO = ('2026-06-16', '2026-09-06')
NOCHES = ('2026-08-11', '2026-09-06')             # semanas 9 a 12
COBERTURA = 2


def D(s):
    return dt.date.fromisoformat(s)


def leer(nombre):
    with open(os.path.join(SIM, nombre), encoding='utf-8', newline='') as f:
        return list(csv.DictReader(f))


def r6(x):
    return None if x is None else round(x, 6)


class Datos:
    """Los registros del simulador, indexados como los leería el repositorio."""

    def __init__(self):
        self.carta = {r['sku']: {'id': int(r['id']), 'precio': float(r['precio']), 'plato': r['plato'], 'variante': r['variante']}
                      for r in leer('carta.csv')}
        sku_de = {(r['plato'], r['variante']): r['sku'] for r in leer('carta.csv')}
        self.insumos = {r['codigo']: {'id': int(r['id']), 'rendimiento': float(r['rendimiento']),
                                      'vida_util': int(r['vida_util_dias']), 'nivel': float(r['nivel_servicio'])}
                        for r in leer('insumos.csv') if r['critico'] == '1'}
        self.codigos = sorted(self.insumos, key=lambda c: self.insumos[c]['id'])
        # kg por porción en la unidad de compra
        self.receta = defaultdict(dict)
        for r in leer('recetas.csv'):
            c = r['insumo_codigo']
            self.receta[r['sku']][c] = F.kg_por_porcion(float(r['gramos_limpios']), self.insumos[c]['rendimiento'])
        # dict normal: con defaultdict, consultar un plato sin receta le crearía una vacía
        self.receta = dict(self.receta)
        self.vendidas = defaultdict(lambda: defaultdict(int))   # fecha → sku → porciones
        self.venta = defaultdict(float)                         # fecha → S/
        for r in leer('ventas_items.csv'):
            sku = sku_de[(r['plato'], r['variante'])]
            self.vendidas[r['fecha']][sku] += int(r['cantidad'])
            self.venta[r['fecha']] += int(r['cantidad']) * float(r['precio'])
        self.compra_q = defaultdict(float)                      # (código, fecha) → kg
        self.compra_s = defaultdict(float)                      # (código, fecha) → S/
        for r in leer('purchases.csv'):
            self.compra_q[(r['insumo_codigo'], r['fecha'])] += float(r['cantidad'])
            self.compra_s[(r['insumo_codigo'], r['fecha'])] += float(r['costo_total'])
        self.merma = defaultdict(float)                         # (código, fecha imputada) → kg
        for r in leer('waste.csv'):
            self.merma[(r['insumo_codigo'], r['fecha'])] += float(r['cantidad'])
        self.conteo = {(r['insumo_codigo'], r['fecha']): float(r['cantidad']) for r in leer('counts.csv') if r['momento'] == 'apertura'}
        self.otros = defaultdict(float)
        for r in leer('other_costs.csv'):
            self.otros[r['fecha']] += float(r['monto'])
        self.gastos = defaultdict(list)                          # 'YYYY-MM' → [(categoría, monto, tipo)]
        for r in leer('gastos.csv'):
            self.gastos[r['fecha'][:7]].append((r['categoria'], float(r['monto']), r['tipo']))
        self.notas = defaultdict(set)
        for r in leer('day_notes.csv'):
            self.notas[r['fecha']].add(r['tipo'])
        self.agotados = defaultdict(set)                        # fecha → skus marcados ese día
        for r in leer('stockouts.csv'):
            self.agotados[r['inicio'][:10]].add(r['plato'])
        # Primer registro: la primera venta, conteo o compra
        self.primer_dia = min([*self.venta, *(f for _c, f in self.conteo), *(f for _c, f in self.compra_q)])

    # Día de atención: con ventas, o martes a domingo sin nota «cerrado»
    def atiende(self, fecha, hasta=None):
        con_ventas = fecha in self.venta and (hasta is None or fecha <= hasta)
        return con_ventas or (D(fecha).weekday() != 0 and 'cerrado' not in self.notas[fecha])

    def dias_atencion(self, desde, hasta):
        out, d = [], D(desde)
        while d <= D(hasta):
            if self.atiende(d.isoformat()):
                out.append(d.isoformat())
            d += dt.timedelta(days=1)
        return out

    def siguiente_atencion(self, fecha):
        d = D(fecha) + dt.timedelta(days=1)
        while not self.atiende(d.isoformat()):
            d += dt.timedelta(days=1)
        return d.isoformat()

    def consumo_receta(self, codigo, fecha):
        """Σ porciones vendidas × kg por porción, sin factor."""
        return suma(q * self.receta.get(s, {}).get(codigo, 0.0) for s, q in sorted(self.vendidas[fecha].items()))


def diario(datos, codigo, hasta, f, conteos_hasta=None):
    """Recorre los días de atención desde el primer registro hasta `hasta`.

    Por día: apertura usada S (conteo, o estimada desde el día anterior), ingresos I,
    merma M imputada a ese día, costo promedio p̄ (F8) y consumo C (F7, o teórico con el
    factor f si falta el conteo de ese día o del siguiente día de atención). Con
    `conteos_hasta` se ignoran los conteos posteriores (lo que se sabía esa noche).
    """
    def contado(fecha):
        if conteos_hasta is not None and fecha > conteos_hasta:
            return None
        return datos.conteo.get((codigo, fecha))

    filas = []
    p_prev, prev = None, None
    for d in datos.dias_atencion(datos.primer_dia, hasta):
        A = contado(d)
        if A is not None:
            S = A
        elif prev is None:
            S = 0.0
        else:
            S = max(0.0, prev['S'] + prev['I'] - prev['M'] - prev['C'])
        I = datos.compra_q[(codigo, d)]
        pc = datos.compra_s[(codigo, d)] / I if I > 0 else None
        p = F.costo_promedio(S, p_prev, I, pc)
        M = datos.merma[(codigo, d)]
        A_sig = contado(datos.siguiente_atencion(d))
        if A is not None and A_sig is not None:
            C, imputado = F.consumo_real(A, I, M, A_sig), False
        else:
            C, imputado = f * datos.consumo_receta(codigo, d), True
        fila = {'fecha': d, 'S': S, 'I': I, 'M': M, 'p': p if p is not None else 0.0, 'C': C, 'imputado': imputado}
        filas.append(fila)
        p_prev, prev = p, fila
    return filas


def calibrar(datos, desde, hasta):
    out = {}
    for c in datos.codigos:
        filas = [x for x in diario(datos, c, hasta, 1.0) if x['fecha'] >= desde and not x['imputado']]
        out[c] = F.factor_calibracion([x['C'] for x in filas], [datos.consumo_receta(c, x['fecha']) for x in filas])
    return out


def periodo(datos, desde, hasta, factores, series):
    """Rentabilidad de un periodo. `series` = diario() de cada insumo hasta el fin del periodo total."""
    V = suma(datos.venta[d] for d in sorted(datos.venta) if desde <= d <= hasta)
    O = suma(datos.otros[d] for d in sorted(datos.otros) if desde <= d <= hasta)
    CV = O
    merma_kg = merma_s = ingresos = 0.0
    por_insumo = {}
    for c in datos.codigos:
        filas = [x for x in series[c] if desde <= x['fecha'] <= hasta]
        cv_i = suma((x['C'] + x['M']) * x['p'] for x in filas)
        CV += cv_i
        m = F.merma([x['M'] for x in filas], [x['I'] for x in filas], [x['p'] for x in filas])
        merma_kg += suma(x['M'] for x in filas)
        merma_s += m['soles']
        ingresos += suma(x['I'] for x in filas)
        consumo = suma(x['C'] for x in filas)
        por_insumo[c] = {
            'consumo_kg': r6(consumo), 'merma_kg': r6(suma(x['M'] for x in filas)), 'merma_pct': r6(m['pct']),
            'merma_soles': r6(m['soles']), 'costo': r6(cv_i),
            'costo_promedio': r6(suma(x['C'] * x['p'] for x in filas) / consumo) if consumo > 0 else None,
            'dias_imputados': [x['fecha'] for x in filas if x['imputado']],
        }
    # Gastos: cada mes se reparte entre sus días de atención
    por_mes = defaultdict(int)
    for d in datos.dias_atencion(desde, hasta):
        por_mes[d[:7]] += 1
    dias_mes = {}
    for mes in por_mes:
        y, m = map(int, mes.split('-'))
        ultimo = (dt.date(y + (m == 12), m % 12 + 1, 1) - dt.timedelta(days=1)).isoformat()
        dias_mes[mes] = len(datos.dias_atencion(f'{mes}-01', ultimo))
    G, GF = F.prorratear_gastos(datos.gastos, dias_mes, dict(sorted(por_mes.items())))
    res = F.resultado(V, CV, G, GF)
    return {
        'desde': desde, 'hasta': hasta, 'V': r6(V), 'CV': r6(CV), 'O': r6(O), 'G': r6(G), 'GF': r6(GF),
        'UB': r6(res['UB']), 'UO': r6(res['UO']), 'food_cost': r6(res['food_cost']), 'Veq': r6(res['Veq']),
        'merma_kg': r6(merma_kg), 'merma_soles': r6(merma_s), 'merma_pct': r6(merma_kg / ingresos * 100) if ingresos > 0 else None,
        'insumos': por_insumo,
    }, {'O': O, 'V': V, 'por_insumo': por_insumo}


def carta(datos, desde, hasta, factores, extra):
    porciones = defaultdict(int)
    for d in sorted(datos.vendidas):
        if desde <= d <= hasta:
            for s, q in datos.vendidas[d].items():
                porciones[s] += q
    pbar = {c: extra['por_insumo'][c]['costo_promedio'] or 0.0 for c in datos.codigos}
    otros_por_sol = extra['O'] / extra['V'] if extra['V'] > 0 else 0.0
    platos = {}
    for sku in sorted(datos.carta, key=lambda s: datos.carta[s]['id']):
        precio = datos.carta[sku]['precio']
        costo = F.costo_plato(datos.receta.get(sku, {}), factores, pbar, otros_por_sol, precio)
        mg = F.margen(precio, costo)
        platos[sku] = {'id': datos.carta[sku]['id'], 'precio': precio, 'porciones': porciones.get(sku, 0),
                       'costo': r6(costo), 'MC': r6(mg['MC']), 'MC_pct': r6(mg['MC_pct']),
                       'sin_receta': sku not in datos.receta, 'categoria': None}
    vendidos = {s: p['porciones'] for s, p in platos.items() if p['porciones'] > 0}
    for s, cat in F.ingenieria_menu(vendidos, {s: platos[s]['MC'] for s in vendidos}).items():
        platos[s]['categoria'] = cat
    return platos


def grupos(desde, hasta, tipo):
    out, d, fin = [], D(desde), D(hasta)
    while d <= fin:
        if tipo == 'semana':
            g_fin = d + dt.timedelta(days=6 - d.weekday())
        else:
            g_fin = dt.date(d.year + (d.month == 12), d.month % 12 + 1, 1) - dt.timedelta(days=1)
        g_fin = min(g_fin, fin)
        out.append((d.isoformat(), g_fin.isoformat()))
        d = g_fin + dt.timedelta(days=1)
    return out


def serie_demanda(datos, codigo, noche, f):
    """F4 y F5 con lo que se sabía la noche `noche`."""
    filas = diario(datos, codigo, noche, f, conteos_hasta=noche)
    dias_venta = set(x for x in datos.venta if x <= noche)
    y, imp, dows, fer = [], [], [], []
    for x in filas:
        d = x['fecha']
        L = 0.0
        agot = sorted(datos.agotados.get(d, ()))
        if agot:
            habitual, vendidas = {}, datos.vendidas[d]
            for s in agot:
                previos = [(D(d) - dt.timedelta(days=7 * k)).isoformat() for k in range(1, 5)]
                previos = [p for p in previos if p in dias_venta]
                habitual[s] = suma(datos.vendidas[p].get(s, 0) for p in previos) / len(previos) if previos else 0.0
            L = F.ventas_perdidas(agot, habitual, vendidas, {s: datos.receta[s].get(codigo, 0.0) for s in agot if s in datos.receta}, f)
        y.append(x['C'] + L)
        imp.append(x['imputado'])
        dows.append(D(d).weekday())
        fer.append('feriado' in datos.notas[d])
    return filas, y, imp, dows, fer


def pronostico_noche(datos, codigo, noche, f):
    filas, y, imp, dows, fer = serie_demanda(datos, codigo, noche, f)
    ins = datos.insumos[codigo]
    H = min(COBERTURA, ins['vida_util'])
    sel = F.seleccionar(y, imp, dows, fer, H)
    futuros, d = [], noche
    for _ in range(3):
        d = datos.siguiente_atencion(d)
        futuros.append(d)
    dows_f = [D(x).weekday() for x in futuros]
    fer_f = ['feriado' in datos.notas[x] for x in futuros]
    if sel is None:
        metodo, sigma, mae = 'respaldo', None, None
        pron = F.respaldo(y, 3)
    else:
        metodo, sigma, mae = sel['metodo'], sel['sigma_h'], sel['mae']
        pron = F.pronosticar(metodo, y, 3, dows, fer, dows_f, fer_f)
    # Disponible para la lista del día siguiente: su conteo de apertura o el stock teórico (F6)
    fecha_lista = futuros[0]
    A = datos.conteo.get((codigo, fecha_lista))
    fuente = 'conteo'
    if A is None:
        fuente = 'teorico'
        ultimo = max(x['fecha'] for x in filas if (codigo, x['fecha']) in datos.conteo)
        tramo = [x for x in filas if x['fecha'] >= ultimo]
        A = F.stock_teorico(datos.conteo[(codigo, ultimo)], suma(x['I'] for x in tramo), f,
                            suma(datos.consumo_receta(codigo, x['fecha']) for x in tramo))
    z = F.z_normal(ins['nivel'])
    Q = F.cantidad_sugerida(pron[:H], sigma if sigma is not None else 0.0, z, A)
    return {
        'metodo': metodo, 'mae': {m: r6(v) for m, v in mae.items()} if mae else None, 'n': len(y),
        'pronosticos': [{'fecha': t, 'horizonte': k + 1, 'kg': r6(v)} for k, (t, v) in enumerate(zip(futuros, pron))],
        'sigma_h': r6(sigma), 'H': H, 'z': r6(z), 'fecha_lista': fecha_lista,
        'disponible': r6(A), 'fuente_disponible': fuente, 'cantidad': r6(Q),
    }


def main():
    datos = Datos()
    factores = calibrar(datos, *CALIBRACION)
    series = {c: diario(datos, c, PERIODO[1], factores[c]) for c in datos.codigos}
    total, extra = periodo(datos, PERIODO[0], PERIODO[1], factores, series)
    esperado = {
        'meta': {
            'modelo': MODELO, 'periodo': list(PERIODO), 'calibracion': list(CALIBRACION), 'cobertura': COBERTURA,
            'convenciones': [
                'Los factores de calibracion de las semanas 1 a 4 se aplican a todo lo demas (consumo imputado, costo del plato, ventas perdidas).',
                'El costo promedio (F8) se recorre desde el primer registro; la apertura usada es el conteo o, si falta, la estimada con el dia anterior.',
                'Costo promedio del insumo en el periodo: promedio ponderado por el consumo.',
                'Semanas lunes a domingo; meses calendario; ambos recortados al periodo.',
                'Pronostico de la noche N: solo conteos hasta N; el consumo de N siempre es teorico (imputado).',
            ],
        },
        'factores': {c: r6(v) for c, v in factores.items()},
        'factores_fuera_de_rango': [c for c, v in factores.items() if F.fuera_de_rango(v)],
        'total': total,
        'semanas': [periodo(datos, a, b, factores, series)[0] for a, b in grupos(*PERIODO, 'semana')],
        'meses': [periodo(datos, a, b, factores, series)[0] for a, b in grupos(*PERIODO, 'mes')],
        'platos': carta(datos, PERIODO[0], PERIODO[1], factores, extra),
        'pronosticos': [],
    }
    for noche in datos.dias_atencion(*NOCHES):
        esperado['pronosticos'].append({
            'noche': noche,
            'insumos': {c: pronostico_noche(datos, c, noche, factores[c]) for c in datos.codigos},
        })
    with open(os.path.join(SIM, 'esperado.json'), 'w', encoding='utf-8', newline='\n') as f:
        json.dump(esperado, f, ensure_ascii=False, indent=1)
        f.write('\n')
    metodos = defaultdict(int)
    for n in esperado['pronosticos']:
        for c, p in n['insumos'].items():
            metodos[p['metodo']] += 1
    print('referencia: factores', esperado['factores'], '· UO total', round(total['UO'], 2),
          '· food cost', round(total['food_cost'], 2), '· métodos', dict(metodos))


if __name__ == '__main__':
    main()
