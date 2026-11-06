import { describe, it, expect, beforeAll } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import { sql } from 'drizzle-orm'
import { setupHttpApp } from './helpers/http'
import { loadSim, SIM12_DIR } from './helpers/sim'

// Paridad del incremento 2 con la referencia en Python (scripts/tesis/referencia.py):
// con los 72 días simulados cargados, el servidor debe dar lo mismo que esperado.json.
type Periodo = {
  desde: string; hasta: string; V: number; CV: number; O: number; G: number; GF: number; UB: number; UO: number
  food_cost: number | null; Veq: number | null; merma_kg: number; merma_soles: number
}
const esperado = JSON.parse(fs.readFileSync(path.join(SIM12_DIR, 'esperado.json'), 'utf-8')) as {
  meta: { periodo: [string, string]; calibracion: [string, string] }
  factores: Record<string, number>
  total: Periodo
  semanas: Periodo[]
  meses: Periodo[]
  platos: Record<string, { costo: number; MC: number; porciones: number; categoria: string | null; sin_receta: boolean }>
}
const [FROM, TO] = esperado.meta.periodo

let ctx: Awaited<ReturnType<typeof setupHttpApp>>
let svc: typeof import('../services/profitability.service')
let calibracion: Awaited<ReturnType<typeof svc.calibrar>>
let ownerId: number

beforeAll(async () => {
  ctx = await setupHttpApp()
  await loadSim(ctx.db)
  svc = await import('../services/profitability.service')
  ownerId = (await ctx.as('owner', 'Dueño prueba')).user.id
  const [from, to] = esperado.meta.calibracion
  calibracion = await svc.calibrar(ctx.db, { localId: 1, from, to }, ownerId)
}, 60_000)

const S = 0.01 // tolerancia en soles

function cerca(got: number | null, want: number | null, tol = S) {
  if (want === null) return expect(got).toBeNull()
  expect(got).not.toBeNull()
  expect(Math.abs(got! - want)).toBeLessThanOrEqual(tol)
}

function compararPeriodo(got: Awaited<ReturnType<typeof svc.obtenerRentabilidad>>['totals'], want: Periodo) {
  expect([got.from, got.to]).toEqual([want.desde, want.hasta])
  cerca(got.sales, want.V)
  cerca(got.cogs, want.CV)
  cerca(got.otherSupplies, want.O)
  cerca(got.expenses, want.G)
  cerca(got.fixedExpenses, want.GF)
  cerca(got.grossProfit, want.UB)
  cerca(got.operatingProfit, want.UO)
  cerca(got.foodCostPct, want.food_cost)
  cerca(got.breakEvenSales, want.Veq)
  cerca(got.waste.kg, want.merma_kg, 0.001)
  cerca(got.waste.cost, want.merma_soles)
}

describe('[PP-01][RF12] rentabilidad con sim12 frente a la referencia', () => {
  it('[RF09] los factores de las semanas 1 a 4 coinciden y quedan vigentes', async () => {
    for (const f of calibracion.factors) cerca(f.factor, esperado.factores[f.code], 0.0001)
    expect(calibracion.factors.map(f => f.code).sort()).toEqual(Object.keys(esperado.factores).sort())
    const rows = await ctx.db.select().from(ctx.schema.recipeCalibrations)
    expect(rows).toHaveLength(4)
    const [audit] = await ctx.db.all<{ n: number }>(sql`SELECT COUNT(*) AS n FROM audit_log WHERE action = 'recipe.calibrate'`)
    expect(Number(audit.n)).toBe(1)
  })

  it('rentabilidad por semana', async () => {
    const res = await svc.obtenerRentabilidad(ctx.db, { localId: 1, from: FROM, to: TO, groupBy: 'week' })
    expect(res.series).toHaveLength(esperado.semanas.length)
    res.series.forEach((s, k) => compararPeriodo(s, esperado.semanas[k]))
    compararPeriodo(res.totals, esperado.total)
  })

  it('rentabilidad por mes', async () => {
    const res = await svc.obtenerRentabilidad(ctx.db, { localId: 1, from: FROM, to: TO, groupBy: 'month' })
    expect(res.series).toHaveLength(esperado.meses.length)
    res.series.forEach((s, k) => compararPeriodo(s, esperado.meses[k]))
  })

  it('[RF11][RF13] costo, margen y categoría de cada plato', async () => {
    const res = await svc.obtenerRentabilidad(ctx.db, { localId: 1, from: FROM, to: TO, groupBy: 'month' })
    expect(res.dishes).toHaveLength(Object.keys(esperado.platos).length)
    for (const d of res.dishes) {
      const want = esperado.platos[d.name]
      expect(want, d.name).toBeDefined()
      expect(d.portions).toBe(want.porciones)
      cerca(d.cost, want.costo)
      cerca(d.margin, want.MC)
      expect(d.category).toBe(want.categoria)
      expect(d.noRecipe).toBe(want.sin_receta)
    }
  })
})

describe('[PI-09][RF14] rentabilidad: los totales salen de los registros', () => {
  it('ventas, otros insumos y merma suman lo registrado; la serie suma el total', async () => {
    const from = '2026-07-01'
    const to = '2026-07-31'
    const res = await svc.obtenerRentabilidad(ctx.db, { localId: 1, from, to, groupBy: 'week' })
    const [v] = await ctx.db.all<{ s: number }>(sql`SELECT SUM(total) AS s FROM bills WHERE date(paid_at, '-5 hours') BETWEEN ${from} AND ${to}`)
    const [o] = await ctx.db.all<{ s: number }>(sql`SELECT SUM(amount) AS s FROM other_supply_costs WHERE date BETWEEN ${from} AND ${to}`)
    const [w] = await ctx.db.all<{ s: number }>(sql`SELECT SUM(quantity) AS s FROM supply_waste WHERE wasted_at BETWEEN ${from} AND ${to}`)
    cerca(res.totals.sales, Number(v.s))
    cerca(res.totals.otherSupplies, Number(o.s))
    cerca(res.totals.waste.kg, Number(w.s), 0.001)
    // Julio completo lleva un mes de gastos: 14 000 en total, 12 800 fijos
    cerca(res.totals.expenses, 14000)
    cerca(res.totals.fixedExpenses, 12800)
    const sum = (k: 'sales' | 'cogs' | 'expenses' | 'operatingProfit') => res.series.reduce((t, s) => t + s[k], 0)
    for (const k of ['sales', 'cogs', 'expenses', 'operatingProfit'] as const) cerca(sum(k), res.totals[k], 0.05)
  })

  it('un plato sin receta no interrumpe el cálculo y queda en las advertencias', async () => {
    const res = await svc.obtenerRentabilidad(ctx.db, { localId: 1, from: FROM, to: TO, groupBy: 'month' })
    const sinReceta = res.warnings.filter(w => w.code === 'NO_RECIPE').map(w => (w as { name: string }).name)
    expect(sinReceta).toContain('Coca Cola 1 L')
    const bebida = res.dishes.find(d => d.name === 'Coca Cola 1 L')!
    expect(bebida.cost).toBeGreaterThan(0) // solo otros insumos
    expect(res.warnings.some(w => w.code === 'MISSING_COUNT')).toBe(true)
    expect(res.warnings.some(w => w.code === 'NOT_CALIBRATED')).toBe(false)
  })

  it('[PU-11] un periodo sin ventas responde sin error y sin food cost', async () => {
    const res = await svc.obtenerRentabilidad(ctx.db, { localId: 1, from: '2026-06-01', to: '2026-06-14', groupBy: 'day' })
    expect(res.totals.sales).toBe(0)
    expect(res.totals.foodCostPct).toBeNull()
    expect(res.totals.breakEvenSales).toBeNull()
  })
})
