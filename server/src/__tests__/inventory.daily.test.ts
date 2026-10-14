import { describe, it, expect, beforeAll } from 'vitest'
import request from 'supertest'
import { and, eq } from 'drizzle-orm'
import { setupHttpApp } from './helpers/http'
import { addDays, localDateString, parseDayBoundary } from '../utils/dates'

// Plan v2 §2.2: la «Compra del día» es la única interacción diaria obligatoria.
// Una transacción por fecha: conteo de apertura, merma por deterioro (imputada al
// día operativo anterior), compras y notas. Guardar otra vez corrige, no duplica.
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
  owner = (await ctx.as('owner')).auth
  manager = (await ctx.as('manager')).auth
  const ins = (name: string, code: string, sortOrder: number, critical = true, active = true) =>
    ctx.db.insert(ctx.schema.supplies).values({ name, code, sortOrder, unit: 'kg', critical, active }).returning()
  ;[{ id: pescado }] = await ins('Pescado', 'PESCADO', 1)
  ;[{ id: calamar }] = await ins('Calamar', 'CALAMAR', 2)
  ;[{ id: pulpo }] = await ins('Pulpo', 'PULPO', 3)
  ;[{ id: choclo }] = await ins('Choclo', 'CHOCLO', 9, false)
  await ins('Langostino', 'LANGOSTINO', 4, true, false)
})

const save = (body: object, auth = manager) => request(ctx.app).post('/api/inventory/daily').set('Authorization', auth).send(body)
const getDaily = (date: string) => request(ctx.app).get(`/api/inventory/daily?date=${date}`).set('Authorization', manager)

const rowsFor = async (date: string) => ({
  counts: await ctx.db.select().from(ctx.schema.supplyCounts).where(eq(ctx.schema.supplyCounts.countedOn, date)),
  purchases: await ctx.db.select().from(ctx.schema.supplyPurchases).where(and(
    eq(ctx.schema.supplyPurchases.source, 'daily'), eq(ctx.schema.supplyPurchases.sourceDate, date))),
  waste: await ctx.db.select().from(ctx.schema.supplyWaste).where(and(
    eq(ctx.schema.supplyWaste.source, 'daily'), eq(ctx.schema.supplyWaste.sourceDate, date))),
  notes: await ctx.db.select().from(ctx.schema.dayNotes).where(eq(ctx.schema.dayNotes.date, date)),
})

// Una boleta pagada el día local `date` lo vuelve día operativo
async function sale(date: string) {
  await ctx.db.insert(ctx.schema.bills).values({
    subtotal: 30, total: 30, paymentMethod: 'cash',
    receiptNumber: `T-${date}-${Math.random().toString(36).slice(2, 7)}`,
    paidAt: parseDayBoundary(date, 'end'),
  })
}

describe('POST /api/inventory/daily', () => {
  it('crea apertura, merma, compra y notas; botaste=0 y compraste=0 no crean filas', async () => {
    const res = await save({
      date: today,
      items: [
        { supplyId: pescado, opening: 2, wasted: 0.5, purchased: 3, unitPrice: 25, supplier: 'Terminal pesquero' },
        { supplyId: calamar, opening: 1, wasted: 0, purchased: 0 },
      ],
      notes: [{ kind: 'otro', text: 'Inicio de la línea base' }],
    })
    expect(res.status).toBe(200)
    expect(res.body.saved).toBe(true)

    const r = await rowsFor(today)
    expect(r.counts.map(c => [c.supplyId, c.quantity, c.moment]).sort()).toEqual([[pescado, 2, 'apertura'], [calamar, 1, 'apertura']].sort())
    expect(r.purchases).toHaveLength(1)
    expect(r.purchases[0]).toMatchObject({ supplyId: pescado, quantity: 3, totalCost: 75, purchasedAt: today, supplier: 'Terminal pesquero', localId: 1 })
    expect(r.waste).toHaveLength(1)
    // Sin días con ventas antes de hoy, se imputa al día calendario anterior
    expect(r.waste[0]).toMatchObject({ supplyId: pescado, quantity: 0.5, reason: 'deterioro', wastedAt: addDays(today, -1) })
    expect(r.notes).toMatchObject([{ kind: 'otro', text: 'Inicio de la línea base' }])
  })

  it('guardar otra vez el mismo día corrige sin duplicar y deja la corrección en audit_log', async () => {
    const res = await save({
      date: today,
      items: [
        { supplyId: pescado, opening: 2.5, wasted: 0, purchased: 4, unitPrice: 25, totalCost: 98 },
        { supplyId: calamar, opening: null },
      ],
      notes: [{ kind: 'feriado' }],
    })
    expect(res.status).toBe(200)

    const r = await rowsFor(today)
    expect(r.counts.map(c => [c.supplyId, c.quantity])).toEqual([[pescado, 2.5]])
    expect(r.purchases).toHaveLength(1)
    // El total editado manda sobre cantidad × precio
    expect(r.purchases[0]).toMatchObject({ quantity: 4, totalCost: 98 })
    expect(r.waste).toHaveLength(0)
    expect(r.notes.map(n => n.kind)).toEqual(['feriado'])

    const logs = await ctx.db.select().from(ctx.schema.auditLog).where(eq(ctx.schema.auditLog.action, 'daily.update'))
    expect(logs).toHaveLength(1)
    expect(JSON.parse(logs[0].data!)).toMatchObject({ date: today, before: { purchases: [{ supplyId: pescado, quantity: 3 }] } })

    // Reenviar exactamente lo mismo no es una corrección
    await save({
      date: today,
      items: [
        { supplyId: pescado, opening: 2.5, wasted: 0, purchased: 4, unitPrice: 25, totalCost: 98 },
        { supplyId: calamar, opening: null },
      ],
      notes: [{ kind: 'feriado' }],
    })
    expect(await ctx.db.select().from(ctx.schema.auditLog).where(eq(ctx.schema.auditLog.action, 'daily.update'))).toHaveLength(1)
  })

  it('no toca las compras y mermas manuales del mismo día', async () => {
    const manual = await request(ctx.app).post('/api/inventory/purchases').set('Authorization', manager)
      .send({ supplyId: choclo, quantity: 5, totalCost: 10, purchasedAt: today })
    // Sin `notes` en el cuerpo, las notas del día no se tocan
    await save({ date: today, items: [{ supplyId: pescado, opening: 2.5, purchased: 4, totalCost: 98 }] })
    const [still] = await ctx.db.select().from(ctx.schema.supplyPurchases).where(eq(ctx.schema.supplyPurchases.id, manual.body.id))
    expect(still).toMatchObject({ source: 'manual', quantity: 5 })
  })

  it('la merma se imputa al día operativo anterior (el último con ventas)', async () => {
    const day = addDays(today, -1)
    await sale(addDays(today, -4))
    await save({ date: day, items: [{ supplyId: calamar, wasted: 0.3 }] })
    const r = await rowsFor(day)
    expect(r.waste[0]).toMatchObject({ quantity: 0.3, wastedAt: addDays(today, -4), sourceDate: day })
  })

  it('acepta hasta 7 días atrás; más atrás, futuro o compra sin precio → 400', async () => {
    expect((await save({ date: addDays(today, -7), items: [{ supplyId: pulpo, opening: 1 }] })).status).toBe(200)
    const old = await save({ date: addDays(today, -8), items: [{ supplyId: pulpo, opening: 1 }] })
    expect(old.status).toBe(400)
    expect(old.body.code).toBe('DATE_OUT_OF_RANGE')
    expect((await save({ date: addDays(today, 1), items: [{ supplyId: pulpo, opening: 1 }] })).status).toBe(400)
    expect((await save({ date: today, items: [{ supplyId: pulpo, purchased: 2 }] })).status).toBe(400)
    expect((await save({ date: today, items: [{ supplyId: pulpo, opening: -1 }] })).status).toBe(400)
    expect((await save({ date: today, items: [{ supplyId: pulpo }, { supplyId: pulpo }] })).status).toBe(400)
  })

  it('rechaza insumos inexistentes o desactivados sin guardar nada', async () => {
    const day = addDays(today, -2)
    const inactive = await ctx.db.select().from(ctx.schema.supplies).where(eq(ctx.schema.supplies.code, 'LANGOSTINO'))
    const res = await save({ date: day, items: [{ supplyId: pescado, opening: 9 }, { supplyId: inactive[0].id, opening: 1 }] })
    expect(res.status).toBe(409)
    expect((await rowsFor(day)).counts).toHaveLength(0)
    expect((await save({ date: day, items: [{ supplyId: 99999, opening: 1 }] })).status).toBe(404)
  })
})

describe('GET /api/inventory/daily', () => {
  it('lista los críticos activos en orden y prellena compra, precio y proveedor', async () => {
    const day = addDays(today, -3)
    const buy = (supplyId: number, purchasedAt: string, quantity: number, totalCost: number, supplier?: string) =>
      ctx.db.insert(ctx.schema.supplyPurchases).values({ supplyId, purchasedAt, quantity, totalCost, supplier })
    // Pulpo: compró el mismo día de la semana anterior y después otra vez
    await buy(pulpo, addDays(day, -7), 2, 40, 'Puesto A')
    await buy(pulpo, addDays(day, -5), 1.5, 33, 'Puesto B')
    await buy(pulpo, addDays(day, -4), 1, 21)

    const res = await getDaily(day)
    expect(res.status).toBe(200)
    expect(res.body.saved).toBe(false)
    expect(res.body.items.map((i: { code: string }) => i.code)).toEqual(['PESCADO', 'CALAMAR', 'PULPO'])
    const p = res.body.items.find((i: { code: string }) => i.code === 'PULPO')
    expect(p.opening).toBeNull()
    // Mismo día de la semana anterior; precio de la última compra; último proveedor usado
    expect(p.suggestion).toEqual({ purchased: 2, unitPrice: 21, supplier: 'Puesto B' })
  })

  it('sin compra la semana anterior sugiere la última compra', async () => {
    const day = addDays(today, -6)
    await ctx.db.insert(ctx.schema.supplyPurchases).values({ supplyId: calamar, purchasedAt: addDays(day, -2), quantity: 1.2, totalCost: 30 })
    const c = (await getDaily(day)).body.items.find((i: { code: string }) => i.code === 'CALAMAR')
    expect(c.suggestion).toMatchObject({ purchased: 1.2, unitPrice: 25 })
  })

  it('devuelve lo guardado y la fecha a la que se imputa la merma', async () => {
    const res = await getDaily(today)
    expect(res.body.saved).toBe(true)
    expect(res.body.wasteDate).toBe(addDays(today, -4))
    const p = res.body.items.find((i: { code: string }) => i.code === 'PESCADO')
    expect(p).toMatchObject({ opening: 2.5, purchased: 4, totalCost: 98, wasted: 0 })
    expect(res.body.notes.map((n: { kind: string }) => n.kind)).toEqual(['feriado'])
  })
})

describe('GET /api/inventory/daily/pending', () => {
  it('avisa si ayer hubo ventas y no hay «Compra del día»', async () => {
    const yesterday = addDays(today, -1)
    await ctx.db.delete(ctx.schema.supplyWaste).where(eq(ctx.schema.supplyWaste.sourceDate, yesterday))
    await sale(yesterday)
    const before = await request(ctx.app).get('/api/inventory/daily/pending').set('Authorization', owner)
    expect(before.body).toEqual({ date: yesterday, pending: true })
    await save({ date: yesterday, items: [{ supplyId: pescado, opening: 1 }] })
    const after = await request(ctx.app).get('/api/inventory/daily/pending').set('Authorization', owner)
    expect(after.body.pending).toBe(false)
  })
})
