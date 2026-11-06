import { Router } from 'express'
import { db } from '../db'
import { requireAuth, requireRole } from '../middleware/auth'
import { validateBody, validateQuery } from '../middleware/validate'
import { DomainError } from '../errors'
import {
  ForecastHistoryQuerySchema, ForecastRunSchema, PurchaseListPrintSchema, PurchaseListQuerySchema,
  type ForecastRunInput, type PurchaseListPrintInput,
} from '../schemas/forecast'
import { avisos, generarPronosticos, historial, listaCompra, UMBRAL_PORCIONES } from '../services/forecast.service'
import { printPurchaseList } from '../utils/printer'
import { ticketDate } from '../utils/tickets'
import { currentLocalId } from '../utils/local'
import { limaDate } from '../utils/dates'

// Pronóstico y lista de compra (incremento 3). La «Compra del día» no usa nada de esto (RD01).
const router = Router()
const managers = requireRole('owner', 'manager')

// GET /api/forecast/purchase-list?date&coverageDays&coverage=id:días,…
router.get('/purchase-list', requireAuth, managers, validateQuery(PurchaseListQuerySchema), async (req, res) => {
  const q = PurchaseListQuerySchema.parse(req.query)
  res.json(await listaCompra(db, { localId: currentLocalId(), date: q.date ?? limaDate(), coverageDays: q.coverage ?? q.coverageDays }, req.user!.id))
})

// POST /api/forecast/purchase-list/print — el servidor arma la lista; el cliente no manda el ticket
router.post('/purchase-list/print', requireAuth, managers, validateBody(PurchaseListPrintSchema), async (req, res) => {
  const input = req.body as PurchaseListPrintInput
  const lista = await listaCompra(db, { localId: currentLocalId(), date: input.date ?? limaDate(), coverageDays: input.coverage ?? input.coverageDays }, req.user!.id)
  try {
    await printPurchaseList({
      date: lista.date, printedAt: ticketDate(), printedBy: req.user!.name,
      items: lista.items.map(i => ({
        name: i.name, toBuy: i.toBuy, coverageDays: i.coverageDays, forecastSum: i.forecastSum ?? 0,
        available: i.available ?? 0, availableSource: i.availableSource, safetyStock: i.safetyStock ?? 0,
      })),
    })
    res.json({ ok: true, list: lista })
  } catch (err) {
    res.status(502).json({ ok: false, error: (err as Error).message, code: 'PRINTER_UNAVAILABLE' })
  }
})

// POST /api/forecast/run { madeOn } — ejecución a pedido (idempotente, RD04)
router.post('/run', requireAuth, requireRole('owner'), validateBody(ForecastRunSchema), async (req, res) => {
  const { madeOn } = req.body as ForecastRunInput
  if (madeOn > limaDate()) throw new DomainError('No se puede pronosticar desde una noche futura', 400, 'FUTURE_NIGHT')
  res.json(await generarPronosticos(db, { localId: currentLocalId(), madeOn }))
})

// GET /api/forecast/history?supplyId&from&to — pronóstico frente a demanda, solo consulta
router.get('/history', requireAuth, requireRole('owner'), validateQuery(ForecastHistoryQuerySchema), async (req, res) => {
  const q = ForecastHistoryQuerySchema.parse(req.query)
  const h = await historial(db, { localId: currentLocalId(), ...q })
  if (!h) throw new DomainError('Insumo crítico no encontrado', 404, 'SUPPLY_NOT_FOUND')
  res.json(h)
})

// GET /api/forecast/alerts — platos con pocas porciones (todos los roles del POS). Solo
// avisa: marcar agotado lo confirma una persona (RD02).
router.get('/alerts', requireAuth, async (_req, res) => {
  res.json({ threshold: UMBRAL_PORCIONES, alerts: await avisos(db, { localId: currentLocalId(), at: new Date(), umbralPorciones: UMBRAL_PORCIONES }) })
})

export default router
