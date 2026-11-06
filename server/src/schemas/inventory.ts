import { z } from 'zod'
import { localDateString } from '../utils/dates'
import { SUPPLY_CODE_RE } from '../utils/codes'
import { ENTRY_MODES } from '../db/schema'

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
export const DAY_NOTE_KINDS = ['feriado', 'cerrado', 'evento', 'proveedor', 'otro', 'dueno_ausente'] as const
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
  // Incremento 2 y 3: kg limpios por kg comprado, vida útil y nivel de servicio
  yield: z.number().gt(0, 'El rendimiento debe ser mayor a 0').max(1, 'El rendimiento no puede superar 1').optional(),
  shelfLifeDays: z.number().int().min(1).max(365).nullable().optional(),
  serviceLevel: z.number().min(0.5, 'El nivel de servicio va de 0.50 a 0.999').max(0.999, 'El nivel de servicio va de 0.50 a 0.999').nullable().optional(),
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

// ── «Compra del día» en dos partes (plan v3 §2.2) ────────────────────────────
// Cada valor viaja con su modo de entrada (invariante 5): 'typed' lo escribió una
// persona, 'copied' vino de [Usar] o del precio prellenado, 'default' no se tocó.
const entryMode = z.enum(ENTRY_MODES)
const qty = z.number().min(0, 'La cantidad no puede ser negativa').max(99999)
const hasValue = (v: number | null | undefined) => v !== null && v !== undefined

const notesSchema = z.array(z.object({
  kind: z.enum(DAY_NOTE_KINDS),
  text: z.string().trim().max(300).nullable().optional(),
})).max(20)

const uniqueSupplies = <T extends { supplyId: number }>(items: T[]) => new Set(items.map(i => i.supplyId)).size === items.length

const partCommon = {
  date: LocalDateSchema.optional(),
  // Del primer render de la tarjeta al guardado exitoso (carga del registro)
  durationMs: z.number().int().min(0).max(30 * 24 * 3600 * 1000).optional(),
  clientVersion: z.string().trim().max(40).optional(),
}

// Parte A · «Al abrir»: quedaba (obligatorio) y botaste, más las notas del día
const AperturaItemSchema = z.object({
  supplyId: id,
  opening: qty,
  openingMode: entryMode.optional(),
  wasted: qty.optional(),
  wastedMode: entryMode.optional(),
})

// Parte B · «Al volver de comprar»: compra con precio, proveedor y, desde la apertura
// del segundo local, el traslado (envío en el local 1, recepción en el 2)
const CompraItemSchema = z.object({
  supplyId: id,
  purchased: qty.optional(),
  purchasedMode: entryMode.optional(),
  unitPrice: z.number().min(0).max(99999).nullable().optional(),
  totalCost: z.number().min(0).max(999999).nullable().optional(),
  priceMode: entryMode.optional(),
  supplier,
  transfer: qty.optional(),
  transferMode: entryMode.optional(),
  transferUnitCost: z.number().min(0).max(99999).nullable().optional(),
}).refine(
  i => !i.purchased || hasValue(i.unitPrice) || hasValue(i.totalCost),
  { message: 'Si compraste, indica el precio', path: ['unitPrice'] },
)

export const SaveDailySchema = z.discriminatedUnion('part', [
  z.object({
    part: z.literal('apertura'),
    ...partCommon,
    items: z.array(AperturaItemSchema).max(100).refine(uniqueSupplies, 'Insumo repetido'),
    notes: notesSchema.optional(),
  }),
  z.object({
    part: z.literal('compra'),
    ...partCommon,
    items: z.array(CompraItemSchema).max(100).refine(uniqueSupplies, 'Insumo repetido'),
    // Monto en S/ de todo lo no crítico del día; null = no se registró
    otherCost: z.object({ amount: z.number().min(0).max(999999), mode: entryMode.optional() }).nullable().optional(),
    // «Hoy no compré»: el día queda registrado sin compras (no exige ítems)
    noPurchase: z.boolean().optional(),
  }),
])

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

export const EXPORT_TABLES = [
  'daily', 'purchases', 'waste', 'counts', 'lost_sales', 'stockouts', 'day_notes', 'supplies',
  // Plan v3 (E1); study_config salió en el dataset v2 (el estudio por grupos se retiró)
  'daily_parts', 'transfers', 'other_costs', 'sales',
  // Dataset v2 (plan-sistema T19): incrementos 2 y 3
  'recipe_items', 'recipe_calibrations', 'demand_forecasts', 'purchase_suggestions', 'expense_categories', 'app_settings',
] as const
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
