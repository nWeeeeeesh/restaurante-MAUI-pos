// Lecturas del incremento 3 (plan-sistema T15). Reutiliza la lectura por lote de la
// rentabilidad (consumo real o imputado necesita lo mismo) y agrega los agotados, los
// parámetros de los críticos, los pronósticos guardados y las ventas hasta una hora.
import { and, asc, eq, gte, lt, lte, ne, or, isNull, sql } from 'drizzle-orm'
import type { Executor } from '../db'
import { auditLog, bills, demandForecasts, dishes, orderItems, orders, supplies, supplyCounts } from '../db/schema'
import { addDaysIso } from '../domain/calendar'
import { claveVariante, varianteDe } from '../domain/profitability'
import type { DatosDemanda } from '../domain/demand'
import { leerPeriodo } from './profitability.repo'

const limaDayEndUtc = (date: string) => `${addDaysIso(date, 1)} 05:00:00`

export interface ParametrosInsumo {
  id: number
  code: string
  name: string
  yield: number
  shelfLifeDays: number | null
  serviceLevel: number | null
}

export interface DatosPronostico {
  demanda: DatosDemanda
  insumos: ParametrosInsumo[]
}

// Todo lo necesario para pronosticar hasta `hasta` (la noche, o el día de la lista)
export async function leerDatosPronostico(ex: Executor, { localId, hasta }: { localId: number; hasta: string }): Promise<DatosPronostico> {
  const p = await leerPeriodo(ex, { localId, from: hasta, to: hasta })
  const params = await ex.select({ id: supplies.id, shelfLifeDays: supplies.shelfLifeDays, serviceLevel: supplies.serviceLevel }).from(supplies)
  const paramById = new Map(params.map(x => [x.id, x]))

  // Agotados: transiciones a no disponible (dish.availability), por día local
  const day = sql<string>`date(${auditLog.at}, '-5 hours')`
  const marks = await ex.select({ dishId: auditLog.entityId, date: day }).from(auditLog)
    .where(and(eq(auditLog.action, 'dish.availability'), sql`json_extract(${auditLog.data}, '$.available') = 0`, lt(auditLog.at, limaDayEndUtc(hasta))))
  const keysByDish = new Map<number, Set<string>>()
  const addKey = (dishId: number, key: string) => {
    const s = keysByDish.get(dishId) ?? new Set<string>()
    s.add(key)
    keysByDish.set(dishId, s)
  }
  for (const key of p.recetas.keys()) addKey(Number(key.split('|')[0]), key)
  const agotadosDia = new Map<string, string[]>()
  for (const m of marks) {
    if (m.dishId === null) continue
    const keys = new Set([claveVariante(m.dishId, ''), ...(keysByDish.get(m.dishId) ?? [])])
    const list = agotadosDia.get(m.date) ?? []
    for (const k of keys) if (!list.includes(k)) list.push(k)
    agotadosDia.set(m.date, list)
  }

  const porcionesDia = new Map<string, Map<string, number>>()
  const nombres = new Map<string, string>()
  for (const v of p.ventas) {
    const key = claveVariante(v.dishId, v.variant)
    nombres.set(key, v.nombre)
    const m = porcionesDia.get(v.fecha) ?? new Map<string, number>()
    m.set(key, (m.get(key) ?? 0) + v.porciones)
    porcionesDia.set(v.fecha, m)
  }
  for (const pl of p.platos) nombres.set(claveVariante(pl.dishId, pl.variant), pl.nombre)

  return {
    demanda: { costeo: p.costeo, porcionesDia, nombres, agotadosDia, recetas: p.recetas, feriados: p.feriados },
    insumos: p.costeo.insumos.map(i => ({ ...i, shelfLifeDays: paramById.get(i.id)?.shelfLifeDays ?? null, serviceLevel: paramById.get(i.id)?.serviceLevel ?? null })),
  }
}

export async function pronosticosDeNoche(ex: Executor, localId: number, madeOn: string) {
  return ex.select().from(demandForecasts)
    .where(and(eq(demandForecasts.localId, localId), eq(demandForecasts.madeOn, madeOn)))
    .orderBy(asc(demandForecasts.supplyId), asc(demandForecasts.horizon))
}

// Último conteo de apertura de cada insumo hasta la fecha
export async function ultimosConteos(ex: Executor, localId: number, fecha: string) {
  const rows = await ex.select({ supplyId: supplyCounts.supplyId, date: sql<string>`max(${supplyCounts.countedOn})` })
    .from(supplyCounts)
    .where(and(eq(supplyCounts.localId, localId), eq(supplyCounts.moment, 'apertura'), lte(supplyCounts.countedOn, fecha)))
    .groupBy(supplyCounts.supplyId)
  return new Map(rows.map(r => [r.supplyId, r.date]))
}

// Ventas (porciones por plato y variante) entre el inicio de `desde` y el instante `hastaUtc`
export async function ventasHasta(ex: Executor, desde: string, hastaUtc: string, variantes: Map<number, Set<string>>) {
  const rows = await ex.select({
    dishId: orderItems.dishId, modifiers: orderItems.modifiers, qty: sql<number>`sum(${orderItems.quantity})`,
  }).from(orderItems)
    .innerJoin(bills, eq(orderItems.billId, bills.id))
    .leftJoin(orders, eq(orderItems.orderId, orders.id))
    .where(and(gte(bills.paidAt, `${desde} 05:00:00`), lte(bills.paidAt, hastaUtc), or(isNull(orders.status), ne(orders.status, 'cancelled'))))
    .groupBy(orderItems.dishId, orderItems.modifiers)
  const out = new Map<string, number>()
  for (const r of rows) {
    if (r.dishId === null) continue
    const key = claveVariante(r.dishId, varianteDe(r.modifiers, variantes.get(r.dishId)))
    out.set(key, (out.get(key) ?? 0) + Number(r.qty))
  }
  return out
}

export async function platosDisponibles(ex: Executor) {
  return ex.select({ id: dishes.id, name: dishes.name }).from(dishes)
    .where(and(eq(dishes.available, true), eq(dishes.archived, false)))
}
