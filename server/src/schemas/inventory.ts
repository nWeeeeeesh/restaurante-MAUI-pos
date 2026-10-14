import { z } from 'zod'
import { localDateString } from '../utils/dates'
import { SUPPLY_CODE_RE } from '../utils/codes'

// Día local 'YYYY-MM-DD' válido y no futuro: compras, merma y conteos se
// registran el mismo día o después, nunca por adelantado.
const isRealDate = (s: string) => {
  const d = new Date(s + 'T00:00:00')
  return !Number.isNaN(d.getTime()) && localDateString(d) === s
}
export const LocalDateSchema = z.string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Debe ser YYYY-MM-DD')
  .refine(isRealDate, 'Fecha inexistente')
const PastOrTodaySchema = LocalDateSchema
  .refine(s => s <= localDateString(), 'La fecha no puede ser futura')

const quantity = z.number().positive('La cantidad debe ser mayor a 0').max(99999)
const notes = z.string().trim().max(500).nullable().optional()
const id = z.number().int().positive()

// Corregir o borrar exige motivo: queda en audit_log (igual que los gastos)
const ReasonSchema = z.string().trim().min(3, 'Indica el motivo (mínimo 3 caracteres)').max(200)

export const SUPPLY_UNITS = ['kg', 'unit', 'l'] as const
export const WASTE_REASONS = ['deterioro', 'sobra_comensal', 'preparacion', 'otro'] as const
export const DAY_NOTE_KINDS = ['feriado', 'cerrado', 'evento', 'proveedor', 'otro'] as const
export const COUNT_MOMENTS = ['apertura', 'cierre'] as const

const supplier = z.string().trim().max(80).nullable().optional()
const sortOrder = z.number().int().min(0).max(9999)

// ── Insumos ──────────────────────────────────────────────────────────────────
export const CreateSupplySchema = z.object({
  name: z.string().trim().min(1, 'Nombre requerido').max(80),
  unit: z.enum(SUPPLY_UNITS),
  perishable: z.boolean().optional(),
  critical: z.boolean().optional(),
  // Si no se indica se genera desde el nombre (CALAMAR); después no se puede cambiar
  code: z.string().trim().toUpperCase().regex(SUPPLY_CODE_RE, 'Código: 2 a 30 letras, números o _').optional(),
  sortOrder: sortOrder.optional(),
})

// Sin `code`: el código es el identificador estable del insumo en la tesis
export const UpdateSupplySchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  unit: z.enum(SUPPLY_UNITS).optional(),
  perishable: z.boolean().optional(),
  critical: z.boolean().optional(),
  active: z.boolean().optional(),
  sortOrder: sortOrder.optional(),
}).refine(d => Object.keys(d).length > 0, { message: 'Sin cambios para aplicar' })

export const SuppliesQuerySchema = z.object({
  all: z.enum(['true', 'false']).optional(),
})

// ── Compras ──────────────────────────────────────────────────────────────────
export const CreatePurchaseSchema = z.object({
  supplyId: id,
  quantity,
  totalCost: z.number().min(0, 'El costo no puede ser negativo').max(999999),
  purchasedAt: PastOrTodaySchema.optional(),
  notes,
  supplier,
})

export const UpdatePurchaseSchema = z.object({
  supplyId: id.optional(),
  quantity: quantity.optional(),
  totalCost: z.number().min(0).max(999999).optional(),
  purchasedAt: PastOrTodaySchema.optional(),
  notes,
  supplier,
  reason: ReasonSchema,
}).refine(d => Object.keys(d).some(k => k !== 'reason'), { message: 'Debe enviar al menos un campo' })

// ── Merma ────────────────────────────────────────────────────────────────────
export const CreateWasteSchema = z.object({
  supplyId: id,
  quantity,
  reason: z.enum(WASTE_REASONS),
  wastedAt: PastOrTodaySchema.optional(),
  notes,
})

// `reason` de la merma es su causa; el motivo de la corrección va en `correctionReason`
export const UpdateWasteSchema = z.object({
  supplyId: id.optional(),
  quantity: quantity.optional(),
  reason: z.enum(WASTE_REASONS).optional(),
  wastedAt: PastOrTodaySchema.optional(),
  notes,
  correctionReason: ReasonSchema,
}).refine(d => Object.keys(d).some(k => k !== 'correctionReason'), { message: 'Debe enviar al menos un campo' })

export const DeleteWithReasonSchema = z.object({
  reason: ReasonSchema,
})

// ── Conteo de cierre ─────────────────────────────────────────────────────────
// Un conteo puede ser 0 (se acabó): por eso aquí se admite cero.
// PUT /counts/:date es el conteo suelto (por defecto 'cierre', como en la v1); la
// apertura la registra la «Compra del día»
export const SaveCountsSchema = z.object({
  moment: z.enum(COUNT_MOMENTS).optional(),
  items: z.array(z.object({
    supplyId: id,
    quantity: z.number().min(0, 'La cantidad no puede ser negativa').max(99999),
  })).min(1, 'Registra al menos un insumo')
    .refine(items => new Set(items.map(i => i.supplyId)).size === items.length, 'Insumo repetido'),
})

export const CountsQuerySchema = z.object({
  date: LocalDateSchema.optional(),
  moment: z.enum(COUNT_MOMENTS).optional(),
})

// ── «Compra del día» ─────────────────────────────────────────────────────────
// Todo opcional salvo que una compra debe tener precio (unitario o total).
const DailyItemSchema = z.object({
  supplyId: id,
  // «Quedaba»: stock antes de comprar; null = no se contó
  opening: z.number().min(0, 'La cantidad no puede ser negativa').max(99999).nullable().optional(),
  // «Botaste»: merma por deterioro descubierta al revisar
  wasted: z.number().min(0).max(99999).optional(),
  // «Compraste»
  purchased: z.number().min(0).max(99999).optional(),
  unitPrice: z.number().min(0).max(99999).nullable().optional(),
  totalCost: z.number().min(0).max(999999).nullable().optional(),
  supplier,
}).refine(
  i => !i.purchased || (i.unitPrice !== null && i.unitPrice !== undefined) || (i.totalCost !== null && i.totalCost !== undefined),
  { message: 'Si compraste, indica el precio', path: ['unitPrice'] },
)

export const SaveDailySchema = z.object({
  date: LocalDateSchema.optional(),
  items: z.array(DailyItemSchema).max(100)
    .refine(items => new Set(items.map(i => i.supplyId)).size === items.length, 'Insumo repetido'),
  notes: z.array(z.object({
    kind: z.enum(DAY_NOTE_KINDS),
    text: z.string().trim().max(300).nullable().optional(),
  })).max(20).optional(),
})

export const DailyQuerySchema = z.object({
  date: LocalDateSchema.optional(),
})

// ── Ventas perdidas ("No había") ─────────────────────────────────────────────
export const CreateLostSaleSchema = z.object({
  dishId: id.optional(),
  supplyId: id.optional(),
  quantity: z.number().int().positive().max(99).optional(),
}).refine(d => d.dishId !== undefined || d.supplyId !== undefined, { message: 'Indica el plato o el insumo' })

// ── Rangos y export ──────────────────────────────────────────────────────────
export const RangeQuerySchema = z.object({
  from: LocalDateSchema.optional(),
  to: LocalDateSchema.optional(),
})

export const EXPORT_TABLES = ['daily', 'purchases', 'waste', 'counts', 'lost_sales', 'stockouts', 'day_notes', 'supplies'] as const
export const ExportQuerySchema = RangeQuerySchema.extend({
  table: z.enum(EXPORT_TABLES),
})

export type CreateSupplyInput   = z.infer<typeof CreateSupplySchema>
export type UpdateSupplyInput   = z.infer<typeof UpdateSupplySchema>
export type CreatePurchaseInput = z.infer<typeof CreatePurchaseSchema>
export type UpdatePurchaseInput = z.infer<typeof UpdatePurchaseSchema>
export type CreateWasteInput    = z.infer<typeof CreateWasteSchema>
export type UpdateWasteInput    = z.infer<typeof UpdateWasteSchema>
export type SaveCountsInput     = z.infer<typeof SaveCountsSchema>
export type CreateLostSaleInput = z.infer<typeof CreateLostSaleSchema>
export type SaveDailyInput      = z.infer<typeof SaveDailySchema>
export type ExportTable         = typeof EXPORT_TABLES[number]
