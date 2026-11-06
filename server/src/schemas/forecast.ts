import { z } from 'zod'
import { LocalDateSchema } from './inventory'
import { daysBetween } from '../domain/calendar'
import { MAX_RANGE_DAYS } from './profitability'

const days = z.coerce.number().int().min(1, 'La cobertura va de 1 a 3 días').max(3, 'La cobertura va de 1 a 3 días')

// Cobertura por insumo: "supplyId:días,supplyId:días" (en la URL) o un objeto (en el cuerpo)
const CoverageText = z.string().regex(/^\d+:[1-3](,\d+:[1-3])*$/, 'Cobertura: id:días separados por comas')
  .transform(s => Object.fromEntries(s.split(',').map(p => p.split(':').map(Number))) as Record<number, number>)

export const PurchaseListQuerySchema = z.object({
  date: LocalDateSchema.optional(),
  coverageDays: days.optional(),
  coverage: CoverageText.optional(),
})

export const PurchaseListPrintSchema = z.object({
  date: LocalDateSchema.optional(),
  coverageDays: days.optional(),
  coverage: z.record(z.string().regex(/^\d+$/), z.number().int().min(1).max(3)).optional(),
})

export const ForecastRunSchema = z.object({
  madeOn: LocalDateSchema,
})

export const ForecastHistoryQuerySchema = z.object({
  supplyId: z.coerce.number().int().positive(),
  from: LocalDateSchema,
  to: LocalDateSchema,
}).refine(r => r.from <= r.to, { message: '«Desde» debe ser anterior o igual a «hasta»', path: ['to'] })
  .refine(r => daysBetween(r.from, r.to) < MAX_RANGE_DAYS, { message: `El periodo no puede superar ${MAX_RANGE_DAYS} días`, path: ['to'] })

export type PurchaseListPrintInput = z.infer<typeof PurchaseListPrintSchema>
export type ForecastRunInput = z.infer<typeof ForecastRunSchema>
