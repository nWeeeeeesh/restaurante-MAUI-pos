import { describe, it, expect, beforeAll } from 'vitest'
import request from 'supertest'
import { eq, sql } from 'drizzle-orm'
import { setupHttpApp } from './helpers/http'
import { loadSim } from './helpers/sim'

// API del incremento 2 (plan-sistema T10) sobre los datos simulados
let ctx: Awaited<ReturnType<typeof setupHttpApp>>
let owner: string
let sim: Awaited<ReturnType<typeof loadSim>>
const FROM = '2026-07-01'
const TO = '2026-07-31'

beforeAll(async () => {
  ctx = await setupHttpApp()
  sim = await loadSim(ctx.db)
  owner = (await ctx.as('owner', 'Dueño API')).auth
}, 60_000)

const audits = async (action: string) =>
  Number((await ctx.db.all<{ n: number }>(sql`SELECT COUNT(*) AS n FROM audit_log WHERE action = ${action}`))[0].n)

describe('GET /api/profitability', () => {
  it('responde la rentabilidad del periodo con su serie', async () => {
    const res = await request(ctx.app).get(`/api/profitability?from=${FROM}&to=${TO}&groupBy=week`).set('Authorization', owner)
    expect(res.status).toBe(200)
    expect(res.body.period).toMatchObject({ from: FROM, to: TO, groupBy: 'week', localId: 1 })
    expect(res.body.totals.sales).toBeGreaterThan(0)
    expect(res.body.series.length).toBe(5)
    expect(res.body.supplies.map((s: { code: string }) => s.code)).toEqual(['PESCADO', 'CALAMAR', 'MIXTURA', 'LIMON'])
    expect(res.body.dishes.length).toBe(51)
  })

  it('por defecto agrupa por mes', async () => {
    const res = await request(ctx.app).get(`/api/profitability?from=${FROM}&to=${TO}`).set('Authorization', owner)
    expect(res.status).toBe(200)
    expect(res.body.series).toHaveLength(1)
  })

  it('valida el periodo: orden, máximo de 366 días y agrupación', async () => {
    for (const q of ['from=2026-07-31&to=2026-07-01', 'from=2025-01-01&to=2026-07-01', `from=${FROM}&to=${TO}&groupBy=year`, 'from=2026-02-30&to=2026-03-01', 'to=2026-07-01']) {
      const res = await request(ctx.app).get(`/api/profitability?${q}`).set('Authorization', owner)
      expect(res.status, q).toBe(400)
    }
  })
})

describe('[PI-08][RF08] recetas', () => {
  it('reemplaza la receta de un plato, la convierte a la unidad de compra y audita', async () => {
    const dishId = sim.dishId.get('Ceviche clásico de pescado')!
    const pescado = sim.supplyId.get('PESCADO')!
    const limon = sim.supplyId.get('LIMON')!
    const res = await request(ctx.app).put(`/api/recipes/${dishId}`).set('Authorization', owner)
      .send([{ supplyId: pescado, gramsClean: 180 }, { supplyId: limon, gramsClean: 100 }, { variant: 'Calamar', supplyId: pescado, gramsClean: 90 }])
    expect(res.status).toBe(200)
    expect(res.body.map((r: { variant: string; supplyId: number; gramsClean: number }) => [r.variant, r.supplyId, r.gramsClean]))
      .toEqual([['', pescado, 180], ['', limon, 100], ['Calamar', pescado, 90]])
    const list = await request(ctx.app).get('/api/recipes').set('Authorization', owner)
    expect(list.status).toBe(200)
    const dish = list.body.dishes.find((d: { dishId: number }) => d.dishId === dishId)
    const fish = dish.items.find((i: { variant: string; supplyId: number }) => i.variant === '' && i.supplyId === pescado)
    expect(fish.kgPerPortion).toBeCloseTo(0.225, 6) // 180 g limpios, rendimiento 0.80 (PU-17)
    expect(list.body.supplies.map((s: { code: string }) => s.code)).toEqual(['PESCADO', 'CALAMAR', 'MIXTURA', 'LIMON'])
    expect(await audits('recipe.update')).toBe(1)
  })

  it('rechaza insumos no críticos, repetidos, gramos inválidos y platos inexistentes', async () => {
    const dishId = sim.dishId.get('Ceviche clásico de pescado')!
    const pulpo = sim.supplyId.get('PULPO')!
    const pescado = sim.supplyId.get('PESCADO')!
    const notCritical = await request(ctx.app).put(`/api/recipes/${dishId}`).set('Authorization', owner).send([{ supplyId: pulpo, gramsClean: 30 }])
    expect(notCritical.status).toBe(400)
    expect(notCritical.body.code).toBe('SUPPLY_NOT_CRITICAL')
    const dup = await request(ctx.app).put(`/api/recipes/${dishId}`).set('Authorization', owner)
      .send([{ supplyId: pescado, gramsClean: 30 }, { supplyId: pescado, gramsClean: 40 }])
    expect(dup.status).toBe(400)
    const zero = await request(ctx.app).put(`/api/recipes/${dishId}`).set('Authorization', owner).send([{ supplyId: pescado, gramsClean: 0 }])
    expect(zero.status).toBe(400)
    const missing = await request(ctx.app).put('/api/recipes/99999').set('Authorization', owner).send([])
    expect(missing.status).toBe(404)
    expect(await audits('recipe.update')).toBe(1)
  })

  it('[RF09] calibra con un periodo y deja el factor vigente en la lista de recetas', async () => {
    const res = await request(ctx.app).post('/api/recipes/calibrate').set('Authorization', owner).send({ from: '2026-06-16', to: '2026-07-12' })
    expect(res.status).toBe(200)
    expect(res.body.factors).toHaveLength(4)
    const pescado = res.body.factors.find((f: { code: string }) => f.code === 'PESCADO')
    expect(pescado.factor).toBeCloseTo(1.04, 2)
    expect(pescado.outOfRange).toBe(false)
    const list = await request(ctx.app).get('/api/recipes').set('Authorization', owner)
    expect(list.body.supplies[0].factor).toMatchObject({ from: '2026-06-16', to: '2026-07-12', outOfRange: false })
    expect((await request(ctx.app).post('/api/recipes/calibrate').set('Authorization', owner).send({ from: '2026-07-12', to: '2026-06-16' })).status).toBe(400)
  })
})

describe('PATCH /api/inventory/supplies/:id (rendimiento, vida útil, nivel de servicio)', () => {
  it('guarda los parámetros y valida sus rangos', async () => {
    const id = sim.supplyId.get('CALAMAR')!
    const ok = await request(ctx.app).patch(`/api/inventory/supplies/${id}`).set('Authorization', owner)
      .send({ yield: 0.9, shelfLifeDays: 5, serviceLevel: 0.95 })
    expect(ok.status).toBe(200)
    expect(ok.body).toMatchObject({ yield: 0.9, shelfLifeDays: 5, serviceLevel: 0.95 })
    for (const bad of [{ yield: 1.2 }, { yield: 0 }, { shelfLifeDays: 0 }, { serviceLevel: 1 }, { serviceLevel: 0.3 }]) {
      const res = await request(ctx.app).patch(`/api/inventory/supplies/${id}`).set('Authorization', owner).send(bad)
      expect(res.status, JSON.stringify(bad)).toBe(400)
    }
    const cleared = await request(ctx.app).patch(`/api/inventory/supplies/${id}`).set('Authorization', owner).send({ shelfLifeDays: null })
    expect(cleared.body.shelfLifeDays).toBeNull()
  })
})

describe('[PI-06][RF06] tipo de cada categoría de gasto', () => {
  it('lista las categorías con su tipo y el cambio se refleja en las ventas de equilibrio', async () => {
    const list = await request(ctx.app).get('/api/reports/expense-categories').set('Authorization', owner)
    expect(list.status).toBe(200)
    const byCat = Object.fromEntries(list.body.map((c: { category: string; kind: string }) => [c.category, c.kind]))
    expect(byCat).toMatchObject({ alquiler: 'fijo', sueldos: 'fijo', gas: 'variable', descartables: 'variable' })

    const before = await request(ctx.app).get(`/api/profitability?from=${FROM}&to=${TO}`).set('Authorization', owner)
    expect(before.body.totals.fixedExpenses).toBeCloseTo(12800, 2)
    const put = await request(ctx.app).put('/api/reports/expense-categories/luz').set('Authorization', owner).send({ kind: 'variable' })
    expect(put.status).toBe(200)
    expect(put.body).toMatchObject({ category: 'luz', kind: 'variable' })
    const after = await request(ctx.app).get(`/api/profitability?from=${FROM}&to=${TO}`).set('Authorization', owner)
    expect(after.body.totals.fixedExpenses).toBeCloseTo(12300, 2)
    expect(after.body.totals.expenses).toBeCloseTo(before.body.totals.expenses, 2)
    expect(after.body.totals.breakEvenSales).toBeLessThan(before.body.totals.breakEvenSales)
    expect(await audits('expense_category.update')).toBe(1)

    const bad = await request(ctx.app).put('/api/reports/expense-categories/luz').set('Authorization', owner).send({ kind: 'mixto' })
    expect(bad.status).toBe(400)
    const [row] = await ctx.db.select().from(ctx.schema.expenseCategories).where(eq(ctx.schema.expenseCategories.category, 'luz'))
    expect(row.kind).toBe('variable')
  })
})
