import { describe, it, expect, beforeAll } from 'vitest'
import request from 'supertest'
import { setupHttpApp } from './helpers/http'

let ctx: Awaited<ReturnType<typeof setupHttpApp>>

beforeAll(async () => {
  ctx = await setupHttpApp()
})

describe('app HTTP (humo)', () => {
  it('GET /api/health → 200', async () => {
    const res = await request(ctx.app).get('/api/health')
    expect(res.status).toBe(200)
    expect(res.body.status).toBe('ok')
  })

  it('sin token → 401', async () => {
    const res = await request(ctx.app).get('/api/orders/active')
    expect(res.status).toBe(401)
  })

  it('con token → 200', async () => {
    const { auth } = await ctx.as('waiter')
    const res = await request(ctx.app).get('/api/orders/active').set('Authorization', auth)
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body)).toBe(true)
  })

  it('ruta /api inexistente → 404 JSON', async () => {
    const res = await request(ctx.app).get('/api/no-existe')
    expect(res.status).toBe(404)
    expect(res.body.code).toBe('NOT_FOUND')
  })

  it('JSON malformado → 400 JSON (manejador global)', async () => {
    const { auth } = await ctx.as('owner')
    const res = await request(ctx.app).post('/api/orders')
      .set('Authorization', auth)
      .set('Content-Type', 'application/json')
      .send('{"roto":')
    expect(res.status).toBe(400)
    expect(res.body.code).toBe('INVALID_JSON')
  })

  it('error de negocio del cobro → JSON con status', async () => {
    const { auth } = await ctx.as('cashier')
    const res = await request(ctx.app).post('/api/bills')
      .set('Authorization', auth)
      .send({ orderId: 9999, paymentMethod: 'yape' })
    expect(res.status).toBe(404)
    expect(res.body.error).toBe('Pedido no encontrado')
  })
})
