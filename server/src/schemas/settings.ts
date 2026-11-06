import { z } from 'zod'
import { LocalDateSchema } from './inventory'

export const SettingsSchema = z.object({
  // Desde esta fecha se registran traslados entre locales
  second_local_opened_on: LocalDateSchema.nullable().optional(),
}).refine(d => Object.keys(d).length > 0, { message: 'Sin cambios para aplicar' })

export type SettingsInput = z.infer<typeof SettingsSchema>
