// C3 «Medir cálculos» (E2 y E3 del artículo; Tabla 31 y PA-07 de la tesis): registra
// recursos cada 1 s en recursos-e2.csv, 30 s en reposo, corre `npm run perf` en un
// proceso hijo y sigue 30 s más.
import * as fs from 'fs'
import { leerJson, rutaDev } from './modo'
import { registrarRecursos } from './registro'
import { correrHijo, DIR_SERVER, esperar } from './trabajos'

export const REPOSO_MS = Number(process.env.MAUI_E2_REPOSO_MS || 30_000)

interface Medicion { p95Ms: number; limiteMs: number; cumple: boolean; medianaMs: number }
interface SalidaPerf { incremento2?: Record<string, Medicion>; incremento3?: Record<string, Medicion>; tamanoBaseMb?: number }

// Los cuatro p95 con su límite, para la pantalla
export function p95s(salida: SalidaPerf | null) {
  if (!salida) return []
  return [...Object.entries(salida.incremento2 ?? {}), ...Object.entries(salida.incremento3 ?? {})]
    .map(([operacion, m]) => ({ operacion, p95Ms: m.p95Ms, limiteMs: m.limiteMs, cumple: m.cumple }))
}

export async function medirCalculos(avance: (m: string) => void) {
  const recursos = rutaDev('recursos-e2.csv')
  const salida = rutaDev('e2-pi.json')
  fs.mkdirSync(rutaDev(''), { recursive: true })
  for (const f of [recursos, salida]) fs.rmSync(f, { force: true })
  const reg = registrarRecursos(recursos, 1000)
  try {
    avance(`Reposo: ${REPOSO_MS / 1000} s registrando recursos cada 1 s`)
    await esperar(REPOSO_MS)
    avance('npm run perf (rentabilidad, tarea nocturna y lista de compra)')
    const r = await correrHijo('npm', ['run', 'perf', '--', '--out', salida], { cwd: DIR_SERVER, alLinea: l => { if (/ms|OK|NO CUMPLE/.test(l)) avance(l.trim()) } })
    // 2 = algún tiempo supera su límite; el archivo igual queda escrito
    if (r.codigo !== 0 && r.codigo !== 2) throw new Error(`npm run perf terminó con código ${r.codigo}: ${r.salida.slice(-500)}`)
    avance(`Después: ${REPOSO_MS / 1000} s más`)
    await esperar(REPOSO_MS)
  } finally {
    reg.detener()
  }
  const datos = leerJson<SalidaPerf>(salida)
  return { p95: p95s(datos), tamanoBaseMb: datos?.tamanoBaseMb ?? null }
}
