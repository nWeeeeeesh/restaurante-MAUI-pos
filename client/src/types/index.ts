export type TableStatus = 'free' | 'occupied' | 'paying'
export type OrderType = 'dine_in' | 'delivery'
export type ItemStatus = 'pending' | 'preparing' | 'ready'

export interface ModifierOption {
  id: number
  groupId: number
  name: string
  priceAdjustment: number
  displayOrder: number
}

export interface ModifierGroup {
  id: number
  dishId: number
  name: string
  type: 'spice' | 'preference'
  required: boolean
  multiple: boolean
  options: ModifierOption[]
}

export interface Dish {
  id: number
  categoryId: number
  name: string
  description: string | null
  price: number
  available: boolean
  hasSpiceLevel: boolean
  modifierGroups?: ModifierGroup[]
}

export interface Category {
  id: number
  name: string
  displayOrder: number
  dishes: Dish[]
}

export interface SelectedModifier {
  groupId: number
  groupName: string
  optionId?: number
  optionName?: string
  freeText?: string
}

export interface OrderItem {
  id: string
  dishId: number
  dishName: string
  unitPrice: number
  quantity: number
  modifiers: SelectedModifier[]
  notes: string
  status: ItemStatus
}

