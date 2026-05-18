import { Router } from 'express'
import { eq } from 'drizzle-orm'
import { db } from '../db'
import { bills, orders, orderItems, users } from '../db/schema'
import { requireAuth } from '../middleware/auth'
import {
  printReceipt,
  printPreReceipt,
  printKitchenTicket,
  printTestPage,
  checkPrinterStatus,
  clearWindowsQueue,
  type ReceiptData,
  type PreReceiptData,
  type KitchenTicketData,
} from '../utils/printer'
import { requireRole } from '../middleware/auth'

const router = Router()

// Helper local para validar acceso por rol (waiter/cashier solo hoy)
function isToday(paidAt: string | null): boolean {
  if (!paidAt) return false
  const start = new Date(); start.setHours(0, 0, 0, 0)
  const end   = new Date(); end.setHours(23, 59, 59, 999)
  const startUtc = start.toISOString().slice(0, 19).replace('T', ' ')
  const endUtc   = end.toISOString().slice(0, 19).replace('T', ' ')
  return paidAt >= startUtc && paidAt <= endUtc
}

// GET /api/print/status — diagnostico rapido sin imprimir nada
router.get('/status', requireAuth, async (_req, res) => {
  const status = await checkPrinterStatus()
  res.json(status)
})

// POST /api/print/clear-queue — limpiar cola atorada (solo owner/cashier)
router.post('/clear-queue', requireAuth, requireRole('owner', 'cashier'), async (_req, res) => {
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

router.get('/test', requireAuth, async (_req, res) => {
  try {
    await printTestPage()
    res.json({ ok: true, message: 'Pagina de prueba enviada a la impresora' })
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message })
  }
})

router.post('/receipt', requireAuth, async (req, res) => {
  try {
    const data: ReceiptData = req.body
    await printReceipt(data)
    res.json({ ok: true })
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message })
  }
})

router.post('/pre-receipt', requireAuth, async (req, res) => {
  try {
    const data: PreReceiptData = req.body
    await printPreReceipt(data)
    res.json({ ok: true })
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message })
  }
})

router.post('/kitchen', requireAuth, async (req, res) => {
  try {
    const data: KitchenTicketData = req.body
    await printKitchenTicket(data)
    res.json({ ok: true })
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message })
  }
})

// POST /api/print/reprint/:billId — reimprimir una boleta del historial
router.post('/reprint/:billId', requireAuth, async (req, res) => {
  const billId = Number(req.params.billId)
  const [bill] = await db.select().from(bills).where(eq(bills.id, billId))
  if (!bill) { res.status(404).json({ error: 'Boleta no encontrada' }); return }

  // Permisos: waiter/cashier solo boletas del día
  if (req.user!.role !== 'owner' && !isToday(bill.paidAt)) {
    res.status(403).json({ error: 'Sin permisos para reimprimir boletas anteriores' })
    return
  }

  const items = await db.select().from(orderItems).where(eq(orderItems.billId, billId))
  if (items.length === 0) {
    res.status(400).json({ error: 'La boleta no tiene items asociados' })
    return
  }

  let order: any = null
  if (bill.orderId !== null) {
    const [o] = await db.select().from(orders).where(eq(orders.id, bill.orderId))
    order = o ?? null
  }
  let cashierName = 'Cajero'
  if (bill.createdBy !== null) {
    const [u] = await db.select().from(users).where(eq(users.id, bill.createdBy))
    if (u) cashierName = u.name
  }

  const date = bill.paidAt
    ? new Date(bill.paidAt + 'Z').toLocaleString('es-PE', {
        day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
      })
    : new Date().toLocaleString('es-PE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })

  try {
    await printReceipt({
      receiptNumber: bill.receiptNumber,
      date,
      orderType: order?.type === 'delivery' ? 'delivery' : 'dine-in',
      tableId: order?.tableId ?? null,
      customerName: order?.customerName ?? null,
      cashierName,
      items: items.map(i => ({
        dishName: i.dishName,
        quantity: i.quantity ?? 1,
        unitPrice: i.unitPrice,
        modifiers: JSON.parse(i.modifiers ?? '[]'),
      })),
      paymentMethod: bill.paymentMethod,
      cashReceived: bill.cashReceived,
      changeAmount: bill.changeAmount,
      total: bill.total,
    })
    res.json({ ok: true, message: 'Boleta reimpresa' })
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message })
  }
})

export default router
