import { and, asc, desc, eq, gte, lte, sql } from 'drizzle-orm'
import { db, type Executor } from '../db'
import { auditLog, dishes, lostSales, supplies, supplyCounts, supplyPurchases, supplyWaste, users } from '../db/schema'
import { withWriteLock } from '../db/write-lock'
import { DomainError } from '../errors'
import { audit } from './audit'
import { localDateString, parseDayBoundary, sqliteLocalOffset } from '../utils/dates'
import { toCsv } from '../utils/csv'
import type {
  CreateLostSaleInput, CreatePurchaseInput, CreateSupplyInput, CreateWasteInput,
  ExportTable, SaveCountsInput, UpdatePurchaseInput, UpdateSupplyInput, UpdateWasteInput,
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
  const rows = includeInactive ? await q.orderBy(asc(supplies.name)) : await q.where(eq(supplies.active, true)).orderBy(asc(supplies.name))
  // Los críticos primero: son los que se cuentan cada noche
  return rows.sort((a, b) => Number(b.critical) - Number(a.critical))
}

export function createSupply(input: CreateSupplyInput) {
  return withWriteLock(() => db.transaction(async (tx) => {
    await assertNameFree(tx, input.name)
    const [row] = await tx.insert(supplies).values({
      name: input.name,
      unit: input.unit,
      perishable: input.perishable ?? true,
      critical: input.critical ?? false,
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

// ── Conteo de cierre ─────────────────────────────────────────────────────────
export function listCounts(date: string) {
  return db.select({
    id: supplyCounts.id,
    supplyId: supplyCounts.supplyId,
    supplyName: supplies.name,
    unit: supplies.unit,
    quantity: supplyCounts.quantity,
    countedOn: supplyCounts.countedOn,
    createdByName: users.name,
    createdAt: supplyCounts.createdAt,
  }).from(supplyCounts)
    .innerJoin(supplies, eq(supplyCounts.supplyId, supplies.id))
    .leftJoin(users, eq(supplyCounts.createdBy, users.id))
    .where(eq(supplyCounts.countedOn, date))
    .orderBy(asc(supplies.name))
}

// Upsert de todos los insumos del día en una transacción: volver a guardar el
// mismo día corrige el conteo (queda en audit_log con el valor anterior).
export async function saveCounts(date: string, input: SaveCountsInput, userId: number) {
  if (date > localDateString()) throw new DomainError('No se puede contar un día futuro', 400, 'FUTURE_DATE')
  await withWriteLock(() => db.transaction(async (tx) => {
    for (const item of input.items) {
      const supply = await requireSupply(tx, item.supplyId)
      const [existing] = await tx.select().from(supplyCounts)
        .where(and(eq(supplyCounts.supplyId, item.supplyId), eq(supplyCounts.countedOn, date)))
      if (!existing) {
        await tx.insert(supplyCounts).values({ supplyId: item.supplyId, quantity: item.quantity, countedOn: date, createdBy: userId })
      } else if (existing.quantity !== item.quantity) {
        await tx.update(supplyCounts).set({ quantity: item.quantity, createdBy: userId }).where(eq(supplyCounts.id, existing.id))
        await audit(tx, {
          userId, action: 'count.update', entity: 'supply_count', entityId: existing.id,
          data: { supplyId: item.supplyId, name: supply.name, date, before: existing.quantity, after: item.quantity },
        })
      }
    }
  }))
  return listCounts(date)
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

// ── Export para el análisis de la tesis ──────────────────────────────────────
// Una tabla por llamada, con fechas en hora local y nombres resueltos para que
// el CSV se pueda analizar sin cruzar ids.
export async function exportCsv(table: ExportTable, range: DateRange): Promise<string> {
  const local = sqliteLocalOffset()
  const utcFrom = parseDayBoundary(range.from, 'start')
  const utcTo = parseDayBoundary(range.to, 'end')

  switch (table) {
    case 'supplies': {
      const rows = await db.select().from(supplies).orderBy(asc(supplies.id))
      return toCsv(['id', 'nombre', 'unidad', 'perecible', 'critico', 'activo'],
        rows.map(r => [r.id, r.name, r.unit, r.perishable ? 1 : 0, r.critical ? 1 : 0, r.active ? 1 : 0]))
    }
    case 'purchases': {
      const rows = await listPurchases(range)
      return toCsv(['id', 'fecha', 'insumo_id', 'insumo', 'unidad', 'cantidad', 'costo_total', 'costo_unitario', 'notas', 'registrado_por'],
        rows.reverse().map(r => [r.id, r.purchasedAt, r.supplyId, r.supplyName, r.unit, r.quantity, r.totalCost,
          r.quantity > 0 ? Math.round((r.totalCost / r.quantity) * 100) / 100 : '', r.notes, r.createdByName]))
    }
    case 'waste': {
      const rows = await listWaste(range)
      return toCsv(['id', 'fecha', 'insumo_id', 'insumo', 'unidad', 'cantidad', 'motivo', 'notas', 'registrado_por'],
        rows.reverse().map(r => [r.id, r.wastedAt, r.supplyId, r.supplyName, r.unit, r.quantity, r.reason, r.notes, r.createdByName]))
    }
    case 'counts': {
      const rows = await db.select({
        countedOn: supplyCounts.countedOn, supplyId: supplyCounts.supplyId, name: supplies.name,
        unit: supplies.unit, quantity: supplyCounts.quantity,
      }).from(supplyCounts)
        .innerJoin(supplies, eq(supplyCounts.supplyId, supplies.id))
        .where(and(gte(supplyCounts.countedOn, range.from), lte(supplyCounts.countedOn, range.to)))
        .orderBy(asc(supplyCounts.countedOn), asc(supplies.name))
      return toCsv(['fecha', 'insumo_id', 'insumo', 'unidad', 'cantidad'],
        rows.map(r => [r.countedOn, r.supplyId, r.name, r.unit, r.quantity]))
    }
    case 'lost_sales': {
      const rows = await db.select({
        id: lostSales.id,
        localAt: sql<string>`datetime(${lostSales.occurredAt}, ${local})`,
        dishId: lostSales.dishId, dishName: dishes.name,
        supplyId: lostSales.supplyId, supplyName: supplies.name,
        quantity: lostSales.quantity, userName: users.name,
      }).from(lostSales)
        .leftJoin(dishes, eq(lostSales.dishId, dishes.id))
        .leftJoin(supplies, eq(lostSales.supplyId, supplies.id))
        .leftJoin(users, eq(lostSales.createdBy, users.id))
        .where(and(gte(lostSales.occurredAt, utcFrom), lte(lostSales.occurredAt, utcTo)))
        .orderBy(asc(lostSales.occurredAt))
      return toCsv(['id', 'fecha', 'hora', 'plato_id', 'plato', 'insumo_id', 'insumo', 'porciones', 'registrado_por'],
        rows.map(r => [r.id, r.localAt.slice(0, 10), r.localAt.slice(11, 16), r.dishId, r.dishName, r.supplyId, r.supplyName, r.quantity, r.userName]))
    }
    case 'stockouts': {
      // Quiebres: cada vez que un plato se marcó agotado o se volvió a habilitar (TD-31)
      const rows = await db.select({
        localAt: sql<string>`datetime(${auditLog.at}, ${local})`,
        dishId: auditLog.entityId, data: auditLog.data, userName: users.name,
      }).from(auditLog)
        .leftJoin(users, eq(auditLog.userId, users.id))
        .where(and(eq(auditLog.action, 'dish.availability'), gte(auditLog.at, utcFrom), lte(auditLog.at, utcTo)))
        .orderBy(asc(auditLog.at))
      return toCsv(['fecha', 'hora', 'plato_id', 'plato', 'evento', 'registrado_por'],
        rows.map(r => {
          const d = r.data ? JSON.parse(r.data) as { name?: string; available?: boolean } : {}
          return [r.localAt.slice(0, 10), r.localAt.slice(11, 16), r.dishId, d.name, d.available ? 'habilitado' : 'agotado', r.userName]
        }))
    }
  }
}
