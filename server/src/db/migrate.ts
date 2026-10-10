import { createClient, type Client } from '@libsql/client'
import * as dotenv from 'dotenv'
dotenv.config()

// Pequeñas migraciones idempotentes que se aplican al arranque del servidor.
// Solo agregan columnas, tablas o índices: nunca recrean tablas ni tocan datos,
// para que volver a la versión anterior del código funcione con la BD nueva.
// Acepta un cliente por parámetro para poder aplicarlas en tests.
//
// Pasos REQUERIDOS (el código los necesita): si fallan, se lanza el error y el
// servidor no arranca (M6). Pasos OPCIONALES (rendimiento, defensa adicional):
// si fallan, se avisa y se sigue.
export async function applyStartupMigrations(existing?: Client) {
  const client = existing ?? createClient({ url: process.env.DATABASE_URL || 'file:./mauidisk.db' })
  try {
    // ── Requeridos ────────────────────────────────────────────────────────────
    // 1) tables.active — flag para inhabilitar mesas sin perder historial.
    const cols = await client.execute(`PRAGMA table_info(tables)`)
    if (!cols.rows.some(r => String(r.name) === 'active')) {
      await client.execute(`ALTER TABLE tables ADD COLUMN active INTEGER DEFAULT 1`)
      console.log('[migrate] tables.active column added')
    }

    // 2) layout_items — decoraciones del plano (labels y zonas).
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

    // 3) audit_log — registro de operaciones sensibles (v1.1).
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

    // ── Opcionales ────────────────────────────────────────────────────────────
    // 4) WAL (M5): con el journal por defecto ('delete'), un commit bloquea a los
    // lectores y una consulta puede recibir SQLITE_BUSY. En WAL los lectores no
    // esperan al escritor. Es persistente en el archivo; `sqlite3 .backup` lo soporta.
    await optional('journal_mode=WAL', () => client.execute('PRAGMA journal_mode=WAL'))

    // 5) Índices — también declarados en schema.ts con los mismos nombres: si no lo
    // estuvieran, `drizzle-kit push` los borraría (verificado).
    const indexes = [
      `CREATE INDEX IF NOT EXISTS idx_order_items_order_id  ON order_items(order_id)`,
      `CREATE INDEX IF NOT EXISTS idx_order_items_bill_id   ON order_items(bill_id)`,
      `CREATE INDEX IF NOT EXISTS idx_bills_paid_at         ON bills(paid_at)`,
      `CREATE INDEX IF NOT EXISTS idx_orders_table_status   ON orders(table_id, status)`,
      `CREATE INDEX IF NOT EXISTS idx_audit_log_at          ON audit_log(at)`,
    ]
    for (const sql of indexes) await optional('índice', () => client.execute(sql))

    // 6) Un solo pedido activo por mesa (T4). Si la BD ya tiene mesas con dos
    // pedidos activos, el índice no se puede crear: se avisa con los ids y se sigue,
    // porque la creación de pedidos ya está serializada en la app.
    await optional('uq_orders_active_table', async () => {
      try {
        // Mismo texto que genera drizzle-kit para el índice declarado en schema.ts
        await client.execute(
          "CREATE UNIQUE INDEX IF NOT EXISTS `uq_orders_active_table` ON `orders` (`table_id`) WHERE table_id IS NOT NULL AND status NOT IN ('paid', 'cancelled')",
        )
      } catch (e) {
        const dups = await client.execute(`
          SELECT table_id, GROUP_CONCAT(id) AS ids FROM orders
          WHERE table_id IS NOT NULL AND status NOT IN ('paid', 'cancelled')
          GROUP BY table_id HAVING COUNT(*) > 1
        `).catch(() => ({ rows: [] as unknown[] }))
        console.warn('[migrate] mesas con varios pedidos activos:', JSON.stringify(dups.rows))
        throw e
      }
    })
  } finally {
    if (!existing) client.close()
  }
}

async function optional(name: string, step: () => Promise<unknown>) {
  try {
    await step()
  } catch (e: any) {
    console.warn(`[migrate] (opcional) ${name} falló:`, e?.message ?? e)
  }
}
