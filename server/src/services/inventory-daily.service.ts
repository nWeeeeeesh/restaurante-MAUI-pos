import { and, asc, desc, eq, gte, inArray, isNotNull, lt, lte, sql } from 'drizzle-orm'
import { db, type Executor } from '../db'
import { bills, dayNotes, supplies, supplyCounts, supplyPurchases, supplyWaste } from '../db/schema'
import { withWriteLock } from '../db/write-lock'
import { DomainError } from '../errors'
import { audit } from './audit'
import { addDays, localDateString, parseDayBoundary, sqliteLocalOffset } from '../utils/dates'
import { roundMoney } from '../utils/math'
import type { SaveDailyInput } from '../schemas/inventory'

// «Compra del día» (plan v2 §2.2): la única interacción diaria obligatoria de la
// tesis. El dueño, al volver de comprar, confirma por cada insumo crítico cuánto
// quedaba, cuánto botó y cuánto compró. Definiciones en docs/diccionario-datos-tesis.md.

// Se puede registrar hasta 7 días atrás por si se olvidó un día; más atrás se corrige
// desde las pestañas de detalle (con motivo).
export const DAILY_MAX_DAYS_BACK = 7

function assertInWindow(date: string) {
  const today = localDateString()
  if (date > today || date < addDays(today, -DAILY_MAX_DAYS_BACK)) {
    throw new DomainError(`Solo se puede registrar desde hace ${DAILY_MAX_DAYS_BACK} días hasta hoy`, 400, 'DATE_OUT_OF_RANGE')
  }
}

// Día operativo = fecha local con ventas. Lo que se bota en la mañana se deterioró
// en el periodo anterior, por eso la merma se imputa al último día con ventas; si no
// hay ninguno (primer día), al día calendario anterior.
export async function previousOperativeDay(ex: Executor, date: string): Promise<string> {
  const [row] = await ex.select({ day: sql<string | null>`max(date(${bills.paidAt}, ${sqliteLocalOffset()}))` })
    .from(bills)
    .where(lt(bills.paidAt, parseDayBoundary(date, 'start')))
  return row?.day ?? addDays(date, -1)
}

async function isOperativeDay(ex: Executor, date: string) {
  const [row] = await ex.select({ id: bills.id }).from(bills)
    .where(and(gte(bills.paidAt, parseDayBoundary(date, 'start')), lte(bills.paidAt, parseDayBoundary(date, 'end'))))
    .limit(1)
  return row !== undefined
}

// Lo que la «Compra del día» de una fecha dejó escrito
async function dailyRows(ex: Executor, date: string) {
  const counts = await ex.select().from(supplyCounts)
    .where(and(eq(supplyCounts.countedOn, date), eq(supplyCounts.moment, 'apertura')))
  const purchases = await ex.select().from(supplyPurchases)
    .where(and(eq(supplyPurchases.source, 'daily'), eq(supplyPurchases.sourceDate, date)))
  const waste = await ex.select().from(supplyWaste)
    .where(and(eq(supplyWaste.source, 'daily'), eq(supplyWaste.sourceDate, date)))
  const notes = await ex.select().from(dayNotes).where(eq(dayNotes.date, date)).orderBy(asc(dayNotes.id))
  return { counts, purchases, waste, notes }
}

type DailyRows = Awaited<ReturnType<typeof dailyRows>>

const hasData = (r: DailyRows) => r.counts.length + r.purchases.length + r.waste.length + r.notes.length > 0

// Forma comparable para saber si volver a guardar cambió algo (y auditarlo)
function snapshot(r: DailyRows) {
  const bySupply = <T extends { supplyId: number }>(rows: T[]) => [...rows].sort((a, b) => a.supplyId - b.supplyId)
  return {
    counts: bySupply(r.counts).map(c => ({ supplyId: c.supplyId, quantity: c.quantity })),
    purchases: bySupply(r.purchases).map(p => ({ supplyId: p.supplyId, quantity: p.quantity, totalCost: p.totalCost, supplier: p.supplier })),
    waste: bySupply(r.waste).map(w => ({ supplyId: w.supplyId, quantity: w.quantity, wastedAt: w.wastedAt })),
    notes: r.notes.map(n => ({ kind: n.kind, text: n.text })),
  }
}

// Sugerencia para «Compraste»: lo comprado el mismo día de la semana anterior; si no
// hubo, la última compra. Precio: el de la última compra. Proveedor: el último usado.
// La cantidad NO se prellena (v2.1): el dueño la confirma con [Usar] para que cada
// compra registrada sea una compra real.
async function suggestion(ex: Executor, supplyId: number, date: string) {
  const [lastWeek] = await ex.select({ qty: sql<number | null>`sum(${supplyPurchases.quantity})` })
    .from(supplyPurchases)
    .where(and(eq(supplyPurchases.supplyId, supplyId), eq(supplyPurchases.purchasedAt, addDays(date, -7))))
  const [last] = await ex.select().from(supplyPurchases)
    .where(and(eq(supplyPurchases.supplyId, supplyId), lt(supplyPurchases.purchasedAt, date)))
    .orderBy(desc(supplyPurchases.purchasedAt), desc(supplyPurchases.id))
    .limit(1)
  const [lastSupplier] = await ex.select({ supplier: supplyPurchases.supplier }).from(supplyPurchases)
    .where(and(eq(supplyPurchases.supplyId, supplyId), lt(supplyPurchases.purchasedAt, date), isNotNull(supplyPurchases.supplier)))
    .orderBy(desc(supplyPurchases.purchasedAt), desc(supplyPurchases.id))
    .limit(1)
  const fromLastWeek = !!lastWeek?.qty
  return {
    purchased: fromLastWeek ? lastWeek.qty : last?.quantity ?? null,
    // La pantalla la muestra como "El mar 7 oct: 2 kg [Usar]"; no se guarda sola
    fromDate: fromLastWeek ? addDays(date, -7) : last?.purchasedAt ?? null,
    unitPrice: last && last.quantity > 0 ? roundMoney(last.totalCost / last.quantity) : null,
    supplier: lastSupplier?.supplier ?? null,
  }
}

export async function getDaily(date: string) {
  const rows = await dailyRows(db, date)
  const touched = new Set([...rows.counts, ...rows.purchases, ...rows.waste].map(r => r.supplyId))
  // Los críticos activos, más cualquier insumo que ya tenga datos ese día
  const list = (await db.select().from(supplies).orderBy(asc(supplies.sortOrder), asc(supplies.name)))
    .filter(s => (s.critical && s.active !== false) || touched.has(s.id))

  const items = []
  for (const s of list) {
    const purchases = rows.purchases.filter(p => p.supplyId === s.id)
    const purchased = purchases.reduce((t, p) => t + p.quantity, 0)
    const totalCost = purchases.reduce((t, p) => t + p.totalCost, 0)
    items.push({
      supplyId: s.id,
      code: s.code,
      name: s.name,
      unit: s.unit,
      opening: rows.counts.find(c => c.supplyId === s.id)?.quantity ?? null,
      wasted: rows.waste.filter(w => w.supplyId === s.id).reduce((t, w) => t + w.quantity, 0),
      purchased,
      unitPrice: purchased > 0 ? roundMoney(totalCost / purchased) : null,
      totalCost: purchases.length > 0 ? roundMoney(totalCost) : null,
      supplier: purchases.find(p => p.supplier)?.supplier ?? null,
      suggestion: await suggestion(db, s.id, date),
    })
  }

  return {
    date,
    minDate: addDays(localDateString(), -DAILY_MAX_DAYS_BACK),
    saved: hasData(rows),
    wasteDate: await previousOperativeDay(db, date),
    items,
    notes: rows.notes.map(n => ({ id: n.id, kind: n.kind, text: n.text })),
  }
}

// Una transacción por fecha. Reemplaza solo lo que esta pantalla creó ese día
// (source='daily'): las compras y mermas manuales no se tocan. Volver a guardar con
// cambios queda en audit_log con lo anterior, sin pedir motivo (cero sensación de tarea).
export async function saveDaily(input: SaveDailyInput, userId: number) {
  const date = input.date ?? localDateString()
  assertInWindow(date)

  await withWriteLock(() => db.transaction(async (tx) => {
    const ids = input.items.map(i => i.supplyId)
    const found = ids.length ? await tx.select().from(supplies).where(inArray(supplies.id, ids)) : []
    for (const id of ids) {
      const s = found.find(f => f.id === id)
      if (!s) throw new DomainError('Insumo no encontrado', 404, 'SUPPLY_NOT_FOUND')
      if (s.active === false) throw new DomainError(`"${s.name}" está desactivado`, 409, 'SUPPLY_INACTIVE')
    }

    const before = await dailyRows(tx, date)
    const wasteDate = await previousOperativeDay(tx, date)

    await tx.delete(supplyPurchases).where(and(eq(supplyPurchases.source, 'daily'), eq(supplyPurchases.sourceDate, date)))
    await tx.delete(supplyWaste).where(and(eq(supplyWaste.source, 'daily'), eq(supplyWaste.sourceDate, date)))

    for (const item of input.items) {
      const [count] = before.counts.filter(c => c.supplyId === item.supplyId)
      const opening = item.opening ?? null
      if (opening === null) {
        if (count) await tx.delete(supplyCounts).where(eq(supplyCounts.id, count.id))
      } else if (count) {
        await tx.update(supplyCounts).set({ quantity: opening, createdBy: userId }).where(eq(supplyCounts.id, count.id))
      } else {
        await tx.insert(supplyCounts).values({ supplyId: item.supplyId, quantity: opening, countedOn: date, moment: 'apertura', createdBy: userId })
      }

      if (item.wasted && item.wasted > 0) {
        await tx.insert(supplyWaste).values({
          supplyId: item.supplyId, quantity: item.wasted, reason: 'deterioro', wastedAt: wasteDate,
          source: 'daily', sourceDate: date, createdBy: userId,
        })
      }

      if (item.purchased && item.purchased > 0) {
        // El total escrito manda; si no hay, cantidad × precio
        const total = item.totalCost !== null && item.totalCost !== undefined
          ? item.totalCost
          : item.purchased * (item.unitPrice ?? 0)
        await tx.insert(supplyPurchases).values({
          supplyId: item.supplyId, quantity: item.purchased, totalCost: roundMoney(total), purchasedAt: date,
          supplier: item.supplier || null, source: 'daily', sourceDate: date, createdBy: userId,
        })
      }
    }

    // Sin `notes` en el cuerpo, las del día quedan como estaban
    if (input.notes) {
      await tx.delete(dayNotes).where(eq(dayNotes.date, date))
      if (input.notes.length > 0) {
        await tx.insert(dayNotes).values(input.notes.map(n => ({ date, kind: n.kind, text: n.text || null, createdBy: userId })))
      }
    }

    if (hasData(before)) {
      const prev = snapshot(before)
      const next = snapshot(await dailyRows(tx, date))
      if (JSON.stringify(prev) !== JSON.stringify(next)) {
        await audit(tx, { userId, action: 'daily.update', entity: 'daily', entityId: null, data: { date, before: prev, after: next } })
      }
    }
  }))

  return getDaily(date)
}

// Indicador discreto del Layout: ayer hubo ventas y no hay «Compra del día»
export async function dailyPending() {
  const date = addDays(localDateString(), -1)
  const pending = (await isOperativeDay(db, date)) && !hasData(await dailyRows(db, date))
  return { date, pending }
}
