// npm run perf — tiempos de respuesta del cálculo (RNF09, plan-sistema T12 y T18) con
// la base simulada (npm run db:sim). Guarda la mediana y el p95 de 20 repeticiones en
// docs/tesis/rendimiento.json, conservando las secciones que no mide esta ejecución.
// La medición en la Raspberry Pi es la prueba de aceptación PA-07 (manual).
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'

const DEFAULT_URL = 'file:./mauidisk-sim.db'
const REPS = 20
const OUT = path.join(__dirname, '..', '..', 'docs', 'tesis', 'rendimiento.json')

export interface Medicion {
  repeticiones: number
  medianaMs: number
  p95Ms: number
  minMs: number
  maxMs: number
  limiteMs: number
  cumple: boolean
}

function percentil(sorted: number[], p: number): number {
  // Método del rango más cercano: el valor en la posición ⌈p·n⌉
  return sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)]
}

export async function medir(fn: () => Promise<unknown>, limiteMs: number, reps = REPS): Promise<Medicion> {
  await fn() // calentamiento: no cuenta
  const t: number[] = []
  for (let k = 0; k < reps; k++) {
    const start = process.hrtime.bigint()
    await fn()
    t.push(Number(process.hrtime.bigint() - start) / 1e6)
  }
  t.sort((a, b) => a - b)
  const r = (n: number) => Math.round(n * 10) / 10
  const p95 = percentil(t, 0.95)
  return { repeticiones: reps, medianaMs: r(percentil(t, 0.5)), p95Ms: r(p95), minMs: r(t[0]), maxMs: r(t[t.length - 1]), limiteMs, cumple: p95 <= limiteMs }
}

async function main() {
  const url = process.env.DATABASE_URL || DEFAULT_URL
  if (!url.startsWith('file:') || !url.endsWith('-sim.db')) {
    console.error(`perf: se mide solo con la base simulada (-sim.db); DATABASE_URL es «${url}».`)
    process.exit(1)
  }
  if (!fs.existsSync(url.slice('file:'.length))) {
    console.error('perf: no existe la base simulada. Corre antes `npm run db:sim`.')
    process.exit(1)
  }
  process.env.DATABASE_URL = url
  const { db } = await import('../src/db')
  const { obtenerRentabilidad } = await import('../src/services/profitability.service')

  const mes = await medir(() => obtenerRentabilidad(db, { localId: 1, from: '2026-08-01', to: '2026-08-31', groupBy: 'week' }), 3000)
  const semanas = await medir(() => obtenerRentabilidad(db, { localId: 1, from: '2026-06-16', to: '2026-09-06', groupBy: 'week' }), 3000)

  const previo = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf-8')) : {}
  const salida = {
    ...previo,
    equipo: { plataforma: `${os.platform()} ${os.release()}`, cpu: os.cpus()[0]?.model ?? '?', nucleos: os.cpus().length, node: process.version },
    medidoEn: new Date().toISOString(),
    datos: 'fixtures/sim12 (72 días de atención, npm run db:sim)',
    incremento2: {
      'obtenerRentabilidad (agosto, por semana)': mes,
      'obtenerRentabilidad (12 semanas, por semana)': semanas,
    },
  }
  fs.mkdirSync(path.dirname(OUT), { recursive: true })
  fs.writeFileSync(OUT, JSON.stringify(salida, null, 2) + '\n')
  for (const [k, v] of Object.entries(salida.incremento2)) {
    console.log(`${k}: mediana ${v.medianaMs} ms · p95 ${v.p95Ms} ms (límite ${v.limiteMs} ms) ${v.cumple ? 'OK' : 'NO CUMPLE'}`)
  }
  if (!mes.cumple || !semanas.cumple) process.exit(2)
}

if (require.main === module) {
  main().catch(err => {
    console.error(err)
    process.exit(1)
  })
}
