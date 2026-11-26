// Jornadas simuladas (C4): una ahora (para probar) o una por día a una hora durante N
// días. La programación vive en programacion.json para seguir después de un reinicio;
// la tarea nocturna y el respaldo siguen su horario normal.
import { spawn, type ChildProcess } from 'child_process'
import * as fs from 'fs'
import * as path from 'path'
import { DomainError } from '../errors'
import { escribirJson, fechaLocal, leerJson, rutaDev } from './modo'
import { DIR_SERVER } from './trabajos'

export interface Programacion { hora: string; dias: number; desde: string; ejecutadas: string[] }

let hijo: ChildProcess | null = null
let inicioHijo: string | null = null
let temporizador: ReturnType<typeof setTimeout> | null = null

const archivoProgramacion = () => rutaDev('programacion.json')
export const programacion = () => leerJson<Programacion>(archivoProgramacion())
export const jornadaEnCurso = () => (hijo ? { pid: hijo.pid ?? null, inicio: inicioHijo } : null)

const diaLocal = (d: Date) => fechaLocal(d).slice(0, 10)
function sumarDias(fecha: string, n: number) {
  const d = new Date(`${fecha}T12:00:00`)
  d.setDate(d.getDate() + n)
  return diaLocal(d)
}

// Próxima ejecución pendiente: hoy si la hora no pasó, si no el día siguiente
export function proximaJornada(p: Programacion, ahora = new Date()): Date | null {
  const [h, m] = p.hora.split(':').map(Number)
  for (let k = 0; k < p.dias; k++) {
    const dia = sumarDias(p.desde, k)
    if (p.ejecutadas.includes(dia)) continue
    const cuando = new Date(`${dia}T00:00:00`)
    cuando.setHours(h, m, 0, 0)
    if (cuando.getTime() >= ahora.getTime() - 60_000) return cuando
  }
  return null
}

export function correrJornada(puerto: number) {
  if (hijo) throw new DomainError('Ya hay una jornada corriendo', 409, 'DEV_JORNADA_RUNNING')
  const log = fs.openSync(rutaDev(`jornada-${diaLocal(new Date())}.log`), 'a')
  const tsx = path.join(DIR_SERVER, 'node_modules', 'tsx', 'dist', 'cli.mjs')
  hijo = spawn(process.execPath, [tsx, path.join(DIR_SERVER, 'scripts', 'jornada.ts'), '--puerto', String(puerto)], {
    cwd: DIR_SERVER, env: process.env, stdio: ['ignore', log, log],
  })
  inicioHijo = fechaLocal()
  hijo.on('exit', () => { hijo = null; inicioHijo = null; fs.closeSync(log) })
  hijo.unref()
  return jornadaEnCurso()
}

export function detenerJornada() {
  if (!hijo) return false
  hijo.kill('SIGTERM')
  return true
}

export function programarJornadas(puerto: number, p?: Programacion | null) {
  if (p !== undefined) {
    if (p) escribirJson(archivoProgramacion(), p)
    else fs.rmSync(archivoProgramacion(), { force: true })
  }
  if (temporizador) clearTimeout(temporizador)
  temporizador = null
  const actual = programacion()
  if (!actual) return null
  const cuando = proximaJornada(actual)
  if (!cuando) return null
  // Se revisa como mucho cada 6 h (los temporizadores largos se desbordan)
  const ms = Math.min(Math.max(0, cuando.getTime() - Date.now()), 6 * 3600_000)
  temporizador = setTimeout(() => {
    const prog = programacion()
    const dia = diaLocal(new Date())
    const toca = prog && proximaJornada(prog)?.getTime() === cuando.getTime() && Date.now() >= cuando.getTime() - 1000
    if (prog && toca) {
      escribirJson(archivoProgramacion(), { ...prog, ejecutadas: [...prog.ejecutadas, dia] })
      try { correrJornada(puerto) } catch (e) { console.log(`[dev] Jornada programada no corrió: ${(e as Error).message}`) }
    }
    programarJornadas(puerto)
  }, ms)
  temporizador.unref()
  return cuando
}
