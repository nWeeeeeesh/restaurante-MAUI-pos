import { Router } from 'express'
import { eq, asc } from 'drizzle-orm'
import { db } from '../db'
import { categories, dishes, modifierGroups, modifierOptions, orderItems } from '../db/schema'
import { requireAuth, requireRole } from '../middleware/auth'

const router = Router()

// GET full menu (público dentro de la app)
router.get('/', requireAuth, async (_req, res) => {
  const cats = await db.select().from(categories).where(eq(categories.active, true)).orderBy(asc(categories.displayOrder))
  const dishList = await db.select().from(dishes).where(eq(dishes.available, true))
  const groups = await db.select().from(modifierGroups).orderBy(asc(modifierGroups.displayOrder))
  const options = await db.select().from(modifierOptions).orderBy(asc(modifierOptions.displayOrder))

  const menu = cats.map(cat => ({
    ...cat,
    dishes: dishList
      .filter(d => d.categoryId === cat.id)
      .map(dish => ({
        ...dish,
        modifierGroups: groups
          .filter(g => g.dishId === dish.id)
          .map(g => ({
            ...g,
            options: options.filter(o => o.groupId === g.id),
          })),
      })),
  }))

  res.json(menu)
})

// GET all dishes including unavailable (admin)
router.get('/dishes', requireAuth, requireRole('owner', 'cashier'), async (_req, res) => {
  const cats = await db.select().from(categories).orderBy(asc(categories.displayOrder))
  const dishList = await db.select().from(dishes).orderBy(asc(dishes.id))
  res.json({ categories: cats, dishes: dishList })
})

// ── Categorías ─────────────────────────────────────────────────────────────
router.post('/categories', requireAuth, requireRole('owner'), async (req, res) => {
  const { name, displayOrder } = req.body
  if (!name || !String(name).trim()) {
    res.status(400).json({ error: 'Nombre de categoría requerido' })
    return
  }
  const [cat] = await db.insert(categories).values({
    name: String(name).trim(),
    displayOrder: displayOrder ?? 99,
  }).returning()
  res.status(201).json(cat)
})

router.patch('/categories/:id', requireAuth, requireRole('owner'), async (req, res) => {
  const id = Number(req.params.id)
  const { name, displayOrder, active } = req.body
  const set: any = {}
  if (name !== undefined) set.name = String(name).trim()
  if (displayOrder !== undefined) set.displayOrder = Number(displayOrder)
  if (active !== undefined) set.active = Boolean(active)
  if (Object.keys(set).length === 0) {
    res.status(400).json({ error: 'Sin cambios' })
    return
  }
  const [updated] = await db.update(categories).set(set).where(eq(categories.id, id)).returning()
  if (!updated) { res.status(404).json({ error: 'Categoría no encontrada' }); return }
  res.json(updated)
})

router.delete('/categories/:id', requireAuth, requireRole('owner'), async (req, res) => {
  const id = Number(req.params.id)
  // Verificar que no haya platos asignados
  const linked = await db.select().from(dishes).where(eq(dishes.categoryId, id))
  if (linked.length > 0) {
    res.status(409).json({
      error: `No se puede eliminar: la categoría tiene ${linked.length} plato(s). Reasígnalos primero.`,
    })
    return
  }
  await db.delete(categories).where(eq(categories.id, id))
  res.status(204).send()
})

// ── Platos ─────────────────────────────────────────────────────────────────
router.post('/dishes', requireAuth, requireRole('owner'), async (req, res) => {
  const { categoryId, name, description, price, hasSpiceLevel } = req.body

  if (!categoryId) { res.status(400).json({ error: 'Categoría requerida' }); return }
  if (!name || !String(name).trim()) { res.status(400).json({ error: 'Nombre requerido' }); return }
  if (price === undefined || price === null || isNaN(Number(price))) {
    res.status(400).json({ error: 'Precio inválido' }); return
  }

  // Verificar que la categoría exista
  const [cat] = await db.select().from(categories).where(eq(categories.id, Number(categoryId)))
  if (!cat) { res.status(400).json({ error: 'La categoría no existe' }); return }

  const [dish] = await db.insert(dishes).values({
    categoryId: Number(categoryId),
    name: String(name).trim(),
    description: description ? String(description).trim() : null,
    price: Number(price),
    hasSpiceLevel: Boolean(hasSpiceLevel),
    available: true,
  }).returning()

  if (hasSpiceLevel) {
    const [group] = await db.insert(modifierGroups).values({
      dishId: dish.id, name: 'Nivel de Picante', type: 'spice', required: true, multiple: false, displayOrder: 1,
    }).returning()
    await db.insert(modifierOptions).values([
      { groupId: group.id, name: 'Sin picante', displayOrder: 1 },
      { groupId: group.id, name: 'Poco picante', displayOrder: 2 },
      { groupId: group.id, name: 'Normal', displayOrder: 3 },
      { groupId: group.id, name: 'Picante', displayOrder: 4 },
      { groupId: group.id, name: 'Muy picante', displayOrder: 5 },
    ])
    await db.insert(modifierGroups).values({
      dishId: dish.id, name: 'Preferencias', type: 'preference', required: false, multiple: true, displayOrder: 2,
    })
  }

  res.status(201).json(dish)
})

router.patch('/dishes/:id', requireAuth, requireRole('owner'), async (req, res) => {
  const id = Number(req.params.id)
  const { name, description, price, available, categoryId, hasSpiceLevel } = req.body

  const set: any = {}
  if (name !== undefined) set.name = String(name).trim()
  if (description !== undefined) set.description = description === null || description === '' ? null : String(description).trim()
  if (price !== undefined && !isNaN(Number(price))) set.price = Number(price)
  if (available !== undefined) set.available = Boolean(available)
  if (categoryId !== undefined) set.categoryId = Number(categoryId)
  if (hasSpiceLevel !== undefined) set.hasSpiceLevel = Boolean(hasSpiceLevel)

  if (Object.keys(set).length === 0) {
    res.status(400).json({ error: 'Sin cambios para aplicar' }); return
  }

  const [updated] = await db.update(dishes).set(set).where(eq(dishes.id, id)).returning()
  if (!updated) { res.status(404).json({ error: 'Plato no encontrado' }); return }
  res.json(updated)
})

router.delete('/dishes/:id', requireAuth, requireRole('owner'), async (req, res) => {
  const id = Number(req.params.id)
  // Si está usado en algún pedido lo marcamos como no disponible (preserva integridad)
  const used = await db.select().from(orderItems).where(eq(orderItems.dishId, id))
  if (used.length > 0) {
    await db.update(dishes).set({ available: false }).where(eq(dishes.id, id))
    res.json({ deactivated: true, message: 'El plato tiene pedidos históricos, se marcó como no disponible.' })
    return
  }
  // Borrar modificadores asociados primero
  const groups = await db.select().from(modifierGroups).where(eq(modifierGroups.dishId, id))
  for (const g of groups) {
    await db.delete(modifierOptions).where(eq(modifierOptions.groupId, g.id))
  }
  await db.delete(modifierGroups).where(eq(modifierGroups.dishId, id))
  await db.delete(dishes).where(eq(dishes.id, id))
  res.status(204).send()
})

// ── Modificadores ──────────────────────────────────────────────────────────
router.get('/dishes/:id/modifiers', requireAuth, async (req, res) => {
  const dishId = Number(req.params.id)
  const groups = await db.select().from(modifierGroups).where(eq(modifierGroups.dishId, dishId)).orderBy(asc(modifierGroups.displayOrder))
  const options = await db.select().from(modifierOptions).orderBy(asc(modifierOptions.displayOrder))
  const result = groups.map(g => ({ ...g, options: options.filter(o => o.groupId === g.id) }))
  res.json(result)
})

router.post('/modifier-groups/:groupId/options', requireAuth, requireRole('owner'), async (req, res) => {
  const groupId = Number(req.params.groupId)
  const { name, priceAdjustment, displayOrder } = req.body
  const [opt] = await db.insert(modifierOptions).values({ groupId, name, priceAdjustment, displayOrder }).returning()
  res.status(201).json(opt)
})

router.delete('/modifier-options/:id', requireAuth, requireRole('owner'), async (req, res) => {
  const id = Number(req.params.id)
  await db.delete(modifierOptions).where(eq(modifierOptions.id, id))
  res.status(204).send()
})

export default router
