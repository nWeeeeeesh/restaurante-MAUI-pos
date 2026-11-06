// Pronóstico de demanda y lista de compra (incremento 3, plan-sistema T15). Coordina el
// repositorio y el dominio; recibe el ejecutor y el local por parámetro.
import { eq } from 'drizzle-orm'
import { db as defaultDb, type DB, type Executor } from '../db'
import { demandForecasts, forecastRuns, purchaseSuggestions } from '../db/schema'
import { withWriteLock } from '../db/write-lock'
import {
  leerDatosPronostico, pronosticosDeNoche, pronosticosDeInsumo, ultimosConteos, ventasHasta, platosDisponibles, type ParametrosInsumo,
} from '../repositories/forecast.repo'
import { anteriorAtencion } from '../domain/calendar'
import { pronosticoNoche, serieDemanda, HORIZONTES } from '../domain/demand'
import { cantidadSugerida, cobertura, MODEL_VERSION, redondearMedioKilo, stockTeorico as f6, zNormal } from '../domain/forecast'
import { claveVariante, costearInsumo } from '../domain/profitability'
import { suma } from '../domain/costing'
import { limaDate } from '../utils/dates'

// Un plato con esta cantidad de porciones o menos genera un aviso (RF18)
export const UMBRAL_PORCIONES = 5
// Nivel de servicio cuando el insumo no lo tiene configurado
export const NIVEL_POR_DEFECTO = 0.95
export const COBERTURA_POR_DEFECTO = 2
// Solo se pronostican 3 días de atención: la cobertura no puede pasar de ahí
export const COBERTURA_MAXIMA = HORIZONTES.length

const kg = (n: number | null) => (n === null ? null : Math.round(n * 1000) / 1000)

// Pronostica los 3 días de atención siguientes a `madeOn` para cada insumo crítico.
// Idempotente (RD04): lo ya guardado esa noche no se toca. Registra la ejecución.
export async function generarPronosticos(db: DB = defaultDb, { localId, madeOn }: { localId: number; madeOn: string }) {
  const [run] = await withWriteLock(() => db.insert(forecastRuns).values({ localId, madeOn, status: 'running' }).returning())
  try {
    const existentes = await pronosticosDeNoche(db, localId, madeOn)
    const hechos = new Set(existentes.map(r => r.supplyId))
    const datos = await leerDatosPronostico(db, { localId, hasta: madeOn })
    const nuevos = datos.insumos.filter(i => !hechos.has(i.id)).map(i => {
      const f = datos.demanda.costeo.factores.get(i.id) ?? 1
      return { insumo: i, p: pronosticoNoche(datos.demanda, i.id, madeOn, f) }
    })
    const filas = nuevos.flatMap(({ insumo, p }) => HORIZONTES.map((h, k) => ({
      localId, supplyId: insumo.id, madeOn, targetDate: p.objetivos[k], horizon: h, method: p.metodo,
      valueKg: p.valores[k], sigmaH: p.sigmas[k], modelVersion: MODEL_VERSION,
    })))
    await withWriteLock(() => db.transaction(async (tx) => {
      // onConflictDoNothing: si otra ejecución guardó esa noche entre tanto, gana la primera
      if (filas.length > 0) await tx.insert(demandForecasts).values(filas).onConflictDoNothing()
      await tx.update(forecastRuns).set({ status: 'ok', finishedAt: new Date().toISOString().slice(0, 19).replace('T', ' ') }).where(eq(forecastRuns.id, run.id))
    }))
    return { madeOn, runId: run.id, created: nuevos.map(n => n.insumo.code), skipped: datos.insumos.filter(i => hechos.has(i.id)).map(i => i.code) }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    await withWriteLock(() => db.update(forecastRuns)
      .set({ status: 'error', error: msg.slice(0, 500), finishedAt: new Date().toISOString().slice(0, 19).replace('T', ' ') })
      .where(eq(forecastRuns.id, run.id)))
    throw err
  }
}

// Calendario de días de atención con lo registrado hasta `hasta` (para la tarea nocturna)
export async function calendarioHasta(ex: Executor, { localId, hasta }: { localId: number; hasta: string }) {
  return (await leerDatosPronostico(ex, { localId, hasta })).demanda.costeo.calendario
}

export interface ConsultaLista {
  localId: number
  date: string
  // Días de atención a cubrir: uno para todos o por insumo (id → días)
  coverageDays?: number | Record<number, number>
}

// Lista de compra de `date` (F2) con los pronósticos de la noche anterior; guarda cada
// sugerencia mostrada en purchase_suggestions
export async function listaCompra(db: DB = defaultDb, q: ConsultaLista, userId: number | null) {
  let datos = await leerDatosPronostico(db, { localId: q.localId, hasta: q.date })
  const noche = anteriorAtencion(datos.demanda.costeo.calendario, q.date)
  let rows = await pronosticosDeNoche(db, q.localId, noche)
  if (datos.insumos.some(i => !rows.some(r => r.supplyId === i.id))) {
    await generarPronosticos(db, { localId: q.localId, madeOn: noche })
    rows = await pronosticosDeNoche(db, q.localId, noche)
    datos = await leerDatosPronostico(db, { localId: q.localId, hasta: q.date })
  }
  const { costeo } = datos.demanda
  const pedida = (id: number) => (typeof q.coverageDays === 'number' ? q.coverageDays : q.coverageDays?.[id]) ?? COBERTURA_POR_DEFECTO

  const items = datos.insumos.map((i: ParametrosInsumo) => {
    const f = costeo.factores.get(i.id) ?? 1
    const H = Math.min(COBERTURA_MAXIMA, cobertura(pedida(i.id), i.shelfLifeDays))
    const propios = rows.filter(r => r.supplyId === i.id).sort((a, b) => a.horizon - b.horizon)
    const cubiertos = propios.slice(0, H)
    const sigma = propios[H - 1]?.sigmaH ?? 0
    const nivel = i.serviceLevel ?? NIVEL_POR_DEFECTO
    const z = zNormal(nivel)
    // Disponible: el conteo de apertura de la fecha o, si no hay, el stock teórico (F6)
    // al cierre de la noche anterior desde el último conteo
    const conteo = costeo.conteos.get(i.id)?.get(q.date)
    let A: number
    let fuente: 'conteo' | 'teorico'
    if (conteo !== undefined) {
      A = conteo
      fuente = 'conteo'
    } else {
      fuente = 'teorico'
      const filas = costearInsumo(costeo, i.id, noche, f, noche)
      const ultimo = [...filas].reverse().find(x => costeo.conteos.get(i.id)?.has(x.fecha))
      if (ultimo === undefined) A = 0
      else {
        const tramo = filas.filter(x => x.fecha >= ultimo.fecha)
        const receta = costeo.consumoReceta.get(i.id)
        A = f6(costeo.conteos.get(i.id)!.get(ultimo.fecha)!, suma(tramo.map(x => x.I)), f, suma(tramo.map(x => receta?.get(x.fecha) ?? 0)))
      }
    }
    const forecastSum = suma(cubiertos.map(r => r.valueKg))
    const Q = cantidadSugerida(cubiertos.map(r => r.valueKg), sigma, z, A)
    return {
      supplyId: i.id, code: i.code, name: i.name, coverageDays: H, shelfLifeDays: i.shelfLifeDays, serviceLevel: nivel,
      method: propios[0]?.method ?? null, madeOn: noche,
      forecast: cubiertos.map(r => ({ date: r.targetDate, horizon: r.horizon, kg: kg(r.valueKg)! })),
      forecastSum, sigmaH: sigma, z, safetyStock: z * sigma, available: A, availableSource: fuente, quantity: Q,
    }
  })

  await withWriteLock(() => db.insert(purchaseSuggestions).values(items.map(it => ({
    localId: q.localId, supplyId: it.supplyId, date: q.date, coverageDays: it.coverageDays, forecastSum: it.forecastSum,
    safetyStock: it.safetyStock, available: it.available, availableSource: it.availableSource, quantity: it.quantity,
    serviceLevel: it.serviceLevel, modelVersion: MODEL_VERSION, createdBy: userId,
  }))))

  return {
    date: q.date, night: noche, modelVersion: MODEL_VERSION,
    items: items.map(it => ({
      ...it, forecastSum: kg(it.forecastSum), sigmaH: kg(it.sigmaH), z: Math.round(it.z * 10000) / 10000,
      safetyStock: kg(it.safetyStock), available: kg(it.available), quantity: kg(it.quantity),
      // Lo que se compra: al alza, en medios kilos
      toBuy: redondearMedioKilo(it.quantity),
    })),
  }
}

// F6 en un instante: último conteo + lo que entró desde ese día − f · lo vendido hasta `at`
export async function stockTeorico(ex: Executor = defaultDb, { localId, at }: { localId: number; at: Date }) {
  const hoy = limaDate(at)
  const datos = await leerDatosPronostico(ex, { localId, hasta: hoy })
  const { costeo } = datos.demanda
  const ultimos = await ultimosConteos(ex, localId, hoy)
  const variantes = new Map<number, Set<string>>()
  for (const key of datos.demanda.recetas.keys()) {
    const [dishId, variant] = key.split('|')
    if (variant) variantes.set(Number(dishId), (variantes.get(Number(dishId)) ?? new Set()).add(variant))
  }
  const atUtc = at.toISOString().slice(0, 19).replace('T', ' ')
  const out = []
  for (const i of datos.insumos) {
    const f = costeo.factores.get(i.id) ?? 1
    const dia = ultimos.get(i.id)
    if (dia === undefined) { out.push({ supplyId: i.id, code: i.code, name: i.name, stockKg: null, countedOn: null, factor: f }); continue }
    const A = costeo.conteos.get(i.id)!.get(dia)!
    let I = 0
    for (const [fecha, m] of costeo.movimientos.get(i.id) ?? []) if (fecha >= dia && fecha <= hoy) I += m.compraKg - m.enviadoKg + m.recibidoKg
    const vendidas = await ventasHasta(ex, dia, atUtc, variantes)
    let consumo = 0
    for (const [key, porciones] of vendidas) {
      const r = datos.demanda.recetas.get(key) ?? datos.demanda.recetas.get(claveVariante(Number(key.split('|')[0]), ''))
      consumo += porciones * (r?.get(i.id) ?? 0)
    }
    out.push({ supplyId: i.id, code: i.code, name: i.name, stockKg: f6(A, I, f, consumo), countedOn: dia, factor: f })
  }
  return { at: atUtc, items: out, recetas: datos.demanda.recetas }
}

export interface Aviso {
  dishId: number
  name: string
  portionsLeft: number
  supplyCode: string
}

// Platos disponibles cuya receta ya no alcanza para más de `umbralPorciones` con el
// stock teórico de algún insumo. Solo avisa: marcar agotado lo decide una persona (RD02).
export async function avisos(ex: Executor = defaultDb, { localId, at, umbralPorciones = 5 }: { localId: number; at: Date; umbralPorciones?: number }): Promise<Aviso[]> {
  const st = await stockTeorico(ex, { localId, at })
  const stock = new Map(st.items.map(i => [i.supplyId, i]))
  const out: Aviso[] = []
  for (const d of await platosDisponibles(ex)) {
    const receta = st.recetas.get(claveVariante(d.id, ''))
    if (!receta) continue
    let min: { portions: number; code: string } | null = null
    for (const [supplyId, kgPorcion] of receta) {
      const s = stock.get(supplyId)
      if (!s || s.stockKg === null || kgPorcion <= 0) continue
      // Tolerancia: 1.2 / 0.2 da 5.999… en coma flotante y son 6 porciones
      const portions = Math.max(0, Math.floor(s.stockKg / (kgPorcion * s.factor) + 1e-9))
      if (min === null || portions < min.portions) min = { portions, code: s.code }
    }
    if (min !== null && min.portions <= umbralPorciones) out.push({ dishId: d.id, name: d.name, portionsLeft: min.portions, supplyCode: min.code })
  }
  return out.sort((a, b) => a.portionsLeft - b.portionsLeft || a.name.localeCompare(b.name, 'es'))
}

// Avisos que conviene emitir después de un cobro: los platos bajo el umbral cuya
// cantidad de porciones cambió desde el último aviso del día (en memoria del proceso)
const avisados = new Map<string, number>()
let diaAvisos = ''

export async function avisosNuevos(ex: Executor, { localId, at }: { localId: number; at: Date }): Promise<Aviso[]> {
  const dia = limaDate(at)
  if (dia !== diaAvisos) {
    avisados.clear()
    diaAvisos = dia
  }
  const list = await avisos(ex, { localId, at, umbralPorciones: UMBRAL_PORCIONES })
  return list.filter(a => {
    const key = `${localId}|${a.dishId}`
    if (avisados.get(key) === a.portionsLeft) return false
    avisados.set(key, a.portionsLeft)
    return true
  })
}

// Pronóstico frente a demanda de un insumo, solo para consulta (RF16)
export async function historial(ex: Executor, { localId, supplyId, from, to }: { localId: number; supplyId: number; from: string; to: string }) {
  const datos = await leerDatosPronostico(ex, { localId, hasta: to })
  const insumo = datos.insumos.find(i => i.id === supplyId)
  if (!insumo) return null
  const f = datos.demanda.costeo.factores.get(supplyId) ?? 1
  const serie = serieDemanda(datos.demanda, supplyId, to, f)
  const guardados = await pronosticosDeInsumo(ex, localId, supplyId, from, to)
  const dias = serie.filas.map((x, k) => ({ date: x.fecha, demandKg: kg(serie.y[k])!, imputed: serie.imputado[k] }))
    .filter(d => d.date >= from && d.date <= to)
  return {
    supply: { id: insumo.id, code: insumo.code, name: insumo.name },
    days: dias.map(d => ({
      ...d,
      forecasts: guardados.filter(g => g.targetDate === d.date)
        .map(g => ({ madeOn: g.madeOn, horizon: g.horizon, kg: kg(g.valueKg)!, method: g.method })),
    })),
  }
}

