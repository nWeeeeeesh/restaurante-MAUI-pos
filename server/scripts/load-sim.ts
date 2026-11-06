// npm run db:sim — crea server/mauidisk-sim.db con los datos simulados de 12 semanas
// (plan-sistema T6), para demostraciones locales. NUNCA debe tocar la base del local:
// solo acepta una DATABASE_URL que termine en -sim.db y no lee server/.env.
//
// Para levantar el servidor con ella (desde server/):
//   PowerShell: $env:DATABASE_URL='file:./mauidisk-sim.db'; npm run dev
//   bash:       DATABASE_URL=file:./mauidisk-sim.db npm run dev
// Usuarios: sim-dueno, sim-encargada y sim-cajero, contraseña «sim12345».
import * as fs from 'fs'

const DEFAULT_URL = 'file:./mauidisk-sim.db'
const PASSWORD = 'sim12345'

async function main() {
  // Se lee antes de importar nada que cargue dotenv (src/db/migrate.ts lo hace)
  const url = process.env.DATABASE_URL || DEFAULT_URL
  if (!url.startsWith('file:') || !url.endsWith('-sim.db')) {
    console.error(`db:sim: DATABASE_URL debe ser un archivo que termine en -sim.db (es «${url}»). No se hizo nada.`)
    process.exit(1)
  }
  const file = url.slice('file:'.length)
  for (const f of [file, `${file}-wal`, `${file}-shm`]) if (fs.existsSync(f)) fs.rmSync(f)

  const { createClient } = await import('@libsql/client')
  const { drizzle } = await import('drizzle-orm/libsql')
  const bcrypt = (await import('bcryptjs')).default
  const schema = await import('../src/db/schema')
  const { createSchema } = await import('../src/__tests__/helpers/db')
  const { loadSim } = await import('../src/__tests__/helpers/sim')

  const client = createClient({ url })
  await createSchema(client)
  await client.execute('PRAGMA journal_mode = WAL')
  const db = drizzle(client, { schema })
  const started = Date.now()
  const { counts } = await loadSim(db, { passwordHash: await bcrypt.hash(PASSWORD, 10) })
  client.close()
  console.log(`db:sim: ${file} creada en ${((Date.now() - started) / 1000).toFixed(1)} s`)
  console.log(Object.entries(counts).map(([k, v]) => `  ${k}: ${v}`).join('\n'))
  console.log(`  usuarios: sim-dueno, sim-encargada, sim-cajero (contraseña ${PASSWORD})`)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
