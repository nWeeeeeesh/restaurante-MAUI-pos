import { Router } from 'express'
import { eq, and, inArray, notInArray } from 'drizzle-orm'
import { db } from '../db'
import { orders, orderItems, billGroups } from '../db/schema'
import { requireAuth } from '../middleware/auth'
import { io } from '../index'

const router = Router({ mergeParams: true })

// Helper: re-emite la orden completa con sus grupos
async function emitOrder(orderId: number) {
  const [order] = await db.select().from(orders).where(eq(orders.id, orderId))
  if (!order) return null
  const items = await db.select().from(orderItems).where(eq(orderItems.orderId, orderId))
  const groups = await db.select().from(billGroups).where(eq(billGroups.orderId, orderId))
  const full = {
    ...order,
    createdAt: order.createdAt ? new Date(order.createdAt + 'Z').toISOString() : new Date().toISOString(),
    items: items.map(i => ({ ...i, modifiers: JSON.parse(i.modifiers ?? '[]') })),
    billGroups: groups,
  }
  io.emit('order:updated', full)
  return full
}

// GET /api/orders/:id/split — obtener grupos del pedido
router.get('/', requireAuth, async (req, res) => {
  const orderId = Number(req.params.id)
  const groups = await db.select().from(billGroups).where(eq(billGroups.orderId, orderId))
  res.json(groups)
})

// POST /api/orders/:id/split — crear/reemplazar grupos abiertos
// body: { groups: [{ label, itemIds }, ...] }
//
// Soporta coexistencia con grupos pagados: solo opera sobre los abiertos.
// Los grupos pagados y sus items quedan intactos. Si en el body se incluye
// un item ya cobrado o asignado a un grupo pagado, se rechaza.
router.post('/', requireAuth, async (req, res) => {
  const orderId = Number(req.params.id)
  const { groups } = req.body as { groups: Array<{ label: string; itemIds: number[] }> }

  if (!Array.isArray(groups)) {
    res.status(400).json({ error: 'Formato inválido' })
    return
  }

  const existing = await db.select().from(billGroups).where(eq(billGroups.orderId, orderId))
  const paidGroups = existing.filter(g => g.status === 'paid')
  const paidGroupIds = paidGroups.map(g => g.id)

  // Validación: para crear una división nueva (sin grupos pagados aún) requerimos al menos 2 grupos.
  // Si ya hay pagados, basta 1 grupo abierto (puede ser el último).
  const nonEmpty = groups.filter(g => g.itemIds.length > 0)
  if (paidGroups.length === 0 && nonEmpty.length < 2) {
    res.status(400).json({ error: 'Se requieren al menos 2 sub-cuentas' })
    return
  }

  const orderItemsList = await db.select().from(orderItems).where(eq(orderItems.orderId, orderId))
  const itemsById = new Map(orderItemsList.map(i => [i.id, i]))
  const lockedItemIds = new Set(orderItemsList.filter(i => i.billGroupId !== null && paidGroupIds.includes(i.billGroupId!)).map(i => i.id))

  // Validar items
  const seen = new Set<number>()
  for (const g of groups) {
    for (const id of g.itemIds) {
      const it = itemsById.get(id)
      if (!it) { res.status(400).json({ error: `El item ${id} no pertenece al pedido` }); return }
      if (it.billId)             { res.status(400).json({ error: `El item ${id} ya fue cobrado` }); return }
      if (lockedItemIds.has(id)) { res.status(400).json({ error: `El item ${id} pertenece a una sub-cuenta ya cobrada` }); return }
      if (seen.has(id))          { res.status(400).json({ error: `El item ${id} está asignado a más de una sub-cuenta` }); return }
      seen.add(id)
    }
  }

  // Limpiar billGroupId solo de items NO bloqueados (los pagados siguen vinculados a su grupo pagado)
  if (lockedItemIds.size > 0) {
    await db.update(orderItems).set({ billGroupId: null })
      .where(and(eq(orderItems.orderId, orderId), notInArray(orderItems.id, [...lockedItemIds])))
  } else {
    await db.update(orderItems).set({ billGroupId: null })
      .where(eq(orderItems.orderId, orderId))
  }

  // Borrar solo grupos abiertos (los pagados se preservan)
  await db.delete(billGroups).where(and(eq(billGroups.orderId, orderId), eq(billGroups.status, 'open')))

  // Crear nuevos abiertos
  const created: any[] = []
  for (const g of groups) {
    if (g.itemIds.length === 0) continue
    const [grp] = await db.insert(billGroups).values({
      orderId,
      label: g.label,
      status: 'open',
    }).returning()
    await db.update(orderItems)
      .set({ billGroupId: grp.id })
      .where(inArray(orderItems.id, g.itemIds))
    created.push(grp)
  }

  const full = await emitOrder(orderId)
  res.status(201).json({ groups: created, order: full })
})

// DELETE /api/orders/:id/split — deshacer SOLO los grupos abiertos
// Los pagados permanecen intactos (no se puede deshacer una sub-cuenta cobrada).
router.delete('/', requireAuth, async (req, res) => {
  const orderId = Number(req.params.id)
  const existing = await db.select().from(billGroups).where(eq(billGroups.orderId, orderId))
  const paidGroupIds = existing.filter(g => g.status === 'paid').map(g => g.id)

  // Limpiar billGroupId solo en items NO ligados a grupos pagados
  if (paidGroupIds.length > 0) {
    const lockedItems = await db.select().from(orderItems).where(and(
      eq(orderItems.orderId, orderId),
      inArray(orderItems.billGroupId as any, paidGroupIds),
    ))
    const lockedIds = lockedItems.map(i => i.id)
    if (lockedIds.length > 0) {
      await db.update(orderItems).set({ billGroupId: null })
        .where(and(eq(orderItems.orderId, orderId), notInArray(orderItems.id, lockedIds)))
    } else {
      await db.update(orderItems).set({ billGroupId: null }).where(eq(orderItems.orderId, orderId))
    }
  } else {
    await db.update(orderItems).set({ billGroupId: null }).where(eq(orderItems.orderId, orderId))
  }

  await db.delete(billGroups).where(and(eq(billGroups.orderId, orderId), eq(billGroups.status, 'open')))

  const full = await emitOrder(orderId)
  res.json({ ok: true, order: full })
})

export default router
