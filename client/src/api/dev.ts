// Perfil de desarrollador (modo de pruebas): llamadas HTTP tipadas, sin lógica.
import api from './client'

export interface Parte { hecho: boolean; fecha: string | null }
export interface Trabajo {
  tipo: string
  estado: 'corriendo' | 'hecho' | 'error'
  inicio: string
  fin: string | null
  avance: string[]
  error: string | null
  resultado: unknown
}
export interface P95 { operacion: string; p95Ms: number; limiteMs: number; cumple: boolean }
export interface FilaPermiso { rol: string; usuario: string; pantalla: string; ruta: string; codigo: number; esperado: number; coincide: boolean }
export interface Periodo { desde: string; hasta: string }
export interface Programacion { hora: string; dias: number; desde: string; ejecutadas: string[] }

export interface EstadoDev {
  periodo: Periodo
  dir: string
  equipo: { refrigeracion?: string; almacenamiento?: string; detectado: { almacenamiento: string | null; so_version: string | null; node: string } }
  trabajos: Record<string, Trabajo>
  enCurso: string | null
  partes: Record<'registro' | 'medir' | 'permisos' | 'pruebas' | 'recuperacion' | 'jornada' | 'instalacion' | 'impresiones', Parte>
  arranques: { hechos: number; de: number }
  e2: P95[]
  permisos: { fecha: string; todoCoincide: boolean; matriz: FilaPermiso[] } | null
  pruebas: { fecha: string; total: number | null; fallidas: number | null; ciCodigo: number | null } | null
  recuperacion: { estado?: 'corriendo' | 'hecho' | 'error'; fase?: string; inicio?: string; fin?: string | null; error?: string | null; veces: number }
  jornada: {
    enCurso: { pid: number | null; inicio: string | null } | null
    resumen: { estado: string; inicio: string; fin: string; pedidos: number; errores: number; porAccion: Record<string, { n: number; medianaMs: number | null; p95Ms: number | null }> } | null
    programacion: Programacion | null
    proxima: string | null
  }
}

export const getEstado = () => api.get<EstadoDev>('/dev/estado').then(r => r.data)
export const putEquipo = (body: { refrigeracion?: string; almacenamiento?: string }) => api.put('/dev/equipo', body).then(r => r.data)
export const lanzar = (que: 'medir' | 'permisos' | 'pruebas') => api.post<Trabajo>(`/dev/${que}`).then(r => r.data)
export const iniciarRecuperacion = () => api.post<Trabajo>('/dev/recuperacion', { confirmar: true }).then(r => r.data)
export const cancelarRecuperacion = () => api.delete('/dev/recuperacion').then(r => r.data)
export const correrJornada = () => api.post('/dev/jornada').then(r => r.data)
export const detenerJornada = () => api.delete('/dev/jornada').then(r => r.data)
export const programarJornadas = (body: { hora: string; dias: number }) => api.put('/dev/jornada/programacion', body).then(r => r.data)
export const quitarProgramacion = () => api.delete('/dev/jornada/programacion').then(r => r.data)

export async function descargarTodo(p: Periodo) {
  const r = await api.get<Blob>('/dev/descargar', { params: p, responseType: 'blob', timeout: 300_000 })
  const nombre = /filename="?([^";]+)"?/.exec(String(r.headers['content-disposition'] ?? ''))?.[1] ?? 'maui-resultados.tar.gz'
  const url = URL.createObjectURL(r.data)
  const a = document.createElement('a')
  a.href = url
  a.download = nombre
  a.click()
  URL.revokeObjectURL(url)
}
