import { Router } from 'express'
import { db } from '../db'
import { requireAuth, requireRole } from '../middleware/auth'
import { validateBody } from '../middleware/validate'
import { DomainError } from '../errors'
import { RecipeSchema, type RecipeInput } from '../schemas/recipes'
import { CalibrateSchema, type CalibrateInput } from '../schemas/profitability'
import { listRecipes, replaceRecipe } from '../services/recipes.service'
import { calibrar } from '../services/profitability.service'
import { currentLocalId } from '../utils/local'

// Recetas y calibración (RF08, RF09): solo el dueño
const router = Router()
const owner = requireRole('owner')

router.get('/', requireAuth, owner, async (_req, res) => {
  res.json(await listRecipes(db, currentLocalId()))
})

// POST /api/recipes/calibrate { from, to }: Fórmula 12 con los días con conteo
router.post('/calibrate', requireAuth, owner, validateBody(CalibrateSchema), async (req, res) => {
  const input = req.body as CalibrateInput
  res.json(await calibrar(db, { localId: currentLocalId(), ...input }, req.user!.id))
})

// PUT /api/recipes/:dishId — reemplaza la receta del plato
router.put('/:dishId', requireAuth, owner, validateBody(RecipeSchema), async (req, res) => {
  const dishId = Number(req.params.dishId)
  if (!Number.isInteger(dishId) || dishId <= 0) throw new DomainError('Plato inválido', 400, 'INVALID_ID')
  res.json(await replaceRecipe(db, dishId, req.body as RecipeInput, req.user!.id))
})

export default router
