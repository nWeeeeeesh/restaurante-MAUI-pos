import { describe, it, expect, beforeAll } from 'vitest'
import request from 'supertest'
import bcrypt from 'bcryptjs'
import { eq } from 'drizzle-orm'
import { setupHttpApp } from './helpers/http'

// T11 / TD-13, TD-15: sesiones que reflejan el estado actual del usuario y
// límite de intentos de login.
let ctx: Awaited<ReturnType<typeof setupHttpApp>>

beforeAll(async () => {
  ctx = await setupHttpApp()
})

describe('sesión validada contra la BD (TD-13)', () => {
  it('un usuario inhabilitado pierde el acceso con su token vigente', async () => {
    const { user, auth } = await ctx.as('cashier')
    expect((await request(ctx.app).get('/api/orders/active').set('Authorization', auth)).status).toBe(200)
    await ctx.db.update(ctx.schema.users).set({ active: false }).where(eq(ctx.schema.users.id, user.id))
    expect((await request(ctx.app).get('/api/orders/active').set('Authorization', auth)).status).toBe(401)
  })

  it('un usuario degradado pierde los permisos del rol anterior', async () => {
    const { user, auth } = await ctx.as('cashier')
    await ctx.db.update(ctx.schema.users).set({ role: 'waiter' }).where(eq(ctx.schema.users.id, user.id))
    const res = await request(ctx.app).post('/api/bills').set('Authorization', auth).send({ orderId: 1, paymentMethod: 'yape' })
    expect(res.status).toBe(403)
    const me = await request(ctx.app).get('/api/auth/me').set('Authorization', auth)
    expect(me.body.user.role).toBe('waiter')
  })
})

describe('límite de intentos de login (TD-15)', () => {
  beforeAll(async () => {
    await ctx.db.insert(ctx.schema.users).values([
      { name: 'Rosa', username: 'rosa', passwordHash: await bcrypt.hash('clave-correcta', 4), role: 'manager' },
      { name: 'Luis', username: 'luis', passwordHash: await bcrypt.hash('otra-clave', 4), role: 'owner' },
    ])
  })

  const login = (username: string, password: string) =>
    request(ctx.app).post('/api/auth/login').send({ username, password })

  it('login correcto devuelve token', async () => {
    const res = await login('luis', 'otra-clave')
    expect(res.status).toBe(200)
    expect(res.body.token).toBeTruthy()
  })

  it('tras 5 fallos, el 6.º intento responde 429 aunque la clave sea correcta', async () => {
    for (let i = 0; i < 5; i++) expect((await login('rosa', 'incorrecta')).status).toBe(401)
    const blocked = await login('rosa', 'clave-correcta')
    expect(blocked.status).toBe(429)
    expect(blocked.body.code).toBe('TOO_MANY_ATTEMPTS')
  })

  it('el bloqueo es por usuario: otros usuarios siguen entrando', async () => {
    expect((await login('luis', 'otra-clave')).status).toBe(200)
  })
})
