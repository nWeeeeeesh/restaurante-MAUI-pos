import { Router } from 'express'
import { eq } from 'drizzle-orm'
import { db } from '../db'
import { billGroups } from '../db/schema'
import { requireAuth, requireRole } from '../middleware/auth'
import { validateBody } from '../middleware/validate'
import { SplitGroupsSchema, type SplitGroupsInput } from '../schemas/split'
import { emit } from '../realtime'
import { getFullOrder } from '../services/order.serializer'
import { saveSplit, deleteSplit } from '../services/split.service'

const router = Router({ mergeParams: true })

// Dividir la cuenta es parte del cobro: cajero, encargado y dueño (matriz v1.1).
const canSplit = requireRole('owner', 'manager', 'cashier')

// Helper: re-emite la orden completa con sus grupos
async function emitOrder(orderId: number) {
  const full = await getFullOrder(db, orderId)
  if (full) emit('order:updated', full)
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
// Soporta coexistencia con grupos pagados: solo opera sobre los abiertos.
router.post('/', requireAuth, canSplit, validateBody(SplitGroupsSchema), async (req, res) => {
  const orderId = Number(req.params.id)
  const { groups } = req.body as SplitGroupsInput
  const created = await saveSplit(db, orderId, groups)
  const full = await emitOrder(orderId)
  res.status(201).json({ groups: created, order: full })
})

// DELETE /api/orders/:id/split — deshacer SOLO los grupos abiertos
router.delete('/', requireAuth, canSplit, async (req, res) => {
  const orderId = Number(req.params.id)
  await deleteSplit(db, orderId)
  const full = await emitOrder(orderId)
  res.json({ ok: true, order: full })
})

export default router
