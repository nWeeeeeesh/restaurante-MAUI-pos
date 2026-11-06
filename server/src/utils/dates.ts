// Rangos de fecha centralizados para consultas sobre la BD.
//
// La BD guarda timestamps en UTC ('YYYY-MM-DD HH:MM:SS', vía datetime('now')).
// Pero el "día" que ve el restaurante es en hora LOCAL (Lima/Tacna, UTC-5).
// Por eso calculamos los límites en hora local y los serializamos a string UTC
// comparable con lo que hay en la BD.
//
// P2: antes `bills.ts` usaba límites locales y `reports.ts` usaba UTC, lo que
// corría los reportes ~5h. Ahora ambos usan estos helpers → una sola definición
// de "hoy".

function toDbUtc(d: Date): string {
  return d.toISOString().slice(0, 19).replace('T', ' ')
}

// Inicio del día local (00:00:00) como string UTC comparable con la BD.
export function localDayStart(base: Date = new Date()): string {
  const d = new Date(base)
  d.setHours(0, 0, 0, 0)
  return toDbUtc(d)
}

// Fin del día local (23:59:59.999) como string UTC comparable con la BD.
export function localDayEnd(base: Date = new Date()): string {
  const d = new Date(base)
  d.setHours(23, 59, 59, 999)
  return toDbUtc(d)
}

// Acepta 'YYYY-MM-DD' (interpretado como medianoche local) o un ISO completo;
// devuelve el límite de día (inicio o fin) en string UTC.
export function parseDayBoundary(s: string, kind: 'start' | 'end'): string {
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(s)
  const d = dateOnly ? new Date(s + 'T00:00:00') : new Date(s)
  if (kind === 'start') d.setHours(0, 0, 0, 0)
  else                  d.setHours(23, 59, 59, 999)
  return toDbUtc(d)
}

// Inicio de un período de reporte ('today' | 'week' | 'month') en hora local,
// como string UTC. 'today' (y cualquier valor desconocido) → hoy.
export function periodStart(period: string): string {
  const d = new Date()
  if (period === 'week') {
    d.setDate(d.getDate() - 7)
  } else if (period === 'month') {
    d.setDate(1)
  }
  d.setHours(0, 0, 0, 0)
  return toDbUtc(d)
}

// Modificador de SQLite para pasar un timestamp UTC a hora local en date()/datetime().
// getTimezoneOffset devuelve minutos a SUMAR a la hora local para obtener UTC
// (300 en Lima, UTC-5), así que local = UTC - offset. Perú no tiene horario de verano.
export function sqliteLocalOffset(tzOffsetMinutes = new Date().getTimezoneOffset()): string {
  return `${-tzOffsetMinutes} minutes`
}

// Fecha local en formato 'YYYY-MM-DD' (para columnas DATE como expenses.date).
export function localDateString(base: Date = new Date()): string {
  const d = new Date(base)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

// Suma días a una fecha local 'YYYY-MM-DD' (negativo para restar)
export function addDays(date: string, days: number): string {
  const d = new Date(date + 'T00:00:00')
  d.setDate(d.getDate() + days)
  return localDateString(d)
}

const LIMA = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Lima', year: 'numeric', month: '2-digit', day: '2-digit' })

// Fecha de Lima 'YYYY-MM-DD'. Un string 'YYYY-MM-DD' ya es una fecha de Lima; un
// instante se convierte con la zona explícita (no con la del proceso): a las 04:30 UTC
// del 11 de enero en Lima todavía es 10 de enero.
export function limaDate(d: Date | string = new Date()): string {
  if (typeof d === 'string') return d.slice(0, 10)
  return LIMA.format(d)
}
