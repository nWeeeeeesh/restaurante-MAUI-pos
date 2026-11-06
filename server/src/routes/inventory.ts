import { Router } from 'express'
import { db } from '../db'
import { requireAuth, requireRole } from '../middleware/auth'
import { validateBody, validateQuery } from '../middleware/validate'
import {
  CountsQuerySchema,
  CreateLostSaleSchema,
  CreatePurchaseSchema,
  CreateSupplySchema,
  CreateWasteSchema,
  DailyQuerySchema,
  DeleteWithReasonSchema,
  ExportQuerySchema,
  LocalDateSchema,
  RangeQuerySchema,
  SaveCountsSchema,
  SaveDailySchema,
  SuppliesQuerySchema,
  UpdatePurchaseSchema,
  UpdateSupplySchema,
  UpdateWasteSchema,
  type CreateLostSaleInput,
  type CreatePurchaseInput,
  type CreateSupplyInput,
  type CreateWasteInput,
  type SaveCountsInput,
  type SaveDailyInput,
  type UpdatePurchaseInput,
  type UpdateSupplyInput,
  type UpdateWasteInput,
} from '../schemas/inventory'
import * as inventory from '../services/inventory.service'
import { dailyPending, getDaily, saveDaily } from '../services/inventory-daily.service'
import { exportCsv } from '../services/inventory-export.service'
import { localDateString } from '../utils/dates'
import { DomainError } from '../errors'

// Inventario de insumos perecibles, Fase 0 de la tesis: solo registro.
// Encargado y dueño registran compras, merma y conteos (son egresos y control,
// igual que los gastos); cualquier rol registra "No había" desde el POS.
const router = Router()
const managers = requireRole('owner', 'manager')

const idParam = (raw: string | string[] | undefined) => {
  const id = Number(raw)
  if (!Number.isInteger(id) || id <= 0) throw new DomainError('Id inválido', 400, 'INVALID_ID')
  return id
}

// ── Insumos ──────────────────────────────────────────────────────────────────
// Todos ven los activos (el POS los necesita para "No había"); ?all=true
// incluye los desactivados para la pestaña Insumos del dueño.
router.get('/supplies', requireAuth, validateQuery(SuppliesQuerySchema), async (req, res) => {
  const all = req.query.all === 'true' && req.user!.role === 'owner'
  res.json(await inventory.listSupplies(db, all))
})

router.post('/supplies', requireAuth, requireRole('owner'), validateBody(CreateSupplySchema), async (req, res) => {
  res.status(201).json(await inventory.createSupply(db, req.body as CreateSupplyInput))
})

router.patch('/supplies/:id', requireAuth, requireRole('owner'), validateBody(UpdateSupplySchema), async (req, res) => {
  res.json(await inventory.updateSupply(db, idParam(req.params.id), req.body as UpdateSupplyInput, req.user!.id))
})

// ── Compras ──────────────────────────────────────────────────────────────────
router.get('/purchases', requireAuth, managers, validateQuery(RangeQuerySchema), async (req, res) => {
  res.json(await inventory.listPurchases(db, inventory.resolveRange(RangeQuerySchema.parse(req.query))))
})

router.post('/purchases', requireAuth, managers, validateBody(CreatePurchaseSchema), async (req, res) => {
  res.status(201).json(await inventory.createPurchase(db, req.body as CreatePurchaseInput, req.user!.id))
})

router.patch('/purchases/:id', requireAuth, managers, validateBody(UpdatePurchaseSchema), async (req, res) => {
  res.json(await inventory.updatePurchase(db, idParam(req.params.id), req.body as UpdatePurchaseInput, req.user!.id))
})

router.delete('/purchases/:id', requireAuth, managers, validateBody(DeleteWithReasonSchema), async (req, res) => {
  await inventory.deletePurchase(db, idParam(req.params.id), (req.body as { reason: string }).reason, req.user!.id)
  res.json({ ok: true })
})

// ── Merma ────────────────────────────────────────────────────────────────────
router.get('/waste', requireAuth, managers, validateQuery(RangeQuerySchema), async (req, res) => {
  res.json(await inventory.listWaste(db, inventory.resolveRange(RangeQuerySchema.parse(req.query))))
})

router.post('/waste', requireAuth, managers, validateBody(CreateWasteSchema), async (req, res) => {
  res.status(201).json(await inventory.createWaste(db, req.body as CreateWasteInput, req.user!.id))
})

router.patch('/waste/:id', requireAuth, managers, validateBody(UpdateWasteSchema), async (req, res) => {
  res.json(await inventory.updateWaste(db, idParam(req.params.id), req.body as UpdateWasteInput, req.user!.id))
})

router.delete('/waste/:id', requireAuth, managers, validateBody(DeleteWithReasonSchema), async (req, res) => {
  await inventory.deleteWaste(db, idParam(req.params.id), (req.body as { reason: string }).reason, req.user!.id)
  res.json({ ok: true })
})

// ── «Compra del día» (la rutina diaria de la tesis) ──────────────────────────
router.get('/daily', requireAuth, managers, validateQuery(DailyQuerySchema), async (req, res) => {
  const { date } = DailyQuerySchema.parse(req.query)
  res.json(await getDaily(db, date ?? localDateString()))
})

router.post('/daily', requireAuth, managers, validateBody(SaveDailySchema), async (req, res) => {
  res.json(await saveDaily(db, req.body as SaveDailyInput, req.user!.id))
})

router.get('/daily/pending', requireAuth, managers, async (_req, res) => {
  res.json(await dailyPending(db))
})

// Va después de /daily/pending para que "pending" no se tome como fecha
router.get('/daily/:date', requireAuth, managers, async (req, res) => {
  const parsed = LocalDateSchema.safeParse(req.params.date)
  if (!parsed.success) throw new DomainError('Fecha inválida (YYYY-MM-DD)', 400, 'INVALID_DATE')
  res.json(await getDaily(db, parsed.data))
})

// ── Conteos sueltos (cierre); la apertura va por /daily ─────────────────────
router.get('/counts', requireAuth, managers, validateQuery(CountsQuerySchema), async (req, res) => {
  const { date, moment } = CountsQuerySchema.parse(req.query)
  res.json(await inventory.listCounts(db, date ?? localDateString(), moment))
})

router.put('/counts/:date', requireAuth, managers, validateBody(SaveCountsSchema), async (req, res) => {
  const parsed = LocalDateSchema.safeParse(req.params.date)
  if (!parsed.success) throw new DomainError('Fecha inválida (YYYY-MM-DD)', 400, 'INVALID_DATE')
  res.json(await inventory.saveCounts(db, parsed.data, req.body as SaveCountsInput, req.user!.id))
})

// ── Ventas perdidas ("No había") ─────────────────────────────────────────────
router.post('/lost-sales', requireAuth, validateBody(CreateLostSaleSchema), async (req, res) => {
  res.status(201).json(await inventory.createLostSale(db, req.body as CreateLostSaleInput, req.user!.id))
})

router.get('/lost-sales', requireAuth, managers, validateQuery(RangeQuerySchema), async (req, res) => {
  res.json(await inventory.listLostSales(db, inventory.resolveRange(RangeQuerySchema.parse(req.query))))
})

// ── Export CSV para la tesis ─────────────────────────────────────────────────
router.get('/export', requireAuth, managers, validateQuery(ExportQuerySchema), async (req, res) => {
  const q = ExportQuerySchema.parse(req.query)
  const range = inventory.resolveRange(q)
  const csv = await exportCsv(db, q.table, range)
  res.setHeader('Content-Type', 'text/csv; charset=utf-8')
  res.setHeader('Content-Disposition', `attachment; filename="maui-${q.table}-${range.from}_${range.to}.csv"`)
  res.send(csv)
})

export default router
