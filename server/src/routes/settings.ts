import { Router } from 'express'
import { db } from '../db'
import { requireAuth, requireRole } from '../middleware/auth'
import { validateBody } from '../middleware/validate'
import { withWriteLock } from '../db/write-lock'
import { SettingsSchema, type SettingsInput } from '../schemas/settings'
import { readSettings, saveSettings } from '../services/settings.service'

// Ajustes del local: el encargado los ve; solo el dueño los cambia
const router = Router()

router.get('/', requireAuth, requireRole('owner', 'manager'), async (_req, res) => {
  res.json(await readSettings(db))
})

router.put('/', requireAuth, requireRole('owner'), validateBody(SettingsSchema), async (req, res) => {
  const input = req.body as SettingsInput
  res.json(await withWriteLock(() => db.transaction(tx => saveSettings(tx, input, req.user!.id))))
})

export default router
