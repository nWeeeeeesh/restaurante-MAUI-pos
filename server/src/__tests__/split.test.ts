import { describe, it, expect, beforeAll } from 'vitest'
import request from 'supertest'
import { setupHttpApp } from './helpers/http'

// M1 / TD-23: división de cuenta completa (crear, cobrar una sub-cuenta, agregar
// ítems, deshacer), con validación y escritura en la misma transacción.
let ctx: Awaited<ReturnType<typeof setupHttpApp>>
let waiter: string, cashier: string
let dishId: number
let tableSeq = 1

beforeAll(async () => {
  ctx = await setupHttpApp()
  waiter = (await ctx.as('waiter')).auth
  cashier = (await ctx.as('cashier')).auth
  const [cat] = await ctx.db.insert(ctx.schema.categories).values({ name: 'Platos' }).returning()
  const [dish] = await ctx.db.insert(ctx.schema.dishes).values({ categoryId: cat.id, name: 'Ceviche', price: 28, hasSpiceLevel: false }).returning()
  dishId = dish.id
})

async function newOrder(items = 3) {
  const [t] = await ctx.db.insert(ctx.schema.tables).values({ number: 400 + tableSeq++ }).returning()
  const res = await request(ctx.app).post('/api/orders').set('Authorization', waiter)
    .send({ tableId: t.id, type: 'dine_in', items: Array.from({ length: items }, () => ({ dishId, quantity: 1 })) })
  return res.body as { id: number; items: Array<{ id: number }> }
}

const split = (orderId: number, groups: Array<{ label: string; itemIds: number[] }>, auth = cashier) =>
  request(ctx.app).post(`/api/orders/${orderId}/split`).set('Authorization', auth).send({ groups })

describe('división de cuenta', () => {
  it('el mozo no puede dividir → 403', async () => {
    const o = await newOrder()
    expect((await split(o.id, [{ label: 'A', itemIds: [o.items[0].id] }, { label: 'B', itemIds: [o.items[1].id] }], waiter)).status).toBe(403)
  })

  it('una división nueva requiere 2 sub-cuentas', async () => {
    const o = await newOrder()
    const res = await split(o.id, [{ label: 'A', itemIds: [o.items[0].id] }])
    expect(res.status).toBe(400)
    expect(res.body.code).toBe('SPLIT_TOO_FEW')
  })

  it('flujo completo: dividir, cobrar A, agregar ítems, rehacer y deshacer', async () => {
    const o = await newOrder(3)
    const [i1, i2, i3] = o.items.map(i => i.id)
    const created = await split(o.id, [{ label: 'Cuenta A', itemIds: [i1] }, { label: 'Cuenta B', itemIds: [i2, i3] }])
    expect(created.status).toBe(201)
    const groupA = created.body.groups[0].id

    const bill = await request(ctx.app).post('/api/bills').set('Authorization', cashier)
      .send({ orderId: o.id, paymentMethod: 'yape', billGroupId: groupA })
    expect(bill.status).toBe(201)
    expect(bill.body.receipt.total).toBe(28)

    // Un ítem cobrado no puede reasignarse
    const bad = await split(o.id, [{ label: 'Cuenta B', itemIds: [i1, i2] }])
    expect(bad.status).toBe(400)
    expect(bad.body.code).toBe('SPLIT_INVALID_ITEM')

    // Con una sub-cuenta ya cobrada, basta 1 abierta
    const resplit = await split(o.id, [{ label: 'Cuenta B', itemIds: [i2, i3] }])
    expect(resplit.status).toBe(201)

    // Ítems nuevos se asignan solos a la única sub-cuenta abierta
    const added = await request(ctx.app).post(`/api/orders/${o.id}/items`).set('Authorization', waiter)
      .send({ items: [{ dishId, quantity: 1 }] })
    const openGroup = added.body.billGroups.find((g: any) => g.status === 'open')
    const newItem = added.body.items.find((i: any) => ![i1, i2, i3].includes(i.id))
    expect(newItem.billGroupId).toBe(openGroup.id)

    // Deshacer conserva la sub-cuenta cobrada
    const undo = await request(ctx.app).delete(`/api/orders/${o.id}/split`).set('Authorization', cashier)
    expect(undo.status).toBe(200)
    const groups = undo.body.order.billGroups
    expect(groups).toHaveLength(1)
    expect(groups[0]).toMatchObject({ id: groupA, status: 'paid' })
    const itemA = undo.body.order.items.find((i: any) => i.id === i1)
    expect(itemA.billGroupId).toBe(groupA)
  })

  it('no se puede dividir un pedido cancelado → 409', async () => {
    const o = await newOrder(2)
    await request(ctx.app).post(`/api/orders/${o.id}/cancel`).set('Authorization', cashier).send({ reason: 'prueba' })
    const res = await split(o.id, [{ label: 'A', itemIds: [o.items[0].id] }, { label: 'B', itemIds: [o.items[1].id] }])
    expect(res.status).toBe(409)
  })
})
