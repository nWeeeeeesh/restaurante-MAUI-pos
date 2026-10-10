import { Router } from 'express'
import { and, eq, isNull } from 'drizzle-orm'
import { db } from '../db'
import { bills, orderItems } from '../db/schema'
import { requireAuth, requireRole } from '../middleware/auth'
import { validateBody } from '../middleware/validate'
import { PrintPreReceiptSchema } from '../schemas/print'
import {
  printReceipt,
  printPreReceipt,
  printTestPage,
  checkPrinterStatus,
  clearWindowsQueue,
} from '../utils/printer'
import { localDayStart, localDayEnd } from '../utils/dates'
import { buildReceipt } from '../services/receipt.service'
import { getFullOrder } from '../services/order.serializer'
import { ticketDate } from '../utils/tickets'

const router = Router()

// Nota (TD-14): ningún endpoint de impresión acepta el contenido desde el cliente.
// El cliente indica QUÉ imprimir (boleta, pedido) y el servidor arma el ticket
// desde la BD. Antes cualquier rol podía imprimir una "boleta" arbitraria.

function isToday(paidAt: string | null): boolean {
  if (!paidAt) return false
  return paidAt >= localDayStart() && paidAt <= localDayEnd()
}

// GET /api/print/status — diagnóstico rápido sin imprimir nada
router.get('/status', requireAuth, async (_req, res) => {
  const status = await checkPrinterStatus()
  res.json(status)
})

// POST /api/print/clear-queue — limpiar cola atorada (solo modo Windows)
router.post('/clear-queue', requireAuth, requireRole('owner', 'manager', 'cashier'), async (_req, res) => {
  try {
    const type = process.env.PRINTER_TYPE ?? 'tcp'
    if (type !== 'windows') {
      res.status(400).json({ error: 'Limpieza de cola solo aplica a impresoras Windows' })
      return
    }
    const name = process.env.PRINTER_NAME
    if (!name) { res.status(400).json({ error: 'PRINTER_NAME no configurado' }); return }
    const { removed } = await clearWindowsQueue(name)
    res.json({ ok: true, removed })
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message })
  }
})

// POST /api/print/test — página de prueba (antes era un GET con efecto secundario)
router.post('/test', requireAuth, requireRole('owner'), async (_req, res) => {
  try {
    await printTestPage()
    res.json({ ok: true, message: 'Pagina de prueba enviada a la impresora' })
  } catch (err: any) {
    res.status(502).json({ ok: false, error: err.message, code: 'PRINTER_UNAVAILABLE' })
  }
})

// POST /api/print/pre-receipt/:orderId — pre-cuenta de lo pendiente (o de una sub-cuenta)
router.post(
  '/pre-receipt/:orderId',
  requireAuth, requireRole('owner', 'manager', 'cashier'), validateBody(PrintPreReceiptSchema),
  async (req, res) => {
    const orderId = Number(req.params.orderId)
    const billGroupId = (req.body as { billGroupId?: number } | undefined)?.billGroupId
    const full = await getFullOrder(db, orderId)
    if (!full) { res.status(404).json({ error: 'Pedido no encontrado' }); return }

    const pending = await db.select().from(orderItems).where(and(
      eq(orderItems.orderId, orderId),
      isNull(orderItems.billId),
      billGroupId ? eq(orderItems.billGroupId, billGroupId) : undefined,
    ))
    if (pending.length === 0) { res.status(400).json({ error: 'No hay items pendientes', code: 'NOTHING_TO_PRINT' }); return }

    try {
      await printPreReceipt({
        date: ticketDate(),
        orderType: full.type === 'delivery' ? 'delivery' : 'dine-in',
        tableNumber: full.tableNumber,
        customerName: full.customerName,
        cashierName: req.user!.name,
        items: pending.map(i => ({
          dishName: i.dishName,
          quantity: i.quantity ?? 1,
          unitPrice: i.unitPrice,
          modifiers: JSON.parse(i.modifiers ?? '[]'),
        })),
        total: pending.reduce((s, i) => s + i.unitPrice * (i.quantity ?? 1), 0),
      })
      res.json({ ok: true })
    } catch (err: any) {
      res.status(502).json({ ok: false, error: err.message, code: 'PRINTER_UNAVAILABLE' })
    }
  },
)

// POST /api/print/reprint/:billId — imprime una boleta registrada (tras cobrar o desde el historial)
router.post('/reprint/:billId', requireAuth, requireRole('owner', 'manager', 'cashier'), async (req, res) => {
  const billId = Number(req.params.billId)
  const [bill] = await db.select({ paidAt: bills.paidAt }).from(bills).where(eq(bills.id, billId))
  if (!bill) { res.status(404).json({ error: 'Boleta no encontrada' }); return }

  // El cajero solo reimprime boletas del día; dueño y encargado, cualquiera.
  const role = req.user!.role
  if (role !== 'owner' && role !== 'manager' && !isToday(bill.paidAt)) {
    res.status(403).json({ error: 'Sin permisos para reimprimir boletas anteriores' })
    return
  }

  const receipt = await buildReceipt(db, billId)
  if (!receipt || receipt.items.length === 0) {
    res.status(400).json({ error: 'La boleta no tiene items asociados' })
    return
  }

  try {
    await printReceipt(receipt)
    res.json({ ok: true, message: 'Boleta impresa' })
  } catch (err: any) {
    res.status(502).json({ ok: false, error: err.message, code: 'PRINTER_UNAVAILABLE' })
  }
})

export default router
