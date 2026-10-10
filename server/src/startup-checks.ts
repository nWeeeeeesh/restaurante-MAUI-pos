import bcrypt from 'bcryptjs'
import { inArray } from 'drizzle-orm'
import { db } from './db'
import { users } from './db/schema'

// Avisos de arranque: no detienen el servidor, pero dejan constancia en el log
// (journalctl) de configuraciones riesgosas.

// M4 / TD-27: "hoy", los reportes y las horas impresas usan la zona del proceso.
// En producción debe ser America/Lima (UTC-5, sin horario de verano).
export function checkTimezone() {
  const offset = new Date().getTimezoneOffset()
  if (offset !== 300) {
    console.warn(
      `[startup] ATENCIÓN: la zona horaria del proceso es UTC${offset <= 0 ? '+' : '-'}${Math.abs(offset) / 60}, ` +
      'no la de Lima (UTC-5). "Hoy", los reportes y las horas de los tickets se desplazarán. ' +
      'Configura TZ=America/Lima en la unidad systemd.',
    )
  }
}

// M9 / TD-15: las cuentas seed tienen contraseñas publicadas en el repositorio.
const SEED_CREDENTIALS: Record<string, string> = { admin: 'admin123', cajero: 'cajero123', mozo1: 'mozo123' }

export async function checkDefaultPasswords() {
  try {
    const rows = await db.select().from(users).where(inArray(users.username, Object.keys(SEED_CREDENTIALS)))
    const exposed: string[] = []
    for (const u of rows) {
      if (u.active !== false && await bcrypt.compare(SEED_CREDENTIALS[u.username], u.passwordHash)) exposed.push(u.username)
    }
    if (exposed.length > 0) {
      console.warn(`[startup] ATENCIÓN: estas cuentas conservan la contraseña por defecto: ${exposed.join(', ')}. Cámbialas desde Usuarios.`)
    }
  } catch (e: any) {
    console.warn('[startup] no se pudo revisar contraseñas por defecto:', e?.message ?? e)
  }
}
