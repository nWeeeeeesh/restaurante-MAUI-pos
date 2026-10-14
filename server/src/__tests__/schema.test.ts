import { describe, it, expect } from 'vitest'
import { createClient } from '@libsql/client'
import { drizzle } from 'drizzle-orm/libsql'
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
})
