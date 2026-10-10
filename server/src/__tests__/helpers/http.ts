import { createClient } from '@libsql/client'
import jwt from 'jsonwebtoken'
import { tempDbUrl, createSchema } from './db'

type Role = 'owner' | 'manager' | 'cashier' | 'waiter'

// Prepara la app para tests HTTP con una BD temporal propia.
//
// `db` (src/db/index.ts) es un singleton que lee DATABASE_URL al importarse, por
// eso app y db se importan dinámicamente DESPUÉS de fijar el entorno. Vitest aísla
// los módulos por archivo de test, así que cada archivo obtiene su propia BD.
// Regla: un archivo de test HTTP no debe importar estáticamente nada que importe src/db.
export async function setupHttpApp() {
  const url = tempDbUrl()
  process.env.DATABASE_URL = url
  process.env.JWT_SECRET = 'test-secret-de-al-menos-32-caracteres-para-jwt'

  const client = createClient({ url })
  await createSchema(client)
  client.close()

  const { createApp } = await import('../../app')
  const { db } = await import('../../db')
  const schema = await import('../../db/schema')
  const app = createApp({ allowedOrigins: '*', serveClient: false })

  let seq = 0
  // Crea un usuario real con ese rol y devuelve su header Authorization.
  async function as(role: Role, name = `Usuario ${role}`) {
    seq++
    const [user] = await db.insert(schema.users).values({
      name,
      username: `${role}${seq}`,
      passwordHash: 'x',
      role: role as never,
    }).returning()
    const token = jwt.sign(
      { id: user.id, username: user.username, role: user.role, name: user.name },
      process.env.JWT_SECRET!,
      { expiresIn: '1h' },
    )
    return { user, token, auth: `Bearer ${token}` }
  }

  return { app, db, schema, as }
}
