// Tipos y utilidades comunes de las pestañas de Inventario (Fase 0: solo registro).

export type Unit = 'kg' | 'unit' | 'l'
export type WasteReason = 'deterioro' | 'sobra_comensal' | 'preparacion' | 'otro'

export type DayNoteKind = 'feriado' | 'cerrado' | 'evento' | 'proveedor' | 'otro' | 'dueno_ausente'
// Trazabilidad (invariante 5): escrito, copiado de la referencia o sin tocar
export type EntryMode = 'typed' | 'copied' | 'default'

// Versión de esta pantalla en daily_parts: permite saber con qué interfaz se registró
export const CLIENT_VERSION = 'inventario-v3'

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
  // Incremento 2 y 3: kg limpios por kg comprado, vida útil y nivel de servicio
  yield: number
  shelfLifeDays: number | null
  serviceLevel: number | null
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
  source: 'manual' | 'daily'
  createdByName: string | null
}

// «Compra del día»: una fila por insumo crítico
export interface DailyItem {
  supplyId: number
  code: string | null
  name: string
  unit: Unit
  opening: number | null
  openingMode: EntryMode | null
  wasted: number
  wastedMode: EntryMode | null
  purchased: number
  purchasedMode: EntryMode | null
  unitPrice: number | null
  priceMode: EntryMode | null
  totalCost: number | null
  supplier: string | null
  // Enviado al otro local (local 1) o recibido del principal (local 2)
  transfer: number
  transferMode: EntryMode | null
  transferUnitCost: number | null
  // Compra de referencia (mismo día de la semana anterior o la última; se ofrece con
  // [Usar], nunca se prellena), último precio y último proveedor
  reference: { purchased: number | null; fromDate: string | null; unitPrice: number | null; supplier: string | null }
}

export interface PartStatus {
  by: string | null
  at: string | null
  corrections: number
  lastAt: string | null
  // Solo en la parte «compra»: el último guardado fue «Hoy no compré»
  noPurchase: boolean
}

export interface DailyDay {
  date: string
  minDate: string
  // Día operativo anterior: a él se imputa lo que se bota en la mañana
  wasteDate: string
  parts: { apertura: PartStatus | null; compra: PartStatus | null }
  transfers: { enabled: boolean; direction: 'envio' | 'recepcion' }
  items: DailyItem[]
  otherCost: { amount: number; mode: EntryMode | null } | null
  otherCostReference: { amount: number; fromDate: string } | null
  notes: { id: number; kind: DayNoteKind; text: string | null }[]
}

// Ajustes del local (GET /api/settings)
export interface AppSettings {
  second_local_opened_on?: string
}

export const UNIT_LABEL: Record<Unit, string> = { kg: 'kg', unit: 'unid.', l: 'L' }

export const NOTE_KINDS: { key: DayNoteKind; label: string }[] = [
  { key: 'feriado',       label: 'Feriado' },
  { key: 'evento',        label: 'Evento' },
  { key: 'cerrado',       label: 'Cerrado' },
  { key: 'proveedor',     label: 'Cambio de proveedor' },
  { key: 'dueno_ausente', label: 'El dueño no estuvo' },
  { key: 'otro',          label: 'Otro' },
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
