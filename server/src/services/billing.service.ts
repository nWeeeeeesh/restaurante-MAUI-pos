import { eq, and, isNull, inArray, sql } from 'drizzle-orm'
import { bills, orders, orderItems, tables, billGroups } from '../db/schema'
import type { DB } from '../db'
import { sumItems } from '../utils/math'

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
  // Datos de la orden originales (antes del tx), usados para el emit post-commit.
  order: typeof orders.$inferSelect
}

export class BillingError extends Error {
  constructor(message: string, public readonly statusCode: number) {
    super(message)
    this.name = 'BillingError'
  }
}

export async function createBill(db: DB, params: CreateBillParams): Promise<CreateBillResult> {
  const { orderId, paymentMethod, cashReceived, itemIds, billGroupId, createdBy } = params

  const [order] = await db.select().from(orders).where(eq(orders.id, orderId))
  if (!order) throw new BillingError('Pedido no encontrado', 404)

  // ── Resolución de items objetivo ──────────────────────────────────────────
  // 3 modos de cobro:
  //  1. billGroupId + itemIds → solo los items confirmados de esa sub-cuenta
  //  2. billGroupId solo     → todos los abiertos de la sub-cuenta
  //  3. itemIds solo         → items específicos sin sub-cuenta
  //  4. ninguno              → cobro completo (todos los pendientes)
  let targetItems: (typeof orderItems.$inferSelect)[]
  let groupBeingPaid: typeof billGroups.$inferSelect | null = null

  if (billGroupId) {
    const [grp] = await db.select().from(billGroups)
      .where(and(eq(billGroups.id, billGroupId), eq(billGroups.orderId, orderId)))
    if (!grp) throw new BillingError('Sub-cuenta no encontrada', 404)
    if (grp.status === 'paid') throw new BillingError('Esta sub-cuenta ya fue cobrada', 409)
    groupBeingPaid = grp

    if (Array.isArray(itemIds) && itemIds.length > 0) {
      targetItems = await db.select().from(orderItems).where(and(
        eq(orderItems.orderId, orderId),
        eq(orderItems.billGroupId, grp.id),
        inArray(orderItems.id, itemIds),
        isNull(orderItems.billId),
      ))
    } else {
      targetItems = await db.select().from(orderItems).where(and(
        eq(orderItems.orderId, orderId),
        eq(orderItems.billGroupId, grp.id),
        isNull(orderItems.billId),
      ))
    }
  } else if (Array.isArray(itemIds) && itemIds.length > 0) {
    targetItems = await db.select().from(orderItems).where(and(
      eq(orderItems.orderId, orderId),
      inArray(orderItems.id, itemIds),
      isNull(orderItems.billId),
    ))
  } else {
    targetItems = await db.select().from(orderItems).where(and(
      eq(orderItems.orderId, orderId),
      isNull(orderItems.billId),
    ))
  }

  if (targetItems.length === 0) throw new BillingError('No hay items pendientes de cobro', 400)

  const total = sumItems(targetItems)

  if (paymentMethod === 'cash') {
    if (typeof cashReceived !== 'number' || cashReceived < total) {
      throw new BillingError(
        `Monto recibido insuficiente: S/ ${(cashReceived ?? 0).toFixed(2)} < S/ ${total.toFixed(2)}`,
        400,
      )
    }
  }

  // ── Transacción atómica con retry por colisión de número de boleta ────────
  // SQLite tiene un único escritor, así que la carrera es extremamente rara,
  // pero el UNIQUE en receiptNumber + hasta 3 intentos la cubre por completo.
  let result: { bill: typeof bills.$inferSelect; fullyPaid: boolean } | undefined

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      result = await db.transaction(async (tx) => {
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

        await tx.update(orderItems)
          .set({ billId: bill.id })
          .where(inArray(orderItems.id, targetItems.map(i => i.id)))

        if (groupBeingPaid) {
          const groupRemaining = await tx.select().from(orderItems).where(and(
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

        const remaining = await tx.select().from(orderItems).where(and(
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

        return { bill, fullyPaid }
      })
      break
    } catch (err: any) {
      if (/UNIQUE/i.test(String(err?.message ?? '')) && attempt < 2) continue
      throw err
    }
  }

  if (!result) throw new Error('No se pudo generar el número de boleta tras 3 intentos')

  return { ...result, order }
}
