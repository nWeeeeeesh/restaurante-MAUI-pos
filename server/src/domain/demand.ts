// Serie de demanda no censurada por insumo (F4 y F5) y pronóstico de una noche. Puro;
// mismas convenciones que scripts/tesis/referencia.py (serie_demanda, pronostico_noche).
import { addDaysIso, siguienteAtencion, weekdayIso } from './calendar'
import { suma } from './costing'
import { costearInsumo, claveVariante, type DatosCosteo, type FilaInsumo } from './profitability'
import { pronosticar, respaldo, seleccionarMulti, ventasPerdidas, type Metodo } from './forecast'

export interface DatosDemanda {
  costeo: DatosCosteo
  porcionesDia: Map<string, Map<string, number>>   // fecha → clave plato|variante → porciones
  nombres: Map<string, string>                     // clave → nombre (para ordenar como la referencia)
  agotadosDia: Map<string, string[]>               // fecha → claves de los platos marcados agotados ese día
  recetas: Map<string, Map<number, number>>        // clave → insumo → kg por porción
  feriados: ReadonlySet<string>
}

export interface SerieDemanda {
  filas: FilaInsumo[]
  y: number[]
  imputado: boolean[]
  dows: number[]
  feriados: boolean[]
}

const porNombre = (nombres: Map<string, string>) => (a: string, b: string) => {
  const x = nombres.get(a) ?? a
  const z = nombres.get(b) ?? b
  return x < z ? -1 : x > z ? 1 : 0
}

// Con lo que se sabía la noche `noche`: conteos hasta esa fecha, así que el consumo de
// la propia noche siempre es teórico (imputado)
export function serieDemanda(d: DatosDemanda, insumoId: number, noche: string, f: number): SerieDemanda {
  const filas = costearInsumo(d.costeo, insumoId, noche, f, noche)
  const diasVenta = d.costeo.calendario.conVentas
  const out: SerieDemanda = { filas, y: [], imputado: [], dows: [], feriados: [] }
  for (const x of filas) {
    const fecha = x.fecha
    let L = 0
    const agot = [...(d.agotadosDia.get(fecha) ?? [])].sort(porNombre(d.nombres))
    if (agot.length > 0) {
      const habitual = new Map<string, number>()
      const previos = [1, 2, 3, 4].map(k => addDaysIso(fecha, -7 * k)).filter(p => p <= noche && diasVenta.has(p))
      for (const s of agot) {
        habitual.set(s, previos.length ? suma(previos.map(p => d.porcionesDia.get(p)?.get(s) ?? 0)) / previos.length : 0)
      }
      const recetaKg = new Map<string, number>()
      for (const s of agot) {
        const [dishId] = s.split('|')
        const r = d.recetas.get(s) ?? d.recetas.get(claveVariante(Number(dishId), ''))
        if (r) recetaKg.set(s, r.get(insumoId) ?? 0)
      }
      L = ventasPerdidas(agot, habitual, d.porcionesDia.get(fecha) ?? new Map(), recetaKg, f)
    }
    out.y.push(x.C + L)
    out.imputado.push(x.imputado)
    out.dows.push(weekdayIso(fecha))
    out.feriados.push(d.feriados.has(fecha))
  }
  return out
}

export interface PronosticoNoche {
  metodo: Metodo | 'respaldo'
  mae: Record<Metodo, number> | null
  n: number
  objetivos: string[]                // los 3 días de atención siguientes
  valores: number[]                  // kg por horizonte 1…3
  sigmas: (number | null)[]          // σ_H del error acumulado en H = 1…3 días
}

export const HORIZONTES = [1, 2, 3] as const

export function pronosticoNoche(d: DatosDemanda, insumoId: number, noche: string, f: number): PronosticoNoche {
  const s = serieDemanda(d, insumoId, noche, f)
  const objetivos: string[] = []
  let t = noche
  for (const _ of HORIZONTES) objetivos.push(t = siguienteAtencion(d.costeo.calendario, t))
  const sel = seleccionarMulti(s.y, s.imputado, s.dows, s.feriados, [...HORIZONTES])
  if (sel === null) {
    return { metodo: 'respaldo', mae: null, n: s.y.length, objetivos, valores: respaldo(s.y, 3), sigmas: [null, null, null] }
  }
  const valores = pronosticar(sel.metodo, s.y, 3, s.dows, s.feriados, objetivos.map(weekdayIso), objetivos.map(x => d.feriados.has(x)))
  return { metodo: sel.metodo, mae: sel.mae, n: s.y.length, objetivos, valores, sigmas: HORIZONTES.map(h => sel.sigmas.get(h)!) }
}
