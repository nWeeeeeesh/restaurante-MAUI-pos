import { describe, it, expect, beforeAll } from 'vitest'
import request from 'supertest'
import { setupHttpApp } from './helpers/http'
import { selectReprint } from '../utils/tickets'

// T6 / TD-17: reintentar solo lo que no llegó a cocina, o reimprimir todo marcado.
describe('selectReprint', () => {
  const items = [
    { id: 1, kitchenPrinted: true },
    { id: 2, kitchenPrinted: false },
    { id: 3, kitchenPrinted: null },
  ]

  it('onlyUnprinted: solo los no impresos, como agregado (no es reimpresión para la cocina)', () => {
    const r = selectReprint(items, true)
    expect(r.items.map(i => i.id)).toEqual([2, 3])
    expect(r).toMatchObject({ isReprint: false, isAddition: true })
  })

  it('onlyUnprinted sin nada impreso antes: comanda nueva', () => {
    const r = selectReprint([{ id: 9, kitchenPrinted: false }], true)
    expect(r).toMatchObject({ isReprint: false, isAddition: false })
  })

  it('completa: todos los ítems, marcada como REIMPRESION', () => {
    const r = selectReprint(items, false)
    expect(r.items.length).toBe(3)
    expect(r.isReprint).toBe(true)
  })
})

describe('POST /api/orders/:id/reprint-kitchen', () => {
  let ctx: Awaited<ReturnType<typeof setupHttpApp>>
  let waiter: string
  let orderId: number

  beforeAll(async () => {
    // Sin impresora configurada: la impresión falla de inmediato (como si estuviera apagada).
    delete process.env.PRINTER_HOST
    process.env.PRINTER_TYPE = 'tcp'
    ctx = await setupHttpApp()
    waiter = (await ctx.as('waiter')).auth
    const [cat] = await ctx.db.insert(ctx.schema.categories).values({ name: 'Bebidas' }).returning()
    const [dish] = await ctx.db.insert(ctx.schema.dishes).values({ categoryId: cat.id, name: 'Chicha', price: 8, hasSpiceLevel: false }).returning()
    const [t] = await ctx.db.insert(ctx.schema.tables).values({ number: 1 }).returning()
    const res = await request(ctx.app).post('/api/orders').set('Authorization', waiter)
      .send({ tableId: t.id, type: 'dine_in', items: [{ dishId: dish.id, quantity: 1 }] })
    orderId = res.body.id
  })

  it('impresora no disponible → 502 PRINTER_UNAVAILABLE y los ítems siguen sin imprimir', async () => {
    const res = await request(ctx.app).post(`/api/orders/${orderId}/reprint-kitchen`).set('Authorization', waiter)
      .send({ onlyUnprinted: true })
    expect(res.status).toBe(502)
    expect(res.body.code).toBe('PRINTER_UNAVAILABLE')
    const order = await request(ctx.app).get(`/api/orders/${orderId}`).set('Authorization', waiter)
    expect(order.body.items.every((i: any) => !i.kitchenPrinted)).toBe(true)
  })

  it('sin body reimprime la comanda completa (también falla sin impresora, pero es aceptado)', async () => {
    const res = await request(ctx.app).post(`/api/orders/${orderId}/reprint-kitchen`).set('Authorization', waiter)
    expect(res.status).toBe(502)
  })

  it('pedido inexistente → 404', async () => {
    const res = await request(ctx.app).post('/api/orders/99999/reprint-kitchen').set('Authorization', waiter)
    expect(res.status).toBe(404)
  })
})
