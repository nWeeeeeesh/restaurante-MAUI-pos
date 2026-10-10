import { describe, it, expect } from 'vitest'
import { eq } from 'drizzle-orm'
import { createTestDb, seedBasicData } from './helpers/db'
import { createBill } from '../services/billing.service'
import { salesSummary } from '../services/report.service'
import { orders, orderItems, bills } from '../db/schema'
import { sqliteLocalOffset } from '../utils/dates'

const LIMA = 300 // getTimezoneOffset() en Lima (UTC-5)

describe('salesSummary', () => {
  it('V3: top platos cuenta cada ítem una vez aunque el pedido tenga varias boletas (TD-09)', async () => {
    const db = await createTestDb()
    const { user, table } = await seedBasicData(db)
    const [order] = await db.insert(orders).values({ tableId: table.id, type: 'dine_in', createdBy: user.id }).returning()
    const [a] = await db.insert(orderItems).values({ orderId: order.id, dishName: 'Ceviche', unitPrice: 28, quantity: 1 }).returning()
    const [b] = await db.insert(orderItems).values({ orderId: order.id, dishName: 'Chicha', unitPrice: 8, quantity: 1 }).returning()
    // Un tercer ítem aún sin cobrar no debe aparecer
    await db.insert(orderItems).values({ orderId: order.id, dishName: 'Choclo', unitPrice: 4, quantity: 1 })
    await createBill(db, { orderId: order.id, paymentMethod: 'yape', itemIds: [a.id], createdBy: user.id })
    await createBill(db, { orderId: order.id, paymentMethod: 'cash', cashReceived: 10, itemIds: [b.id], createdBy: user.id })

    const s = await salesSummary(db, '2000-01-01 00:00:00', LIMA)
    expect(s.totalSales).toBe(36)
    expect(s.billCount).toBe(2)
    expect(s.byMethod).toEqual({ cash: 8, yape: 28, plin: 0 })
    const byName = Object.fromEntries(s.topDishes.map(d => [d.dishName, d]))
    expect(byName['Ceviche']).toMatchObject({ totalQty: 1, totalRevenue: 28 })
    expect(byName['Chicha']).toMatchObject({ totalQty: 1, totalRevenue: 8 })
    expect(byName['Choclo']).toBeUndefined()
  })

  it('V4: una venta a las 20:00 de Lima cuenta en su día local, no en el día UTC (TD-10)', async () => {
    const db = await createTestDb()
    const { user, table } = await seedBasicData(db)
    const [order] = await db.insert(orders).values({ tableId: table.id, type: 'dine_in', createdBy: user.id }).returning()
    await db.insert(orderItems).values({ orderId: order.id, dishName: 'Ceviche', unitPrice: 28, quantity: 1 })
    const { bill } = await createBill(db, { orderId: order.id, paymentMethod: 'yape', createdBy: user.id })
    // 05/06 20:00 en Lima = 06/06 01:00 UTC
    await db.update(bills).set({ paidAt: '2026-06-06 01:00:00' }).where(eq(bills.id, bill.id))

    const s = await salesSummary(db, '2000-01-01 00:00:00', LIMA)
    expect(s.daily).toEqual([{ date: '2026-06-05', total: 28, count: 1 }])
  })

  it('sqliteLocalOffset convierte el offset de JS al modificador de SQLite', () => {
    expect(sqliteLocalOffset(300)).toBe('-300 minutes')
    expect(sqliteLocalOffset(-60)).toBe('60 minutes')
  })
})
