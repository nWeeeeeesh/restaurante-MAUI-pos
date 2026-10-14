import { describe, it, expect, beforeAll } from 'vitest'
import request from 'supertest'
import { eq } from 'drizzle-orm'
import { setupHttpApp } from './helpers/http'

// TD-31: "agotado" (available=false) y "dado de baja" (archived=true) son cosas
// distintas. Así dish.availability en audit_log mide solo quiebres reales.
let ctx: Awaited<ReturnType<typeof setupHttpApp>>
let owner: string
let waiter: string
let catId: number
let tableId: number

beforeAll(async () => {
  ctx = await setupHttpApp()
  owner = (await ctx.as('owner')).auth
  waiter = (await ctx.as('waiter')).auth
  const [cat] = await ctx.db.insert(ctx.schema.categories).values({ name: 'Ceviches' }).returning()
  const [table] = await ctx.db.insert(ctx.schema.tables).values({ number: 5 }).returning()
  catId = cat.id
  tableId = table.id
})

async function dishWithHistory(name: string) {
  const [dish] = await ctx.db.insert(ctx.schema.dishes).values({ categoryId: catId, name, price: 30, hasSpiceLevel: false }).returning()
  const [order] = await ctx.db.insert(ctx.schema.orders).values({ type: 'delivery', status: 'paid', customerName: 'X' }).returning()
  await ctx.db.insert(ctx.schema.orderItems).values({ orderId: order.id, dishId: dish.id, dishName: name, unitPrice: 30, quantity: 1 })
  return dish
}

const menuDishNames = async () => {
  const res = await request(ctx.app).get('/api/menu').set('Authorization', waiter)
  return (res.body as { dishes: { name: string; available: boolean }[] }[]).flatMap(c => c.dishes)
}

describe('baja de platos (TD-31)', () => {
  it('borrar un plato con historial lo archiva sin tocar available y lo audita', async () => {
    const dish = await dishWithHistory('Ceviche de pato')
    const res = await request(ctx.app).delete(`/api/menu/dishes/${dish.id}`).set('Authorization', owner)
    expect(res.status).toBe(200)
    expect(res.body.archived).toBe(true)

    const [after] = await ctx.db.select().from(ctx.schema.dishes).where(eq(ctx.schema.dishes.id, dish.id))
    expect(after.archived).toBe(true)
    expect(after.available).toBe(true)

    const logs = await ctx.db.select().from(ctx.schema.auditLog).where(eq(ctx.schema.auditLog.entityId, dish.id))
    expect(logs.map(l => l.action)).toContain('dish.archive')
    expect(logs.map(l => l.action)).not.toContain('dish.availability')
  })

  it('un plato sin historial se borra de verdad', async () => {
    const [dish] = await ctx.db.insert(ctx.schema.dishes).values({ categoryId: catId, name: 'Prueba', price: 10, hasSpiceLevel: false }).returning()
    expect((await request(ctx.app).delete(`/api/menu/dishes/${dish.id}`).set('Authorization', owner)).status).toBe(204)
    expect(await ctx.db.select().from(ctx.schema.dishes).where(eq(ctx.schema.dishes.id, dish.id))).toHaveLength(0)
  })

  it('el menú del POS incluye los agotados y excluye los archivados', async () => {
    const archived = await dishWithHistory('Archivado')
    await request(ctx.app).delete(`/api/menu/dishes/${archived.id}`).set('Authorization', owner)
    const [soldOut] = await ctx.db.insert(ctx.schema.dishes).values({ categoryId: catId, name: 'Chicharrón de calamar', price: 35, hasSpiceLevel: false, available: false }).returning()

    const names = await menuDishNames()
    expect(names.find(d => d.name === soldOut.name)?.available).toBe(false)
    expect(names.some(d => d.name === 'Archivado')).toBe(false)
  })

  it('un plato archivado no se puede pedir', async () => {
    const dish = await dishWithHistory('Leche de tigre')
    await request(ctx.app).delete(`/api/menu/dishes/${dish.id}`).set('Authorization', owner)
    const res = await request(ctx.app).post('/api/orders').set('Authorization', waiter)
      .send({ type: 'dine_in', tableId, items: [{ dishId: dish.id, quantity: 1, modifiers: [] }] })
    expect(res.status).toBe(409)
    expect(res.body.code).toBe('DISH_UNAVAILABLE')
  })

  it('marcar agotado desde la edición del dueño también cuenta como quiebre (dish.availability)', async () => {
    const [dish] = await ctx.db.insert(ctx.schema.dishes).values({ categoryId: catId, name: 'Jalea', price: 40, hasSpiceLevel: false }).returning()
    await request(ctx.app).patch(`/api/menu/dishes/${dish.id}`).set('Authorization', owner).send({ available: false, price: 42 })
    // Cambiar solo el precio no es un quiebre
    await request(ctx.app).patch(`/api/menu/dishes/${dish.id}`).set('Authorization', owner).send({ price: 41 })
    const logs = await ctx.db.select().from(ctx.schema.auditLog).where(eq(ctx.schema.auditLog.entityId, dish.id))
    const availability = logs.filter(l => l.action === 'dish.availability')
    expect(availability).toHaveLength(1)
    expect(JSON.parse(availability[0].data!)).toMatchObject({ name: 'Jalea', available: false })
  })

  it('marcar agotado dos veces registra un solo quiebre', async () => {
    const manager = (await ctx.as('manager')).auth
    const [dish] = await ctx.db.insert(ctx.schema.dishes).values({ categoryId: catId, name: 'Arroz con mariscos', price: 38, hasSpiceLevel: false }).returning()
    for (const available of [false, false, true]) {
      const res = await request(ctx.app).patch(`/api/menu/dishes/${dish.id}/availability`).set('Authorization', manager).send({ available })
      expect(res.status).toBe(200)
      expect(res.body.available).toBe(available)
    }
    const logs = await ctx.db.select().from(ctx.schema.auditLog).where(eq(ctx.schema.auditLog.entityId, dish.id))
    expect(logs.filter(l => l.action === 'dish.availability').map(l => JSON.parse(l.data!).available)).toEqual([false, true])
  })

  it('el dueño puede restaurar un plato archivado', async () => {
    const dish = await dishWithHistory('Sudado')
    await request(ctx.app).delete(`/api/menu/dishes/${dish.id}`).set('Authorization', owner)
    const res = await request(ctx.app).patch(`/api/menu/dishes/${dish.id}`).set('Authorization', owner).send({ archived: false })
    expect(res.status).toBe(200)
    expect(res.body.archived).toBe(false)
    expect((await menuDishNames()).some(d => d.name === 'Sudado')).toBe(true)
    // Archivar es DELETE: PATCH no acepta archived=true
    expect((await request(ctx.app).patch(`/api/menu/dishes/${dish.id}`).set('Authorization', owner).send({ archived: true })).status).toBe(400)
  })
})
