// Pronóstico, lista de compra y avisos (incremento 3): llamadas HTTP tipadas, sin
// lógica. La «Compra del día» no usa nada de esto (RD01).
import api from './client'

export interface PurchaseListItem {
  supplyId: number
  code: string
  name: string
  coverageDays: number
  shelfLifeDays: number | null
  serviceLevel: number
  method: string | null
  madeOn: string
  forecast: { date: string; horizon: number; kg: number }[]
  forecastSum: number
  sigmaH: number
  z: number
  safetyStock: number
  available: number
  availableSource: 'conteo' | 'teorico'
  quantity: number
  toBuy: number
}

export interface PurchaseList {
  date: string
  night: string
  modelVersion: string
  items: PurchaseListItem[]
}

export interface LowPortionAlert {
  dishId: number
  name?: string
  portionsLeft: number
  supplyCode: string
}

// Cobertura por insumo → "id:días,id:días"
const coverageParam = (c: Record<number, number>) => Object.entries(c).map(([id, d]) => `${id}:${d}`).join(',')

export async function getPurchaseList(date: string, coverage: Record<number, number>): Promise<PurchaseList> {
  const params: Record<string, string> = { date }
  if (Object.keys(coverage).length > 0) params.coverage = coverageParam(coverage)
  const { data } = await api.get<PurchaseList>('/forecast/purchase-list', { params, timeout: 60000 })
  return data
}

export async function printPurchaseList(date: string, coverage: Record<number, number>) {
  const { data } = await api.post('/forecast/purchase-list/print', { date, coverage: Object.keys(coverage).length ? coverage : undefined }, { timeout: 60000 })
  return data as { ok: boolean }
}

export async function getAlerts(): Promise<{ threshold: number; alerts: LowPortionAlert[] }> {
  const { data } = await api.get<{ threshold: number; alerts: LowPortionAlert[] }>('/forecast/alerts')
  return data
}

// Confirmación de la propuesta de agotado (RF19): la decide una persona (RD02)
export async function confirmSoldOut(dishId: number) {
  await api.patch(`/menu/dishes/${dishId}/availability`, { available: false, source: 'propuesta_confirmada' })
}
