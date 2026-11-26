// C5 «Pruebas de recuperación» (E5 del artículo, Tabla V; PA-08): respaldo ×5,
// restauración ×5 y reinicio tras una falla ×5, todo seguido. El reinicio mata el
// proceso (SIGKILL) y systemd lo levanta (RestartSec=5): la secuencia sigue al arrancar,
// guiada por la marca reinicio-pendiente.json. El avance queda en recuperacion.json
// porque sobrevive a los reinicios.
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { agregarFila, escribirJson, fechaLocal, leerJson, rutaDev } from './modo'
import { MARCA_REINICIO } from './registro'
import { correrHijo, DIR_SERVER, esperar } from './trabajos'

export const VECES = 5
// La unidad tiene StartLimitBurst=5 en 60 s: con 75 s entre cortes nunca se alcanza
export const ESPERA_ENTRE_CORTES_MS = Number(process.env.MAUI_ESPERA_CORTES_MS || 75_000)
export const backupScript = () => process.env.BACKUP_SCRIPT || '/home/mauidesk/backup.sh'
export const backupDir = () => process.env.MAUI_BACKUP_DIR || '/home/mauidesk/backups'
const tmpDir = () => (process.platform === 'win32' ? os.tmpdir() : '/tmp')

interface Marca { n: number; total: number; corteEn: number }
export interface EstadoRecuperacion { estado: 'corriendo' | 'hecho' | 'error'; fase: string; inicio: string; fin: string | null; error: string | null }

const archivoEstado = () => rutaDev('recuperacion.json')
export const estadoRecuperacion = () => leerJson<EstadoRecuperacion>(archivoEstado())
function guardar(cambios: Partial<EstadoRecuperacion>) {
  const actual = estadoRecuperacion() ?? { estado: 'corriendo', fase: '', inicio: fechaLocal(), fin: null, error: null }
  escribirJson(archivoEstado(), { ...actual, ...cambios })
}

export function ultimoRespaldo(dir = backupDir()): string | null {
  if (!fs.existsSync(dir)) return null
  const gz = fs.readdirSync(dir).filter(f => f.endsWith('.db.gz')).map(f => path.join(dir, f))
  if (gz.length === 0) return null
  return gz.reduce((a, b) => (fs.statSync(b).mtimeMs > fs.statSync(a).mtimeMs ? b : a))
}

const r1 = (n: number) => Math.round(n * 10) / 10
const r2 = (n: number) => Math.round(n * 100) / 100

async function respaldos(avance: (m: string) => void) {
  for (let n = 1; n <= VECES; n++) {
    guardar({ fase: `Respaldo ${n} de ${VECES}` })
    const r = await correrHijo('bash', [backupScript()], { cwd: DIR_SERVER })
    if (r.codigo !== 0) throw new Error(`${backupScript()} terminó con código ${r.codigo}: ${r.salida.slice(-300)}`)
    const gz = ultimoRespaldo()
    const mb = gz ? r2(fs.statSync(gz).size / 1048576) : null
    await agregarFila(rutaDev('respaldo.csv'), ['fecha_hora', 'n', 'duracion_s', 'tamano_mb', 'archivo'], [fechaLocal(), n, r1(r.ms / 1000), mb, gz ? path.basename(gz) : null])
    avance(`Respaldo ${n}: ${r1(r.ms / 1000)} s, ${mb ?? '?'} MB`)
  }
}

async function restauraciones(avance: (m: string) => void) {
  const gz = ultimoRespaldo()
  if (!gz) throw new Error(`No hay respaldos .db.gz en ${backupDir()}`)
  for (let n = 1; n <= VECES; n++) {
    guardar({ fase: `Restauración ${n} de ${VECES}` })
    const destino = path.join(tmpDir(), `maui-prueba-${n}.db`)
    const borrar = () => { for (const f of [destino, `${destino}-wal`, `${destino}-shm`]) fs.rmSync(f, { force: true }) }
    borrar()
    // Incluye la verificación de integridad (PRAGMA integrity_check) del script
    const r = await correrHijo('bash', [path.join(DIR_SERVER, 'scripts', 'restore-backup.sh'), gz, destino], { cwd: DIR_SERVER })
    borrar()
    await agregarFila(rutaDev('restauracion.csv'), ['fecha_hora', 'n', 'duracion_s', 'codigo'], [fechaLocal(), n, r1(r.ms / 1000), r.codigo])
    if (r.codigo !== 0) throw new Error(`restore-backup.sh terminó con código ${r.codigo}: ${r.salida.slice(-300)}`)
    avance(`Restauración ${n}: ${r1(r.ms / 1000)} s`)
  }
}

export function cortar(n: number) {
  escribirJson(MARCA_REINICIO(), { n, total: VECES, corteEn: Date.now() } satisfies Marca)
  guardar({ fase: `Reinicio ${n} de ${VECES}: servicio cortado` })
  process.kill(process.pid, 'SIGKILL')
}

export async function pruebasRecuperacion(avance: (m: string) => void) {
  escribirJson(archivoEstado(), { estado: 'corriendo', fase: 'Inicio', inicio: fechaLocal(), fin: null, error: null })
  try {
    await respaldos(avance)
    await restauraciones(avance)
    guardar({ fase: `Reinicio 1 de ${VECES}` })
    avance('Reinicio 1: el servicio se corta ahora y systemd lo levanta')
    await esperar(1000)
    cortar(1)
  } catch (e) {
    guardar({ estado: 'error', error: (e as Error).message, fin: fechaLocal() })
    throw e
  }
}

// Al arrancar con la marca: mide desde el corte hasta el primer 200 y sigue con el próximo
export async function reanudarRecuperacion(primer200: Date) {
  const marca = leerJson<Marca>(MARCA_REINICIO())
  if (!marca) return
  const s = r1((primer200.getTime() - marca.corteEn) / 1000)
  await agregarFila(rutaDev('reinicio.csv'), ['fecha_hora', 'n', 'duracion_s'], [fechaLocal(primer200), marca.n, s]).catch(() => undefined)
  console.log(`[dev] Reinicio ${marca.n} de ${marca.total}: ${s} s desde el corte hasta el primer 200`)
  if (marca.n >= marca.total) {
    fs.rmSync(MARCA_REINICIO(), { force: true })
    guardar({ estado: 'hecho', fase: 'Terminado', fin: fechaLocal() })
    return
  }
  guardar({ fase: `Reinicio ${marca.n} medido (${s} s); el siguiente en ${ESPERA_ENTRE_CORTES_MS / 1000} s` })
  siguienteCorte = setTimeout(() => cortar(marca.n + 1), ESPERA_ENTRE_CORTES_MS)
}

let siguienteCorte: ReturnType<typeof setTimeout> | null = null

// Detiene la secuencia de reinicios: sin marca, el próximo arranque es uno normal
export function cancelarRecuperacion() {
  if (siguienteCorte) clearTimeout(siguienteCorte)
  siguienteCorte = null
  const habia = fs.existsSync(MARCA_REINICIO())
  fs.rmSync(MARCA_REINICIO(), { force: true })
  if (estadoRecuperacion()?.estado === 'corriendo') guardar({ estado: 'error', error: 'Cancelada', fin: fechaLocal() })
  return habia
}
