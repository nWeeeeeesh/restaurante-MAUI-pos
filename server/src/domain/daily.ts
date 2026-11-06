// Cálculos puros de la «Compra del día» (plan-sistema T4): sin BD, sin entorno, sin
// reloj. El servicio lee por lote y estas funciones arman lo que se responde.
import { roundMoney } from '../utils/math'

export interface PurchaseLike {
  id: number
  supplyId: number
  quantity: number
  totalCost: number
  purchasedAt: string
  supplier: string | null
  entryMode?: string | null
  priceEntryMode?: string | null
}

// Lo comprado de un insumo en la «Compra del día»: cantidad, total, precio unitario
export function summarizePurchases(rows: PurchaseLike[]) {
  const purchased = rows.reduce((t, p) => t + p.quantity, 0)
  const totalCost = rows.reduce((t, p) => t + p.totalCost, 0)
  return {
    purchased,
    unitPrice: purchased > 0 ? roundMoney(totalCost / purchased) : null,
    totalCost: rows.length > 0 ? roundMoney(totalCost) : null,
    supplier: rows.find(p => p.supplier)?.supplier ?? null,
    mode: rows[0]?.entryMode ?? null,
    priceMode: rows[0]?.priceEntryMode ?? null,
  }
}

// Referencia para [Usar] en «Compraste»: lo comprado el mismo día de la semana
// anterior; si no hubo, la última compra. Precio: el de la última compra. Proveedor: el
// último usado. `history` son las compras anteriores a la fecha, de la más reciente a
// la más antigua (todas las de los insumos, leídas en una sola consulta).
export function purchaseReference(history: PurchaseLike[], supplyId: number, sameDayLastWeek: string) {
  const own = history.filter(p => p.supplyId === supplyId)
  const lastWeek = own.filter(p => p.purchasedAt === sameDayLastWeek).reduce((t, p) => t + p.quantity, 0)
  const last = own[0]
  return {
    purchased: lastWeek > 0 ? lastWeek : last?.quantity ?? null,
    fromDate: lastWeek > 0 ? sameDayLastWeek : last?.purchasedAt ?? null,
    unitPrice: last && last.quantity > 0 ? roundMoney(last.totalCost / last.quantity) : null,
    supplier: own.find(p => p.supplier !== null)?.supplier ?? null,
  }
}

// Referencia para [Usar] en «Otros insumos»: el mismo día de la semana anterior o el
// último. `history` va de la fecha más reciente a la más antigua.
export function otherCostReference(history: { date: string; amount: number }[], sameDayLastWeek: string) {
  const ref = history.find(o => o.date === sameDayLastWeek) ?? history[0]
  return ref ? { amount: ref.amount, fromDate: ref.date } : null
}
