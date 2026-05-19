import { z } from 'zod'

// Esquema de creación de boleta.
// Nota: NO validamos aquí cashReceived >= total porque el total se calcula
// del lado del server en base a los items reales. Esa validación se hace
// en el handler tras conocer el total. Sí garantizamos que cuando el método
// es 'cash', cashReceived sea un número >= 0.
export const CreateBillSchema = z.object({
  orderId: z.number().int().positive(),
  paymentMethod: z.enum(['cash', 'yape', 'plin']),
  cashReceived: z.number().nonnegative().max(999999).optional().nullable(),
  receiptNumber: z.string().trim().min(1).max(40),
  itemIds: z.array(z.number().int().positive()).max(500).optional(),
  billGroupId: z.number().int().positive().optional(),
}).refine(
  d => d.paymentMethod !== 'cash' || (typeof d.cashReceived === 'number' && d.cashReceived >= 0),
  { message: 'cashReceived es requerido y debe ser >= 0 para pago en efectivo', path: ['cashReceived'] },
)

export type CreateBillInput = z.infer<typeof CreateBillSchema>
