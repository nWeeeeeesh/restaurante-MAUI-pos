import { describe, it, expect, beforeAll } from 'vitest'
import request from 'supertest'
import { eq } from 'drizzle-orm'
import { setupHttpApp } from './helpers/http'
import { localDateString, localDayEnd, localDayStart } from '../utils/dates'

// Inventario Fase 0 (plan-inventario-tesis §3): solo registro, con las mismas
// reglas que los gastos para corregir o borrar (motivo + audit_log).
let ctx: Awaited<ReturnType<typeof setupHttpApp>>
let owner: string
let manager: string
let waiter: string
let calamarId: number
let pescadoId: number
let dishId: number

const today = localDateString()

beforeAll(async () => {
  ctx = await setupHttpApp()
  owner = (await ctx.as('owner')).auth
  manager = (await ctx.as('manager')).auth
  waiter = (await ctx.as('waiter')).auth
  const [calamar] = await ctx.db.insert(ctx.schema.supplies).values({ name: 'Calamar', unit: 'kg', critical: true }).returning()
  const [pescado] = await ctx.db.insert(ctx.schema.supplies).values({ name: 'Pescado', unit: 'kg', critical: true }).returning()
  const [cat] = await ctx.db.insert(ctx.schema.categories).values({ name: 'Chicharrones' }).returning()
  const [dish] = await ctx.db.insert(ctx.schema.dishes).values({ categoryId: cat.id, name: 'Chicharrón de calamar', price: 35, hasSpiceLevel: false }).returning()
  calamarId = calamar.id
  pescadoId = pescado.id
  dishId = dish.id
})

const lastLog = async (action: string) => {
  const rows = await ctx.db.select().from(ctx.schema.auditLog).where(eq(ctx.schema.auditLog.action, action))
  const row = rows[rows.length - 1]
  return row ? { ...row, data: JSON.parse(row.data!) } : undefined
}

describe('insumos', () => {
  it('el dueño crea insumos; el nombre no se repite (sin distinguir mayúsculas)', async () => {
    const res = await request(ctx.app).post('/api/inventory/supplies').set('Authorization', owner).send({ name: 'Langostino', unit: 'kg', critical: true })
    expect(res.status).toBe(201)
    expect(res.body).toMatchObject({ name: 'Langostino', perishable: true, critical: true, active: true })
    const dup = await request(ctx.app).post('/api/inventory/supplies').set('Authorization', owner).send({ name: 'langostino', unit: 'kg' })
    expect(dup.status).toBe(409)
    expect(dup.body.code).toBe('SUPPLY_EXISTS')
  })

  it('editar un insumo queda auditado; desactivado no aparece en la lista normal', async () => {
    const created = await request(ctx.app).post('/api/inventory/supplies').set('Authorization', owner).send({ name: 'Choclo', unit: 'kg' })
    const res = await request(ctx.app).patch(`/api/inventory/supplies/${created.body.id}`).set('Authorization', owner).send({ active: false })
    expect(res.status).toBe(200)
    expect((await lastLog('supply.update'))?.data).toMatchObject({ before: { name: 'Choclo', active: true }, changes: { active: false } })

    const visible = await request(ctx.app).get('/api/inventory/supplies').set('Authorization', waiter)
    expect(visible.body.some((s: { name: string }) => s.name === 'Choclo')).toBe(false)
    const all = await request(ctx.app).get('/api/inventory/supplies?all=true').set('Authorization', owner)
    expect(all.body.some((s: { name: string }) => s.name === 'Choclo')).toBe(true)

    // No se registran compras de un insumo desactivado
    const buy = await request(ctx.app).post('/api/inventory/purchases').set('Authorization', manager)
      .send({ supplyId: created.body.id, quantity: 2, totalCost: 10 })
    expect(buy.status).toBe(409)
    expect(buy.body.code).toBe('SUPPLY_INACTIVE')
  })
})

describe('compras', () => {
  it('valida cantidad > 0, costo ≥ 0 y fecha no futura', async () => {
    const send = (body: object) => request(ctx.app).post('/api/inventory/purchases').set('Authorization', manager).send(body)
    expect((await send({ supplyId: calamarId, quantity: 0, totalCost: 10 })).status).toBe(400)
    expect((await send({ supplyId: calamarId, quantity: 2, totalCost: -1 })).status).toBe(400)
    expect((await send({ supplyId: calamarId, quantity: 2, totalCost: 10, purchasedAt: '2099-01-01' })).status).toBe(400)
    expect((await send({ supplyId: calamarId, quantity: 2, totalCost: 10, purchasedAt: '2026-02-30' })).status).toBe(400)
    expect((await send({ supplyId: 99999, quantity: 2, totalCost: 10 })).status).toBe(404)

    const ok = await send({ supplyId: calamarId, quantity: 3.5, totalCost: 87.5 })
    expect(ok.status).toBe(201)
    expect(ok.body).toMatchObject({ quantity: 3.5, totalCost: 87.5, purchasedAt: today })
  })

  it('corregir exige motivo y deja el valor anterior en audit_log', async () => {
    const created = await request(ctx.app).post('/api/inventory/purchases').set('Authorization', manager)
      .send({ supplyId: pescadoId, quantity: 5, totalCost: 150 })
    const id = created.body.id
    expect((await request(ctx.app).patch(`/api/inventory/purchases/${id}`).set('Authorization', manager).send({ totalCost: 140 })).status).toBe(400)

    const ok = await request(ctx.app).patch(`/api/inventory/purchases/${id}`).set('Authorization', manager)
      .send({ totalCost: 140, reason: 'precio mal digitado' })
    expect(ok.status).toBe(200)
    expect((await lastLog('purchase.update'))?.data).toMatchObject({ reason: 'precio mal digitado', before: { totalCost: 150 }, after: { totalCost: 140 } })
  })

  it('borrar exige motivo y conserva la compra completa en audit_log', async () => {
    const created = await request(ctx.app).post('/api/inventory/purchases').set('Authorization', owner)
      .send({ supplyId: pescadoId, quantity: 1, totalCost: 30, notes: 'duplicada' })
    const id = created.body.id
    expect((await request(ctx.app).delete(`/api/inventory/purchases/${id}`).set('Authorization', owner).send({})).status).toBe(400)
    const res = await request(ctx.app).delete(`/api/inventory/purchases/${id}`).set('Authorization', owner).send({ reason: 'registrada dos veces' })
    expect(res.status).toBe(200)
    expect((await lastLog('purchase.delete'))?.data).toMatchObject({ reason: 'registrada dos veces', before: { quantity: 1, totalCost: 30 } })

    const list = await request(ctx.app).get(`/api/inventory/purchases?from=${today}&to=${today}`).set('Authorization', owner)
    expect(list.body.some((p: { id: number }) => p.id === id)).toBe(false)
    expect(list.body[0]).toHaveProperty('supplyName')
  })
})

describe('merma', () => {
  it('registra con causa; corregir y borrar exigen motivo y quedan auditados', async () => {
    const bad = await request(ctx.app).post('/api/inventory/waste').set('Authorization', manager)
      .send({ supplyId: calamarId, quantity: 0.5, reason: 'se_cayo' })
    expect(bad.status).toBe(400)

    const created = await request(ctx.app).post('/api/inventory/waste').set('Authorization', manager)
      .send({ supplyId: calamarId, quantity: 0.5, reason: 'deterioro' })
    expect(created.status).toBe(201)
    const id = created.body.id

    // `reason` es la causa de la merma; el motivo de la corrección va aparte
    expect((await request(ctx.app).patch(`/api/inventory/waste/${id}`).set('Authorization', manager).send({ quantity: 0.4 })).status).toBe(400)
    const upd = await request(ctx.app).patch(`/api/inventory/waste/${id}`).set('Authorization', manager)
      .send({ quantity: 0.4, reason: 'preparacion', correctionReason: 'pesé mal' })
    expect(upd.status).toBe(200)
    expect(upd.body).toMatchObject({ quantity: 0.4, reason: 'preparacion' })
    expect((await lastLog('waste.update'))?.data).toMatchObject({ reason: 'pesé mal', before: { quantity: 0.5, reason: 'deterioro' } })

    expect((await request(ctx.app).delete(`/api/inventory/waste/${id}`).set('Authorization', manager).send({ reason: 'no era merma' })).status).toBe(200)
    expect((await lastLog('waste.delete'))?.data).toMatchObject({ reason: 'no era merma', before: { quantity: 0.4 } })
  })
})

describe('conteo de cierre', () => {
  const day = '2026-01-15'

  it('el upsert del mismo día reemplaza, no duplica, y audita la corrección', async () => {
    const first = await request(ctx.app).put(`/api/inventory/counts/${day}`).set('Authorization', manager)
      .send({ items: [{ supplyId: calamarId, quantity: 2 }, { supplyId: pescadoId, quantity: 0 }] })
    expect(first.status).toBe(200)
    expect(first.body).toHaveLength(2)

    const again = await request(ctx.app).put(`/api/inventory/counts/${day}`).set('Authorization', owner)
      .send({ items: [{ supplyId: calamarId, quantity: 1.5 }] })
    expect(again.status).toBe(200)

    const rows = await ctx.db.select().from(ctx.schema.supplyCounts).where(eq(ctx.schema.supplyCounts.countedOn, day))
    expect(rows).toHaveLength(2)
    expect(rows.find(r => r.supplyId === calamarId)?.quantity).toBe(1.5)
    expect(rows.find(r => r.supplyId === pescadoId)?.quantity).toBe(0)
    expect((await lastLog('count.update'))?.data).toMatchObject({ supplyId: calamarId, name: 'Calamar', date: day, before: 2, after: 1.5 })

    const get = await request(ctx.app).get(`/api/inventory/counts?date=${day}`).set('Authorization', manager)
    expect(get.body.map((r: { supplyName: string }) => r.supplyName).sort()).toEqual(['Calamar', 'Pescado'])
  })

  it('rechaza días futuros, fechas inválidas, cantidades negativas e insumos repetidos', async () => {
    const put = (date: string, items: object[]) => request(ctx.app).put(`/api/inventory/counts/${date}`).set('Authorization', manager).send({ items })
    expect((await put('2099-01-01', [{ supplyId: calamarId, quantity: 1 }])).status).toBe(400)
    expect((await put('ayer', [{ supplyId: calamarId, quantity: 1 }])).status).toBe(400)
    expect((await put(day, [{ supplyId: calamarId, quantity: -1 }])).status).toBe(400)
    expect((await put(day, [{ supplyId: calamarId, quantity: 1 }, { supplyId: calamarId, quantity: 2 }])).status).toBe(400)
    expect((await put(day, [])).status).toBe(400)
  })
})

describe('ventas perdidas ("No había")', () => {
  it('un mozo puede registrar pero no listar', async () => {
    const res = await request(ctx.app).post('/api/inventory/lost-sales').set('Authorization', waiter).send({ dishId })
    expect(res.status).toBe(201)
    expect(res.body).toMatchObject({ dishId, quantity: 1 })
    expect((await request(ctx.app).get('/api/inventory/lost-sales').set('Authorization', waiter)).status).toBe(403)

    const list = await request(ctx.app).get('/api/inventory/lost-sales').set('Authorization', manager)
    expect(list.status).toBe(200)
    expect(list.body[0]).toMatchObject({ dishName: 'Chicharrón de calamar' })
  })

  it('exige plato o insumo existentes', async () => {
    expect((await request(ctx.app).post('/api/inventory/lost-sales').set('Authorization', waiter).send({})).status).toBe(400)
    expect((await request(ctx.app).post('/api/inventory/lost-sales').set('Authorization', waiter).send({ dishId: 99999 })).status).toBe(404)
    expect((await request(ctx.app).post('/api/inventory/lost-sales').set('Authorization', waiter).send({ supplyId: calamarId, quantity: 2 })).status).toBe(201)
  })
})

describe('export CSV', () => {
  it('respeta el rango de fechas LOCAL (no el día UTC)', async () => {
    // Último minuto del 1 de marzo y primer minuto del 2 de marzo en hora local.
    // En Lima el primero ya es 2 de marzo en UTC: un filtro por día UTC fallaría.
    const lateMarch1 = localDayEnd(new Date(2026, 2, 1))
    const earlyMarch2 = localDayStart(new Date(2026, 2, 2))
    await ctx.db.insert(ctx.schema.lostSales).values([
      { dishId, quantity: 3, occurredAt: lateMarch1 },
      { dishId, quantity: 4, occurredAt: earlyMarch2 },
    ])
    const res = await request(ctx.app).get('/api/inventory/export?table=lost_sales&from=2026-03-01&to=2026-03-01').set('Authorization', manager)
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toContain('text/csv')
    expect(res.headers['content-disposition']).toContain('maui-lost_sales-2026-03-01_2026-03-01.csv')
    const lines = res.text.replace(/^﻿/, '').trim().split('\r\n')
    expect(lines).toHaveLength(2)
    expect(lines[1]).toContain('2026-03-01,23:59')
    expect(lines[1]).toContain(',3,')
  })

  it('compras con costo unitario y notas escapadas (comas y fórmulas)', async () => {
    await ctx.db.insert(ctx.schema.supplyPurchases).values({
      supplyId: pescadoId, quantity: 4, totalCost: 50, purchasedAt: '2026-03-05', notes: '=HYPERLINK("x"), proveedor',
    })
    const res = await request(ctx.app).get('/api/inventory/export?table=purchases&from=2026-03-05&to=2026-03-05').set('Authorization', owner)
    const lines = res.text.replace(/^﻿/, '').trim().split('\r\n')
    expect(lines[0]).toBe('id,fecha,insumo_id,insumo,unidad,cantidad,costo_total,costo_unitario,notas,registrado_por')
    expect(lines).toHaveLength(2)
    expect(lines[1]).toContain('2026-03-05')
    expect(lines[1]).toContain(',4,50,12.5,')
    expect(lines[1]).toContain(`"'=HYPERLINK(""x""), proveedor"`)
  })

  it('quiebres desde audit_log (dish.availability) y validación de tabla y rango', async () => {
    await request(ctx.app).patch(`/api/menu/dishes/${dishId}/availability`).set('Authorization', manager).send({ available: false })
    const res = await request(ctx.app).get(`/api/inventory/export?table=stockouts&from=${today}&to=${today}`).set('Authorization', manager)
    expect(res.text).toContain('Chicharrón de calamar,agotado')

    expect((await request(ctx.app).get('/api/inventory/export?table=users').set('Authorization', owner)).status).toBe(400)
    expect((await request(ctx.app).get('/api/inventory/export?table=waste&from=2026-03-10&to=2026-03-01').set('Authorization', owner)).status).toBe(400)
  })
})
