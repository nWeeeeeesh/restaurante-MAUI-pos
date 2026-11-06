// Lecturas del incremento 2 (plan-sistema T9). ÚNICO módulo que conoce el esquema para
// la rentabilidad: una consulta por tabla para todo el periodo (sin consultas por día ni
// por insumo dentro de bucles). Devuelve los datos ya indexados para domain/.
import { and, asc, desc, eq, gte, lte, lt, ne, or, isNull, sql } from 'drizzle-orm'
import type { Executor } from '../db'
import {
  bills, dayNotes, dishes, expenseCategories, expenses, orderItems, orders, otherSupplyCosts, recipeCalibrations,
  recipeItems, supplies, supplyCounts, supplyPurchases, supplyTransfers, supplyWaste,
} from '../db/schema'
import { addDaysIso, lastOfMonth } from '../domain/calendar'
import type { GastoMes } from '../domain/costing'
import {
  claveVariante, consumoRecetaPorDia, recetasKg, varianteDe,
  type DatosCosteo, type DatosPeriodo, type InsumoCritico, type Movimiento, type PlatoCarta, type RecetaFila, type VentaAgrupada,
} from '../domain/profitability'

// Lima no tiene horario de verano: el día local de una boleta es su hora UTC − 5 h
const LIMA_DAY = (col: unknown) => sql<string>`date(${col}, '-5 hours')`
const limaDayEndUtc = (date: string) => `${addDaysIso(date, 1)} 05:00:00`
// Margen para encontrar el siguiente día de atención y los días de atención del mes
const HORIZONTE_DIAS = 31

export interface Periodo {
  localId: number
  from: string
  to: string
}

export interface DatosRentabilidad {
  costeo: DatosCosteo
  periodo: DatosPeriodo
  ventas: VentaAgrupada[]
  recetas: Map<string, Map<number, number>>
  platos: PlatoCarta[]
  feriados: Set<string>
  calibrados: Set<number>    // insumos con al menos un factor guardado
}

export async function leerPeriodo(ex: Executor, { localId, from, to }: Periodo): Promise<DatosRentabilidad> {
  const hasta = [lastOfMonth(to), addDaysIso(to, HORIZONTE_DIAS)].sort()[1]
  const mesDesde = `${from.slice(0, 7)}-01`
  const mesHasta = lastOfMonth(to)

  const insumos: InsumoCritico[] = (await ex.select({ id: supplies.id, code: supplies.code, name: supplies.name, yield: supplies.yield })
    .from(supplies)
    .where(and(eq(supplies.critical, true), or(eq(supplies.active, true), isNull(supplies.active))))
    .orderBy(asc(supplies.sortOrder), asc(supplies.id)))
    .map(s => ({ id: s.id, code: s.code ?? String(s.id), name: s.name, yield: s.yield }))

  // F8 se recorre desde el primer registro: compras, conteos y merma de toda la historia
  const counts = await ex.select({ supplyId: supplyCounts.supplyId, date: supplyCounts.countedOn, qty: supplyCounts.quantity })
    .from(supplyCounts)
    .where(and(eq(supplyCounts.localId, localId), eq(supplyCounts.moment, 'apertura'), lte(supplyCounts.countedOn, hasta)))
  const purchases = await ex.select({ supplyId: supplyPurchases.supplyId, date: supplyPurchases.purchasedAt, qty: supplyPurchases.quantity, cost: supplyPurchases.totalCost })
    .from(supplyPurchases)
    .where(and(eq(supplyPurchases.localId, localId), lte(supplyPurchases.purchasedAt, to)))
    .orderBy(asc(supplyPurchases.purchasedAt), asc(supplyPurchases.id))
  const transfers = await ex.select({ supplyId: supplyTransfers.supplyId, date: supplyTransfers.date, direction: supplyTransfers.direction, qty: supplyTransfers.quantity, unitCost: supplyTransfers.unitCost })
    .from(supplyTransfers)
    .where(and(eq(supplyTransfers.localId, localId), lte(supplyTransfers.date, to)))
  const waste = await ex.select({ supplyId: supplyWaste.supplyId, date: supplyWaste.wastedAt, qty: supplyWaste.quantity })
    .from(supplyWaste)
    .where(and(eq(supplyWaste.localId, localId), lte(supplyWaste.wastedAt, to)))

  // Ventas por día local, plato y modificadores (ítems de boletas pagadas, por bill_id).
  // Las boletas de pedidos cancelados no cuentan como venta.
  const day = LIMA_DAY(bills.paidAt)
  const salesRows = await ex.select({
    date: day, dishId: orderItems.dishId, modifiers: orderItems.modifiers,
    qty: sql<number>`sum(${orderItems.quantity})`, total: sql<number>`sum(${orderItems.unitPrice} * ${orderItems.quantity})`,
  }).from(orderItems)
    .innerJoin(bills, eq(orderItems.billId, bills.id))
    .leftJoin(orders, eq(orderItems.orderId, orders.id))
    .where(and(lt(bills.paidAt, limaDayEndUtc(hasta)), or(isNull(orders.status), ne(orders.status, 'cancelled'))))
    .groupBy(day, orderItems.dishId, orderItems.modifiers)

  const other = await ex.select({ date: otherSupplyCosts.date, amount: otherSupplyCosts.amount })
    .from(otherSupplyCosts)
    .where(and(eq(otherSupplyCosts.localId, localId), gte(otherSupplyCosts.date, from), lte(otherSupplyCosts.date, to)))
  // Cada local tiene su propia base (RD06): los gastos no llevan local_id
  const expenseRows = await ex.select({ date: expenses.date, category: expenses.category, amount: expenses.amount })
    .from(expenses)
    .where(and(gte(expenses.date, mesDesde), lte(expenses.date, mesHasta)))
  const kinds = await ex.select().from(expenseCategories)
  const notes = await ex.select({ date: dayNotes.date, kind: dayNotes.kind })
    .from(dayNotes)
    .where(and(eq(dayNotes.localId, localId), lte(dayNotes.date, hasta)))
  const recipeRows: RecetaFila[] = await ex.select({ dishId: recipeItems.dishId, variant: recipeItems.variant, supplyId: recipeItems.supplyId, gramsClean: recipeItems.gramsClean })
    .from(recipeItems)
  const dishRows = await ex.select({ id: dishes.id, name: dishes.name, price: dishes.price, archived: dishes.archived }).from(dishes).orderBy(asc(dishes.id))
  const calibrations = await ex.select({ supplyId: recipeCalibrations.supplyId, factor: recipeCalibrations.factor })
    .from(recipeCalibrations)
    .where(eq(recipeCalibrations.localId, localId))
    .orderBy(desc(recipeCalibrations.id))

  // ── Indexar ──
  const nest = <T>(m: Map<number, Map<string, T>>, id: number) => {
    let inner = m.get(id)
    if (!inner) m.set(id, inner = new Map<string, T>())
    return inner
  }
  const conteos = new Map<number, Map<string, number>>()
  for (const c of counts) nest(conteos, c.supplyId).set(c.date, c.qty)
  const movimientos = new Map<number, Map<string, Movimiento>>()
  const mov = (id: number, date: string) => {
    const m = nest(movimientos, id)
    let x = m.get(date)
    if (!x) m.set(date, x = { compraKg: 0, compraCosto: 0, enviadoKg: 0, recibidoKg: 0, recibidoCosto: 0 })
    return x
  }
  for (const p of purchases) {
    const x = mov(p.supplyId, p.date)
    x.compraKg += p.qty
    x.compraCosto += p.cost
  }
  const lastPrice = new Map<number, number>()
  for (const p of purchases) if (p.qty > 0) lastPrice.set(p.supplyId, p.cost / p.qty)
  for (const t of transfers) {
    const x = mov(t.supplyId, t.date)
    if (t.direction === 'envio') x.enviadoKg += t.qty
    else {
      x.recibidoKg += t.qty
      // Sin costo informado, la recepción entra al último precio de compra
      x.recibidoCosto += t.qty * (t.unitCost ?? lastPrice.get(t.supplyId) ?? 0)
    }
  }
  const merma = new Map<number, Map<string, number>>()
  for (const w of waste) {
    const m = nest(merma, w.supplyId)
    m.set(w.date, (m.get(w.date) ?? 0) + w.qty)
  }

  const recetas = recetasKg(recipeRows, insumos)
  const variantesPorPlato = new Map<number, Set<string>>()
  for (const r of recipeRows) if (r.variant !== '') {
    const s = variantesPorPlato.get(r.dishId) ?? new Set<string>()
    s.add(r.variant)
    variantesPorPlato.set(r.dishId, s)
  }
  const dishById = new Map(dishRows.map(d => [d.id, d]))
  const ventasPorClave = new Map<string, VentaAgrupada>()
  for (const r of salesRows) {
    if (r.dishId === null) continue
    const variant = varianteDe(r.modifiers, variantesPorPlato.get(r.dishId))
    const key = `${r.date}|${claveVariante(r.dishId, variant)}`
    const name = dishById.get(r.dishId)?.name ?? `#${r.dishId}`
    const v = ventasPorClave.get(key) ?? { fecha: r.date, dishId: r.dishId, variant, nombre: variant ? `${name} (${variant})` : name, porciones: 0, total: 0 }
    v.porciones += Number(r.qty)
    v.total += Number(r.total)
    ventasPorClave.set(key, v)
  }
  const ventas = [...ventasPorClave.values()]
  const ventasDia = new Map<string, number>()
  for (const v of ventas) if (v.fecha >= from && v.fecha <= to) ventasDia.set(v.fecha, (ventasDia.get(v.fecha) ?? 0) + v.total)

  const kindOf = new Map(kinds.map(k => [k.category, k.kind]))
  const gastosMes = new Map<string, GastoMes[]>()
  for (const e of expenseRows) {
    const mes = e.date.slice(0, 7)
    const categoria = e.category ?? 'general'
    const list = gastosMes.get(mes) ?? []
    // Una categoría sin clasificar cuenta como fija
    list.push({ categoria, monto: e.amount, tipo: kindOf.get(categoria) ?? 'fijo' })
    gastosMes.set(mes, list)
  }
  const otrosDia = new Map<string, number>()
  for (const o of other) otrosDia.set(o.date, (otrosDia.get(o.date) ?? 0) + o.amount)

  const factores = new Map<number, number>()
  for (const c of calibrations) if (!factores.has(c.supplyId)) factores.set(c.supplyId, c.factor)

  const primeros = [
    ventas.reduce<string | null>((m, v) => (m === null || v.fecha < m ? v.fecha : m), null),
    counts.reduce<string | null>((m, c) => (m === null || c.date < m ? c.date : m), null),
    purchases[0]?.date ?? null,
  ].filter((x): x is string => x !== null).sort()

  // Platos de la carta (sin los archivados) y las variantes con receta o con ventas
  const platos: PlatoCarta[] = []
  const vistos = new Set<string>()
  const agregar = (dishId: number, variant: string) => {
    const key = claveVariante(dishId, variant)
    const d = dishById.get(dishId)
    if (vistos.has(key) || !d) return
    vistos.add(key)
    platos.push({ dishId, variant, nombre: variant ? `${d.name} (${variant})` : d.name, precio: d.price })
  }
  for (const d of dishRows) if (!d.archived) agregar(d.id, '')
  for (const r of recipeRows) agregar(r.dishId, r.variant)
  for (const v of ventas) if (v.fecha >= from && v.fecha <= to) agregar(v.dishId, v.variant)
  platos.sort((a, b) => a.dishId - b.dishId || (a.variant < b.variant ? -1 : a.variant > b.variant ? 1 : 0))

  return {
    costeo: {
      calendario: {
        conVentas: new Set(ventas.map(v => v.fecha)),
        cerrados: new Set(notes.filter(n => n.kind === 'cerrado').map(n => n.date)),
      },
      primerDia: primeros[0] ?? null,
      insumos, conteos, movimientos, merma,
      consumoReceta: consumoRecetaPorDia(ventas, recetas),
      factores,
    },
    periodo: { ventasDia, otrosDia, gastosMes },
    ventas, recetas, platos,
    feriados: new Set(notes.filter(n => n.kind === 'feriado').map(n => n.date)),
    calibrados: new Set(factores.keys()),
  }
}
