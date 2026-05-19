import { z } from 'zod'

const trimmedName = z.string().trim().min(1, 'Nombre requerido').max(120)

export const CreateCategorySchema = z.object({
  name: trimmedName,
  displayOrder: z.number().int().min(0).max(9999).optional(),
})

export const UpdateCategorySchema = z.object({
  name: trimmedName.optional(),
  displayOrder: z.number().int().min(0).max(9999).optional(),
  active: z.boolean().optional(),
}).refine(d => Object.keys(d).length > 0, { message: 'Sin cambios para aplicar' })

export const CreateDishSchema = z.object({
  categoryId: z.number().int().positive(),
  name: trimmedName,
  description: z.string().trim().max(500).nullable().optional(),
  price: z.number().positive('Precio debe ser positivo').max(99999),
  hasSpiceLevel: z.boolean().optional(),
})

export const UpdateDishSchema = z.object({
  categoryId: z.number().int().positive().optional(),
  name: trimmedName.optional(),
  description: z.union([z.string().trim().max(500), z.null()]).optional(),
  price: z.number().positive().max(99999).optional(),
  available: z.boolean().optional(),
  hasSpiceLevel: z.boolean().optional(),
}).refine(d => Object.keys(d).length > 0, { message: 'Sin cambios para aplicar' })

export const CreateModifierOptionSchema = z.object({
  name: trimmedName,
  priceAdjustment: z.number().min(-9999).max(9999).optional(),
  displayOrder: z.number().int().min(0).max(9999).optional(),
})

export type CreateCategoryInput = z.infer<typeof CreateCategorySchema>
export type UpdateCategoryInput = z.infer<typeof UpdateCategorySchema>
export type CreateDishInput = z.infer<typeof CreateDishSchema>
export type UpdateDishInput = z.infer<typeof UpdateDishSchema>
export type CreateModifierOptionInput = z.infer<typeof CreateModifierOptionSchema>
