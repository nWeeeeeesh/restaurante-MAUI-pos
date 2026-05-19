import { z } from 'zod'

export const LoginSchema = z.object({
  username: z.string().trim().min(1, 'Usuario requerido'),
  password: z.string().min(1, 'Contraseña requerida'),
})

export type LoginInput = z.infer<typeof LoginSchema>
