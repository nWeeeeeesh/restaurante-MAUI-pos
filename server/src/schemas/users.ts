import { z } from 'zod'

const PasswordSchema = z.string().min(8, 'La contraseña debe tener al menos 8 caracteres').max(200)

export const CreateUserSchema = z.object({
  name: z.string().trim().min(1).max(120),
  username: z.string().trim().toLowerCase().min(3, 'Usuario mínimo 3 caracteres').max(40)
    .regex(/^[a-z0-9._-]+$/, 'Usuario solo puede contener letras, números, ".", "_" o "-"'),
  password: PasswordSchema,
  role: z.enum(['owner', 'cashier', 'waiter']),
})

export const UpdateUserSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  username: z.string().trim().toLowerCase().min(3).max(40)
    .regex(/^[a-z0-9._-]+$/).optional(),
  role: z.enum(['owner', 'cashier', 'waiter']).optional(),
  active: z.boolean().optional(),
}).refine(d => Object.keys(d).length > 0, { message: 'Sin cambios para aplicar' })

export const ChangeMyPasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: PasswordSchema,
})

export const AdminChangePasswordSchema = z.object({
  password: PasswordSchema,
})

export type CreateUserInput = z.infer<typeof CreateUserSchema>
export type UpdateUserInput = z.infer<typeof UpdateUserSchema>
export type ChangeMyPasswordInput = z.infer<typeof ChangeMyPasswordSchema>
export type AdminChangePasswordInput = z.infer<typeof AdminChangePasswordSchema>
