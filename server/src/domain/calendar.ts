// Calendario de los días de atención (plan-sistema §2, convenciones de dominio). Puro:
// trabaja con fechas locales 'YYYY-MM-DD' y aritmética UTC, sin la zona del proceso ni
// el reloj.

const DAY_MS = 86_400_000

function toUtc(date: string): number {
  return Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)))
}

function fromUtc(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}

export function addDaysIso(date: string, days: number): string {
  return fromUtc(toUtc(date) + days * DAY_MS)
}

export function daysBetween(from: string, to: string): number {
  return Math.round((toUtc(to) - toUtc(from)) / DAY_MS)
}

// 0 = lunes … 6 = domingo (como weekday() de Python, para la paridad)
export function weekdayIso(date: string): number {
  return (new Date(toUtc(date)).getUTCDay() + 6) % 7
}

export function firstOfMonth(date: string): string {
  return `${date.slice(0, 7)}-01`
}

export function lastOfMonth(date: string): string {
  const y = Number(date.slice(0, 4))
  const m = Number(date.slice(5, 7))
  return fromUtc(Date.UTC(y, m, 1) - DAY_MS)
}

export interface Calendario {
  conVentas: ReadonlySet<string>   // días locales con boletas
  cerrados: ReadonlySet<string>    // días con nota «cerrado»
}

// Día de atención: con ventas, o de martes a domingo sin nota «cerrado»
export function atiende(cal: Calendario, fecha: string): boolean {
  return cal.conVentas.has(fecha) || (weekdayIso(fecha) !== 0 && !cal.cerrados.has(fecha))
}

export function diasAtencion(cal: Calendario, desde: string, hasta: string): string[] {
  const out: string[] = []
  for (let d = desde; d <= hasta; d = addDaysIso(d, 1)) if (atiende(cal, d)) out.push(d)
  return out
}

export function siguienteAtencion(cal: Calendario, fecha: string): string {
  let d = addDaysIso(fecha, 1)
  // Un local nunca cierra un año entero: el tope evita un bucle infinito
  for (let k = 0; k < 366 && !atiende(cal, d); k++) d = addDaysIso(d, 1)
  return d
}

export type Agrupacion = 'day' | 'week' | 'month'

// Grupos del periodo: días, semanas de lunes a domingo o meses calendario, recortados
export function grupos(desde: string, hasta: string, por: Agrupacion): { key: string; from: string; to: string }[] {
  const out: { key: string; from: string; to: string }[] = []
  let d = desde
  while (d <= hasta) {
    const fin = por === 'day' ? d : por === 'week' ? addDaysIso(d, 6 - weekdayIso(d)) : lastOfMonth(d)
    const to = fin < hasta ? fin : hasta
    const key = por === 'day' ? d : por === 'week' ? addDaysIso(d, -weekdayIso(d)) : d.slice(0, 7)
    out.push({ key, from: d, to })
    d = addDaysIso(to, 1)
  }
  return out
}
