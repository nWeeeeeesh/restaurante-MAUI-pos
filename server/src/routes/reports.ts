import { Router } from 'express'
import { eq, gte, desc } from 'drizzle-orm'
import { db } from '../db'
import { bills, orders, expenses, tables, auditLog, users } from '../db/schema'
import { requireAuth, requireRole } from '../middleware/auth'
import { validateBody, validateQuery } from '../middleware/validate'
import {
  CreateExpenseSchema, UpdateExpenseSchema, DeleteExpenseSchema,
  PeriodQuerySchema,
} from '../schemas/reports'
import { periodStart, localDateString } from '../utils/dates'
import { salesSummary } from '../services/report.service'
import { audit } from '../services/audit'
import { withWriteLock } from '../db/write-lock'
import { DomainError } from '../errors'
import { ExpenseKindSchema, type ExpenseKindInput } from '../schemas/profitability'
import { listExpenseCategories, setExpenseKind } from '../services/recipes.service'

const router = Router()

// GET /api/reports/summary?period=today|week|month
router.get('/summary', requireAuth, requireRole('owner', 'manager'), validateQuery(PeriodQuerySchema), async (req, res) => {
  const period = (req.query.period as string) || 'today'
  const start = periodStart(period)

  res.json(await salesSummary(db, start))
})

// Tipo de cada categoría de gasto (RF06): los fijos entran en las ventas de equilibrio
router.get('/expense-categories', requireAuth, requireRole('owner'), async (_req, res) => {
  res.json(await listExpenseCategories(db))
})

router.put('/expense-categories/:category', requireAuth, requireRole('owner'), validateBody(ExpenseKindSchema), async (req, res) => {
  const category = String(req.params.category).trim()
  if (category === '' || category.length > 40) throw new DomainError('Categoría inválida', 400, 'INVALID_CATEGORY')
  res.json(await setExpenseKind(db, category, req.body as ExpenseKindInput, req.user!.id))
})

// GET /api/reports/expenses?period=today|week|month
router.get('/expenses', requireAuth, requireRole('owner', 'manager'), validateQuery(PeriodQuerySchema), async (req, res) => {
  const period = (req.query.period as string) || 'today'
  const start = periodStart(period).substring(0, 10)

  const list = await db.select().from(expenses)
    .where(gte(expenses.date, start))
    .orderBy(desc(expenses.date))

  res.json(list)
})

// GET /api/reports/bills?period=today|week|month
router.get('/bills', requireAuth, requireRole('owner', 'manager'), validateQuery(PeriodQuerySchema), async (req, res) => {
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

// GET /api/reports/audit?period=today|week|month — cancelaciones, correcciones y
// cambios sensibles del período (M10). Es la herramienta del dueño para revisar
// lo que se hizo en su ausencia.
router.get('/audit', requireAuth, requireRole('owner', 'manager'), validateQuery(PeriodQuerySchema), async (req, res) => {
  const period = (req.query.period as string) || 'today'
  const rows = await db
    .select({
      id: auditLog.id,
      at: auditLog.at,
      action: auditLog.action,
      entity: auditLog.entity,
      entityId: auditLog.entityId,
      data: auditLog.data,
      userName: users.name,
    })
    .from(auditLog)
    .leftJoin(users, eq(auditLog.userId, users.id))
    .where(gte(auditLog.at, periodStart(period)))
    .orderBy(desc(auditLog.at))
    .limit(500)
  res.json(rows.map(r => ({ ...r, data: r.data ? JSON.parse(r.data) : null })))
})

// ── Gastos (D6) ──────────────────────────────────────────────────────────────
// Solo encargado y dueño registran, corrigen o borran gastos: el cajero maneja
// ingresos y quien autoriza los egresos es otra persona. Corregir o borrar exige
// motivo y queda en audit_log con los datos anteriores.

// POST /api/reports/expenses
router.post('/expenses', requireAuth, requireRole('owner', 'manager'), validateBody(CreateExpenseSchema), async (req, res) => {
  const { description, amount, category, date, notes } = req.body
  const [expense] = await withWriteLock(() => db.insert(expenses).values({
    description,
    amount,
    category: category || 'general',
    date: date || localDateString(),
    notes: notes ?? null,
    createdBy: req.user!.id,
  }).returning())
  res.status(201).json(expense)
})

// PATCH /api/reports/expenses/:id — body: campos a cambiar + reason
router.patch('/expenses/:id', requireAuth, requireRole('owner', 'manager'), validateBody(UpdateExpenseSchema), async (req, res) => {
  const id = Number(req.params.id)
  const { reason, ...changes } = req.body as { reason: string } & Partial<typeof expenses.$inferInsert>
  const updated = await withWriteLock(() => db.transaction(async (tx) => {
    const [before] = await tx.select().from(expenses).where(eq(expenses.id, id))
    if (!before) throw new DomainError('Gasto no encontrado', 404, 'EXPENSE_NOT_FOUND')
    const [after] = await tx.update(expenses).set(changes).where(eq(expenses.id, id)).returning()
    await audit(tx, { userId: req.user!.id, action: 'expense.update', entity: 'expense', entityId: id, data: { reason, before, after } })
    return after
  }))
  res.json(updated)
})

// DELETE /api/reports/expenses/:id — body: { reason }
router.delete('/expenses/:id', requireAuth, requireRole('owner', 'manager'), validateBody(DeleteExpenseSchema), async (req, res) => {
  const id = Number(req.params.id)
  const { reason } = req.body as { reason: string }
  await withWriteLock(() => db.transaction(async (tx) => {
    const [before] = await tx.select().from(expenses).where(eq(expenses.id, id))
    if (!before) throw new DomainError('Gasto no encontrado', 404, 'EXPENSE_NOT_FOUND')
    await tx.delete(expenses).where(eq(expenses.id, id))
    // El gasto borrado queda íntegro en el registro
    await audit(tx, { userId: req.user!.id, action: 'expense.delete', entity: 'expense', entityId: id, data: { reason, before } })
  }))
  res.json({ ok: true })
})

export default router
