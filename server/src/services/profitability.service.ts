// Rentabilidad operativa (incremento 2, plan-sistema T9): coordina el repositorio y el
// dominio. Recibe el ejecutor y el local por parámetro; no lee el entorno.
import { db as defaultDb, type DB, type Executor } from '../db'
import { recipeCalibrations } from '../db/schema'
import { withWriteLock } from '../db/write-lock'
import { leerPeriodo, type Periodo } from '../repositories/profitability.repo'
import { diasAtencion, grupos, type Agrupacion } from '../domain/calendar'
import { factorCalibracion, fueraDeRango, RANGO_FACTOR } from '../domain/costing'
import {
  analizarCarta, calcularPeriodo, claveVariante, costearInsumo,
  type FilaInsumo, type ResultadoPeriodo,
} from '../domain/profitability'
import { audit } from './audit'
import { roundMoney } from '../utils/math'

export interface ConsultaRentabilidad extends Periodo {
  groupBy: Agrupacion
}

const r = (n: number | null, dec = 2) => (n === null ? null : Math.round(n * 10 ** dec) / 10 ** dec)
const kg = (n: number | null) => r(n, 3)

export type Advertencia =
  | { code: 'NO_RECIPE'; dishId: number; variant: string; name: string }
  | { code: 'FACTOR_OUT_OF_RANGE'; supplyId: number; supplyCode: string; factor: number }
  | { code: 'NOT_CALIBRATED'; supplyId: number; supplyCode: string }
  | { code: 'MISSING_COUNT'; dates: string[] }
  | { code: 'NO_PURCHASE_PRICE'; supplyId: number; supplyCode: string }

function totales(p: ResultadoPeriodo) {
  return {
    from: p.from, to: p.to,
    sales: roundMoney(p.V),
    cogs: roundMoney(p.CV),               // costo de lo vendido (F9)
    otherSupplies: roundMoney(p.O),
    expenses: roundMoney(p.G),
    fixedExpenses: roundMoney(p.GF),
    grossProfit: roundMoney(p.UB),
    operatingProfit: roundMoney(p.UO),
    foodCostPct: r(p.foodCost),
    breakEvenSales: p.Veq === null ? null : roundMoney(p.Veq),
    waste: { kg: kg(p.mermaKg), cost: roundMoney(p.mermaSoles), pct: r(p.mermaPct) },
  }
}

export async function obtenerRentabilidad(ex: Executor = defaultDb, q: ConsultaRentabilidad) {
  const d = await leerPeriodo(ex, q)
  const { costeo } = d
  const filas = new Map<number, FilaInsumo[]>(costeo.insumos.map(i => [i.id, costearInsumo(costeo, i.id, q.to, costeo.factores.get(i.id) ?? 1)]))
  const total = calcularPeriodo(costeo, filas, d.periodo, q.from, q.to)
  const serie = grupos(q.from, q.to, q.groupBy).map(g => ({ key: g.key, ...totales(calcularPeriodo(costeo, filas, d.periodo, g.from, g.to)) }))

  // Carta del periodo: porciones por plato y variante; las variantes por modificador
  // toman el precio promedio cobrado
  const porciones = new Map<string, number>()
  const cobrado = new Map<string, number>()
  for (const v of d.ventas) {
    if (v.fecha < q.from || v.fecha > q.to) continue
    const key = claveVariante(v.dishId, v.variant)
    porciones.set(key, (porciones.get(key) ?? 0) + v.porciones)
    cobrado.set(key, (cobrado.get(key) ?? 0) + v.total)
  }
  const platos = d.platos.map(p => {
    const key = claveVariante(p.dishId, p.variant)
    const n = porciones.get(key) ?? 0
    return p.variant !== '' && n > 0 ? { ...p, precio: cobrado.get(key)! / n } : p
  })
  const carta = analizarCarta(platos, porciones, d.recetas, costeo.factores, total)

  const advertencias: Advertencia[] = []
  for (const p of carta) if (p.sinReceta && p.porciones > 0) advertencias.push({ code: 'NO_RECIPE', dishId: p.dishId, variant: p.variant, name: p.nombre })
  for (const i of costeo.insumos) {
    const f = costeo.factores.get(i.id)
    if (f === undefined) advertencias.push({ code: 'NOT_CALIBRATED', supplyId: i.id, supplyCode: i.code })
    else if (fueraDeRango(f)) advertencias.push({ code: 'FACTOR_OUT_OF_RANGE', supplyId: i.id, supplyCode: i.code, factor: r(f, 4)! })
    const ri = total.insumos.get(i.id)
    if (ri && ri.consumoKg > 0 && (ri.costoPromedio ?? 0) === 0) advertencias.push({ code: 'NO_PURCHASE_PRICE', supplyId: i.id, supplyCode: i.code })
  }
  const sinConteo = diasAtencion(costeo.calendario, q.from, q.to)
    .filter(fecha => costeo.insumos.some(i => !costeo.conteos.get(i.id)?.has(fecha)))
  if (sinConteo.length > 0) advertencias.push({ code: 'MISSING_COUNT', dates: sinConteo })

  return {
    period: { from: q.from, to: q.to, groupBy: q.groupBy, localId: q.localId },
    totals: totales(total),
    series: serie,
    supplies: costeo.insumos.map(i => {
      const ri = total.insumos.get(i.id)!
      return {
        supplyId: i.id, code: i.code, name: i.name,
        consumptionKg: kg(ri.consumoKg), purchasedKg: kg(ri.ingresosKg),
        wasteKg: kg(ri.mermaKg), wastePct: r(ri.mermaPct), wasteCost: roundMoney(ri.mermaSoles),
        cost: roundMoney(ri.costo), averageCost: r(ri.costoPromedio, 4),
        factor: r(costeo.factores.get(i.id) ?? 1, 6), calibrated: d.calibrados.has(i.id),
        imputedDays: ri.diasImputados,
      }
    }),
    dishes: carta.map(p => ({
      dishId: p.dishId, variant: p.variant, name: p.nombre, price: roundMoney(p.precio), portions: p.porciones,
      cost: roundMoney(p.costo), margin: roundMoney(p.MC), marginPct: r(p.MCpct), category: p.categoria, noRecipe: p.sinReceta,
    })),
    imputedDays: [...new Set([...total.insumos.values()].flatMap(x => x.diasImputados))].sort(),
    warnings: advertencias,
  }
}

// F12 con los días de atención del periodo que tienen conteo ese día y el siguiente.
// Guarda un factor por insumo (el vigente pasa a ser este) y audita.
export async function calibrar(db: DB = defaultDb, q: Periodo, userId: number) {
  const d = await leerPeriodo(db, q)
  const { costeo } = d
  const resultados = costeo.insumos.map(i => {
    const dias = costearInsumo(costeo, i.id, q.to, 1).filter(x => x.fecha >= q.from && !x.imputado)
    const receta = costeo.consumoReceta.get(i.id)
    const factor = factorCalibracion(dias.map(x => x.C), dias.map(x => receta?.get(x.fecha) ?? 0))
    return { supplyId: i.id, code: i.code, name: i.name, factor, days: dias.length }
  })
  const guardar = resultados.filter((x): x is typeof x & { factor: number } => x.factor !== null)
  await withWriteLock(() => db.transaction(async (tx) => {
    for (const x of guardar) {
      await tx.insert(recipeCalibrations).values({
        localId: q.localId, supplyId: x.supplyId, factor: x.factor, fromDate: q.from, toDate: q.to, computedBy: userId,
      })
    }
    await audit(tx, {
      userId, action: 'recipe.calibrate', entity: 'supply', entityId: null,
      data: { localId: q.localId, from: q.from, to: q.to, factors: guardar.map(x => ({ supplyId: x.supplyId, code: x.code, factor: x.factor, days: x.days })) },
    })
  }))
  return {
    from: q.from, to: q.to,
    factors: resultados.map(x => ({
      ...x, factor: r(x.factor, 6),
      outOfRange: x.factor !== null && fueraDeRango(x.factor),
    })),
    range: RANGO_FACTOR,
  }
}
