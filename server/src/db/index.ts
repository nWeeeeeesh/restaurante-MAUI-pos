import { createClient } from '@libsql/client'
import { drizzle } from 'drizzle-orm/libsql'
import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core'
import type { ResultSet } from '@libsql/client'
import * as schema from './schema'
import * as dotenv from 'dotenv'
dotenv.config()

const client = createClient({
  url: process.env.DATABASE_URL || 'file:./mauidisk.db',
})

export const db = drizzle(client, { schema })
export type DB = typeof db
// Base común de la BD y de una transacción: permite que los servicios reciban
// cualquiera de las dos y que una misma función corra dentro o fuera de una tx.
export type Executor = BaseSQLiteDatabase<'async', ResultSet, typeof schema>
