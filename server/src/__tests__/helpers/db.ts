import * as os from 'os'
import * as path from 'path'
import { createClient, type Client } from '@libsql/client'
import { drizzle } from 'drizzle-orm/libsql'
import { pushSQLiteSchema } from 'drizzle-kit/api'
import * as schema from '../../db/schema'
import { applyStartupMigrations } from '../../db/migrate'

export type TestDb = ReturnType<typeof drizzle<typeof schema>>

// Ruta de archivo SQLite temporal única por test.
// @libsql/client cicla conexiones durante db.transaction(), lo que invalida
// bases :memory: entre el commit y la siguiente query; con archivo real la BD persiste.
export function tempDbUrl(): string {
  const tmpFile = path.join(
    os.tmpdir(),
    `mauidesktest-${Date.now()}-${Math.random().toString(36).slice(2)}.db`,
  )
  return `file:${tmpFile.replace(/\\/g, '/')}`
}

// El esquema se genera desde schema.ts (misma fuente que producción) y luego se
// aplican las migraciones de arranque. Así los tests ven FKs, índices y tablas reales.
export async function createSchema(client: Client) {
  const db = drizzle(client, { schema })
  const { apply } = await pushSQLiteSchema(schema, db)
  await apply()
  await applyStartupMigrations(client)
}

export async function createTestDb(): Promise<TestDb> {
  const client = createClient({ url: tempDbUrl() })
  await createSchema(client)
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

  return { user, table, cat, dish1, dish2 }
}
