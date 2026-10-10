import { describe, it, expect } from 'vitest'
import { createTestDb, seedBasicData } from './helpers/db'
import { getFullOrder } from '../services/order.serializer'
import { orders, orderItems, tables } from '../db/schema'

describe('getFullOrder', () => {
  it('incluye tableNumber (número visible), distinto del id técnico', async () => {
    const db = await createTestDb()
    const { user } = await seedBasicData(db)
    // Mesa recreada: el id avanza (16) pero el número visible es 15 (caso TD-06)
    const [mesa] = await db.insert(tables).values({ id: 16, number: 15 }).returning()
    const [order] = await db.insert(orders).values({ tableId: mesa.id, type: 'dine_in', createdBy: user.id }).returning()
    await db.insert(orderItems).values({
      orderId: order.id, dishName: 'Ceviche', unitPrice: 28, quantity: 1,
      modifiers: JSON.stringify([{ groupId: 1, groupName: 'Nivel de Picante', optionName: 'Normal' }]),
    })

    const full = await getFullOrder(db, order.id)
    expect(full?.tableId).toBe(16)
    expect(full?.tableNumber).toBe(15)
    expect(full?.items[0].modifiers[0].optionName).toBe('Normal')
    expect(full?.createdAt).toMatch(/Z$/)
  })

  it('delivery: tableNumber null', async () => {
    const db = await createTestDb()
    const { user } = await seedBasicData(db)
    const [order] = await db.insert(orders).values({ type: 'delivery', customerName: 'Ana', createdBy: user.id }).returning()
    const full = await getFullOrder(db, order.id)
    expect(full?.tableNumber).toBeNull()
  })

  it('pedido inexistente → null', async () => {
    const db = await createTestDb()
    expect(await getFullOrder(db, 999)).toBeNull()
  })
})
