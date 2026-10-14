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

    // 4) dishes.archived — baja de un plato con historial, distinta de "agotado" (TD-31).
    const dishCols = await client.execute(`PRAGMA table_info(dishes)`)
    if (!dishCols.rows.some(r => String(r.name) === 'archived')) {
      await client.execute(`ALTER TABLE dishes ADD COLUMN archived INTEGER DEFAULT false`)
      console.log('[migrate] dishes.archived column added')
    }

    // 5) Inventario de insumos (Fase 0). Mismo DDL que genera drizzle-kit para
    // schema.ts; el índice único de conteos es requerido porque el upsert depende de él.
    const inventoryDdl = [
      `CREATE TABLE IF NOT EXISTS \`supplies\` (
        \`id\` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
        \`name\` text NOT NULL,
        \`unit\` text NOT NULL,
        \`perishable\` integer DEFAULT true,
        \`critical\` integer DEFAULT false,
        \`active\` integer DEFAULT true,
        \`created_at\` text DEFAULT (datetime('now'))
      )`,
      'CREATE UNIQUE INDEX IF NOT EXISTS `supplies_name_unique` ON `supplies` (`name`)',
      `CREATE TABLE IF NOT EXISTS \`supply_purchases\` (
        \`id\` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
        \`supply_id\` integer NOT NULL,
        \`quantity\` real NOT NULL,
        \`total_cost\` real NOT NULL,
        \`purchased_at\` text NOT NULL,
        \`notes\` text,
        \`created_by\` integer,
        \`created_at\` text DEFAULT (datetime('now')),
        FOREIGN KEY (\`supply_id\`) REFERENCES \`supplies\`(\`id\`) ON UPDATE no action ON DELETE no action,
        FOREIGN KEY (\`created_by\`) REFERENCES \`users\`(\`id\`) ON UPDATE no action ON DELETE no action
      )`,
      `CREATE TABLE IF NOT EXISTS \`supply_waste\` (
        \`id\` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
        \`supply_id\` integer NOT NULL,
        \`quantity\` real NOT NULL,
        \`reason\` text NOT NULL,
        \`wasted_at\` text NOT NULL,
        \`notes\` text,
        \`created_by\` integer,
        \`created_at\` text DEFAULT (datetime('now')),
        FOREIGN KEY (\`supply_id\`) REFERENCES \`supplies\`(\`id\`) ON UPDATE no action ON DELETE no action,
        FOREIGN KEY (\`created_by\`) REFERENCES \`users\`(\`id\`) ON UPDATE no action ON DELETE no action
      )`,
      `CREATE TABLE IF NOT EXISTS \`supply_counts\` (
        \`id\` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
        \`supply_id\` integer NOT NULL,
        \`quantity\` real NOT NULL,
        \`counted_on\` text NOT NULL,
        \`created_by\` integer,
        \`created_at\` text DEFAULT (datetime('now')),
        FOREIGN KEY (\`supply_id\`) REFERENCES \`supplies\`(\`id\`) ON UPDATE no action ON DELETE no action,
        FOREIGN KEY (\`created_by\`) REFERENCES \`users\`(\`id\`) ON UPDATE no action ON DELETE no action
      )`,
      'CREATE UNIQUE INDEX IF NOT EXISTS `uq_supply_counts_supply_day` ON `supply_counts` (`supply_id`,`counted_on`)',
      `CREATE TABLE IF NOT EXISTS \`lost_sales\` (
        \`id\` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
        \`dish_id\` integer,
        \`supply_id\` integer,
        \`quantity\` integer DEFAULT 1,
        \`occurred_at\` text DEFAULT (datetime('now')),
        \`created_by\` integer,
        FOREIGN KEY (\`dish_id\`) REFERENCES \`dishes\`(\`id\`) ON UPDATE no action ON DELETE no action,
        FOREIGN KEY (\`supply_id\`) REFERENCES \`supplies\`(\`id\`) ON UPDATE no action ON DELETE no action,
        FOREIGN KEY (\`created_by\`) REFERENCES \`users\`(\`id\`) ON UPDATE no action ON DELETE no action
      )`,
    ]
    for (const ddl of inventoryDdl) await client.execute(ddl)

    // ── Opcionales ────────────────────────────────────────────────────────────
    // 6) WAL (M5): con el journal por defecto ('delete'), un commit bloquea a los
    // lectores y una consulta puede recibir SQLITE_BUSY. En WAL los lectores no
    // esperan al escritor. Es persistente en el archivo; `sqlite3 .backup` lo soporta.
    await optional('journal_mode=WAL', () => client.execute('PRAGMA journal_mode=WAL'))

    // 7) Índices — también declarados en schema.ts con los mismos nombres: si no lo
    // estuvieran, `drizzle-kit push` los borraría (verificado).
    const indexes = [
      `CREATE INDEX IF NOT EXISTS idx_order_items_order_id  ON order_items(order_id)`,
      `CREATE INDEX IF NOT EXISTS idx_order_items_bill_id   ON order_items(bill_id)`,
      `CREATE INDEX IF NOT EXISTS idx_bills_paid_at         ON bills(paid_at)`,
      `CREATE INDEX IF NOT EXISTS idx_orders_table_status   ON orders(table_id, status)`,
      `CREATE INDEX IF NOT EXISTS idx_audit_log_at          ON audit_log(at)`,
      'CREATE INDEX IF NOT EXISTS `idx_supply_purchases_purchased_at` ON `supply_purchases` (`purchased_at`)',
      'CREATE INDEX IF NOT EXISTS `idx_supply_waste_wasted_at` ON `supply_waste` (`wasted_at`)',
      'CREATE INDEX IF NOT EXISTS `idx_lost_sales_occurred_at` ON `lost_sales` (`occurred_at`)',
    ]
    for (const sql of indexes) await optional('índice', () => client.execute(sql))

    // 8) Un solo pedido activo por mesa (T4). Si la BD ya tiene mesas con dos
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
