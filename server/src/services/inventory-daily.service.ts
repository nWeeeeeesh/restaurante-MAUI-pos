import { and, asc, desc, eq, gte, inArray, isNotNull, lt, lte, sql } from 'drizzle-orm'
import { db, type Executor } from '../db'
import {
  bills, dailyParts, dayNotes, otherSupplyCosts, supplies, supplyCounts, supplyPurchases, supplyTransfers, supplyWaste, users,
} from '../db/schema'
import { withWriteLock } from '../db/write-lock'
import { DomainError } from '../errors'
import { audit } from './audit'
import { readSettings } from './settings.service'
import { addDays, localDateString, parseDayBoundary, sqliteLocalOffset } from '../utils/dates'
import { roundMoney } from '../utils/math'
import { currentLocalId, otherLocalId } from '../utils/local'
import { transfersEnabled } from '../domain/settings'
import type { SaveDailyInput } from '../schemas/inventory'

// «Compra del día» (plan v3 §2.2): la única rutina obligatoria de la tesis, en dos
// partes que se guardan por separado.
//   A «Al abrir»: quedaba (obligatorio) y botaste por insumo crítico, y notas del día.
//   B «Al volver de comprar»: compras con precio, proveedor, otros insumos y traslados.
// RD01: nada del pronóstico pasa por aquí; la respuesta es la misma con o sin
// pronósticos. Definiciones en docs/diccionario-datos-tesis.md.

type Part = 'apertura' | 'compra'

// Se puede registrar hasta 7 días atrás por si se olvidó un día; más atrás se corrige
// desde el Historial (con motivo).
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

// Lo que cada parte de la «Compra del día» de una fecha dejó escrito en este local
async function aperturaRows(ex: Executor, date: string) {
  const local = currentLocalId()
  return {
    counts: await ex.select().from(supplyCounts).where(and(
      eq(supplyCounts.countedOn, date), eq(supplyCounts.moment, 'apertura'), eq(supplyCounts.localId, local))),
    waste: await ex.select().from(supplyWaste).where(and(
      eq(supplyWaste.source, 'daily'), eq(supplyWaste.sourceDate, date), eq(supplyWaste.localId, local))),
    notes: await ex.select().from(dayNotes).where(and(eq(dayNotes.date, date), eq(dayNotes.localId, local))).orderBy(asc(dayNotes.id)),
  }
}

async function compraRows(ex: Executor, date: string) {
  const local = currentLocalId()
  return {
    purchases: await ex.select().from(supplyPurchases).where(and(
      eq(supplyPurchases.source, 'daily'), eq(supplyPurchases.sourceDate, date), eq(supplyPurchases.localId, local))),
    transfers: await ex.select().from(supplyTransfers).where(and(
      eq(supplyTransfers.source, 'daily'), eq(supplyTransfers.date, date), eq(supplyTransfers.localId, local))),
    other: await ex.select().from(otherSupplyCosts).where(and(
      eq(otherSupplyCosts.source, 'daily'), eq(otherSupplyCosts.date, date), eq(otherSupplyCosts.localId, local))),
  }
}

const bySupply = <T extends { supplyId: number }>(rows: T[]) => [...rows].sort((a, b) => a.supplyId - b.supplyId)

// Forma comparable de lo que una parte dejó escrito (para audit_log)
function aperturaSnapshot(r: Awaited<ReturnType<typeof aperturaRows>>) {
  return {
    counts: bySupply(r.counts).map(c => ({ supplyId: c.supplyId, quantity: c.quantity, mode: c.entryMode })),
    waste: bySupply(r.waste).map(w => ({ supplyId: w.supplyId, quantity: w.quantity, mode: w.entryMode, wastedAt: w.wastedAt })),
    notes: r.notes.map(n => ({ kind: n.kind, text: n.text })),
  }
}

function compraSnapshot(r: Awaited<ReturnType<typeof compraRows>>) {
  return {
    purchases: bySupply(r.purchases).map(p => ({
      supplyId: p.supplyId, quantity: p.quantity, totalCost: p.totalCost, supplier: p.supplier, mode: p.entryMode, priceMode: p.priceEntryMode,
    })),
    transfers: bySupply(r.transfers).map(t => ({ supplyId: t.supplyId, direction: t.direction, quantity: t.quantity, unitCost: t.unitCost, mode: t.entryMode })),
    other: r.other.map(o => ({ amount: o.amount, mode: o.entryMode })),
  }
}

// Referencia para [Usar] en «Compraste»: lo comprado el mismo día de la semana
// anterior; si no hubo, la última compra. Precio: el de la última compra. Proveedor:
// el último usado. Nunca se prellena: el dueño la confirma con un toque.
async function purchaseReference(ex: Executor, supplyId: number, date: string) {
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
    fromDate: fromLastWeek ? addDays(date, -7) : last?.purchasedAt ?? null,
    unitPrice: last && last.quantity > 0 ? roundMoney(last.totalCost / last.quantity) : null,
    supplier: lastSupplier?.supplier ?? null,
  }
}

// Referencia para [Usar] en «Otros insumos»: el mismo día de la semana anterior o el último
async function otherCostReference(ex: Executor, date: string) {
  const local = currentLocalId()
  const [lastWeek] = await ex.select().from(otherSupplyCosts)
    .where(and(eq(otherSupplyCosts.date, addDays(date, -7)), eq(otherSupplyCosts.localId, local)))
  if (lastWeek) return { amount: lastWeek.amount, fromDate: lastWeek.date }
  const [last] = await ex.select().from(otherSupplyCosts)
    .where(and(lt(otherSupplyCosts.date, date), eq(otherSupplyCosts.localId, local)))
    .orderBy(desc(otherSupplyCosts.date)).limit(1)
  return last ? { amount: last.amount, fromDate: last.date } : null
}

// Quién guardó cada parte y cuándo (el primer guardado), cuántas correcciones tuvo y
// si el último guardado de la compra fue «Hoy no compré»
async function partStatus(ex: Executor, date: string, part: Part) {
  const rows = await ex.select({ by: users.name, at: dailyParts.completedAt, durationMs: dailyParts.durationMs, noPurchase: dailyParts.noPurchase })
    .from(dailyParts).leftJoin(users, eq(dailyParts.completedBy, users.id))
    .where(and(eq(dailyParts.date, date), eq(dailyParts.localId, currentLocalId()), eq(dailyParts.part, part)))
    .orderBy(asc(dailyParts.id))
  if (rows.length === 0) return null
  const last = rows[rows.length - 1]
  return { by: rows[0].by, at: rows[0].at, corrections: rows.length - 1, lastAt: last.at, noPurchase: last.noPurchase }
}

export async function getDaily(date: string) {
  const a = await aperturaRows(db, date)
  const c = await compraRows(db, date)
  const settings = await readSettings(db)
  const compraStatus = await partStatus(db, date, 'compra')
  const noPurchase = compraStatus?.noPurchase === true
  const touched = new Set([...a.counts, ...a.waste, ...c.purchases, ...c.transfers].map(r => r.supplyId))
  // Los críticos activos, más cualquier insumo que ya tenga datos ese día
  const list = (await db.select().from(supplies).orderBy(asc(supplies.sortOrder), asc(supplies.name)))
    .filter(s => (s.critical && s.active !== false) || touched.has(s.id))

  const items = []
  for (const s of list) {
    const count = a.counts.find(x => x.supplyId === s.id)
    const waste = a.waste.filter(x => x.supplyId === s.id)
    const purchases = c.purchases.filter(x => x.supplyId === s.id)
    const transfers = c.transfers.filter(x => x.supplyId === s.id)
    const purchased = purchases.reduce((t, p) => t + p.quantity, 0)
    const totalCost = purchases.reduce((t, p) => t + p.totalCost, 0)
    items.push({
      supplyId: s.id,
      code: s.code,
      name: s.name,
      unit: s.unit,
      opening: count?.quantity ?? null,
      openingMode: count?.entryMode ?? null,
      wasted: waste.reduce((t, w) => t + w.quantity, 0),
      wastedMode: waste[0]?.entryMode ?? null,
      purchased,
      // «Hoy no compré»: cada crítico queda en 0 sin tocar
      purchasedMode: purchases[0]?.entryMode ?? (noPurchase ? 'default' : null),
      unitPrice: purchased > 0 ? roundMoney(totalCost / purchased) : null,
      priceMode: purchases[0]?.priceEntryMode ?? null,
      totalCost: purchases.length > 0 ? roundMoney(totalCost) : null,
      supplier: purchases.find(p => p.supplier)?.supplier ?? null,
      transfer: transfers.reduce((t, x) => t + x.quantity, 0),
      transferMode: transfers[0]?.entryMode ?? null,
      transferUnitCost: transfers[0]?.unitCost ?? null,
      reference: await purchaseReference(db, s.id, date),
    })
  }

  return {
    date,
    minDate: addDays(localDateString(), -DAILY_MAX_DAYS_BACK),
    wasteDate: await previousOperativeDay(db, date),
    parts: { apertura: await partStatus(db, date, 'apertura'), compra: compraStatus },
    transfers: { enabled: transfersEnabled(settings, date), direction: currentLocalId() === 1 ? 'envio' : 'recepcion' },
    items,
    otherCost: c.other[0] ? { amount: c.other[0].amount, mode: c.other[0].entryMode } : null,
    otherCostReference: await otherCostReference(db, date),
    notes: a.notes.map(n => ({ id: n.id, kind: n.kind, text: n.text })),
  }
}

// Una transacción por fecha y parte. Cada parte reemplaza solo lo que ella misma creó
// (source='daily'), así guardar una no borra la otra. Las compras y mermas manuales no
// se tocan. Cada guardado deja una fila en daily_parts y audit_log; volver a guardar
// es una corrección (is_correction) y no pide motivo (cero sensación de tarea).
export async function saveDaily(input: SaveDailyInput, userId: number) {
  const date = input.date ?? localDateString()
  assertInWindow(date)
  const local = currentLocalId()

  await withWriteLock(() => db.transaction(async (tx) => {
    const ids = input.items.map(i => i.supplyId)
    const found = ids.length ? await tx.select().from(supplies).where(inArray(supplies.id, ids)) : []
    for (const id of ids) {
      const s = found.find(f => f.id === id)
      if (!s) throw new DomainError('Insumo no encontrado', 404, 'SUPPLY_NOT_FOUND')
      if (s.active === false) throw new DomainError(`"${s.name}" está desactivado`, 409, 'SUPPLY_INACTIVE')
    }

    const previous = await tx.select({ id: dailyParts.id }).from(dailyParts)
      .where(and(eq(dailyParts.date, date), eq(dailyParts.localId, local), eq(dailyParts.part, input.part))).limit(1)
    const isCorrection = previous.length > 0
    let before: unknown
    let after: unknown

    if (input.part === 'apertura') {
      // «Quedaba» es obligatorio para todos los críticos activos: sin él no hay consumo real
      const critical = await tx.select().from(supplies).where(and(eq(supplies.critical, true), eq(supplies.active, true)))
      const missing = critical.filter(s => !ids.includes(s.id))
      if (missing.length > 0) {
        throw new DomainError(`Falta lo que quedaba de: ${missing.map(s => s.name).join(', ')}`, 400, 'DAILY_INCOMPLETE')
      }
      before = aperturaSnapshot(await aperturaRows(tx, date))
      const wasteDate = await previousOperativeDay(tx, date)

      await tx.delete(supplyCounts).where(and(eq(supplyCounts.countedOn, date), eq(supplyCounts.moment, 'apertura'), eq(supplyCounts.localId, local)))
      await tx.delete(supplyWaste).where(and(eq(supplyWaste.source, 'daily'), eq(supplyWaste.sourceDate, date), eq(supplyWaste.localId, local)))
      for (const item of input.items) {
        await tx.insert(supplyCounts).values({
          supplyId: item.supplyId, quantity: item.opening, countedOn: date, moment: 'apertura',
          entryMode: item.openingMode ?? 'typed', localId: local, createdBy: userId,
        })
        // Botaste se guarda también en 0: distingue "no boté nada" (typed) de "no lo
        // toqué" (default) para medir la constancia del registro
        await tx.insert(supplyWaste).values({
          supplyId: item.supplyId, quantity: item.wasted ?? 0, reason: 'deterioro', wastedAt: wasteDate,
          source: 'daily', sourceDate: date, localId: local, createdBy: userId,
          entryMode: item.wastedMode ?? (item.wasted === undefined ? 'default' : 'typed'),
        })
      }
      // Sin `notes` en el cuerpo, las del día quedan como estaban
      if (input.notes) {
        await tx.delete(dayNotes).where(and(eq(dayNotes.date, date), eq(dayNotes.localId, local)))
        if (input.notes.length > 0) {
          await tx.insert(dayNotes).values(input.notes.map(n => ({ date, kind: n.kind, text: n.text || null, localId: local, createdBy: userId })))
        }
      }
      after = aperturaSnapshot(await aperturaRows(tx, date))
    } else {
      // Los traslados existen desde la apertura del segundo local; cada local registra
      // solo su lado: el principal envía y el segundo recibe
      if (input.noPurchase && (input.items.some(i => (i.purchased ?? 0) > 0) || (input.otherCost?.amount ?? 0) > 0)) {
        throw new DomainError('«Hoy no compré» no puede llevar compras', 400, 'NO_PURCHASE_CONFLICT')
      }
      const enabled = transfersEnabled(await readSettings(tx), date)
      if (!enabled && input.items.some(i => (i.transfer ?? 0) > 0)) {
        throw new DomainError('Los traslados se habilitan con la apertura del segundo local', 400, 'TRANSFERS_NOT_ENABLED')
      }
      before = compraSnapshot(await compraRows(tx, date))

      await tx.delete(supplyPurchases).where(and(eq(supplyPurchases.source, 'daily'), eq(supplyPurchases.sourceDate, date), eq(supplyPurchases.localId, local)))
      await tx.delete(supplyTransfers).where(and(eq(supplyTransfers.source, 'daily'), eq(supplyTransfers.date, date), eq(supplyTransfers.localId, local)))
      await tx.delete(otherSupplyCosts).where(and(eq(otherSupplyCosts.source, 'daily'), eq(otherSupplyCosts.date, date), eq(otherSupplyCosts.localId, local)))

      const direction = local === 1 ? 'envio' : 'recepcion'
      for (const item of input.items) {
        if (item.purchased && item.purchased > 0) {
          // El total escrito manda; si no hay, cantidad × precio
          const total = item.totalCost !== null && item.totalCost !== undefined
            ? item.totalCost
            : item.purchased * (item.unitPrice ?? 0)
          await tx.insert(supplyPurchases).values({
            supplyId: item.supplyId, quantity: item.purchased, totalCost: roundMoney(total), purchasedAt: date,
            supplier: item.supplier || null, source: 'daily', sourceDate: date, localId: local, createdBy: userId,
            entryMode: item.purchasedMode ?? 'typed', priceEntryMode: item.priceMode ?? 'typed',
          })
        }
        if (item.transfer && item.transfer > 0) {
          await tx.insert(supplyTransfers).values({
            date, supplyId: item.supplyId, direction, quantity: item.transfer,
            // El costo solo tiene sentido en quien recibe (opcional)
            unitCost: direction === 'recepcion' ? item.transferUnitCost ?? null : null,
            otherLocalId: otherLocalId(local), localId: local, source: 'daily',
            entryMode: item.transferMode ?? 'typed', createdBy: userId,
          })
        }
      }
      if (input.otherCost) {
        await tx.insert(otherSupplyCosts).values({
          date, amount: roundMoney(input.otherCost.amount), localId: local, source: 'daily',
          entryMode: input.otherCost.mode ?? 'typed', createdBy: userId,
        })
      }
      after = compraSnapshot(await compraRows(tx, date))
    }

    await tx.insert(dailyParts).values({
      date, localId: local, part: input.part, completedBy: userId,
      durationMs: input.durationMs ?? null, isCorrection, clientVersion: input.clientVersion ?? null,
      noPurchase: input.part === 'compra' && input.noPurchase === true,
    })
    await audit(tx, {
      userId, action: isCorrection ? 'daily.update' : 'daily.save', entity: 'daily', entityId: null,
      data: { date, part: input.part, before, after },
    })
  }))

  return getDaily(date)
}

// Indicador discreto del Layout: ayer hubo ventas y falta alguna parte
export async function dailyPending() {
  const date = addDays(localDateString(), -1)
  const missing = {
    apertura: (await partStatus(db, date, 'apertura')) === null,
    compra: (await partStatus(db, date, 'compra')) === null,
  }
  const pending = (missing.apertura || missing.compra) && (await isOperativeDay(db, date))
  return { date, pending, missing }
}
