// Código estable de un insumo a partir de su nombre: mayúsculas, sin tildes y con
// "_" como separador ("Conchas negras" → CONCHAS_NEGRAS). Es el identificador del
// insumo en el análisis de la tesis, por eso no cambia aunque cambie el nombre.
export const SUPPLY_CODE_RE = /^[A-Z0-9_]{2,30}$/

export function supplyCodeFrom(name: string): string {
  const code = name.normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 30)
  return code.length >= 2 ? code : `INSUMO_${code}`.replace(/_$/, '')
}

// Si el código ya existe se agrega un sufijo: CALAMAR → CALAMAR_2
export function uniqueCode(base: string, taken: Set<string>): string {
  let code = base
  for (let n = 2; taken.has(code); n++) code = `${base.slice(0, 27)}_${n}`
  return code
}
