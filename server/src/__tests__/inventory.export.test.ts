import { describe, it, expect, beforeAll } from 'vitest'
import request from 'supertest'
import { setupHttpApp } from './helpers/http'
import { addDays, localDateString } from '../utils/dates'

// Instrumento congelado de la tesis (docs/diccionario-datos-tesis.md, v1).
// Si este test falla porque cambió un encabezado, NO lo "arregles" aquí: un cambio
// de columnas exige una versión nueva del diccionario y del dataset.
const HEADERS: Record<string, string> = {
  daily: 'local_id,fecha,insumo_id,insumo_codigo,insumo,unidad,quedaba,botaste,compraste,precio_unitario,costo_total,proveedor',
  purchases: 'local_id,id,fecha,insumo_id,insumo_codigo,insumo,unidad,cantidad,costo_total,costo_unitario,proveedor,origen,notas,registrado_por,registrado_en',
  waste: 'local_id,id,fecha,insumo_id,insumo_codigo,insumo,unidad,cantidad,motivo,origen,notas,registrado_por,registrado_en',
  counts: 'local_id,fecha,momento,insumo_id,insumo_codigo,insumo,unidad,cantidad,registrado_por,registrado_en',
  lost_sales: 'local_id,id,fecha,hora,plato_id,plato,insumo_id,insumo_codigo,insumo,porciones,registrado_por',
  stockouts: 'local_id,plato_id,plato,inicio,fin,duracion_min,marcado_por,habilitado_por',
  day_notes: 'local_id,id,fecha,tipo,texto,registrado_por,registrado_en',
  supplies: 'id,codigo,nombre,unidad,perecible,critico,activo,orden',
}

let ctx: Awaited<ReturnType<typeof setupHttpApp>>
let manager: string
let dishId: number
let calamar: number
const today = localDateString()

beforeAll(async () => {
  ctx = await setupHttpApp()
  manager = (await ctx.as('manager', 'Encargada')).auth
  const [s] = await ctx.db.insert(ctx.schema.supplies).values({ name: 'Calamar', code: 'CALAMAR', unit: 'kg', critical: true, sortOrder: 2 }).returning()
  calamar = s.id
  const [cat] = await ctx.db.insert(ctx.schema.categories).values({ name: 'Chicharrones' }).returning()
  const [dish] = await ctx.db.insert(ctx.schema.dishes).values({ categoryId: cat.id, name: 'Chicharrón de calamar', price: 35, hasSpiceLevel: false }).returning()
  dishId = dish.id
})

async function csv(table: string, from = today, to = today) {
  const res = await request(ctx.app).get(`/api/inventory/export?table=${table}&from=${from}&to=${to}`).set('Authorization', manager)
  expect(res.status).toBe(200)
  return res.text.replace(/^﻿/, '').trimEnd().split('\r\n')
}

describe('export: encabezados congelados (v1)', () => {
  for (const [table, header] of Object.entries(HEADERS)) {
    it(`${table}: línea de versión y columnas fijas`, async () => {
      const lines = await csv(table, '2026-01-01', '2026-01-31')
      expect(lines[0]).toMatch(new RegExp(`^# maui-tesis dataset v1 · ${table} · desde 2026-01-01 · hasta 2026-01-31 · generado \\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2} America/Lima$`))
      expect(lines[1]).toBe(header)
    })
  }
})

describe('export: contenido', () => {
  it('daily: una fila por día e insumo con quedaba, botaste, compraste y precio', async () => {
    await request(ctx.app).post('/api/inventory/daily').set('Authorization', manager).send({
      date: today,
      items: [{ supplyId: calamar, opening: 1.5, wasted: 0.25, purchased: 2, unitPrice: 24.5, supplier: 'Puesto 3' }],
    })
    const lines = await csv('daily')
    expect(lines.slice(2)).toEqual([`1,${today},${calamar},CALAMAR,Calamar,kg,1.5,0.25,2,24.5,49,Puesto 3`])

    // En compras y merma queda el origen y la hora local de registro
    const purchases = await csv('purchases')
    expect(purchases[2]).toMatch(new RegExp(`^1,\\d+,${today},${calamar},CALAMAR,Calamar,kg,2,49,24.5,Puesto 3,daily,,Encargada,${today} \\d{2}:\\d{2}:\\d{2}$`))
    const waste = await csv('waste', addDays(today, -1), addDays(today, -1))
    expect(waste[2]).toContain(',0.25,deterioro,daily,')
  })

  it('stockouts: intervalos con inicio, fin y duración; abierto si sigue agotado', async () => {
    const mark = (available: boolean) =>
      request(ctx.app).patch(`/api/menu/dishes/${dishId}/availability`).set('Authorization', manager).send({ available })
    await mark(false)
    await mark(true)
    await mark(false)
    const lines = await csv('stockouts')
    expect(lines).toHaveLength(4)
    const [closed, open] = lines.slice(2).map(l => l.split(','))
    expect(closed).toEqual(['1', String(dishId), 'Chicharrón de calamar', expect.stringMatching(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/), expect.any(String), '0', 'Encargada', 'Encargada'])
    expect(closed[4]).not.toBe('')
    expect(open.slice(4)).toEqual(['', '', 'Encargada', ''])
  })

  it('day_notes y supplies', async () => {
    await request(ctx.app).post('/api/inventory/daily').set('Authorization', manager)
      .send({ date: today, items: [], notes: [{ kind: 'otro', text: 'Inicio de la línea base' }] })
    const notes = await csv('day_notes')
    expect(notes[2]).toMatch(new RegExp(`^1,\\d+,${today},otro,Inicio de la línea base,Encargada,`))
    const sup = await csv('supplies')
    expect(sup[2]).toBe(`${calamar},CALAMAR,Calamar,kg,1,1,1,2`)
  })
})
