// Lecturas del sistema de la Raspberry Pi para el registro de recursos (C1). Todas son
// asíncronas y tolerantes: una lectura que falla deja su campo vacío. `raiz` y
// `vcgencmd` se pueden cambiar para las pruebas (/proc y vcgencmd simulados).
import { execFile } from 'child_process'
import * as fs from 'fs'
import * as path from 'path'

export interface Fuentes {
  raiz: string        // prefijo de /proc y /sys
  vcgencmd: string[]  // comando y argumentos previos
}

export const fuentesPorDefecto = (): Fuentes => ({
  raiz: process.env.MAUI_SISTEMA_RAIZ || '/',
  vcgencmd: [process.env.MAUI_VCGENCMD || 'vcgencmd'],
})

const leer = (f: Fuentes, ruta: string) => fs.promises.readFile(path.join(f.raiz, ruta), 'utf-8')

function vcgencmd(f: Fuentes, ...args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(f.vcgencmd[0], [...f.vcgencmd.slice(1), ...args], { timeout: 3000 }, (err, out) => (err ? reject(err) : resolve(String(out))))
  })
}

const r1 = (n: number) => Math.round(n * 10) / 10
const r2 = (n: number) => Math.round(n * 100) / 100

export interface TiemposCpu { total: number; ocioso: number }

export async function tiemposCpu(f: Fuentes): Promise<TiemposCpu> {
  const linea = (await leer(f, 'proc/stat')).split('\n').find(l => l.startsWith('cpu '))
  if (!linea) throw new Error('sin línea cpu en /proc/stat')
  const v = linea.trim().split(/\s+/).slice(1, 9).map(Number)
  return { total: v.reduce((a, b) => a + b, 0), ocioso: v[3] + (v[4] ?? 0) }
}

export function cpuPct(antes: TiemposCpu, ahora: TiemposCpu): number | null {
  const dt = ahora.total - antes.total
  if (dt <= 0) return null
  return r1(100 * (1 - (ahora.ocioso - antes.ocioso) / dt))
}

export async function memDisponibleMb(f: Fuentes): Promise<number> {
  const m = (await leer(f, 'proc/meminfo')).match(/^MemAvailable:\s+(\d+)\s*kB/m)
  if (!m) throw new Error('sin MemAvailable')
  return r1(Number(m[1]) / 1024)
}

export async function tempC(f: Fuentes): Promise<number> {
  const v = Number((await leer(f, 'sys/class/thermal/thermal_zone0/temp')).trim())
  if (!Number.isFinite(v)) throw new Error('temperatura inválida')
  return r1(v / 1000)
}

export async function throttled(f: Fuentes): Promise<string> {
  const m = (await vcgencmd(f, 'get_throttled')).match(/throttled=(0x[0-9a-f]+)/i)
  if (!m) throw new Error('salida de get_throttled inválida')
  return m[1]
}

// Disco que contiene la partición raíz: mmcblk0p2 → mmcblk0, nvme0n1p2 → nvme0n1, sda2 → sda
export function discoDe(particion: string): string {
  const m = particion.match(/^(mmcblk\d+|nvme\d+n\d+|loop\d+)p\d+$/)
  if (m) return m[1]
  return particion.replace(/^([a-z]+)\d+$/, '$1')
}

let discoRaiz: string | null = null
async function nombreDiscoRaiz(f: Fuentes, diskstats: string): Promise<string> {
  if (process.env.MAUI_DISCO) return process.env.MAUI_DISCO
  if (discoRaiz && f.raiz === '/') return discoRaiz
  const montaje = (await leer(f, 'proc/self/mountinfo')).split('\n').map(l => l.split(' ')).find(c => c[4] === '/')
  if (!montaje) throw new Error('sin montaje de /')
  const [mayor, menor] = montaje[2].split(':')
  const fila = diskstats.split('\n').map(l => l.trim().split(/\s+/)).find(c => c[0] === mayor && c[1] === menor)
  // /dev/root u otro alias: el número de dispositivo lo resuelve
  const nombre = discoDe(fila?.[2] ?? '')
  if (!nombre) throw new Error('disco raíz no encontrado')
  if (f.raiz === '/') discoRaiz = nombre
  return nombre
}

// Sectores escritos (campo 10 de /proc/diskstats), acumulado desde el arranque
export async function sectoresEscritos(f: Fuentes): Promise<number> {
  const diskstats = await leer(f, 'proc/diskstats')
  const disco = await nombreDiscoRaiz(f, diskstats)
  const c = diskstats.split('\n').map(l => l.trim().split(/\s+/)).find(x => x[2] === disco)
  if (!c) throw new Error(`sin ${disco} en /proc/diskstats`)
  return Number(c[9])
}

// Suma de voltaje × corriente de los rieles del PMIC (vcgencmd pmic_read_adc)
export function potenciaDe(salida: string): number | null {
  const a = new Map<string, number>()
  const v = new Map<string, number>()
  for (const m of salida.matchAll(/^\s*(\S+)_([AV])\s+\w+\(\d+\)=([\d.]+)[AV]\s*$/gm)) {
    (m[2] === 'A' ? a : v).set(m[1], Number(m[3]))
  }
  let total = 0
  let rieles = 0
  for (const [riel, amp] of a) {
    const volt = v.get(riel)
    if (volt === undefined) continue
    total += volt * amp
    rieles++
  }
  return rieles === 0 ? null : r2(total)
}

export async function potenciaW(f: Fuentes): Promise<number> {
  const p = potenciaDe(await vcgencmd(f, 'pmic_read_adc'))
  if (p === null) throw new Error('sin rieles en pmic_read_adc')
  return p
}

export async function uptimeS(f: Fuentes): Promise<number> {
  return r1(Number((await leer(f, 'proc/uptime')).trim().split(/\s+/)[0]))
}

export const CABECERA_RECURSOS = ['fecha_hora', 'cpu_pct', 'mem_disponible_mb', 'rss_mb', 'temp_c', 'throttled', 'sectores_escritos', 'potencia_w'] as const

const valor = <T>(r: PromiseSettledResult<T>) => (r.status === 'fulfilled' ? r.value : null)

// Una fila de recursos.csv; `antes` son los tiempos de CPU de la lectura anterior
export async function muestra(f: Fuentes, antes: TiemposCpu | null, fecha: string) {
  const [cpu, mem, temp, thr, sect, pot] = await Promise.allSettled([
    tiemposCpu(f), memDisponibleMb(f), tempC(f), throttled(f), sectoresEscritos(f), potenciaW(f),
  ])
  const ahora = valor(cpu)
  const fila = [
    fecha,
    antes && ahora ? cpuPct(antes, ahora) : null,
    valor(mem),
    r1(process.memoryUsage().rss / 1048576),
    valor(temp),
    valor(thr),
    valor(sect),
    valor(pot),
  ]
  return { fila, cpu: ahora }
}
