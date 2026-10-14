import { and, asc, eq, gte, lte, sql } from 'drizzle-orm'
import { db } from '../db'
import { auditLog, dayNotes, dishes, lostSales, supplies, supplyCounts, supplyPurchases, supplyWaste, users } from '../db/schema'
import { localDateString, parseDayBoundary, sqliteLocalOffset } from '../utils/dates'
import { roundMoney } from '../utils/math'
import { toCsv } from '../utils/csv'
import type { DateRange } from './inventory.service'
import type { ExportTable } from '../schemas/inventory'

// Export del instrumento de la tesis: docs/diccionario-datos-tesis.md (v1).
// Las columnas y su orden están CONGELADOS; inventory.export.test.ts falla a
// propósito si cambian. Un cambio exige una versión nueva del diccionario y de
// DATASET_VERSION.
export const DATASET_VERSION = 'v1'

// Siempre 1 en la tesis; solo existe para no mapear datos si hay más sucursales
const LOCAL_ID = 1

const r2 = (n: number | null | undefined) => (n === null || n === undefined ? null : roundMoney(n))

function preamble(table: ExportTable, range: DateRange) {
  const now = new Date()
  const hh = String(now.getHours()).padStart(2, '0')
  const mm = String(now.getMinutes()).padStart(2, '0')
  return `# maui-tesis dataset ${DATASET_VERSION} · ${table} · desde ${range.from} · hasta ${range.to} · generado ${localDateString(now)} ${hh}:${mm} America/Lima`
}

// Timestamp UTC de la BD → fecha y hora locales 'YYYY-MM-DD HH:MM:SS'
const localTs = (col: unknown) => sql<string | null>`datetime(${col}, ${sqliteLocalOffset()})`

export async function exportCsv(table: ExportTable, range: DateRange): Promise<string> {
  const pre = preamble(table, range)
  const utcFrom = parseDayBoundary(range.from, 'start')
  const utcTo = parseDayBoundary(range.to, 'end')

  switch (table) {
    case 'daily': {
      // Vista por día e insumo de lo que dejó la «Compra del día»
      const counts = await db.select().from(supplyCounts)
        .where(and(eq(supplyCounts.moment, 'apertura'), gte(supplyCounts.countedOn, range.from), lte(supplyCounts.countedOn, range.to)))
      const purchases = await db.select().from(supplyPurchases)
        .where(and(eq(supplyPurchases.source, 'daily'), gte(supplyPurchases.sourceDate, range.from), lte(supplyPurchases.sourceDate, range.to)))
      const waste = await db.select().from(supplyWaste)
        .where(and(eq(supplyWaste.source, 'daily'), gte(supplyWaste.sourceDate, range.from), lte(supplyWaste.sourceDate, range.to)))
      const catalog = await db.select().from(supplies)

      type Row = { date: string; supplyId: number; opening: number | null; wasted: number; purchased: number; total: number; hasPurchase: boolean; supplier: string | null }
      const rows = new Map<string, Row>()
      const row = (date: string, supplyId: number) => {
        const key = `${date}|${supplyId}`
        if (!rows.has(key)) rows.set(key, { date, supplyId, opening: null, wasted: 0, purchased: 0, total: 0, hasPurchase: false, supplier: null })
        return rows.get(key)!
      }
      for (const c of counts) row(c.countedOn, c.supplyId).opening = c.quantity
      for (const w of waste) row(w.sourceDate!, w.supplyId).wasted += w.quantity
      for (const p of purchases) {
        const r = row(p.sourceDate!, p.supplyId)
        r.purchased += p.quantity
        r.total += p.totalCost
        r.hasPurchase = true
        r.supplier = r.supplier ?? p.supplier
      }
      const supply = (id: number) => catalog.find(s => s.id === id)
      const sorted = [...rows.values()].sort((a, b) =>
        a.date.localeCompare(b.date)
        || (supply(a.supplyId)?.sortOrder ?? 0) - (supply(b.supplyId)?.sortOrder ?? 0)
        || a.supplyId - b.supplyId)
      return toCsv(
        ['local_id', 'fecha', 'insumo_id', 'insumo_codigo', 'insumo', 'unidad', 'quedaba', 'botaste', 'compraste', 'precio_unitario', 'costo_total', 'proveedor'],
        sorted.map(r => {
          const s = supply(r.supplyId)
          return [LOCAL_ID, r.date, r.supplyId, s?.code, s?.name, s?.unit, r2(r.opening), r2(r.wasted), r2(r.purchased),
            r.hasPurchase && r.purchased > 0 ? r2(r.total / r.purchased) : null, r.hasPurchase ? r2(r.total) : null, r.supplier]
        }),
        pre,
      )
    }

    case 'purchases': {
      const rows = await db.select({
        localId: supplyPurchases.localId, id: supplyPurchases.id, date: supplyPurchases.purchasedAt,
        supplyId: supplyPurchases.supplyId, code: supplies.code, name: supplies.name, unit: supplies.unit,
        quantity: supplyPurchases.quantity, total: supplyPurchases.totalCost, supplier: supplyPurchases.supplier,
        source: supplyPurchases.source, notes: supplyPurchases.notes, by: users.name, at: localTs(supplyPurchases.createdAt),
      }).from(supplyPurchases)
        .innerJoin(supplies, eq(supplyPurchases.supplyId, supplies.id))
        .leftJoin(users, eq(supplyPurchases.createdBy, users.id))
        .where(and(gte(supplyPurchases.purchasedAt, range.from), lte(supplyPurchases.purchasedAt, range.to)))
        .orderBy(asc(supplyPurchases.purchasedAt), asc(supplyPurchases.id))
      return toCsv(
        ['local_id', 'id', 'fecha', 'insumo_id', 'insumo_codigo', 'insumo', 'unidad', 'cantidad', 'costo_total', 'costo_unitario', 'proveedor', 'origen', 'notas', 'registrado_por', 'registrado_en'],
        rows.map(r => [r.localId, r.id, r.date, r.supplyId, r.code, r.name, r.unit, r2(r.quantity), r2(r.total),
          r.quantity > 0 ? r2(r.total / r.quantity) : null, r.supplier, r.source, r.notes, r.by, r.at]),
        pre,
      )
    }

    case 'waste': {
      const rows = await db.select({
        localId: supplyWaste.localId, id: supplyWaste.id, date: supplyWaste.wastedAt,
        supplyId: supplyWaste.supplyId, code: supplies.code, name: supplies.name, unit: supplies.unit,
        quantity: supplyWaste.quantity, reason: supplyWaste.reason, source: supplyWaste.source,
        notes: supplyWaste.notes, by: users.name, at: localTs(supplyWaste.createdAt),
      }).from(supplyWaste)
        .innerJoin(supplies, eq(supplyWaste.supplyId, supplies.id))
        .leftJoin(users, eq(supplyWaste.createdBy, users.id))
        .where(and(gte(supplyWaste.wastedAt, range.from), lte(supplyWaste.wastedAt, range.to)))
        .orderBy(asc(supplyWaste.wastedAt), asc(supplyWaste.id))
      return toCsv(
        ['local_id', 'id', 'fecha', 'insumo_id', 'insumo_codigo', 'insumo', 'unidad', 'cantidad', 'motivo', 'origen', 'notas', 'registrado_por', 'registrado_en'],
        rows.map(r => [r.localId, r.id, r.date, r.supplyId, r.code, r.name, r.unit, r2(r.quantity), r.reason, r.source, r.notes, r.by, r.at]),
        pre,
      )
    }

    case 'counts': {
      const rows = await db.select({
        localId: supplyCounts.localId, date: supplyCounts.countedOn, moment: supplyCounts.moment,
        supplyId: supplyCounts.supplyId, code: supplies.code, name: supplies.name, unit: supplies.unit,
        quantity: supplyCounts.quantity, by: users.name, at: localTs(supplyCounts.createdAt),
      }).from(supplyCounts)
        .innerJoin(supplies, eq(supplyCounts.supplyId, supplies.id))
        .leftJoin(users, eq(supplyCounts.createdBy, users.id))
        .where(and(gte(supplyCounts.countedOn, range.from), lte(supplyCounts.countedOn, range.to)))
        .orderBy(asc(supplyCounts.countedOn), asc(supplyCounts.moment), asc(supplies.sortOrder), asc(supplies.id))
      return toCsv(
        ['local_id', 'fecha', 'momento', 'insumo_id', 'insumo_codigo', 'insumo', 'unidad', 'cantidad', 'registrado_por', 'registrado_en'],
        rows.map(r => [r.localId, r.date, r.moment, r.supplyId, r.code, r.name, r.unit, r2(r.quantity), r.by, r.at]),
        pre,
      )
    }

    case 'lost_sales': {
      const rows = await db.select({
        localId: lostSales.localId, id: lostSales.id, at: localTs(lostSales.occurredAt),
        dishId: lostSales.dishId, dishName: dishes.name, supplyId: lostSales.supplyId,
        code: supplies.code, supplyName: supplies.name, quantity: lostSales.quantity, by: users.name,
      }).from(lostSales)
        .leftJoin(dishes, eq(lostSales.dishId, dishes.id))
        .leftJoin(supplies, eq(lostSales.supplyId, supplies.id))
        .leftJoin(users, eq(lostSales.createdBy, users.id))
        .where(and(gte(lostSales.occurredAt, utcFrom), lte(lostSales.occurredAt, utcTo)))
        .orderBy(asc(lostSales.occurredAt), asc(lostSales.id))
      return toCsv(
        ['local_id', 'id', 'fecha', 'hora', 'plato_id', 'plato', 'insumo_id', 'insumo_codigo', 'insumo', 'porciones', 'registrado_por'],
        rows.map(r => [r.localId, r.id, r.at?.slice(0, 10), r.at?.slice(11, 16), r.dishId, r.dishName, r.supplyId, r.code, r.supplyName, r.quantity, r.by]),
        pre,
      )
    }

    case 'stockouts':
      return toCsv(
        ['local_id', 'plato_id', 'plato', 'inicio', 'fin', 'duracion_min', 'marcado_por', 'habilitado_por'],
        (await stockoutIntervals(range)).map(i => [LOCAL_ID, i.dishId, i.dishName, i.start, i.end, i.minutes, i.markedBy, i.restoredBy]),
        pre,
      )

    case 'day_notes': {
      const rows = await db.select({
        localId: dayNotes.localId, id: dayNotes.id, date: dayNotes.date, kind: dayNotes.kind,
        text: dayNotes.text, by: users.name, at: localTs(dayNotes.createdAt),
      }).from(dayNotes)
        .leftJoin(users, eq(dayNotes.createdBy, users.id))
        .where(and(gte(dayNotes.date, range.from), lte(dayNotes.date, range.to)))
        .orderBy(asc(dayNotes.date), asc(dayNotes.id))
      return toCsv(
        ['local_id', 'id', 'fecha', 'tipo', 'texto', 'registrado_por', 'registrado_en'],
        rows.map(r => [r.localId, r.id, r.date, r.kind, r.text, r.by, r.at]),
        pre,
      )
    }

    case 'supplies': {
      const rows = await db.select().from(supplies).orderBy(asc(supplies.sortOrder), asc(supplies.id))
      return toCsv(
        ['id', 'codigo', 'nombre', 'unidad', 'perecible', 'critico', 'activo', 'orden'],
        rows.map(r => [r.id, r.code, r.name, r.unit, r.perishable ? 1 : 0, r.critical ? 1 : 0, r.active === false ? 0 : 1, r.sortOrder]),
        pre,
      )
    }
  }
}

// Quiebres como intervalos: cada agotado abre uno y la siguiente habilitación lo
// cierra. Se recorren todos los eventos (pocos) para no perder un quiebre que empezó
// antes del rango ni cortar uno que terminó después; se devuelven los que se
// superponen con el rango.
async function stockoutIntervals(range: DateRange) {
  const events = await db.select({
    at: auditLog.at, localAt: localTs(auditLog.at), dishId: auditLog.entityId, data: auditLog.data, by: users.name,
  }).from(auditLog)
    .leftJoin(users, eq(auditLog.userId, users.id))
    .where(eq(auditLog.action, 'dish.availability'))
    .orderBy(asc(auditLog.at), asc(auditLog.id))

  type Interval = { dishId: number; dishName: string | null; startUtc: string; start: string; end: string | null; minutes: number | null; markedBy: string | null; restoredBy: string | null }
  const open = new Map<number, Interval>()
  const done: Interval[] = []
  for (const e of events) {
    if (e.dishId === null || !e.at || !e.localAt) continue
    const d = e.data ? JSON.parse(e.data) as { name?: string; available?: boolean } : {}
    const current = open.get(e.dishId)
    if (d.available === false && !current) {
      open.set(e.dishId, { dishId: e.dishId, dishName: d.name ?? null, startUtc: e.at, start: e.localAt, end: null, minutes: null, markedBy: e.by, restoredBy: null })
    } else if (d.available === true && current) {
      current.end = e.localAt
      current.minutes = Math.round((Date.parse(e.at.replace(' ', 'T') + 'Z') - Date.parse(current.startUtc.replace(' ', 'T') + 'Z')) / 60000)
      current.restoredBy = e.by
      done.push(current)
      open.delete(e.dishId)
    }
  }
  const from = `${range.from} 00:00:00`
  const to = `${range.to} 23:59:59`
  return [...done, ...open.values()]
    .filter(i => i.start <= to && (i.end === null || i.end >= from))
    .sort((a, b) => a.start.localeCompare(b.start) || a.dishId - b.dishId)
}
