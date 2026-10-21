import { describe, it, expect, beforeAll } from 'vitest'
import request from 'supertest'
import { eq } from 'drizzle-orm'
import { setupHttpApp } from './helpers/http'
import { addDays, localDateString } from '../utils/dates'
import { globalIndicatorsVisibleIn, isGroupActiveIn, limaDate } from '../utils/study'

// Plan v3 §2.3: configuración del estudio (solo el dueño) y helpers por los que
// pasará toda la fase 2. Invariantes 2 y 4: nada de la intervención antes de la
// fecha de cada grupo y nada global hasta el fin del estudio.
let ctx: Awaited<ReturnType<typeof setupHttpApp>>
let owner: string
let manager: string
const today = localDateString()

beforeAll(async () => {
  ctx = await setupHttpApp()
  owner = (await ctx.as('owner')).auth
  manager = (await ctx.as('manager')).auth
  await ctx.db.insert(ctx.schema.supplies).values([
    { name: 'Calamar', code: 'CALAMAR', unit: 'kg', critical: true, studyGroup: 'calamar' },
    { name: 'Pescado', code: 'PESCADO', unit: 'kg', critical: true, studyGroup: 'pescado' },
    { name: 'Pulpo', code: 'PULPO', unit: 'kg', critical: true, studyGroup: 'mariscos' },
    { name: 'Conchas', code: 'CONCHAS', unit: 'unit', critical: true, studyGroup: 'mariscos' },
    { name: 'Limón', code: 'LIMON', unit: 'kg' },
  ])
})

const put = (body: object, auth = owner) => request(ctx.app).put('/api/inventory/study').set('Authorization', auth).send(body)
const get = (auth = owner) => request(ctx.app).get('/api/inventory/study').set('Authorization', auth)
const setRaw = async (key: string, value: string) => {
  await ctx.db.delete(ctx.schema.studyConfig).where(eq(ctx.schema.studyConfig.key, key))
  await ctx.db.insert(ctx.schema.studyConfig).values({ key, value })
}

describe('helpers del estudio', () => {
  const config = { activates_calamar: '2027-01-11', study_ends_on: '2027-04-04' }

  it('isGroupActive: falso el día anterior, verdadero el mismo día; sin fecha, falso', () => {
    expect(isGroupActiveIn(config, 'calamar', '2027-01-10')).toBe(false)
    expect(isGroupActiveIn(config, 'calamar', '2027-01-11')).toBe(true)
    expect(isGroupActiveIn(config, 'calamar', '2027-03-01')).toBe(true)
    expect(isGroupActiveIn(config, 'pescado', '2027-03-01')).toBe(false)
    expect(isGroupActiveIn({}, 'mariscos', '2030-01-01')).toBe(false)
  })

  it('isGroupActive usa la hora de Lima: 04:59 UTC del 11 aún es 10 en Lima', () => {
    expect(limaDate(new Date('2027-01-11T04:59:59Z'))).toBe('2027-01-10')
    expect(isGroupActiveIn(config, 'calamar', new Date('2027-01-11T04:59:59Z'))).toBe(false)
    expect(isGroupActiveIn(config, 'calamar', new Date('2027-01-11T05:00:00Z'))).toBe(true)
  })

  it('areGlobalIndicatorsVisible: falso sin configuración y hasta study_ends_on inclusive', () => {
    expect(globalIndicatorsVisibleIn({}, '2030-01-01')).toBe(false)
    expect(globalIndicatorsVisibleIn(config, '2027-04-04')).toBe(false)
    expect(globalIndicatorsVisibleIn(config, new Date('2027-04-05T04:59:00Z'))).toBe(false)
    expect(globalIndicatorsVisibleIn(config, '2027-04-05')).toBe(true)
  })

  it('las versiones que leen la BD responden con la configuración guardada', async () => {
    const study = await import('../services/study.service')
    expect(await study.isGroupActive('pescado', today)).toBe(false)
    expect(await study.areGlobalIndicatorsVisible(today)).toBe(false)
    await setRaw('activates_pescado', today)
    expect(await study.isGroupActive('pescado', today)).toBe(true)
    expect(await study.isGroupActive('pescado', addDays(today, -1))).toBe(false)
    await ctx.db.delete(ctx.schema.studyConfig)
  })
})

describe('PUT /api/inventory/study', () => {
  it('solo el dueño configura; el encargado puede ver', async () => {
    expect((await put({ study_ends_on: '2027-04-04' }, manager)).status).toBe(403)
    expect((await get(manager)).status).toBe(200)
  })

  it('guarda, devuelve los grupos con sus insumos y deja audit (antes y después)', async () => {
    const body = {
      baseline_starts_on: addDays(today, 10),
      study_ends_on: addDays(today, 150),
      activation_order: 'pescado,calamar',
      activates_pescado: addDays(today, 60),
      activates_calamar: addDays(today, 80),
      activates_mariscos: addDays(today, 151),
      second_local_opens_on: addDays(today, 40),
    }
    const res = await put(body)
    expect(res.status).toBe(200)
    expect(res.body.config).toMatchObject(body)
    const groups = Object.fromEntries(res.body.groups.map((g: { group: string }) => [g.group, g]))
    expect(groups.calamar).toEqual({ group: 'calamar', activates_on: body.activates_calamar, active_today: false, supplies: ['CALAMAR'] })
    expect(groups.mariscos.supplies.sort()).toEqual(['CONCHAS', 'PULPO'])

    const [log] = await ctx.db.select().from(ctx.schema.auditLog).where(eq(ctx.schema.auditLog.action, 'study.configure'))
    expect(JSON.parse(log.data!)).toMatchObject({ before: {}, after: body })
  })

  it('rechaza mariscos que se activan en o antes del fin del estudio', async () => {
    const res = await put({ activates_mariscos: addDays(today, 150) })
    expect(res.status).toBe(400)
    expect(res.body.code).toBe('study.mariscos_before_end')
  })

  it('el orden sorteado debe coincidir con las fechas', async () => {
    const res = await put({ activation_order: 'calamar,pescado' })
    expect(res.status).toBe(400)
    expect(res.body.code).toBe('study.order_mismatch')
  })

  it('no acepta activar un grupo con fecha pasada', async () => {
    const res = await put({ activates_calamar: addDays(today, -1) })
    expect(res.status).toBe(400)
    expect(res.body.code).toBe('study.activation_in_past')
  })

  it('bloquea la fecha de un grupo que ya se activó y la línea base ya iniciada', async () => {
    await setRaw('activates_pescado', today)
    const locked = await put({ activates_pescado: addDays(today, 5) })
    expect(locked.status).toBe(409)
    expect(locked.body.code).toBe('study.activation_locked')
    expect((await put({ activates_pescado: null })).status).toBe(409)

    await setRaw('baseline_starts_on', addDays(today, -3))
    const baseline = await put({ baseline_starts_on: addDays(today, 2) })
    expect(baseline.status).toBe(409)
    expect(baseline.body.code).toBe('study.baseline_locked')

    // Lo que aún no llegó se puede mover
    expect((await put({ activates_calamar: addDays(today, 81) })).status).toBe(200)
    const g = (await get()).body.groups.find((x: { group: string }) => x.group === 'pescado')
    expect(g.active_today).toBe(true)
  })
})

describe('insumos del estudio durante la medición', () => {
  // Si un insumo del estudio deja de ser crítico o se desactiva, sale de la «Compra
  // del día» y el registro cambia a mitad del estudio (invariante 1)
  it('no pueden dejar de ser críticos ni desactivarse entre la línea base y el fin', async () => {
    const [calamar] = await ctx.db.select().from(ctx.schema.supplies).where(eq(ctx.schema.supplies.code, 'CALAMAR'))
    const [limon] = await ctx.db.select().from(ctx.schema.supplies).where(eq(ctx.schema.supplies.code, 'LIMON'))
    const patch = (id: number, body: object) => request(ctx.app).patch(`/api/inventory/supplies/${id}`).set('Authorization', owner).send(body)

    await ctx.db.delete(ctx.schema.studyConfig)
    // Antes de la línea base se puede ajustar todo
    expect((await patch(calamar.id, { critical: false })).status).toBe(200)
    expect((await patch(calamar.id, { critical: true })).status).toBe(200)

    await setRaw('baseline_starts_on', addDays(today, -1))
    await setRaw('study_ends_on', addDays(today, 30))
    const locked = await patch(calamar.id, { critical: false })
    expect(locked.status).toBe(409)
    expect(locked.body.code).toBe('study.supply_locked')
    expect((await patch(calamar.id, { active: false })).status).toBe(409)
    // Lo demás sí: nombre del insumo del estudio, o cualquier cambio fuera del estudio
    expect((await patch(calamar.id, { name: 'Calamar gigante' })).status).toBe(200)
    expect((await patch(limon.id, { active: false })).status).toBe(200)

    // Terminado el estudio, vuelve a ser libre
    await setRaw('study_ends_on', addDays(today, -1))
    expect((await patch(calamar.id, { critical: false })).status).toBe(200)
    await ctx.db.delete(ctx.schema.studyConfig)
  })
})

