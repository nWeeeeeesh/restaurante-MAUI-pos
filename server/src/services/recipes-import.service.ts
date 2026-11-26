// Carga de recetas desde un CSV (npm run db:recetas, scripts/load-recetas.ts). Sin
// recetas, el panel de rentabilidad sale en cero con los datos del local.
//
// - Cada fila se busca por el nombre del plato (sin distinguir mayúsculas ni tildes)
//   entre los platos no archivados. Nunca crea platos.
// - La variante es la opción de modificador que se elige al vender («Pescado»): se busca
//   entre las opciones de ese plato y se guarda con su nombre exacto. Sin variante, la
//   receta es la del plato ('').
// - Cada columna `<insumo>_g` se busca por el código del insumo (pescado_g → PESCADO).
//   Igual que PUT /api/recipes/:dishId, la receta solo lleva insumos críticos: las
//   columnas de insumos no críticos o inexistentes se omiten y se informan.
// - Por defecto no toca un plato que ya tenga receta; con `reemplazar`, la receta del
//   plato se reemplaza completa, como en el endpoint, con la misma auditoría.
// - `otros_insumos_S` no se carga: el esquema no guarda un costo de otros insumos por
//   plato (el costo del plato usa los otros insumos del día por sol vendido).
import { eq, inArray } from 'drizzle-orm'
import type { DB, Executor } from '../db'
import { dishes, modifierGroups, modifierOptions, recipeItems, supplies } from '../db/schema'
import { withWriteLock } from '../db/write-lock'
import { RecipeSchema, type RecipeInput } from '../schemas/recipes'
import { audit } from './audit'

export interface OpcionesRecetas {
  reemplazar?: boolean
  dryRun?: boolean
}

export interface PlatoCargado {
  dishId: number
  plato: string
  variantes: string[]
  items: number
  reemplazado: boolean
}

export interface InformeRecetas {
  dryRun: boolean
  filas: number
  cargados: PlatoCargado[]
  conReceta: string[]
  noEncontrados: string[]
  sinGramos: string[]
  insumosOmitidos: { codigo: string; motivo: 'no_existe' | 'no_critico'; valores: number }[]
  otrosInsumosSinCargar: number
  errores: string[]
}

export const normalizar = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim()

// CSV con coma, comillas dobles opcionales y BOM al inicio
export function leerCsv(texto: string): Record<string, string>[] {
  const lineas = texto.replace(/^﻿/, '').split(/\r?\n/).filter(l => l.trim() !== '')
  if (lineas.length === 0) return []
  const campos = (linea: string) => {
    const out: string[] = []
    let actual = ''
    let comillas = false
    for (let i = 0; i < linea.length; i++) {
      const c = linea[i]
      if (comillas) {
        if (c === '"' && linea[i + 1] === '"') { actual += '"'; i++ }
        else if (c === '"') comillas = false
        else actual += c
      } else if (c === '"') comillas = true
      else if (c === ',') { out.push(actual); actual = '' }
      else actual += c
    }
    out.push(actual)
    return out.map(v => v.trim())
  }
  const cabecera = campos(lineas[0])
  return lineas.slice(1).map(l => {
    const v = campos(l)
    return Object.fromEntries(cabecera.map((h, i) => [h, v[i] ?? '']))
  })
}

interface Plan {
  informe: InformeRecetas
  escribir: { dishId: number; plato: string; items: RecipeInput; reemplazado: boolean }[]
}

async function planificar(ex: Executor, filas: Record<string, string>[], opciones: OpcionesRecetas): Promise<Plan> {
  const informe: InformeRecetas = {
    dryRun: !!opciones.dryRun, filas: filas.length, cargados: [], conReceta: [], noEncontrados: [], sinGramos: [],
    insumosOmitidos: [], otrosInsumosSinCargar: 0, errores: [],
  }
  if (filas.length === 0) return { informe, escribir: [] }
  if (!('plato' in filas[0])) throw new Error('El CSV no tiene la columna «plato»')

  // Columnas de gramos → insumo crítico
  const columnas = Object.keys(filas[0]).filter(c => c.endsWith('_g'))
  const insumos = await ex.select({ id: supplies.id, code: supplies.code, critical: supplies.critical }).from(supplies)
  const porCodigo = new Map(insumos.filter(s => s.code).map(s => [normalizar(s.code!), s]))
  const columnaInsumo = new Map<string, number>()
  for (const c of columnas) {
    const codigo = c.slice(0, -2).toUpperCase()
    const s = porCodigo.get(normalizar(codigo))
    if (s?.critical) { columnaInsumo.set(c, s.id); continue }
    const valores = filas.filter(f => Number(f[c]) > 0).length
    informe.insumosOmitidos.push({ codigo, motivo: s ? 'no_critico' : 'no_existe', valores })
  }

  // Platos no archivados por nombre normalizado
  const platos = await ex.select({ id: dishes.id, name: dishes.name }).from(dishes).where(eq(dishes.archived, false))
  const porNombre = new Map<string, { id: number; name: string }[]>()
  for (const p of platos) porNombre.set(normalizar(p.name), [...(porNombre.get(normalizar(p.name)) ?? []), p])

  // Recetas a escribir, agrupadas por plato
  const recetas = new Map<number, { plato: string; variantes: Map<string, Map<number, number>> }>()
  const pendientes: { fila: number; dish: { id: number; name: string }; variante: string; gramos: Map<number, number> }[] = []
  filas.forEach((f, i) => {
    const n = i + 2 // número de línea en el archivo (1 = cabecera)
    const nombre = (f.plato ?? '').trim()
    const variante = (f.variante ?? '').trim()
    const etiqueta = variante ? `${nombre} (${variante})` : nombre
    if (Number(f.otros_insumos_S) > 0) informe.otrosInsumosSinCargar++
    const candidatos = porNombre.get(normalizar(nombre)) ?? []
    if (candidatos.length !== 1) {
      informe.noEncontrados.push(candidatos.length > 1 ? `${etiqueta} — hay ${candidatos.length} platos con ese nombre` : etiqueta)
      return
    }
    const gramos = new Map<number, number>()
    for (const [c, supplyId] of columnaInsumo) {
      const texto = (f[c] ?? '').trim()
      const g = texto === '' ? 0 : Number(texto)
      if (!Number.isFinite(g) || g < 0 || g > 5000) {
        informe.errores.push(`Línea ${n}: «${c}» = «${texto}» no es un número de gramos válido; se omitió la fila`)
        return
      }
      if (g > 0) gramos.set(supplyId, g)
    }
    pendientes.push({ fila: n, dish: candidatos[0], variante, gramos })
  })

  // Variantes: opciones de modificador de cada plato encontrado
  const ids = [...new Set(pendientes.map(p => p.dish.id))]
  const modificadores = ids.length === 0 ? [] : await ex.select({ dishId: modifierGroups.dishId, name: modifierOptions.name })
    .from(modifierOptions).innerJoin(modifierGroups, eq(modifierOptions.groupId, modifierGroups.id))
    .where(inArray(modifierGroups.dishId, ids))
  const opcionesDe = new Map<number, Map<string, string>>()
  for (const o of modificadores) {
    const m = opcionesDe.get(o.dishId!) ?? new Map<string, string>()
    if (!m.has(normalizar(o.name))) m.set(normalizar(o.name), o.name)
    opcionesDe.set(o.dishId!, m)
  }

  for (const p of pendientes) {
    const etiqueta = p.variante ? `${p.dish.name} (${p.variante})` : p.dish.name
    let variant = ''
    if (p.variante) {
      const exacta = opcionesDe.get(p.dish.id)?.get(normalizar(p.variante))
      if (!exacta) { informe.noEncontrados.push(`${etiqueta} — el plato no tiene la opción «${p.variante}»`); continue }
      variant = exacta
    }
    const r = recetas.get(p.dish.id) ?? { plato: p.dish.name, variantes: new Map<string, Map<number, number>>() }
    if (r.variantes.has(variant)) { informe.errores.push(`Línea ${p.fila}: ${etiqueta} está repetido; se omitió la fila`); continue }
    if (p.gramos.size === 0) { informe.sinGramos.push(etiqueta); continue }
    r.variantes.set(variant, p.gramos)
    recetas.set(p.dish.id, r)
  }

  // Platos que ya tienen receta
  const conReceta = new Set(recetas.size === 0 ? [] : (await ex.selectDistinct({ dishId: recipeItems.dishId }).from(recipeItems)
    .where(inArray(recipeItems.dishId, [...recetas.keys()]))).map(r => r.dishId))

  const escribir: Plan['escribir'] = []
  for (const [dishId, r] of recetas) {
    if (conReceta.has(dishId) && !opciones.reemplazar) { informe.conReceta.push(r.plato); continue }
    const items = RecipeSchema.parse([...r.variantes].flatMap(([variant, g]) =>
      [...g].map(([supplyId, gramsClean]) => ({ variant, supplyId, gramsClean }))))
    escribir.push({ dishId, plato: r.plato, items, reemplazado: conReceta.has(dishId) })
    informe.cargados.push({ dishId, plato: r.plato, variantes: [...r.variantes.keys()], items: items.length, reemplazado: conReceta.has(dishId) })
  }
  return { informe, escribir }
}

export async function importarRecetas(db: DB, csv: string, opciones: OpcionesRecetas = {}): Promise<InformeRecetas> {
  const filas = leerCsv(csv)
  if (opciones.dryRun) return (await planificar(db, filas, opciones)).informe
  return withWriteLock(() => db.transaction(async (tx) => {
    const { informe, escribir } = await planificar(tx, filas, opciones)
    for (const e of escribir) {
      const before = await tx.select({ variant: recipeItems.variant, supplyId: recipeItems.supplyId, gramsClean: recipeItems.gramsClean })
        .from(recipeItems).where(eq(recipeItems.dishId, e.dishId))
      await tx.delete(recipeItems).where(eq(recipeItems.dishId, e.dishId))
      await tx.insert(recipeItems).values(e.items.map(i => ({ dishId: e.dishId, variant: i.variant, supplyId: i.supplyId, gramsClean: i.gramsClean })))
      // La misma entrada que PUT /api/recipes/:dishId; sin usuario porque la hace el script
      await audit(tx, { userId: null, action: 'recipe.update', entity: 'dish', entityId: e.dishId, data: { name: e.plato, before, after: e.items, source: 'db:recetas' } })
    }
    return informe
  }))
}
