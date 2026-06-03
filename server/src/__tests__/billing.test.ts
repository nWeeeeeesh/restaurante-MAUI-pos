import { describe, it, expect, beforeEach } from 'vitest'
import { eq } from 'drizzle-orm'
import { createTestDb, seedBasicData, type TestDb } from './helpers/db'
import { createBill, BillingError } from '../services/billing.service'
import { orders, orderItems, tables, bills } from '../db/schema'

// ── Helpers de fixture ────────────────────────────────────────────────────────

async function insertOrder(db: TestDb, tableId: number, createdBy: number) {
  const [order] = await db.insert(orders).values({
    tableId,
    type: 'dine_in',
    status: 'pending',
    createdBy,
  }).returning()
  return order
}

async function insertItem(
  db: TestDb,
  orderId: number,
  opts: { dishName?: string; unitPrice?: number; quantity?: number } = {},
) {
  const [item] = await db.insert(orderItems).values({
    orderId,
    dishId: null,
    dishName: opts.dishName ?? 'Ceviche',
    unitPrice: opts.unitPrice ?? 28,
    quantity: opts.quantity ?? 1,
    modifiers: '[]',
  }).returning()
  return item
}

// ── Suite principal ───────────────────────────────────────────────────────────

describe('billing.service — createBill', () => {
  let db: TestDb
  let userId: number
  let tableId: number

  beforeEach(async () => {
    db = await createTestDb()
    const seed = await seedBasicData(db)
    userId = seed.user.id
    tableId = seed.table.id
  })

  // ── Cobro simple ─────────────────────────────────────────────────────────

  it('cobra todos los items en efectivo y cierra la orden', async () => {
    const order = await insertOrder(db, tableId, userId)
    await insertItem(db, order.id, { unitPrice: 28, quantity: 2 }) // S/56

    const result = await createBill(db, {
      orderId: order.id,
      paymentMethod: 'cash',
      cashReceived: 60,
      createdBy: userId,
    })

    expect(result.bill.total).toBe(56)
    expect(result.bill.cashReceived).toBe(60)
    expect(result.bill.changeAmount).toBe(4)
    expect(result.bill.paymentMethod).toBe('cash')
    expect(result.bill.receiptNumber).toBe('B001-00001')
    expect(result.fullyPaid).toBe(true)

    // La orden queda marcada como pagada
    const [updatedOrder] = await db.select().from(orders).where(eq(orders.id, order.id))
    expect(updatedOrder.status).toBe('paid')

    // La mesa queda libre
    const [updatedTable] = await db.select().from(tables).where(eq(tables.id, tableId))
    expect(updatedTable.status).toBe('free')
  })

  it('cobra con yape — sin cashReceived ni changeAmount', async () => {
    const order = await insertOrder(db, tableId, userId)
    await insertItem(db, order.id, { unitPrice: 35 })

    const result = await createBill(db, {
      orderId: order.id,
      paymentMethod: 'yape',
      createdBy: userId,
    })

    expect(result.bill.total).toBe(35)
    expect(result.bill.cashReceived).toBeNull()
    expect(result.bill.changeAmount).toBeNull()
    expect(result.fullyPaid).toBe(true)
  })

  // ── Cobro parcial ─────────────────────────────────────────────────────────

  it('cobra solo algunos items — orden sigue abierta', async () => {
    const order = await insertOrder(db, tableId, userId)
    const item1 = await insertItem(db, order.id, { unitPrice: 28 })
    await insertItem(db, order.id, { unitPrice: 35 })

    const result = await createBill(db, {
      orderId: order.id,
      paymentMethod: 'yape',
      itemIds: [item1.id],
      createdBy: userId,
    })

    expect(result.bill.total).toBe(28)
    expect(result.fullyPaid).toBe(false)

    // El item1 queda vinculado a la boleta; item2 sigue libre
    const items = await db.select().from(orderItems).where(eq(orderItems.orderId, order.id))
    const paid   = items.filter(i => i.billId === result.bill.id)
    const unpaid = items.filter(i => i.billId === null)
    expect(paid.length).toBe(1)
    expect(unpaid.length).toBe(1)
  })

  it('cobra el resto tras un cobro parcial — cierra la orden', async () => {
    const order = await insertOrder(db, tableId, userId)
    const item1 = await insertItem(db, order.id, { unitPrice: 28 })
    const item2 = await insertItem(db, order.id, { unitPrice: 35 })

    await createBill(db, { orderId: order.id, paymentMethod: 'yape', itemIds: [item1.id], createdBy: userId })

    const result2 = await createBill(db, {
      orderId: order.id,
      paymentMethod: 'cash',
      cashReceived: 40,
      itemIds: [item2.id],
      createdBy: userId,
    })

    expect(result2.bill.total).toBe(35)
    expect(result2.fullyPaid).toBe(true)
    expect(result2.bill.receiptNumber).toBe('B001-00002')

    const [updatedOrder] = await db.select().from(orders).where(eq(orders.id, order.id))
    expect(updatedOrder.status).toBe('paid')
  })

  // ── Numeración incremental ────────────────────────────────────────────────

  it('genera números de boleta correlativos en órdenes separadas', async () => {
    const order1 = await insertOrder(db, tableId, userId)
    await insertItem(db, order1.id, { unitPrice: 28 })
    const r1 = await createBill(db, { orderId: order1.id, paymentMethod: 'yape', createdBy: userId })

    // Segunda orden en una mesa distinta (la primera quedó libre)
    const [table2] = await db.insert(tables).values({ number: 2, status: 'occupied' }).returning()
    const order2 = await insertOrder(db, table2.id, userId)
    await insertItem(db, order2.id, { unitPrice: 35 })
    const r2 = await createBill(db, { orderId: order2.id, paymentMethod: 'yape', createdBy: userId })

    expect(r1.bill.receiptNumber).toBe('B001-00001')
    expect(r2.bill.receiptNumber).toBe('B001-00002')
  })

  // ── Split / sub-cuentas ──────────────────────────────────────────────────

  it('cobra un billGroup y lo marca como paid', async () => {
    const order = await insertOrder(db, tableId, userId)
    const item1 = await insertItem(db, order.id, { unitPrice: 28 })
    const item2 = await insertItem(db, order.id, { unitPrice: 35 })

    // Crear dos sub-cuentas manualmente
    const { billGroups } = await import('../db/schema')
    const [grp1] = await db.insert(billGroups).values({ orderId: order.id, label: 'Mesa A', status: 'open' }).returning()
    const [grp2] = await db.insert(billGroups).values({ orderId: order.id, label: 'Mesa B', status: 'open' }).returning()

    await db.update(orderItems).set({ billGroupId: grp1.id }).where(eq(orderItems.id, item1.id))
    await db.update(orderItems).set({ billGroupId: grp2.id }).where(eq(orderItems.id, item2.id))

    const result = await createBill(db, {
      orderId: order.id,
      paymentMethod: 'yape',
      billGroupId: grp1.id,
      createdBy: userId,
    })

    expect(result.bill.total).toBe(28)
    expect(result.fullyPaid).toBe(false)

    const [updatedGrp] = await db.select().from(billGroups).where(eq(billGroups.id, grp1.id))
    expect(updatedGrp.status).toBe('paid')
  })

  // ── Errores esperados ────────────────────────────────────────────────────

  it('lanza BillingError 404 si la orden no existe', async () => {
    await expect(
      createBill(db, { orderId: 9999, paymentMethod: 'yape', createdBy: userId }),
    ).rejects.toMatchObject({ statusCode: 404, message: 'Pedido no encontrado' })
  })

  it('lanza BillingError 400 si no hay items pendientes', async () => {
    const order = await insertOrder(db, tableId, userId)
    // Sin items

    await expect(
      createBill(db, { orderId: order.id, paymentMethod: 'yape', createdBy: userId }),
    ).rejects.toMatchObject({ statusCode: 400, message: 'No hay items pendientes de cobro' })
  })

  it('lanza BillingError 400 si el efectivo es insuficiente', async () => {
    const order = await insertOrder(db, tableId, userId)
    await insertItem(db, order.id, { unitPrice: 50 })

    await expect(
      createBill(db, { orderId: order.id, paymentMethod: 'cash', cashReceived: 30, createdBy: userId }),
    ).rejects.toMatchObject({ statusCode: 400 })
  })

  it('lanza BillingError 409 si el billGroup ya fue cobrado', async () => {
    const order = await insertOrder(db, tableId, userId)
    const item = await insertItem(db, order.id, { unitPrice: 28 })

    const { billGroups } = await import('../db/schema')
    const [grp] = await db.insert(billGroups).values({ orderId: order.id, label: 'A', status: 'paid' }).returning()
    await db.update(orderItems).set({ billGroupId: grp.id }).where(eq(orderItems.id, item.id))

    await expect(
      createBill(db, { orderId: order.id, paymentMethod: 'yape', billGroupId: grp.id, createdBy: userId }),
    ).rejects.toMatchObject({ statusCode: 409 })
  })

  it('BillingError es instancia de Error', () => {
    const err = new BillingError('test', 400)
    expect(err).toBeInstanceOf(Error)
    expect(err).toBeInstanceOf(BillingError)
    expect(err.statusCode).toBe(400)
  })
})
