import { createClient } from '@libsql/client'
import { drizzle } from 'drizzle-orm/libsql'
import * as schema from './schema'
import * as dotenv from 'dotenv'
dotenv.config()

const client = createClient({
  url: process.env.DATABASE_URL || 'file:./mauidisk.db',
})

export const db = drizzle(client, { schema })
export type DB = typeof db
