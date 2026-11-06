// Rentabilidad operativa (incremento 2): arma las fórmulas de costing.ts sobre los
// datos que lee el repositorio. Puro, como todo domain/. Las mismas convenciones están
// en scripts/tesis/referencia.py y su README («contrato de la paridad»).
import {
  suma, costoPromedio, consumoReal, consumoTeorico, merma, prorratearGastos, resultado, costoPlato, margen,
  ingenieriaMenu, kgPorPorcion, type CategoriaMenu, type GastoMes,
} from './costing'
import { type Calendario, diasAtencion, siguienteAtencion, firstOfMonth, lastOfMonth } from './calendar'

export interface InsumoCritico {
  id: number
  code: string
  name: string
  yield: number
}

// Movimientos de un insumo en un día
export interface Movimiento {
  compraKg: number
  compraCosto: number
  enviadoKg: number
  recibidoKg: number
  recibidoCosto: number
}

export interface DatosCosteo {
  calendario: Calendario
  primerDia: string | null                          // primer día con algún registro
  insumos: InsumoCritico[]
  conteos: Map<number, Map<string, number>>         // apertura por insumo y día
  movimientos: Map<number, Map<string, Movimiento>>
  merma: Map<number, Map<string, number>>           // kg por insumo y día imputado
  consumoReceta: Map<number, Map<string, number>>   // Σ porciones × kg por porción, sin factor
  factores: Map<number, number>                     // vigentes; sin fila = 1
}

export interface FilaInsumo {
  fecha: string
  S: number          // apertura usada (conteo o estimada)
  I: number          // ingresos netos: compras − enviado + recibido
  M: number
  p: number          // costo promedio del día (0 si nunca hubo compra)
  C: number
  imputado: boolean  // C teórico: falta el conteo del día o del siguiente día de atención
}

const MOV_VACIO: Movimiento = { compraKg: 0, compraCosto: 0, enviadoKg: 0, recibidoKg: 0, recibidoCosto: 0 }

// Recorre los días de atención desde el primer registro hasta `hasta`. Con
// `conteosHasta`, ignora los conteos posteriores (lo que se sabía esa noche).
export function costearInsumo(d: DatosCosteo, insumoId: number, hasta: string, f: number, conteosHasta?: string): FilaInsumo[] {
  if (d.primerDia === null || d.primerDia > hasta) return []
  const conteos = d.conteos.get(insumoId) ?? new Map<string, number>()
  const contado = (fecha: string) => (conteosHasta !== undefined && fecha > conteosHasta ? undefined : conteos.get(fecha))
  const movs = d.movimientos.get(insumoId)
  const mermas = d.merma.get(insumoId)
  const receta = d.consumoReceta.get(insumoId)
  const filas: FilaInsumo[] = []
  let pPrev: number | null = null
  let prev: FilaInsumo | null = null
  for (const fecha of diasAtencion(d.calendario, d.primerDia, hasta)) {
    const A = contado(fecha)
    const S = A !== undefined ? A : prev === null ? 0 : Math.max(0, prev.S + prev.I - prev.M - prev.C)
    const mov = movs?.get(fecha) ?? MOV_VACIO
    const I = mov.compraKg - mov.enviadoKg + mov.recibidoKg
    // El precio de lo que entra: compras y recepciones (a su costo)
    const entraKg = mov.compraKg + mov.recibidoKg
    const pEntra = entraKg > 0 ? (mov.compraCosto + mov.recibidoCosto) / entraKg : null
    const p = costoPromedio(S, pPrev, entraKg, pEntra)
    const M = mermas?.get(fecha) ?? 0
    const Asig = contado(siguienteAtencion(d.calendario, fecha))
    const real = A !== undefined && Asig !== undefined
    const C = real ? consumoReal(A, I, M, Asig) : consumoTeorico(f, receta?.get(fecha) ?? 0)
    const fila: FilaInsumo = { fecha, S, I, M, p: p ?? 0, C, imputado: !real }
    filas.push(fila)
    pPrev = p
    prev = fila
  }
  return filas
}

export interface ResultadoInsumo {
  consumoKg: number
  mermaKg: number
  mermaPct: number | null
  mermaSoles: number
  costo: number                  // Σ (C + M) · p̄
  costoPromedio: number | null   // Σ C·p̄ / Σ C
  ingresosKg: number
  diasImputados: string[]
}

export interface ResultadoPeriodo {
  from: string
  to: string
  V: number
  CV: number
  O: number
  G: number
  GF: number
  UB: number
  UO: number
  foodCost: number | null
  Veq: number | null
  mermaKg: number
  mermaSoles: number
  mermaPct: number | null
  insumos: Map<number, ResultadoInsumo>
}

export interface DatosPeriodo {
  ventasDia: Map<string, number>        // S/ por día local
  otrosDia: Map<string, number>         // otros insumos por día
  gastosMes: Map<string, GastoMes[]>    // 'YYYY-MM' → gastos con su tipo
}

const enRango = (fecha: string, desde: string, hasta: string) => fecha >= desde && fecha <= hasta
const sumaRango = (m: Map<string, number>, desde: string, hasta: string) =>
  suma([...m.keys()].filter(k => enRango(k, desde, hasta)).sort().map(k => m.get(k)!))

// F9, F10, F11 y F15 de un periodo. `filas`: costearInsumo de cada insumo hasta el fin
// del periodo más largo que se esté calculando.
export function calcularPeriodo(
  costeo: DatosCosteo, filas: Map<number, FilaInsumo[]>, p: DatosPeriodo, desde: string, hasta: string,
): ResultadoPeriodo {
  const V = sumaRango(p.ventasDia, desde, hasta)
  const O = sumaRango(p.otrosDia, desde, hasta)
  let CV = O
  let mermaKg = 0
  let mermaSoles = 0
  let ingresos = 0
  const insumos = new Map<number, ResultadoInsumo>()
  for (const ins of costeo.insumos) {
    const dias = (filas.get(ins.id) ?? []).filter(x => enRango(x.fecha, desde, hasta))
    const costo = suma(dias.map(x => (x.C + x.M) * x.p))
    CV += costo
    const m = merma(dias.map(x => x.M), dias.map(x => x.I), dias.map(x => x.p))
    const mKg = suma(dias.map(x => x.M))
    const iKg = suma(dias.map(x => x.I))
    mermaKg += mKg
    mermaSoles += m.soles
    ingresos += iKg
    const consumo = suma(dias.map(x => x.C))
    insumos.set(ins.id, {
      consumoKg: consumo, mermaKg: mKg, mermaPct: m.pct, mermaSoles: m.soles, costo,
      costoPromedio: consumo > 0 ? suma(dias.map(x => x.C * x.p)) / consumo : null,
      ingresosKg: iKg, diasImputados: dias.filter(x => x.imputado).map(x => x.fecha),
    })
  }
  // Gastos: cada mes se reparte entre todos sus días de atención
  const porMes = new Map<string, number>()
  for (const fecha of diasAtencion(costeo.calendario, desde, hasta)) porMes.set(fecha.slice(0, 7), (porMes.get(fecha.slice(0, 7)) ?? 0) + 1)
  const meses = [...porMes.keys()].sort()
  const diasMes = new Map(meses.map(mes => [mes, diasAtencion(costeo.calendario, `${mes}-01`, lastOfMonth(`${mes}-01`)).length]))
  const { G, GF } = prorratearGastos(p.gastosMes, diasMes, new Map(meses.map(mes => [mes, porMes.get(mes)!])))
  const r = resultado(V, CV, G, GF)
  return {
    from: desde, to: hasta, V, CV, O, G, GF, UB: r.UB, UO: r.UO, foodCost: r.foodCost, Veq: r.Veq,
    mermaKg, mermaSoles, mermaPct: ingresos > 0 ? mermaKg / ingresos * 100 : null, insumos,
  }
}

// Rango de meses que tocan los gastos de un periodo
export function mesesDelPeriodo(desde: string, hasta: string): { from: string; to: string } {
  return { from: firstOfMonth(desde), to: lastOfMonth(hasta) }
}

// ── Carta: recetas, variantes y costo por plato ──

export interface RecetaFila {
  dishId: number
  variant: string     // '' = receta del plato
  supplyId: number
  gramsClean: number
}

// Receta en kg (unidad de compra) por plato y variante: clave `${dishId}|${variant}`
export function recetasKg(filas: readonly RecetaFila[], insumos: readonly InsumoCritico[]): Map<string, Map<number, number>> {
  const rend = new Map(insumos.map(i => [i.id, i.yield]))
  const out = new Map<string, Map<number, number>>()
  for (const r of filas) {
    const y = rend.get(r.supplyId)
    if (y === undefined) continue // solo los insumos críticos activos
    const key = claveVariante(r.dishId, r.variant)
    const m = out.get(key) ?? new Map<number, number>()
    m.set(r.supplyId, kgPorPorcion(r.gramsClean, y))
    out.set(key, m)
  }
  return out
}

export const claveVariante = (dishId: number, variant: string) => `${dishId}|${variant}`

// La variante de un ítem vendido: la primera opción elegida que tiene receta propia en
// ese plato; si ninguna, la receta del plato ('')
export function varianteDe(modifiers: string | null, variantes: ReadonlySet<string> | undefined): string {
  if (!modifiers || !variantes || variantes.size === 0) return ''
  try {
    const list = JSON.parse(modifiers) as { optionName?: string }[]
    for (const m of Array.isArray(list) ? list : []) if (m.optionName && variantes.has(m.optionName)) return m.optionName
  } catch {
    // Un JSON roto en un ítem antiguo no interrumpe el cálculo: se usa la receta base
  }
  return ''
}

export interface VentaAgrupada {
  fecha: string
  dishId: number
  variant: string
  nombre: string      // plato y variante, para ordenar como la referencia
  porciones: number
  total: number
}

// Σ porciones × kg por porción de cada insumo y día (sin factor), en el orden de la
// referencia: por nombre del plato
export function consumoRecetaPorDia(ventas: readonly VentaAgrupada[], recetas: Map<string, Map<number, number>>): Map<number, Map<string, number>> {
  const porDia = new Map<string, VentaAgrupada[]>()
  for (const v of ventas) {
    const list = porDia.get(v.fecha) ?? []
    list.push(v)
    porDia.set(v.fecha, list)
  }
  const out = new Map<number, Map<string, number>>()
  for (const [fecha, list] of porDia) {
    list.sort((a, b) => (a.nombre < b.nombre ? -1 : a.nombre > b.nombre ? 1 : 0))
    const totales = new Map<number, number>()
    for (const v of list) {
      const r = recetas.get(claveVariante(v.dishId, v.variant)) ?? recetas.get(claveVariante(v.dishId, ''))
      if (!r) continue
      for (const [supplyId, kg] of r) totales.set(supplyId, (totales.get(supplyId) ?? 0) + v.porciones * kg)
    }
    for (const [supplyId, kg] of totales) {
      const m = out.get(supplyId) ?? new Map<string, number>()
      m.set(fecha, kg)
      out.set(supplyId, m)
    }
  }
  return out
}

export interface PlatoCarta {
  dishId: number
  variant: string
  nombre: string
  precio: number
}

export interface CostoPlato extends PlatoCarta {
  porciones: number
  costo: number
  MC: number
  MCpct: number | null
  categoria: CategoriaMenu | null   // null si no se vendió en el periodo
  sinReceta: boolean
}

// F13, F14 e ingeniería de menú de los platos del periodo
export function analizarCarta(
  platos: readonly PlatoCarta[],
  porciones: ReadonlyMap<string, number>,
  recetas: Map<string, Map<number, number>>,
  factores: ReadonlyMap<number, number>,
  periodo: Pick<ResultadoPeriodo, 'O' | 'V' | 'insumos'>,
): CostoPlato[] {
  const pbar = new Map<number, number | null>([...periodo.insumos].map(([id, r]) => [id, r.costoPromedio ?? 0]))
  const otrosPorSol = periodo.V > 0 ? periodo.O / periodo.V : 0
  const out = platos.map(pl => {
    const key = claveVariante(pl.dishId, pl.variant)
    const receta = recetas.get(key) ?? recetas.get(claveVariante(pl.dishId, ''))
    const costo = costoPlato(receta ?? new Map<number, number>(), factores, pbar, otrosPorSol, pl.precio)
    const mg = margen(pl.precio, costo)
    return { ...pl, porciones: porciones.get(key) ?? 0, costo, MC: mg.MC, MCpct: mg.MCpct, categoria: null as CategoriaMenu | null, sinReceta: !receta }
  })
  const vendidos = out.filter(p => p.porciones > 0)
  const cat = ingenieriaMenu(
    new Map(vendidos.map(p => [claveVariante(p.dishId, p.variant), p.porciones])),
    new Map(vendidos.map(p => [claveVariante(p.dishId, p.variant), p.MC])),
  )
  for (const p of out) p.categoria = cat.get(claveVariante(p.dishId, p.variant)) ?? null
  return out
}
