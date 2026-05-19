import { Router } from 'express'
import { eq, and, isNull, inArray, gte, lte, desc, sql } from 'drizzle-orm'
import { db } from '../db'
import { bills, orders, orderItems, tables, billGroups, users } from '../db/schema'
import { requireAuth } from '../middleware/auth'
import { validateBody } from '../middleware/validate'
import { CreateBillSchema } from '../schemas/bills'
import { io } from '../index'

const router = Router()

// C7: atómico. Antes hacía SELECT * y Math.max en JS, escalando linealmente
// con el historial y siendo no-atómico (dos llamadas concurrentes podían
// retornar el mismo lastNumber). Ahora una sola query SQL.
router.get('/next-number', requireAuth, async (_req, res) => {
  // El formato es "B001-NNNNN". Extraemos la parte después del primer '-'.
  // INSTR retorna 0 si no encuentra '-', en cuyo caso SUBSTR desde 1 toma
  // todo el string y CAST a integer da 0 si no es numérico. Seguro.
  const [row] = await db
    .select({
      max: sql<number | null>`MAX(CAST(SUBSTR(${bills.receiptNumber}, INSTR(${bills.receiptNumber}, '-')+1) AS INTEGER))`,
    })
    .from(bills)
  res.json({ lastNumber: row?.max ?? 0 })
})

// GET /api/bills — historial. waiter/cashier ven solo HOY; owner puede pasar from/to
router.get('/', requireAuth, async (req, res) => {
  const role = req.user!.role
  let from: string
  let to: string

  if (role === 'owner') {
    from = req.query.from ? parseDateParam(String(req.query.from), 'start') : todayStart()
    to   = req.query.to   ? parseDateParam(String(req.query.to),   'end')   : todayEnd()
  } else {
    // waiter / cashier solo ven el día actual
    from = todayStart()
    to   = todayEnd()
  }

  const rows = await db.select().from(bills)
    .where(and(gte(bills.paidAt, from), lte(bills.paidAt, to)))
    .orderBy(desc(bills.paidAt))

  // Enriquecer con info del pedido (mesa/customer) y cajero
  const orderIds = [...new Set(rows.map(b => b.orderId).filter((x): x is number => x !== null))]
  const userIds  = [...new Set(rows.map(b => b.createdBy).filter((x): x is number => x !== null))]
  const ords  = orderIds.length ? await db.select().from(orders).where(inArray(orders.id, orderIds)) : []
  const usrs  = userIds.length  ? await db.select().from(users).where(inArray(users.id, userIds))   : []
  const ordById = new Map(ords.map(o => [o.id, o]))
  const usrById = new Map(usrs.map(u => [u.id, u]))

  const enriched = rows.map(b => {
    const o = b.orderId !== null ? ordById.get(b.orderId) : undefined
    const u = b.createdBy !== null ? usrById.get(b.createdBy) : undefined
    return {
      ...b,
      orderType: o?.type ?? null,
      tableId: o?.tableId ?? null,
      customerName: o?.customerName ?? null,
      cashierName: u?.name ?? null,
    }
  })
  res.json({ from, to, role, bills: enriched })
})

// GET /api/bills/:id — detalle (items + datos pedido)
router.get('/:id', requireAuth, async (req, res) => {
  const id = Number(req.params.id)
  const [bill] = await db.select().from(bills).where(eq(bills.id, id))
  if (!bill) { res.status(404).json({ error: 'Boleta no encontrada' }); return }

  // waiter/cashier solo pueden ver boletas del día actual
  if (req.user!.role !== 'owner') {
    if (!bill.paidAt || bill.paidAt < todayStart() || bill.paidAt > todayEnd()) {
      res.status(403).json({ error: 'Sin permisos para boletas anteriores' })
      return
    }
  }

  const items = bill.id !== null
    ? await db.select().from(orderItems).where(eq(orderItems.billId, bill.id))
    : []

  let order: any = null
  if (bill.orderId !== null) {
    const [o] = await db.select().from(orders).where(eq(orders.id, bill.orderId))
    order = o ?? null
  }
  let cashier: any = null
  if (bill.createdBy !== null) {
    const [u] = await db.select().from(users).where(eq(users.id, bill.createdBy))
    cashier = u ? { id: u.id, name: u.name, username: u.username } : null
  }

  res.json({
    bill,
    order,
    cashier,
    items: items.map(i => ({ ...i, modifiers: JSON.parse(i.modifiers ?? '[]') })),
  })
})

// Helpers de fecha. La DB guarda paidAt en UTC ('YYYY-MM-DD HH:MM:SS').
// El "día" que ve el restaurante está en hora local (Lima/Tacna). Por eso para
// "hoy" tomamos local 00:00–23:59 y convertimos a UTC vía toISOString().
function todayStart(): string {
  const d = new Date(); d.setHours(0, 0, 0, 0)
  return d.toISOString().slice(0, 19).replace('T', ' ')
}
function todayEnd(): string {
  const d = new Date(); d.setHours(23, 59, 59, 999)
  return d.toISOString().slice(0, 19).replace('T', ' ')
}
function parseDateParam(s: string, kind: 'start' | 'end'): string {
  // Acepta 'YYYY-MM-DD' (interpretado como medianoche local) o ISO completo.
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(s)
  const d = dateOnly ? new Date(s + 'T00:00:00') : new Date(s)
  if (kind === 'start') d.setHours(0, 0, 0, 0)
  else                   d.setHours(23, 59, 59, 999)
  return d.toISOString().slice(0, 19).replace('T', ' ')
}

router.post('/', requireAuth, validateBody(CreateBillSchema), async (req, res) => {
  const { orderId, paymentMethod, cashReceived, receiptNumber, itemIds, billGroupId } = req.body

  const [order] = await db.select().from(orders).where(eq(orders.id, orderId))
  if (!order) { res.status(404).json({ error: 'Pedido no encontrado' }); return }

  // 3 modos:
  //  - billGroupId + itemIds: cobrar SOLO los items listados que pertenezcan a la sub-cuenta
  //    (el grupo se marca pagado únicamente si quedan sin facturar = 0 después)
  //  - billGroupId: cobrar todos los items abiertos de esa sub-cuenta
  //  - itemIds: cobrar items específicos
  //  - ninguno: cobrar todos los items aún no facturados (cobro completo simple)
  let targetItems
  let groupBeingPaid: typeof billGroups.$inferSelect | null = null

  if (billGroupId) {
    const [grp] = await db.select().from(billGroups)
      .where(and(eq(billGroups.id, billGroupId), eq(billGroups.orderId, orderId)))
    if (!grp) { res.status(404).json({ error: 'Sub-cuenta no encontrada' }); return }
    if (grp.status === 'paid') { res.status(409).json({ error: 'Esta sub-cuenta ya fue cobrada' }); return }
    groupBeingPaid = grp

    // Si el cliente envió itemIds, restringimos al snapshot que el cajero confirmó.
    // Esto evita cobrar items agregados por el mozo mientras se procesaba el pago.
    if (Array.isArray(itemIds) && itemIds.length > 0) {
      targetItems = await db.select().from(orderItems).where(and(
        eq(orderItems.orderId, orderId),
        eq(orderItems.billGroupId, grp.id),
        inArray(orderItems.id, itemIds),
        isNull(orderItems.billId),
      ))
    } else {
      targetItems = await db.select().from(orderItems).where(and(
        eq(orderItems.orderId, orderId),
        eq(orderItems.billGroupId, grp.id),
        isNull(orderItems.billId),
      ))
    }
  } else if (Array.isArray(itemIds) && itemIds.length > 0) {
    targetItems = await db.select().from(orderItems).where(and(
      eq(orderItems.orderId, orderId),
      inArray(orderItems.id, itemIds),
      isNull(orderItems.billId),
    ))
  } else {
    targetItems = await db.select().from(orderItems).where(and(
      eq(orderItems.orderId, orderId),
      isNull(orderItems.billId),
    ))
  }

  if (targetItems.length === 0) {
    res.status(400).json({ error: 'No hay items pendientes de cobro' })
    return
  }

  const total = targetItems.reduce((s, i) => s + (i.unitPrice * (i.quantity ?? 1)), 0)

  // Validación semántica que requiere conocer el total real (no se puede en el schema).
  if (paymentMethod === 'cash') {
    if (typeof cashReceived !== 'number' || cashReceived < total) {
      res.status(400).json({
        error: `Monto recibido insuficiente: S/ ${(cashReceived ?? 0).toFixed(2)} < S/ ${total.toFixed(2)}`,
      })
      return
    }
  }

  // C5 + C7: toda la mutación va dentro de una transacción atómica.
  // Esto evita que dos POST simultáneos sobre la misma orden facturen el
  // mismo item dos veces. Además, dentro del tx detectamos colisión del
  // receiptNumber para devolver un error claro en lugar del UNIQUE crash.
  let result: {
    bill: typeof bills.$inferSelect
    fullyPaid: boolean
  }
  try {
    result = await db.transaction(async (tx) => {
      // Pre-check de colisión de número (atómico dentro del tx).
      const [taken] = await tx.select({ id: bills.id }).from(bills)
        .where(eq(bills.receiptNumber, receiptNumber)).limit(1)
      if (taken) {
        throw Object.assign(new Error('RECEIPT_TAKEN'), { httpStatus: 409 })
      }

      const [bill] = await tx.insert(bills).values({
        orderId,
        subtotal: total,
        total,
        paymentMethod,
        // En este punto, el schema + la validación anterior garantizan que cuando
        // paymentMethod === 'cash', cashReceived es un número >= total.
        cashReceived: paymentMethod === 'cash' ? cashReceived! : null,
        changeAmount: paymentMethod === 'cash' ? (cashReceived! - total) : null,
        receiptNumber,
        createdBy: req.user!.id,
      }).returning()

      // Marcar items como pagados
      await tx.update(orderItems)
        .set({ billId: bill.id })
        .where(inArray(orderItems.id, targetItems.map(i => i.id)))

      // Si pagamos un grupo, marcarlo como pagado SÓLO si ya no le quedan items
      // sin facturar. Esto cubre el caso en el que se agregaron items al grupo
      // entre la confirmación y el cobro: el grupo sigue abierto para esos extras.
      if (groupBeingPaid) {
        const groupRemaining = await tx.select().from(orderItems).where(and(
          eq(orderItems.orderId, orderId),
          eq(orderItems.billGroupId, groupBeingPaid.id),
          isNull(orderItems.billId),
        ))
        if (groupRemaining.length === 0) {
          await tx.update(billGroups)
            .set({ status: 'paid', billId: bill.id })
            .where(eq(billGroups.id, groupBeingPaid.id))
        }
      }

      // ¿Quedan items sin facturar?
      const remaining = await tx.select().from(orderItems).where(and(
        eq(orderItems.orderId, orderId),
        isNull(orderItems.billId),
      ))
      const fullyPaid = remaining.length === 0

      if (fullyPaid) {
        await tx.update(orders)
          .set({ status: 'paid', updatedAt: new Date().toISOString() })
          .where(eq(orders.id, orderId))

        if (order.tableId) {
          await tx.update(tables).set({ status: 'free' }).where(eq(tables.id, order.tableId))
        }
      }

      return { bill, fullyPaid }
    })
  } catch (error: any) {
    if (error?.message === 'RECEIPT_TAKEN' || error?.httpStatus === 409) {
      res.status(409).json({
        error: 'El número de boleta ya está en uso. Reintentá — el sistema generará uno nuevo.',
        code: 'RECEIPT_TAKEN',
      })
      return
    }
    // A2: ya no exponer error.message al cliente; loguear server-side.
    console.error('[bills POST] Error en transacción:', error)
    res.status(500).json({ error: 'Error interno al crear boleta' })
    return
  }

  // ── Post-commit: emisión de eventos socket ─────────────────────────────
  // Los emits suceden DESPUÉS de que la transacción está commiteada para que
  // los clientes no reciban estado intermedio inválido.
  if (result.fullyPaid) {
    io.emit('order:removed', orderId)
  } else {
    const updatedItems = await db.select().from(orderItems).where(eq(orderItems.orderId, orderId))
    const updatedGroups = await db.select().from(billGroups).where(eq(billGroups.orderId, orderId))
    io.emit('order:updated', {
      ...order,
      createdAt: order.createdAt ? new Date(order.createdAt + 'Z').toISOString() : new Date().toISOString(),
      items: updatedItems.map(i => ({ ...i, modifiers: JSON.parse(i.modifiers ?? '[]') })),
      billGroups: updatedGroups,
    })
  }

  res.status(201).json({ ...result.bill, fullyPaid: result.fullyPaid })
})

export default router
