import { describe, it, expect } from 'vitest'
import { createClient } from '@libsql/client'
import { drizzle } from 'drizzle-orm/libsql'
import { eq } from 'drizzle-orm'
import { createTestDb, createSchema, tempDbUrl } from './helpers/db'
import * as schema from '../db/schema'
import { orderItems } from '../db/schema'
import { applyStartupMigrations } from '../db/migrate'

// El esquema de tests sale de schema.ts: estas pruebas fallarían con un DDL
// escrito a mano que no refleje FKs ni tablas reales.
describe('esquema de tests', () => {
  it('aplica claves foráneas (order_items.order_id inexistente falla)', async () => {
    const db = await createTestDb()
    await expect(
      db.insert(orderItems).values({ orderId: 9999, dishName: 'X', unitPrice: 1, quantity: 1 }),
    ).rejects.toThrow()
  })

  it('las migraciones de arranque activan WAL (M5)', async () => {
    const db = await createTestDb()
    const [row] = await db.all<{ journal_mode: string }>('PRAGMA journal_mode' as any)
    expect(row.journal_mode).toBe('wal')
  })

  it('crea las tablas de menú y plano', async () => {
    const db = await createTestDb()
    const rows = await db.all<{ name: string }>(
      `SELECT name FROM sqlite_master WHERE type = 'table'` as any,
    )
    const names = rows.map(r => r.name)
    for (const t of ['modifier_groups', 'modifier_options', 'layout_items', 'expenses']) {
      expect(names).toContain(t)
    }
  })

  // Producción no usa db:push: las tablas del inventario y dishes.archived
  // tienen que aparecer con migrate.ts sobre una BD de la versión anterior.
  it('migra una BD anterior al inventario sin perder datos', async () => {
    const client = createClient({ url: tempDbUrl() })
    await createSchema(client)
    for (const t of ['day_notes', 'lost_sales', 'supply_counts', 'supply_waste', 'supply_purchases', 'supplies']) {
      await client.execute(`DROP TABLE ${t}`)
    }
    await client.execute('ALTER TABLE dishes DROP COLUMN archived')
    await client.execute(`INSERT INTO dishes (name, price, available) VALUES ('Ceviche', 28, 0)`)

    await applyStartupMigrations(client)
    await applyStartupMigrations(client) // idempotente

    const db = drizzle(client, { schema })
    const [dish] = await db.select().from(schema.dishes)
    expect(dish).toMatchObject({ name: 'Ceviche', available: false, archived: false })

    const [supply] = await db.insert(schema.supplies).values({ name: 'Calamar', unit: 'kg' }).returning()
    expect(supply).toMatchObject({ perishable: true, critical: false, active: true })
    await db.insert(schema.supplyCounts).values({ supplyId: supply.id, quantity: 1, countedOn: '2026-01-01' })
    await expect(db.insert(schema.supplyCounts).values({ supplyId: supply.id, quantity: 2, countedOn: '2026-01-01' })).rejects.toThrow()
    // Apertura y cierre del mismo día son conteos distintos
    await db.insert(schema.supplyCounts).values({ supplyId: supply.id, quantity: 3, countedOn: '2026-01-01', moment: 'cierre' })
    await expect(db.insert(schema.supplyPurchases).values({ supplyId: 9999, quantity: 1, totalCost: 1, purchasedAt: '2026-01-01' })).rejects.toThrow()

    const idx = await client.execute(`SELECT name FROM sqlite_master WHERE type = 'index'`)
    const names = idx.rows.map(r => String(r.name))
    for (const i of ['idx_supply_purchases_purchased_at', 'idx_supply_waste_wasted_at', 'idx_lost_sales_occurred_at', 'uq_supply_counts_day_moment', 'supplies_name_unique', 'supplies_code_unique', 'idx_day_notes_date']) {
      expect(names).toContain(i)
    }
    client.close()
  })

  // Plan v2 §2.1: la BD de la v1 (con insumos y conteos de prueba) pasa a la v2
  // sin perder datos: códigos generados y conteos previos marcados como 'cierre'.
  it('migra el inventario v1 a la v2 (códigos, momento del conteo, local_id, notas)', async () => {
    const client = createClient({ url: tempDbUrl() })
    await createSchema(client)
    // Volver a la forma v1: sin day_notes, sin columnas nuevas, índice de conteos viejo
    await client.execute('DROP TABLE day_notes')
    await client.execute('DROP INDEX supplies_code_unique')
    await client.execute('DROP INDEX uq_supply_counts_day_moment')
    const dropped: [string, string][] = [
      ['supplies', 'code'], ['supplies', 'sort_order'],
      ['supply_purchases', 'supplier'], ['supply_purchases', 'source'], ['supply_purchases', 'source_date'], ['supply_purchases', 'local_id'],
      ['supply_waste', 'source'], ['supply_waste', 'source_date'], ['supply_waste', 'local_id'],
      ['supply_counts', 'moment'], ['supply_counts', 'local_id'], ['lost_sales', 'local_id'],
    ]
    for (const [t, c] of dropped) await client.execute(`ALTER TABLE ${t} DROP COLUMN ${c}`)
    await client.execute('CREATE UNIQUE INDEX uq_supply_counts_supply_day ON supply_counts (supply_id, counted_on)')
    for (const name of ['Limón', 'Conchas negras', 'Pulpo', 'pulpo ']) {
      await client.execute({ sql: "INSERT INTO supplies (name, unit) VALUES (?, 'kg')", args: [name] })
    }
    await client.execute("INSERT INTO supply_counts (supply_id, quantity, counted_on) VALUES (1, 2.5, '2026-01-10')")
    await client.execute("INSERT INTO supply_purchases (supply_id, quantity, total_cost, purchased_at) VALUES (1, 3, 9, '2026-01-10')")

    await applyStartupMigrations(client)
    await applyStartupMigrations(client) // idempotente

    const db = drizzle(client, { schema })
    const codes = (await db.select().from(schema.supplies)).map(s => s.code)
    expect(codes).toEqual(['LIMON', 'CONCHAS_NEGRAS', 'PULPO', 'PULPO_2'])
    const [count] = await db.select().from(schema.supplyCounts)
    expect(count).toMatchObject({ quantity: 2.5, moment: 'cierre', localId: 1 })
    const [purchase] = await db.select().from(schema.supplyPurchases)
    expect(purchase).toMatchObject({ source: 'manual', supplier: null, localId: 1 })
    // El índice viejo desapareció: ya se puede registrar la apertura del mismo día
    await db.insert(schema.supplyCounts).values({ supplyId: 1, quantity: 1, countedOn: '2026-01-10', moment: 'apertura' })
    await db.insert(schema.dayNotes).values({ date: '2026-01-10', kind: 'feriado' })
    const idx = (await client.execute(`SELECT name FROM sqlite_master WHERE type = 'index'`)).rows.map(r => String(r.name))
    expect(idx).not.toContain('uq_supply_counts_supply_day')
    expect(idx).toContain('uq_supply_counts_day_moment')
    client.close()
  })

  // Plan v3 §2.1: la BD de la v2 pasa a la v3 con el grupo del estudio asignado por
  // código, los modos de entrada y las tablas nuevas, sin tocar los datos.
  it('migra el inventario v2 a la v3 (modos de entrada, tablas nuevas)', async () => {
    const client = createClient({ url: tempDbUrl() })
    await createSchema(client)
    for (const t of ['study_config', 'daily_parts', 'supply_transfers', 'other_supply_costs']) await client.execute(`DROP TABLE ${t}`)
    const dropped: [string, string][] = [
      ['supplies', 'study_group'], ['supply_counts', 'entry_mode'], ['supply_waste', 'entry_mode'],
      ['supply_purchases', 'entry_mode'], ['supply_purchases', 'price_entry_mode'],
    ]
    for (const [t, c] of dropped) await client.execute(`ALTER TABLE ${t} DROP COLUMN ${c}`)
    for (const [name, code] of [['Calamar', 'CALAMAR'], ['Pescado', 'PESCADO'], ['Pulpo', 'PULPO'], ['Langostino', 'LANGOSTINO'], ['Conchas', 'CONCHAS'], ['Limón', 'LIMON']]) {
      await client.execute({ sql: "INSERT INTO supplies (name, code, unit) VALUES (?, ?, 'kg')", args: [name, code] })
    }
    await client.execute("INSERT INTO supply_purchases (supply_id, quantity, total_cost, purchased_at) VALUES (1, 2, 50, '2026-10-01')")

    await applyStartupMigrations(client)
    await applyStartupMigrations(client) // idempotente

    const db = drizzle(client, { schema })
    // Desde T2 el estudio por grupos se retiró: la columna existe pero queda vacía
    expect((await db.select().from(schema.supplies)).every(s => s.studyGroup === null)).toBe(true)
    const [purchase] = await db.select().from(schema.supplyPurchases)
    expect(purchase).toMatchObject({ quantity: 2, entryMode: null, priceEntryMode: null })
    await db.insert(schema.studyConfig).values({ key: 'study_ends_on', value: '2027-04-04' })
    await db.insert(schema.dailyParts).values({ date: '2026-11-09', part: 'apertura', durationMs: 1000 })
    await db.insert(schema.supplyTransfers).values({ date: '2026-12-28', supplyId: 1, direction: 'envio', quantity: 1, otherLocalId: 2 })
    await db.insert(schema.otherSupplyCosts).values({ date: '2026-11-09', amount: 20 })
    await expect(db.insert(schema.otherSupplyCosts).values({ date: '2026-11-09', amount: 25 })).rejects.toThrow()
    await db.insert(schema.dayNotes).values({ date: '2026-11-09', kind: 'dueno_ausente' })
    client.close()
  })

  // plan-sistema T2: la fecha de apertura del segundo local pasa de study_config a
  // app_settings una sola vez, sin pisar lo que ya esté en los ajustes
  it('[RNF07] crea app_settings y copia la apertura del segundo local desde study_config', async () => {
    const client = createClient({ url: tempDbUrl() })
    await createSchema(client)
    await client.execute('DROP TABLE app_settings')
    await client.execute("INSERT INTO study_config (key, value) VALUES ('second_local_opens_on', '2026-12-28'), ('study_ends_on', '2027-04-04')")

    await applyStartupMigrations(client)
    await applyStartupMigrations(client) // idempotente

    const db = drizzle(client, { schema })
    expect(await db.select({ key: schema.appSettings.key, value: schema.appSettings.value }).from(schema.appSettings))
      .toEqual([{ key: 'second_local_opened_on', value: '2026-12-28' }])
    // Lo que el dueño cambie después no se pisa con el valor viejo
    await client.execute("UPDATE app_settings SET value = '2027-01-04' WHERE key = 'second_local_opened_on'")
    await applyStartupMigrations(client)
    const [row] = await db.select().from(schema.appSettings)
    expect(row.value).toBe('2027-01-04')
    client.close()
  })

  // plan-sistema T7: incremento 2, aditivo. Una base de la versión anterior gana las
  // columnas y tablas nuevas, conserva sus datos y recibe los parámetros de los críticos
  it('[RNF07] migra al incremento 2 (receta, calibración, tipo de gasto) sin perder datos', async () => {
    const client = createClient({ url: tempDbUrl() })
    await createSchema(client)
    for (const t of ['recipe_items', 'recipe_calibrations', 'expense_categories']) await client.execute(`DROP TABLE ${t}`)
    for (const c of ['yield', 'shelf_life_days', 'service_level']) await client.execute(`ALTER TABLE supplies DROP COLUMN ${c}`)
    for (const [name, code] of [['Pescado', 'PESCADO'], ['Calamar', 'CALAMAR'], ['Limón', 'LIMON'], ['Pulpo', 'PULPO']]) {
      await client.execute({ sql: "INSERT INTO supplies (name, code, unit, critical) VALUES (?, ?, 'kg', 1)", args: [name, code] })
    }
    await client.execute("INSERT INTO supply_purchases (supply_id, quantity, total_cost, purchased_at) VALUES (1, 12, 120, '2026-10-01')")
    await client.execute(`INSERT INTO expenses (description, amount, category, date) VALUES
      ('Alquiler', 3000, 'alquiler', '2026-10-01'), ('Balón', 70, 'Gas', '2026-10-02'), ('Luz', 500, 'servicios', '2026-10-03')`)

    await applyStartupMigrations(client)
    await applyStartupMigrations(client) // idempotente

    const db = drizzle(client, { schema })
    const supplies = await db.select().from(schema.supplies).orderBy(schema.supplies.id)
    expect(supplies.map(s => [s.code, s.yield, s.shelfLifeDays, s.serviceLevel])).toEqual([
      ['PESCADO', 0.8, 7, 0.99], ['CALAMAR', 1, 6, 0.9], ['LIMON', 1, 10, 0.95], ['PULPO', 1, null, null],
    ])
    expect((await db.select().from(schema.supplyPurchases))[0]).toMatchObject({ quantity: 12, totalCost: 120 })
    const kinds = await db.select({ category: schema.expenseCategories.category, kind: schema.expenseCategories.kind })
      .from(schema.expenseCategories).orderBy(schema.expenseCategories.category)
    expect(kinds).toEqual([
      { category: 'Gas', kind: 'variable' }, { category: 'alquiler', kind: 'fijo' }, { category: 'descartables', kind: 'variable' },
      { category: 'gas', kind: 'variable' }, { category: 'servicios', kind: 'fijo' },
    ])
    await expect(client.execute("INSERT INTO expense_categories (category, kind) VALUES ('otro', 'mixto')")).rejects.toThrow()

    // Lo que el dueño configure después no se pisa al volver a migrar
    await client.execute("UPDATE supplies SET yield = 0.75, shelf_life_days = 5 WHERE code = 'PESCADO'")
    await client.execute("UPDATE expense_categories SET kind = 'variable' WHERE category = 'servicios'")
    await applyStartupMigrations(client)
    const [pescado] = await db.select().from(schema.supplies).where(eq(schema.supplies.code, 'PESCADO'))
    expect([pescado.yield, pescado.shelfLifeDays]).toEqual([0.75, 5])
    const [servicios] = await db.select().from(schema.expenseCategories).where(eq(schema.expenseCategories.category, 'servicios'))
    expect(servicios.kind).toBe('variable')

    // Receta: una fila por plato, variante e insumo
    await client.execute("INSERT INTO categories (name) VALUES ('Ceviches')")
    await client.execute("INSERT INTO dishes (category_id, name, price) VALUES (1, 'Ceviche clásico', 18)")
    await db.insert(schema.recipeItems).values({ dishId: 1, supplyId: 1, gramsClean: 180 })
    await db.insert(schema.recipeItems).values({ dishId: 1, variant: 'Calamar', supplyId: 1, gramsClean: 90 })
    await expect(db.insert(schema.recipeItems).values({ dishId: 1, supplyId: 1, gramsClean: 200 })).rejects.toThrow()
    await db.insert(schema.recipeCalibrations).values({ supplyId: 1, factor: 1.04, fromDate: '2026-06-16', toDate: '2026-07-12' })
    client.close()
  })
})
