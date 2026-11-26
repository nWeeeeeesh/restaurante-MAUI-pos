// Jornada simulada (E5): el día de sim12 con más boletas, comprimido (por defecto 60
// veces), contra el propio servicio en un proceso hijo. Mientras corre se registran los
// recursos cada 1 s en recursos-jornada.csv. Cada corrida reemplaza la anterior: tesis y
// artículo se miden en una sola corrida, no a lo largo de días.
import { spawn, type ChildProcess } from 'child_process'
import * as fs from 'fs'
import * as path from 'path'
import { DomainError } from '../errors'
import { fechaLocal, leerJson, rutaDev } from './modo'
import { registrarRecursos } from './registro'
import { DIR_SERVER } from './trabajos'

export const FACTOR_JORNADA = () => Number(process.env.MAUI_JORNADA_FACTOR || 60)

export interface ResumenJornada {
  estado: string
  inicio: string
  fin: string
  factor: number
  pedidos: number
  operaciones: number
  errores: number
  duracionMin: number
  p95PedidoMs: number | null
  p95CobroMs: number | null
  boletas?: number
  porAccion: Record<string, { n: number; medianaMs: number | null; p95Ms: number | null }>
}

let hijo: ChildProcess | null = null
let inicioHijo: string | null = null

export const jornadaEnCurso = () => (hijo ? { pid: hijo.pid ?? null, inicio: inicioHijo } : null)
export const resumenJornada = () => leerJson<ResumenJornada>(rutaDev('jornada-resumen.json'))

// Lanza el proceso hijo y devuelve una promesa que se resuelve cuando termina
export function correrJornada(puerto: number, factor = FACTOR_JORNADA()): Promise<number | null> {
  if (hijo) throw new DomainError('Ya hay una jornada corriendo', 409, 'DEV_JORNADA_RUNNING')
  fs.mkdirSync(rutaDev(''), { recursive: true })
  for (const f of ['jornada.csv', 'jornada-resumen.json']) fs.rmSync(rutaDev(f), { force: true })
  const log = fs.openSync(rutaDev('jornada.log'), 'w')
  const tsx = path.join(DIR_SERVER, 'node_modules', 'tsx', 'dist', 'cli.mjs')
  const h = spawn(process.execPath, [tsx, path.join(DIR_SERVER, 'scripts', 'jornada.ts'), '--puerto', String(puerto), '--factor', String(factor)], {
    cwd: DIR_SERVER, env: process.env, stdio: ['ignore', log, log],
  })
  hijo = h
  inicioHijo = fechaLocal()
  return new Promise(resolve => {
    h.on('exit', codigo => { hijo = null; inicioHijo = null; fs.closeSync(log); resolve(codigo) })
  })
}

export function detenerJornada() {
  if (!hijo) return false
  hijo.kill('SIGTERM')
  return true
}

// Trabajo «Jornada simulada»: recursos cada 1 s mientras dura la jornada
export async function jornadaSimulada(puerto: number, avance: (m: string) => void) {
  const recursos = rutaDev('recursos-jornada.csv')
  fs.rmSync(recursos, { force: true })
  const factor = FACTOR_JORNADA()
  const reg = registrarRecursos(recursos, 1000)
  let codigo: number | null
  try {
    avance(`Día de más boletas de sim12, comprimido ${factor} veces, con recursos cada 1 s`)
    codigo = await correrJornada(puerto, factor)
  } finally {
    reg.detener()
  }
  const r = resumenJornada()
  if (codigo !== 0 || !r || r.estado !== 'terminada') {
    const log = fs.existsSync(rutaDev('jornada.log')) ? fs.readFileSync(rutaDev('jornada.log'), 'utf-8').slice(-500) : ''
    throw new Error(`La jornada no terminó (código ${codigo}, estado ${r?.estado ?? 'sin resumen'}): ${log}`)
  }
  avance(`${r.operaciones} operaciones en ${r.duracionMin} min; p95 pedido ${r.p95PedidoMs} ms, cobro ${r.p95CobroMs} ms; ${r.errores} errores`)
  return r
}
