import { describe, it, expect, beforeAll, vi } from 'vitest'
import request from 'supertest'
import { setupHttpApp } from './helpers/http'

// Plan inventario v2.1 (C): el cajero marca agotado desde el POS y los demás
// celulares deben enterarse sin recargar. Se emite solo en transiciones reales.
vi.mock('../realtime', () => ({ emit: vi.fn(), setIo: vi.fn(), disconnectUser: vi.fn() }))

let ctx: Awaited<ReturnType<typeof setupHttpApp>>
let emit: ReturnType<typeof vi.fn>
let owner: string
let cashier: string
let dishId: number

beforeAll(async () => {
  ctx = await setupHttpApp()
  emit = (await import('../realtime')).emit as unknown as ReturnType<typeof vi.fn>
  owner = (await ctx.as('owner')).auth
  cashier = (await ctx.as('cashier')).auth
  const [cat] = await ctx.db.insert(ctx.schema.categories).values({ name: 'Chicharrones' }).returning()
  const [dish] = await ctx.db.insert(ctx.schema.dishes).values({ categoryId: cat.id, name: 'Chicharrón de calamar', price: 35, hasSpiceLevel: false }).returning()
  dishId = dish.id
})

const availabilityEvents = () => emit.mock.calls.filter(([event]) => event === 'menu:availability').map(([, payload]) => payload)

describe('evento menu:availability', () => {
  it('se emite al marcar agotado o habilitar, no al repetir el mismo estado', async () => {
    emit.mockClear()
    for (const available of [false, false, true]) {
      await request(ctx.app).patch(`/api/menu/dishes/${dishId}/availability`).set('Authorization', cashier).send({ available })
    }
    expect(availabilityEvents()).toEqual([{ dishId, available: false }, { dishId, available: true }])
  })

  it('también desde la edición del dueño, solo si cambia la disponibilidad', async () => {
    emit.mockClear()
    await request(ctx.app).patch(`/api/menu/dishes/${dishId}`).set('Authorization', owner).send({ price: 36 })
    await request(ctx.app).patch(`/api/menu/dishes/${dishId}`).set('Authorization', owner).send({ available: false })
    expect(availabilityEvents()).toEqual([{ dishId, available: false }])
  })
})
