import { z } from 'zod'

// Los endpoints de impresión ya no reciben el contenido del ticket (TD-14): el
// servidor lo arma desde la BD. Solo se aceptan parámetros de selección.

// Body opcional: sin body se imprime todo lo pendiente del pedido.
export const PrintPreReceiptSchema = z.object({
  billGroupId: z.number().int().positive().optional(),
}).optional()

export type PrintPreReceiptInput = z.infer<typeof PrintPreReceiptSchema>
