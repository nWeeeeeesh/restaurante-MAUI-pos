import { describe, it, expect, beforeAll } from 'vitest'
import { eq, sql } from 'drizzle-orm'
import { createTestDb, type TestDb } from './helpers/db'
import * as schema from '../db/schema'
import { importarRecetas, leerCsv, normalizar } from '../services/recipes-import.service'

// npm run db:recetas (scripts/load-recetas.ts) con un CSV pequeño
const CABECERA = 'categoria,plato,variante,precio,pescado_g,calamar_g,pulpo_g,mixtura_g,limon_g,otros_insumos_S,costo_insumos_S,food_cost_pct'
const CSV = '﻿' + [
  CABECERA,
  'Ceviches,CEVICHE CLASICO DE PESCADO,,18.0,180,0,0,0,150,1.5,4.5,25.0',
  'Leches,Leche de tigre clásica,pescado,12.0,130,0,0,0,120,1.2,3.42,28.5',
  'Leches,Leche de tigre clásica,calamar,13.0,70,60,0,0,120,1.2,2.98,22.9',
  'Leches,Leche de tigre Maui,pescado,13.0,110,0,30,0,120,1.2,4.67,36.0',
  'Leches,Leche de tigre Maui,langostino,14.0,50,60,30,0,120,1.2,4.22,30.2',
  'Rondas,Ronda que no existe,,65.0,400,0,0,250,200,6.0,19.5,30.0',
].join('\r\n') + '\r\n'

let db: TestDb
let ids: Record<string, number>

const items = (dishId: number) => db.select({ variant: schema.recipeItems.variant, supplyId: schema.recipeItems.supplyId, gramsClean: schema.recipeItems.gramsClean })
  .from(schema.recipeItems).where(eq(schema.recipeItems.dishId, dishId)).orderBy(schema.recipeItems.variant, schema.recipeItems.supplyId)
const total = async () => Number((await db.all<{ n: number }>(sql`SELECT COUNT(*) AS n FROM recipe_items`))[0].n)
const audits = () => db.select().from(schema.auditLog).where(eq(schema.auditLog.action, 'recipe.update'))

beforeAll(async () => {
  db = await createTestDb()
  const sup = await db.insert(schema.supplies).values([
    { code: 'PESCADO', name: 'Pescado', unit: 'kg', critical: true, yield: 0.8 },
    { code: 'CALAMAR', name: 'Calamar', unit: 'kg', critical: true },
    { code: 'MIXTURA', name: 'Mixtura', unit: 'kg', critical: true },
    { code: 'LIMON', name: 'Limón', unit: 'kg', critical: true },
    { code: 'PULPO', name: 'Pulpo', unit: 'kg', critical: false },
  ]).returning()
  const [cat] = await db.insert(schema.categories).values({ name: 'Carta' }).returning()
  const ds = await db.insert(schema.dishes).values([
    { categoryId: cat.id, name: 'Ceviche clásico de pescado', price: 18 },
    { categoryId: cat.id, name: 'Leche de tigre clásica', price: 12 },
    { categoryId: cat.id, name: 'Leche de tigre Maui', price: 13 },
  ]).returning()
  for (const d of ds.slice(1)) {
    const [g] = await db.insert(schema.modifierGroups).values({ dishId: d.id, name: 'Base', type: 'preference', required: true }).returning()
    await db.insert(schema.modifierOptions).values([{ groupId: g.id, name: 'Pescado' }, { groupId: g.id, name: 'Calamar' }])
  }
  ids = {
    ...Object.fromEntries(sup.map(s => [s.code!, s.id])),
    ceviche: ds[0].id, clasica: ds[1].id, maui: ds[2].id,
  }
})

describe('[RF08] npm run db:recetas', () => {
  it('lee el CSV con BOM y compara nombres sin mayúsculas ni tildes', () => {
    const filas = leerCsv(CSV)
    expect(filas).toHaveLength(6)
    expect(Object.keys(filas[0])[0]).toBe('categoria')
    expect(normalizar('  CEVICHE  Clásico ')).toBe(normalizar('ceviche clasico'))
  })

  it('--dry-run informa lo que haría y no escribe nada', async () => {
    const r = await importarRecetas(db, CSV, { dryRun: true })
    expect(r.dryRun).toBe(true)
    expect(r.cargados.map(c => c.plato)).toEqual(['Ceviche clásico de pescado', 'Leche de tigre clásica', 'Leche de tigre Maui'])
    expect(await total()).toBe(0)
    expect(await audits()).toHaveLength(0)
  })

  it('crea las recetas con la variante del modificador y solo insumos críticos', async () => {
    const r = await importarRecetas(db, CSV)
    expect(r.cargados).toHaveLength(3)
    expect(await items(ids.ceviche)).toEqual([
      { variant: '', supplyId: ids.PESCADO, gramsClean: 180 },
      { variant: '', supplyId: ids.LIMON, gramsClean: 150 },
    ])
    // La variante queda con el nombre exacto de la opción; los gramos en 0 no se cargan
    expect(await items(ids.clasica)).toEqual([
      { variant: 'Calamar', supplyId: ids.PESCADO, gramsClean: 70 },
      { variant: 'Calamar', supplyId: ids.CALAMAR, gramsClean: 60 },
      { variant: 'Calamar', supplyId: ids.LIMON, gramsClean: 120 },
      { variant: 'Pescado', supplyId: ids.PESCADO, gramsClean: 130 },
      { variant: 'Pescado', supplyId: ids.LIMON, gramsClean: 120 },
    ])
    // PULPO no es crítico: se omite, igual que en PUT /api/recipes/:dishId
    expect((await items(ids.maui)).map(i => i.supplyId)).not.toContain(ids.PULPO)
    expect(r.insumosOmitidos).toEqual([{ codigo: 'PULPO', motivo: 'no_critico', valores: 2 }])
    expect(r.otrosInsumosSinCargar).toBe(6)
    // Misma auditoría que el endpoint, sin usuario
    const a = await audits()
    expect(a).toHaveLength(3)
    expect(a[0].userId).toBeNull()
    expect(JSON.parse(a[0].data!)).toMatchObject({ name: 'Ceviche clásico de pescado', before: [], source: 'db:recetas' })
  })

  it('lista los platos y las variantes que no encontró, sin crearlos', async () => {
    const r = await importarRecetas(db, CSV, { dryRun: true })
    expect(r.noEncontrados).toEqual([
      'Ronda que no existe',
      'Leche de tigre Maui (langostino) — el plato no tiene la opción «langostino»',
    ])
    const platos = await db.select().from(schema.dishes)
    expect(platos).toHaveLength(3)
  })

  it('sin --reemplazar no toca un plato que ya tiene receta ni duplica filas', async () => {
    const antes = await total()
    const r = await importarRecetas(db, CSV)
    expect(r.cargados).toHaveLength(0)
    expect(r.conReceta).toEqual(['Ceviche clásico de pescado', 'Leche de tigre clásica', 'Leche de tigre Maui'])
    expect(await total()).toBe(antes)
    expect(await audits()).toHaveLength(3)
  })

  it('--reemplazar sobrescribe la receta completa del plato y lo audita', async () => {
    const cambiado = [CABECERA, 'Ceviches,Ceviche clásico de pescado,,18.0,200,0,0,0,0,1.5,4.5,25.0'].join('\n')
    const r = await importarRecetas(db, cambiado, { reemplazar: true })
    expect(r.cargados).toEqual([{ dishId: ids.ceviche, plato: 'Ceviche clásico de pescado', variantes: [''], items: 1, reemplazado: true }])
    expect(await items(ids.ceviche)).toEqual([{ variant: '', supplyId: ids.PESCADO, gramsClean: 200 }])
    expect((await items(ids.clasica)).length).toBe(5)
    const a = await audits()
    expect(a).toHaveLength(4)
    expect(JSON.parse(a[3].data!).before).toHaveLength(2)
  })

  it('una fila con gramos inválidos se informa y no se carga', async () => {
    const malo = [CABECERA, 'Ceviches,Ceviche clásico de pescado,,18.0,abc,0,0,0,0,1.5,4.5,25.0'].join('\n')
    const r = await importarRecetas(db, malo, { reemplazar: true, dryRun: true })
    expect(r.cargados).toHaveLength(0)
    expect(r.errores[0]).toMatch(/Línea 2: «pescado_g» = «abc»/)
  })
})
