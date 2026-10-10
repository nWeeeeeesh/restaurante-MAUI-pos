import { describe, it, expect, beforeAll } from 'vitest'
import request from 'supertest'
import { eq } from 'drizzle-orm'
import { setupHttpApp } from './helpers/http'

// T2 / TD-01: el precio y el nombre de cada ítem salen del catálogo.
let ctx: Awaited<ReturnType<typeof setupHttpApp>>
let auth: string
let menu: {
  ceviche: number; chicha: number; agotado: number; deCatInactiva: number
  spiceGroup: number; prefGroup: number; normal: number; extraPicante: number
  otroGrupo: number; otraOpcion: number
}
let nextTable = 1

async function newTable() {
  const [t] = await ctx.db.insert(ctx.schema.tables).values({ number: 100 + nextTable++ }).returning()
  return t.id
}

beforeAll(async () => {
  ctx = await setupHttpApp()
  auth = (await ctx.as('waiter')).auth
  const s = ctx.schema
  const [cat] = await ctx.db.insert(s.categories).values({ name: 'Ceviches' }).returning()
  const [catOff] = await ctx.db.insert(s.categories).values({ name: 'Temporada', active: false }).returning()
  const [ceviche] = await ctx.db.insert(s.dishes).values({ categoryId: cat.id, name: 'Ceviche Clásico', price: 28 }).returning()
  const [chicha] = await ctx.db.insert(s.dishes).values({ categoryId: cat.id, name: 'Chicha', price: 8, hasSpiceLevel: false }).returning()
  const [agotado] = await ctx.db.insert(s.dishes).values({ categoryId: cat.id, name: 'Ceviche de Conchas', price: 40, available: false }).returning()
  const [deCatInactiva] = await ctx.db.insert(s.dishes).values({ categoryId: catOff.id, name: 'Plato de temporada', price: 30 }).returning()
  const [spice] = await ctx.db.insert(s.modifierGroups).values({ dishId: ceviche.id, name: 'Nivel de Picante', type: 'spice', required: true, multiple: false }).returning()
  const [pref] = await ctx.db.insert(s.modifierGroups).values({ dishId: ceviche.id, name: 'Preferencias', type: 'preference', required: false, multiple: true }).returning()
  const [normal] = await ctx.db.insert(s.modifierOptions).values({ groupId: spice.id, name: 'Normal' }).returning()
  const [extra] = await ctx.db.insert(s.modifierOptions).values({ groupId: spice.id, name: 'Extra picante', priceAdjustment: 1.5 }).returning()
  const [otroGrupo] = await ctx.db.insert(s.modifierGroups).values({ dishId: chicha.id, name: 'Tamaño', type: 'preference' }).returning()
  const [otraOpcion] = await ctx.db.insert(s.modifierOptions).values({ groupId: otroGrupo.id, name: 'Jarra' }).returning()
  menu = {
    ceviche: ceviche.id, chicha: chicha.id, agotado: agotado.id, deCatInactiva: deCatInactiva.id,
    spiceGroup: spice.id, prefGroup: pref.id, normal: normal.id, extraPicante: extra.id,
    otroGrupo: otroGrupo.id, otraOpcion: otraOpcion.id,
  }
})

function cevicheItem(extra: Record<string, unknown> = {}) {
  return { dishId: menu.ceviche, quantity: 1, modifiers: [{ groupId: menu.spiceGroup, optionId: menu.normal }], ...extra }
}

describe('POST /api/orders — precios desde el catálogo', () => {
  it('ignora unitPrice y dishName manipulados por el cliente', async () => {
    const res = await request(ctx.app).post('/api/orders').set('Authorization', auth).send({
      tableId: await newTable(), type: 'dine_in',
      items: [cevicheItem({ unitPrice: 0.01, dishName: 'Gratis' })],
    })
    expect(res.status).toBe(201)
    expect(res.body.items[0].unitPrice).toBe(28)
    expect(res.body.items[0].dishName).toBe('Ceviche Clásico')
    expect(res.body.items[0].modifiers[0]).toMatchObject({ groupName: 'Nivel de Picante', optionName: 'Normal' })
  })

  it('suma el ajuste de precio de la opción elegida', async () => {
    const res = await request(ctx.app).post('/api/orders').set('Authorization', auth).send({
      tableId: await newTable(), type: 'dine_in',
      items: [{ dishId: menu.ceviche, quantity: 2, modifiers: [
        { groupId: menu.spiceGroup, optionId: menu.extraPicante },
        { groupId: menu.prefGroup, freeText: '  sin cebolla ' },
      ] }],
    })
    expect(res.status).toBe(201)
    expect(res.body.items[0].unitPrice).toBe(29.5)
    expect(res.body.items[0].modifiers[1]).toMatchObject({ groupName: 'Preferencias', freeText: 'sin cebolla' })
  })

  it('plato agotado → 409 DISH_UNAVAILABLE y no crea el pedido', async () => {
    const tableId = await newTable()
    const res = await request(ctx.app).post('/api/orders').set('Authorization', auth).send({
      tableId, type: 'dine_in',
      items: [cevicheItem(), { dishId: menu.agotado, quantity: 1 }],
    })
    expect(res.status).toBe(409)
    expect(res.body.code).toBe('DISH_UNAVAILABLE')
    expect(res.body.details.dishes).toEqual([{ dishId: menu.agotado, name: 'Ceviche de Conchas' }])
    const rows = await ctx.db.select().from(ctx.schema.orders).where(eq(ctx.schema.orders.tableId, tableId))
    expect(rows.length).toBe(0)
  })

  it('plato de una categoría inactiva → 409', async () => {
    const res = await request(ctx.app).post('/api/orders').set('Authorization', auth).send({
      type: 'delivery', customerName: 'Ana', items: [{ dishId: menu.deCatInactiva, quantity: 1 }],
    })
    expect(res.status).toBe(409)
    expect(res.body.code).toBe('DISH_UNAVAILABLE')
  })

  it('opción de otro plato → 400 INVALID_MODIFIER', async () => {
    const res = await request(ctx.app).post('/api/orders').set('Authorization', auth).send({
      tableId: await newTable(), type: 'dine_in',
      items: [{ dishId: menu.ceviche, quantity: 1, modifiers: [
        { groupId: menu.spiceGroup, optionId: menu.normal },
        { groupId: menu.otroGrupo, optionId: menu.otraOpcion },
      ] }],
    })
    expect(res.status).toBe(400)
    expect(res.body.code).toBe('INVALID_MODIFIER')
  })

  it('falta el picante obligatorio → 400 MODIFIER_REQUIRED', async () => {
    const res = await request(ctx.app).post('/api/orders').set('Authorization', auth).send({
      tableId: await newTable(), type: 'dine_in', items: [{ dishId: menu.ceviche, quantity: 1 }],
    })
    expect(res.status).toBe(400)
    expect(res.body.code).toBe('MODIFIER_REQUIRED')
  })

  it('dos opciones en un grupo de opción única → 400', async () => {
    const res = await request(ctx.app).post('/api/orders').set('Authorization', auth).send({
      tableId: await newTable(), type: 'dine_in',
      items: [{ dishId: menu.ceviche, quantity: 1, modifiers: [
        { groupId: menu.spiceGroup, optionId: menu.normal },
        { groupId: menu.spiceGroup, optionId: menu.extraPicante },
      ] }],
    })
    expect(res.status).toBe(400)
  })
})

describe('POST /api/orders/:id/items — precios desde el catálogo', () => {
  it('los ítems agregados también usan el precio del catálogo', async () => {
    const created = await request(ctx.app).post('/api/orders').set('Authorization', auth).send({
      tableId: await newTable(), type: 'dine_in', items: [cevicheItem()],
    })
    const res = await request(ctx.app).post(`/api/orders/${created.body.id}/items`).set('Authorization', auth).send({
      items: [{ dishId: menu.chicha, quantity: 3, unitPrice: 1, dishName: 'X' }],
    })
    expect(res.status).toBe(200)
    const chicha = res.body.items.find((i: any) => i.dishId === menu.chicha)
    expect(chicha).toMatchObject({ dishName: 'Chicha', unitPrice: 8, quantity: 3 })
  })
})
