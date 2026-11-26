import { z } from 'zod'

// Datos del equipo para la Tabla III que no se pueden leer del sistema
export const EquipoSchema = z.object({
  refrigeracion: z.string().trim().max(200).optional(),
  almacenamiento: z.string().trim().max(200).optional(),
})

export const ConfirmarSchema = z.object({ confirmar: z.literal(true) })

export const TodoEnUnoSchema = z.object({ confirmar: z.literal(true) })

export const ReintentarSchema = z.object({
  desde: z.enum(['medir', 'jornada', 'nocturna', 'permisos', 'pruebas', 'recuperacion', 'descarga']),
})

export type EquipoInput = z.infer<typeof EquipoSchema>
