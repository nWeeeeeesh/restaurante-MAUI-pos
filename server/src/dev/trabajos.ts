// Trabajos de la pantalla «Desarrollador»: uno a la vez, con su avance visible. Lo
// pesado corre en procesos hijo para no frenar al POS.
import { spawn } from 'child_process'
import * as fs from 'fs'
import * as path from 'path'
import { DomainError } from '../errors'
import { fechaLocal } from './modo'

export const DIR_SERVER = path.join(__dirname, '..', '..')
export const DIR_REPO = path.join(DIR_SERVER, '..')

export interface Trabajo {
  tipo: string
  estado: 'corriendo' | 'hecho' | 'error'
  inicio: string
  fin: string | null
  avance: string[]
  error: string | null
  resultado: unknown
}

const ultimos = new Map<string, Trabajo>()
const promesas = new WeakMap<Trabajo, Promise<void>>()
let enCurso: Trabajo | null = null

// Se resuelve cuando el trabajo termina, bien o con error (el estado queda en el trabajo)
export const terminado = (t: Trabajo) => promesas.get(t) ?? Promise.resolve()

export const trabajos = () => Object.fromEntries(ultimos)
export const trabajoEnCurso = () => enCurso

export function iniciarTrabajo(tipo: string, fn: (avance: (m: string) => void) => Promise<unknown>): Trabajo {
  if (enCurso) throw new DomainError(`Ya está corriendo «${enCurso.tipo}»; espera a que termine`, 409, 'DEV_JOB_RUNNING')
  const t: Trabajo = { tipo, estado: 'corriendo', inicio: fechaLocal(), fin: null, avance: [], error: null, resultado: null }
  ultimos.set(tipo, t)
  enCurso = t
  const avance = (m: string) => { t.avance.push(`${fechaLocal().slice(11)} ${m}`); if (t.avance.length > 200) t.avance.shift() }
  const p = fn(avance)
    .then(r => { t.estado = 'hecho'; t.resultado = r ?? null })
    .catch(e => { t.estado = 'error'; t.error = e instanceof Error ? e.message : String(e) })
    .finally(() => { t.fin = fechaLocal(); if (enCurso === t) enCurso = null })
  promesas.set(t, p)
  return t
}

export const esperar = (ms: number) => new Promise<void>(r => setTimeout(r, ms))

export interface Hijo { codigo: number | null; salida: string; ms: number }

// npm y npx son .cmd en Windows: ahí necesitan la shell
export function correrHijo(cmd: string, args: string[], opts: { cwd?: string; env?: NodeJS.ProcessEnv; archivo?: string; alLinea?: (l: string) => void } = {}): Promise<Hijo> {
  return new Promise((resolve, reject) => {
    const inicio = Date.now()
    const p = spawn(cmd, args, { cwd: opts.cwd ?? DIR_SERVER, env: opts.env ?? process.env, shell: process.platform === 'win32' && /^(npm|npx)$/.test(cmd) })
    let salida = ''
    let resto = ''
    const out = opts.archivo ? fs.createWriteStream(opts.archivo) : null
    const recibir = (d: Buffer) => {
      const s = d.toString()
      salida += s
      if (salida.length > 2_000_000) salida = salida.slice(-1_000_000)
      out?.write(s)
      if (opts.alLinea) {
        const lineas = (resto + s).split(/\r?\n/)
        resto = lineas.pop() ?? ''
        for (const l of lineas) if (l.trim()) opts.alLinea(l)
      }
    }
    p.stdout.on('data', recibir)
    p.stderr.on('data', recibir)
    p.on('error', reject)
    p.on('close', codigo => { out?.end(); resolve({ codigo, salida, ms: Date.now() - inicio }) })
  })
}
