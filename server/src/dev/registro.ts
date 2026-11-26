// Registro continuo del modo de pruebas (C1): recursos cada 10 s, un latido por minuto
// y una fila por arranque. Temporizadores con unref() (no retienen el proceso) y
// lecturas asíncronas; un error de lectura deja el campo vacío y no corta el registro.
import * as fs from 'fs'
import * as http from 'http'
import { agregarFila, fechaLocal, rutaDev } from './modo'
import { CABECERA_RECURSOS, fuentesPorDefecto, muestra, tiemposCpu, uptimeS, type Fuentes, type TiemposCpu } from './sistema'

export interface Registro { detener: () => void }

export function registrarRecursos(archivo: string, intervaloMs: number, f: Fuentes = fuentesPorDefecto()): Registro {
  let antes: TiemposCpu | null = null
  let ocupado = false
  void tiemposCpu(f).then(c => { antes = c }, () => undefined)
  const tick = async () => {
    if (ocupado) return
    ocupado = true
    try {
      const { fila, cpu } = await muestra(f, antes, fechaLocal())
      antes = cpu
      await agregarFila(archivo, CABECERA_RECURSOS, fila)
    } catch {
      // Un fallo al escribir no detiene el registro: la siguiente muestra lo intenta otra vez
    } finally {
      ocupado = false
    }
  }
  const t = setInterval(() => void tick(), intervaloMs)
  t.unref()
  return { detener: () => clearInterval(t) }
}

// Un minuto sin latido es un minuto sin servicio
export function registrarLatidos(archivo = rutaDev('latidos.csv'), intervaloMs = 60_000): Registro {
  const latido = () => agregarFila(archivo, ['fecha_hora'], [fechaLocal()]).catch(() => undefined)
  void latido()
  const t = setInterval(() => void latido(), intervaloMs)
  t.unref()
  return { detener: () => clearInterval(t) }
}

function salud(puerto: number): Promise<number> {
  return new Promise(resolve => {
    const req = http.get({ host: '127.0.0.1', port: puerto, path: '/api/health', timeout: 2000 }, res => {
      res.resume()
      resolve(res.statusCode ?? 0)
    })
    req.on('error', () => resolve(0))
    req.on('timeout', () => { req.destroy(); resolve(0) })
  })
}

export const MARCA_REINICIO = () => rutaDev('reinicio-pendiente.json')

// Con el primer 200 de su propio /api/health guarda el uptime del sistema. `motivo` es
// prueba_reinicio si la marca de C5 existe; si no, arranque.
export async function registrarArranque(puerto: number, f: Fuentes = fuentesPorDefecto()): Promise<{ primer200: Date; motivo: string } | null> {
  const limite = Date.now() + 120_000
  while (Date.now() < limite) {
    if (await salud(puerto) === 200) {
      const primer200 = new Date()
      const motivo = fs.existsSync(MARCA_REINICIO()) ? 'prueba_reinicio' : 'arranque'
      const uptime = await uptimeS(f).catch(() => null)
      await agregarFila(rutaDev('arranques.csv'), ['fecha_hora', 'uptime_s', 'motivo'], [fechaLocal(primer200), uptime, motivo]).catch(() => undefined)
      return { primer200, motivo }
    }
    await new Promise(r => setTimeout(r, 200).unref())
  }
  return null
}
