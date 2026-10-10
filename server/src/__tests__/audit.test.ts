import { describe, it, expect, beforeAll } from 'vitest'
import request from 'supertest'
import { eq } from 'drizzle-orm'
import { setupHttpApp } from './helpers/http'

// M3 / TD-16: cambios sensibles quedan registrados en audit_log.
let ctx: Awaited<ReturnType<typeof setupHttpApp>>
let owner: string

beforeAll(async () => {
  ctx = await setupHttpApp()
  owner = (await ctx.as('owner')).auth
})

async function lastLog(action: string) {
  const rows = await ctx.db.select().from(ctx.schema.auditLog).where(eq(ctx.schema.auditLog.action, action))
  const log = rows[rows.length - 1]
  return log ? { ...log, data: JSON.parse(log.data!) } : undefined
}

describe('audit_log', () => {
  it('cambio de precio de un plato', async () => {
    const [cat] = await ctx.db.insert(ctx.schema.categories).values({ name: 'Platos' }).returning()
    const [dish] = await ctx.db.insert(ctx.schema.dishes).values({ categoryId: cat.id, name: 'Ceviche', price: 28 }).returning()
    await request(ctx.app).patch(`/api/menu/dishes/${dish.id}`).set('Authorization', owner).send({ price: 30 })
    const log = await lastLog('dish.update')
    expect(log?.data).toMatchObject({ before: { price: 28 }, changes: { price: 30 } })
  })

  it('cambio de rol e inhabilitación de un usuario', async () => {
    const { user } = await ctx.as('cashier')
    await request(ctx.app).patch(`/api/users/${user.id}`).set('Authorization', owner).send({ role: 'manager' })
    const log = await lastLog('user.update')
    expect(log?.data).toMatchObject({ before: { role: 'cashier' }, after: { role: 'manager' } })
    expect(log?.entityId).toBe(user.id)
  })

  it('restablecer contraseña no guarda la contraseña', async () => {
    const { user } = await ctx.as('waiter')
    await request(ctx.app).post(`/api/users/${user.id}/password`).set('Authorization', owner).send({ password: 'nueva-clave-1' })
    const log = await lastLog('user.password_reset')
    expect(log?.entityId).toBe(user.id)
    expect(JSON.stringify(log?.data)).not.toContain('nueva-clave-1')
  })

  it('baja de una mesa sin historial', async () => {
    const [t] = await ctx.db.insert(ctx.schema.tables).values({ number: 77 }).returning()
    const res = await request(ctx.app).delete(`/api/tables/${t.id}`).set('Authorization', owner)
    expect(res.body.deleted).toBe(true)
    const log = await lastLog('table.delete')
    expect(log?.data).toMatchObject({ number: 77 })
  })
})
