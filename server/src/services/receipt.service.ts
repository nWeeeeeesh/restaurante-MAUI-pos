import { eq } from 'drizzle-orm'
import { bills, orders, orderItems, users, tables } from '../db/schema'
import type { Executor } from '../db'
import type { ReceiptData } from '../utils/printer'
import { ticketDate } from '../utils/tickets'

export type ReceiptView = ReceiptData & {
  billId: number
  orderId: number | null
  items: Array<ReceiptData['items'][number] & { id: number }>
}

// La boleta (vista previa e impresión) se arma SIEMPRE desde lo registrado en la
// BD (TD-14). Antes el cliente enviaba número, ítems y total, y cualquier rol podía
// imprimir una "boleta" con contenido arbitrario.
export async function buildReceipt(db: Executor, billId: number): Promise<ReceiptView | null> {
  const [bill] = await db.select().from(bills).where(eq(bills.id, billId))
  if (!bill) return null

  const items = await db.select().from(orderItems).where(eq(orderItems.billId, billId))

  let order: { type: 'dine_in' | 'delivery'; customerName: string | null; tableNumber: number | null } | null = null
  if (bill.orderId !== null) {
    const [row] = await db.select({ type: orders.type, customerName: orders.customerName, tableNumber: tables.number })
      .from(orders).leftJoin(tables, eq(orders.tableId, tables.id))
      .where(eq(orders.id, bill.orderId))
    order = row ?? null
  }

  let cashierName = 'Cajero'
  if (bill.createdBy !== null) {
    const [u] = await db.select({ name: users.name }).from(users).where(eq(users.id, bill.createdBy))
    if (u) cashierName = u.name
  }

  return {
    billId: bill.id,
    orderId: bill.orderId,
    receiptNumber: bill.receiptNumber,
    // paid_at está en UTC 'YYYY-MM-DD HH:MM:SS'; se muestra en hora local del servidor
    date: ticketDate(bill.paidAt ? new Date(bill.paidAt.replace(' ', 'T') + 'Z') : new Date()),
    orderType: order?.type === 'delivery' ? 'delivery' : 'dine-in',
    tableNumber: order?.tableNumber ?? null,
    customerName: order?.customerName ?? null,
    cashierName,
    items: items.map(i => ({
      id: i.id,
      dishName: i.dishName,
      quantity: i.quantity ?? 1,
      unitPrice: i.unitPrice,
      modifiers: JSON.parse(i.modifiers ?? '[]'),
    })),
    paymentMethod: bill.paymentMethod,
    cashReceived: bill.cashReceived,
    changeAmount: bill.changeAmount,
    total: bill.total,
  }
}
