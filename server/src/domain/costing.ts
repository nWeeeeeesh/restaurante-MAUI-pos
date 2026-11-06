// Fórmulas de costeo de la tesis (plan-sistema §4.1, incremento 2). Funciones PURAS:
// sin BD, sin entorno y sin reloj; reciben todo por parámetro. Se calcula en precisión
// completa y se redondea solo al responder. Su contraparte en Python, con la que se
// comparan las pruebas de paridad, es scripts/tesis/formulas.py.

// Suma de izquierda a derecha, en el mismo orden que la referencia en Python
export function suma(xs: readonly number[]): number {
  let t = 0
  for (const x of xs) t += x
  return t
}

// La receta va en gramos de producto limpio; se compra el producto entero
export function kgPorPorcion(gramosLimpios: number, rendimiento: number): number {
  return gramosLimpios / 1000 / rendimiento
}

// F8. Costo promedio ponderado después de la compra del día. Sin compra no cambia; sin
// historia (pPrev null) o sin stock, vale el precio de la compra.
export function costoPromedio(stockPrev: number, pPrev: number | null, compra: number, pCompra: number | null): number | null {
  if (compra <= 0) return pPrev
  if (stockPrev + compra <= 0 || pPrev === null) return pCompra
  return (stockPrev * pPrev + compra * (pCompra ?? 0)) / (stockPrev + compra)
}

// F7. Apertura + ingresos − merma − apertura del siguiente día de atención
export function consumoReal(A: number, I: number, M: number, Asig: number): number {
  return A + I - M - Asig
}

// Consumo según receta cuando falta un conteo: f × Σ porciones × kg por porción
export function consumoTeorico(f: number, consumoReceta: number): number {
  return f * consumoReceta
}

export interface DiaInsumo {
  C: number   // consumo (real o teórico)
  M: number   // merma imputada al día
  p: number   // costo promedio del día (F8)
}

// F9. Σ (consumo + merma) · costo promedio + otros insumos del periodo
export function costoLoVendido(dias: readonly DiaInsumo[], otros: number): number {
  return otros + suma(dias.map(d => (d.C + d.M) * d.p))
}

export type TipoGasto = 'fijo' | 'variable'
export interface GastoMes { categoria: string; monto: number; tipo: TipoGasto }

// Cada gasto mensual se reparte entre los días de atención de su mes; el periodo
// toma los días que tiene en ese mes. GF: solo las categorías fijas.
export function prorratearGastos(
  gastosMes: ReadonlyMap<string, readonly GastoMes[]>,
  diasAtencionMes: ReadonlyMap<string, number>,
  diasPeriodoPorMes: ReadonlyMap<string, number>,
): { G: number; GF: number } {
  let G = 0
  let GF = 0
  for (const [mes, n] of diasPeriodoPorMes) {
    const total = diasAtencionMes.get(mes) ?? 0
    if (n <= 0 || total <= 0) continue
    for (const g of gastosMes.get(mes) ?? []) {
      const parte = g.monto * n / total
      G += parte
      if (g.tipo === 'fijo') GF += parte
    }
  }
  return { G, GF }
}

export interface Resultado {
  UB: number
  UO: number
  foodCost: number | null  // %
  Veq: number | null       // ventas de equilibrio
}

// F10 y F15. Con V = 0 (o margen no positivo) food cost y Veq no aplican: null
export function resultado(V: number, CV: number, G: number, GF: number): Resultado {
  const UB = V - CV
  const UO = UB - G
  if (V === 0) return { UB, UO, foodCost: null, Veq: null }
  const margen = 1 - CV / V
  return { UB, UO, foodCost: CV / V * 100, Veq: margen > 0 ? GF / margen : null }
}

// F11 sobre las listas por día: % de merma frente a los ingresos y su costo en S/
export function merma(M: readonly number[], I: readonly number[], p: readonly number[]): { pct: number | null; soles: number } {
  const sm = suma(M)
  const si = suma(I)
  return { pct: si > 0 ? sm / si * 100 : null, soles: suma(M.map((m, k) => m * p[k])) }
}

// F12. Σ consumo real / Σ consumo según receta, solo con los días que tienen conteo
export function factorCalibracion(consumoReal: readonly number[], consumoReceta: readonly number[]): number | null {
  const teorico = suma(consumoReceta)
  if (teorico <= 0) return null
  return suma(consumoReal) / teorico
}

export const RANGO_FACTOR = { min: 0.7, max: 1.3 } as const

export function fueraDeRango(f: number, min: number = RANGO_FACTOR.min, max: number = RANGO_FACTOR.max): boolean {
  return f < min || f > max
}

// F13. Σ_i kg_i · f_i · p̄_i + (otros insumos / ventas) · precio. Un plato sin receta
// solo lleva los otros insumos.
export function costoPlato<K>(
  recetaKg: ReadonlyMap<K, number>,
  factores: ReadonlyMap<K, number>,
  pbar: ReadonlyMap<K, number | null>,
  otrosPorSol: number,
  precio: number,
): number {
  let c = 0
  for (const [insumo, kg] of recetaKg) c += kg * (factores.get(insumo) ?? 1) * (pbar.get(insumo) ?? 0)
  return c + otrosPorSol * precio
}

// F14
export function margen(precio: number, costo: number): { MC: number; MCpct: number | null } {
  const MC = precio - costo
  return { MC, MCpct: precio > 0 ? MC / precio * 100 : null }
}

export type CategoriaMenu = 'Estrella' | 'Caballo de batalla' | 'Rompecabezas' | 'Perro'

// Ingeniería de menú (Kasavana y Smith) sobre los platos vendidos en el periodo:
// popular si su participación ≥ 70 % de 1/n; margen alto si supera el margen
// promedio ponderado por las porciones.
export function ingenieriaMenu<K>(porciones: ReadonlyMap<K, number>, margenes: ReadonlyMap<K, number>): Map<K, CategoriaMenu> {
  const out = new Map<K, CategoriaMenu>()
  const n = porciones.size
  const total = suma([...porciones.values()])
  if (n === 0 || total === 0) return out
  const promedio = suma([...porciones].map(([k, q]) => q * (margenes.get(k) ?? 0))) / total
  for (const [k, q] of porciones) {
    const popular = q / total >= 0.7 / n
    const alto = (margenes.get(k) ?? 0) > promedio
    out.set(k, popular ? (alto ? 'Estrella' : 'Caballo de batalla') : (alto ? 'Rompecabezas' : 'Perro'))
  }
  return out
}
