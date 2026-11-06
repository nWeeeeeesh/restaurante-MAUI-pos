import { describe, it, expect, beforeAll } from 'vitest'
import request from 'supertest'
import { sql } from 'drizzle-orm'
import { setupHttpApp } from './helpers/http'
import { loadSim, readSim, limaToUtc } from './helpers/sim'

// Cargador de los datos simulados (plan-sistema T6): lo que entra a la base debe ser
// exactamente lo que generó scripts/tesis/simulador.py, y el export de la tesis debe
// leerlo igual que si se hubiera registrado desde la app.
let ctx: Awaited<ReturnType<typeof setupHttpApp>>
let loaded: Awaited<ReturnType<typeof loadSim>>
let manager: string
const FROM = '2026-06-16'
const TO = '2026-09-08'

beforeAll(async () => {
  ctx = await setupHttpApp()
  loaded = await loadSim(ctx.db)
  manager = (await ctx.as('manager', 'Revisora')).auth
}, 60_000)

async function count(table: string) {
  const r = await ctx.db.all<{ n: number }>(sql.raw(`SELECT COUNT(*) AS n FROM ${table}`))
  return Number(r[0].n)
}

async function exportRows(table: string) {
  const res = await request(ctx.app).get(`/api/inventory/export?table=${table}&from=${FROM}&to=${TO}`).set('Authorization', manager)
  expect(res.status).toBe(200)
  const lines = res.text.replace(/^﻿/, '').trimEnd().split('\r\n').slice(1)
  const [header, ...rows] = lines
  const cols = header.split(',')
  return rows.map(l => Object.fromEntries(l.split(',').map((v, k) => [cols[k], v])))
}

describe('[T6] datos simulados sim12', () => {
  it('carga una fila por cada fila de los CSV', async () => {
    const ventas = readSim('ventas_items')
    expect(await count('dishes')).toBe(readSim('carta').length)
    expect(await count('supplies')).toBe(readSim('insumos').length)
    expect(await count('recipe_items')).toBe(readSim('recetas').length)
    expect(await count('bills')).toBe(new Set(ventas.map(v => v.boleta)).size)
    expect(await count('order_items')).toBe(ventas.length)
    expect(await count('supply_purchases')).toBe(readSim('purchases').length)
    expect(await count('supply_waste')).toBe(readSim('waste').length)
    expect(await count('supply_counts')).toBe(readSim('counts').length)
    expect(await count('lost_sales')).toBe(readSim('lost_sales').length)
    expect(await count('day_notes')).toBe(readSim('day_notes').length)
    expect(await count('other_supply_costs')).toBe(readSim('other_costs').length)
    expect(await count('expenses')).toBe(readSim('gastos').length)
    expect(await count(`audit_log WHERE action = 'dish.availability'`)).toBe(2 * readSim('stockouts').length)
    expect(loaded.counts.orderItems).toBe(ventas.length)
  })

  it('las boletas suman las ventas del simulador, en su día local', async () => {
    const ventas = readSim('ventas_items')
    const total = ventas.reduce((t, v) => t + Number(v.cantidad) * Number(v.precio), 0)
    const [bills] = await ctx.db.all<{ s: number }>(sql`SELECT SUM(total) AS s FROM bills`)
    expect(Number(bills.s)).toBeCloseTo(total, 6)
    const [items] = await ctx.db.all<{ s: number }>(sql`SELECT SUM(unit_price * quantity) AS s FROM order_items WHERE bill_id IS NOT NULL`)
    expect(Number(items.s)).toBeCloseTo(total, 6)
    // Ninguna boleta cae fuera del día local de sus ítems (Lima, UTC−5)
    const first = ventas[0]
    expect(limaToUtc(first.fecha, first.hora)).toBe(`${first.fecha} ${String(Number(first.hora.slice(0, 2)) + 5).padStart(2, '0')}${first.hora.slice(2)}`)
    const exported = await exportRows('sales')
    expect(exported.length).toBe(ventas.length)
    const byDay = (rows: Record<string, string>[], amount: (r: Record<string, string>) => number) => {
      const m = new Map<string, number>()
      for (const r of rows) m.set(r.fecha, (m.get(r.fecha) ?? 0) + amount(r))
      return m
    }
    const expected = byDay(ventas, r => Number(r.cantidad) * Number(r.precio))
    const got = byDay(exported, r => Number(r.total))
    expect([...got.keys()].sort()).toEqual([...expected.keys()].sort())
    for (const [day, v] of expected) expect(got.get(day)).toBeCloseTo(v, 6)
  })

  it('el export de la tesis lee compras, conteos y merma con sus fechas y cantidades', async () => {
    const pick = (rows: Record<string, string>[], cols: string[]) => rows.map(r => cols.map(c => (/^-?\d+(\.\d+)?$/.test(r[c]) ? Number(r[c]) : r[c])))
    const purchaseCols = ['fecha', 'insumo_codigo', 'cantidad', 'costo_total', 'origen', 'modo_entrada', 'registrado_por', 'registrado_en']
    expect(pick(await exportRows('purchases'), purchaseCols)).toEqual(pick(readSim('purchases'), purchaseCols))
    const countCols = ['fecha', 'momento', 'insumo_codigo', 'cantidad', 'registrado_en']
    expect(pick(await exportRows('counts'), countCols)).toEqual(pick(readSim('counts'), countCols))
    const wasteCols = ['fecha', 'insumo_codigo', 'cantidad', 'motivo', 'registrado_en']
    expect(pick(await exportRows('waste'), wasteCols)).toEqual(pick(readSim('waste'), wasteCols))
  })

  it('los agotados se reconstruyen desde la auditoría igual que en el simulador', async () => {
    const cols = ['plato', 'inicio', 'fin', 'duracion_min', 'origen', 'marcado_por', 'habilitado_por']
    const key = (r: Record<string, string>) => cols.map(c => r[c]).join('|')
    const got = (await exportRows('stockouts')).map(key).sort()
    const expected = readSim('stockouts').map(key).sort()
    expect(got).toEqual(expected)
  })
})
