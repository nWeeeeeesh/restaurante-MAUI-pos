import { createClient } from '@libsql/client'
import * as dotenv from 'dotenv'
dotenv.config()

// Pequeñas migraciones idempotentes que se aplican al arranque del servidor.
// Para cambios mayores usar drizzle-kit. Aquí solo agregamos columnas/tablas
// nuevas sin tocar datos existentes.
export async function applyStartupMigrations() {
  const client = createClient({ url: process.env.DATABASE_URL || 'file:./mauidisk.db' })

  // 1) tables.active — flag para inhabilitar mesas sin perder historial.
  try {
    const cols = await client.execute(`PRAGMA table_info(tables)`)
    const hasActive = cols.rows.some(r => String(r.name) === 'active')
    if (!hasActive) {
      await client.execute(`ALTER TABLE tables ADD COLUMN active INTEGER DEFAULT 1`)
      console.log('[migrate] tables.active column added')
    }
  } catch (e: any) {
    console.warn('[migrate] tables.active failed:', e.message)
  }

  // 2) layout_items — decoraciones del plano (labels y zonas).
  try {
    await client.execute(`
      CREATE TABLE IF NOT EXISTS layout_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        type TEXT NOT NULL,
        text TEXT NOT NULL,
        pos_x REAL NOT NULL,
        pos_y REAL NOT NULL,
        width REAL,
        height REAL,
        color TEXT DEFAULT '#94A3B8'
      )
    `)
  } catch (e: any) {
    console.warn('[migrate] layout_items failed:', e.message)
  }

  // 3) Índices de rendimiento — idempotentes con IF NOT EXISTS.
  const indexes = [
    `CREATE INDEX IF NOT EXISTS idx_order_items_order_id  ON order_items(order_id)`,
    `CREATE INDEX IF NOT EXISTS idx_order_items_bill_id   ON order_items(bill_id)`,
    `CREATE INDEX IF NOT EXISTS idx_bills_paid_at         ON bills(paid_at)`,
    `CREATE INDEX IF NOT EXISTS idx_orders_table_status   ON orders(table_id, status)`,
  ]
  for (const sql of indexes) {
    try { await client.execute(sql) } catch (e: any) {
      console.warn('[migrate] index failed:', e.message)
    }
  }

  client.close()
}
