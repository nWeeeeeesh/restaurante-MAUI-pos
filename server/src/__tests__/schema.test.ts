import { describe, it, expect } from 'vitest'
import { createTestDb } from './helpers/db'
import { orderItems } from '../db/schema'

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
})
