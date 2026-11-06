import { describe, it, expect, beforeAll } from 'vitest'
import request from 'supertest'
import * as fs from 'fs'
import * as path from 'path'
import { setupHttpApp } from './helpers/http'
import { EXPORT_TABLES } from '../schemas/inventory'
import { addDays, localDateString, parseDayBoundary } from '../utils/dates'

// Instrumento de la tesis (docs/diccionario-datos-tesis.md, dataset v2, plan-sistema
// T19). Si este test falla porque cambió un encabezado, NO lo "arregles" aquí: un cambio
// exige subir DATASET_VERSION y una versión nueva del diccionario.
const HEADERS: Record<string, string> = {
  daily: 'local_id,fecha,insumo_id,insumo_codigo,insumo,unidad,quedaba,botaste,compraste,precio_unitario,costo_total,proveedor,enviaste,recibiste,modo_quedaba,modo_botaste,modo_compraste,modo_precio,apertura_por,apertura_en,compra_por,compra_en',
  purchases: 'local_id,id,fecha,insumo_id,insumo_codigo,insumo,unidad,cantidad,costo_total,costo_unitario,proveedor,origen,modo_entrada,modo_precio,notas,registrado_por,registrado_en',
  waste: 'local_id,id,fecha,insumo_id,insumo_codigo,insumo,unidad,cantidad,motivo,origen,modo_entrada,notas,registrado_por,registrado_en',
  counts: 'local_id,fecha,momento,insumo_id,insumo_codigo,insumo,unidad,cantidad,modo_entrada,registrado_por,registrado_en',
  lost_sales: 'local_id,id,fecha,hora,plato_id,plato,insumo_id,insumo_codigo,insumo,porciones,registrado_por',
  stockouts: 'local_id,plato_id,plato,inicio,fin,duracion_min,origen,marcado_por,habilitado_por',
  day_notes: 'local_id,id,fecha,tipo,texto,registrado_por,registrado_en',
  supplies: 'id,codigo,nombre,unidad,perecible,critico,activo,orden,rendimiento,vida_util_dias,nivel_servicio',
  daily_parts: 'local_id,id,fecha,parte,registrado_por,registrado_en,duracion_ms,es_correccion,version_cliente,no_compro',
  transfers: 'local_id,id,fecha,insumo_id,insumo_codigo,insumo,unidad,direccion,cantidad,costo_unitario,otro_local_id,origen,modo_entrada,registrado_por,registrado_en',
  other_costs: 'local_id,id,fecha,monto,origen,modo_entrada,registrado_por,registrado_en',
  sales: 'local_id,fecha,hora,boleta_id,plato_id,plato,categoria_id,categoria,cantidad,precio_unitario,total,anulado',
  recipe_items: 'plato_id,plato,variante,insumo_id,insumo_codigo,insumo,gramos_limpios,kg_por_porcion,actualizado_por,actualizado_en',
  recipe_calibrations: 'local_id,id,insumo_id,insumo_codigo,factor,desde,hasta,calculado_por,calculado_en',
  demand_forecasts: 'local_id,id,insumo_id,insumo_codigo,noche,fecha_objetivo,horizonte,metodo,pronostico_kg,sigma_h,version_modelo,creado_en',
  purchase_suggestions: 'local_id,id,fecha,insumo_id,insumo_codigo,cobertura_dias,pronostico_kg,stock_seguridad_kg,disponible_kg,origen_disponible,cantidad_kg,nivel_servicio,version_modelo,registrado_por,registrado_en',
  expense_categories: 'categoria,tipo,actualizado_por,actualizado_en',
  app_settings: 'clave,valor,actualizado_por,actualizado_en',
}

let ctx: Awaited<ReturnType<typeof setupHttpApp>>
let owner: string
let manager: string
let dishId: number
let catId: number
let calamar: number
const today = localDateString()
const TS = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/

beforeAll(async () => {
  ctx = await setupHttpApp()
  owner = (await ctx.as('owner', 'Dueño')).auth
  manager = (await ctx.as('manager', 'Encargada')).auth
  const [s] = await ctx.db.insert(ctx.schema.supplies).values({ name: 'Calamar', code: 'CALAMAR', unit: 'kg', critical: true, sortOrder: 2 }).returning()
  calamar = s.id
  const [cat] = await ctx.db.insert(ctx.schema.categories).values({ name: 'Chicharrones' }).returning()
  catId = cat.id
  const [dish] = await ctx.db.insert(ctx.schema.dishes).values({ categoryId: cat.id, name: 'Chicharrón de calamar', price: 35, hasSpiceLevel: false }).returning()
  dishId = dish.id
})

async function csv(table: string, from = today, to = today) {
  const res = await request(ctx.app).get(`/api/inventory/export?table=${table}&from=${from}&to=${to}`).set('Authorization', manager)
  expect(res.status).toBe(200)
  return res.text.replace(/^﻿/, '').trimEnd().split('\r\n')
}

describe('[PI-07][RF07][RD05] export: encabezados del dataset v2', () => {
  it('las tablas y columnas coinciden con el diccionario v2', () => {
    // Cada tabla del diccionario: un título «### `tabla`» y, en la línea siguiente, sus
    // columnas en orden entre comillas invertidas
    const doc = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'docs', 'diccionario-datos-tesis.md'), 'utf-8').replace(/\r/g, '')
    expect(doc).toMatch(/^# Diccionario de datos de la tesis — v2/)
    const fromDoc: Record<string, string> = {}
    for (const m of doc.matchAll(/^### `([a-z_]+)`[^\n]*\n`([^`]+)`/gm)) fromDoc[m[1]] = m[2].split(',').map(c => c.trim()).join(',')
    expect(fromDoc).toEqual(HEADERS)
    expect(Object.keys(HEADERS).sort()).toEqual([...EXPORT_TABLES].sort())
  })

  it('la tabla del estudio ya no se exporta', async () => {
    const res = await request(ctx.app).get('/api/inventory/export?table=study_config&from=2026-01-01&to=2026-01-31').set('Authorization', manager)
    expect(res.status).toBe(400)
  })

  for (const [table, header] of Object.entries(HEADERS)) {
    it(`${table}: línea de versión y columnas fijas`, async () => {
      const lines = await csv(table, '2026-01-01', '2026-01-31')
      expect(lines[0]).toMatch(new RegExp(`^# maui-tesis dataset v2 · ${table} · desde 2026-01-01 · hasta 2026-01-31 · generado \\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2} America/Lima$`))
      expect(lines[1]).toBe(header)
    })
  }
})

describe('export: contenido', () => {
  it('daily: quedaba, botaste, compra y quién hizo cada parte', async () => {
    await request(ctx.app).post('/api/inventory/daily').set('Authorization', manager).send({
      part: 'apertura', date: today, durationMs: 30000,
      items: [{ supplyId: calamar, opening: 1.5, openingMode: 'typed', wasted: 0.25, wastedMode: 'typed' }],
    })
    await request(ctx.app).post('/api/inventory/daily').set('Authorization', owner).send({
      part: 'compra', date: today, durationMs: 40000,
      items: [{ supplyId: calamar, purchased: 2, purchasedMode: 'copied', unitPrice: 24.5, priceMode: 'copied', supplier: 'Puesto 3' }],
    })
    const [row] = (await csv('daily')).slice(2).map(l => l.split(','))
    expect(row.slice(0, 18)).toEqual(['1', today, String(calamar), 'CALAMAR', 'Calamar', 'kg', '1.5', '0.25', '2', '24.5', '49', 'Puesto 3', '0', '0', 'typed', 'typed', 'copied', 'copied'])
    expect(row[18]).toBe('Encargada')
    expect(row[19]).toMatch(TS)
    expect(row[20]).toBe('Dueño')
    expect(row[21]).toMatch(TS)

    const purchases = await csv('purchases')
    expect(purchases[2]).toMatch(new RegExp(`^1,\\d+,${today},${calamar},CALAMAR,Calamar,kg,2,49,24.5,Puesto 3,daily,copied,copied,,Dueño,${today} \\d{2}:\\d{2}:\\d{2}$`))
    const parts = (await csv('daily_parts')).slice(2)
    expect(parts.map(l => l.split(',').slice(3, 4).concat(l.split(',').slice(6, 8)))).toEqual([['apertura', '30000', '0'], ['compra', '40000', '0']])
  })

  it('stockouts: intervalos con origen; abierto si sigue agotado', async () => {
    const mark = (available: boolean) =>
      request(ctx.app).patch(`/api/menu/dishes/${dishId}/availability`).set('Authorization', manager).send({ available })
    await mark(false)
    await mark(true)
    await mark(false)
    const lines = await csv('stockouts')
    expect(lines).toHaveLength(4)
    const [closed, open] = lines.slice(2).map(l => l.split(','))
    expect(closed).toEqual(['1', String(dishId), 'Chicharrón de calamar', expect.stringMatching(TS), expect.stringMatching(TS), '0', 'manual', 'Encargada', 'Encargada'])
    expect(open.slice(4)).toEqual(['', '', 'manual', 'Encargada', ''])
  })

  it('sales: un ítem cobrado por fila; los no cobrados no son venta; marca anulado si el pedido se canceló', async () => {
    const day = addDays(today, -1)
    const paidAt = parseDayBoundary(day, 'end')
    const [o1] = await ctx.db.insert(ctx.schema.orders).values({ type: 'delivery', status: 'paid', customerName: 'A' }).returning()
    const [b1] = await ctx.db.insert(ctx.schema.bills).values({ orderId: o1.id, subtotal: 70, total: 70, paymentMethod: 'cash', receiptNumber: 'B001-00001', paidAt }).returning()
    await ctx.db.insert(ctx.schema.orderItems).values({ orderId: o1.id, dishId, dishName: 'Chicharrón de calamar', unitPrice: 35, quantity: 2, billId: b1.id })
    // Pedido cancelado después de cobrar una parte: lo cobrado queda marcado; lo demás no es venta
    const [o2] = await ctx.db.insert(ctx.schema.orders).values({ type: 'delivery', status: 'cancelled', customerName: 'B' }).returning()
    const [b2] = await ctx.db.insert(ctx.schema.bills).values({ orderId: o2.id, subtotal: 35, total: 35, paymentMethod: 'yape', receiptNumber: 'B001-00002', paidAt }).returning()
    await ctx.db.insert(ctx.schema.orderItems).values([
      { orderId: o2.id, dishId, dishName: 'Chicharrón de calamar', unitPrice: 35, quantity: 1, billId: b2.id },
      { orderId: o2.id, dishId, dishName: 'Chicharrón de calamar', unitPrice: 35, quantity: 3 },
    ])

    const rows = (await csv('sales', day, day)).slice(2).map(l => l.split(','))
    expect(rows).toHaveLength(2)
    expect(rows[0]).toEqual(['1', day, '23:59', String(b1.id), String(dishId), 'Chicharrón de calamar', String(catId), 'Chicharrones', '2', '35', '70', '0'])
    expect(rows[1]).toEqual(['1', day, '23:59', String(b2.id), String(dishId), 'Chicharrón de calamar', String(catId), 'Chicharrones', '1', '35', '35', '1'])
    // Fuera del rango local
    expect((await csv('sales', today, today)).slice(2)).toHaveLength(0)
  })

  it('supplies, notas y otros insumos', async () => {
    // v2: rendimiento (1 por defecto), vida útil y nivel de servicio (vacíos sin configurar)
    expect((await csv('supplies'))[2]).toBe(`${calamar},CALAMAR,Calamar,kg,1,1,1,2,1,,`)

    await request(ctx.app).post('/api/inventory/daily').set('Authorization', manager).send({
      part: 'apertura', date: today, items: [{ supplyId: calamar, opening: 1.5 }], notes: [{ kind: 'otro', text: 'Inicio de la línea base' }],
    })
    expect((await csv('day_notes'))[2]).toMatch(new RegExp(`^1,\\d+,${today},otro,Inicio de la línea base,Encargada,`))

    await request(ctx.app).post('/api/inventory/daily').set('Authorization', owner)
      .send({ part: 'compra', date: today, items: [], otherCost: { amount: 42.5, mode: 'copied' } })
    expect((await csv('other_costs'))[2]).toMatch(new RegExp(`^1,\\d+,${today},42.5,daily,copied,Dueño,`))
  })
})

describe('export: filtro por día local', () => {
  it('compras fuera del rango no aparecen', async () => {
    const lines = await csv('purchases', addDays(today, -30), addDays(today, -20))
    expect(lines.slice(2)).toHaveLength(0)
  })

  it('la tabla pedida debe existir', async () => {
    expect((await request(ctx.app).get('/api/inventory/export?table=users').set('Authorization', owner)).status).toBe(400)
  })
})
