import * as os from 'os'
import * as path from 'path'
import { createClient } from '@libsql/client'
import { drizzle } from 'drizzle-orm/libsql'
import * as schema from '../../db/schema'

// DDL mínimo para los tests de cobro. Refleja exactamente schema.ts.
const SCHEMA_SQL = [
  `CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL,
    active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    display_order INTEGER DEFAULT 0,
    active INTEGER DEFAULT 1
  )`,
  `CREATE TABLE IF NOT EXISTS dishes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    category_id INTEGER,
    name TEXT NOT NULL,
    description TEXT,
    price REAL NOT NULL,
    available INTEGER DEFAULT 1,
    has_spice_level INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS tables (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    number INTEGER NOT NULL UNIQUE,
    area TEXT DEFAULT 'salon',
    capacity INTEGER DEFAULT 4,
    status TEXT DEFAULT 'free',
    pos_x REAL,
    pos_y REAL,
    active INTEGER DEFAULT 1
  )`,
  `CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    table_id INTEGER,
    type TEXT NOT NULL,
    status TEXT DEFAULT 'pending',
    customer_name TEXT,
    customer_phone TEXT,
    customer_address TEXT,
    notes TEXT,
    created_by INTEGER,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS order_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER,
    dish_id INTEGER,
    dish_name TEXT NOT NULL,
    unit_price REAL NOT NULL,
    quantity INTEGER DEFAULT 1,
    modifiers TEXT DEFAULT '[]',
    notes TEXT,
    status TEXT DEFAULT 'pending',
    kitchen_printed INTEGER DEFAULT 0,
    bill_id INTEGER,
    bill_group_id INTEGER
  )`,
  `CREATE TABLE IF NOT EXISTS bill_groups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER NOT NULL,
    label TEXT NOT NULL,
    status TEXT DEFAULT 'open',
    bill_id INTEGER,
    created_at TEXT DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS bills (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER,
    subtotal REAL NOT NULL,
    total REAL NOT NULL,
    payment_method TEXT NOT NULL,
    cash_received REAL,
    change_amount REAL,
    receipt_number TEXT NOT NULL UNIQUE,
    paid_at TEXT DEFAULT (datetime('now')),
    created_by INTEGER
  )`,
  `CREATE TABLE IF NOT EXISTS expenses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    description TEXT NOT NULL,
    amount REAL NOT NULL,
    category TEXT DEFAULT 'general',
    date TEXT NOT NULL,
    notes TEXT,
    created_by INTEGER,
    created_at TEXT DEFAULT (datetime('now'))
  )`,
]

export type TestDb = ReturnType<typeof drizzle<typeof schema>>

// Cada llamada crea un archivo SQLite temporal único para el test.
// @libsql/client cicla conexiones durante db.transaction(), lo que invalida
// bases de datos :memory:?cache=private entre el commit y la siguiente query.
// Con archivo real, la BD persiste independientemente de qué conexión la abre.
export async function createTestDb(): Promise<TestDb> {
  const tmpFile = path.join(
    os.tmpdir(),
    `mauidesktest-${Date.now()}-${Math.random().toString(36).slice(2)}.db`,
  )
  const url = `file:${tmpFile.replace(/\\/g, '/')}`
  const client = createClient({ url })
  for (const sql of SCHEMA_SQL) {
    await client.execute(sql)
  }
  return drizzle(client, { schema })
}

// Seed mínimo: 1 cajero, 1 mesa, 2 platos
export async function seedBasicData(db: TestDb) {
  const [user] = await db.insert(schema.users).values({
    name: 'Cajero Test',
    username: 'cajero',
    passwordHash: 'x',
    role: 'cashier',
  }).returning()

  const [table] = await db.insert(schema.tables).values({
    number: 1,
    area: 'salon',
    capacity: 4,
    status: 'occupied',
  }).returning()

  const [cat] = await db.insert(schema.categories).values({ name: 'Ceviches' }).returning()

  const [dish1] = await db.insert(schema.dishes).values({
    categoryId: cat.id,
    name: 'Ceviche Clásico',
    price: 28,
  }).returning()

  const [dish2] = await db.insert(schema.dishes).values({
    categoryId: cat.id,
    name: 'Chicharrón',
    price: 35,
  }).returning()

  return { user, table, dish1, dish2 }
}
