// Los timestamps de la BD (datetime('now')) están en UTC sin zona: 'YYYY-MM-DD HH:MM:SS'.
// `new Date('2026-06-05 20:00:00')` los interpreta como hora LOCAL y los corre
// 5 horas (TD-10). Este helper agrega la 'Z' para leerlos como UTC.
export function parseDbUtc(value: string): Date {
  if (/[zZ]|[+-]\d\d:?\d\d$/.test(value)) return new Date(value)
  return new Date(value.replace(' ', 'T') + 'Z')
}

export function formatDbDateTime(
  value: string | null | undefined,
  opts: Intl.DateTimeFormatOptions = { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' },
): string {
  if (!value) return ''
  return parseDbUtc(value).toLocaleString('es-PE', opts)
}

// Día local 'YYYY-MM-DD': el formato de las fechas de compras, merma y conteos
// (el servidor las guarda tal cual, sin pasar por UTC).
export function localDateString(base: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${base.getFullYear()}-${pad(base.getMonth() + 1)}-${pad(base.getDate())}`
}

export function addDays(date: string, days: number): string {
  const d = new Date(date + 'T00:00:00')
  d.setDate(d.getDate() + days)
  return localDateString(d)
}

// 'YYYY-MM-DD' → "mar. 14 oct." (mediodía para no cruzar de día por la zona)
export function formatLocalDate(date: string): string {
  return new Date(date + 'T12:00:00').toLocaleDateString('es-PE', { weekday: 'short', day: 'numeric', month: 'short' })
}
