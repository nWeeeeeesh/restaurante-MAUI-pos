import { describe, it, expect, beforeAll } from 'vitest'
import request from 'supertest'
import { eq } from 'drizzle-orm'
import { setupHttpApp } from './helpers/http'

// T12: matriz de permisos del plan v1.1 (§2). La UI oculta botones, pero la
// barrera real es el servidor: aquí se prueba cada celda relevante.
type Role = 'owner' | 'manager' | 'cashier' | 'waiter'
const ROLES: Role[] = ['owner', 'manager', 'cashier', 'waiter']

let ctx: Awaited<ReturnType<typeof setupHttpApp>>
const auth = {} as Record<Role, string>
let dishId: number
let tableId: number

beforeAll(async () => {
  ctx = await setupHttpApp()
  for (const r of ROLES) auth[r] = (await ctx.as(r)).auth
  const [cat] = await ctx.db.insert(ctx.schema.categories).values({ name: 'Platos' }).returning()
  const [dish] = await ctx.db.insert(ctx.schema.dishes).values({ categoryId: cat.id, name: 'Ceviche', price: 28, hasSpiceLevel: false }).returning()
  const [table] = await ctx.db.insert(ctx.schema.tables).values({ number: 1 }).returning()
  dishId = dish.id
  tableId = table.id
})

// Para cada rol: true = permitido (no 403), false = 403
async function expectMatrix(
  allowed: Record<Role, boolean>,
  call: (auth: string, role: Role) => Promise<request.Response>,
) {
  for (const role of ROLES) {
    const res = await call(auth[role], role)
    if (allowed[role]) expect(res.status, `${role} debería poder (status ${res.status})`).not.toBe(403)
    else expect(res.status, `${role} NO debería poder`).toBe(403)
  }
}

const only = (...roles: Role[]) =>
  Object.fromEntries(ROLES.map(r => [r, roles.includes(r)])) as Record<Role, boolean>

describe('matriz de permisos', () => {
  it('cobrar: cajero, encargado y dueño', () =>
    expectMatrix(only('owner', 'manager', 'cashier'), a =>
      request(ctx.app).post('/api/bills').set('Authorization', a).send({ orderId: 99999, paymentMethod: 'yape' })))

  it('cancelar pedidos: cajero, encargado y dueño (el detalle con cobros está en orders.lifecycle)', () =>
    expectMatrix(only('owner', 'manager', 'cashier'), a =>
      request(ctx.app).post('/api/orders/99999/cancel').set('Authorization', a).send({ reason: 'prueba' })))

  it('reimprimir boleta y pre-cuenta: cajero, encargado y dueño', async () => {
    await expectMatrix(only('owner', 'manager', 'cashier'), a =>
      request(ctx.app).post('/api/print/reprint/99999').set('Authorization', a))
    await expectMatrix(only('owner', 'manager', 'cashier'), a =>
      request(ctx.app).post('/api/print/pre-receipt/99999').set('Authorization', a))
  })

  it('reportes: encargado y dueño', () =>
    expectMatrix(only('owner', 'manager'), a =>
      request(ctx.app).get('/api/reports/summary?period=today').set('Authorization', a)))

  it('registrar gastos: encargado y dueño (el cajero ya no)', () =>
    expectMatrix(only('owner', 'manager'), a =>
      request(ctx.app).post('/api/reports/expenses').set('Authorization', a).send({ description: 'Limones', amount: 45 })))

  it('marcar plato agotado: encargado y dueño', () =>
    expectMatrix(only('owner', 'manager'), a =>
      request(ctx.app).patch(`/api/menu/dishes/${dishId}/availability`).set('Authorization', a).send({ available: true })))

  it('cambiar precios, administrar mesas y usuarios: solo el dueño', async () => {
    await expectMatrix(only('owner'), a =>
      request(ctx.app).patch(`/api/menu/dishes/${dishId}`).set('Authorization', a).send({ price: 28 }))
    await expectMatrix(only('owner'), a =>
      request(ctx.app).patch(`/api/tables/${tableId}`).set('Authorization', a).send({ capacity: 4 }))
    await expectMatrix(only('owner'), a =>
      request(ctx.app).get('/api/users').set('Authorization', a))
  })

  it('inventario: compras, merma, conteos, listados y export para encargado y dueño', async () => {
    const managers = only('owner', 'manager')
    await expectMatrix(managers, a => request(ctx.app).get('/api/inventory/purchases').set('Authorization', a))
    await expectMatrix(managers, a => request(ctx.app).post('/api/inventory/purchases').set('Authorization', a).send({ supplyId: 99999, quantity: 1, totalCost: 1 }))
    await expectMatrix(managers, a => request(ctx.app).patch('/api/inventory/purchases/99999').set('Authorization', a).send({ quantity: 1, reason: 'prueba' }))
    await expectMatrix(managers, a => request(ctx.app).delete('/api/inventory/purchases/99999').set('Authorization', a).send({ reason: 'prueba' }))
    await expectMatrix(managers, a => request(ctx.app).get('/api/inventory/waste').set('Authorization', a))
    await expectMatrix(managers, a => request(ctx.app).post('/api/inventory/waste').set('Authorization', a).send({ supplyId: 99999, quantity: 1, reason: 'otro' }))
    await expectMatrix(managers, a => request(ctx.app).patch('/api/inventory/waste/99999').set('Authorization', a).send({ quantity: 1, correctionReason: 'prueba' }))
    await expectMatrix(managers, a => request(ctx.app).delete('/api/inventory/waste/99999').set('Authorization', a).send({ reason: 'prueba' }))
    await expectMatrix(managers, a => request(ctx.app).get('/api/inventory/counts').set('Authorization', a))
    await expectMatrix(managers, a => request(ctx.app).put('/api/inventory/counts/2026-01-01').set('Authorization', a).send({ items: [{ supplyId: 99999, quantity: 1 }] }))
    await expectMatrix(managers, a => request(ctx.app).get('/api/inventory/lost-sales').set('Authorization', a))
    await expectMatrix(managers, a => request(ctx.app).get('/api/inventory/export?table=supplies').set('Authorization', a))
  })

  it('inventario: catálogo de insumos solo el dueño; verlo y registrar "No había", todos', async () => {
    await expectMatrix(only('owner'), a => request(ctx.app).post('/api/inventory/supplies').set('Authorization', a).send({ name: '', unit: 'kg' }))
    await expectMatrix(only('owner'), a => request(ctx.app).patch('/api/inventory/supplies/99999').set('Authorization', a).send({ critical: true }))
    await expectMatrix(only(...ROLES), a => request(ctx.app).get('/api/inventory/supplies').set('Authorization', a))
    await expectMatrix(only(...ROLES), a => request(ctx.app).post('/api/inventory/lost-sales').set('Authorization', a).send({ dishId }))
  })

  it('historial: encargado y dueño eligen el rango; cajero y mozo solo ven hoy', async () => {
    for (const role of ROLES) {
      const res = await request(ctx.app).get('/api/bills?from=2020-01-01&to=2020-01-31').set('Authorization', auth[role])
      expect(res.status).toBe(200)
      const fullRange = role === 'owner' || role === 'manager'
      expect(String(res.body.from).startsWith('2020-01'), role).toBe(fullRange)
    }
  })
})

describe('gastos: corrección y borrado auditados (D6)', () => {
  it('corregir exige motivo y deja el valor anterior en audit_log', async () => {
    const created = await request(ctx.app).post('/api/reports/expenses').set('Authorization', auth.manager)
      .send({ description: 'Limones', amount: 54 })
    const id = created.body.id

    const sinMotivo = await request(ctx.app).patch(`/api/reports/expenses/${id}`).set('Authorization', auth.manager).send({ amount: 45 })
    expect(sinMotivo.status).toBe(400)

    const ok = await request(ctx.app).patch(`/api/reports/expenses/${id}`).set('Authorization', auth.manager)
      .send({ amount: 45, reason: 'error de digitación' })
    expect(ok.status).toBe(200)
    expect(ok.body.amount).toBe(45)

    const [log] = await ctx.db.select().from(ctx.schema.auditLog).where(eq(ctx.schema.auditLog.action, 'expense.update'))
    expect(JSON.parse(log.data!)).toMatchObject({ reason: 'error de digitación', before: { amount: 54 }, after: { amount: 45 } })
  })

  it('borrar exige motivo y conserva el gasto completo en audit_log', async () => {
    const created = await request(ctx.app).post('/api/reports/expenses').set('Authorization', auth.owner)
      .send({ description: 'Gas', amount: 80 })
    const id = created.body.id
    expect((await request(ctx.app).delete(`/api/reports/expenses/${id}`).set('Authorization', auth.cashier).send({ reason: 'x'.repeat(5) })).status).toBe(403)
    const res = await request(ctx.app).delete(`/api/reports/expenses/${id}`).set('Authorization', auth.owner).send({ reason: 'duplicado' })
    expect(res.status).toBe(200)
    const [log] = await ctx.db.select().from(ctx.schema.auditLog).where(eq(ctx.schema.auditLog.action, 'expense.delete'))
    expect(JSON.parse(log.data!)).toMatchObject({ reason: 'duplicado', before: { description: 'Gas', amount: 80 } })
  })
})
