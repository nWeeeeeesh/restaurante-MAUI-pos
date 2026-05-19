import { z } from 'zod'

const coord = z.number().min(-10000).max(10000).nullable()

export const CreateTableSchema = z.object({
  number: z.number().int().positive().max(9999).optional(),
  area: z.string().trim().max(40).optional(),
  capacity: z.number().int().positive().max(99).optional(),
  posX: coord.optional(),
  posY: coord.optional(),
})

export const UpdateTableSchema = z.object({
  number: z.number().int().positive().max(9999).optional(),
  area: z.string().trim().max(40).optional(),
  capacity: z.number().int().positive().max(99).optional(),
  posX: coord.optional(),
  posY: coord.optional(),
  active: z.boolean().optional(),
}).refine(d => Object.keys(d).length > 0, { message: 'Sin cambios para aplicar' })

const LayoutItemSchema = z.object({
  id: z.number().int().positive().optional(),
  type: z.enum(['label', 'zone']),
  text: z.string().max(120).default(''),
  posX: z.number().min(-10000).max(10000),
  posY: z.number().min(-10000).max(10000),
  width: z.number().nonnegative().max(10000).nullable().optional(),
  height: z.number().nonnegative().max(10000).nullable().optional(),
  color: z.string().max(20).optional(),
})

export const SaveLayoutSchema = z.object({
  positions: z.array(z.object({
    id: z.number().int().positive(),
    posX: coord,
    posY: coord,
    area: z.string().trim().max(40).optional(),
  })).max(200),
  layoutItems: z.array(LayoutItemSchema).max(200).optional(),
})

export type CreateTableInput = z.infer<typeof CreateTableSchema>
export type UpdateTableInput = z.infer<typeof UpdateTableSchema>
export type SaveLayoutInput = z.infer<typeof SaveLayoutSchema>
