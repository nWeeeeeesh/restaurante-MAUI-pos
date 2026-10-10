import { eq, and, isNull, inArray, sql } from 'drizzle-orm'
import { bills, orders, orderItems, tables, billGroups } from '../db/schema'
import type { DB } from '../db'
import { sumItems } from '../utils/math'
import { DomainError } from '../errors'
import { withWriteLock } from '../db/write-lock'

export interface CreateBillParams {
  orderId: number
  paymentMethod: 'cash' | 'yape' | 'plin'
  cashReceived?: number | null
  itemIds?: number[] | null
  billGroupId?: number | null
  createdBy: number
}

export interface CreateBillResult {
  bill: typeof bills.$inferSelect
  fullyPaid: boolean
  order: typeof orders.$inferSelect
  // Ítems efectivamente cobrados por esta boleta (base de la boleta impresa).
  items: (typeof orderItems.$inferSelect)[]
}

export class BillingError extends DomainError {
  constructor(message: string, statusCode: number, code?: string) {
    super(message, statusCode, code)
    this.name = 'BillingError'
  }
}

export async function createBill(db: DB, params: CreateBillParams): Promise<CreateBillResult> {
  // Reintento ante colisión del número de boleta (UNIQUE). Con el candado de
  // escritura es prácticamente imposible, pero es barato mantenerlo.
  for (let attempt = 0; ; attempt++) {
    try {
      return await withWriteLock(() => db.transaction(tx => billInTransaction(tx, params)))
    } catch (err: any) {
      if (!(err instanceof DomainError) && /UNIQUE/i.test(String(err?.message ?? '')) && attempt < 2) continue
      throw err
    }
  }
}

type Tx = Parameters<Parameters<DB['transaction']>[0]>[0]

// Todo ocurre dentro de la transacción y bajo el candado: las precondiciones
// (estado del pedido, sub-cuenta, ítems pendientes) se leen aquí y no antes.
// Antes se leían fuera de la tx y un segundo cobro podía usar datos obsoletos
// y crear otra boleta por los mismos ítems (TD-03, verificado).
async function billInTransaction(tx: Tx, params: CreateBillParams): Promise<CreateBillResult> {
  const { orderId, paymentMethod, cashReceived, itemIds, billGroupId, createdBy } = params

  const [order] = await tx.select().from(orders).where(eq(orders.id, orderId))
  if (!order) throw new BillingError('Pedido no encontrado', 404, 'ORDER_NOT_FOUND')
  if (order.status === 'paid') throw new BillingError('El pedido ya está pagado', 409, 'ORDER_CLOSED')
  if (order.status === 'cancelled') throw new BillingError('El pedido está cancelado', 409, 'ORDER_CLOSED')

  // ── Resolución de items objetivo ──────────────────────────────────────────
  //  1. billGroupId + itemIds → solo los items confirmados de esa sub-cuenta
  //  2. billGroupId solo     → todos los abiertos de la sub-cuenta
  //  3. itemIds solo         → items específicos sin sub-cuenta
  //  4. ninguno              → cobro completo (todos los pendientes)
  let targetItems: (typeof orderItems.$inferSelect)[]
  let groupBeingPaid: typeof billGroups.$inferSelect | null = null
  const hasItemIds = Array.isArray(itemIds) && itemIds.length > 0

  if (billGroupId) {
    const [grp] = await tx.select().from(billGroups)
      .where(and(eq(billGroups.id, billGroupId), eq(billGroups.orderId, orderId)))
    if (!grp) throw new BillingError('Sub-cuenta no encontrada', 404, 'GROUP_NOT_FOUND')
    if (grp.status === 'paid') throw new BillingError('Esta sub-cuenta ya fue cobrada', 409, 'GROUP_PAID')
    groupBeingPaid = grp

    targetItems = await tx.select().from(orderItems).where(and(
      eq(orderItems.orderId, orderId),
      eq(orderItems.billGroupId, grp.id),
      hasItemIds ? inArray(orderItems.id, itemIds!) : undefined,
      isNull(orderItems.billId),
    ))
  } else {
    targetItems = await tx.select().from(orderItems).where(and(
      eq(orderItems.orderId, orderId),
      hasItemIds ? inArray(orderItems.id, itemIds!) : undefined,
      isNull(orderItems.billId),
    ))
  }

  if (targetItems.length === 0) throw new BillingError('No hay items pendientes de cobro', 400, 'NOTHING_TO_BILL')

  const total = sumItems(targetItems)

  if (paymentMethod === 'cash') {
    if (typeof cashReceived !== 'number' || cashReceived < total) {
      throw new BillingError(
        `Monto recibido insuficiente: S/ ${(cashReceived ?? 0).toFixed(2)} < S/ ${total.toFixed(2)}`,
        400,
        'CASH_INSUFFICIENT',
      )
    }
  }

  const [maxRow] = await tx
    .select({
      max: sql<number | null>`MAX(CAST(SUBSTR(${bills.receiptNumber}, INSTR(${bills.receiptNumber}, '-')+1) AS INTEGER))`,
    })
    .from(bills)
  const receiptNumber = `B001-${String((maxRow?.max ?? 0) + 1).padStart(5, '0')}`

  const [bill] = await tx.insert(bills).values({
    orderId,
    subtotal: total,
    total,
    paymentMethod,
    cashReceived: paymentMethod === 'cash' ? cashReceived! : null,
    changeAmount: paymentMethod === 'cash' ? cashReceived! - total : null,
    receiptNumber,
    createdBy,
  }).returning()

  // Guardia: solo se marcan ítems aún sin boleta. Si alguno ya tenía, se aborta
  // la transacción completa en lugar de "robarlo" para una segunda boleta.
  const targetIds = targetItems.map(i => i.id)
  const marked = await tx.update(orderItems)
    .set({ billId: bill.id })
    .where(and(inArray(orderItems.id, targetIds), isNull(orderItems.billId)))
    .returning({ id: orderItems.id })
  if (marked.length !== targetIds.length) {
    throw new BillingError('Algunos ítems ya fueron cobrados; actualiza y reintenta', 409, 'ITEMS_ALREADY_BILLED')
  }

  if (groupBeingPaid) {
    const groupRemaining = await tx.select({ id: orderItems.id }).from(orderItems).where(and(
      eq(orderItems.orderId, orderId),
      eq(orderItems.billGroupId, groupBeingPaid.id),
      isNull(orderItems.billId),
    ))
    if (groupRemaining.length === 0) {
      await tx.update(billGroups)
        .set({ status: 'paid', billId: bill.id })
        .where(eq(billGroups.id, groupBeingPaid.id))
    }
  }

  const remaining = await tx.select({ id: orderItems.id }).from(orderItems).where(and(
    eq(orderItems.orderId, orderId),
    isNull(orderItems.billId),
  ))
  const fullyPaid = remaining.length === 0

  if (fullyPaid) {
    await tx.update(orders)
      .set({ status: 'paid', updatedAt: new Date().toISOString() })
      .where(eq(orders.id, orderId))
    if (order.tableId) {
      await tx.update(tables).set({ status: 'free' }).where(eq(tables.id, order.tableId))
    }
  }

  return {
    bill,
    fullyPaid,
    order,
    items: targetItems.map(i => ({ ...i, billId: bill.id })),
  }
}
