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
    for (const t of ['lost_sales', 'supply_counts', 'supply_waste', 'supply_purchases', 'supplies']) {
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
    await expect(db.insert(schema.supplyPurchases).values({ supplyId: 9999, quantity: 1, totalCost: 1, purchasedAt: '2026-01-01' })).rejects.toThrow()

    const idx = await client.execute(`SELECT name FROM sqlite_master WHERE type = 'index'`)
    const names = idx.rows.map(r => String(r.name))
    for (const i of ['idx_supply_purchases_purchased_at', 'idx_supply_waste_wasted_at', 'idx_lost_sales_occurred_at', 'uq_supply_counts_supply_day', 'supplies_name_unique']) {
      expect(names).toContain(i)
    }
    client.close()
  })
})
