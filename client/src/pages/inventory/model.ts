// Tipos y utilidades comunes de las pestañas de Inventario (Fase 0: solo registro).

export type Unit = 'kg' | 'unit' | 'l'
export type WasteReason = 'deterioro' | 'sobra_comensal' | 'preparacion' | 'otro'

export interface Supply {
  id: number
  name: string
  unit: Unit
  perishable: boolean | null
  critical: boolean | null
  active: boolean | null
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

export interface CountRow {
  id: number
  supplyId: number
  supplyName: string
  quantity: number
  countedOn: string
  createdByName: string | null
}

export interface LostSale {
  id: number
  dishName: string | null
  supplyName: string | null
  quantity: number | null
  occurredAt: string
}

export const UNIT_LABEL: Record<Unit, string> = { kg: 'kg', unit: 'unid.', l: 'L' }

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
