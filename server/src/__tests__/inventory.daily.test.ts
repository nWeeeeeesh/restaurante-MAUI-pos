import { describe, it, expect, beforeAll } from 'vitest'
import request from 'supertest'
import { and, eq } from 'drizzle-orm'
import { setupHttpApp } from './helpers/http'
import { addDays, localDateString, parseDayBoundary } from '../utils/dates'

// Plan v3 §2.2: la «Compra del día» en dos partes que se guardan por separado.
// A «Al abrir»: quedaba (obligatorio), botaste y notas. B «Al volver de comprar»:
// compras, precio, proveedor y otros insumos. Cada parte es idempotente por fecha,
// no toca la otra y deja quién, cuándo, cuánto tardó y cómo se ingresó cada valor.
let ctx: Awaited<ReturnType<typeof setupHttpApp>>
let owner: string
let manager: string
let pescado: number
let calamar: number
let pulpo: number
let choclo: number

const today = localDateString()

beforeAll(async () => {
  ctx = await setupHttpApp()
  owner = (await ctx.as('owner', 'Dueño')).auth
  manager = (await ctx.as('manager', 'Encargada')).auth
  const ins = (name: string, code: string, sortOrder: number, critical = true, active = true) =>
    ctx.db.insert(ctx.schema.supplies).values({ name, code, sortOrder, unit: 'kg', critical, active }).returning()
  ;[{ id: pescado }] = await ins('Pescado', 'PESCADO', 1)
  ;[{ id: calamar }] = await ins('Calamar', 'CALAMAR', 2)
  ;[{ id: pulpo }] = await ins('Pulpo', 'PULPO', 3)
  ;[{ id: choclo }] = await ins('Choclo', 'CHOCLO', 9, false)
  await ins('Langostino', 'LANGOSTINO', 4, true, false)
})

const apertura = (date: string, items: object[], extra: object = {}, auth = manager) =>
  request(ctx.app).post('/api/inventory/daily').set('Authorization', auth)
    .send({ part: 'apertura', date, items, durationMs: 41000, clientVersion: 'test', ...extra })
const compra = (date: string, items: object[], extra: object = {}, auth = owner) =>
  request(ctx.app).post('/api/inventory/daily').set('Authorization', auth)
    .send({ part: 'compra', date, items, durationMs: 52000, clientVersion: 'test', ...extra })
const getDaily = (date: string) => request(ctx.app).get(`/api/inventory/daily/${date}`).set('Authorization', manager)

// Apertura completa de los tres críticos activos
const fullOpening = (p: number, c: number, u: number) => [
  { supplyId: pescado, opening: p, openingMode: 'typed', wasted: 0.5, wastedMode: 'typed' },
  { supplyId: calamar, opening: c, openingMode: 'typed', wasted: 0, wastedMode: 'default' },
  { supplyId: pulpo, opening: u, openingMode: 'typed' },
]

const rowsFor = async (date: string) => ({
  counts: await ctx.db.select().from(ctx.schema.supplyCounts)
    .where(and(eq(ctx.schema.supplyCounts.countedOn, date), eq(ctx.schema.supplyCounts.moment, 'apertura'))),
  purchases: await ctx.db.select().from(ctx.schema.supplyPurchases).where(and(
    eq(ctx.schema.supplyPurchases.source, 'daily'), eq(ctx.schema.supplyPurchases.sourceDate, date))),
  waste: await ctx.db.select().from(ctx.schema.supplyWaste).where(and(
    eq(ctx.schema.supplyWaste.source, 'daily'), eq(ctx.schema.supplyWaste.sourceDate, date))),
  notes: await ctx.db.select().from(ctx.schema.dayNotes).where(eq(ctx.schema.dayNotes.date, date)),
  parts: await ctx.db.select().from(ctx.schema.dailyParts).where(eq(ctx.schema.dailyParts.date, date)),
  other: await ctx.db.select().from(ctx.schema.otherSupplyCosts).where(eq(ctx.schema.otherSupplyCosts.date, date)),
})

async function sale(date: string) {
  await ctx.db.insert(ctx.schema.bills).values({
    subtotal: 30, total: 30, paymentMethod: 'cash',
    receiptNumber: `T-${date}-${Math.random().toString(36).slice(2, 7)}`,
    paidAt: parseDayBoundary(date, 'end'),
  })
}

describe('parte A · «Al abrir»', () => {
  it('guarda apertura, merma (también 0) y notas, con modo de entrada, autor y duración', async () => {
    const res = await apertura(today, fullOpening(2, 1, 0), { notes: [{ kind: 'dueno_ausente' }] })
    expect(res.status).toBe(200)
    const r = await rowsFor(today)
    expect(r.counts.map(c => [c.supplyId, c.quantity, c.entryMode, c.localId]).sort())
      .toEqual([[pescado, 2, 'typed', 1], [calamar, 1, 'typed', 1], [pulpo, 0, 'typed', 1]].sort())
    // Botaste en 0 sin tocar también queda registrado: distingue "no boté" de "no revisé"
    const waste = Object.fromEntries(r.waste.map(w => [w.supplyId, w]))
    expect(waste[pescado]).toMatchObject({ quantity: 0.5, entryMode: 'typed', reason: 'deterioro', wastedAt: addDays(today, -1) })
    expect(waste[calamar]).toMatchObject({ quantity: 0, entryMode: 'default' })
    expect(waste[pulpo]).toMatchObject({ quantity: 0, entryMode: 'default' })
    expect(r.notes.map(n => n.kind)).toEqual(['dueno_ausente'])
    expect(r.parts).toHaveLength(1)
    expect(r.parts[0]).toMatchObject({ part: 'apertura', durationMs: 41000, isCorrection: false, clientVersion: 'test', localId: 1 })
  })

  it('quedaba es obligatorio para todos los críticos activos', async () => {
    const day = addDays(today, -2)
    const res = await apertura(day, [{ supplyId: pescado, opening: 1 }, { supplyId: calamar, opening: 1 }])
    expect(res.status).toBe(400)
    expect(res.body.code).toBe('DAILY_INCOMPLETE')
    expect((await apertura(day, [{ supplyId: pescado, opening: null }])).status).toBe(400)
    expect((await rowsFor(day)).parts).toHaveLength(0)
  })

  it('volver a guardarla corrige sin duplicar, marca is_correction y deja audit', async () => {
    const res = await apertura(today, fullOpening(2.5, 1, 0))
    expect(res.status).toBe(200)
    const r = await rowsFor(today)
    expect(r.counts).toHaveLength(3)
    expect(r.counts.find(c => c.supplyId === pescado)?.quantity).toBe(2.5)
    expect(r.waste).toHaveLength(3)
    // Sin `notes` en el cuerpo, las notas del día no se tocan
    expect(r.notes.map(n => n.kind)).toEqual(['dueno_ausente'])
    expect(r.parts.map(p => p.isCorrection)).toEqual([false, true])
    const logs = await ctx.db.select().from(ctx.schema.auditLog).where(eq(ctx.schema.auditLog.action, 'daily.update'))
    expect(JSON.parse(logs[logs.length - 1].data!)).toMatchObject({ date: today, part: 'apertura', before: { counts: expect.any(Array) } })
  })

  it('la merma se imputa al día operativo anterior (el último con ventas)', async () => {
    const day = addDays(today, -1)
    await sale(addDays(today, -4))
    await apertura(day, fullOpening(1, 1, 1))
    const w = (await rowsFor(day)).waste.find(x => x.supplyId === pescado)
    expect(w).toMatchObject({ quantity: 0.5, wastedAt: addDays(today, -4), sourceDate: day })
  })
})

describe('parte B · «Al volver de comprar»', () => {
  it('guarda compras con modo de cantidad y de precio, y otros insumos; no toca la parte A', async () => {
    const res = await compra(today, [
      { supplyId: pescado, purchased: 3, purchasedMode: 'copied', unitPrice: 25, priceMode: 'copied', supplier: 'Terminal' },
      { supplyId: calamar, purchased: 2, purchasedMode: 'typed', unitPrice: 24, priceMode: 'typed', totalCost: 47 },
      { supplyId: pulpo },
    ], { otherCost: { amount: 38.5, mode: 'typed' } })
    expect(res.status).toBe(200)
    const r = await rowsFor(today)
    expect(r.purchases).toHaveLength(2)
    expect(r.purchases.find(p => p.supplyId === pescado)).toMatchObject({ quantity: 3, totalCost: 75, entryMode: 'copied', priceEntryMode: 'copied', supplier: 'Terminal', localId: 1 })
    expect(r.purchases.find(p => p.supplyId === calamar)).toMatchObject({ totalCost: 47, entryMode: 'typed', priceEntryMode: 'typed' })
    expect(r.other).toMatchObject([{ amount: 38.5, entryMode: 'typed', source: 'daily', localId: 1 }])
    // La parte A sigue intacta
    expect(r.counts).toHaveLength(3)
    expect(r.waste).toHaveLength(3)
    expect(r.parts.filter(p => p.part === 'compra').map(p => p.isCorrection)).toEqual([false])
  })

  it('volver a guardarla reemplaza solo lo suyo; guardar A después no borra B', async () => {
    await compra(today, [{ supplyId: pescado, purchased: 4, unitPrice: 25 }], { otherCost: { amount: 40, mode: 'copied' } })
    let r = await rowsFor(today)
    expect(r.purchases.map(p => [p.supplyId, p.quantity])).toEqual([[pescado, 4]])
    expect(r.other).toMatchObject([{ amount: 40, entryMode: 'copied' }])
    expect(r.parts.filter(p => p.part === 'compra').map(p => p.isCorrection)).toEqual([false, true])

    await apertura(today, fullOpening(2.5, 1.2, 0))
    r = await rowsFor(today)
    expect(r.purchases).toHaveLength(1)
    expect(r.other).toHaveLength(1)

    // Sin otros insumos en el cuerpo se borra el de esta pantalla
    await compra(today, [{ supplyId: pescado, purchased: 4, unitPrice: 25 }], { otherCost: null })
    expect((await rowsFor(today)).other).toHaveLength(0)
  })

  it('no toca las compras manuales del mismo día', async () => {
    const manual = await request(ctx.app).post('/api/inventory/purchases').set('Authorization', manager)
      .send({ supplyId: choclo, quantity: 5, totalCost: 10, purchasedAt: today })
    await compra(today, [{ supplyId: pescado, purchased: 4, unitPrice: 25 }])
    const [still] = await ctx.db.select().from(ctx.schema.supplyPurchases).where(eq(ctx.schema.supplyPurchases.id, manual.body.id))
    expect(still).toMatchObject({ source: 'manual', quantity: 5, entryMode: 'typed', priceEntryMode: 'typed' })
  })

  it('una compra sin precio, fechas fuera de los 7 días o insumos inválidos → error sin guardar', async () => {
    expect((await compra(today, [{ supplyId: pulpo, purchased: 2 }])).status).toBe(400)
    const old = await compra(addDays(today, -8), [{ supplyId: pulpo, purchased: 1, unitPrice: 30 }])
    expect(old.status).toBe(400)
    expect(old.body.code).toBe('DATE_OUT_OF_RANGE')
    expect((await compra(addDays(today, 1), [])).status).toBe(400)
    const inactive = await ctx.db.select().from(ctx.schema.supplies).where(eq(ctx.schema.supplies.code, 'LANGOSTINO'))
    expect((await compra(today, [{ supplyId: inactive[0].id, purchased: 1, unitPrice: 1 }])).status).toBe(409)
    expect((await compra(today, [{ supplyId: 99999, purchased: 1, unitPrice: 1 }])).status).toBe(404)
    expect((await request(ctx.app).post('/api/inventory/daily').set('Authorization', owner).send({ date: today, items: [] })).status).toBe(400)
  })
})

describe('«Hoy no compré»', () => {
  it('[PI-02][RF02] marca el día sin compra y una compra posterior la revierte', async () => {
    const day = addDays(today, -5)
    // Una compra previa del mismo día se reemplaza por «no compré»
    await compra(day, [{ supplyId: pescado, purchased: 2, unitPrice: 25 }], { otherCost: { amount: 20 } })
    const res = await compra(day, [], { noPurchase: true })
    expect(res.status).toBe(200)
    expect(res.body.parts.compra).toMatchObject({ noPurchase: true })
    expect(res.body.items.map((i: { purchased: number; purchasedMode: string }) => [i.purchased, i.purchasedMode]))
      .toEqual([[0, 'default'], [0, 'default'], [0, 'default']])
    let r = await rowsFor(day)
    expect(r.purchases).toHaveLength(0)
    expect(r.other).toHaveLength(0)
    expect(r.parts.filter(p => p.part === 'compra').map(p => p.noPurchase)).toEqual([false, true])

    // Marcar «no compré» y a la vez una compra es contradictorio
    expect((await compra(day, [{ supplyId: pescado, purchased: 1, unitPrice: 25 }], { noPurchase: true })).status).toBe(400)

    const again = await compra(day, [{ supplyId: calamar, purchased: 1.5, unitPrice: 24 }])
    expect(again.body.parts.compra.noPurchase).toBe(false)
    r = await rowsFor(day)
    expect(r.purchases).toHaveLength(1)
    expect(r.parts.filter(p => p.part === 'compra').map(p => p.noPurchase)).toEqual([false, true, false])
  })
})

describe('GET /api/inventory/daily/:date', () => {
  it('devuelve lo guardado, el estado de cada parte y la compra de referencia', async () => {
    const day = addDays(today, -3)
    const buy = (supplyId: number, purchasedAt: string, quantity: number, totalCost: number, supplier?: string) =>
      ctx.db.insert(ctx.schema.supplyPurchases).values({ supplyId, purchasedAt, quantity, totalCost, supplier })
    await buy(pulpo, addDays(day, -7), 2, 40, 'Puesto A')
    await buy(pulpo, addDays(day, -5), 1.5, 33, 'Puesto B')
    await buy(pulpo, addDays(day, -4), 1, 21)
    await ctx.db.insert(ctx.schema.otherSupplyCosts).values({ date: addDays(day, -7), amount: 55, source: 'daily' })

    const res = await getDaily(day)
    expect(res.status).toBe(200)
    expect(res.body.parts).toEqual({ apertura: null, compra: null })
    expect(res.body.items.map((i: { code: string }) => i.code)).toEqual(['PESCADO', 'CALAMAR', 'PULPO'])
    const p = res.body.items.find((i: { code: string }) => i.code === 'PULPO')
    expect(p.opening).toBeNull()
    // Referencia para [Usar]: mismo día de la semana anterior; nunca se prellena
    expect(p.reference).toEqual({ purchased: 2, fromDate: addDays(day, -7), unitPrice: 21, supplier: 'Puesto B' })
    expect(res.body.otherCostReference).toEqual({ amount: 55, fromDate: addDays(day, -7) })

    const t = (await getDaily(today)).body
    expect(t.parts.apertura).toMatchObject({ by: 'Encargada', corrections: 2 })
    expect(t.parts.compra).toMatchObject({ by: 'Dueño' })
    expect(t.items.find((i: { code: string }) => i.code === 'PESCADO')).toMatchObject({
      opening: 2.5, openingMode: 'typed', wasted: 0.5, wastedMode: 'typed', purchased: 4, totalCost: 100,
    })
    expect(t.otherCost).toBeNull()
    expect(t.transfers).toEqual({ enabled: false, direction: 'envio' })
  })
})

describe('GET /api/inventory/daily/pending', () => {
  it('avisa por parte si ayer hubo ventas y falta alguna', async () => {
    const yesterday = addDays(today, -1)
    await sale(yesterday)
    const res = await request(ctx.app).get('/api/inventory/daily/pending').set('Authorization', owner)
    // Ayer (test de imputación) se guardó la apertura, no la compra
    expect(res.body).toEqual({ date: yesterday, pending: true, missing: { apertura: false, compra: true } })
    await compra(yesterday, [])
    const after = await request(ctx.app).get('/api/inventory/daily/pending').set('Authorization', owner)
    expect(after.body).toEqual({ date: yesterday, pending: false, missing: { apertura: false, compra: false } })
  })
})

describe('consultas de getDaily (T4)', () => {
  it('[RNF09] hace una cantidad fija de consultas, sin importar el número de insumos', async () => {
    const { getDaily } = await import('../services/inventory-daily.service')
    const countSelects = async () => {
      let n = 0
      const counting = new Proxy(ctx.db, {
        get(target, prop, receiver) {
          const value = Reflect.get(target, prop, receiver)
          if (prop === 'select') return (...args: unknown[]) => { n++; return (value as (...a: unknown[]) => unknown).apply(target, args) }
          return typeof value === 'function' ? value.bind(target) : value
        },
      })
      await getDaily(counting as never, today)
      return n
    }
    const withThree = await countSelects()
    const extra = await ctx.db.insert(ctx.schema.supplies).values(
      ['A', 'B', 'C', 'D', 'E'].map((x, i) => ({ name: `Insumo ${x}`, code: `INSUMO_${x}`, unit: 'kg' as const, critical: true, sortOrder: 20 + i })),
    ).returning()
    expect(await countSelects()).toBe(withThree)
    for (const s of extra) await ctx.db.delete(ctx.schema.supplies).where(eq(ctx.schema.supplies.id, s.id))
  })
})
