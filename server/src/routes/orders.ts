import { Router } from 'express'
import { eq, and, notInArray, inArray } from 'drizzle-orm'
import { db } from '../db'
import { orders, orderItems, tables, billGroups } from '../db/schema'
import { requireAuth } from '../middleware/auth'
import { validateBody } from '../middleware/validate'
import {
  CreateOrderSchema,
  AddItemsSchema,
  UpdateOrderStatusSchema,
  type OrderItemInput,
} from '../schemas/orders'
import { io } from '../index'
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

    io.emit('kitchen:print-result', {
      orderId: opts.orderId,
      ok: true,
      isAddition: opts.isAddition,
      label,
      itemCount: opts.itemIds.length,
    })
  } catch (err: any) {
    const reason = err?.message ?? String(err)
    console.warn('[kitchen-print] Falla al imprimir comanda:', reason)
    io.emit('kitchen:print-result', {
      orderId: opts.orderId,
      ok: false,
      isAddition: opts.isAddition,
      label,
      itemCount: opts.itemIds.length,
      reason,
    })
  }
}

// ─── Helper: fetch full order with items ──────────────────────────────────────
async function getFullOrder(orderId: number) {
  const [order] = await db.select().from(orders).where(eq(orders.id, orderId))
  if (!order) return null
  const items = await db.select().from(orderItems).where(eq(orderItems.orderId, orderId))
  const groups = await db.select().from(billGroups).where(eq(billGroups.orderId, orderId))
  return {
    ...order,
    createdAt: order.createdAt ? new Date(order.createdAt + 'Z').toISOString() : new Date().toISOString(),
    items: items.map(i => ({ ...i, modifiers: JSON.parse(i.modifiers ?? '[]') })),
    billGroups: groups,
  }
}

// GET /api/orders/active
router.get('/active', requireAuth, async (_req, res) => {
  const activeOrders = await db.select().from(orders)
    .where(notInArray(orders.status, ['paid', 'cancelled']))
  const result = await Promise.all(activeOrders.map(o => getFullOrder(o.id)))
  res.json(result.filter(Boolean))
})

// GET /api/orders/:id
router.get('/:id', requireAuth, async (req, res) => {
  const order = await getFullOrder(Number(req.params.id))
  if (!order) { res.status(404).json({ error: 'Pedido no encontrado' }); return }
  res.json(order)
})

// POST /api/orders — create new order
router.post('/', requireAuth, validateBody(CreateOrderSchema), async (req, res) => {
  const { tableId, type, customerName, customerPhone, customerAddress, notes, items: reqItems } = req.body

  if (tableId) {
    const [existing] = await db.select().from(orders)
      .where(and(eq(orders.tableId, tableId), notInArray(orders.status, ['paid', 'cancelled'])))
    if (existing) {
      res.status(409).json({ error: `La mesa ya tiene un pedido activo (#${existing.id}). Agrégalo desde la vista de la mesa.` })
      return
    }
  }

  const [order] = await db.insert(orders).values({
    tableId: tableId ?? null,
    type,
    status: 'pending',
    customerName: customerName ?? null,
    customerPhone: customerPhone ?? null,
    customerAddress: customerAddress ?? null,
    notes: notes ?? null,
    createdBy: req.user!.id,
  }).returning()

  let insertedIds: number[] = []
  if (reqItems?.length) {
    const inserted = await db.insert(orderItems).values(
      (reqItems as OrderItemInput[]).map((item) => ({
        orderId: order.id,
        dishId: item.dishId,
        dishName: item.dishName,
        unitPrice: item.unitPrice,
        quantity: item.quantity,
        modifiers: JSON.stringify(item.modifiers ?? []),
        notes: item.notes ?? null,
        status: 'pending' as const,
      }))
    ).returning({ id: orderItems.id })
    insertedIds = inserted.map(i => i.id)
  }

  // Update table status
  if (tableId) {
    await db.update(tables).set({ status: 'occupied' }).where(eq(tables.id, tableId))
  }

  // Imprimir comanda en cocina (no bloquea respuesta si falla)
  autoPrintKitchen({
    orderId: order.id,
    isAddition: false,
    itemIds: insertedIds,
    waiterName: req.user!.name,
  })

  const full = await getFullOrder(order.id)
  io.emit('order:new', full)
  res.status(201).json(full)
})

// POST /api/orders/:id/items — add items to existing order
router.post('/:id/items', requireAuth, validateBody(AddItemsSchema), async (req, res) => {
  const orderId = Number(req.params.id)
  const { items: reqItems } = req.body as { items: OrderItemInput[] }

  const inserted = await db.insert(orderItems).values(
    reqItems.map((item) => ({
      orderId,
      dishId: item.dishId,
      dishName: item.dishName,
      unitPrice: item.unitPrice,
      quantity: item.quantity,
      modifiers: JSON.stringify(item.modifiers ?? []),
      notes: item.notes ?? null,
      status: 'pending' as const,
    }))
  ).returning({ id: orderItems.id })

  // Manejo de items nuevos cuando la orden tiene cuenta dividida:
  //  - 1 grupo abierto         → auto-asignar a ese grupo
  //  - 0 abiertos y ≥1 pagados → auto-crear un nuevo grupo abierto para que los items
  //                              sean cobrables sin necesidad de pasar por el modal
  //  - 2+ abiertos             → quedan sin asignar y el cajero decide en el modal
  const groupsOnOrder = await db.select().from(billGroups).where(eq(billGroups.orderId, orderId))
  const openGroups = groupsOnOrder.filter(g => g.status === 'open')
  const paidGroups = groupsOnOrder.filter(g => g.status === 'paid')
  if (openGroups.length === 1) {
    await db.update(orderItems)
      .set({ billGroupId: openGroups[0].id })
      .where(inArray(orderItems.id, inserted.map(i => i.id)))
  } else if (openGroups.length === 0 && paidGroups.length > 0) {
    const nextLetter = String.fromCharCode(65 + groupsOnOrder.length)
    const [newGroup] = await db.insert(billGroups).values({
      orderId,
      label: `Cuenta ${nextLetter}`,
      status: 'open',
    }).returning()
    await db.update(orderItems)
      .set({ billGroupId: newGroup.id })
      .where(inArray(orderItems.id, inserted.map(i => i.id)))
  }

  await db.update(orders).set({ status: 'pending', updatedAt: new Date().toISOString() }).where(eq(orders.id, orderId))

  // Imprime SOLO los items nuevos en cocina
  autoPrintKitchen({
    orderId,
    isAddition: true,
    itemIds: inserted.map(i => i.id),
    waiterName: req.user!.name,
  })

  const full = await getFullOrder(orderId)
  io.emit('order:updated', full)
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

    io.emit('kitchen:print-result', {
      orderId, ok: true, isAddition: false, label, itemCount: items.length, manual: true,
    })
    res.json({ ok: true })
  } catch (err: any) {
    const reason = err?.message ?? 'Error al imprimir'
    io.emit('kitchen:print-result', {
      orderId, ok: false, isAddition: false, label, itemCount: items.length, reason, manual: true,
    })
    res.status(500).json({ error: reason })
  }
})

// PATCH /api/orders/:id/status
router.patch('/:id/status', requireAuth, validateBody(UpdateOrderStatusSchema), async (req, res) => {
  const orderId = Number(req.params.id)
  const { status } = req.body

  // 'paying' es solo un estado de UI/sincronización con la mesa; no es status
  // válido de la orden en BD (la BD acepta pending|preparing|ready|paid|cancelled).
  const orderStatusForDb: 'pending' | 'preparing' | 'ready' | 'paid' | 'cancelled' =
    status === 'paying' ? 'preparing' : status

  await db.update(orders).set({ status: orderStatusForDb, updatedAt: new Date().toISOString() }).where(eq(orders.id, orderId))

  // Sync table status
  const [order] = await db.select().from(orders).where(eq(orders.id, orderId))
  if (order?.tableId) {
    const tableStatus = status === 'paying' ? 'paying' : status === 'paid' || status === 'cancelled' ? 'free' : 'occupied'
    await db.update(tables).set({ status: tableStatus }).where(eq(tables.id, order.tableId))
  }

  const full = await getFullOrder(orderId)
  if (status === 'paid' || status === 'cancelled') {
    io.emit('order:removed', orderId)
  } else {
    io.emit('order:updated', full)
  }
  res.json(full)
})

// PATCH /api/orders/:id/items/:itemId/toggle
router.patch('/:id/items/:itemId/toggle', requireAuth, async (req, res) => {
  const orderId = Number(req.params.id)
  const itemId  = Number(req.params.itemId)

  // C9: verificar que el item pertenezca a la orden (evita IDOR donde
  // un usuario podría tocar items de cualquier orden con solo conocer el itemId).
  const [item] = await db.select().from(orderItems)
    .where(and(eq(orderItems.id, itemId), eq(orderItems.orderId, orderId)))
  if (!item) { res.status(404).json({ error: 'Item no encontrado en este pedido' }); return }

  const newStatus = item.status === 'ready' ? 'preparing' : 'ready'
  await db.update(orderItems).set({ status: newStatus })
    .where(and(eq(orderItems.id, itemId), eq(orderItems.orderId, orderId)))

  // Check if all items are ready → update order status
  const allItems = await db.select().from(orderItems).where(eq(orderItems.orderId, orderId))
  const allReady = allItems.every(i => (i.id === itemId ? newStatus : i.status) === 'ready')
  const orderStatus = allReady ? 'ready' : 'preparing'
  await db.update(orders).set({ status: orderStatus, updatedAt: new Date().toISOString() }).where(eq(orders.id, orderId))

  const full = await getFullOrder(orderId)
  io.emit('order:updated', full)
  res.json(full)
})

// PATCH /api/orders/:id/ready — mark all items ready
router.patch('/:id/ready', requireAuth, async (req, res) => {
  const orderId = Number(req.params.id)
  await db.update(orderItems).set({ status: 'ready' }).where(eq(orderItems.orderId, orderId))
  await db.update(orders).set({ status: 'ready', updatedAt: new Date().toISOString() }).where(eq(orders.id, orderId))
  const full = await getFullOrder(orderId)
  io.emit('order:updated', full)
  res.json(full)
})

// DELETE /api/orders/:id — cancel
router.delete('/:id', requireAuth, async (req, res) => {
  const orderId = Number(req.params.id)
  const [order] = await db.select().from(orders).where(eq(orders.id, orderId))
  if (order?.tableId) {
    await db.update(tables).set({ status: 'free' }).where(eq(tables.id, order.tableId))
  }
  await db.update(orders).set({ status: 'cancelled' }).where(eq(orders.id, orderId))
  io.emit('order:removed', orderId)
  res.status(204).send()
})

export default router
