import { Router } from 'express'
import { eq, gte, desc, sql } from 'drizzle-orm'
import { db } from '../db'
import { bills, orders, orderItems, expenses } from '../db/schema'
import { requireAuth, requireRole } from '../middleware/auth'

const router = Router()

function periodStart(period: string): string {
  const now = new Date()
  if (period === 'today') {
    now.setUTCHours(0, 0, 0, 0)
  } else if (period === 'week') {
    now.setDate(now.getDate() - 7)
    now.setUTCHours(0, 0, 0, 0)
  } else {
    now.setUTCDate(1)
    now.setUTCHours(0, 0, 0, 0)
  }
  return now.toISOString().replace('T', ' ').substring(0, 19)
}

// GET /api/reports/summary?period=today|week|month
router.get('/summary', requireAuth, requireRole('owner', 'cashier'), async (req, res) => {
  const period = (req.query.period as string) || 'today'
  const start = periodStart(period)

  const billList = await db.select().from(bills).where(gte(bills.paidAt, start))

  const totalSales = billList.reduce((s, b) => s + b.total, 0)
  const orderCount = billList.length
  const byMethod = {
    cash: billList.filter(b => b.paymentMethod === 'cash').reduce((s, b) => s + b.total, 0),
    yape: billList.filter(b => b.paymentMethod === 'yape').reduce((s, b) => s + b.total, 0),
    plin: billList.filter(b => b.paymentMethod === 'plin').reduce((s, b) => s + b.total, 0),
  }

  const topDishes = await db
    .select({
      dishName: orderItems.dishName,
      totalQty: sql<number>`sum(${orderItems.quantity})`,
      totalRevenue: sql<number>`sum(${orderItems.unitPrice} * ${orderItems.quantity})`,
    })
    .from(orderItems)
    .innerJoin(orders, eq(orderItems.orderId, orders.id))
    .innerJoin(bills, eq(bills.orderId, orders.id))
    .where(gte(bills.paidAt, start))
    .groupBy(orderItems.dishName)
    .orderBy(desc(sql<number>`sum(${orderItems.quantity})`))
    .limit(8)

  const daily = await db
    .select({
      date: sql<string>`date(${bills.paidAt})`,
      total: sql<number>`sum(${bills.total})`,
      count: sql<number>`count(*)`,
    })
    .from(bills)
    .where(gte(bills.paidAt, start))
    .groupBy(sql`date(${bills.paidAt})`)
    .orderBy(sql`date(${bills.paidAt})`)

  res.json({ totalSales, orderCount, byMethod, topDishes, daily })
})

// GET /api/reports/expenses?period=today|week|month
router.get('/expenses', requireAuth, requireRole('owner', 'cashier'), async (req, res) => {
  const period = (req.query.period as string) || 'today'
  const start = periodStart(period).substring(0, 10)

  const list = await db.select().from(expenses)
    .where(gte(expenses.date, start))
    .orderBy(desc(expenses.date))

  res.json(list)
})

// GET /api/reports/bills?period=today|week|month
router.get('/bills', requireAuth, requireRole('owner', 'cashier'), async (req, res) => {
  const period = (req.query.period as string) || 'today'
  const start = periodStart(period)

  const result = await db
    .select({
      id:            bills.id,
      receiptNumber: bills.receiptNumber,
      paidAt:        bills.paidAt,
      total:         bills.total,
      paymentMethod: bills.paymentMethod,
      orderType:     orders.type,
      tableId:       orders.tableId,
      customerName:  orders.customerName,
    })
    .from(bills)
    .innerJoin(orders, eq(bills.orderId, orders.id))
    .where(gte(bills.paidAt, start))
    .orderBy(desc(bills.paidAt))

  res.json(result)
})

// POST /api/reports/expenses
router.post('/expenses', requireAuth, requireRole('owner', 'cashier'), async (req, res) => {
  const { description, amount, category, date, notes } = req.body
  const [expense] = await db.insert(expenses).values({
    description,
    amount,
    category: category || 'general',
    date: date || new Date().toISOString().substring(0, 10),
    notes: notes ?? null,
    createdBy: req.user!.id,
  }).returning()
  res.status(201).json(expense)
})

export default router
