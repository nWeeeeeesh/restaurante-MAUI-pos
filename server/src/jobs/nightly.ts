// Tarea nocturna del pronóstico (plan-sistema T15): cada día de atención a las 23:30 de
// Lima genera los pronósticos de esa noche. Al arrancar, si falta la de la noche
// anterior, la corre. En el mismo proceso, sin dependencias nuevas. NIGHTLY_JOBS=off la
// apaga (los tests). La arranca index.ts, no app.ts.
import { and, eq } from 'drizzle-orm'
import { db as defaultDb, type DB } from '../db'
import { forecastRuns } from '../db/schema'
import { generarPronosticos, calendarioHasta } from '../services/forecast.service'
import { anteriorAtencion, atiende } from '../domain/calendar'
import { limaDate } from '../utils/dates'

// 23:30 en Lima (UTC−5, sin horario de verano) = 04:30 UTC del día siguiente
const HORA_UTC = 4
const MINUTO_UTC = 30

export function proximaEjecucion(now: Date): Date {
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), HORA_UTC, MINUTO_UTC))
  if (next.getTime() <= now.getTime()) next.setUTCDate(next.getUTCDate() + 1)
  return next
}

async function yaCorrio(db: DB, localId: number, madeOn: string) {
  const rows = await db.select({ id: forecastRuns.id }).from(forecastRuns)
    .where(and(eq(forecastRuns.localId, localId), eq(forecastRuns.madeOn, madeOn), eq(forecastRuns.status, 'ok')))
  return rows.length > 0
}

// La noche `madeOn` si fue día de atención (un lunes cerrado no se pronostica)
export async function correrNoche(db: DB, localId: number, madeOn: string) {
  const cal = await calendarioHasta(db, { localId, hasta: madeOn })
  if (!atiende(cal, madeOn)) return null
  return generarPronosticos(db, { localId, madeOn })
}

// Al arrancar: la última noche de atención ya cerrada, si no tiene una ejecución correcta
export async function ponerseAlDia(db: DB, localId: number, now: Date) {
  const hoy = limaDate(now)
  const lima = new Date(now.getTime() - 5 * 3_600_000)
  const pasoLaHora = lima.getUTCHours() * 60 + lima.getUTCMinutes() >= 23 * 60 + 30
  const cal = await calendarioHasta(db, { localId, hasta: hoy })
  // Después de las 23:30 la noche pendiente es la de hoy; antes, la anterior
  const noche = pasoLaHora && atiende(cal, hoy) ? hoy : anteriorAtencion(cal, hoy)
  if (await yaCorrio(db, localId, noche)) return null
  return generarPronosticos(db, { localId, madeOn: noche })
}

export function iniciarTareaNocturna(opts: { db?: DB; localId: number; now?: () => Date; log?: (msg: string) => void }) {
  if ((process.env.NIGHTLY_JOBS ?? '').toLowerCase() === 'off') return null
  const db = opts.db ?? defaultDb
  const now = opts.now ?? (() => new Date())
  const log = opts.log ?? ((m: string) => console.log(m))
  let timer: ReturnType<typeof setTimeout> | null = null

  const ejecutar = async (que: () => Promise<unknown>, etiqueta: string) => {
    try {
      const r = await que()
      if (r) log(`[nightly] ${etiqueta}: ${JSON.stringify(r)}`)
    } catch (e) {
      // Queda en forecast_runs con status 'error'; el servidor sigue
      log(`[nightly] ${etiqueta} falló: ${(e as Error).message}`)
    }
  }

  const programar = () => {
    const at = proximaEjecucion(now())
    timer = setTimeout(async () => {
      await ejecutar(() => correrNoche(db, opts.localId, limaDate(now())), 'pronóstico de la noche')
      programar()
    }, Math.max(1000, at.getTime() - now().getTime()))
    timer.unref?.()
  }

  void ejecutar(() => ponerseAlDia(db, opts.localId, now()), 'puesta al día')
  programar()
  return { detener: () => { if (timer) clearTimeout(timer) } }
}
