import { z } from 'zod'

// Modificadores que llegan desde el cliente: option seleccionada de un grupo
// (optionName) o texto libre del mozo (freeText). Ambos opcionales por item.
const ModifierInputSchema = z.object({
  optionName: z.string().trim().max(120).nullable().optional(),
  freeText: z.string().trim().max(200).nullable().optional(),
}).passthrough() // permite campos extra (groupId, etc.) sin romper

const OrderItemInputSchema = z.object({
  dishId: z.number().int().positive(),
  dishName: z.string().trim().min(1).max(200),
  unitPrice: z.number().positive().max(99999),
  quantity: z.number().int().positive().max(999),
  modifiers: z.array(ModifierInputSchema).max(50).optional(),
  notes: z.string().trim().max(500).nullable().optional(),
})

export const CreateOrderSchema = z.object({
  tableId: z.number().int().positive().nullable().optional(),
  type: z.enum(['dine_in', 'delivery']),
  customerName: z.string().trim().max(200).nullable().optional(),
  customerPhone: z.string().trim().max(40).nullable().optional(),
  customerAddress: z.string().trim().max(500).nullable().optional(),
  notes: z.string().trim().max(500).nullable().optional(),
  items: z.array(OrderItemInputSchema).max(200).optional(),
})

export const AddItemsSchema = z.object({
  items: z.array(OrderItemInputSchema).min(1, 'Debes enviar al menos un item').max(200),
})

export const UpdateOrderStatusSchema = z.object({
  status: z.enum(['pending', 'preparing', 'ready', 'paid', 'cancelled', 'paying']),
})

export type OrderItemInput = z.infer<typeof OrderItemInputSchema>
export type CreateOrderInput = z.infer<typeof CreateOrderSchema>
export type AddItemsInput = z.infer<typeof AddItemsSchema>
export type UpdateOrderStatusInput = z.infer<typeof UpdateOrderStatusSchema>
