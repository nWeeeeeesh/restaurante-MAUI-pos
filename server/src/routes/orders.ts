import { Router } from 'express'
import { eq, and, notInArray, inArray } from 'drizzle-orm'
import { db } from '../db'
import { orders, orderItems } from '../db/schema'
import { requireAuth, requireRole } from '../middleware/auth'
import { validateBody } from '../middleware/validate'
import {
  CreateOrderSchema,
  AddItemsSchema,
  UpdateOrderStatusSchema,
  CancelOrderSchema,
  type OrderItemInput,
} from '../schemas/orders'
import { emit } from '../realtime'
import { getFullOrder } from '../services/order.serializer'
import { createOrder, addItems, setOrderStatus, cancelOrder } from '../services/order.service'
import { printKitchenTicket } from '../utils/printer'

const router = Router()

// Auto-imprime comanda. Si la impresora no responde, el pedido se guarda igual
// y se emite un socket event para que el frontend muestre el toast correspondiente.
async function autoPrintKitchen(opts: {
  orderId: number
  isAddition: boolean
  itemIds: number[]
  waiterName: string
}) {
  if (opts.itemIds.length === 0) return

  const [ord] = await db.select().from(orders).where(eq(orders.id, opts.orderId))
  if (!ord) return
  const label = ord.type === 'delivery'
    ? `Delivery${ord.customerName ? ` · ${ord.customerName}` : ''}`
    : `Mesa ${ord.tableId}`

  try {
    const items = await db.select().from(orderItems)
      .where(inArray(orderItems.id, opts.itemIds))

    const date = new Date().toLocaleString('es-PE', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    })

    await printKitchenTicket({
      orderId: opts.orderId,
      orderType: ord.type === 'delivery' ? 'delivery' : 'dine-in',
      tableId: ord.tableId,
      customerName: ord.customerName,
      waiterName: opts.waiterName,
      date,
      isAddition: opts.isAddition,
      items: items.map(i => ({
        dishName: i.dishName,
        quantity: i.quantity ?? 1,
        modifiers: JSON.parse(i.modifiers ?? '[]'),
        notes: i.notes,
      })),
    })

    await db.update(orderItems)
      .set({ kitchenPrinted: true })
      .where(inArray(orderItems.id, opts.itemIds))

    emit('kitchen:print-result', {
      orderId: opts.orderId,
      ok: true,
      isAddition: opts.isAddition,
      label,
      itemCount: opts.itemIds.length,
    })
  } catch (err: any) {
    const reason = err?.message ?? String(err)
    console.warn('[kitchen-print] Falla al imprimir comanda:', reason)
    emit('kitchen:print-result', {
      orderId: opts.orderId,
      ok: false,
      isAddition: opts.isAddition,
      label,
      itemCount: opts.itemIds.length,
      reason,
    })
  }
}

// GET /api/orders/active
router.get('/active', requireAuth, async (_req, res) => {
  const activeOrders = await db.select().from(orders)
    .where(notInArray(orders.status, ['paid', 'cancelled']))
  const result = await Promise.all(activeOrders.map(o => getFullOrder(db, o.id)))
  res.json(result.filter(Boolean))
})

// GET /api/orders/:id
router.get('/:id', requireAuth, async (req, res) => {
  const order = await getFullOrder(db, Number(req.params.id))
  if (!order) { res.status(404).json({ error: 'Pedido no encontrado' }); return }
  res.json(order)
})

// POST /api/orders — create new order
router.post('/', requireAuth, validateBody(CreateOrderSchema), async (req, res) => {
  // Verificación de mesa, precios del catálogo, inserciones y mesa ocupada en una
  // sola transacción bajo el candado (TD-04, TD-01).
  const { orderId, insertedIds } = await createOrder(db, req.body, req.user!.id)

  // Imprimir comanda en cocina después del commit (no bloquea respuesta si falla)
  autoPrintKitchen({
    orderId,
    isAddition: false,
    itemIds: insertedIds,
    waiterName: req.user!.name,
  })

  const full = await getFullOrder(db, orderId)
  emit('order:new', full)
  res.status(201).json(full)
})

// POST /api/orders/:id/items — add items to existing order
router.post('/:id/items', requireAuth, validateBody(AddItemsSchema), async (req, res) => {
  const orderId = Number(req.params.id)
  const { items: reqItems } = req.body as { items: OrderItemInput[] }

  // 404 si no existe, 409 si está pagado o cancelado (TD-07)
  const { insertedIds } = await addItems(db, orderId, reqItems)

  // Imprime SOLO los items nuevos en cocina (después del commit)
  autoPrintKitchen({
    orderId,
    isAddition: true,
    itemIds: insertedIds,
    waiterName: req.user!.name,
  })

  const full = await getFullOrder(db, orderId)
  emit('order:updated', full)
  res.json(full)
})

// POST /api/orders/:id/reprint-kitchen — reimprimir comanda manualmente
router.post('/:id/reprint-kitchen', requireAuth, async (req, res) => {
  const orderId = Number(req.params.id)
  const items = await db.select().from(orderItems)
    .where(and(eq(orderItems.orderId, orderId), notInArray(orderItems.status, ['ready'])))

  if (items.length === 0) {
    res.status(400).json({ error: 'No hay items pendientes para imprimir' })
    return
  }

  const [ord] = await db.select().from(orders).where(eq(orders.id, orderId))
  if (!ord) { res.status(404).json({ error: 'Pedido no encontrado' }); return }
  const label = ord.type === 'delivery'
    ? `Delivery${ord.customerName ? ` · ${ord.customerName}` : ''}`
    : `Mesa ${ord.tableId}`

  try {
    const date = new Date().toLocaleString('es-PE', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    })

    await printKitchenTicket({
      orderId,
      orderType: ord.type === 'delivery' ? 'delivery' : 'dine-in',
      tableId: ord.tableId,
      customerName: ord.customerName,
      waiterName: req.user!.name,
      date,
      isAddition: false,
      items: items.map(i => ({
        dishName: i.dishName,
        quantity: i.quantity ?? 1,
        modifiers: JSON.parse(i.modifiers ?? '[]'),
        notes: i.notes,
      })),
    })

    emit('kitchen:print-result', {
      orderId, ok: true, isAddition: false, label, itemCount: items.length, manual: true,
    })
    res.json({ ok: true })
  } catch (err: any) {
    const reason = err?.message ?? 'Error al imprimir'
    emit('kitchen:print-result', {
      orderId, ok: false, isAddition: false, label, itemCount: items.length, reason, manual: true,
    })
    res.status(500).json({ error: reason })
  }
})

// PATCH /api/orders/:id/status — marcar/desmarcar 'por cobrar' (TD-08)
router.patch('/:id/status', requireAuth, validateBody(UpdateOrderStatusSchema), async (req, res) => {
  const orderId = Number(req.params.id)
  const { status } = req.body as { status: 'pending' | 'paying' }
  await setOrderStatus(db, orderId, status)
  const full = await getFullOrder(db, orderId)
  emit('order:updated', full)
  res.json(full)
})

// POST /api/orders/:id/cancel — cancelar con motivo (D1). El servicio aplica la
// política: con cobros, solo encargado o dueño; siempre queda en audit_log.
router.post(
  '/:id/cancel',
  requireAuth, requireRole('owner', 'manager', 'cashier'), validateBody(CancelOrderSchema),
  async (req, res) => {
    const orderId = Number(req.params.id)
    const { reason } = req.body as { reason: string }
    await cancelOrder(db, orderId, { id: req.user!.id, role: req.user!.role }, reason)
    emit('order:removed', orderId)
    res.json({ ok: true })
  },
)

export default router
