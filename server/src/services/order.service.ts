import { inArray } from 'drizzle-orm'
import { categories, dishes, modifierGroups, modifierOptions } from '../db/schema'
import type { Executor } from '../db'
import { DomainError } from '../errors'
import { roundMoney } from '../utils/math'

export interface OrderItemRequest {
  dishId: number
  quantity: number
  modifiers?: Array<{ groupId: number; optionId?: number | null; freeText?: string | null }>
  notes?: string | null
}

export interface ResolvedItem {
  dishId: number
  dishName: string
  unitPrice: number
  quantity: number
  modifiers: string
  notes: string | null
}

interface StoredModifier {
  groupId: number
  groupName: string
  optionId?: number
  optionName?: string
  freeText?: string
}

// El precio y el nombre de cada ítem salen del catálogo, nunca del cliente (TD-01).
// El cliente solo indica qué plato, cuántos y qué opciones; aquí se valida que el
// plato esté disponible y que las opciones pertenezcan a ese plato, y se calcula
// unitPrice = precio del plato + ajustes de las opciones elegidas.
export async function resolveItems(db: Executor, items: OrderItemRequest[]): Promise<ResolvedItem[]> {
  const dishIds = [...new Set(items.map(i => i.dishId))]
  const dishRows = await db.select().from(dishes).where(inArray(dishes.id, dishIds))
  const catIds = [...new Set(dishRows.map(d => d.categoryId).filter((x): x is number => x !== null))]
  const catRows = catIds.length ? await db.select().from(categories).where(inArray(categories.id, catIds)) : []
  const groupRows = await db.select().from(modifierGroups).where(inArray(modifierGroups.dishId, dishIds))
  const groupIds = groupRows.map(g => g.id)
  const optionRows = groupIds.length
    ? await db.select().from(modifierOptions).where(inArray(modifierOptions.groupId, groupIds))
    : []

  const dishById = new Map(dishRows.map(d => [d.id, d]))
  const inactiveCats = new Set(catRows.filter(c => c.active === false).map(c => c.id))
  const groupById = new Map(groupRows.map(g => [g.id, g]))
  const optionById = new Map(optionRows.map(o => [o.id, o]))

  // Un plato agotado o de una categoría inactiva no se puede vender (D3: se rechaza
  // el envío completo y se informa cuáles, para que el POS los quite del borrador).
  const unavailable = dishIds
    .map(id => ({ id, dish: dishById.get(id) }))
    .filter(({ dish }) => !dish || dish.available === false || (dish.categoryId !== null && inactiveCats.has(dish.categoryId)))
    .map(({ id, dish }) => ({ dishId: id, name: dish?.name ?? `Plato #${id}` }))
  if (unavailable.length > 0) {
    throw new DomainError(
      `No disponible: ${unavailable.map(d => d.name).join(', ')}`,
      409,
      'DISH_UNAVAILABLE',
      { dishes: unavailable },
    )
  }

  return items.map(item => {
    const dish = dishById.get(item.dishId)!
    const stored: StoredModifier[] = []
    const optionsPerGroup = new Map<number, number>()
    let adjustment = 0

    for (const mod of item.modifiers ?? []) {
      const group = groupById.get(mod.groupId)
      if (!group || group.dishId !== dish.id) {
        throw new DomainError(`Modificador inválido para ${dish.name}`, 400, 'INVALID_MODIFIER')
      }
      const entry: StoredModifier = { groupId: group.id, groupName: group.name }
      if (mod.optionId != null) {
        const option = optionById.get(mod.optionId)
        if (!option || option.groupId !== group.id) {
          throw new DomainError(`Opción inválida en "${group.name}" para ${dish.name}`, 400, 'INVALID_MODIFIER')
        }
        entry.optionId = option.id
        entry.optionName = option.name
        adjustment += option.priceAdjustment ?? 0
        optionsPerGroup.set(group.id, (optionsPerGroup.get(group.id) ?? 0) + 1)
      }
      const text = mod.freeText?.trim()
      if (text) entry.freeText = text
      if (entry.optionId !== undefined || entry.freeText !== undefined) stored.push(entry)
    }

    for (const group of groupRows.filter(g => g.dishId === dish.id)) {
      const chosen = optionsPerGroup.get(group.id) ?? 0
      if (group.multiple === false && chosen > 1) {
        throw new DomainError(`Solo se permite una opción en "${group.name}" para ${dish.name}`, 400, 'INVALID_MODIFIER')
      }
      // Un grupo obligatorio sin opciones configuradas no debe bloquear la venta.
      const hasOptions = optionRows.some(o => o.groupId === group.id)
      if (group.required && hasOptions && chosen === 0) {
        throw new DomainError(`Falta elegir "${group.name}" para ${dish.name}`, 400, 'MODIFIER_REQUIRED')
      }
    }

    return {
      dishId: dish.id,
      dishName: dish.name,
      unitPrice: roundMoney(dish.price + adjustment),
      quantity: item.quantity,
      modifiers: JSON.stringify(stored),
      notes: item.notes?.trim() || null,
    }
  })
}
