import { and, eq, inArray, notInArray } from 'drizzle-orm'
import { orders, orderItems, billGroups } from '../db/schema'
import type { DB, Executor } from '../db'
import { DomainError } from '../errors'
import { withWriteLock } from '../db/write-lock'
import { isClosed } from './order.service'

async function loadActiveOrder(tx: Executor, orderId: number) {
  const [order] = await tx.select().from(orders).where(eq(orders.id, orderId))
  if (!order) throw new DomainError('Pedido no encontrado', 404, 'ORDER_NOT_FOUND')
  if (isClosed(order.status)) throw new DomainError('El pedido ya está cerrado', 409, 'ORDER_CLOSED')
  return order
}

// Ítems ligados a sub-cuentas ya cobradas: no se pueden mover ni reasignar.
async function lockedItemIds(tx: Executor, orderId: number) {
  const paid = await tx.select({ id: billGroups.id }).from(billGroups)
    .where(and(eq(billGroups.orderId, orderId), eq(billGroups.status, 'paid')))
  const paidIds = paid.map(g => g.id)
  if (paidIds.length === 0) return { paidCount: 0, locked: new Set<number>() }
  const items = await tx.select({ id: orderItems.id }).from(orderItems)
    .where(and(eq(orderItems.orderId, orderId), inArray(orderItems.billGroupId, paidIds)))
  return { paidCount: paidIds.length, locked: new Set(items.map(i => i.id)) }
}

// Crea o reemplaza las sub-cuentas abiertas. Validación y escritura van en la misma
// transacción bajo el candado (TD-23): antes se validaba afuera y un cobro
// simultáneo podía cambiar los ítems entre la validación y la escritura.
export async function saveSplit(db: DB, orderId: number, groups: Array<{ label: string; itemIds: number[] }>) {
  return withWriteLock(() => db.transaction(async (tx) => {
    await loadActiveOrder(tx, orderId)
    const { paidCount, locked } = await lockedItemIds(tx, orderId)

    // Una división nueva requiere al menos 2 sub-cuentas; si ya hay cobradas,
    // basta 1 abierta (puede ser la última).
    const nonEmpty = groups.filter(g => g.itemIds.length > 0)
    if (paidCount === 0 && nonEmpty.length < 2) {
      throw new DomainError('Se requieren al menos 2 sub-cuentas', 400, 'SPLIT_TOO_FEW')
    }

    const items = await tx.select().from(orderItems).where(eq(orderItems.orderId, orderId))
    const itemsById = new Map(items.map(i => [i.id, i]))
    const seen = new Set<number>()
    for (const g of groups) {
      for (const id of g.itemIds) {
        const it = itemsById.get(id)
        if (!it) throw new DomainError(`El item ${id} no pertenece al pedido`, 400, 'SPLIT_INVALID_ITEM')
        if (it.billId) throw new DomainError(`El item ${id} ya fue cobrado`, 400, 'SPLIT_INVALID_ITEM')
        if (locked.has(id)) throw new DomainError(`El item ${id} pertenece a una sub-cuenta ya cobrada`, 400, 'SPLIT_INVALID_ITEM')
        if (seen.has(id)) throw new DomainError(`El item ${id} está asignado a más de una sub-cuenta`, 400, 'SPLIT_INVALID_ITEM')
        seen.add(id)
      }
    }

    await clearOpenGroups(tx, orderId, locked)

    const created: typeof billGroups.$inferSelect[] = []
    for (const g of nonEmpty) {
      const [grp] = await tx.insert(billGroups).values({ orderId, label: g.label, status: 'open' }).returning()
      await tx.update(orderItems).set({ billGroupId: grp.id }).where(inArray(orderItems.id, g.itemIds))
      created.push(grp)
    }
    return created
  }))
}

// Deshace solo las sub-cuentas abiertas; las cobradas se conservan.
export async function deleteSplit(db: DB, orderId: number) {
  return withWriteLock(() => db.transaction(async (tx) => {
    await loadActiveOrder(tx, orderId)
    const { locked } = await lockedItemIds(tx, orderId)
    await clearOpenGroups(tx, orderId, locked)
  }))
}

async function clearOpenGroups(tx: Executor, orderId: number, locked: Set<number>) {
  await tx.update(orderItems).set({ billGroupId: null }).where(and(
    eq(orderItems.orderId, orderId),
    locked.size > 0 ? notInArray(orderItems.id, [...locked]) : undefined,
  ))
  await tx.delete(billGroups).where(and(eq(billGroups.orderId, orderId), eq(billGroups.status, 'open')))
}
