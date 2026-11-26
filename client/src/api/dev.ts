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
export type IdPaso = 'medir' | 'jornada' | 'nocturna' | 'permisos' | 'pruebas' | 'recuperacion' | 'descarga'
export interface PasoTodo {
  id: IdPaso
  nombre: string
  estado: 'pendiente' | 'corriendo' | 'esperando' | 'hecho' | 'error'
  inicio: string | null
  fin: string | null
  error: string | null
  detalle: string | null
}
export interface PlanTodo { creado: string; estado: 'corriendo' | 'detenido' | 'listo'; pasos: PasoTodo[] }
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
}

export interface EstadoDev {
  dir: string
  equipo: { refrigeracion?: string; almacenamiento?: string; detectado: { almacenamiento: string | null; so_version: string | null; node: string } }
  trabajos: Record<string, Trabajo>
  todoEnUno: PlanTodo | null
  enCurso: string | null
  partes: Record<'registro' | 'medir' | 'permisos' | 'pruebas' | 'recuperacion' | 'jornada' | 'nocturna' | 'instalacion' | 'impresiones', Parte>
  arranques: { hechos: number; de: number }
  e2: P95[]
  permisos: { fecha: string; todoCoincide: boolean; matriz: FilaPermiso[] } | null
  pruebas: { fecha: string; total: number | null; fallidas: number | null; ciCodigo: number | null } | null
  recuperacion: { estado?: 'corriendo' | 'hecho' | 'error'; fase?: string; inicio?: string; fin?: string | null; error?: string | null; veces: number }
  nocturna: { fecha: string; madeOn: string; ms: number; ok: boolean } | null
  jornada: {
    enCurso: { pid: number | null; inicio: string | null } | null
    resumen: ResumenJornada | null
    factor: number
  }
}

export const getEstado = () => api.get<EstadoDev>('/dev/estado').then(r => r.data)
export const putEquipo = (body: { refrigeracion?: string; almacenamiento?: string }) => api.put('/dev/equipo', body).then(r => r.data)
export const lanzar = (que: 'medir' | 'jornada' | 'nocturna' | 'permisos' | 'pruebas') => api.post<Trabajo>(`/dev/${que}`).then(r => r.data)
export const iniciarRecuperacion = () => api.post<Trabajo>('/dev/recuperacion', { confirmar: true }).then(r => r.data)
export const cancelarRecuperacion = () => api.delete('/dev/recuperacion').then(r => r.data)
export const iniciarTodoEnUno = () => api.post<PlanTodo>('/dev/todo-en-uno', { confirmar: true }).then(r => r.data)
export const reintentarTodoEnUno = (desde: IdPaso) => api.post<PlanTodo>('/dev/todo-en-uno/reintentar', { desde }).then(r => r.data)
export const cancelarTodoEnUno = () => api.delete('/dev/todo-en-uno').then(r => r.data)
export const detenerJornada = () => api.delete('/dev/jornada').then(r => r.data)

export async function descargarTodo() {
  const r = await api.get<Blob>('/dev/descargar', { responseType: 'blob', timeout: 300_000 })
  const nombre = /filename="?([^";]+)"?/.exec(String(r.headers['content-disposition'] ?? ''))?.[1] ?? 'maui-resultados.tar.gz'
  const url = URL.createObjectURL(r.data)
  const a = document.createElement('a')
  a.href = url
  a.download = nombre
  a.click()
  URL.revokeObjectURL(url)
}
