import { describe, it, expect, beforeAll, afterEach } from 'vitest'
import request from 'supertest'
import { eq } from 'drizzle-orm'
import { setupHttpApp } from './helpers/http'
import { addDays, localDateString } from '../utils/dates'

// Plan v3 §2.1–2.2: otros insumos del día y traslados entre locales. Cada local tiene
// su instancia (MAUI_LOCAL_ID): el local 1 solo registra envíos y el 2 solo
// recepciones, y solo desde la apertura del segundo local.
let ctx: Awaited<ReturnType<typeof setupHttpApp>>
let owner: string
let calamar: number
const today = localDateString()

beforeAll(async () => {
  ctx = await setupHttpApp()
  owner = (await ctx.as('owner')).auth
  const [c] = await ctx.db.insert(ctx.schema.supplies).values({ name: 'Calamar', code: 'CALAMAR', unit: 'kg', critical: true }).returning()
  calamar = c.id
})

afterEach(() => { delete process.env.MAUI_LOCAL_ID })

const compra = (date: string, items: object[], extra: object = {}) =>
  request(ctx.app).post('/api/inventory/daily').set('Authorization', owner).send({ part: 'compra', date, items, ...extra })
const transfersOn = (date: string) => ctx.db.select().from(ctx.schema.supplyTransfers).where(eq(ctx.schema.supplyTransfers.date, date))
const openSecondLocal = async (date: string) => {
  await ctx.db.delete(ctx.schema.appSettings)
  await ctx.db.insert(ctx.schema.appSettings).values({ key: 'second_local_opened_on', value: date })
}

describe('otros insumos del día', () => {
  it('es idempotente por fecha y parte: uno por día, se reemplaza al corregir', async () => {
    const day = addDays(today, -1)
    await compra(day, [], { otherCost: { amount: 30, mode: 'typed' } })
    await compra(day, [], { otherCost: { amount: 32.5, mode: 'typed' } })
    const rows = await ctx.db.select().from(ctx.schema.otherSupplyCosts).where(eq(ctx.schema.otherSupplyCosts.date, day))
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ amount: 32.5, source: 'daily', entryMode: 'typed' })
    expect((await compra(day, [], { otherCost: { amount: -1 } })).status).toBe(400)
  })
})

describe('traslados', () => {
  it('se rechazan mientras no abra el segundo local', async () => {
    const res = await compra(today, [{ supplyId: calamar, transfer: 1 }])
    expect(res.status).toBe(400)
    expect(res.body.code).toBe('TRANSFERS_NOT_ENABLED')
    await openSecondLocal(addDays(today, 1))
    expect((await compra(today, [{ supplyId: calamar, transfer: 1 }])).status).toBe(400)
    expect(await transfersOn(today)).toHaveLength(0)
  })

  it('el local 1 registra envíos al local 2, idempotentes por fecha', async () => {
    await openSecondLocal(today)
    expect((await compra(today, [{ supplyId: calamar, transfer: 1.5, transferMode: 'typed' }])).status).toBe(200)
    await compra(today, [{ supplyId: calamar, transfer: 2, transferMode: 'typed' }])
    const rows = await transfersOn(today)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ direction: 'envio', quantity: 2, localId: 1, otherLocalId: 2, entryMode: 'typed', source: 'daily', unitCost: null })
    const daily = await request(ctx.app).get(`/api/inventory/daily/${today}`).set('Authorization', owner)
    expect(daily.body.transfers).toEqual({ enabled: true, direction: 'envio' })
    expect(daily.body.items[0]).toMatchObject({ transfer: 2, transferMode: 'typed' })
  })

  it('[RD06] el local 2 registra recepciones del local 1, con costo opcional, y su propio local_id', async () => {
    process.env.MAUI_LOCAL_ID = '2'
    const day = addDays(today, -2)
    await openSecondLocal(day)
    const res = await compra(day, [{ supplyId: calamar, purchased: 1, unitPrice: 26, transfer: 3, transferUnitCost: 25 }])
    expect(res.status).toBe(200)
    expect(res.body.transfers).toEqual({ enabled: true, direction: 'recepcion' })
    const [t] = await transfersOn(day)
    expect(t).toMatchObject({ direction: 'recepcion', quantity: 3, unitCost: 25, localId: 2, otherLocalId: 1 })
    const [p] = await ctx.db.select().from(ctx.schema.supplyPurchases).where(eq(ctx.schema.supplyPurchases.purchasedAt, day))
    expect(p.localId).toBe(2)
    const [part] = await ctx.db.select().from(ctx.schema.dailyParts).where(eq(ctx.schema.dailyParts.date, day))
    expect(part.localId).toBe(2)
  })
})
