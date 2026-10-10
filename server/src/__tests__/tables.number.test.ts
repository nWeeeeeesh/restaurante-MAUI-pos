import { describe, it, expect, beforeAll } from 'vitest'
import request from 'supertest'
import { setupHttpApp } from './helpers/http'
import { orderLabel, buildKitchenTicketData } from '../utils/tickets'

// T5 / TD-06: todo lo visible o impreso usa el NÚMERO de mesa, no su id técnico.
describe('etiquetas y comanda', () => {
  const order = { id: 7, type: 'dine_in' as const, customerName: null, tableNumber: 15 }

  it('orderLabel usa el número de mesa', () => {
    expect(orderLabel(order)).toBe('Mesa 15')
    expect(orderLabel({ ...order, type: 'delivery', customerName: 'Ana', tableNumber: null })).toBe('Delivery · Ana')
  })

  it('la comanda lleva tableNumber y marca la reimpresión', () => {
    const data = buildKitchenTicketData({
      order,
      items: [{ dishName: 'Ceviche', quantity: 2, modifiers: [{ optionName: 'Normal' }], notes: null }],
      waiterName: 'Carlos', isAddition: false, isReprint: true, date: '01/01/2026 13:00',
    })
    expect(data).toMatchObject({ tableNumber: 15, orderType: 'dine-in', isReprint: true, orderId: 7 })
    expect(data.items[0]).toMatchObject({ dishName: 'Ceviche', quantity: 2 })
  })
})

describe('API con tableNumber (mesa recreada: id 16, número 15)', () => {
  let ctx: Awaited<ReturnType<typeof setupHttpApp>>
  let cashier: string
  let orderId: number

  beforeAll(async () => {
    ctx = await setupHttpApp()
    cashier = (await ctx.as('cashier')).auth
    const owner = await ctx.as('owner')
    const [cat] = await ctx.db.insert(ctx.schema.categories).values({ name: 'Bebidas' }).returning()
    const [dish] = await ctx.db.insert(ctx.schema.dishes).values({ categoryId: cat.id, name: 'Chicha', price: 8, hasSpiceLevel: false }).returning()
    await ctx.db.insert(ctx.schema.tables).values({ id: 16, number: 15 })
    const created = await request(ctx.app).post('/api/orders').set('Authorization', owner.auth)
      .send({ tableId: 16, type: 'dine_in', items: [{ dishId: dish.id, quantity: 1 }] })
    orderId = created.body.id
    expect(created.body.tableNumber).toBe(15)
    const bill = await request(ctx.app).post('/api/bills').set('Authorization', cashier).send({ orderId, paymentMethod: 'yape' })
    expect(bill.status).toBe(201)
  })

  it('GET /api/bills incluye tableNumber', async () => {
    const res = await request(ctx.app).get('/api/bills').set('Authorization', cashier)
    expect(res.body.bills[0]).toMatchObject({ tableId: 16, tableNumber: 15 })
  })

  it('GET /api/bills/:id incluye tableNumber en el pedido', async () => {
    const list = await request(ctx.app).get('/api/bills').set('Authorization', cashier)
    const res = await request(ctx.app).get(`/api/bills/${list.body.bills[0].id}`).set('Authorization', cashier)
    expect(res.body.order.tableNumber).toBe(15)
  })

  it('GET /api/reports/bills incluye tableNumber', async () => {
    const owner = await ctx.as('owner')
    const res = await request(ctx.app).get('/api/reports/bills?period=today').set('Authorization', owner.auth)
    expect(res.body[0]).toMatchObject({ tableId: 16, tableNumber: 15 })
  })
})
