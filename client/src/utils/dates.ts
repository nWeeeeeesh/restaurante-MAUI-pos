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
