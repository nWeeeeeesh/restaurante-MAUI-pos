import { describe, it, expect, beforeAll } from 'vitest'
import request from 'supertest'
import { eq } from 'drizzle-orm'
import { setupHttpApp } from './helpers/http'
import { transfersEnabled } from '../domain/settings'
import { limaDate } from '../utils/dates'

// plan-sistema T2: el estudio por grupos se retiró; los ajustes del local guardan la
// fecha de apertura del segundo local, que habilita los traslados.
let ctx: Awaited<ReturnType<typeof setupHttpApp>>
let owner: string
let manager: string

beforeAll(async () => {
  ctx = await setupHttpApp()
  owner = (await ctx.as('owner')).auth
  manager = (await ctx.as('manager')).auth
})

describe('dominio de ajustes', () => {
  it('[RF05] los traslados se habilitan desde la fecha de apertura del segundo local', () => {
    expect(transfersEnabled({}, '2027-01-01')).toBe(false)
    expect(transfersEnabled({ second_local_opened_on: '2026-12-28' }, '2026-12-27')).toBe(false)
    expect(transfersEnabled({ second_local_opened_on: '2026-12-28' }, '2026-12-28')).toBe(true)
  })

  it('limaDate usa la zona de Lima: 04:59 UTC del 11 aún es 10 en Lima', () => {
    expect(limaDate(new Date('2027-01-11T04:59:59Z'))).toBe('2027-01-10')
    expect(limaDate(new Date('2027-01-11T05:00:00Z'))).toBe('2027-01-11')
    expect(limaDate('2027-01-11')).toBe('2027-01-11')
  })
})

describe('GET/PUT /api/settings', () => {
  it('[RNF06] solo el dueño escribe; el encargado lee', async () => {
    expect((await request(ctx.app).put('/api/settings').set('Authorization', manager).send({ second_local_opened_on: '2026-12-28' })).status).toBe(403)
    expect((await request(ctx.app).get('/api/settings').set('Authorization', manager)).status).toBe(200)
  })

  it('guarda, borra con null y deja audit con el antes y el después', async () => {
    const res = await request(ctx.app).put('/api/settings').set('Authorization', owner).send({ second_local_opened_on: '2026-12-28' })
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ second_local_opened_on: '2026-12-28' })
    expect((await request(ctx.app).get('/api/settings').set('Authorization', manager)).body).toEqual({ second_local_opened_on: '2026-12-28' })

    const [log] = await ctx.db.select().from(ctx.schema.auditLog).where(eq(ctx.schema.auditLog.action, 'settings.update'))
    expect(JSON.parse(log.data!)).toEqual({ before: {}, after: { second_local_opened_on: '2026-12-28' } })

    expect((await request(ctx.app).put('/api/settings').set('Authorization', owner).send({ second_local_opened_on: null })).body).toEqual({})
    expect((await request(ctx.app).put('/api/settings').set('Authorization', owner).send({ second_local_opened_on: '28/12' })).status).toBe(400)
  })

  it('las rutas del estudio ya no existen', async () => {
    expect((await request(ctx.app).get('/api/inventory/study').set('Authorization', owner)).status).toBe(404)
  })
})
