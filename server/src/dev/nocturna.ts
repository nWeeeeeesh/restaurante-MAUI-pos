// Tarea nocturna real (PA-08): la corre una vez por el mismo camino que la programación
// de las 23:30 (correrNoche de jobs/nightly) y comprueba que deja su fila ok en
// forecast_runs. Se corre para hoy si hoy es día de atención (la jornada simulada vende
// hoy) o, si no, para la última noche de atención.
import { and, eq } from 'drizzle-orm'
import { db } from '../db'
import { forecastRuns } from '../db/schema'
import { anteriorAtencion, atiende } from '../domain/calendar'
import { correrNoche } from '../jobs/nightly'
import { calendarioHasta } from '../services/forecast.service'
import { limaDate } from '../utils/dates'
import { currentLocalId } from '../utils/local'
import { escribirJson, fechaLocal, rutaDev } from './modo'

export async function tareaNocturna(avance: (m: string) => void) {
  const localId = currentLocalId()
  const hoy = limaDate(new Date())
  const cal = await calendarioHasta(db, { localId, hasta: hoy })
  const noche = atiende(cal, hoy) ? hoy : anteriorAtencion(cal, hoy)
  avance(`Tarea nocturna para la noche del ${noche}, por el mismo camino que la de las 23:30`)
  const t = Date.now()
  const resultado = await correrNoche(db, localId, noche)
  const ms = Date.now() - t
  const runs = await db.select().from(forecastRuns).where(and(eq(forecastRuns.localId, localId), eq(forecastRuns.madeOn, noche)))
  const ok = runs.some(r => r.status === 'ok')
  const datos = { fecha: fechaLocal(), madeOn: noche, ms, ok, resultado: resultado ?? null, runs }
  escribirJson(rutaDev('nocturna.json'), datos)
  if (!ok) throw new Error(`La tarea nocturna del ${noche} no dejó una fila ok en forecast_runs`)
  avance(`Terminó en ${ms} ms con estado ok`)
  return { madeOn: noche, ms, ok }
}
