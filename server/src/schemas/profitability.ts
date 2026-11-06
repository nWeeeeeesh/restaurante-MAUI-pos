import { z } from 'zod'
import { LocalDateSchema } from './inventory'
import { daysBetween } from '../domain/calendar'

// Rango máximo de una consulta de rentabilidad o de una calibración (plan-sistema T10)
export const MAX_RANGE_DAYS = 366

const RangeSchema = z.object({
  from: LocalDateSchema,
  to: LocalDateSchema,
})

const rangeOk = <T extends { from: string; to: string }>(s: z.ZodType<T>) => s
  .refine(r => r.from <= r.to, { message: '«Desde» debe ser anterior o igual a «hasta»', path: ['to'] })
  .refine(r => daysBetween(r.from, r.to) < MAX_RANGE_DAYS, { message: `El periodo no puede superar ${MAX_RANGE_DAYS} días`, path: ['to'] })

export const ProfitabilityQuerySchema = rangeOk(RangeSchema.extend({
  groupBy: z.enum(['day', 'week', 'month']).default('month'),
}))

export const CalibrateSchema = rangeOk(RangeSchema)

export const ExpenseKindSchema = z.object({
  kind: z.enum(['fijo', 'variable']),
})

export type ProfitabilityQuery = z.infer<typeof ProfitabilityQuerySchema>
export type CalibrateInput = z.infer<typeof CalibrateSchema>
export type ExpenseKindInput = z.infer<typeof ExpenseKindSchema>
