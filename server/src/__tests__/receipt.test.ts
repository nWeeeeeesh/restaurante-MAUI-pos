import { describe, it, expect, beforeAll } from 'vitest'
import request from 'supertest'
import { eq } from 'drizzle-orm'
import { setupHttpApp } from './helpers/http'

// T8 / TD-14: la boleta (vista previa e impresión) se arma desde la BD.
let ctx: Awaited<ReturnType<typeof setupHttpApp>>
let waiter: string, cashier: string, owner: string
let order: { id: number; items: Array<{ id: number }> }
let billId: number

beforeAll(async () => {
  delete process.env.PRINTER_HOST // sin impresora: imprimir falla con 502
  process.env.PRINTER_TYPE = 'tcp'
  ctx = await setupHttpApp()
  waiter = (await ctx.as('waiter')).auth
  const c = await ctx.as('cashier', 'Ana Caja')
  cashier = c.auth
  owner = (await ctx.as('owner')).auth
  const [cat] = await ctx.db.insert(ctx.schema.categories).values({ name: 'Platos' }).returning()
  const [a] = await ctx.db.insert(ctx.schema.dishes).values({ categoryId: cat.id, name: 'Ceviche', price: 28, hasSpiceLevel: false }).returning()
  const [b] = await ctx.db.insert(ctx.schema.dishes).values({ categoryId: cat.id, name: 'Chicha', price: 8, hasSpiceLevel: false }).returning()
  await ctx.db.insert(ctx.schema.tables).values({ id: 16, number: 15 })
  const created = await request(ctx.app).post('/api/orders').set('Authorization', waiter)
    .send({ tableId: 16, type: 'dine_in', items: [{ dishId: a.id, quantity: 1 }, { dishId: b.id, quantity: 2 }] })
  order = created.body
})

describe('POST /api/bills devuelve la boleta armada desde la BD', () => {
  it('cobro parcial: solo los ítems cobrados, con número de mesa y cajero', async () => {
    const res = await request(ctx.app).post('/api/bills').set('Authorization', cashier)
      .send({ orderId: order.id, paymentMethod: 'cash', cashReceived: 50, itemIds: [order.items[0].id] })
    expect(res.status).toBe(201)
    billId = res.body.id
    expect(res.body.receipt).toMatchObject({
      billId, receiptNumber: res.body.receiptNumber, tableNumber: 15, cashierName: 'Ana Caja',
      total: 28, cashReceived: 50, changeAmount: 22, paymentMethod: 'cash', orderType: 'dine-in',
    })
    expect(res.body.receipt.items).toHaveLength(1)
    expect(res.body.receipt.items[0]).toMatchObject({ dishName: 'Ceviche', quantity: 1, unitPrice: 28 })
  })
})

describe('endpoints de impresión', () => {
  it('ya no existen los que aceptaban contenido del cliente', async () => {
    expect((await request(ctx.app).post('/api/print/receipt').set('Authorization', owner).send({})).status).toBe(404)
    expect((await request(ctx.app).post('/api/print/kitchen').set('Authorization', owner).send({})).status).toBe(404)
    expect((await request(ctx.app).get('/api/print/test').set('Authorization', owner)).status).toBe(404)
  })

  it('página de prueba: solo el dueño', async () => {
    expect((await request(ctx.app).post('/api/print/test').set('Authorization', cashier)).status).toBe(403)
    expect((await request(ctx.app).post('/api/print/test').set('Authorization', owner)).status).toBe(502)
  })

  it('reimprimir boleta: el mozo no puede; el cajero sí (502 sin impresora)', async () => {
    expect((await request(ctx.app).post(`/api/print/reprint/${billId}`).set('Authorization', waiter)).status).toBe(403)
    expect((await request(ctx.app).post(`/api/print/reprint/${billId}`).set('Authorization', cashier)).status).toBe(502)
  })

  it('el cajero no reimprime boletas de días anteriores; el dueño sí', async () => {
    await ctx.db.update(ctx.schema.bills).set({ paidAt: '2020-01-01 12:00:00' }).where(eq(ctx.schema.bills.id, billId))
    expect((await request(ctx.app).post(`/api/print/reprint/${billId}`).set('Authorization', cashier)).status).toBe(403)
    expect((await request(ctx.app).post(`/api/print/reprint/${billId}`).set('Authorization', owner)).status).toBe(502)
  })

  it('pre-cuenta: desde el pedido; el mozo no puede', async () => {
    expect((await request(ctx.app).post(`/api/print/pre-receipt/${order.id}`).set('Authorization', waiter)).status).toBe(403)
    expect((await request(ctx.app).post(`/api/print/pre-receipt/${order.id}`).set('Authorization', cashier)).status).toBe(502)
    expect((await request(ctx.app).post('/api/print/pre-receipt/99999').set('Authorization', cashier)).status).toBe(404)
  })
})
