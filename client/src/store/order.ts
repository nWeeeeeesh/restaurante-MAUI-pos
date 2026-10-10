import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Category, Dish, OrderItem, OrderType, SelectedModifier } from '../types'

interface OrderStore {
  orderType: OrderType
  tableId: number | null
  items: OrderItem[]
  customerName: string
  customerPhone: string
  customerAddress: string

  setOrderType: (type: OrderType) => void
  setTableId: (id: number | null) => void
  setCustomer: (name: string, phone: string, address: string) => void
  addItem: (item: Omit<OrderItem, 'id' | 'status'>) => void
  removeItem: (id: string) => void
  removeDishes: (dishIds: number[]) => void
  changeQty: (id: string, delta: number) => void
  clearOrder: () => void
  hasUnsavedItems: () => boolean
  syncWithMenu: (menu: Category[]) => { removed: string[]; repriced: boolean }
}

const INITIAL: Pick<OrderStore, 'orderType' | 'tableId' | 'items' | 'customerName' | 'customerPhone' | 'customerAddress'> = {
  orderType: 'dine_in',
  tableId: null,
  items: [],
  customerName: '',
  customerPhone: '',
  customerAddress: '',
}

// Precio que mostrará el borrador: precio del plato + ajustes de las opciones
// elegidas. Es solo informativo: el servidor recalcula con el catálogo al enviar.
export function draftUnitPrice(dish: Dish, modifiers: SelectedModifier[]): number {
  const options = (dish.modifierGroups ?? []).flatMap(g => g.options)
  const adjustment = modifiers.reduce((s, m) => {
    const opt = m.optionId != null ? options.find(o => o.id === m.optionId) : undefined
    return s + (opt?.priceAdjustment ?? 0)
  }, 0)
  return Math.round((dish.price + adjustment) * 100) / 100
}

export const useOrderStore = create<OrderStore>()(
  persist(
    (set, get) => ({
      ...INITIAL,

      setOrderType: (orderType) => set({ orderType }),
      setTableId:   (tableId)   => set({ tableId }),
      setCustomer:  (customerName, customerPhone, customerAddress) =>
        set({ customerName, customerPhone, customerAddress }),

      addItem: (base) => set(s => ({
        items: [...s.items, { ...base, id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`, status: 'pending' }]
      })),

      removeItem: (id) => set(s => ({ items: s.items.filter(i => i.id !== id) })),

      removeDishes: (dishIds) => set(s => ({ items: s.items.filter(i => !dishIds.includes(i.dishId)) })),

      changeQty: (id, delta) => set(s => ({
        items: s.items.map(i => i.id === id ? { ...i, quantity: Math.max(1, i.quantity + delta) } : i)
      })),

      clearOrder: () => set({ ...INITIAL }),

      hasUnsavedItems: () => get().items.length > 0,

      // El borrador vive en localStorage y puede tener horas: al cargar el menú se
      // actualizan nombres y precios, y se quitan los platos que ya no se venden.
      syncWithMenu: (menu) => {
        const dishes = new Map(menu.flatMap(c => c.dishes).map(d => [d.id, d]))
        const removed: string[] = []
        let repriced = false
        const items: OrderItem[] = []
        for (const item of get().items) {
          const dish = dishes.get(item.dishId)
          if (!dish || !dish.available) { removed.push(item.dishName); continue }
          const unitPrice = draftUnitPrice(dish, item.modifiers)
          if (unitPrice !== item.unitPrice || dish.name !== item.dishName) repriced = true
          items.push({ ...item, unitPrice, dishName: dish.name })
        }
        if (removed.length > 0 || repriced) set({ items })
        return { removed, repriced }
      },
    }),
    { name: 'mauideskOrder' }
  )
)
