// C7 «Correr pruebas automatizadas» (Capítulo IV de la tesis): `npm run ci` y
// `npm run report:tesis` en la Pi, en procesos hijo. El entorno de las pruebas no hereda
// la base del servicio: DATABASE_URL apunta a un archivo temporal -sim.db que se borra
// al final, así nunca se toca la base simulada en uso ni se crea mauidisk.db.
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { escribirJson, fechaLocal, rutaDev } from './modo'
import { correrHijo, DIR_REPO, DIR_SERVER } from './trabajos'

export function entornoPruebas(base: NodeJS.ProcessEnv = process.env) {
  const tmp = path.join(os.tmpdir(), `maui-ci-${Date.now()}-sim.db`)
  // dotenv no pisa lo que ya está definido: MAUI_MODO_PRUEBAS=0 evita que lo lea del .env
  const env: NodeJS.ProcessEnv = { ...base, DATABASE_URL: `file:${tmp.replace(/\\/g, '/')}`, MAUI_MODO_PRUEBAS: '0' }
  for (const k of ['PORT', 'MAUI_DEV_DIR', 'PRINTER_HOST', 'PRINTER_PORT', 'PRINTER_TYPE']) delete env[k]
  return { env, tmp }
}

// Totales de Vitest: «Tests  248 passed (248)» o «Tests  2 failed | 246 passed (248)»
export function totalesVitest(salida: string) {
  const m = [...salida.matchAll(/^\s*Tests\s+(.+)\((\d+)\)\s*$/gm)].pop()
  if (!m) return null
  const fallidas = Number(m[1].match(/(\d+) failed/)?.[1] ?? 0)
  return { total: Number(m[2]), fallidas }
}

export async function correrPruebas(avance: (m: string) => void) {
  const { env, tmp } = entornoPruebas()
  const salidaCi = rutaDev('pruebas-ci.txt')
  const salidaReporte = rutaDev('pruebas-report-tesis.txt')
  fs.mkdirSync(rutaDev(''), { recursive: true })
  try {
    avance('npm run ci (servidor: tsc, vitest, eslint; cliente: tsc, eslint)')
    const ci = await correrHijo('npm', ['run', 'ci'], { cwd: DIR_REPO, env, archivo: salidaCi, alLinea: l => { if (/Test Files|Tests\s|problems|FAIL/.test(l)) avance(l.trim()) } })
    avance(`npm run ci terminó con código ${ci.codigo} en ${Math.round(ci.ms / 1000)} s`)
    avance('npm run report:tesis')
    const rep = await correrHijo('npm', ['run', 'report:tesis', '--', '--out', rutaDev('evidencias.md')], { cwd: DIR_SERVER, env, archivo: salidaReporte })
    avance(`npm run report:tesis terminó con código ${rep.codigo}`)
    const t = totalesVitest(ci.salida)
    const resumen = {
      fecha: fechaLocal(), ciCodigo: ci.codigo, reporteCodigo: rep.codigo, total: t?.total ?? null, fallidas: t?.fallidas ?? null,
      duracionCiS: Math.round(ci.ms / 1000), duracionReporteS: Math.round(rep.ms / 1000),
    }
    escribirJson(rutaDev('pruebas.json'), resumen)
    return resumen
  } finally {
    for (const f of [tmp, `${tmp}-wal`, `${tmp}-shm`]) fs.rmSync(f, { force: true })
  }
}
