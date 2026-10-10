import { Router } from 'express'
import { eq, asc } from 'drizzle-orm'
import { db } from '../db'
import { categories, dishes, modifierGroups, modifierOptions, orderItems } from '../db/schema'
import { requireAuth, requireRole } from '../middleware/auth'
import { validateBody } from '../middleware/validate'
import {
  CreateCategorySchema,
  UpdateCategorySchema,
  CreateDishSchema,
  UpdateDishSchema,
  CreateModifierOptionSchema,
  DishAvailabilitySchema,
} from '../schemas/menu'
import { withWriteLock } from '../db/write-lock'
import { audit } from '../services/audit'
import { DomainError } from '../errors'

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
router.get('/dishes', requireAuth, requireRole('owner', 'manager'), async (_req, res) => {
  const cats = await db.select().from(categories).orderBy(asc(categories.displayOrder))
  const dishList = await db.select().from(dishes).orderBy(asc(dishes.id))
  res.json({ categories: cats, dishes: dishList })
})

// ── Categorías ─────────────────────────────────────────────────────────────
router.post(
  '/categories',
  requireAuth, requireRole('owner'), validateBody(CreateCategorySchema),
  async (req, res) => {
    const { name, displayOrder } = req.body
    const [cat] = await db.insert(categories).values({
      name,
      displayOrder: displayOrder ?? 99,
    }).returning()
    res.status(201).json(cat)
  },
)

router.patch(
  '/categories/:id',
  requireAuth, requireRole('owner'), validateBody(UpdateCategorySchema),
  async (req, res) => {
    const id = Number(req.params.id)
    const set: Partial<typeof categories.$inferInsert> = req.body
    const [updated] = await db.update(categories).set(set).where(eq(categories.id, id)).returning()
    if (!updated) { res.status(404).json({ error: 'Categoría no encontrada' }); return }
    res.json(updated)
  },
)

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
router.post(
  '/dishes',
  requireAuth, requireRole('owner'), validateBody(CreateDishSchema),
  async (req, res) => {
  const { categoryId, name, description, price, hasSpiceLevel } = req.body

  // Verificar que la categoría exista
  const [cat] = await db.select().from(categories).where(eq(categories.id, categoryId))
  if (!cat) { res.status(400).json({ error: 'La categoría no existe' }); return }

  const [dish] = await db.insert(dishes).values({
    categoryId,
    name,
    description: description ?? null,
    price,
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
  },
)

router.patch(
  '/dishes/:id',
  requireAuth, requireRole('owner'), validateBody(UpdateDishSchema),
  async (req, res) => {
    const id = Number(req.params.id)
    const set: Partial<typeof dishes.$inferInsert> = { ...req.body }
    // Normalizar description vacío como null para limpieza
    if (set.description === '') set.description = null
    // Cambios de precio o disponibilidad quedan registrados (quién y desde qué valor)
    const updated = await withWriteLock(() => db.transaction(async (tx) => {
      const [before] = await tx.select().from(dishes).where(eq(dishes.id, id))
      if (!before) throw new DomainError('Plato no encontrado', 404, 'DISH_NOT_FOUND')
      const [after] = await tx.update(dishes).set(set).where(eq(dishes.id, id)).returning()
      await audit(tx, {
        userId: req.user!.id, action: 'dish.update', entity: 'dish', entityId: id,
        data: { before: { name: before.name, price: before.price, available: before.available }, changes: req.body },
      })
      return after
    }))
    res.json(updated)
  },
)

// PATCH /api/menu/dishes/:id/availability — marcar agotado/disponible (D5).
// El encargado puede hacerlo durante el servicio; precios y altas siguen siendo del dueño.
router.patch(
  '/dishes/:id/availability',
  requireAuth, requireRole('owner', 'manager'), validateBody(DishAvailabilitySchema),
  async (req, res) => {
    const id = Number(req.params.id)
    const { available } = req.body as { available: boolean }
    const updated = await withWriteLock(() => db.transaction(async (tx) => {
      const [after] = await tx.update(dishes).set({ available }).where(eq(dishes.id, id)).returning()
      if (!after) throw new DomainError('Plato no encontrado', 404, 'DISH_NOT_FOUND')
      await audit(tx, {
        userId: req.user!.id, action: 'dish.availability', entity: 'dish', entityId: id,
        data: { name: after.name, available },
      })
      return after
    }))
    res.json(updated)
  },
)

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

router.post(
  '/modifier-groups/:groupId/options',
  requireAuth, requireRole('owner'), validateBody(CreateModifierOptionSchema),
  async (req, res) => {
    const groupId = Number(req.params.groupId)
    const { name, priceAdjustment, displayOrder } = req.body
    const [opt] = await db.insert(modifierOptions).values({ groupId, name, priceAdjustment, displayOrder }).returning()
    res.status(201).json(opt)
  },
)

router.delete('/modifier-options/:id', requireAuth, requireRole('owner'), async (req, res) => {
  const id = Number(req.params.id)
  await db.delete(modifierOptions).where(eq(modifierOptions.id, id))
  res.status(204).send()
})

export default router
