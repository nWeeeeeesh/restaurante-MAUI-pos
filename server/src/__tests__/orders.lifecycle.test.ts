import { describe, it, expect, beforeAll } from 'vitest'
import request from 'supertest'
import { eq } from 'drizzle-orm'
import { setupHttpApp } from './helpers/http'

// T3: máquina de estados, cancelación controlada (D1/D5) y auditoría.
let ctx: Awaited<ReturnType<typeof setupHttpApp>>
let waiter: string, cashier: string, manager: string, owner: string
let dishId: number
let tableSeq = 1

beforeAll(async () => {
  ctx = await setupHttpApp()
  waiter = (await ctx.as('waiter')).auth
  cashier = (await ctx.as('cashier')).auth
  manager = (await ctx.as('manager')).auth
  owner = (await ctx.as('owner')).auth
  const [cat] = await ctx.db.insert(ctx.schema.categories).values({ name: 'Bebidas' }).returning()
  const [dish] = await ctx.db.insert(ctx.schema.dishes).values({ categoryId: cat.id, name: 'Chicha', price: 8, hasSpiceLevel: false }).returning()
  dishId = dish.id
})

async function newOrder(quantity = 1, items = 2) {
  const [t] = await ctx.db.insert(ctx.schema.tables).values({ number: 200 + tableSeq++ }).returning()
  const res = await request(ctx.app).post('/api/orders').set('Authorization', waiter).send({
    tableId: t.id, type: 'dine_in',
    items: Array.from({ length: items }, () => ({ dishId, quantity })),
  })
  expect(res.status).toBe(201)
  return res.body as { id: number; tableId: number; items: Array<{ id: number }> }
}

async function payItem(orderId: number, itemId: number) {
  const res = await request(ctx.app).post('/api/bills').set('Authorization', cashier)
    .send({ orderId, paymentMethod: 'yape', itemIds: [itemId] })
  expect(res.status).toBe(201)
}

const cancel = (orderId: number, auth: string, reason = 'cliente se retiró') =>
  request(ctx.app).post(`/api/orders/${orderId}/cancel`).set('Authorization', auth).send({ reason })

describe('"Por cobrar" (TD-08)', () => {
  it('se persiste como paying y vuelve a pending al agregar ítems', async () => {
    const order = await newOrder()
    const r1 = await request(ctx.app).patch(`/api/orders/${order.id}/status`).set('Authorization', waiter).send({ status: 'paying' })
    expect(r1.status).toBe(200)
    expect(r1.body.status).toBe('paying')

    const active = await request(ctx.app).get('/api/orders/active').set('Authorization', cashier)
    expect(active.body.find((o: any) => o.id === order.id).status).toBe('paying')

    const r2 = await request(ctx.app).post(`/api/orders/${order.id}/items`).set('Authorization', waiter)
      .send({ items: [{ dishId, quantity: 1 }] })
    expect(r2.body.status).toBe('pending')
  })

  it('PATCH status=paid o cancelled ya no se acepta → 400', async () => {
    const order = await newOrder()
    for (const status of ['paid', 'cancelled']) {
      const res = await request(ctx.app).patch(`/api/orders/${order.id}/status`).set('Authorization', owner).send({ status })
      expect(res.status).toBe(400)
    }
  })
})

describe('Cancelación (TD-02, D1, D5)', () => {
  it('el mozo no puede cancelar → 403', async () => {
    const order = await newOrder()
    expect((await cancel(order.id, waiter)).status).toBe(403)
  })

  it('requiere motivo → 400', async () => {
    const order = await newOrder()
    const res = await request(ctx.app).post(`/api/orders/${order.id}/cancel`).set('Authorization', cashier).send({ reason: ' ' })
    expect(res.status).toBe(400)
  })

  it('cajero cancela un pedido sin cobros: libera la mesa y registra en audit_log', async () => {
    const order = await newOrder()
    const res = await cancel(order.id, cashier, 'mesa equivocada')
    expect(res.status).toBe(200)

    const [o] = await ctx.db.select().from(ctx.schema.orders).where(eq(ctx.schema.orders.id, order.id))
    expect(o.status).toBe('cancelled')
    const [t] = await ctx.db.select().from(ctx.schema.tables).where(eq(ctx.schema.tables.id, order.tableId))
    expect(t.status).toBe('free')
    const [log] = await ctx.db.select().from(ctx.schema.auditLog).where(eq(ctx.schema.auditLog.entityId, order.id))
    expect(log.action).toBe('order.cancel')
    expect(JSON.parse(log.data!)).toMatchObject({ reason: 'mesa equivocada', billedTotal: 0, unbilledTotal: 16 })
  })

  it('cajero NO puede cancelar un pedido con cobros → 403 ORDER_HAS_PAYMENTS', async () => {
    const order = await newOrder()
    await payItem(order.id, order.items[0].id)
    const res = await cancel(order.id, cashier)
    expect(res.status).toBe(403)
    expect(res.body.code).toBe('ORDER_HAS_PAYMENTS')
  })

  it('encargado y dueño sí pueden cancelar un pedido con cobros', async () => {
    for (const auth of [manager, owner]) {
      const order = await newOrder()
      await payItem(order.id, order.items[0].id)
      const res = await cancel(order.id, auth, 'cuenta B se retiró sin pagar')
      expect(res.status).toBe(200)
      const [log] = await ctx.db.select().from(ctx.schema.auditLog).where(eq(ctx.schema.auditLog.entityId, order.id))
      expect(JSON.parse(log.data!)).toMatchObject({ billedTotal: 8, unbilledTotal: 8 })
    }
  })

  it('no se puede cancelar un pedido pagado → 409', async () => {
    const order = await newOrder(1, 1)
    await payItem(order.id, order.items[0].id)
    const res = await cancel(order.id, owner)
    expect(res.status).toBe(409)
    expect(res.body.code).toBe('ORDER_CLOSED')
  })
})

describe('Pedidos cerrados o inexistentes (TD-07)', () => {
  it('agregar ítems a un pedido cancelado → 409', async () => {
    const order = await newOrder()
    await cancel(order.id, cashier)
    const res = await request(ctx.app).post(`/api/orders/${order.id}/items`).set('Authorization', waiter)
      .send({ items: [{ dishId, quantity: 1 }] })
    expect(res.status).toBe(409)
    expect(res.body.code).toBe('ORDER_CLOSED')
  })

  it('agregar ítems a un pedido inexistente → 404', async () => {
    const res = await request(ctx.app).post('/api/orders/99999/items').set('Authorization', waiter)
      .send({ items: [{ dishId, quantity: 1 }] })
    expect(res.status).toBe(404)
  })

  it('las vías viejas sin control ya no existen (DELETE, toggle, ready)', async () => {
    const order = await newOrder()
    expect((await request(ctx.app).delete(`/api/orders/${order.id}`).set('Authorization', owner)).status).toBe(404)
    expect((await request(ctx.app).patch(`/api/orders/${order.id}/ready`).set('Authorization', owner)).status).toBe(404)
    expect((await request(ctx.app).patch(`/api/orders/${order.id}/items/${order.items[0].id}/toggle`).set('Authorization', owner)).status).toBe(404)
  })
})
