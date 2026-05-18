import { defineConfig } from 'drizzle-kit'
import * as dotenv from 'dotenv'
dotenv.config()

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './src/db/migrations',
  dialect: 'sqlite',
  dbCredentials: {
    url: process.env.DATABASE_URL || 'file:./mauidisk.db',
  },
})
