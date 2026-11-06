# -*- coding: utf-8 -*-
"""Simulador de 12 semanas de operación de la cevichería (plan-sistema T5).

Genera, con semilla fija, los registros que el sistema guardaría: ventas por boleta,
compras, conteos de apertura, merma, otros insumos, gastos, agotados, «No había» y
notas del día. Escribe un CSV por tabla en server/src/__tests__/fixtures/sim12/ con las
columnas del export de la tesis. Solo biblioteca estándar.

Uso: python scripts/tesis/simulador.py
"""
import csv
import datetime as dt
import math
import os
import random

AQUI = os.path.dirname(os.path.abspath(__file__))
RAIZ = os.path.normpath(os.path.join(AQUI, '..', '..'))
DATOS = os.path.join(AQUI, 'datos')
SALIDA = os.path.join(RAIZ, 'server', 'src', '__tests__', 'fixtures', 'sim12')

SEMILLA = 20260610
INICIO = dt.date(2026, 6, 16)   # martes
FIN = dt.date(2026, 9, 6)       # domingo
FERIADOS = {dt.date(2026, 7, 28): 'Fiestas Patrias', dt.date(2026, 7, 29): 'Fiestas Patrias'}
FACTOR_FERIADO = 1.30
# weekday() de Python: lunes 0 … domingo 6
FACTOR_DIA = {1: 0.8, 2: 0.8, 3: 0.9, 4: 1.1, 5: 1.6, 6: 1.8}
DIAS_COMPRA = {1, 3, 5}         # martes, jueves y sábado
HOLGURA = 0.15
VENTA_OBJETIVO = 1000.0         # S/ promedio de martes a jueves
HORA_ABRE, HORA_CIERRA = 11 * 3600, 17 * 3600

# Tabla 1 y Tabla 20 de la tesis. factor_real es la «verdad» que la calibración debe recuperar.
INSUMOS = [
    # id, código, nombre, rendimiento, vida útil, nivel de servicio, precio base, mínimo, máximo, factor real
    (1, 'PESCADO', 'Pescado', 0.80, 7, 0.99, 10.00, 8.00, 12.00, 1.04),
    (2, 'CALAMAR', 'Calamar', 1.00, 6, 0.90, 5.50, 5.00, 10.00, 1.08),
    (3, 'MIXTURA', 'Mixtura de mariscos', 1.00, 3, 0.95, 28.00, 25.00, 32.00, 1.03),
    (4, 'LIMON', 'Limón', 1.00, 10, 0.95, 4.00, 2.50, 8.00, 1.10),
]
# Pasan a «otros insumos» (no críticos): no tienen registros diarios
OTROS = [(5, 'PULPO', 'Pulpo'), (6, 'LANGOSTINO', 'Langostino'), (7, 'CONCHAS', 'Conchas negras')]
COLUMNA_RECETA = {'PESCADO': 'pescado_g', 'CALAMAR': 'calamar_g', 'MIXTURA': 'mixtura_g', 'LIMON': 'limon_g'}

PESO_CATEGORIA = {
    'De nuestra carta': 1.2, 'Las Power de Maui': 1.0, 'Nuestras infaltables': 3.0,
    'Nuestros arroces': 1.5, 'Nuestros dúos marinos': 1.6, 'Nuestros tríos marinos': 1.3,
    'Las crocantitas': 1.8, 'Nuestras calientitas': 1.0, 'Nuestras rondas': 0.25, 'Bebidas': 2.0,
}
PESO_VARIANTE = {'pescado': 1.0, 'calamar': 0.6, '': 1.0}

GASTOS = [  # categoría, descripción, monto mensual, tipo
    ('alquiler', 'Alquiler del local', 3000.0, 'fijo'),
    ('sueldos', 'Sueldos', 9000.0, 'fijo'),
    ('luz', 'Luz', 500.0, 'fijo'),
    ('agua', 'Agua', 200.0, 'fijo'),
    ('internet', 'Internet', 100.0, 'fijo'),
    ('gas', 'Gas', 700.0, 'variable'),
    ('descartables', 'Descartables', 500.0, 'variable'),
]

ENCARGADA, CAJERO = 'Encargada', 'Cajero'


def sku_nombre(plato, variante):
    return f'{plato} ({variante.capitalize()})' if variante else plato


def leer_csv(nombre):
    with open(os.path.join(DATOS, nombre), encoding='utf-8-sig', newline='') as f:
        return list(csv.DictReader(f))


def escribir(nombre, columnas, filas):
    with open(os.path.join(SALIDA, nombre), 'w', encoding='utf-8', newline='') as f:
        w = csv.writer(f, lineterminator='\n')
        w.writerow(columnas)
        w.writerows(filas)


def num(x, dec=2):
    """Formato fijo: el mismo texto en cada ejecución y plataforma."""
    return f'{x:.{dec}f}'


def poisson(rng, lam):
    """Knuth; λ pequeño (≤ 15) en este simulador."""
    if lam <= 0:
        return 0
    lim = math.exp(-lam)
    k, p = 0, 1.0
    while True:
        p *= rng.random()
        if p <= lim:
            return k
        k += 1


def medio_kilo(x):
    return max(0.0, math.floor(x * 2 + 0.5) / 2)


def hhmmss(seg):
    return f'{seg // 3600:02d}:{seg % 3600 // 60:02d}:{seg % 60:02d}'


def main():
    rng = random.Random(SEMILLA)
    os.makedirs(SALIDA, exist_ok=True)

    # ── Carta y recetas ──
    carta = []
    categorias = {}
    for fila in leer_csv('carta_maui.csv'):
        cat = fila['categoria']
        categorias.setdefault(cat, len(categorias) + 1)
        carta.append({
            'id': len(carta) + 1, 'categoria_id': categorias[cat], 'categoria': cat,
            'plato': fila['plato'], 'variante': fila['variante'],
            'sku': sku_nombre(fila['plato'], fila['variante']), 'precio': float(fila['precio']),
        })
    por_clave = {(p['plato'], p['variante']): p for p in carta}
    recetas = {}  # sku → {código: gramos limpios}
    for fila in leer_csv('recetas_aproximadas.csv'):
        p = por_clave[(fila['plato'], fila['variante'])]
        recetas[p['sku']] = {cod: float(fila[col]) for cod, col in COLUMNA_RECETA.items() if float(fila[col]) > 0}
    insumo = {i[1]: i for i in INSUMOS}
    # kg (en la unidad de compra) que se gastan de verdad por porción
    kg_real = {sku: {c: g / 1000 / insumo[c][3] * insumo[c][9] for c, g in r.items()} for sku, r in recetas.items()}

    # Demanda base por plato: peso de la categoría × variante × modulación fija por plato
    pesos = {p['sku']: PESO_CATEGORIA[p['categoria']] * PESO_VARIANTE[p['variante']] * rng.uniform(0.4, 1.6) for p in carta}
    dia_laboral = (FACTOR_DIA[1] + FACTOR_DIA[2] + FACTOR_DIA[3]) / 3
    k = VENTA_OBJETIVO / (dia_laboral * sum(pesos[p['sku']] * p['precio'] for p in carta))
    lam = {sku: w * k for sku, w in pesos.items()}

    # ── Calendario ──
    dias = []
    d = INICIO
    while d <= FIN:
        if d.weekday() != 0:
            dias.append(d)
        d += dt.timedelta(days=1)
    assert len(dias) == 72, len(dias)
    conteo_siguiente = FIN + dt.timedelta(days=2)  # martes 2026-09-08: cierra el último consumo
    # Tres días sin conteo: uno en las semanas 2 a 4 (la calibración debe excluirlo) y dos después
    sin_conteo = {rng.choice(dias[6:24])} | set(rng.sample(dias[24:66], 2))

    def factor(dia):
        return FACTOR_DIA[dia.weekday()] * (FACTOR_FERIADO if dia in FERIADOS else 1.0)

    def esperado_kg(codigo, dia):
        return sum(lam[s] * factor(dia) * kg_real[s].get(codigo, 0.0) for s in kg_real)

    # ── Estado ──
    precio = {i[1]: i[6] for i in INSUMOS}
    lotes = {i[1]: [[INICIO - dt.timedelta(days=1), esperado_kg(i[1], INICIO)]] for i in INSUMOS}
    compras, mermas, conteos, ventas, perdidas, agotados, otros = [], [], [], [], [], [], []
    boleta = 0
    venta_dia = {}

    def stock(c):
        return sum(q for _b, q in lotes[c])

    def consumir(c, q):
        for lote in lotes[c]:
            usa = min(lote[1], q)
            lote[1] -= usa
            q -= usa
            if q <= 1e-12:
                break
        lotes[c] = [l for l in lotes[c] if l[1] > 1e-9]

    def contar(dia):
        if dia in sin_conteo:
            return
        for i in INSUMOS:
            conteos.append((dia, i, round(stock(i[1]), 2)))

    for n, dia in enumerate(dias):
        # Precio del día: paseo aleatorio acotado al rango de la tabla
        for i in INSUMOS:
            precio[i[1]] = round(min(i[8], max(i[7], precio[i[1]] * (1 + rng.uniform(-0.04, 0.04)))), 2)
        contar(dia)
        # Compras: lo esperado hasta la siguiente compra con 10 % de holgura y ± 15 % de
        # ruido, menos lo que quedaba, en medios kilos
        if dia.weekday() in DIAS_COMPRA:
            cubre = [dia, dia + dt.timedelta(days=1)]
            for i in INSUMOS:
                q = medio_kilo(sum(esperado_kg(i[1], x) for x in cubre) * (1 + HOLGURA + rng.uniform(-0.15, 0.15)) - stock(i[1]))
                if q > 0:
                    lotes[i[1]].append([dia, q])
                    compras.append((dia, i, q, precio[i[1]]))

        # Ventas: cada porción pedida es un evento con hora; se atiende en orden
        eventos = []
        for p in carta:
            for _ in range(poisson(rng, lam[p['sku']] * factor(dia))):
                eventos.append((rng.randint(HORA_ABRE, HORA_CIERRA), p['id']))
        eventos.sort()
        agotado_desde = {}
        total = 0.0
        pendientes = []  # porciones de la boleta en curso: (hora, plato)
        tam = rng.randint(1, 4)

        def cerrar_boleta():
            nonlocal boleta
            if not pendientes:
                return
            boleta += 1
            agrupado = {}
            for hora, pid in pendientes:
                agrupado.setdefault(pid, [hora, 0])[1] += 1
            for pid, (hora, cant) in agrupado.items():
                p = carta[pid - 1]
                ventas.append((dia, hhmmss(hora), boleta, p, cant))
            pendientes.clear()

        for hora, pid in eventos:
            p = carta[pid - 1]
            sku = p['sku']
            necesita = kg_real.get(sku, {})
            if pid in agotado_desde:
                if rng.random() < 0.5:  # «No había» es opcional: se registra la mitad de las veces
                    perdidas.append((dia, hhmmss(hora), p, insumo[agotado_desde[pid][1]]))
                continue
            falta = next((c for c, q in necesita.items() if stock(c) + 1e-12 < q), None)
            if falta:
                agotado_desde[pid] = (hora, falta)
                if rng.random() < 0.5:
                    perdidas.append((dia, hhmmss(hora), p, insumo[falta]))
                continue
            for c, q in necesita.items():
                consumir(c, q)
            total += p['precio']
            pendientes.append((hora, pid))
            if len(pendientes) >= tam:
                cerrar_boleta()
                tam = rng.randint(1, 4)
        cerrar_boleta()
        venta_dia[dia] = total

        # Se habilitan al abrir el siguiente día de atención
        siguiente = dias[n + 1] if n + 1 < len(dias) else conteo_siguiente
        for pid, (hora, _c) in sorted(agotado_desde.items(), key=lambda x: (x[1][0], x[0])):
            agotados.append((dia, hora, siguiente, carta[pid - 1]))

        # Otros insumos del día: 18 % de las ventas ± 10 %
        otros.append((dia, round(total * 0.18 * (1 + rng.uniform(-0.10, 0.10)), 1)))

        # Merma: lo que estará vencido al abrir el siguiente día de atención (FIFO)
        for i in INSUMOS:
            vencido = sum(q for b, q in lotes[i[1]] if (siguiente - b).days >= i[4])
            lotes[i[1]] = [l for l in lotes[i[1]] if (siguiente - l[0]).days < i[4]]
            if vencido >= 0.005:
                mermas.append((dia, i, round(vencido, 2), siguiente))
    contar(conteo_siguiente)

    escribir_todo(carta, recetas, compras, mermas, conteos, ventas, perdidas, agotados, otros, dias)
    print(f'simulador: {len(dias)} días, {boleta} boletas, S/ {sum(venta_dia.values()):.2f} en ventas, '
          f'{len(agotados)} agotados, {len(mermas)} mermas, sin conteo {sorted(str(x) for x in sin_conteo)}')


def escribir_todo(carta, recetas, compras, mermas, conteos, ventas, perdidas, agotados, otros, dias):
    escribir('carta.csv', ['id', 'categoria_id', 'categoria', 'plato', 'variante', 'sku', 'precio'],
             [(p['id'], p['categoria_id'], p['categoria'], p['plato'], p['variante'], p['sku'], num(p['precio'])) for p in carta])
    escribir('insumos.csv', ['id', 'codigo', 'nombre', 'unidad', 'perecible', 'critico', 'activo', 'orden',
                             'rendimiento', 'vida_util_dias', 'nivel_servicio'],
             [(i[0], i[1], i[2], 'kg', 1, 1, 1, i[0], num(i[3]), i[4], num(i[5])) for i in INSUMOS] +
             [(o[0], o[1], o[2], 'kg', 1, 0, 1, o[0], num(1), '', '') for o in OTROS])
    escribir('recetas.csv', ['sku', 'insumo_codigo', 'gramos_limpios'],
             [(sku, c, num(g, 0)) for sku in [p['sku'] for p in carta if p['sku'] in recetas] for c, g in recetas[sku].items()])
    escribir('ventas_items.csv', ['fecha', 'hora', 'boleta', 'plato', 'variante', 'cantidad', 'precio'],
             [(d, h, b, p['plato'], p['variante'], q, num(p['precio'])) for d, h, b, p, q in ventas])
    escribir('purchases.csv', ['local_id', 'id', 'fecha', 'insumo_id', 'insumo_codigo', 'insumo', 'unidad', 'cantidad',
                               'costo_total', 'costo_unitario', 'proveedor', 'origen', 'modo_entrada', 'modo_precio',
                               'notas', 'registrado_por', 'registrado_en'],
             [(1, n + 1, d, i[0], i[1], i[2], 'kg', num(q, 1), num(q * p), num(p), 'Terminal pesquero', 'daily', 'typed',
               'typed', '', ENCARGADA, f'{d} 10:30:00') for n, (d, i, q, p) in enumerate(compras)])
    escribir('waste.csv', ['local_id', 'id', 'fecha', 'insumo_id', 'insumo_codigo', 'insumo', 'unidad', 'cantidad', 'motivo',
                           'origen', 'modo_entrada', 'notas', 'registrado_por', 'registrado_en'],
             [(1, n + 1, d, i[0], i[1], i[2], 'kg', num(q), 'deterioro', 'daily', 'typed', '', ENCARGADA, f'{r} 09:00:00')
              for n, (d, i, q, r) in enumerate(mermas)])
    escribir('counts.csv', ['local_id', 'fecha', 'momento', 'insumo_id', 'insumo_codigo', 'insumo', 'unidad', 'cantidad',
                            'modo_entrada', 'registrado_por', 'registrado_en'],
             [(1, d, 'apertura', i[0], i[1], i[2], 'kg', num(q), 'typed', ENCARGADA, f'{d} 09:00:00') for d, i, q in conteos])
    escribir('lost_sales.csv', ['local_id', 'id', 'fecha', 'hora', 'plato_id', 'plato', 'insumo_id', 'insumo_codigo', 'insumo',
                                'porciones', 'registrado_por'],
             [(1, n + 1, d, h, p['id'], p['sku'], i[0], i[1], i[2], 1, CAJERO) for n, (d, h, p, i) in enumerate(perdidas)])
    filas = []
    for d, hora, sig, p in agotados:
        ini = dt.datetime.combine(d, dt.time()) + dt.timedelta(seconds=hora)
        fin = dt.datetime.combine(sig, dt.time(10, 0))
        filas.append((1, p['id'], p['sku'], ini.strftime('%Y-%m-%d %H:%M:%S'), fin.strftime('%Y-%m-%d %H:%M:%S'),
                      # Minutos redondeados como el export (Math.round)
                      math.floor((fin - ini).total_seconds() / 60 + 0.5), 'manual', CAJERO, ENCARGADA))
    escribir('stockouts.csv', ['local_id', 'plato_id', 'plato', 'inicio', 'fin', 'duracion_min', 'origen', 'marcado_por',
                               'habilitado_por'], filas)
    escribir('day_notes.csv', ['local_id', 'id', 'fecha', 'tipo', 'texto', 'registrado_por', 'registrado_en'],
             [(1, n + 1, d, 'feriado', t, ENCARGADA, f'{d} 09:00:00') for n, (d, t) in enumerate(sorted(FERIADOS.items()))])
    escribir('other_costs.csv', ['local_id', 'id', 'fecha', 'monto', 'origen', 'modo_entrada', 'registrado_por', 'registrado_en'],
             [(1, n + 1, d, num(m), 'daily', 'typed', ENCARGADA, f'{d} 10:30:00') for n, (d, m) in enumerate(otros)])
    meses = sorted({(d.year, d.month) for d in dias})
    escribir('gastos.csv', ['fecha', 'categoria', 'descripcion', 'monto', 'tipo'],
             [(f'{y}-{m:02d}-01', c, desc, num(monto), tipo) for y, m in meses for c, desc, monto, tipo in GASTOS])


if __name__ == '__main__':
    main()
