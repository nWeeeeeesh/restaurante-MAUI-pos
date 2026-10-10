import { Router } from 'express'
import { eq, gte, desc } from 'drizzle-orm'
import { db } from '../db'
import { bills, orders, expenses, tables } from '../db/schema'
import { requireAuth, requireRole } from '../middleware/auth'
import { validateBody, validateQuery } from '../middleware/validate'
import {
  CreateExpenseSchema, UpdateExpenseSchema,
  PeriodQuerySchema,
} from '../schemas/reports'
import { periodStart, localDateString } from '../utils/dates'
import { salesSummary } from '../services/report.service'

const router = Router()

// GET /api/reports/summary?period=today|week|month
router.get('/summary', requireAuth, requireRole('owner', 'cashier'), validateQuery(PeriodQuerySchema), async (req, res) => {
  const period = (req.query.period as string) || 'today'
  const start = periodStart(period)

  res.json(await salesSummary(db, start))
})

// GET /api/reports/expenses?period=today|week|month
router.get('/expenses', requireAuth, requireRole('owner', 'cashier'), validateQuery(PeriodQuerySchema), async (req, res) => {
  const period = (req.query.period as string) || 'today'
  const start = periodStart(period).substring(0, 10)

  const list = await db.select().from(expenses)
    .where(gte(expenses.date, start))
    .orderBy(desc(expenses.date))

  res.json(list)
})

// GET /api/reports/bills?period=today|week|month
router.get('/bills', requireAuth, requireRole('owner', 'cashier'), validateQuery(PeriodQuerySchema), async (req, res) => {
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
      tableNumber:   tables.number,
      customerName:  orders.customerName,
    })
    .from(bills)
    .innerJoin(orders, eq(bills.orderId, orders.id))
    .leftJoin(tables, eq(orders.tableId, tables.id))
    .where(gte(bills.paidAt, start))
    .orderBy(desc(bills.paidAt))

  res.json(result)
})

// POST /api/reports/expenses
router.post('/expenses', requireAuth, requireRole('owner', 'cashier'), validateBody(CreateExpenseSchema), async (req, res) => {
  const { description, amount, category, date, notes } = req.body
  const [expense] = await db.insert(expenses).values({
    description,
    amount,
    category: category || 'general',
    date: date || localDateString(),
    notes: notes ?? null,
    createdBy: req.user!.id,
  }).returning()
  res.status(201).json(expense)
})

// PATCH /api/reports/expenses/:id
router.patch('/expenses/:id', requireAuth, requireRole('owner'), validateBody(UpdateExpenseSchema), async (req, res) => {
  const id = Number(req.params.id)
  const [existing] = await db.select().from(expenses).where(eq(expenses.id, id))
  if (!existing) { res.status(404).json({ error: 'Gasto no encontrado' }); return }

  const [updated] = await db.update(expenses)
    .set(req.body)
    .where(eq(expenses.id, id))
    .returning()
  res.json(updated)
})

// DELETE /api/reports/expenses/:id
router.delete('/expenses/:id', requireAuth, requireRole('owner'), async (req, res) => {
  const id = Number(req.params.id)
  const [existing] = await db.select().from(expenses).where(eq(expenses.id, id))
  if (!existing) { res.status(404).json({ error: 'Gasto no encontrado' }); return }

  await db.delete(expenses).where(eq(expenses.id, id))
  res.json({ ok: true })
})

export default router
