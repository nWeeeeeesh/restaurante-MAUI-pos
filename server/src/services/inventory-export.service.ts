import { and, asc, eq, gte, lte, sql, type Column } from 'drizzle-orm'
import { db } from '../db'
import {
  auditLog, bills, categories, dailyParts, dayNotes, dishes, lostSales, orderItems, orders, otherSupplyCosts, studyConfig,
  supplies, supplyCounts, supplyPurchases, supplyTransfers, supplyWaste, users,
} from '../db/schema'
import { localDateString, parseDayBoundary, sqliteLocalOffset } from '../utils/dates'
import { roundMoney } from '../utils/math'
import { toCsv } from '../utils/csv'
import { currentLocalId } from '../utils/local'
import type { DateRange } from './inventory.service'
import type { ExportTable } from '../schemas/inventory'

// Export del instrumento de la tesis: docs/diccionario-datos-tesis.md (dataset v1).
// Las columnas y su orden quedan CONGELADOS el 2026-11-09 (inicio de la línea base);
// inventory.export.test.ts falla a propósito si cambian. Desde esa fecha, un cambio
// exige DATASET_VERSION = 'v2' y una versión nueva del diccionario.
export const DATASET_VERSION = 'v1'

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
    case 'daily':
      return toCsv(
        ['local_id', 'fecha', 'insumo_id', 'insumo_codigo', 'insumo', 'unidad', 'quedaba', 'botaste', 'compraste', 'precio_unitario', 'costo_total', 'proveedor',
          'enviaste', 'recibiste', 'modo_quedaba', 'modo_botaste', 'modo_compraste', 'modo_precio', 'apertura_por', 'apertura_en', 'compra_por', 'compra_en'],
        await dailyRows(range),
        pre,
      )

    case 'purchases': {
      const rows = await db.select({
        localId: supplyPurchases.localId, id: supplyPurchases.id, date: supplyPurchases.purchasedAt,
        supplyId: supplyPurchases.supplyId, code: supplies.code, name: supplies.name, unit: supplies.unit,
        quantity: supplyPurchases.quantity, total: supplyPurchases.totalCost, supplier: supplyPurchases.supplier,
        source: supplyPurchases.source, mode: supplyPurchases.entryMode, priceMode: supplyPurchases.priceEntryMode,
        notes: supplyPurchases.notes, by: users.name, at: localTs(supplyPurchases.createdAt),
      }).from(supplyPurchases)
        .innerJoin(supplies, eq(supplyPurchases.supplyId, supplies.id))
        .leftJoin(users, eq(supplyPurchases.createdBy, users.id))
        .where(and(gte(supplyPurchases.purchasedAt, range.from), lte(supplyPurchases.purchasedAt, range.to)))
        .orderBy(asc(supplyPurchases.purchasedAt), asc(supplyPurchases.id))
      return toCsv(
        ['local_id', 'id', 'fecha', 'insumo_id', 'insumo_codigo', 'insumo', 'unidad', 'cantidad', 'costo_total', 'costo_unitario', 'proveedor', 'origen', 'modo_entrada', 'modo_precio', 'notas', 'registrado_por', 'registrado_en'],
        rows.map(r => [r.localId, r.id, r.date, r.supplyId, r.code, r.name, r.unit, r2(r.quantity), r2(r.total),
          r.quantity > 0 ? r2(r.total / r.quantity) : null, r.supplier, r.source, r.mode, r.priceMode, r.notes, r.by, r.at]),
        pre,
      )
    }

    case 'waste': {
      const rows = await db.select({
        localId: supplyWaste.localId, id: supplyWaste.id, date: supplyWaste.wastedAt,
        supplyId: supplyWaste.supplyId, code: supplies.code, name: supplies.name, unit: supplies.unit,
        quantity: supplyWaste.quantity, reason: supplyWaste.reason, source: supplyWaste.source, mode: supplyWaste.entryMode,
        notes: supplyWaste.notes, by: users.name, at: localTs(supplyWaste.createdAt),
      }).from(supplyWaste)
        .innerJoin(supplies, eq(supplyWaste.supplyId, supplies.id))
        .leftJoin(users, eq(supplyWaste.createdBy, users.id))
        .where(and(gte(supplyWaste.wastedAt, range.from), lte(supplyWaste.wastedAt, range.to)))
        .orderBy(asc(supplyWaste.wastedAt), asc(supplyWaste.id))
      return toCsv(
        ['local_id', 'id', 'fecha', 'insumo_id', 'insumo_codigo', 'insumo', 'unidad', 'cantidad', 'motivo', 'origen', 'modo_entrada', 'notas', 'registrado_por', 'registrado_en'],
        rows.map(r => [r.localId, r.id, r.date, r.supplyId, r.code, r.name, r.unit, r2(r.quantity), r.reason, r.source, r.mode, r.notes, r.by, r.at]),
        pre,
      )
    }

    case 'counts': {
      const rows = await db.select({
        localId: supplyCounts.localId, date: supplyCounts.countedOn, moment: supplyCounts.moment,
        supplyId: supplyCounts.supplyId, code: supplies.code, name: supplies.name, unit: supplies.unit,
        quantity: supplyCounts.quantity, mode: supplyCounts.entryMode, by: users.name, at: localTs(supplyCounts.createdAt),
      }).from(supplyCounts)
        .innerJoin(supplies, eq(supplyCounts.supplyId, supplies.id))
        .leftJoin(users, eq(supplyCounts.createdBy, users.id))
        .where(and(gte(supplyCounts.countedOn, range.from), lte(supplyCounts.countedOn, range.to)))
        .orderBy(asc(supplyCounts.countedOn), asc(supplyCounts.moment), asc(supplies.sortOrder), asc(supplies.id))
      return toCsv(
        ['local_id', 'fecha', 'momento', 'insumo_id', 'insumo_codigo', 'insumo', 'unidad', 'cantidad', 'modo_entrada', 'registrado_por', 'registrado_en'],
        rows.map(r => [r.localId, r.date, r.moment, r.supplyId, r.code, r.name, r.unit, r2(r.quantity), r.mode, r.by, r.at]),
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
        ['local_id', 'plato_id', 'plato', 'inicio', 'fin', 'duracion_min', 'origen', 'marcado_por', 'habilitado_por'],
        (await stockoutIntervals(range)).map(i => [currentLocalId(), i.dishId, i.dishName, i.start, i.end, i.minutes, i.source, i.markedBy, i.restoredBy]),
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
        ['id', 'codigo', 'nombre', 'unidad', 'perecible', 'critico', 'activo', 'orden', 'grupo'],
        rows.map(r => [r.id, r.code, r.name, r.unit, r.perishable ? 1 : 0, r.critical ? 1 : 0, r.active === false ? 0 : 1, r.sortOrder, r.studyGroup]),
        pre,
      )
    }

    // La configuración completa, sin filtro de fechas: fija las fechas de activación
    case 'study_config': {
      const rows = await db.select({ key: studyConfig.key, value: studyConfig.value, by: users.name, at: localTs(studyConfig.updatedAt) })
        .from(studyConfig).leftJoin(users, eq(studyConfig.updatedBy, users.id))
        .orderBy(asc(studyConfig.key))
      return toCsv(['clave', 'valor', 'actualizado_por', 'actualizado_en'], rows.map(r => [r.key, r.value, r.by, r.at]), pre)
    }

    case 'daily_parts': {
      const rows = await db.select({
        localId: dailyParts.localId, id: dailyParts.id, date: dailyParts.date, part: dailyParts.part, by: users.name,
        at: localTs(dailyParts.completedAt), durationMs: dailyParts.durationMs, correction: dailyParts.isCorrection, version: dailyParts.clientVersion,
        noPurchase: dailyParts.noPurchase,
      }).from(dailyParts)
        .leftJoin(users, eq(dailyParts.completedBy, users.id))
        .where(and(gte(dailyParts.date, range.from), lte(dailyParts.date, range.to)))
        .orderBy(asc(dailyParts.date), asc(dailyParts.id))
      return toCsv(
        ['local_id', 'id', 'fecha', 'parte', 'registrado_por', 'registrado_en', 'duracion_ms', 'es_correccion', 'version_cliente', 'no_compro'],
        rows.map(r => [r.localId, r.id, r.date, r.part, r.by, r.at, r.durationMs, r.correction, r.version, r.noPurchase]),
        pre,
      )
    }

    case 'transfers': {
      const rows = await db.select({
        localId: supplyTransfers.localId, id: supplyTransfers.id, date: supplyTransfers.date,
        supplyId: supplyTransfers.supplyId, code: supplies.code, name: supplies.name, unit: supplies.unit,
        direction: supplyTransfers.direction, quantity: supplyTransfers.quantity, unitCost: supplyTransfers.unitCost,
        otherLocalId: supplyTransfers.otherLocalId, source: supplyTransfers.source, mode: supplyTransfers.entryMode,
        by: users.name, at: localTs(supplyTransfers.createdAt),
      }).from(supplyTransfers)
        .innerJoin(supplies, eq(supplyTransfers.supplyId, supplies.id))
        .leftJoin(users, eq(supplyTransfers.createdBy, users.id))
        .where(and(gte(supplyTransfers.date, range.from), lte(supplyTransfers.date, range.to)))
        .orderBy(asc(supplyTransfers.date), asc(supplyTransfers.id))
      return toCsv(
        ['local_id', 'id', 'fecha', 'insumo_id', 'insumo_codigo', 'insumo', 'unidad', 'direccion', 'cantidad', 'costo_unitario', 'otro_local_id', 'origen', 'modo_entrada', 'registrado_por', 'registrado_en'],
        rows.map(r => [r.localId, r.id, r.date, r.supplyId, r.code, r.name, r.unit, r.direction, r2(r.quantity), r2(r.unitCost), r.otherLocalId, r.source, r.mode, r.by, r.at]),
        pre,
      )
    }

    case 'other_costs': {
      const rows = await db.select({
        localId: otherSupplyCosts.localId, id: otherSupplyCosts.id, date: otherSupplyCosts.date, amount: otherSupplyCosts.amount,
        source: otherSupplyCosts.source, mode: otherSupplyCosts.entryMode, by: users.name, at: localTs(otherSupplyCosts.createdAt),
      }).from(otherSupplyCosts)
        .leftJoin(users, eq(otherSupplyCosts.createdBy, users.id))
        .where(and(gte(otherSupplyCosts.date, range.from), lte(otherSupplyCosts.date, range.to)))
        .orderBy(asc(otherSupplyCosts.date), asc(otherSupplyCosts.id))
      return toCsv(
        ['local_id', 'id', 'fecha', 'monto', 'origen', 'modo_entrada', 'registrado_por', 'registrado_en'],
        rows.map(r => [r.localId, r.id, r.date, r2(r.amount), r.source, r.mode, r.by, r.at]),
        pre,
      )
    }

    // Una fila por ítem cobrado (con boleta), en la fecha y hora local del cobro. Lo no
    // cobrado nunca fue venta y no aparece. En la v1.1 no hay anulación de boletas: lo
    // cobrado de un pedido que después se canceló sale con anulado = 1 para que el
    // análisis decida (el dinero sí entró).
    case 'sales': {
      const rows = await db.select({
        at: localTs(bills.paidAt), billId: bills.id, dishId: orderItems.dishId, dishName: orderItems.dishName,
        categoryId: dishes.categoryId, category: categories.name, quantity: orderItems.quantity,
        unitPrice: orderItems.unitPrice, status: orders.status,
      }).from(orderItems)
        .innerJoin(bills, eq(orderItems.billId, bills.id))
        .leftJoin(orders, eq(orderItems.orderId, orders.id))
        .leftJoin(dishes, eq(orderItems.dishId, dishes.id))
        .leftJoin(categories, eq(dishes.categoryId, categories.id))
        .where(and(gte(bills.paidAt, utcFrom), lte(bills.paidAt, utcTo)))
        .orderBy(asc(bills.paidAt), asc(bills.id), asc(orderItems.id))
      const local = currentLocalId()
      return toCsv(
        ['local_id', 'fecha', 'hora', 'boleta_id', 'plato_id', 'plato', 'categoria_id', 'categoria', 'cantidad', 'precio_unitario', 'total', 'anulado'],
        rows.map(r => {
          const qty = r.quantity ?? 1
          return [local, r.at?.slice(0, 10), r.at?.slice(11, 16), r.billId, r.dishId, r.dishName, r.categoryId, r.category,
            qty, r2(r.unitPrice), r2(r.unitPrice * qty), r.status === 'cancelled' ? 1 : 0]
        }),
        pre,
      )
    }
  }
}

// Vista por día e insumo de lo que dejó la «Compra del día», con quién hizo cada
// parte (el primer guardado; las correcciones están en daily_parts)
async function dailyRows(range: DateRange) {
  const inRange = (col: Column) => and(gte(col, range.from), lte(col, range.to))
  const counts = await db.select().from(supplyCounts).where(and(eq(supplyCounts.moment, 'apertura'), inRange(supplyCounts.countedOn)))
  const purchases = await db.select().from(supplyPurchases).where(and(eq(supplyPurchases.source, 'daily'), inRange(supplyPurchases.sourceDate)))
  const waste = await db.select().from(supplyWaste).where(and(eq(supplyWaste.source, 'daily'), inRange(supplyWaste.sourceDate)))
  const transfers = await db.select().from(supplyTransfers).where(and(eq(supplyTransfers.source, 'daily'), inRange(supplyTransfers.date)))
  const parts = await db.select({ date: dailyParts.date, part: dailyParts.part, by: users.name, at: localTs(dailyParts.completedAt) })
    .from(dailyParts).leftJoin(users, eq(dailyParts.completedBy, users.id))
    .where(inRange(dailyParts.date)).orderBy(asc(dailyParts.id))
  const catalog = await db.select().from(supplies)

  type Row = {
    date: string; supplyId: number; localId: number; opening: number | null; wasted: number; purchased: number; total: number
    hasPurchase: boolean; supplier: string | null; sent: number; received: number
    openingMode: string | null; wastedMode: string | null; purchasedMode: string | null; priceMode: string | null
  }
  const rows = new Map<string, Row>()
  const row = (date: string, supplyId: number, localId: number) => {
    const key = `${date}|${supplyId}|${localId}`
    if (!rows.has(key)) {
      rows.set(key, {
        date, supplyId, localId, opening: null, wasted: 0, purchased: 0, total: 0, hasPurchase: false, supplier: null,
        sent: 0, received: 0, openingMode: null, wastedMode: null, purchasedMode: null, priceMode: null,
      })
    }
    return rows.get(key)!
  }
  for (const c of counts) {
    const r = row(c.countedOn, c.supplyId, c.localId)
    r.opening = c.quantity
    r.openingMode = c.entryMode
  }
  for (const w of waste) {
    const r = row(w.sourceDate!, w.supplyId, w.localId)
    r.wasted += w.quantity
    r.wastedMode = r.wastedMode ?? w.entryMode
  }
  for (const p of purchases) {
    const r = row(p.sourceDate!, p.supplyId, p.localId)
    r.purchased += p.quantity
    r.total += p.totalCost
    r.hasPurchase = true
    r.supplier = r.supplier ?? p.supplier
    r.purchasedMode = r.purchasedMode ?? p.entryMode
    r.priceMode = r.priceMode ?? p.priceEntryMode
  }
  for (const t of transfers) {
    const r = row(t.date, t.supplyId, t.localId)
    if (t.direction === 'envio') r.sent += t.quantity
    else r.received += t.quantity
  }
  const firstPart = (date: string, part: string) => parts.find(p => p.date === date && p.part === part)
  const supply = (id: number) => catalog.find(s => s.id === id)
  return [...rows.values()]
    .sort((a, b) => a.date.localeCompare(b.date)
      || (supply(a.supplyId)?.sortOrder ?? 0) - (supply(b.supplyId)?.sortOrder ?? 0)
      || a.supplyId - b.supplyId)
    .map(r => {
      const s = supply(r.supplyId)
      const a = firstPart(r.date, 'apertura')
      const c = firstPart(r.date, 'compra')
      return [r.localId, r.date, r.supplyId, s?.code, s?.name, s?.unit, r2(r.opening), r2(r.wasted), r2(r.purchased),
        r.hasPurchase && r.purchased > 0 ? r2(r.total / r.purchased) : null, r.hasPurchase ? r2(r.total) : null, r.supplier,
        r2(r.sent), r2(r.received), r.openingMode, r.wastedMode, r.purchasedMode, r.priceMode,
        a?.by ?? null, a?.at ?? null, c?.by ?? null, c?.at ?? null]
    })
}

// Quiebres como intervalos: cada agotado abre uno y la siguiente habilitación lo
// cierra. Se recorren todos los eventos (pocos) para no perder un quiebre que empezó
// antes del rango ni cortar uno que terminó después; se devuelven los que se
// superponen con el rango. `origen` dice quién lo decidió: 'manual' (una persona) o,
// en la fase 2, 'propuesta_confirmada'.
async function stockoutIntervals(range: DateRange) {
  const events = await db.select({
    at: auditLog.at, localAt: localTs(auditLog.at), dishId: auditLog.entityId, data: auditLog.data, by: users.name,
  }).from(auditLog)
    .leftJoin(users, eq(auditLog.userId, users.id))
    .where(eq(auditLog.action, 'dish.availability'))
    .orderBy(asc(auditLog.at), asc(auditLog.id))

  type Interval = {
    dishId: number; dishName: string | null; startUtc: string; start: string; end: string | null; minutes: number | null
    source: string; markedBy: string | null; restoredBy: string | null
  }
  const open = new Map<number, Interval>()
  const done: Interval[] = []
  for (const e of events) {
    if (e.dishId === null || !e.at || !e.localAt) continue
    const d = e.data ? JSON.parse(e.data) as { name?: string; available?: boolean; source?: string } : {}
    const current = open.get(e.dishId)
    if (d.available === false && !current) {
      open.set(e.dishId, {
        dishId: e.dishId, dishName: d.name ?? null, startUtc: e.at, start: e.localAt, end: null, minutes: null,
        // Los eventos anteriores a la v3 no guardaban origen: todos fueron manuales
        source: d.source ?? 'manual', markedBy: e.by, restoredBy: null,
      })
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
