import { eq, gte, desc, sql } from 'drizzle-orm'
import { bills, orderItems } from '../db/schema'
import type { Executor } from '../db'
import { roundMoney } from '../utils/math'
import { sqliteLocalOffset } from '../utils/dates'

// Resumen de ventas desde startUtc ('YYYY-MM-DD HH:MM:SS' en UTC, como paid_at).
// tzOffsetMinutes = Date#getTimezoneOffset() del servidor (300 en Lima); se
// inyecta para que los tests no dependan de la zona de la máquina.
export async function salesSummary(db: Executor, startUtc: string, tzOffsetMinutes = new Date().getTimezoneOffset()) {
  const billList = await db.select().from(bills).where(gte(bills.paidAt, startUtc))

  const sumBy = (list: typeof billList) => roundMoney(list.reduce((s, b) => s + b.total, 0))
  const byMethod = {
    cash: sumBy(billList.filter(b => b.paymentMethod === 'cash')),
    yape: sumBy(billList.filter(b => b.paymentMethod === 'yape')),
    plin: sumBy(billList.filter(b => b.paymentMethod === 'plin')),
  }

  // TD-09: cada ítem se cuenta por la boleta que lo cobró (order_items.bill_id).
  // Antes se unía por pedido y un pedido con N boletas multiplicaba sus ítems por N
  // (y además incluía ítems aún no cobrados).
  const topDishes = await db
    .select({
      dishName: orderItems.dishName,
      totalQty: sql<number>`sum(${orderItems.quantity})`,
      totalRevenue: sql<number>`round(sum(${orderItems.unitPrice} * ${orderItems.quantity}), 2)`,
    })
    .from(orderItems)
    .innerJoin(bills, eq(bills.id, orderItems.billId))
    .where(gte(bills.paidAt, startUtc))
    .groupBy(orderItems.dishName)
    .orderBy(desc(sql<number>`sum(${orderItems.quantity})`))
    .limit(8)

  // TD-10: el día de cada venta es el día LOCAL. date(paid_at) agrupaba por día UTC
  // y las ventas posteriores a las 19:00 (Lima) caían en el día siguiente.
  const localDay = sql<string>`date(${bills.paidAt}, ${sqliteLocalOffset(tzOffsetMinutes)})`
  const daily = await db
    .select({
      date: localDay,
      total: sql<number>`round(sum(${bills.total}), 2)`,
      count: sql<number>`count(*)`,
    })
    .from(bills)
    .where(gte(bills.paidAt, startUtc))
    .groupBy(localDay)
    .orderBy(localDay)

  return {
    totalSales: sumBy(billList),
    // Cantidad de boletas (un pedido con cuenta dividida genera varias)
    billCount: billList.length,
    byMethod,
    topDishes,
    daily,
  }
}
