import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { OrderItem, OrderType } from '../types'

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
  changeQty: (id: string, delta: number) => void
  clearOrder: () => void
  hasUnsavedItems: () => boolean
}

const INITIAL: Pick<OrderStore, 'orderType' | 'tableId' | 'items' | 'customerName' | 'customerPhone' | 'customerAddress'> = {
  orderType: 'dine_in',
  tableId: null,
  items: [],
  customerName: '',
  customerPhone: '',
  customerAddress: '',
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

      changeQty: (id, delta) => set(s => ({
        items: s.items.map(i => i.id === id ? { ...i, quantity: Math.max(1, i.quantity + delta) } : i)
      })),

      clearOrder: () => set({ ...INITIAL }),

      hasUnsavedItems: () => get().items.length > 0,
    }),
    { name: 'mauideskOrder' }
  )
)
