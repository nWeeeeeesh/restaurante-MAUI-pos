// Recetas y tipos de gasto (incremento 2, plan-sistema T10). Escrituras con candado y
// auditoría en la misma transacción.
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm'
import { db as defaultDb, type DB, type Executor } from '../db'
import { categories, dishes, expenseCategories, expenses, recipeCalibrations, recipeItems, supplies } from '../db/schema'
import { withWriteLock } from '../db/write-lock'
import { DomainError } from '../errors'
import { audit } from './audit'
import { fueraDeRango, kgPorPorcion, RANGO_FACTOR } from '../domain/costing'
import type { RecipeInput } from '../schemas/recipes'
import type { ExpenseKindInput } from '../schemas/profitability'

const criticalSupplies = (ex: Executor) => ex.select({
  id: supplies.id, code: supplies.code, name: supplies.name, unit: supplies.unit, yield: supplies.yield,
  shelfLifeDays: supplies.shelfLifeDays, serviceLevel: supplies.serviceLevel,
}).from(supplies).where(and(eq(supplies.critical, true), eq(supplies.active, true))).orderBy(asc(supplies.sortOrder), asc(supplies.id))

// Carta con su receta, los insumos críticos y el factor vigente de cada uno
export async function listRecipes(ex: Executor = defaultDb, localId: number) {
  const crit = await criticalSupplies(ex)
  const yieldOf = new Map(crit.map(s => [s.id, s.yield]))
  const dishRows = await ex.select({ id: dishes.id, name: dishes.name, price: dishes.price, category: categories.name, categoryId: dishes.categoryId })
    .from(dishes).leftJoin(categories, eq(dishes.categoryId, categories.id))
    .where(eq(dishes.archived, false))
    .orderBy(asc(categories.displayOrder), asc(dishes.categoryId), asc(dishes.id))
  const rows = await ex.select().from(recipeItems).orderBy(asc(recipeItems.dishId), asc(recipeItems.variant), asc(recipeItems.supplyId))
  const calibrations = await ex.select().from(recipeCalibrations)
    .where(eq(recipeCalibrations.localId, localId)).orderBy(desc(recipeCalibrations.id))
  const factors = new Map<number, typeof calibrations[number]>()
  for (const c of calibrations) if (!factors.has(c.supplyId)) factors.set(c.supplyId, c)

  return {
    supplies: crit.map(s => {
      const f = factors.get(s.id)
      return {
        ...s,
        factor: f ? { value: f.factor, from: f.fromDate, to: f.toDate, computedAt: f.computedAt, outOfRange: fueraDeRango(f.factor) } : null,
      }
    }),
    factorRange: RANGO_FACTOR,
    dishes: dishRows.map(d => ({
      dishId: d.id, name: d.name, price: d.price, category: d.category,
      items: rows.filter(r => r.dishId === d.id).map(r => {
        const y = yieldOf.get(r.supplyId)
        return {
          variant: r.variant, supplyId: r.supplyId, gramsClean: r.gramsClean,
          // En la unidad de compra (kg del producto entero), como se descuenta del stock
          kgPerPortion: y === undefined ? null : kgPorPorcion(r.gramsClean, y),
        }
      }),
    })),
  }
}

// Reemplaza la receta completa del plato
export function replaceRecipe(db: DB = defaultDb, dishId: number, items: RecipeInput, userId: number) {
  return withWriteLock(() => db.transaction(async (tx) => {
    const [dish] = await tx.select({ id: dishes.id, name: dishes.name }).from(dishes).where(eq(dishes.id, dishId))
    if (!dish) throw new DomainError('Plato no encontrado', 404, 'DISH_NOT_FOUND')
    const ids = [...new Set(items.map(i => i.supplyId))]
    if (ids.length > 0) {
      const found = await tx.select({ id: supplies.id, critical: supplies.critical }).from(supplies).where(inArray(supplies.id, ids))
      const critical = new Set(found.filter(s => s.critical).map(s => s.id))
      const bad = ids.filter(id => !critical.has(id))
      if (bad.length > 0) {
        throw new DomainError('La receta solo lleva insumos críticos; los demás van en «otros insumos»', 400, 'SUPPLY_NOT_CRITICAL', { supplyIds: bad })
      }
    }
    const before = await tx.select({ variant: recipeItems.variant, supplyId: recipeItems.supplyId, gramsClean: recipeItems.gramsClean })
      .from(recipeItems).where(eq(recipeItems.dishId, dishId))
    await tx.delete(recipeItems).where(eq(recipeItems.dishId, dishId))
    if (items.length > 0) {
      await tx.insert(recipeItems).values(items.map(i => ({
        dishId, variant: i.variant, supplyId: i.supplyId, gramsClean: i.gramsClean, updatedBy: userId,
      })))
    }
    await audit(tx, { userId, action: 'recipe.update', entity: 'dish', entityId: dishId, data: { name: dish.name, before, after: items } })
    return tx.select().from(recipeItems).where(eq(recipeItems.dishId, dishId))
      .orderBy(asc(recipeItems.variant), asc(recipeItems.supplyId))
  }))
}

// Categorías de gasto con su tipo; las que solo aparecen en los gastos cuentan como fijas
export async function listExpenseCategories(ex: Executor = defaultDb) {
  const kinds = await ex.select().from(expenseCategories)
  const used = await ex.select({ category: expenses.category, n: sql<number>`count(*)` })
    .from(expenses).groupBy(expenses.category)
  const out = new Map<string, { category: string; kind: 'fijo' | 'variable'; classified: boolean; expenses: number }>()
  for (const k of kinds) out.set(k.category, { category: k.category, kind: k.kind, classified: true, expenses: 0 })
  for (const u of used) {
    const category = u.category ?? 'general'
    const row = out.get(category) ?? { category, kind: 'fijo' as const, classified: false, expenses: 0 }
    row.expenses += Number(u.n)
    out.set(category, row)
  }
  return [...out.values()].sort((a, b) => a.category.localeCompare(b.category, 'es'))
}

export function setExpenseKind(db: DB = defaultDb, category: string, input: ExpenseKindInput, userId: number) {
  return withWriteLock(() => db.transaction(async (tx) => {
    const [before] = await tx.select().from(expenseCategories).where(eq(expenseCategories.category, category))
    await tx.insert(expenseCategories).values({ category, kind: input.kind, updatedBy: userId, updatedAt: sql`(datetime('now'))` })
      .onConflictDoUpdate({ target: expenseCategories.category, set: { kind: input.kind, updatedBy: userId, updatedAt: sql`(datetime('now'))` } })
    await audit(tx, { userId, action: 'expense_category.update', entity: 'expense_category', data: { category, before: before?.kind ?? null, after: input.kind } })
    const [after] = await tx.select().from(expenseCategories).where(eq(expenseCategories.category, category))
    return after
  }))
}
