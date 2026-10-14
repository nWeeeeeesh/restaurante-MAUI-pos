type Cell = string | number | boolean | null | undefined

// CSV para abrir en Excel/LibreOffice: separador coma, CRLF y BOM para que
// las tildes se lean bien. Un texto que empieza con = + - @ se antepone con '
// para que la hoja no lo ejecute como fórmula (las notas son texto libre).
export function csvCell(v: Cell): string {
  if (v === null || v === undefined) return ''
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : ''
  if (typeof v === 'boolean') return v ? '1' : '0'
  let s = v
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

// `preamble` va como primera línea tal cual (p. ej. el comentario de versión del
// dataset de la tesis), antes del encabezado
export function toCsv(header: string[], rows: Cell[][], preamble?: string): string {
  const lines = [header, ...rows].map(r => r.map(csvCell).join(','))
  if (preamble) lines.unshift(preamble)
  return '﻿' + lines.join('\r\n') + '\r\n'
}
