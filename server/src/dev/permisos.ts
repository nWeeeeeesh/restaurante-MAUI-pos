// C6 «Verificar permisos» (PA-08): inicia sesión por la API con cada rol del simulador
// y prueba un endpoint de lectura por pantalla. Guarda la matriz rol × endpoint en
// permisos.json y marca lo que no coincide con la regla.
import bcrypt from 'bcryptjs'
import { eq } from 'drizzle-orm'
import { db } from '../db'
import { users } from '../db/schema'
import { escribirJson, fechaLocal, rutaDev } from './modo'

export const CLAVE_SIM = process.env.MAUI_SIM_CLAVE || 'sim12345'

export const ROLES_SIM = [
  { rol: 'owner', usuario: 'sim-dueno' },
  { rol: 'manager', usuario: 'sim-encargada' },
  { rol: 'cashier', usuario: 'sim-cajero' },
  { rol: 'waiter', usuario: 'sim-mozo' },
] as const

// Regla de PA-08: el mozo no ve Rentabilidad, Recetas ni Lista de compra; el cajero y
// el encargado no ven Rentabilidad ni Recetas. Inventario y Lista de compra son del
// dueño y del encargado; el POS, de todos.
export const ENDPOINTS = [
  { pantalla: 'Rentabilidad', ruta: '/api/profitability?from=2026-08-01&to=2026-08-31', permitidos: ['owner'] },
  { pantalla: 'Recetas', ruta: '/api/recipes', permitidos: ['owner'] },
  { pantalla: 'Lista de compra', ruta: '/api/forecast/purchase-list?date=2026-09-08', permitidos: ['owner', 'manager'] },
  { pantalla: 'Inventario', ruta: '/api/inventory/daily/2026-09-06', permitidos: ['owner', 'manager'] },
  { pantalla: 'POS', ruta: '/api/orders/active', permitidos: ['owner', 'manager', 'cashier', 'waiter'] },
] as const

async function crearMozoSiFalta() {
  const [u] = await db.select().from(users).where(eq(users.username, 'sim-mozo'))
  if (u) return false
  await db.insert(users).values({ name: 'Mozo', username: 'sim-mozo', passwordHash: await bcrypt.hash(CLAVE_SIM, 10), role: 'waiter' })
  return true
}

export async function login(base: string, usuario: string, clave = CLAVE_SIM): Promise<string> {
  const r = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: usuario, password: clave }) })
  if (r.status !== 200) throw new Error(`No se pudo iniciar sesión como ${usuario} (HTTP ${r.status})`)
  return ((await r.json()) as { token: string }).token
}

export async function verificarPermisos(base: string, avance: (m: string) => void = () => undefined) {
  if (await crearMozoSiFalta()) avance('Creado el usuario sim-mozo (mozo)')
  const matriz: { rol: string; usuario: string; pantalla: string; ruta: string; codigo: number; esperado: number; coincide: boolean }[] = []
  for (const { rol, usuario } of ROLES_SIM) {
    const token = await login(base, usuario)
    for (const e of ENDPOINTS) {
      const r = await fetch(`${base}${e.ruta}`, { headers: { Authorization: `Bearer ${token}` } })
      await r.arrayBuffer()
      const esperado = (e.permitidos as readonly string[]).includes(rol) ? 200 : 403
      matriz.push({ rol, usuario, pantalla: e.pantalla, ruta: e.ruta.split('?')[0], codigo: r.status, esperado, coincide: r.status === esperado })
    }
    avance(`${usuario}: ${matriz.filter(m => m.usuario === usuario).map(m => `${m.pantalla} ${m.codigo}`).join(', ')}`)
  }
  const salida = { fecha: fechaLocal(), regla: 'PA-08', todoCoincide: matriz.every(m => m.coincide), matriz }
  escribirJson(rutaDev('permisos.json'), salida)
  return salida
}
