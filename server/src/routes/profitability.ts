import { Router } from 'express'
import { db } from '../db'
import { requireAuth, requireRole } from '../middleware/auth'
import { validateQuery } from '../middleware/validate'
import { ProfitabilityQuerySchema } from '../schemas/profitability'
import { obtenerRentabilidad } from '../services/profitability.service'
import { currentLocalId } from '../utils/local'

// Rentabilidad operativa (incremento 2): solo el dueño. Se calcula al consultarla.
const router = Router()

// GET /api/profitability?from&to&groupBy=day|week|month
router.get('/', requireAuth, requireRole('owner'), validateQuery(ProfitabilityQuerySchema), async (req, res) => {
  const q = ProfitabilityQuerySchema.parse(req.query)
  res.json(await obtenerRentabilidad(db, { localId: currentLocalId(), ...q }))
})

export default router
