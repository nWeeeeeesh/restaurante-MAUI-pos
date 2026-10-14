import { and, asc, desc, eq, gte, lte, sql } from 'drizzle-orm'
import { db, type Executor } from '../db'
import { dishes, lostSales, supplies, supplyCounts, supplyPurchases, supplyWaste, users } from '../db/schema'
import { withWriteLock } from '../db/write-lock'
import { DomainError } from '../errors'
import { audit } from './audit'
import { localDateString, parseDayBoundary } from '../utils/dates'
import { supplyCodeFrom, uniqueCode } from '../utils/codes'
import type {
  CreateLostSaleInput, CreatePurchaseInput, CreateSupplyInput, CreateWasteInput,
  SaveCountsInput, UpdatePurchaseInput, UpdateSupplyInput, UpdateWasteInput,
} from '../schemas/inventory'

// Fase 0 de la tesis: solo REGISTRO (compras, merma, conteos, ventas perdidas).
// Sin alertas ni stock teórico: la Capa 2 los calculará después a partir de
// estos mismos datos, sin cambiar cómo se registran.

export interface DateRange { from: string; to: string }

// Rango por defecto: los últimos 7 días locales, hoy incluido.
export function resolveRange(q: { from?: string; to?: string }): DateRange {
  const to = q.to ?? localDateString()
  const d = new Date(to + 'T00:00:00')
  d.setDate(d.getDate() - 6)
  const from = q.from ?? localDateString(d)
  if (from > to) throw new DomainError('El rango de fechas está invertido', 400, 'INVALID_RANGE')
  return { from, to }
}

async function requireSupply(tx: Executor, supplyId: number) {
  const [supply] = await tx.select().from(supplies).where(eq(supplies.id, supplyId))
  if (!supply) throw new DomainError('Insumo no encontrado', 404, 'SUPPLY_NOT_FOUND')
  if (supply.active === false) throw new DomainError(`"${supply.name}" está desactivado`, 409, 'SUPPLY_INACTIVE')
  return supply
}

async function assertNameFree(tx: Executor, name: string, exceptId?: number) {
  const [dup] = await tx.select({ id: supplies.id }).from(supplies)
    .where(sql`lower(${supplies.name}) = lower(${name})`)
  if (dup && dup.id !== exceptId) throw new DomainError(`Ya existe el insumo "${name}"`, 409, 'SUPPLY_EXISTS')
}

// ── Insumos ──────────────────────────────────────────────────────────────────
export async function listSupplies(includeInactive: boolean) {
  const q = db.select().from(supplies)
  const order = [asc(supplies.sortOrder), asc(supplies.name)]
  const rows = includeInactive ? await q.orderBy(...order) : await q.where(eq(supplies.active, true)).orderBy(...order)
  // Los críticos primero: son los de la «Compra del día»
  return rows.sort((a, b) => Number(b.critical) - Number(a.critical))
}

export function createSupply(input: CreateSupplyInput) {
  return withWriteLock(() => db.transaction(async (tx) => {
    await assertNameFree(tx, input.name)
    const taken = new Set((await tx.select({ code: supplies.code }).from(supplies)).map(r => r.code).filter((c): c is string => !!c))
    if (input.code && taken.has(input.code)) throw new DomainError(`Ya existe el código ${input.code}`, 409, 'SUPPLY_CODE_EXISTS')
    const [row] = await tx.insert(supplies).values({
      name: input.name,
      unit: input.unit,
      perishable: input.perishable ?? true,
      critical: input.critical ?? false,
      code: input.code ?? uniqueCode(supplyCodeFrom(input.name), taken),
      sortOrder: input.sortOrder ?? 0,
    }).returning()
    return row
  }))
}

export function updateSupply(id: number, input: UpdateSupplyInput, userId: number) {
  return withWriteLock(() => db.transaction(async (tx) => {
    const [before] = await tx.select().from(supplies).where(eq(supplies.id, id))
    if (!before) throw new DomainError('Insumo no encontrado', 404, 'SUPPLY_NOT_FOUND')
    if (input.name) await assertNameFree(tx, input.name, id)
    const [after] = await tx.update(supplies).set(input).where(eq(supplies.id, id)).returning()
    await audit(tx, { userId, action: 'supply.update', entity: 'supply', entityId: id, data: { before, changes: input } })
    return after
  }))
}

// ── Compras ──────────────────────────────────────────────────────────────────
const purchaseColumns = {
  id: supplyPurchases.id,
  supplyId: supplyPurchases.supplyId,
  supplyName: supplies.name,
  unit: supplies.unit,
  quantity: supplyPurchases.quantity,
  totalCost: supplyPurchases.totalCost,
  purchasedAt: supplyPurchases.purchasedAt,
  notes: supplyPurchases.notes,
  supplier: supplyPurchases.supplier,
  source: supplyPurchases.source,
  createdByName: users.name,
  createdAt: supplyPurchases.createdAt,
}

export function listPurchases(range: DateRange) {
  return db.select(purchaseColumns).from(supplyPurchases)
    .innerJoin(supplies, eq(supplyPurchases.supplyId, supplies.id))
    .leftJoin(users, eq(supplyPurchases.createdBy, users.id))
    .where(and(gte(supplyPurchases.purchasedAt, range.from), lte(supplyPurchases.purchasedAt, range.to)))
    .orderBy(desc(supplyPurchases.purchasedAt), desc(supplyPurchases.id))
}

export function createPurchase(input: CreatePurchaseInput, userId: number) {
  return withWriteLock(() => db.transaction(async (tx) => {
    await requireSupply(tx, input.supplyId)
    const [row] = await tx.insert(supplyPurchases).values({
      supplyId: input.supplyId,
      quantity: input.quantity,
      totalCost: input.totalCost,
      purchasedAt: input.purchasedAt ?? localDateString(),
      notes: input.notes ?? null,
      supplier: input.supplier || null,
      createdBy: userId,
    }).returning()
    return row
  }))
}

export function updatePurchase(id: number, input: UpdatePurchaseInput, userId: number) {
  const { reason, ...changes } = input
  return withWriteLock(() => db.transaction(async (tx) => {
    const [before] = await tx.select().from(supplyPurchases).where(eq(supplyPurchases.id, id))
    if (!before) throw new DomainError('Compra no encontrada', 404, 'PURCHASE_NOT_FOUND')
    if (changes.supplyId !== undefined) await requireSupply(tx, changes.supplyId)
    const [after] = await tx.update(supplyPurchases).set(changes).where(eq(supplyPurchases.id, id)).returning()
    await audit(tx, { userId, action: 'purchase.update', entity: 'supply_purchase', entityId: id, data: { reason, before, after } })
    return after
  }))
}

export function deletePurchase(id: number, reason: string, userId: number) {
  return withWriteLock(() => db.transaction(async (tx) => {
    const [before] = await tx.select().from(supplyPurchases).where(eq(supplyPurchases.id, id))
    if (!before) throw new DomainError('Compra no encontrada', 404, 'PURCHASE_NOT_FOUND')
    await tx.delete(supplyPurchases).where(eq(supplyPurchases.id, id))
    // La compra borrada queda íntegra en el registro
    await audit(tx, { userId, action: 'purchase.delete', entity: 'supply_purchase', entityId: id, data: { reason, before } })
  }))
}

// ── Merma ────────────────────────────────────────────────────────────────────
const wasteColumns = {
  id: supplyWaste.id,
  supplyId: supplyWaste.supplyId,
  supplyName: supplies.name,
  unit: supplies.unit,
  quantity: supplyWaste.quantity,
  reason: supplyWaste.reason,
  wastedAt: supplyWaste.wastedAt,
  notes: supplyWaste.notes,
  source: supplyWaste.source,
  createdByName: users.name,
  createdAt: supplyWaste.createdAt,
}

export function listWaste(range: DateRange) {
  return db.select(wasteColumns).from(supplyWaste)
    .innerJoin(supplies, eq(supplyWaste.supplyId, supplies.id))
    .leftJoin(users, eq(supplyWaste.createdBy, users.id))
    .where(and(gte(supplyWaste.wastedAt, range.from), lte(supplyWaste.wastedAt, range.to)))
    .orderBy(desc(supplyWaste.wastedAt), desc(supplyWaste.id))
}

export function createWaste(input: CreateWasteInput, userId: number) {
  return withWriteLock(() => db.transaction(async (tx) => {
    await requireSupply(tx, input.supplyId)
    const [row] = await tx.insert(supplyWaste).values({
      supplyId: input.supplyId,
      quantity: input.quantity,
      reason: input.reason,
      wastedAt: input.wastedAt ?? localDateString(),
      notes: input.notes ?? null,
      createdBy: userId,
    }).returning()
    return row
  }))
}

export function updateWaste(id: number, input: UpdateWasteInput, userId: number) {
  const { correctionReason, ...changes } = input
  return withWriteLock(() => db.transaction(async (tx) => {
    const [before] = await tx.select().from(supplyWaste).where(eq(supplyWaste.id, id))
    if (!before) throw new DomainError('Merma no encontrada', 404, 'WASTE_NOT_FOUND')
    if (changes.supplyId !== undefined) await requireSupply(tx, changes.supplyId)
    const [after] = await tx.update(supplyWaste).set(changes).where(eq(supplyWaste.id, id)).returning()
    await audit(tx, { userId, action: 'waste.update', entity: 'supply_waste', entityId: id, data: { reason: correctionReason, before, after } })
    return after
  }))
}

export function deleteWaste(id: number, reason: string, userId: number) {
  return withWriteLock(() => db.transaction(async (tx) => {
    const [before] = await tx.select().from(supplyWaste).where(eq(supplyWaste.id, id))
    if (!before) throw new DomainError('Merma no encontrada', 404, 'WASTE_NOT_FOUND')
    await tx.delete(supplyWaste).where(eq(supplyWaste.id, id))
    await audit(tx, { userId, action: 'waste.delete', entity: 'supply_waste', entityId: id, data: { reason, before } })
  }))
}

// ── Conteos sueltos (la apertura la registra la «Compra del día») ────────────
export function listCounts(date: string, moment?: 'apertura' | 'cierre') {
  return db.select({
    id: supplyCounts.id,
    supplyId: supplyCounts.supplyId,
    supplyName: supplies.name,
    unit: supplies.unit,
    quantity: supplyCounts.quantity,
    countedOn: supplyCounts.countedOn,
    moment: supplyCounts.moment,
    createdByName: users.name,
    createdAt: supplyCounts.createdAt,
  }).from(supplyCounts)
    .innerJoin(supplies, eq(supplyCounts.supplyId, supplies.id))
    .leftJoin(users, eq(supplyCounts.createdBy, users.id))
    .where(moment ? and(eq(supplyCounts.countedOn, date), eq(supplyCounts.moment, moment)) : eq(supplyCounts.countedOn, date))
    .orderBy(asc(supplies.name))
}

// Upsert de todos los insumos del día en una transacción: volver a guardar el
// mismo día corrige el conteo (queda en audit_log con el valor anterior).
export async function saveCounts(date: string, input: SaveCountsInput, userId: number) {
  if (date > localDateString()) throw new DomainError('No se puede contar un día futuro', 400, 'FUTURE_DATE')
  const moment = input.moment ?? 'cierre'
  await withWriteLock(() => db.transaction(async (tx) => {
    for (const item of input.items) {
      const supply = await requireSupply(tx, item.supplyId)
      const [existing] = await tx.select().from(supplyCounts)
        .where(and(eq(supplyCounts.supplyId, item.supplyId), eq(supplyCounts.countedOn, date), eq(supplyCounts.moment, moment)))
      if (!existing) {
        await tx.insert(supplyCounts).values({ supplyId: item.supplyId, quantity: item.quantity, countedOn: date, moment, createdBy: userId })
      } else if (existing.quantity !== item.quantity) {
        await tx.update(supplyCounts).set({ quantity: item.quantity, createdBy: userId }).where(eq(supplyCounts.id, existing.id))
        await audit(tx, {
          userId, action: 'count.update', entity: 'supply_count', entityId: existing.id,
          data: { supplyId: item.supplyId, name: supply.name, date, moment, before: existing.quantity, after: item.quantity },
        })
      }
    }
  }))
  return listCounts(date, moment)
}

// ── Ventas perdidas ──────────────────────────────────────────────────────────
export function createLostSale(input: CreateLostSaleInput, userId: number) {
  return withWriteLock(() => db.transaction(async (tx) => {
    if (input.dishId !== undefined) {
      const [dish] = await tx.select({ id: dishes.id }).from(dishes).where(eq(dishes.id, input.dishId))
      if (!dish) throw new DomainError('Plato no encontrado', 404, 'DISH_NOT_FOUND')
    }
    if (input.supplyId !== undefined) {
      const [supply] = await tx.select({ id: supplies.id }).from(supplies).where(eq(supplies.id, input.supplyId))
      if (!supply) throw new DomainError('Insumo no encontrado', 404, 'SUPPLY_NOT_FOUND')
    }
    const [row] = await tx.insert(lostSales).values({
      dishId: input.dishId ?? null,
      supplyId: input.supplyId ?? null,
      quantity: input.quantity ?? 1,
      createdBy: userId,
    }).returning()
    return row
  }))
}

// occurred_at es UTC: el rango se convierte a límites del día local
export function listLostSales(range: DateRange) {
  return db.select({
    id: lostSales.id,
    dishId: lostSales.dishId,
    dishName: dishes.name,
    supplyId: lostSales.supplyId,
    supplyName: supplies.name,
    quantity: lostSales.quantity,
    occurredAt: lostSales.occurredAt,
    createdByName: users.name,
  }).from(lostSales)
    .leftJoin(dishes, eq(lostSales.dishId, dishes.id))
    .leftJoin(supplies, eq(lostSales.supplyId, supplies.id))
    .leftJoin(users, eq(lostSales.createdBy, users.id))
    .where(and(
      gte(lostSales.occurredAt, parseDayBoundary(range.from, 'start')),
      lte(lostSales.occurredAt, parseDayBoundary(range.to, 'end')),
    ))
    .orderBy(desc(lostSales.occurredAt))
}
