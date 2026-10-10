import { z } from 'zod'

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

export const PeriodQuerySchema = z.object({
  period: z.enum(['today', 'week', 'month']).optional(),
})

export const DateRangeQuerySchema = z.object({
  from: z.string().regex(DATE_RE, 'Debe ser YYYY-MM-DD').optional(),
  to:   z.string().regex(DATE_RE, 'Debe ser YYYY-MM-DD').optional(),
})

export const CreateExpenseSchema = z.object({
  description: z.string().trim().min(1).max(200),
  amount: z.number().positive().max(999999),
  category: z.string().trim().max(40).optional(),
  date: z.string().regex(DATE_RE, 'Fecha debe ser YYYY-MM-DD').optional(),
  notes: z.string().trim().max(500).nullable().optional(),
})

// Corregir o borrar un gasto exige motivo: queda en audit_log (D6).
const ReasonSchema = z.string().trim().min(3, 'Indica el motivo (mínimo 3 caracteres)').max(200)

export const UpdateExpenseSchema = z.object({
  description: z.string().trim().min(1).max(200).optional(),
  amount:      z.number().positive().max(999999).optional(),
  category:    z.string().trim().max(40).optional(),
  date:        z.string().regex(DATE_RE, 'Fecha debe ser YYYY-MM-DD').optional(),
  notes:       z.string().trim().max(500).nullable().optional(),
  reason:      ReasonSchema,
}).refine(d => Object.keys(d).some(k => k !== 'reason'), { message: 'Debe enviar al menos un campo' })

export const DeleteExpenseSchema = z.object({
  reason: ReasonSchema,
})

export type CreateExpenseInput  = z.infer<typeof CreateExpenseSchema>
export type UpdateExpenseInput  = z.infer<typeof UpdateExpenseSchema>
