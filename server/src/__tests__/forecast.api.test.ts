import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import * as net from 'net'
import request from 'supertest'
import { eq, sql } from 'drizzle-orm'
import { setupHttpApp } from './helpers/http'

// API del incremento 3 (plan-sistema T16) con un local mínimo de hoy: un insumo
// crítico, un plato con receta y el conteo de apertura del día.
vi.mock('../realtime', () => ({ emit: vi.fn(), setIo: vi.fn(), disconnectUser: vi.fn() }))

let ctx: Awaited<ReturnType<typeof setupHttpApp>>
let emit: ReturnType<typeof vi.fn>
const auth = {} as Record<'owner' | 'manager' | 'cashier' | 'waiter', string>
let dishId: number
let pescado: number
let today: string
let printer: net.Server
let printed: Buffer[] = []

beforeAll(async () => {
  ctx = await setupHttpApp()
  emit = (await import('../realtime')).emit as unknown as ReturnType<typeof vi.fn>
  for (const r of ['owner', 'manager', 'cashier', 'waiter'] as const) auth[r] = (await ctx.as(r)).auth
  today = (await import('../utils/dates')).limaDate()
  const [s] = await ctx.db.insert(ctx.schema.supplies).values({ name: 'Pescado', code: 'PESCADO', unit: 'kg', critical: true, yield: 1, shelfLifeDays: 7, serviceLevel: 0.95 }).returning()
  pescado = s.id
  const [cat] = await ctx.db.insert(ctx.schema.categories).values({ name: 'Ceviches' }).returning()
  const [dish] = await ctx.db.insert(ctx.schema.dishes).values({ categoryId: cat.id, name: 'Ceviche', price: 20, hasSpiceLevel: false }).returning()
  dishId = dish.id
  await ctx.db.insert(ctx.schema.recipeItems).values({ dishId, supplyId: pescado, gramsClean: 200 })
  // 1.2 kg al abrir: alcanza para 6 porciones de 200 g
  await ctx.db.insert(ctx.schema.supplyCounts).values({ supplyId: pescado, quantity: 1.2, countedOn: today })

  // Impresora simulada: un servidor TCP que guarda lo que recibe
  printer = net.createServer(sock => sock.on('data', (d: Buffer) => printed.push(d)))
  await new Promise<void>(r => printer.listen(0, '127.0.0.1', () => r()))
  process.env.PRINTER_TYPE = 'tcp'
  process.env.PRINTER_HOST = '127.0.0.1'
  process.env.PRINTER_PORT = String((printer.address() as net.AddressInfo).port)
})

afterAll(() => {
  printer.close()
  delete process.env.PRINTER_HOST
})

async function sell(qty: number) {
  const order = await request(ctx.app).post('/api/orders').set('Authorization', auth.cashier)
    .send({ type: 'delivery', customerName: 'Prueba', items: [{ dishId, quantity: qty }] })
  expect(order.status).toBe(201)
  const bill = await request(ctx.app).post('/api/bills').set('Authorization', auth.cashier)
    .send({ orderId: order.body.id, paymentMethod: 'cash', cashReceived: 100 })
  expect(bill.status).toBe(201)
}

const lowPortions = () => emit.mock.calls.filter(([e]) => e === 'inventory:low-portions').map(([, p]) => p)
const waitFor = async (cond: () => boolean) => {
  for (let k = 0; k < 50 && !cond(); k++) await new Promise(r => setTimeout(r, 20))
}

describe('[PI-13][RF18] aviso de pocas porciones al cobrar', () => {
  it('no avisa con 6 porciones; avisa al cruzar el umbral y en cada cambio', async () => {
    expect((await request(ctx.app).get('/api/forecast/alerts').set('Authorization', auth.waiter)).body.alerts).toEqual([])
    emit.mockClear()
    await sell(1) // quedan 1.0 kg = 5 porciones
    await waitFor(() => lowPortions().length > 0)
    expect(lowPortions()).toEqual([{ dishId, portionsLeft: 5, supplyCode: 'PESCADO' }])
    await sell(1) // 4 porciones
    await waitFor(() => lowPortions().length > 1)
    expect(lowPortions()[1]).toEqual({ dishId, portionsLeft: 4, supplyCode: 'PESCADO' })
    const alerts = await request(ctx.app).get('/api/forecast/alerts').set('Authorization', auth.waiter)
    expect(alerts.status).toBe(200)
    expect(alerts.body).toMatchObject({ threshold: 5, alerts: [{ dishId, name: 'Ceviche', portionsLeft: 4, supplyCode: 'PESCADO' }] })
  })
})

describe('[PI-14][RF19][RD02] propuesta de agotado', () => {
  it('sin confirmación la disponibilidad no cambia; confirmada queda como propuesta_confirmada', async () => {
    const [dish] = await ctx.db.select().from(ctx.schema.dishes).where(eq(ctx.schema.dishes.id, dishId))
    expect(dish.available).toBe(true) // el aviso no marca nada
    const res = await request(ctx.app).patch(`/api/menu/dishes/${dishId}/availability`).set('Authorization', auth.cashier)
      .send({ available: false, source: 'propuesta_confirmada' })
    expect(res.status).toBe(200)
    expect(res.body.available).toBe(false)
    const [log] = await ctx.db.select().from(ctx.schema.auditLog).where(eq(ctx.schema.auditLog.action, 'dish.availability'))
    expect(JSON.parse(log.data!)).toMatchObject({ available: false, source: 'propuesta_confirmada' })
    const bad = await request(ctx.app).patch(`/api/menu/dishes/${dishId}/availability`).set('Authorization', auth.cashier)
      .send({ available: true, source: 'sistema' })
    expect(bad.status).toBe(400)
    await request(ctx.app).patch(`/api/menu/dishes/${dishId}/availability`).set('Authorization', auth.cashier).send({ available: true })
    // Un plato agotado no aparece en los avisos; habilitado, sí
    expect((await request(ctx.app).get('/api/forecast/alerts').set('Authorization', auth.cashier)).body.alerts).toHaveLength(1)
  })
})

describe('[PI-12][RF17] lista de compra', () => {
  it('responde la cantidad sugerida por insumo y guarda lo mostrado', async () => {
    const res = await request(ctx.app).get(`/api/forecast/purchase-list?date=${today}&coverageDays=2`).set('Authorization', auth.manager)
    expect(res.status).toBe(200)
    expect(res.body.items).toHaveLength(1)
    const it = res.body.items[0]
    expect(it).toMatchObject({ code: 'PESCADO', coverageDays: 2, availableSource: 'conteo', available: 1.2, serviceLevel: 0.95 })
    expect(it.quantity).toBeGreaterThanOrEqual(0)
    expect(it.toBuy * 2).toBe(Math.round(it.toBuy * 2))
    const [c] = await ctx.db.all<{ n: number }>(sql`SELECT COUNT(*) AS n FROM purchase_suggestions`)
    expect(Number(c.n)).toBe(1)
    // Cobertura por insumo y validación
    const one = await request(ctx.app).get(`/api/forecast/purchase-list?date=${today}&coverage=${pescado}:1`).set('Authorization', auth.manager)
    expect(one.body.items[0].coverageDays).toBe(1)
    for (const q of ['coverageDays=4', 'coverageDays=0', 'coverage=abc', 'date=2026-02-30']) {
      expect((await request(ctx.app).get(`/api/forecast/purchase-list?${q}`).set('Authorization', auth.manager)).status, q).toBe(400)
    }
  })

  it('imprime en la ticketera; sin impresora responde 502', async () => {
    printed = []
    const res = await request(ctx.app).post('/api/forecast/purchase-list/print').set('Authorization', auth.manager).send({ date: today })
    expect(res.status).toBe(200)
    await new Promise(r => setTimeout(r, 100))
    const text = Buffer.concat(printed).toString('latin1')
    expect(text).toContain('LISTA DE COMPRA')
    expect(text).toContain('Pescado')
    const port = process.env.PRINTER_PORT
    process.env.PRINTER_PORT = '1'
    const off = await request(ctx.app).post('/api/forecast/purchase-list/print').set('Authorization', auth.manager).send({ date: today })
    expect(off.status).toBe(502)
    expect(off.body.code).toBe('PRINTER_UNAVAILABLE')
    process.env.PRINTER_PORT = port
  })
})

describe('ejecución a pedido e historial', () => {
  it('POST /run es idempotente (RD04) y rechaza noches futuras', async () => {
    const madeOn = today
    const first = await request(ctx.app).post('/api/forecast/run').set('Authorization', auth.owner).send({ madeOn })
    expect(first.status).toBe(200)
    const second = await request(ctx.app).post('/api/forecast/run').set('Authorization', auth.owner).send({ madeOn })
    expect(second.body.created).toEqual([])
    const future = await request(ctx.app).post('/api/forecast/run').set('Authorization', auth.owner).send({ madeOn: '2099-01-01' })
    expect(future.status).toBe(400)
  })

  it('GET /history devuelve la demanda y los pronósticos guardados', async () => {
    const res = await request(ctx.app).get(`/api/forecast/history?supplyId=${pescado}&from=${today}&to=${today}`).set('Authorization', auth.owner)
    expect(res.status).toBe(200)
    expect(res.body.supply.code).toBe('PESCADO')
    expect((await request(ctx.app).get(`/api/forecast/history?supplyId=99999&from=${today}&to=${today}`).set('Authorization', auth.owner)).status).toBe(404)
  })
})

describe('[PI-15][RNF06] permisos del incremento 3', () => {
  type Role = 'owner' | 'manager' | 'cashier' | 'waiter'
  const routes: [string, string, Role[], unknown?][] = [
    ['get', `/api/forecast/purchase-list?coverageDays=2`, ['owner', 'manager']],
    ['post', '/api/forecast/purchase-list/print', ['owner', 'manager'], { coverageDays: 9 }],
    ['post', '/api/forecast/run', ['owner'], { madeOn: '2099-01-01' }],
    ['get', '/api/forecast/history?supplyId=1&from=2026-01-01&to=2026-01-02', ['owner']],
    ['get', '/api/forecast/alerts', ['owner', 'manager', 'cashier', 'waiter']],
  ]
  it('sin sesión 401; con un rol sin permiso 403', async () => {
    for (const [method, url, allowed, body] of routes) {
      const call = (a?: string) => {
        let req = (request(ctx.app) as unknown as Record<string, (u: string) => request.Test>)[method](url)
        if (a) req = req.set('Authorization', a)
        return body === undefined ? req : req.send(body as object)
      }
      expect((await call()).status, `${method} ${url}`).toBe(401)
      for (const role of Object.keys(auth) as Role[]) {
        const res = await call(auth[role])
        if (allowed.includes(role)) expect(res.status, `${role} ${url}`).not.toBe(403)
        else expect(res.status, `${role} ${url}`).toBe(403)
      }
    }
  })
})
