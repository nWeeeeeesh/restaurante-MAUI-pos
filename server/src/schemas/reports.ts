import { z } from 'zod'

export const CreateExpenseSchema = z.object({
  description: z.string().trim().min(1).max(200),
  amount: z.number().positive().max(999999),
  category: z.string().trim().max(40).optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha debe ser YYYY-MM-DD').optional(),
  notes: z.string().trim().max(500).nullable().optional(),
})

export type CreateExpenseInput = z.infer<typeof CreateExpenseSchema>
