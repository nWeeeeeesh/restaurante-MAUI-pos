import { createClient, type Client } from '@libsql/client'
import * as dotenv from 'dotenv'
dotenv.config()

// Pequeñas migraciones idempotentes que se aplican al arranque del servidor.
// Para cambios mayores usar drizzle-kit. Aquí solo agregamos columnas/tablas
// nuevas sin tocar datos existentes.
// Acepta un cliente por parámetro para poder aplicarlas en tests.
export async function applyStartupMigrations(existing?: Client) {
  const client = existing ?? createClient({ url: process.env.DATABASE_URL || 'file:./mauidisk.db' })

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

  // 3) audit_log — registro de operaciones sensibles (v1.1, T3). Aditivo: la
  // versión anterior del código funciona igual con esta tabla presente.
  try {
    await client.execute(`
      CREATE TABLE IF NOT EXISTS audit_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
        at TEXT DEFAULT (datetime('now')),
        user_id INTEGER REFERENCES users(id),
        action TEXT NOT NULL,
        entity TEXT NOT NULL,
        entity_id INTEGER,
        data TEXT
      )
    `)
    await client.execute(`CREATE INDEX IF NOT EXISTS idx_audit_log_at ON audit_log(at)`)
  } catch (e: any) {
    console.warn('[migrate] audit_log failed:', e.message)
  }

  // 4) Índices de rendimiento — idempotentes con IF NOT EXISTS.
  // También están declarados en schema.ts con los mismos nombres: si no lo
  // estuvieran, `drizzle-kit push` los borraría (verificado).
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

  // 5) Un solo pedido activo por mesa (v1.1, T4). Si la BD ya tiene mesas con dos
  // pedidos activos, el índice no se puede crear: se avisa y se sigue, porque la
  // creación de pedidos ya está serializada en la app y no debe impedir abrir el local.
  try {
    // Mismo texto que genera drizzle-kit: si difiere, `push` lo borra y recrea.
    await client.execute(
      "CREATE UNIQUE INDEX IF NOT EXISTS `uq_orders_active_table` ON `orders` (`table_id`) WHERE table_id IS NOT NULL AND status NOT IN ('paid', 'cancelled')",
    )
  } catch (e: any) {
    const dups = await client.execute(`
      SELECT table_id, GROUP_CONCAT(id) AS ids FROM orders
      WHERE table_id IS NOT NULL AND status NOT IN ('paid', 'cancelled')
      GROUP BY table_id HAVING COUNT(*) > 1
    `).catch(() => ({ rows: [] as unknown[] }))
    console.warn('[migrate] uq_orders_active_table no creado:', e.message, '· mesas con varios pedidos activos:', JSON.stringify(dups.rows))
  }

  if (!existing) client.close()
}
