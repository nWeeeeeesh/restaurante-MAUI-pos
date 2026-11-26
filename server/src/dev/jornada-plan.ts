// Plan de la jornada simulada (C4): el día de fixtures/sim12 con más boletas, con sus
// horas relativas, platos y cantidades. Misma convención que helpers/sim.ts: el pedido
// se abre a la hora del primer ítem de la boleta, los ítems de horas siguientes se
// agregan a su hora y se cobra a la hora del último.
import * as fs from 'fs'
import * as path from 'path'
import { leerCsv } from '../services/recipes-import.service'

// Siempre desde src/: tsc no copia los CSV a dist/
export const DIR_SIM12 = path.join(__dirname, '..', '..', 'src', '__tests__', 'fixtures', 'sim12')

export interface EventoJornada {
  offsetS: number
  boleta: string
  accion: 'pedido' | 'agregar' | 'cobro'
  items: { plato: string; cantidad: number }[]
}

export interface PlanJornada { fecha: string; boletas: number; duracionS: number; eventos: EventoJornada[] }

const segundos = (hora: string) => { const [h, m, s] = hora.split(':').map(Number); return h * 3600 + m * 60 + (s || 0) }

export function planJornada(ventasCsv: string, cartaCsv: string): PlanJornada {
  const ventas = leerCsv(ventasCsv)
  const sku = new Map(leerCsv(cartaCsv).map(c => [`${c.plato}|${c.variante}`, c.sku]))
  const boletasPorDia = new Map<string, Set<string>>()
  for (const v of ventas) boletasPorDia.set(v.fecha, (boletasPorDia.get(v.fecha) ?? new Set()).add(v.boleta))
  const [fecha] = [...boletasPorDia].sort((a, b) => b[1].size - a[1].size || a[0].localeCompare(b[0]))[0] ?? ['']
  const delDia = ventas.filter(v => v.fecha === fecha)
  const inicio = Math.min(...delDia.map(v => segundos(v.hora)))
  const porBoleta = new Map<string, typeof delDia>()
  for (const v of delDia) porBoleta.set(v.boleta, [...(porBoleta.get(v.boleta) ?? []), v])

  const eventos: EventoJornada[] = []
  for (const [boleta, filas] of porBoleta) {
    const horas = [...new Set(filas.map(f => f.hora))].sort()
    horas.forEach((hora, k) => {
      eventos.push({
        offsetS: segundos(hora) - inicio, boleta, accion: k === 0 ? 'pedido' : 'agregar',
        items: filas.filter(f => f.hora === hora).map(f => ({ plato: sku.get(`${f.plato}|${f.variante}`) ?? f.plato, cantidad: Number(f.cantidad) })),
      })
    })
    eventos.push({ offsetS: segundos(horas[horas.length - 1]) - inicio, boleta, accion: 'cobro', items: [] })
  }
  // En empate de hora: primero abrir, luego agregar y al final cobrar
  const orden = { pedido: 0, agregar: 1, cobro: 2 }
  eventos.sort((a, b) => a.offsetS - b.offsetS || orden[a.accion] - orden[b.accion] || Number(a.boleta) - Number(b.boleta))
  return { fecha, boletas: porBoleta.size, duracionS: eventos.length ? eventos[eventos.length - 1].offsetS : 0, eventos }
}

export function planSim12(): PlanJornada {
  return planJornada(fs.readFileSync(path.join(DIR_SIM12, 'ventas_items.csv'), 'utf-8'), fs.readFileSync(path.join(DIR_SIM12, 'carta.csv'), 'utf-8'))
}

// Mediana y p95 (rango más cercano, como perf.ts)
export function percentil(valores: number[], p: number): number | null {
  if (valores.length === 0) return null
  const s = [...valores].sort((a, b) => a - b)
  return s[Math.max(0, Math.ceil(p * s.length) - 1)]
}
