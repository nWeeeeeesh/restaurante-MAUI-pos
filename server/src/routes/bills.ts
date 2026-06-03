import { Router } from 'express'
import { eq, and, gte, lte, desc, sql, inArray } from 'drizzle-orm'
import { db } from '../db'
import { bills, orders, orderItems, billGroups, users } from '../db/schema'
import { requireAuth, requireRole } from '../middleware/auth'
import { validateBody } from '../middleware/validate'
import { CreateBillSchema } from '../schemas/bills'
import { io } from '../index'
import { localDayStart, localDayEnd, parseDayBoundary } from '../utils/dates'
import { createBill, BillingError } from '../services/billing.service'

const router = Router()

// C7: atómico. Antes hacía SELECT * y Math.max en JS, escalando linealmente
// con el historial y siendo no-atómico (dos llamadas concurrentes podían
// retornar el mismo lastNumber). Ahora una sola query SQL.
router.get('/next-number', requireAuth, async (_req, res) => {
  // El formato es "B001-NNNNN". Extraemos la parte después del primer '-'.
  // INSTR retorna 0 si no encuentra '-', en cuyo caso SUBSTR desde 1 toma
  // todo el string y CAST a integer da 0 si no es numérico. Seguro.
  const [row] = await db
    .select({
      max: sql<number | null>`MAX(CAST(SUBSTR(${bills.receiptNumber}, INSTR(${bills.receiptNumber}, '-')+1) AS INTEGER))`,
    })
    .from(bills)
  res.json({ lastNumber: row?.max ?? 0 })
})

// GET /api/bills — historial. waiter/cashier ven solo HOY; owner puede pasar from/to
router.get('/', requireAuth, async (req, res) => {
  const role = req.user!.role
  let from: string
  let to: string

  if (role === 'owner') {
    from = req.query.from ? parseDayBoundary(String(req.query.from), 'start') : localDayStart()
    to   = req.query.to   ? parseDayBoundary(String(req.query.to),   'end')   : localDayEnd()
  } else {
    // waiter / cashier solo ven el día actual
    from = localDayStart()
    to   = localDayEnd()
  }

  const rows = await db.select().from(bills)
    .where(and(gte(bills.paidAt, from), lte(bills.paidAt, to)))
    .orderBy(desc(bills.paidAt))

  // Enriquecer con info del pedido (mesa/customer) y cajero
  const orderIds = [...new Set(rows.map(b => b.orderId).filter((x): x is number => x !== null))]
  const userIds  = [...new Set(rows.map(b => b.createdBy).filter((x): x is number => x !== null))]
  const ords  = orderIds.length ? await db.select().from(orders).where(inArray(orders.id, orderIds)) : []
  const usrs  = userIds.length  ? await db.select().from(users).where(inArray(users.id, userIds))   : []
  const ordById = new Map(ords.map(o => [o.id, o]))
  const usrById = new Map(usrs.map(u => [u.id, u]))

  const enriched = rows.map(b => {
    const o = b.orderId !== null ? ordById.get(b.orderId) : undefined
    const u = b.createdBy !== null ? usrById.get(b.createdBy) : undefined
    return {
      ...b,
      orderType: o?.type ?? null,
      tableId: o?.tableId ?? null,
      customerName: o?.customerName ?? null,
      cashierName: u?.name ?? null,
    }
  })
  res.json({ from, to, role, bills: enriched })
})

// GET /api/bills/:id — detalle (items + datos pedido)
router.get('/:id', requireAuth, async (req, res) => {
  const id = Number(req.params.id)
  const [bill] = await db.select().from(bills).where(eq(bills.id, id))
  if (!bill) { res.status(404).json({ error: 'Boleta no encontrada' }); return }

  // waiter/cashier solo pueden ver boletas del día actual
  if (req.user!.role !== 'owner') {
    if (!bill.paidAt || bill.paidAt < localDayStart() || bill.paidAt > localDayEnd()) {
      res.status(403).json({ error: 'Sin permisos para boletas anteriores' })
      return
    }
  }

  const items = bill.id !== null
    ? await db.select().from(orderItems).where(eq(orderItems.billId, bill.id))
    : []

  let order: any = null
  if (bill.orderId !== null) {
    const [o] = await db.select().from(orders).where(eq(orders.id, bill.orderId))
    order = o ?? null
  }
  let cashier: any = null
  if (bill.createdBy !== null) {
    const [u] = await db.select().from(users).where(eq(users.id, bill.createdBy))
    cashier = u ? { id: u.id, name: u.name, username: u.username } : null
  }

  res.json({
    bill,
    order,
    cashier,
    items: items.map(i => ({ ...i, modifiers: JSON.parse(i.modifiers ?? '[]') })),
  })
})

router.post('/', requireAuth, requireRole('owner', 'cashier'), validateBody(CreateBillSchema), async (req, res) => {
  const { orderId, paymentMethod, cashReceived, itemIds, billGroupId } = req.body

  let result
  try {
    result = await createBill(db, { orderId, paymentMethod, cashReceived, itemIds, billGroupId, createdBy: req.user!.id })
  } catch (err) {
    if (err instanceof BillingError) {
      res.status(err.statusCode).json({ error: err.message })
      return
    }
    console.error('[bills POST]', err)
    res.status(500).json({ error: 'Error interno al crear boleta' })
    return
  }

  // Emits post-commit: suceden DESPUÉS de que la transacción está commiteada.
  const { bill, fullyPaid, order } = result
  if (fullyPaid) {
    io.emit('order:removed', orderId)
  } else {
    const updatedItems = await db.select().from(orderItems).where(eq(orderItems.orderId, orderId))
    const updatedGroups = await db.select().from(billGroups).where(eq(billGroups.orderId, orderId))
    io.emit('order:updated', {
      ...order,
      createdAt: order.createdAt ? new Date(order.createdAt + 'Z').toISOString() : new Date().toISOString(),
      items: updatedItems.map(i => ({ ...i, modifiers: JSON.parse(i.modifiers ?? '[]') })),
      billGroups: updatedGroups,
    })
  }

  res.status(201).json({ ...bill, fullyPaid })
})

export default router
