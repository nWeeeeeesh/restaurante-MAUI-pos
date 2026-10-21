import { createClient, type Client } from '@libsql/client'
import * as dotenv from 'dotenv'
import { supplyCodeFrom, uniqueCode } from '../utils/codes'
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

    // 5) Inventario de insumos (Fase 0, v1 del plan). Mismo DDL que genera drizzle-kit
    // para la v1 de schema.ts; el paso 6 lo lleva a la v2. El índice único de conteos
    // se crea en el paso 6 (con `moment`): si se creara aquí el de la v1, volvería a
    // aparecer en cada arranque e impediría apertura y cierre el mismo día.
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

    // 6) Inventario v2 del plan (instrumento congelado de la tesis): código estable y
    // orden de insumos, proveedor, origen de compras y merma, momento del conteo,
    // local_id y notas del día. Todo aditivo salvo el índice único de conteos, que
    // pasa de (insumo, día) a (insumo, día, momento).
    await addColumn(client, 'supplies', 'code', 'text')
    await addColumn(client, 'supplies', 'sort_order', 'integer DEFAULT 0')
    await fillSupplyCodes(client)
    await client.execute('CREATE UNIQUE INDEX IF NOT EXISTS `supplies_code_unique` ON `supplies` (`code`)')

    await addColumn(client, 'supply_purchases', 'supplier', 'text')
    for (const table of ['supply_purchases', 'supply_waste']) {
      await addColumn(client, table, 'source', "text DEFAULT 'manual' NOT NULL")
      await addColumn(client, table, 'source_date', 'text')
    }
    for (const table of ['supply_purchases', 'supply_waste', 'supply_counts', 'lost_sales']) {
      await addColumn(client, table, 'local_id', 'integer DEFAULT 1 NOT NULL')
    }

    // Los conteos previos a la v2 fueron pruebas de cierre: se marcan 'cierre' en la
    // misma transacción que agrega la columna, para que un corte a mitad no los deje
    // como 'apertura' (al reintentar, la columna ya existiría y no se marcarían).
    if (!(await hasColumn(client, 'supply_counts', 'moment'))) {
      await client.batch([
        "ALTER TABLE `supply_counts` ADD `moment` text DEFAULT 'apertura' NOT NULL",
        "UPDATE `supply_counts` SET `moment` = 'cierre'",
      ], 'write')
      console.log('[migrate] supply_counts.moment column added (previous counts → cierre)')
    }
    await client.execute('DROP INDEX IF EXISTS `uq_supply_counts_supply_day`')
    await client.execute(
      'CREATE UNIQUE INDEX IF NOT EXISTS `uq_supply_counts_day_moment` ON `supply_counts` (`supply_id`,`counted_on`,`moment`)',
    )

    await client.execute(`CREATE TABLE IF NOT EXISTS \`day_notes\` (
      \`id\` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
      \`date\` text NOT NULL,
      \`kind\` text NOT NULL,
      \`text\` text,
      \`local_id\` integer DEFAULT 1 NOT NULL,
      \`created_by\` integer,
      \`created_at\` text DEFAULT (datetime('now')),
      FOREIGN KEY (\`created_by\`) REFERENCES \`users\`(\`id\`) ON UPDATE no action ON DELETE no action
    )`)

    // 7) Inventario v3 del plan (E1, instrumento final de la tesis): grupo del estudio,
    // modo de entrada de cada valor, configuración del estudio, partes del registro,
    // traslados y otros insumos. Todo aditivo.
    await addColumn(client, 'supplies', 'study_group', 'text')
    await fillStudyGroups(client)
    await addColumn(client, 'supply_counts', 'entry_mode', 'text')
    await addColumn(client, 'supply_waste', 'entry_mode', 'text')
    await addColumn(client, 'supply_purchases', 'entry_mode', 'text')
    await addColumn(client, 'supply_purchases', 'price_entry_mode', 'text')
    const v3Ddl = [
      `CREATE TABLE IF NOT EXISTS \`study_config\` (
        \`key\` text PRIMARY KEY NOT NULL,
        \`value\` text,
        \`updated_by\` integer,
        \`updated_at\` text DEFAULT (datetime('now')),
        FOREIGN KEY (\`updated_by\`) REFERENCES \`users\`(\`id\`) ON UPDATE no action ON DELETE no action
      )`,
      `CREATE TABLE IF NOT EXISTS \`daily_parts\` (
        \`id\` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
        \`date\` text NOT NULL,
        \`local_id\` integer DEFAULT 1 NOT NULL,
        \`part\` text NOT NULL,
        \`completed_by\` integer,
        \`completed_at\` text DEFAULT (datetime('now')),
        \`duration_ms\` integer,
        \`is_correction\` integer DEFAULT false NOT NULL,
        \`client_version\` text,
        FOREIGN KEY (\`completed_by\`) REFERENCES \`users\`(\`id\`) ON UPDATE no action ON DELETE no action
      )`,
      `CREATE TABLE IF NOT EXISTS \`supply_transfers\` (
        \`id\` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
        \`date\` text NOT NULL,
        \`supply_id\` integer NOT NULL,
        \`direction\` text NOT NULL,
        \`quantity\` real NOT NULL,
        \`unit_cost\` real,
        \`other_local_id\` integer NOT NULL,
        \`local_id\` integer DEFAULT 1 NOT NULL,
        \`source\` text DEFAULT 'daily' NOT NULL,
        \`entry_mode\` text,
        \`created_by\` integer,
        \`created_at\` text DEFAULT (datetime('now')),
        FOREIGN KEY (\`supply_id\`) REFERENCES \`supplies\`(\`id\`) ON UPDATE no action ON DELETE no action,
        FOREIGN KEY (\`created_by\`) REFERENCES \`users\`(\`id\`) ON UPDATE no action ON DELETE no action
      )`,
      `CREATE TABLE IF NOT EXISTS \`other_supply_costs\` (
        \`id\` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
        \`date\` text NOT NULL,
        \`amount\` real NOT NULL,
        \`local_id\` integer DEFAULT 1 NOT NULL,
        \`source\` text DEFAULT 'daily' NOT NULL,
        \`entry_mode\` text,
        \`created_by\` integer,
        \`created_at\` text DEFAULT (datetime('now')),
        FOREIGN KEY (\`created_by\`) REFERENCES \`users\`(\`id\`) ON UPDATE no action ON DELETE no action
      )`,
      // Requerido: la idempotencia de «otros insumos» depende de él
      'CREATE UNIQUE INDEX IF NOT EXISTS `uq_other_supply_costs_day` ON `other_supply_costs` (`date`,`local_id`,`source`)',
    ]
    for (const ddl of v3Ddl) await client.execute(ddl)

    // ── Opcionales ────────────────────────────────────────────────────────────
    // 8) WAL (M5): con el journal por defecto ('delete'), un commit bloquea a los
    // lectores y una consulta puede recibir SQLITE_BUSY. En WAL los lectores no
    // esperan al escritor. Es persistente en el archivo; `sqlite3 .backup` lo soporta.
    await optional('journal_mode=WAL', () => client.execute('PRAGMA journal_mode=WAL'))

    // 9) Índices — también declarados en schema.ts con los mismos nombres: si no lo
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
      'CREATE INDEX IF NOT EXISTS `idx_day_notes_date` ON `day_notes` (`date`)',
      'CREATE INDEX IF NOT EXISTS `idx_daily_parts_date_part` ON `daily_parts` (`date`,`local_id`,`part`)',
      'CREATE INDEX IF NOT EXISTS `idx_supply_transfers_date` ON `supply_transfers` (`date`)',
    ]
    for (const sql of indexes) await optional('índice', () => client.execute(sql))

    // 10) Un solo pedido activo por mesa (T4). Si la BD ya tiene mesas con dos
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

async function hasColumn(client: Client, table: string, column: string) {
  const cols = await client.execute(`PRAGMA table_info(${table})`)
  return cols.rows.some(r => String(r.name) === column)
}

async function addColumn(client: Client, table: string, column: string, ddl: string) {
  if (await hasColumn(client, table, column)) return
  await client.execute(`ALTER TABLE \`${table}\` ADD \`${column}\` ${ddl}`)
  console.log(`[migrate] ${table}.${column} column added`)
}

// Genera el código de los insumos que no lo tienen (los creados con la v1)
// Grupo del estudio de los insumos que no lo tienen, por su código estable. Solo
// estos cinco entran al estudio; el resto queda fuera (null).
const STUDY_GROUP_BY_CODE: Record<string, string> = {
  CALAMAR: 'calamar',
  PESCADO: 'pescado',
  PULPO: 'mariscos',
  LANGOSTINO: 'mariscos',
  CONCHAS: 'mariscos',
}

async function fillStudyGroups(client: Client) {
  for (const [code, group] of Object.entries(STUDY_GROUP_BY_CODE)) {
    await client.execute({ sql: 'UPDATE supplies SET study_group = ? WHERE code = ? AND study_group IS NULL', args: [group, code] })
  }
}

async function fillSupplyCodes(client: Client) {
  const rows = await client.execute('SELECT id, name, code FROM supplies ORDER BY id')
  const taken = new Set(rows.rows.map(r => r.code).filter((c): c is string => typeof c === 'string'))
  for (const r of rows.rows) {
    if (r.code !== null) continue
    const code = uniqueCode(supplyCodeFrom(String(r.name)), taken)
    taken.add(code)
    await client.execute({ sql: 'UPDATE supplies SET code = ? WHERE id = ?', args: [code, Number(r.id)] })
  }
}

async function optional(name: string, step: () => Promise<unknown>) {
  try {
    await step()
  } catch (e: any) {
    console.warn(`[migrate] (opcional) ${name} falló:`, e?.message ?? e)
  }
}
