import { and, eq, inArray, notInArray } from 'drizzle-orm'
import {
  categories, dishes, modifierGroups, modifierOptions, orders, orderItems, billGroups, tables,
} from '../db/schema'
import type { DB, Executor } from '../db'
import type { AuthPayload } from '../middleware/auth'
import { DomainError } from '../errors'
import { roundMoney, sumItems } from '../utils/math'
import { withWriteLock } from '../db/write-lock'
import { audit } from './audit'

type Role = AuthPayload['role']
type OrderRow = typeof orders.$inferSelect

// ── Ciclo de vida del pedido ──────────────────────────────────────────────────
// Activos: pending, paying ('por cobrar'); preparing/ready son heredados y se
// tratan como pending. Cerrados: paid (solo lo alcanza el cobro) y cancelled.
export function isClosed(status: OrderRow['status']) {
  return status === 'paid' || status === 'cancelled'
}

async function loadActiveOrder(tx: Executor, orderId: number): Promise<OrderRow> {
  const [order] = await tx.select().from(orders).where(eq(orders.id, orderId))
  if (!order) throw new DomainError('Pedido no encontrado', 404, 'ORDER_NOT_FOUND')
  if (isClosed(order.status)) {
    throw new DomainError('El pedido ya está cerrado (pagado o cancelado)', 409, 'ORDER_CLOSED')
  }
  return order
}

export interface CreateOrderInput {
  tableId?: number | null
  type: 'dine_in' | 'delivery'
  customerName?: string | null
  customerPhone?: string | null
  customerAddress?: string | null
  notes?: string | null
  items?: OrderItemRequest[]
}

// Crea el pedido, sus ítems y ocupa la mesa en una sola transacción bajo el
// candado (TD-04). Antes la verificación "la mesa ya tiene pedido" y el INSERT
// eran pasos sueltos: dos envíos casi simultáneos creaban dos pedidos activos.
// El índice único parcial uq_orders_active_table es la segunda barrera.
export async function createOrder(db: DB, input: CreateOrderInput, createdBy: number) {
  try {
    return await withWriteLock(() => db.transaction(async (tx) => {
      const tableId = input.tableId ?? null
      if (input.type === 'dine_in' && !tableId) {
        throw new DomainError('Selecciona una mesa', 400, 'TABLE_REQUIRED')
      }
      if (tableId) {
        const [table] = await tx.select().from(tables).where(eq(tables.id, tableId))
        if (!table) throw new DomainError('Mesa no encontrada', 404, 'TABLE_NOT_FOUND')
        if (table.active === false) throw new DomainError('La mesa está inhabilitada', 409, 'TABLE_INACTIVE')
        const [existing] = await tx.select({ id: orders.id }).from(orders)
          .where(and(eq(orders.tableId, tableId), notInArray(orders.status, ['paid', 'cancelled'])))
        if (existing) {
          throw new DomainError(
            `La mesa ya tiene un pedido activo (#${existing.id}). Agrégalo desde la vista de la mesa.`,
            409,
            'TABLE_BUSY',
          )
        }
      }

      const resolved = input.items?.length ? await resolveItems(tx, input.items) : []
      const [order] = await tx.insert(orders).values({
        tableId,
        type: input.type,
        status: 'pending',
        customerName: input.customerName ?? null,
        customerPhone: input.customerPhone ?? null,
        customerAddress: input.customerAddress ?? null,
        notes: input.notes ?? null,
        createdBy,
      }).returning()

      let insertedIds: number[] = []
      if (resolved.length) {
        const inserted = await tx.insert(orderItems)
          .values(resolved.map(item => ({ ...item, orderId: order.id, status: 'pending' as const })))
          .returning({ id: orderItems.id })
        insertedIds = inserted.map(i => i.id)
      }
      if (tableId) {
        await tx.update(tables).set({ status: 'occupied' }).where(eq(tables.id, tableId))
      }
      return { orderId: order.id, insertedIds }
    }))
  } catch (err: any) {
    if (/uq_orders_active_table|UNIQUE constraint failed: orders\.table_id/i.test(String(err?.message ?? ''))) {
      throw new DomainError('La mesa ya tiene un pedido activo', 409, 'TABLE_BUSY')
    }
    throw err
  }
}

// Agrega ítems a un pedido activo (TD-07: antes reabría pedidos pagados o cancelados).
export async function addItems(db: DB, orderId: number, items: OrderItemRequest[]) {
  return withWriteLock(() => db.transaction(async (tx) => {
    const order = await loadActiveOrder(tx, orderId)
    const resolved = await resolveItems(tx, items)
    const inserted = await tx.insert(orderItems)
      .values(resolved.map(item => ({ ...item, orderId, status: 'pending' as const })))
      .returning({ id: orderItems.id })
    const insertedIds = inserted.map(i => i.id)

    // Ítems nuevos en una cuenta dividida:
    //  - 1 grupo abierto         → auto-asignar a ese grupo
    //  - 0 abiertos y ≥1 pagados → crear un grupo abierto nuevo para que sean cobrables
    //  - 2+ abiertos             → quedan sin asignar y el cajero decide en el modal
    const groupsOnOrder = await tx.select().from(billGroups).where(eq(billGroups.orderId, orderId))
    const openGroups = groupsOnOrder.filter(g => g.status === 'open')
    const paidGroups = groupsOnOrder.filter(g => g.status === 'paid')
    if (openGroups.length === 1) {
      await tx.update(orderItems).set({ billGroupId: openGroups[0].id }).where(inArray(orderItems.id, insertedIds))
    } else if (openGroups.length === 0 && paidGroups.length > 0) {
      const nextLetter = String.fromCharCode(65 + groupsOnOrder.length)
      const [newGroup] = await tx.insert(billGroups)
        .values({ orderId, label: `Cuenta ${nextLetter}`, status: 'open' })
        .returning()
      await tx.update(orderItems).set({ billGroupId: newGroup.id }).where(inArray(orderItems.id, insertedIds))
    }

    // Si estaba "por cobrar", vuelve a pendiente: hay consumo nuevo.
    await tx.update(orders)
      .set({ status: 'pending', updatedAt: new Date().toISOString() })
      .where(eq(orders.id, orderId))
    if (order.tableId) {
      await tx.update(tables).set({ status: 'occupied' }).where(eq(tables.id, order.tableId))
    }
    return { insertedIds }
  }))
}

// Marca o desmarca "por cobrar" (TD-08: antes se guardaba como 'preparing' y se perdía).
export async function setOrderStatus(db: DB, orderId: number, status: 'pending' | 'paying') {
  return withWriteLock(() => db.transaction(async (tx) => {
    const order = await loadActiveOrder(tx, orderId)
    await tx.update(orders)
      .set({ status, updatedAt: new Date().toISOString() })
      .where(eq(orders.id, orderId))
    if (order.tableId) {
      await tx.update(tables)
        .set({ status: status === 'paying' ? 'paying' : 'occupied' })
        .where(eq(tables.id, order.tableId))
    }
  }))
}

// Política de cancelación (D1, D5):
//  - sin cobros  → cajero, encargado o dueño
//  - con cobros  → solo encargado o dueño (aceptar que parte de la cuenta no se
//                  pague es una decisión de dinero)
//  - pagado/cancelado → nadie (corregir un cobro requiere anular la boleta)
// Siempre con motivo y registro en audit_log (TD-02, TD-16).
export async function cancelOrder(db: DB, orderId: number, user: { id: number; role: Role }, reason: string) {
  if (user.role === 'waiter') {
    throw new DomainError('Solo el cajero, el encargado o el dueño pueden cancelar pedidos', 403, 'FORBIDDEN')
  }
  return withWriteLock(() => db.transaction(async (tx) => {
    const order = await loadActiveOrder(tx, orderId)
    const items = await tx.select().from(orderItems).where(eq(orderItems.orderId, orderId))
    const billed = items.filter(i => i.billId !== null)
    const unbilled = items.filter(i => i.billId === null)

    if (billed.length > 0 && user.role !== 'owner' && user.role !== 'manager') {
      throw new DomainError(
        'El pedido tiene cobros: solo el encargado o el dueño pueden cancelarlo',
        403,
        'ORDER_HAS_PAYMENTS',
      )
    }

    await tx.update(orders)
      .set({ status: 'cancelled', updatedAt: new Date().toISOString() })
      .where(eq(orders.id, orderId))
    if (order.tableId) {
      await tx.update(tables).set({ status: 'free' }).where(eq(tables.id, order.tableId))
    }
    await audit(tx, {
      userId: user.id,
      action: 'order.cancel',
      entity: 'order',
      entityId: orderId,
      data: {
        reason,
        tableId: order.tableId,
        type: order.type,
        billedTotal: sumItems(billed),
        unbilledTotal: sumItems(unbilled),
        unbilledItems: unbilled.map(i => ({ dishName: i.dishName, quantity: i.quantity, unitPrice: i.unitPrice })),
      },
    })
    return order
  }))
}

export interface OrderItemRequest {
  dishId: number
  quantity: number
  modifiers?: Array<{ groupId: number; optionId?: number | null; freeText?: string | null }>
  notes?: string | null
}

export interface ResolvedItem {
  dishId: number
  dishName: string
  unitPrice: number
  quantity: number
  modifiers: string
  notes: string | null
}

interface StoredModifier {
  groupId: number
  groupName: string
  optionId?: number
  optionName?: string
  freeText?: string
}

// El precio y el nombre de cada ítem salen del catálogo, nunca del cliente (TD-01).
// El cliente solo indica qué plato, cuántos y qué opciones; aquí se valida que el
// plato esté disponible y que las opciones pertenezcan a ese plato, y se calcula
// unitPrice = precio del plato + ajustes de las opciones elegidas.
export async function resolveItems(db: Executor, items: OrderItemRequest[]): Promise<ResolvedItem[]> {
  const dishIds = [...new Set(items.map(i => i.dishId))]
  const dishRows = await db.select().from(dishes).where(inArray(dishes.id, dishIds))
  const catIds = [...new Set(dishRows.map(d => d.categoryId).filter((x): x is number => x !== null))]
  const catRows = catIds.length ? await db.select().from(categories).where(inArray(categories.id, catIds)) : []
  const groupRows = await db.select().from(modifierGroups).where(inArray(modifierGroups.dishId, dishIds))
  const groupIds = groupRows.map(g => g.id)
  const optionRows = groupIds.length
    ? await db.select().from(modifierOptions).where(inArray(modifierOptions.groupId, groupIds))
    : []

  const dishById = new Map(dishRows.map(d => [d.id, d]))
  const inactiveCats = new Set(catRows.filter(c => c.active === false).map(c => c.id))
  const groupById = new Map(groupRows.map(g => [g.id, g]))
  const optionById = new Map(optionRows.map(o => [o.id, o]))

  // Un plato agotado, archivado o de una categoría inactiva no se puede vender (D3: se rechaza
  // el envío completo y se informa cuáles, para que el POS los quite del borrador).
  const unavailable = dishIds
    .map(id => ({ id, dish: dishById.get(id) }))
    .filter(({ dish }) => !dish || dish.available === false || dish.archived === true || (dish.categoryId !== null && inactiveCats.has(dish.categoryId)))
    .map(({ id, dish }) => ({ dishId: id, name: dish?.name ?? `Plato #${id}` }))
  if (unavailable.length > 0) {
    throw new DomainError(
      `No disponible: ${unavailable.map(d => d.name).join(', ')}`,
      409,
      'DISH_UNAVAILABLE',
      { dishes: unavailable },
    )
  }

  return items.map(item => {
    const dish = dishById.get(item.dishId)!
    const stored: StoredModifier[] = []
    const optionsPerGroup = new Map<number, number>()
    let adjustment = 0

    for (const mod of item.modifiers ?? []) {
      const group = groupById.get(mod.groupId)
      if (!group || group.dishId !== dish.id) {
        throw new DomainError(`Modificador inválido para ${dish.name}`, 400, 'INVALID_MODIFIER')
      }
      const entry: StoredModifier = { groupId: group.id, groupName: group.name }
      if (mod.optionId !== undefined && mod.optionId !== null) {
        const option = optionById.get(mod.optionId)
        if (!option || option.groupId !== group.id) {
          throw new DomainError(`Opción inválida en "${group.name}" para ${dish.name}`, 400, 'INVALID_MODIFIER')
        }
        entry.optionId = option.id
        entry.optionName = option.name
        adjustment += option.priceAdjustment ?? 0
        optionsPerGroup.set(group.id, (optionsPerGroup.get(group.id) ?? 0) + 1)
      }
      const text = mod.freeText?.trim()
      if (text) entry.freeText = text
      if (entry.optionId !== undefined || entry.freeText !== undefined) stored.push(entry)
    }

    for (const group of groupRows.filter(g => g.dishId === dish.id)) {
      const chosen = optionsPerGroup.get(group.id) ?? 0
      if (group.multiple === false && chosen > 1) {
        throw new DomainError(`Solo se permite una opción en "${group.name}" para ${dish.name}`, 400, 'INVALID_MODIFIER')
      }
      // Un grupo obligatorio sin opciones configuradas no debe bloquear la venta.
      const hasOptions = optionRows.some(o => o.groupId === group.id)
      if (group.required && hasOptions && chosen === 0) {
        throw new DomainError(`Falta elegir "${group.name}" para ${dish.name}`, 400, 'MODIFIER_REQUIRED')
      }
    }

    return {
      dishId: dish.id,
      dishName: dish.name,
      unitPrice: roundMoney(dish.price + adjustment),
      quantity: item.quantity,
      modifiers: JSON.stringify(stored),
      notes: item.notes?.trim() || null,
    }
  })
}
