// Tipos y utilidades comunes de las pestañas de Inventario (Fase 0: solo registro).

export type Unit = 'kg' | 'unit' | 'l'
export type WasteReason = 'deterioro' | 'sobra_comensal' | 'preparacion' | 'otro'

export type DayNoteKind = 'feriado' | 'cerrado' | 'evento' | 'proveedor' | 'otro'

export interface Supply {
  id: number
  // Identificador estable para el análisis (CALAMAR); no se edita
  code: string | null
  name: string
  unit: Unit
  perishable: boolean | null
  critical: boolean | null
  active: boolean | null
  sortOrder: number | null
}

export interface Purchase {
  id: number
  supplyId: number
  supplyName: string
  unit: Unit
  quantity: number
  totalCost: number
  purchasedAt: string
  notes: string | null
  supplier: string | null
  // 'daily' = lo registró la «Compra del día»
  source: 'manual' | 'daily'
  createdByName: string | null
}

export interface WasteRecord {
  id: number
  supplyId: number
  supplyName: string
  unit: Unit
  quantity: number
  reason: WasteReason
  wastedAt: string
  notes: string | null
  createdByName: string | null
}

// «Compra del día»: una fila por insumo crítico
export interface DailyItem {
  supplyId: number
  code: string | null
  name: string
  unit: Unit
  opening: number | null
  wasted: number
  purchased: number
  unitPrice: number | null
  totalCost: number | null
  supplier: string | null
  // Prellenado: compra del mismo día de la semana anterior (o la última), último precio y proveedor
  suggestion: { purchased: number | null; unitPrice: number | null; supplier: string | null }
}

export interface DailyDay {
  date: string
  minDate: string
  saved: boolean
  // Día operativo anterior: a él se imputa lo que se bota en la mañana
  wasteDate: string
  items: DailyItem[]
  notes: { id: number; kind: DayNoteKind; text: string | null }[]
}

export const UNIT_LABEL: Record<Unit, string> = { kg: 'kg', unit: 'unid.', l: 'L' }

export const NOTE_KINDS: { key: DayNoteKind; label: string }[] = [
  { key: 'feriado',   label: 'Feriado' },
  { key: 'evento',    label: 'Evento' },
  { key: 'proveedor', label: 'Cambio de proveedor' },
  { key: 'otro',      label: 'Otro' },
]

export const WASTE_REASONS: { key: WasteReason; label: string }[] = [
  { key: 'deterioro',      label: 'Deterioro' },
  { key: 'sobra_comensal', label: 'Sobra del comensal' },
  { key: 'preparacion',    label: 'Preparación' },
  { key: 'otro',           label: 'Otro' },
]

export const inputCls = 'w-full bg-[#EEF3F8] rounded-xl px-4 py-3 text-sm placeholder-[#94A3B8] focus:outline-none focus:ring-2 focus:ring-[#0077B6]/30 border border-transparent focus:border-[#0077B6]'

// Los teclados en español escriben "1,5": se acepta coma o punto.
export function parseNumber(value: string): number | null {
  const n = Number(value.trim().replace(',', '.'))
  return value.trim() !== '' && Number.isFinite(n) ? n : null
}

export function fmtQty(n: number, unit: Unit): string {
  return `${Number(n.toFixed(3))} ${UNIT_LABEL[unit]}`
}

export function errorMessage(err: unknown, fallback = 'Intenta nuevamente.'): string {
  const data = (err as { response?: { data?: { error?: string; issues?: { message: string }[] } } })?.response?.data
  return data?.issues?.[0]?.message ?? data?.error ?? fallback
}
