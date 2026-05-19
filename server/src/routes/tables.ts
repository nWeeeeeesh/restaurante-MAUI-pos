import { Router } from 'express'
import { eq } from 'drizzle-orm'
import { db } from '../db'
import { tables, orders, layoutItems } from '../db/schema'
import { requireAuth, requireRole } from '../middleware/auth'
import { validateBody } from '../middleware/validate'
import {
  CreateTableSchema,
  UpdateTableSchema,
  SaveLayoutSchema,
} from '../schemas/tables'

const router = Router()

// GET /api/tables — listar todas las mesas (incluye inactivas para que el dueño pueda gestionarlas)
router.get('/', requireAuth, async (_req, res) => {
  const all = await db.select().from(tables).orderBy(tables.number)
  res.json(all)
})

// PATCH /api/tables/:id — actualizar posición o atributos visuales (solo owner)
router.patch(
  '/:id',
  requireAuth, requireRole('owner'), validateBody(UpdateTableSchema),
  async (req, res) => {
    const id = Number(req.params.id)
    const updates: Partial<typeof tables.$inferInsert> = { ...req.body }

    if (updates.number !== undefined) {
      const dup = await db.select().from(tables).where(eq(tables.number, updates.number))
      if (dup.some(t => t.id !== id)) {
        res.status(409).json({ error: `Ya existe una mesa con el número ${updates.number}` })
        return
      }
    }

    await db.update(tables).set(updates).where(eq(tables.id, id))
    const [updated] = await db.select().from(tables).where(eq(tables.id, id))
    res.json(updated)
  },
)

// POST /api/tables — crear nueva mesa (solo owner)
router.post(
  '/',
  requireAuth, requireRole('owner'), validateBody(CreateTableSchema),
  async (req, res) => {
    const { number, area, capacity, posX, posY } = req.body

    let nextNumber = number
    if (!nextNumber) {
      const all = await db.select().from(tables)
      nextNumber = (all.reduce((m, t) => Math.max(m, t.number), 0) || 0) + 1
    }

    // Verificar duplicado
    const existing = await db.select().from(tables).where(eq(tables.number, nextNumber))
    if (existing.length > 0) {
      res.status(409).json({ error: `Ya existe una mesa con el número ${nextNumber}` })
      return
    }

    const [created] = await db.insert(tables).values({
      number: nextNumber,
      area: area ?? 'salon',
      capacity: capacity ?? 4,
      status: 'free',
      posX: posX ?? null,
      posY: posY ?? null,
    }).returning()
    res.status(201).json(created)
  },
)

// DELETE /api/tables/:id — eliminar mesa o inhabilitarla si tiene historial
//
// Reglas:
//  - Si la mesa está ocupada/por cobrar → 409 (no se puede tocar)
//  - Si la mesa tiene pedidos pagados o cancelados (historial) → la inhabilitamos
//    (active=false) en lugar de borrar, para no romper la integridad referencial
//    ni perder reportes históricos. Devolvemos { disabled: true }.
//  - Si no tiene historial alguno → DELETE real. Devolvemos { deleted: true }.
router.delete('/:id', requireAuth, requireRole('owner'), async (req, res) => {
  const id = Number(req.params.id)

  const allOrders = await db.select().from(orders).where(eq(orders.tableId, id))
  const active = allOrders.filter(o => !['paid', 'cancelled'].includes(o.status ?? ''))
  if (active.length > 0) {
    res.status(409).json({ error: 'No se puede eliminar una mesa ocupada o por cobrar' })
    return
  }

  if (allOrders.length > 0) {
    // Tiene historial — soft disable para preservar reportes
    await db.update(tables).set({ active: false, status: 'free' }).where(eq(tables.id, id))
    const [t] = await db.select().from(tables).where(eq(tables.id, id))
    res.json({ ok: true, disabled: true, table: t })
    return
  }

  try {
    await db.delete(tables).where(eq(tables.id, id))
    res.json({ ok: true, deleted: true })
  } catch (err: any) {
    // Fallback defensivo: si la FK aún bloquea (cambio de schema futuro), inhabilitamos
    await db.update(tables).set({ active: false, status: 'free' }).where(eq(tables.id, id))
    const [t] = await db.select().from(tables).where(eq(tables.id, id))
    res.json({ ok: true, disabled: true, table: t, note: 'Eliminacion bloqueada — mesa inhabilitada' })
  }
})

// POST /api/tables/layout — guardar layout completo de una vez (solo owner)
//
// body: {
//   positions: [{ id, posX, posY, area }],   // mesas
//   layoutItems?: [{ id?, type, text, posX, posY, width?, height?, color? }],  // labels y zones
// }
//
// Si layoutItems se incluye, REEMPLAZA los items existentes (CRUD diferencial sería más
// complejo y este flujo es solo desde el modo edición — guardar todo de golpe).
router.post(
  '/layout',
  requireAuth, requireRole('owner'), validateBody(SaveLayoutSchema),
  async (req, res) => {
    const { positions, layoutItems: items } = req.body

    for (const p of positions) {
      const updates: Partial<typeof tables.$inferInsert> = { posX: p.posX, posY: p.posY }
      if (p.area !== undefined) updates.area = p.area
      await db.update(tables).set(updates).where(eq(tables.id, p.id))
    }

    if (Array.isArray(items)) {
      await db.delete(layoutItems)
      if (items.length > 0) {
        await db.insert(layoutItems).values(items.map(it => ({
          type: it.type,
          text: it.text,
          posX: it.posX,
          posY: it.posY,
          width: it.width ?? null,
          height: it.height ?? null,
          color: it.color ?? '#94A3B8',
        })))
      }
    }

    const all = await db.select().from(tables).orderBy(tables.number)
    const decorations = await db.select().from(layoutItems)
    res.json({ tables: all, layoutItems: decorations })
  },
)

// GET /api/tables/layout-items — listar decoraciones del plano
router.get('/layout-items', requireAuth, async (_req, res) => {
  const items = await db.select().from(layoutItems)
  res.json(items)
})

export default router
