import { Router } from 'express'
import { notInArray, inArray } from 'drizzle-orm'
import { db } from '../db'
import { orders, orderItems } from '../db/schema'
import { requireAuth, requireRole } from '../middleware/auth'
import { validateBody } from '../middleware/validate'
import {
  CreateOrderSchema,
  AddItemsSchema,
  UpdateOrderStatusSchema,
  CancelOrderSchema,
  ReprintKitchenSchema,
  type OrderItemInput,
} from '../schemas/orders'
import { emit } from '../realtime'
import { getFullOrder } from '../services/order.serializer'
import { createOrder, addItems, setOrderStatus, cancelOrder } from '../services/order.service'
import { printKitchenTicket } from '../utils/printer'
import { buildKitchenTicketData, orderLabel, selectReprint } from '../utils/tickets'
import { withWriteLock } from '../db/write-lock'

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

  const full = await getFullOrder(db, opts.orderId)
  if (!full) return
  const label = orderLabel(full)

  try {
    const items = full.items.filter(i => opts.itemIds.includes(i.id))
    await printKitchenTicket(buildKitchenTicketData({
      order: full, items, waiterName: opts.waiterName, isAddition: opts.isAddition,
    }))

    // Corre en segundo plano y puede coincidir con un cobro: pasa por el candado.
    await withWriteLock(() => db.update(orderItems)
      .set({ kitchenPrinted: true })
      .where(inArray(orderItems.id, opts.itemIds)))

    emit('kitchen:print-result', {
      orderId: opts.orderId,
      ok: true,
      isAddition: opts.isAddition,
      label,
      itemCount: opts.itemIds.length,
    })
    // kitchenPrinted cambió: los dispositivos lo necesitan para el aviso de reimpresión
    const updated = await getFullOrder(db, opts.orderId)
    if (updated) emit('order:updated', updated)
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

// POST /api/orders/:id/reprint-kitchen — reimprimir la comanda (T6, TD-17)
// body opcional: { onlyUnprinted: true } reintenta solo lo que no llegó a cocina.
router.post('/:id/reprint-kitchen', requireAuth, validateBody(ReprintKitchenSchema), async (req, res) => {
  const orderId = Number(req.params.id)
  const onlyUnprinted = Boolean((req.body as { onlyUnprinted?: boolean } | undefined)?.onlyUnprinted)
  const full = await getFullOrder(db, orderId)
  if (!full) { res.status(404).json({ error: 'Pedido no encontrado' }); return }
  const { items, isReprint, isAddition } = selectReprint(full.items, onlyUnprinted)
  if (items.length === 0) {
    res.status(400).json({
      error: onlyUnprinted ? 'Todos los platos ya llegaron a cocina' : 'No hay items para imprimir',
      code: 'NOTHING_TO_PRINT',
    })
    return
  }
  const label = orderLabel(full)

  try {
    // La impresión ocurre fuera del candado de escritura: puede tardar segundos.
    await printKitchenTicket(buildKitchenTicketData({
      order: full, items, waiterName: req.user!.name, isAddition, isReprint,
    }))
    const printedIds = items.map(i => i.id)
    await withWriteLock(() => db.update(orderItems)
      .set({ kitchenPrinted: true })
      .where(inArray(orderItems.id, printedIds)))

    emit('kitchen:print-result', {
      orderId, ok: true, isAddition, label, itemCount: items.length, manual: true,
    })
    const updated = await getFullOrder(db, orderId)
    if (updated) emit('order:updated', updated)
    res.json({ ok: true, printed: items.length })
  } catch (err: any) {
    const reason = err?.message ?? 'Error al imprimir'
    emit('kitchen:print-result', {
      orderId, ok: false, isAddition, label, itemCount: items.length, reason, manual: true,
    })
    res.status(502).json({ error: reason, code: 'PRINTER_UNAVAILABLE' })
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
