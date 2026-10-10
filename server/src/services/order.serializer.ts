import { eq } from 'drizzle-orm'
import { orders, orderItems, billGroups, tables } from '../db/schema'
import type { Executor } from '../db'

// Los timestamps de SQLite (datetime('now')) están en UTC sin zona: 'YYYY-MM-DD HH:MM:SS'.
function dbUtcToIso(value: string | null): string {
  if (!value) return new Date().toISOString()
  return new Date(value.includes('T') ? value : value.replace(' ', 'T') + 'Z').toISOString()
}

// Forma única del pedido que consumen la API y los eventos de socket.
// Antes había tres copias (orders, split, bills). tableNumber es el número
// visible de la mesa; tableId es solo la clave técnica (TD-06).
export async function getFullOrder(db: Executor, orderId: number) {
  const [row] = await db
    .select({ order: orders, tableNumber: tables.number })
    .from(orders)
    .leftJoin(tables, eq(orders.tableId, tables.id))
    .where(eq(orders.id, orderId))
  if (!row) return null

  const items = await db.select().from(orderItems).where(eq(orderItems.orderId, orderId))
  const groups = await db.select().from(billGroups).where(eq(billGroups.orderId, orderId))
  return {
    ...row.order,
    tableNumber: row.tableNumber ?? null,
    createdAt: dbUtcToIso(row.order.createdAt),
    items: items.map(i => ({ ...i, modifiers: JSON.parse(i.modifiers ?? '[]') })),
    billGroups: groups,
  }
}

export type FullOrder = NonNullable<Awaited<ReturnType<typeof getFullOrder>>>
