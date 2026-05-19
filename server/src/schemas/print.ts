import { z } from 'zod'

// Schemas para los endpoints de impresión.
// Nota arquitectónica: idealmente la data debería venir del server (DB) y no
// del cliente, pero las rutas existentes aceptan el shape completo. Validamos
// estrictamente para evitar que datos malformados rompan el módulo de print.

const ModifierSchema = z.object({
  optionName: z.string().max(120).nullable().optional(),
  freeText: z.string().max(200).nullable().optional(),
})

const ReceiptItemSchema = z.object({
  dishName: z.string().min(1).max(200),
  quantity: z.number().int().positive().max(999),
  unitPrice: z.number().nonnegative().max(99999),
  modifiers: z.array(ModifierSchema).max(50),
})

export const PrintReceiptSchema = z.object({
  receiptNumber: z.string().min(1).max(40),
  date: z.string().min(1).max(60),
  orderType: z.enum(['dine-in', 'delivery']),
  tableId: z.number().int().positive().nullable().optional(),
  customerName: z.string().max(200).nullable().optional(),
  cashierName: z.string().min(1).max(120),
  items: z.array(ReceiptItemSchema).min(1).max(200),
  paymentMethod: z.enum(['cash', 'yape', 'plin']),
  cashReceived: z.number().nonnegative().nullable().optional(),
  changeAmount: z.number().nullable().optional(),
  total: z.number().nonnegative(),
})

export const PrintPreReceiptSchema = z.object({
  date: z.string().min(1).max(60),
  orderType: z.enum(['dine-in', 'delivery']),
  tableId: z.number().int().positive().nullable().optional(),
  customerName: z.string().max(200).nullable().optional(),
  cashierName: z.string().min(1).max(120),
  items: z.array(ReceiptItemSchema).min(1).max(200),
  total: z.number().nonnegative(),
})

const KitchenItemSchema = z.object({
  dishName: z.string().min(1).max(200),
  quantity: z.number().int().positive().max(999),
  modifiers: z.array(ModifierSchema).max(50),
  notes: z.string().max(500).nullable().optional(),
})

export const PrintKitchenSchema = z.object({
  orderId: z.number().int().positive(),
  orderType: z.enum(['dine-in', 'delivery']),
  tableId: z.number().int().positive().nullable().optional(),
  customerName: z.string().max(200).nullable().optional(),
  waiterName: z.string().min(1).max(120),
  date: z.string().min(1).max(60),
  isAddition: z.boolean(),
  items: z.array(KitchenItemSchema).min(1).max(200),
})

export type PrintReceiptInput = z.infer<typeof PrintReceiptSchema>
export type PrintPreReceiptInput = z.infer<typeof PrintPreReceiptSchema>
export type PrintKitchenInput = z.infer<typeof PrintKitchenSchema>
