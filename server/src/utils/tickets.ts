import type { KitchenTicketData } from './printer'

interface OrderLike {
  id: number
  type: 'dine_in' | 'delivery'
  customerName: string | null
  tableNumber: number | null
}

interface ItemLike {
  dishName: string
  quantity: number | null
  modifiers: Array<{ optionName?: string | null; freeText?: string | null }>
  notes: string | null
}

export function ticketDate(base: Date = new Date()): string {
  return base.toLocaleString('es-PE', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

// Etiqueta visible del pedido. Usa el NÚMERO de mesa, no su id técnico: si una
// mesa se borra y se recrea, el id avanza y la comanda saldría con otra mesa (TD-06).
export function orderLabel(order: OrderLike): string {
  return order.type === 'delivery'
    ? `Delivery${order.customerName ? ` · ${order.customerName}` : ''}`
    : `Mesa ${order.tableNumber ?? '?'}`
}

export function buildKitchenTicketData(args: {
  order: OrderLike
  items: ItemLike[]
  waiterName: string
  isAddition: boolean
  isReprint?: boolean
  date?: string
}): KitchenTicketData {
  const { order, items, waiterName, isAddition, isReprint = false, date = ticketDate() } = args
  return {
    orderId: order.id,
    orderType: order.type === 'delivery' ? 'delivery' : 'dine-in',
    tableNumber: order.tableNumber,
    customerName: order.customerName,
    waiterName,
    date,
    isAddition,
    isReprint,
    items: items.map(i => ({
      dishName: i.dishName,
      quantity: i.quantity ?? 1,
      modifiers: i.modifiers,
      notes: i.notes,
    })),
  }
}
