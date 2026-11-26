// «Todo en uno»: un solo clic que, en una sola corrida y sin esperas, encadena medir
// cálculos, la jornada simulada comprimida, la tarea nocturna real, verificar permisos,
// correr las pruebas y las pruebas de recuperación; al final deja la descarga lista. El
// plan vive en todo-en-uno.json: sobrevive a los cortes de la recuperación. Si un paso
// falla, el plan se detiene y se puede reintentar desde ese paso.
import { DomainError } from '../errors'
import { escribirJson, fechaLocal, leerJson, rutaDev } from './modo'
import type { EstadoRecuperacion } from './recuperacion'
import { terminado, type Trabajo } from './trabajos'

export type IdPaso = 'medir' | 'jornada' | 'nocturna' | 'permisos' | 'pruebas' | 'recuperacion' | 'descarga'
export type TipoTrabajo = 'medir' | 'jornada' | 'nocturna' | 'permisos' | 'pruebas' | 'recuperacion'

export const PASOS: { id: IdPaso; nombre: string }[] = [
  { id: 'medir', nombre: 'Medir cálculos' },
  { id: 'jornada', nombre: 'Jornada simulada comprimida' },
  { id: 'nocturna', nombre: 'Tarea nocturna real' },
  { id: 'permisos', nombre: 'Verificar permisos' },
  { id: 'pruebas', nombre: 'Correr pruebas automatizadas' },
  { id: 'recuperacion', nombre: 'Pruebas de recuperación' },
  { id: 'descarga', nombre: 'Dejar la descarga lista' },
]

export interface Paso {
  id: IdPaso
  nombre: string
  estado: 'pendiente' | 'corriendo' | 'esperando' | 'hecho' | 'error'
  inicio: string | null
  fin: string | null
  error: string | null
  detalle: string | null
}

export interface PlanTodo {
  creado: string
  estado: 'corriendo' | 'detenido' | 'listo'
  pasos: Paso[]
}

export interface Dependencias {
  correr: (tipo: TipoTrabajo) => Trabajo
  estadoRecuperacion: () => EstadoRecuperacion | null
  jornadaEnCurso: () => unknown
  verificarDescarga: () => void
  ahora: () => Date
}

const sondeoMs = () => Number(process.env.MAUI_TODO_SONDEO_MS || 30_000)
const archivo = () => rutaDev('todo-en-uno.json')
export const planTodo = () => leerJson<PlanTodo>(archivo())
const guardar = (p: PlanTodo) => escribirJson(archivo(), p)

let deps: Dependencias | null = null
let temporizador: ReturnType<typeof setTimeout> | null = null
let avanzando = false

function revisarEn(ms: number) {
  if (temporizador) clearTimeout(temporizador)
  // Como mucho cada 6 h: los temporizadores largos se desbordan
  temporizador = setTimeout(() => { temporizador = null; void avanzar() }, Math.max(0, Math.min(ms, 6 * 3600_000)))
  temporizador.unref()
}

function marcar(plan: PlanTodo, paso: Paso, cambios: Partial<Paso>) {
  Object.assign(paso, cambios)
  if (cambios.estado === 'error') plan.estado = 'detenido'
  guardar(plan)
}

async function correrTrabajo(plan: PlanTodo, paso: Paso, tipo: TipoTrabajo): Promise<boolean> {
  marcar(plan, paso, { estado: 'corriendo', inicio: fechaLocal(), fin: null, error: null })
  let t: Trabajo
  try {
    t = deps!.correr(tipo)
  } catch (e) {
    marcar(plan, paso, { estado: 'error', error: (e as Error).message, fin: fechaLocal() })
    return false
  }
  await terminado(t)
  const actual = planTodo()
  if (!actual || actual.estado !== 'corriendo') return false // cancelado mientras corría
  const p = actual.pasos.find(x => x.id === paso.id)!
  if (t.estado === 'error') { marcar(actual, p, { estado: 'error', error: t.error, fin: fechaLocal() }); return false }
  marcar(actual, p, { estado: 'hecho', fin: fechaLocal() })
  return true
}

// Devuelve true si el paso terminó y se puede seguir con el siguiente
async function ejecutar(plan: PlanTodo, paso: Paso): Promise<boolean> {
  const d = deps!
  switch (paso.id) {
    case 'medir':
    case 'jornada':
    case 'nocturna':
    case 'permisos':
    case 'pruebas':
      return correrTrabajo(plan, paso, paso.id)
    case 'recuperacion': {
      if (paso.estado === 'corriendo') {
        // Ya empezó: termina después del quinto reinicio (reanudarRecuperacion)
        const r = d.estadoRecuperacion()
        if (r?.estado === 'hecho') { marcar(plan, paso, { estado: 'hecho', fin: fechaLocal() }); return true }
        if (r?.estado === 'error') { marcar(plan, paso, { estado: 'error', error: r.error ?? 'Pruebas de recuperación con error', fin: fechaLocal() }); return false }
        marcar(plan, paso, { detalle: r?.fase ?? paso.detalle })
        revisarEn(sondeoMs())
        return false
      }
      // El reinicio cortaría una jornada lanzada a mano: se espera a que termine
      if (d.jornadaEnCurso()) {
        marcar(plan, paso, { estado: 'esperando', detalle: 'Espera a que termine la jornada en curso' })
        revisarEn(sondeoMs())
        return false
      }
      marcar(plan, paso, { estado: 'corriendo', inicio: fechaLocal(), detalle: 'Respaldos, restauraciones y reinicios' })
      try {
        const t = d.correr('recuperacion')
        void terminado(t).then(() => { if (t.estado === 'error') void avanzar() })
      } catch (e) {
        marcar(plan, paso, { estado: 'error', error: (e as Error).message, fin: fechaLocal() })
        return false
      }
      revisarEn(sondeoMs())
      return false
    }
    case 'descarga':
      try {
        d.verificarDescarga()
      } catch (e) {
        marcar(plan, paso, { estado: 'error', error: (e as Error).message, fin: fechaLocal() })
        return false
      }
      marcar(plan, paso, { estado: 'hecho', inicio: fechaLocal(), fin: fechaLocal(), detalle: 'Listo para descargar' })
      return true
  }
}

export async function avanzar() {
  if (avanzando || !deps) return
  avanzando = true
  try {
    for (;;) {
      const plan = planTodo()
      if (!plan || plan.estado !== 'corriendo') return
      const paso = plan.pasos.find(p => p.estado !== 'hecho')
      if (!paso) { plan.estado = 'listo'; guardar(plan); return }
      if (!(await ejecutar(plan, paso))) return
    }
  } finally {
    avanzando = false
  }
}

export function iniciarTodoEnUno(d: Dependencias): PlanTodo {
  const previo = planTodo()
  if (previo?.estado === 'corriendo') throw new DomainError('«Todo en uno» ya está en marcha', 409, 'DEV_TODO_RUNNING')
  deps = d
  const plan: PlanTodo = {
    creado: fechaLocal(d.ahora()), estado: 'corriendo',
    pasos: PASOS.map(p => ({ ...p, estado: 'pendiente', inicio: null, fin: null, error: null, detalle: null })),
  }
  guardar(plan)
  void avanzar()
  return plan
}

export function reintentarDesde(d: Dependencias, id: IdPaso): PlanTodo {
  const plan = planTodo()
  if (!plan) throw new DomainError('No hay un plan «Todo en uno»', 404, 'DEV_TODO_NOT_FOUND')
  if (plan.estado === 'corriendo') throw new DomainError('El plan sigue en marcha', 409, 'DEV_TODO_RUNNING')
  const k = plan.pasos.findIndex(p => p.id === id)
  if (k === -1) throw new DomainError('Paso desconocido', 400, 'DEV_TODO_STEP')
  deps = d
  for (const p of plan.pasos.slice(k)) Object.assign(p, { estado: 'pendiente', inicio: null, fin: null, error: null, detalle: null })
  plan.estado = 'corriendo'
  guardar(plan)
  void avanzar()
  return plan
}

export function cancelarTodoEnUno() {
  if (temporizador) clearTimeout(temporizador)
  temporizador = null
  const plan = planTodo()
  if (!plan || plan.estado !== 'corriendo') return plan
  plan.estado = 'detenido'
  const p = plan.pasos.find(x => x.estado !== 'hecho')
  if (p) Object.assign(p, { estado: 'error', error: 'Cancelado', fin: fechaLocal() })
  guardar(plan)
  return plan
}

// Al arrancar: un paso que corría en el proceso anterior (cortado por un reinicio) se
// repite; las pruebas de recuperación siguen solas con su marca.
export function reanudarTodoEnUno(d: Dependencias) {
  deps = d
  const plan = planTodo()
  if (!plan || plan.estado !== 'corriendo') return null
  for (const p of plan.pasos) {
    if (p.estado === 'corriendo' && p.id !== 'recuperacion') Object.assign(p, { estado: 'pendiente', detalle: 'Se repite: un reinicio lo interrumpió' })
  }
  guardar(plan)
  void avanzar()
  return plan
}
