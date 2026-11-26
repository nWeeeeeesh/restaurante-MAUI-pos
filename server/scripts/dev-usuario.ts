// npm run dev:usuario -- <nombre> <contraseña>
//
// Crea (o actualiza la contraseña de) el usuario desarrollador del modo de pruebas.
// Se niega fuera del modo de pruebas: exige MAUI_MODO_PRUEBAS=1 y una DATABASE_URL
// que termine en -sim.db (las lee también de server/.env), así nunca toca mauidisk.db.
import * as dotenv from 'dotenv'
dotenv.config()

const AYUDA = 'Uso: npm run dev:usuario -- <nombre> <contraseña>   (solo con MAUI_MODO_PRUEBAS=1 y la base -sim.db)'

async function main() {
  const [nombre, clave] = process.argv.slice(2)
  if (!nombre || !clave || nombre.startsWith('-')) { console.error(AYUDA); process.exit(2) }
  const { errorModoPruebas, modoPruebas } = await import('../src/dev/modo')
  if (!modoPruebas()) {
    console.error('dev:usuario: solo en modo de pruebas (MAUI_MODO_PRUEBAS=1 en server/.env). No se hizo nada.')
    process.exit(1)
  }
  const error = errorModoPruebas()
  if (error) { console.error(`dev:usuario: ${error}. No se hizo nada.`); process.exit(1) }
  if (clave.length < 8) { console.error('dev:usuario: la contraseña debe tener al menos 8 caracteres'); process.exit(2) }

  const bcrypt = (await import('bcryptjs')).default
  const { eq } = await import('drizzle-orm')
  const { db } = await import('../src/db')
  const { users } = await import('../src/db/schema')
  const { audit } = await import('../src/services/audit')
  const passwordHash = await bcrypt.hash(clave, 10)
  const [existe] = await db.select().from(users).where(eq(users.username, nombre))
  if (existe && existe.role !== 'developer') {
    console.error(`dev:usuario: «${nombre}» ya existe con el rol ${existe.role}; elige otro nombre`)
    process.exit(1)
  }
  await db.transaction(async tx => {
    if (existe) {
      await tx.update(users).set({ passwordHash, active: true }).where(eq(users.id, existe.id))
    } else {
      await tx.insert(users).values({ name: 'Desarrollador', username: nombre, passwordHash, role: 'developer' })
    }
    const [u] = await tx.select().from(users).where(eq(users.username, nombre))
    await audit(tx, { userId: null, action: existe ? 'dev.usuario.clave' : 'dev.usuario.crear', entity: 'user', entityId: u.id, data: { username: nombre, source: 'dev:usuario' } })
  })
  console.log(`dev:usuario: ${existe ? 'contraseña actualizada para' : 'creado'} «${nombre}» (rol developer) en ${process.env.DATABASE_URL}`)
}

main().then(() => process.exit(0)).catch(e => { console.error(`dev:usuario: ${e instanceof Error ? e.message : e}`); process.exit(1) })
