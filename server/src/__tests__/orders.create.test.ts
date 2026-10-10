import { describe, it, expect, beforeAll } from 'vitest'
import request from 'supertest'
import { and, eq, notInArray } from 'drizzle-orm'
import { setupHttpApp } from './helpers/http'

// T4 / TD-04: un solo pedido activo por mesa, aun con envíos simultáneos.
let ctx: Awaited<ReturnType<typeof setupHttpApp>>
let waiter: string, cashier: string
let dishId: number
let tableSeq = 1

beforeAll(async () => {
  ctx = await setupHttpApp()
  waiter = (await ctx.as('waiter')).auth
  cashier = (await ctx.as('cashier')).auth
  const [cat] = await ctx.db.insert(ctx.schema.categories).values({ name: 'Bebidas' }).returning()
  const [dish] = await ctx.db.insert(ctx.schema.dishes).values({ categoryId: cat.id, name: 'Chicha', price: 8, hasSpiceLevel: false }).returning()
  dishId = dish.id
})

async function newTable(extra: Record<string, unknown> = {}) {
  const [t] = await ctx.db.insert(ctx.schema.tables).values({ number: 300 + tableSeq++, ...extra }).returning()
  return t.id
}

const send = (body: Record<string, unknown>) =>
  request(ctx.app).post('/api/orders').set('Authorization', waiter).send({ items: [{ dishId, quantity: 1 }], ...body })

async function activeOrdersOn(tableId: number) {
  const o = ctx.schema.orders
  return ctx.db.select().from(o).where(and(eq(o.tableId, tableId), notInArray(o.status, ['paid', 'cancelled'])))
}

describe('POST /api/orders — sin duplicados', () => {
  it('tres envíos simultáneos a la misma mesa → 1 pedido (201) y el resto 409 TABLE_BUSY', async () => {
    const tableId = await newTable()
    const results = await Promise.all([1, 2, 3].map(() => send({ tableId, type: 'dine_in' })))
    const statuses = results.map(r => r.status).sort()
    expect(statuses).toEqual([201, 409, 409])
    expect(results.filter(r => r.status === 409).every(r => r.body.code === 'TABLE_BUSY')).toBe(true)
    expect((await activeOrdersOn(tableId)).length).toBe(1)
  })

  it('tras cancelar, la mesa acepta un pedido nuevo', async () => {
    const tableId = await newTable()
    const first = await send({ tableId, type: 'dine_in' })
    await request(ctx.app).post(`/api/orders/${first.body.id}/cancel`).set('Authorization', cashier).send({ reason: 'prueba' })
    const second = await send({ tableId, type: 'dine_in' })
    expect(second.status).toBe(201)
  })

  it('delivery simultáneos no se bloquean entre sí', async () => {
    const results = await Promise.all([1, 2].map(i => send({ type: 'delivery', customerName: `Cliente ${i}` })))
    expect(results.map(r => r.status)).toEqual([201, 201])
  })

  it('pedido de mesa sin mesa → 400 TABLE_REQUIRED', async () => {
    const res = await send({ type: 'dine_in' })
    expect(res.status).toBe(400)
    expect(res.body.code).toBe('TABLE_REQUIRED')
  })

  it('mesa inhabilitada → 409 TABLE_INACTIVE', async () => {
    const tableId = await newTable({ active: false })
    const res = await send({ tableId, type: 'dine_in' })
    expect(res.status).toBe(409)
    expect(res.body.code).toBe('TABLE_INACTIVE')
  })

  it('la BD rechaza un segundo pedido activo en la misma mesa (índice uq_orders_active_table)', async () => {
    const tableId = await newTable()
    const o = ctx.schema.orders
    await ctx.db.insert(o).values({ tableId, type: 'dine_in', status: 'pending' })
    await expect(ctx.db.insert(o).values({ tableId, type: 'dine_in', status: 'paying' })).rejects.toThrow()
    // Un pedido cerrado no cuenta
    await expect(ctx.db.insert(o).values({ tableId, type: 'dine_in', status: 'paid' })).resolves.toBeDefined()
  })
})
