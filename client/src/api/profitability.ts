// Rentabilidad operativa (incremento 2): llamadas HTTP tipadas, sin lógica. Todo el
// cálculo lo hace el servidor.
import api from './client'

export type GroupBy = 'day' | 'week' | 'month'
export type MenuCategory = 'Estrella' | 'Caballo de batalla' | 'Rompecabezas' | 'Perro'

export interface ProfitTotals {
  from: string
  to: string
  sales: number
  cogs: number
  otherSupplies: number
  expenses: number
  fixedExpenses: number
  grossProfit: number
  operatingProfit: number
  foodCostPct: number | null
  breakEvenSales: number | null
  waste: { kg: number; cost: number; pct: number | null }
}

export interface ProfitSupply {
  supplyId: number
  code: string
  name: string
  consumptionKg: number
  purchasedKg: number
  wasteKg: number
  wastePct: number | null
  wasteCost: number
  cost: number
  averageCost: number | null
  factor: number
  calibrated: boolean
  imputedDays: string[]
}

export interface ProfitDish {
  dishId: number
  variant: string
  name: string
  price: number
  portions: number
  cost: number
  margin: number
  marginPct: number | null
  category: MenuCategory | null
  noRecipe: boolean
}

export type ProfitWarning =
  | { code: 'NO_RECIPE'; dishId: number; variant: string; name: string }
  | { code: 'FACTOR_OUT_OF_RANGE'; supplyId: number; supplyCode: string; factor: number }
  | { code: 'NOT_CALIBRATED'; supplyId: number; supplyCode: string }
  | { code: 'MISSING_COUNT'; dates: string[] }
  | { code: 'NO_PURCHASE_PRICE'; supplyId: number; supplyCode: string }

export interface Profitability {
  period: { from: string; to: string; groupBy: GroupBy; localId: number }
  totals: ProfitTotals
  series: (ProfitTotals & { key: string })[]
  supplies: ProfitSupply[]
  dishes: ProfitDish[]
  imputedDays: string[]
  warnings: ProfitWarning[]
}

export async function getProfitability(q: { from: string; to: string; groupBy: GroupBy }): Promise<Profitability> {
  // Un año de datos en la Raspberry puede tardar más que el timeout por defecto
  const { data } = await api.get<Profitability>('/profitability', { params: q, timeout: 30000 })
  return data
}

export interface ExpenseCategory {
  category: string
  kind: 'fijo' | 'variable'
  classified: boolean
  expenses: number
}

export async function getExpenseCategories(): Promise<ExpenseCategory[]> {
  const { data } = await api.get<ExpenseCategory[]>('/reports/expense-categories')
  return data
}

export async function setExpenseKind(category: string, kind: 'fijo' | 'variable') {
  const { data } = await api.put(`/reports/expense-categories/${encodeURIComponent(category)}`, { kind })
  return data as { category: string; kind: 'fijo' | 'variable' }
}
