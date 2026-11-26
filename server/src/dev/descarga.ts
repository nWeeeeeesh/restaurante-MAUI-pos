// C8 «Descargar todo»: arma maui-resultados-<fecha>.tar.gz con lo que necesitan el
// artículo y la tesis. articulo/resultados.json sigue EXACTAMENTE el esquema de
// server/data/resultados_plantilla.json: no se cambian ni se agregan claves y lo que
// falta queda en null.
import { execFile } from 'child_process'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { addDaysIso, diasAtencion, type Calendario } from '../domain/calendar'
import { fechaLocal, leerCsvDev, leerJson, rutaDev } from './modo'
import { percentil } from './jornada-plan'
import { discoDe, fuentesPorDefecto, type Fuentes } from './sistema'
import { DIR_SERVER } from './trabajos'

export const RUTA_PLANTILLA = path.join(DIR_SERVER, 'data', 'resultados_plantilla.json')
export const VECES_ARRANQUE = 5

type Json = null | boolean | number | string | Json[] | { [k: string]: Json }
const r1 = (n: number) => Math.round(n * 10) / 10
const r2 = (n: number) => Math.round(n * 100) / 100
const num = (s: string | undefined) => (s === undefined || s.trim() === '' ? null : Number(s))
const nums = (xs: (number | null)[]) => xs.filter((x): x is number => x !== null && Number.isFinite(x))
const ultimos = <T>(xs: T[], n = VECES_ARRANQUE) => xs.slice(-n)

export interface Periodo { desde: string; hasta: string }

// Por defecto, los últimos 7 días completos (hasta ayer)
export function periodoPorDefecto(hoy = fechaLocal().slice(0, 10)): Periodo {
  const hasta = addDaysIso(hoy, -1)
  return { desde: addDaysIso(hasta, -6), hasta }
}

export const diasDelPeriodo = (p: Periodo) => {
  let n = 0
  for (let d = p.desde; d <= p.hasta; d = addDaysIso(d, 1)) n++
  return n
}

export const enPeriodo = <T extends Record<string, string>>(filas: T[], p: Periodo) =>
  filas.filter(f => { const d = (f.fecha_hora ?? '').slice(0, 10); return d >= p.desde && d <= p.hasta })

// Las claves deben ser las de la plantilla; donde la plantilla tiene un objeto, el
// resultado también (con sus mismas claves); donde tiene null, cualquier valor.
export function validarContraPlantilla(obj: unknown, plantilla: unknown, ruta = ''): string[] {
  if (plantilla === null || typeof plantilla !== 'object' || Array.isArray(plantilla)) return []
  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) return [`${ruta || 'raíz'}: debe ser un objeto`]
  const o = obj as Record<string, unknown>
  const t = plantilla as Record<string, unknown>
  const errores: string[] = []
  for (const k of Object.keys(t)) {
    if (!(k in o)) errores.push(`${ruta}${k}: falta`)
    else errores.push(...validarContraPlantilla(o[k], t[k], `${ruta}${k}.`))
  }
  for (const k of Object.keys(o)) if (!(k in t)) errores.push(`${ruta}${k}: clave que no está en la plantilla`)
  return errores
}

// ── Equipo ──

const leer = (f: Fuentes, ruta: string) => fs.readFileSync(path.join(f.raiz, ruta), 'utf-8')
const intentar = <T>(fn: () => T): T | null => { try { return fn() } catch { return null } }

// «(Debian 13, núcleo 6.12)»
export function soVersion(f: Fuentes): string | null {
  const osr = intentar(() => leer(f, 'etc/os-release'))
  if (!osr) return null
  const campo = (k: string) => osr.match(new RegExp(`^${k}="?([^"\\n]*)"?`, 'm'))?.[1]
  const id = campo('ID') ?? ''
  const nombre = id ? id.charAt(0).toUpperCase() + id.slice(1) : campo('NAME')
  const nucleo = (intentar(() => leer(f, 'proc/sys/kernel/osrelease').trim()) ?? os.release()).match(/^(\d+\.\d+)/)?.[1]
  return `(${[nombre, campo('VERSION_ID')].filter(Boolean).join(' ')}${nucleo ? `, núcleo ${nucleo}` : ''})`
}

const MARCAS_MMC: Record<number, string> = { 0x03: 'SanDisk', 0x1b: 'Samsung', 0x28: 'Lexar', 0x74: 'Transcend', 0x9f: 'Kingston' }
const NOMINALES = [4, 8, 16, 32, 64, 128, 256, 512, 1000, 2000, 4000]

// Lo que muestra lsblk, leído de /sys: «microSD SanDisk de 64 GB»
export function almacenamiento(f: Fuentes): string | null {
  const montaje = intentar(() => leer(f, 'proc/self/mountinfo').split('\n').map(l => l.split(' ')).find(c => c[4] === '/'))
  if (!montaje) return null
  const [mayor, menor] = montaje[2].split(':')
  const fila = intentar(() => leer(f, 'proc/diskstats').split('\n').map(l => l.trim().split(/\s+/)).find(c => c[0] === mayor && c[1] === menor))
  const disco = process.env.MAUI_DISCO || (fila ? discoDe(fila[2]) : null)
  if (!disco) return null
  const sectores = Number(intentar(() => leer(f, `sys/block/${disco}/size`).trim()))
  const gb = sectores * 512 / 1e9
  const nominal = Number.isFinite(gb) && gb > 0 ? NOMINALES.reduce((a, b) => (Math.abs(Math.log(b / gb)) < Math.abs(Math.log(a / gb)) ? b : a)) : null
  const tam = nominal === null ? '' : nominal >= 1000 ? ` de ${nominal / 1000} TB` : ` de ${nominal} GB`
  if (disco.startsWith('mmcblk')) {
    const manfid = Number(intentar(() => leer(f, `sys/block/${disco}/device/manfid`).trim()))
    const marca = MARCAS_MMC[manfid]
    return `microSD${marca ? ` ${marca}` : ''}${tam}`
  }
  const modelo = intentar(() => leer(f, `sys/block/${disco}/device/model`).trim())
  if (disco.startsWith('nvme')) return `SSD NVMe${modelo ? ` ${modelo}` : ''}${tam}`
  return `Disco USB${modelo ? ` ${modelo}` : ''}${tam}`
}

// ── Cálculos ──

export interface DatosExternos {
  noches: { ok: number; total: number } | null
  respaldosRemotos: string[] | null // fechas (YYYY-MM-DD) de los .gz en la copia externa
}

const THROTTLE_BITS = 0x4 | 0x8 | 0x40000 | 0x80000

export function calcularResultados(p: Periodo, externos: DatosExternos, f: Fuentes = fuentesPorDefecto()) {
  const plantilla = leerJson<Record<string, Json>>(RUTA_PLANTILLA)
  if (!plantilla) throw new Error(`No se puede leer ${RUTA_PLANTILLA}`)
  const r = JSON.parse(JSON.stringify(plantilla)) as Record<string, Record<string, Json> | Json>
  const dias = diasDelPeriodo(p)
  const equipoGuardado = leerJson<{ refrigeracion?: string; almacenamiento?: string }>(rutaDev('equipo.json')) ?? {}

  r.equipo = {
    almacenamiento: equipoGuardado.almacenamiento || almacenamiento(f),
    so_version: soVersion(f),
    node: process.versions.node,
    refrigeracion: equipoGuardado.refrigeracion || null,
  }

  r.e2 = leerJson<Json>(rutaDev('e2-pi.json'))

  const e2 = leerCsvDev(rutaDev('recursos-e2.csv'))
  const semana = enPeriodo(leerCsvDev(rutaDev('recursos.csv')), p)
  const max = (xs: (number | null)[]) => { const v = nums(xs); return v.length ? Math.max(...v) : null }
  const throttled = e2.map(x => x.throttled).filter(Boolean)
  let escritura: number | null = null
  const sect = nums(semana.map(x => num(x.sectores_escritos)))
  if (sect.length >= 2) {
    // Solo los saltos positivos: un reinicio vuelve el contador a cero
    let total = 0
    for (let k = 1; k < sect.length; k++) if (sect[k] > sect[k - 1]) total += sect[k] - sect[k - 1]
    escritura = r1(total * 512 / 1048576 / dias)
  }
  const pot = nums(semana.map(x => num(x.potencia_w)))
  r.e3 = {
    cpu_max_pct: max(e2.map(x => num(x.cpu_pct))),
    rss_max_mb: max(e2.map(x => num(x.rss_mb))),
    temp_max_c: max(e2.map(x => num(x.temp_c))),
    estrangulamiento: throttled.length ? throttled.some(t => (parseInt(t, 16) & THROTTLE_BITS) !== 0) : null,
    escritura_mb_dia: escritura,
    potencia_media_w: pot.length ? r2(pot.reduce((a, b) => a + b, 0) / pot.length) : null,
  }

  const inst = leerJson<{ fases_min?: Json; compilacion_min?: Json }>(rutaDev('instalacion-tiempos.json'))
  r.e4 = { fases_min: inst?.fases_min ?? null, compilacion_min: inst?.compilacion_min ?? null }

  const columna = (archivo: string, col: string, filtro?: (x: Record<string, string>) => boolean) => {
    const v = nums(leerCsvDev(rutaDev(archivo)).filter(x => !filtro || filtro(x)).map(x => num(x[col])))
    return v.length ? ultimos(v) : null
  }
  const latidos = new Set(enPeriodo(leerCsvDev(rutaDev('latidos.csv')), p).map(x => x.fecha_hora.slice(0, 16)))
  const fechasRespaldo = externos.respaldosRemotos ? new Set(externos.respaldosRemotos.filter(d => d >= p.desde && d <= p.hasta)) : null
  r.e5 = {
    arranque_s: columna('arranques.csv', 'uptime_s', x => x.motivo === 'arranque'),
    reinicio_s: columna('reinicio.csv', 'duracion_s'),
    respaldo_s: columna('respaldo.csv', 'duracion_s'),
    respaldo_mb: columna('respaldo.csv', 'tamano_mb'),
    restauracion_s: columna('restauracion.csv', 'duracion_s'),
    disponibilidad_pct: fs.existsSync(rutaDev('latidos.csv')) ? r2(100 * latidos.size / (dias * 1440)) : null,
    noches_ok: externos.noches?.ok ?? null,
    noches: externos.noches?.total ?? null,
    respaldos_ok: fechasRespaldo ? fechasRespaldo.size : null,
    respaldos: fechasRespaldo ? dias : null,
  }

  const jornada = enPeriodo(leerCsvDev(rutaDev('jornada.csv')), p)
  const ok = (x: Record<string, string>) => Number(x.codigo) >= 200 && Number(x.codigo) < 300
  const ms = (accion: string) => jornada.filter(x => x.accion === accion && ok(x)).map(x => Number(x.ms))
  r.jornada = jornada.length === 0 ? r.jornada : {
    pedidos: jornada.filter(x => x.accion === 'pedido' && ok(x)).length,
    p95_pedido_ms: percentil(ms('pedido'), 0.95),
    p95_cobro_ms: percentil(ms('cobro'), 0.95),
    errores: jornada.filter(x => !ok(x)).length,
  }

  const errores = validarContraPlantilla(r, plantilla)
  if (errores.length) throw new Error(`resultados.json no coincide con la plantilla: ${errores.join('; ')}`)
  return r
}

// ── Datos que no están en los archivos ──

export function nochesDelPeriodo(cal: Calendario, runs: { madeOn: string; status: string }[], p: Periodo) {
  const noches = diasAtencion(cal, p.desde, p.hasta)
  const ok = new Set(runs.filter(x => x.status === 'ok').map(x => x.madeOn))
  return { ok: noches.filter(n => ok.has(n)).length, total: noches.length }
}

// `rclone lsl`: «  123456 2026-12-02 03:00:05.123456789 archivo.db.gz»
export function fechasDeRclone(salida: string): string[] {
  return [...salida.matchAll(/^\s*\d+\s+(\d{4}-\d{2}-\d{2})\s+\S+\s+(.+\.db\.gz)\s*$/gm)].map(m => m[1])
}

export const remotoPrueba = () => process.env.MAUI_RCLONE_REMOTO || 'gdrive:MauiDeskPrueba/'

export function listarRemoto(): Promise<string[] | null> {
  return new Promise(resolve => {
    execFile('rclone', ['lsl', remotoPrueba()], { timeout: 60_000 }, (err, out) => resolve(err ? null : fechasDeRclone(String(out))))
  })
}

// ── Resumen legible ──

const v = (x: unknown) => (x === null || x === undefined ? 'pendiente' : Array.isArray(x) ? x.join(', ') : typeof x === 'boolean' ? (x ? 'sí' : 'no') : String(x))
const tabla = (filas: [string, unknown][]) => ['| Dato | Valor |', '|---|---|', ...filas.map(([k, x]) => `| ${k} | ${v(x)} |`)].join('\n')

export function resumenMd(r: Record<string, unknown>, p: Periodo, extra: { permisos: unknown; pruebas: unknown; arranques: number }) {
  const eq = r.equipo as Record<string, unknown>
  const e2 = r.e2 as { incremento2?: Record<string, { p95Ms: number; limiteMs: number; cumple: boolean }>; incremento3?: Record<string, { p95Ms: number; limiteMs: number; cumple: boolean }>; tamanoBaseMb?: number } | null
  const e3 = r.e3 as Record<string, unknown>
  const e4 = r.e4 as Record<string, unknown>
  const e5 = r.e5 as Record<string, unknown>
  const j = r.jornada as Record<string, unknown>
  const perm = extra.permisos as { todoCoincide: boolean; matriz: { usuario: string; pantalla: string; codigo: number; esperado: number; coincide: boolean }[] } | null
  const pru = extra.pruebas as { total: number | null; fallidas: number | null; fecha: string } | null
  const filasE2 = e2 ? [...Object.entries(e2.incremento2 ?? {}), ...Object.entries(e2.incremento3 ?? {})] : []
  return `# Resultados de MauiDesk en la Raspberry Pi

Generado el ${fechaLocal()}. Periodo: ${p.desde} a ${p.hasta} (${diasDelPeriodo(p)} días). «pendiente» = todavía no hay datos.

## Equipo (Tabla III)

${tabla([['Almacenamiento', eq.almacenamiento], ['Sistema operativo', eq.so_version], ['Node', eq.node], ['Refrigeración', eq.refrigeracion]])}

## E2 · Tiempos de cálculo (Tabla 31, PA-07)

${filasE2.length ? ['| Operación | p95 (ms) | Límite (ms) | Cumple |', '|---|---|---|---|', ...filasE2.map(([k, m]) => `| ${k} | ${m.p95Ms} | ${m.limiteMs} | ${m.cumple ? 'sí' : 'no'} |`)].join('\n') + `\n\nTamaño de la base: ${v(e2?.tamanoBaseMb)} MB.` : 'pendiente'}

## E3 · Recursos

${tabla([['CPU máxima (%)', e3.cpu_max_pct], ['RSS máximo (MB)', e3.rss_max_mb], ['Temperatura máxima (°C)', e3.temp_max_c], ['Estrangulamiento', e3.estrangulamiento], ['Escritura (MB/día)', e3.escritura_mb_dia], ['Potencia media (W)', e3.potencia_media_w]])}

## E4 · Instalación (Tabla I)

${tabla([['Fases (min)', e4.fases_min], ['Compilación (min)', e4.compilacion_min]])}

## E5 · Funcionamiento y recuperación (Tabla V)

${tabla([['Arranque (s)', e5.arranque_s], [`Arranques registrados`, `${extra.arranques} de ${VECES_ARRANQUE}`], ['Reinicio tras falla (s)', e5.reinicio_s], ['Respaldo (s)', e5.respaldo_s], ['Respaldo (MB)', e5.respaldo_mb], ['Restauración (s)', e5.restauracion_s], ['Disponibilidad (%)', e5.disponibilidad_pct], ['Noches con pronóstico', e5.noches === null ? null : `${e5.noches_ok} de ${e5.noches}`], ['Días con respaldo externo', e5.respaldos === null ? null : `${e5.respaldos_ok} de ${e5.respaldos}`]])}

## Jornada simulada

${tabla([['Pedidos', j.pedidos], ['p95 crear pedido (ms)', j.p95_pedido_ms], ['p95 cobrar (ms)', j.p95_cobro_ms], ['Errores', j.errores]])}

## Permisos (PA-08)

${perm ? ['| Usuario | Pantalla | HTTP | Esperado | |', '|---|---|---|---|---|', ...perm.matriz.map(m => `| ${m.usuario} | ${m.pantalla} | ${m.codigo} | ${m.esperado} | ${m.coincide ? 'ok' : '**NO COINCIDE**'} |`)].join('\n') : 'pendiente'}

## Pruebas automatizadas (Capítulo IV)

${pru ? `${v(pru.total)} pruebas, ${v(pru.fallidas)} fallidas (${pru.fecha}). Detalle en tesis/evidencias.md y tesis/pruebas-ci.txt.` : 'pendiente'}
`
}

// ── Paquete ──

export function tar(args: string[], cwd: string): Promise<void> {
  return new Promise((resolve, reject) => execFile('tar', args, { cwd, timeout: 120_000 }, err => (err ? reject(err) : resolve())))
}

export async function armarPaquete(p: Periodo, archivos: { destino: string; origen?: string; contenido?: string }[]) {
  const nombre = `maui-resultados-${fechaLocal().slice(0, 10)}`
  const staging = fs.mkdtempSync(path.join(os.tmpdir(), `${nombre}-`))
  for (const a of archivos) {
    const destino = path.join(staging, a.destino)
    fs.mkdirSync(path.dirname(destino), { recursive: true })
    if (a.contenido !== undefined) fs.writeFileSync(destino, a.contenido)
    else if (a.origen && fs.existsSync(a.origen)) fs.copyFileSync(a.origen, destino)
  }
  // Rutas relativas: el tar de GNU toma «C:» de Windows como un host remoto
  const base = `${nombre}-${Date.now()}.tar.gz`
  const salida = path.join(path.dirname(staging), base)
  await tar(['-czf', `../${base}`, '.'], staging)
  fs.rmSync(staging, { recursive: true, force: true })
  return { archivo: salida, nombre: `${nombre}.tar.gz` }
}
