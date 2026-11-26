import { z } from 'zod'

const fecha = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha YYYY-MM-DD')

// Datos del equipo para la Tabla III que no se pueden leer del sistema
export const EquipoSchema = z.object({
  refrigeracion: z.string().trim().max(200).optional(),
  almacenamiento: z.string().trim().max(200).optional(),
})

export const ConfirmarSchema = z.object({ confirmar: z.literal(true) })

export const ProgramacionSchema = z.object({
  hora: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Hora HH:MM').default('12:00'),
  dias: z.number().int().min(1).max(60).default(7),
  desde: fecha.optional(),
})

export const TodoEnUnoSchema = z.object({
  confirmar: z.literal(true),
  hora: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Hora HH:MM').default('12:00'),
})

export const ReintentarSchema = z.object({
  desde: z.enum(['medir', 'permisos', 'pruebas', 'programar', 'recuperacion', 'descarga']),
})

export const PeriodoSchema = z.object({
  desde: fecha.optional(),
  hasta: fecha.optional(),
}).refine(p => !p.desde || !p.hasta || p.desde <= p.hasta, { message: 'desde debe ser anterior a hasta' })

export type EquipoInput = z.infer<typeof EquipoSchema>
export type ProgramacionInput = z.infer<typeof ProgramacionSchema>
export type PeriodoInput = z.infer<typeof PeriodoSchema>
