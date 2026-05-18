import { create } from 'zustand'
import type { SelectedModifier, TableStatus } from '../types'
import api from '../api/client'
import { socket } from '../api/socket'
import { useToastStore, printerErrorMessage } from './toast'

interface KitchenPrintResult {
  orderId: number
  ok: boolean
  isAddition: boolean
  label: string
  itemCount: number
  reason?: string
  manual?: boolean
}

export interface ActiveOrderItem {
  id: number
  dishId: number
  dishName: string
  unitPrice: number
  quantity: number
  modifiers: SelectedModifier[]
  notes: string | null
  status: 'pending' | 'preparing' | 'ready'
  billId?: number | null
  billGroupId?: number | null
  kitchenPrinted?: boolean
}

export interface BillGroup {
  id: number
  orderId: number
  label: string
  status: 'open' | 'paid'
  billId: number | null
  createdAt?: string | null
}

export interface ActiveOrder {
  id: number
  tableId: number | null
  type: 'dine_in' | 'delivery'
  status: 'pending' | 'preparing' | 'ready' | 'paying'
  customerName: string | null
  customerPhone: string | null
  customerAddress: string | null
  items: ActiveOrderItem[]
  createdAt: string
  billGroups?: BillGroup[]
}

interface ItemPayload {
  dishId: number
  dishName: string
  unitPrice: number
  quantity: number
  modifiers: SelectedModifier[]
  notes?: string
}

interface OrdersStore {
  orders: ActiveOrder[]
  initialized: boolean

  reset: () => void
  init: () => Promise<void>
  createOrder: (payload: {
    tableId: number | null
    type: 'dine_in' | 'delivery'
    customerName?: string
    customerPhone?: string
    customerAddress?: string
    notes?: string
    items: ItemPayload[]
  }) => Promise<ActiveOrder>
  addItemsToOrder: (orderId: number, items: ItemPayload[]) => Promise<void>
  toggleItemReady: (orderId: number, itemId: number) => Promise<void>
  markOrderReady: (orderId: number) => Promise<void>
  cancelOrder: (orderId: number) => Promise<void>
  markOrderPaying: (orderId: number) => Promise<void>
  removeOrder: (orderId: number) => void
  replaceOrderItems: (orderId: number, paidItemIds: number[], billId: number) => void

  saveSplit: (orderId: number, groups: Array<{ label: string; itemIds: number[] }>) => Promise<ActiveOrder>
  deleteSplit: (orderId: number) => Promise<ActiveOrder>

  getTableStatus: (tableId: number) => TableStatus
  getTableOrder: (tableId: number) => ActiveOrder | undefined
  getTableTotal: (tableId: number) => number
  getUnpaidTotal: (tableId: number) => number
}

export const useOrdersStore = create<OrdersStore>((set, get) => ({
  orders: [],
  initialized: false,

  reset: () => {
    socket.disconnect()
    socket.off('order:new')
    socket.off('order:updated')
    socket.off('order:removed')
    socket.off('kitchen:print-result')
    set({ orders: [], initialized: false })
  },

  init: async () => {
    if (get().initialized) return
    set({ initialized: true })

    try {
      const { data } = await api.get<ActiveOrder[]>('/orders/active')
      set({ orders: data })
    } catch (e) {
      console.error('Failed to fetch active orders', e)
    }

    socket.connect()

    socket.on('order:new', (order: ActiveOrder) => {
      set(s => ({
        orders: s.orders.some(o => o.id === order.id)
          ? s.orders.map(o => o.id === order.id ? order : o)
          : [...s.orders, order],
      }))
    })

    socket.on('order:updated', (order: ActiveOrder) => {
      set(s => ({
        orders: s.orders.some(o => o.id === order.id)
          ? s.orders.map(o => o.id === order.id ? order : o)
          : [...s.orders, order],
      }))
    })

    socket.on('order:removed', (orderId: number | string) => {
      set(s => ({ orders: s.orders.filter(o => o.id !== Number(orderId)) }))
    })

    socket.on('kitchen:print-result', (r: KitchenPrintResult) => {
      const action = r.isAddition ? 'Items agregados' : (r.manual ? 'Reimpresión' : 'Comanda')
      if (r.ok) {
        useToastStore.getState().push({
          variant: 'success',
          title: `${action} impresa · ${r.label}`,
          message: `${r.itemCount} item${r.itemCount !== 1 ? 's' : ''} enviado${r.itemCount !== 1 ? 's' : ''} a cocina`,
          durationMs: 3000,
        })
      } else {
        useToastStore.getState().push({
          variant: 'error',
          title: `No se imprimió la comanda · ${r.label}`,
          message: printerErrorMessage({ message: r.reason }),
          durationMs: 6000,
        })
      }
    })
  },

  createOrder: async (payload) => {
    const { data } = await api.post<ActiveOrder>('/orders', payload)
    return data
  },

  addItemsToOrder: async (orderId, items) => {
    await api.post(`/orders/${orderId}/items`, { items })
  },

  toggleItemReady: async (orderId, itemId) => {
    set(s => ({
      orders: s.orders.map(o => {
        if (o.id !== orderId) return o
        const items = o.items.map(i =>
          i.id !== itemId ? i : { ...i, status: i.status === 'ready' ? ('preparing' as const) : ('ready' as const) }
        )
        const allReady = items.every(i => i.status === 'ready')
        return { ...o, items, status: allReady ? 'ready' : 'preparing' }
      }),
    }))
    await api.patch(`/orders/${orderId}/items/${itemId}/toggle`)
  },

  markOrderReady: async (orderId) => {
    set(s => ({
      orders: s.orders.map(o =>
        o.id !== orderId ? o : {
          ...o,
          status: 'ready',
          items: o.items.map(i => ({ ...i, status: 'ready' as const })),
        }
      ),
    }))
    await api.patch(`/orders/${orderId}/ready`)
  },

  cancelOrder: async (orderId) => {
    await api.delete(`/orders/${orderId}`)
  },

  removeOrder: (orderId) => {
    set(s => ({ orders: s.orders.filter(o => o.id !== Number(orderId)) }))
  },

  replaceOrderItems: (orderId, paidItemIds, billId) => {
    const ids = new Set(paidItemIds)
    set(s => ({
      orders: s.orders.map(o => o.id !== orderId ? o : {
        ...o,
        items: o.items.map(i => ids.has(i.id) ? { ...i, billId } : i),
      }),
    }))
  },

  markOrderPaying: async (orderId) => {
    set(s => ({
      orders: s.orders.map(o => o.id !== orderId ? o : { ...o, status: 'paying' }),
    }))
    await api.patch(`/orders/${orderId}/status`, { status: 'paying' })
  },

  saveSplit: async (orderId, groups) => {
    const { data } = await api.post<{ groups: BillGroup[]; order: ActiveOrder }>(
      `/orders/${orderId}/split`,
      { groups }
    )
    set(s => ({ orders: s.orders.map(o => o.id === orderId ? data.order : o) }))
    return data.order
  },

  deleteSplit: async (orderId) => {
    const { data } = await api.delete<{ ok: true; order: ActiveOrder }>(`/orders/${orderId}/split`)
    set(s => ({ orders: s.orders.map(o => o.id === orderId ? data.order : o) }))
    return data.order
  },

  getTableStatus: (tableId) => {
    const order = get().orders.find(o => o.tableId === tableId)
    if (!order) return 'free'
    if (order.status === 'paying') return 'paying'
    return 'occupied'
  },

  getTableOrder: (tableId) => get().orders.find(o => o.tableId === tableId),

  getTableTotal: (tableId) => {
    const order = get().orders.find(o => o.tableId === tableId)
    if (!order) return 0
    return order.items.reduce((s, i) => s + i.unitPrice * i.quantity, 0)
  },

  getUnpaidTotal: (tableId) => {
    const order = get().orders.find(o => o.tableId === tableId)
    if (!order) return 0
    return order.items.filter(i => !i.billId).reduce((s, i) => s + i.unitPrice * i.quantity, 0)
  },
}))
