// Pronóstico de demanda y cantidad sugerida (plan-sistema §4.2, incremento 3). Funciones
// PURAS, espejo de scripts/tesis/formulas.py: mismo orden de operaciones y sumas de
// izquierda a derecha, para que el método elegido y sus empates coincidan con la
// referencia (prueba de paridad PP-02).
import { suma } from './costing'

export const M_EST = 6 // estacionalidad: días de atención por semana (martes a domingo)
export const METODOS = ['ingenuo_estacional', 'promedio_estacional', 'holt_winters', 'regresion_calendario'] as const
export type Metodo = typeof METODOS[number]
// 0.05, 0.10, …, 0.95 (k·5/100 da el double más cercano, igual que round(0.05·k, 2))
export const REJILLA: readonly number[] = Array.from({ length: 19 }, (_, i) => (i + 1) * 5 / 100)
export const MODEL_VERSION = 'mauidesk-forecast-1'

// F4. Σ max(0, v̄ − V) · q · f sobre los platos agotados que usan el insumo
export function ventasPerdidas<K>(
  agotados: readonly K[],
  habitual: ReadonlyMap<K, number>,
  vendidas: ReadonlyMap<K, number>,
  recetaKg: ReadonlyMap<K, number>,
  f: number,
): number {
  let L = 0
  for (const p of agotados) {
    const q = recetaKg.get(p) ?? 0
    if (q) L += Math.max(0, (habitual.get(p) ?? 0) - (vendidas.get(p) ?? 0)) * q * f
  }
  return L
}

// F5
export function demandaNoCensurada(C: number, L: number): number {
  return C + L
}

// F6. A + I − f · Σ q · V
export function stockTeorico(A: number, I: number, f: number, consumoReceta: number): number {
  return A + I - f * consumoReceta
}

// H = min(cobertura pedida, vida útil)
export function cobertura(pedida: number, vidaUtil: number | null): number {
  return vidaUtil ? Math.min(pedida, vidaUtil) : pedida
}

// F2. Σ pronósticos de los H días + z·σ_H − disponible; nunca negativa
export function cantidadSugerida(pronosticos: readonly number[], sigmaH: number, z: number, A: number): number {
  return Math.max(0, suma(pronosticos) + z * sigmaH - A)
}

// Para mostrar: al alza, en medios kilos
export function redondearMedioKilo(q: number): number {
  return Math.ceil(q * 2 - 1e-9) / 2
}

// (margen perdido + merma) con la compra real − lo mismo con la sugerida
export function beneficioPotencial(margenPerdidoReal: number, costoMermaReal: number, margenPerdidoSugerida: number, costoMermaSugerida: number): number {
  return (margenPerdidoReal + costoMermaReal) - (margenPerdidoSugerida + costoMermaSugerida)
}

// Inversa de la normal estándar (Acklam, error relativo < 1.15e-9)
export function zNormal(p: number): number {
  if (!(p > 0 && p < 1)) throw new RangeError('p debe estar en (0, 1)')
  const a = [-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02, 1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00]
  const b = [-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02, 6.680131188771972e+01, -1.328068155288572e+01]
  const c = [-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00, -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00]
  const d = [7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00, 3.754408661907416e+00]
  const plow = 0.02425
  if (p < plow) {
    const q = Math.sqrt(-2 * Math.log(p))
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
  }
  if (p > 1 - plow) {
    const q = Math.sqrt(-2 * Math.log(1 - p))
    return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
  }
  const q = p - 0.5
  const r = q * q
  return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1)
}

// Índice del mismo día de la semana más reciente para el horizonte k
const base = (n: number, k: number, m: number) => n - 1 + k - m * Math.ceil(k / m)

export function ingenuoEstacional(y: readonly number[], h: number, m = M_EST): number[] {
  return Array.from({ length: h }, (_, i) => y[base(y.length, i + 1, m)])
}

// Promedio del mismo día de la semana en las últimas 4 semanas disponibles (mínimo 1)
export function promedioEstacional(y: readonly number[], h: number, m = M_EST): number[] {
  const out: number[] = []
  for (let k = 1; k <= h; k++) {
    const b0 = base(y.length, k, m)
    const vals: number[] = []
    for (let w = 0; w < 4; w++) if (b0 - m * w >= 0) vals.push(y[b0 - m * w])
    out.push(suma(vals) / vals.length)
  }
  return out
}

// Holt-Winters aditivo sin tendencia: SSE a un paso, nivel final y estacionales
function hwAjuste(y: readonly number[], alfa: number, gamma: number, m: number) {
  let nivel = suma(y.slice(0, m)) / m
  const est: number[] = []
  for (let i = 0; i < m; i++) est.push(y[i] - nivel)
  let sse = 0
  for (let t = m; t < y.length; t++) {
    const sPrev = est[t - m]
    const pred = nivel + sPrev
    const e = y[t] - pred
    sse += e * e
    const nuevo = alfa * (y[t] - sPrev) + (1 - alfa) * nivel
    est.push(gamma * (y[t] - nuevo) + (1 - gamma) * sPrev)
    nivel = nuevo
  }
  return { sse, nivel, est }
}

// α y γ por rejilla minimizando el SSE; en empate, menor α y luego menor γ. Recorte en 0.
export function holtWinters(y: readonly number[], h: number, m = M_EST): number[] {
  let mejor: { sse: number; alfa: number; gamma: number } | null = null
  for (const alfa of REJILLA) {
    for (const gamma of REJILLA) {
      const { sse } = hwAjuste(y, alfa, gamma, m)
      if (mejor === null || sse < mejor.sse) mejor = { sse, alfa, gamma }
    }
  }
  const { nivel, est } = hwAjuste(y, mejor!.alfa, mejor!.gamma, m)
  return Array.from({ length: h }, (_, i) => Math.max(0, nivel + est[base(y.length, i + 1, m)]))
}

// A·x = b por eliminación de Gauss con pivoteo parcial; null si es singular
export function gauss(A: readonly number[][], b: readonly number[]): number[] | null {
  const n = A.length
  const M = A.map((row, i) => [...row, b[i]])
  for (let col = 0; col < n; col++) {
    let piv = col
    for (let r = col + 1; r < n; r++) if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r
    if (Math.abs(M[piv][col]) < 1e-10) return null
    ;[M[col], M[piv]] = [M[piv], M[col]]
    for (let r = col + 1; r < n; r++) {
      const factor = M[r][col] / M[col][col]
      if (factor) for (let c2 = col; c2 <= n; c2++) M[r][c2] -= factor * M[col][c2]
    }
  }
  const x = new Array<number>(n).fill(0)
  for (let r = n - 1; r >= 0; r--) {
    const terms: number[] = []
    for (let c2 = r + 1; c2 < n; c2++) terms.push(M[r][c2] * x[c2])
    x[r] = (M[r][n] - suma(terms)) / M[r][r]
  }
  return x
}

type Columna = number | 'feriado'

function fila(t: number, dow: number, feriado: boolean, columnas: readonly Columna[]): number[] {
  const out = [1, t]
  for (const c of columnas) out.push(c === 'feriado' ? (feriado ? 1 : 0) : (dow === c ? 1 : 0))
  return out
}

// Intercepto, tendencia, días de la semana (martes = base) y feriado, con los últimos 48
// días. dows: 1 = martes … 6 = domingo. Se omiten las columnas que no varían en la
// ventana; si el sistema es singular, null. Recorte en 0.
export function regresionCalendario(
  y: readonly number[], h: number, dows: readonly number[], feriados: readonly boolean[],
  dowsFut: readonly number[], feriadosFut: readonly boolean[], nMax = 48,
): number[] | null {
  const n = Math.min(y.length, nMax)
  const yy = y.slice(y.length - n)
  const dd = dows.slice(dows.length - n)
  const ff = feriados.slice(feriados.length - n)
  const columnas: Columna[] = [2, 3, 4, 5, 6].filter(d => dd.some(x => x === d))
  if (ff.some(Boolean) && !ff.every(Boolean)) columnas.push('feriado')
  const X = Array.from({ length: n }, (_, t) => fila(t, dd[t], ff[t], columnas))
  const p = X[0]?.length ?? 2 + columnas.length
  if (n <= p) return null
  const XtX: number[][] = []
  for (let i = 0; i < p; i++) {
    const rowv: number[] = []
    for (let j = 0; j < p; j++) {
      const terms: number[] = []
      for (let r = 0; r < n; r++) terms.push(X[r][i] * X[r][j])
      rowv.push(suma(terms))
    }
    XtX.push(rowv)
  }
  const Xty: number[] = []
  for (let i = 0; i < p; i++) {
    const terms: number[] = []
    for (let r = 0; r < n; r++) terms.push(X[r][i] * yy[r])
    Xty.push(suma(terms))
  }
  const beta = gauss(XtX, Xty)
  if (beta === null) return null
  const out: number[] = []
  for (let k = 1; k <= h; k++) {
    const fl = fila(n - 1 + k, dowsFut[k - 1], feriadosFut[k - 1], columnas)
    out.push(Math.max(0, suma(beta.map((b, i) => b * fl[i]))))
  }
  return out
}

export function pronosticar(
  metodo: Metodo, y: readonly number[], h: number, dows: readonly number[], feriados: readonly boolean[],
  dowsFut: readonly number[], feriadosFut: readonly boolean[],
): number[] {
  if (metodo === 'ingenuo_estacional') return ingenuoEstacional(y, h)
  if (metodo === 'promedio_estacional') return promedioEstacional(y, h)
  if (metodo === 'holt_winters') return holtWinters(y, h)
  // Sin solución (ventana sin variación suficiente): se comporta como el promedio estacional
  return regresionCalendario(y, h, dows, feriados, dowsFut, feriadosFut) ?? promedioEstacional(y, h)
}

// Con menos de 12 días: promedio estacional si hay ≥ 6, si no promedio simple; sin datos, 0
export function respaldo(y: readonly number[], h: number, m = M_EST): number[] {
  if (y.length === 0) return new Array<number>(h).fill(0)
  if (y.length >= m) return promedioEstacional(y, h, m)
  const prom = suma(y) / y.length
  return new Array<number>(h).fill(prom)
}

// Días de la semana de los objetivos que caen fuera de la serie: siguen el ciclo 1…6
function completarDows(ultimo: number, futuros: readonly (number | null)[]): number[] {
  const out: number[] = []
  let prev = ultimo
  for (const d0 of futuros) {
    const d = d0 ?? (prev === 6 ? 1 : prev + 1)
    out.push(d)
    prev = d
  }
  return out
}

export interface Seleccion {
  metodo: Metodo
  mae: Record<Metodo, number>
  sigmaH: number
}

export interface SeleccionMulti {
  metodo: Metodo
  mae: Record<Metodo, number>
  sigmas: Map<number, number>   // σ_H para cada H pedido
}

// Elige el método por MAE con origen móvil y calcula σ_H (ver formulas.seleccionar):
// orígenes o = n−hMax−W … n−hMax−1 con W = min(24, n − 12); MAE de los horizontes
// 1…hMax sin días imputados; σ_H del error acumulado en H días (≥ 6 errores; si no,
// 25 % del promedio × √H). Con menos de 12 días, null (se usa el respaldo).
export function seleccionar(
  y: readonly number[], imputado: readonly boolean[], dows: readonly number[], feriados: readonly boolean[],
  H: number, hMax = 3, wMax = 24, minHist = 12,
): Seleccion | null {
  const r = seleccionarMulti(y, imputado, dows, feriados, [H], hMax, wMax, minHist)
  return r && { metodo: r.metodo, mae: r.mae, sigmaH: r.sigmas.get(H)! }
}

// Lo mismo, con σ_H para varios H en una sola pasada (cada fila guardada lleva el σ de
// su horizonte). Los orígenes y el MAE no dependen de H mientras H ≤ hMax.
export function seleccionarMulti(
  y: readonly number[], imputado: readonly boolean[], dows: readonly number[], feriados: readonly boolean[],
  Hs: readonly number[], hMax = 3, wMax = 24, minHist = 12,
): SeleccionMulti | null {
  const n = y.length
  if (n < minHist) return null
  const W = Math.min(wMax, n - minHist)
  const hh = Math.max(hMax, ...Hs)
  const errores = Object.fromEntries(METODOS.map(m => [m, [] as number[]])) as Record<Metodo, number[]>
  const acumulados = new Map(Hs.map(H => [H, Object.fromEntries(METODOS.map(m => [m, [] as number[]])) as Record<Metodo, number[]>]))
  for (let o = n - hMax - W; o < n - hMax; o++) {
    const objetivos: number[] = []
    for (let t = o + 1; t < o + 1 + hh; t++) if (t < n) objetivos.push(t)
    const futD: (number | null)[] = [...objetivos.map(t => dows[t]), ...new Array<null>(hh - objetivos.length).fill(null)]
    const futF: boolean[] = [...objetivos.map(t => feriados[t]), ...new Array<boolean>(hh - objetivos.length).fill(false)]
    const dowsFut = completarDows(dows[o], futD)
    const tr = y.slice(0, o + 1)
    const trD = dows.slice(0, o + 1)
    const trF = feriados.slice(0, o + 1)
    for (const metodo of METODOS) {
      const f = pronosticar(metodo, tr, hh, trD, trF, dowsFut, futF)
      for (let k = 0; k < hMax; k++) {
        const t = o + 1 + k
        if (!imputado[t]) errores[metodo].push(Math.abs(y[t] - f[k]))
      }
      for (const H of Hs) {
        if (o + H >= n) continue
        let algunoImputado = false
        for (let t = o + 1; t < o + 1 + H; t++) if (imputado[t]) algunoImputado = true
        if (algunoImputado) continue
        const reales: number[] = []
        for (let t = o + 1; t < o + 1 + H; t++) reales.push(y[t])
        acumulados.get(H)![metodo].push(suma(reales) - suma(f.slice(0, H)))
      }
    }
  }
  const mae = Object.fromEntries(METODOS.map(m => [m, errores[m].length ? suma(errores[m]) / errores[m].length : Infinity])) as Record<Metodo, number>
  let metodo: Metodo = METODOS[0]
  for (const m of METODOS) if (mae[m] < mae[metodo]) metodo = m
  const sigmas = new Map<number, number>()
  for (const H of Hs) {
    const errs = acumulados.get(H)![metodo]
    if (errs.length >= 6) {
      const prom = suma(errs) / errs.length
      sigmas.set(H, Math.sqrt(suma(errs.map(e => (e - prom) * (e - prom))) / (errs.length - 1)))
    } else {
      sigmas.set(H, 0.25 * (suma(y) / n) * Math.sqrt(H))
    }
  }
  return { metodo, mae, sigmas }
}
