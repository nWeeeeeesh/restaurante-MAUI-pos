// Modo de pruebas (artículo y tesis, bloque C): la Raspberry Pi como banco de pruebas
// con datos simulados. Con MAUI_MODO_PRUEBAS=1 el servicio usa la base simulada
// (-sim.db), la impresora simulada y el perfil de desarrollador. Sin la variable, nada
// de esto existe: /api/dev/* responde 404 y el rol developer no entra.
import * as fs from 'fs'
import * as path from 'path'

export const modoPruebas = () => process.env.MAUI_MODO_PRUEBAS === '1'

// Una base que no sea la simulada nunca se abre en modo de pruebas: así no se crea ni
// se toca mauidisk.db. Devuelve el motivo para no arrancar, o null.
export function errorModoPruebas(env: NodeJS.ProcessEnv = process.env): string | null {
  if (env.MAUI_MODO_PRUEBAS !== '1') return null
  const url = env.DATABASE_URL ?? ''
  if (!url.startsWith('file:') || !url.endsWith('-sim.db')) {
    return `MAUI_MODO_PRUEBAS=1 exige la base simulada: DATABASE_URL debe ser un archivo que termine en -sim.db (es «${url || 'vacía, que abriría mauidisk.db'}»)`
  }
  return null
}

// Resultados del modo de pruebas (en .gitignore)
export const dirDev = () => process.env.MAUI_DEV_DIR || path.join(__dirname, '..', '..', 'data', 'dev')
export const rutaDev = (archivo: string) => path.join(dirDev(), archivo)

// ISO 8601 en la hora local del proceso (TZ=America/Lima en la unidad), sin zona
export function fechaLocal(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

// Agrega una fila a un CSV; la cabecera solo si el archivo no existe
export async function agregarFila(archivo: string, cabecera: readonly string[], valores: (string | number | null | undefined)[]) {
  await fs.promises.mkdir(path.dirname(archivo), { recursive: true })
  const existe = await fs.promises.access(archivo).then(() => true, () => false)
  const linea = valores.map(v => (v === null || v === undefined ? '' : String(v))).join(',') + '\n'
  await fs.promises.appendFile(archivo, (existe ? '' : cabecera.join(',') + '\n') + linea)
}

// CSV simple (sin comillas) → filas con la cabecera como claves
export function leerCsvDev(archivo: string): Record<string, string>[] {
  if (!fs.existsSync(archivo)) return []
  const lineas = fs.readFileSync(archivo, 'utf-8').split(/\r?\n/).filter(l => l.trim() !== '')
  if (lineas.length === 0) return []
  const cab = lineas[0].split(',')
  return lineas.slice(1).map(l => {
    const v = l.split(',')
    return Object.fromEntries(cab.map((h, i) => [h, v[i] ?? '']))
  })
}

export const leerJson = <T = unknown>(archivo: string): T | null => {
  try { return JSON.parse(fs.readFileSync(archivo, 'utf-8')) as T } catch { return null }
}

export function escribirJson(archivo: string, datos: unknown) {
  fs.mkdirSync(path.dirname(archivo), { recursive: true })
  fs.writeFileSync(archivo, JSON.stringify(datos, null, 2) + '\n')
}
