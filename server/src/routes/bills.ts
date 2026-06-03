import { Router } from 'express'
import { eq, and, isNull, inArray, gte, lte, desc, sql } from 'drizzle-orm'
import { db } from '../db'
import { bills, orders, orderItems, tables, billGroups, users } from '../db/schema'
import { requireAuth, requireRole } from '../middleware/auth'
import { validateBody } from '../middleware/validate'
import { CreateBillSchema } from '../schemas/bills'
import { io } from '../index'
import { localDayStart, localDayEnd, parseDayBoundary } from '../utils/dates'

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
    from = req.query.from ? parseDayBoundary(String(req.query.from), 'start') : localDayStart()
    to   = req.query.to   ? parseDayBoundary(String(req.query.to),   'end')   : localDayEnd()
  } else {
    // waiter / cashier solo ven el día actual
    from = localDayStart()
    to   = localDayEnd()
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
    if (!bill.paidAt || bill.paidAt < localDayStart() || bill.paidAt > localDayEnd()) {
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

// P2: los rangos de fecha se centralizan en utils/dates
// (localDayStart / localDayEnd / parseDayBoundary) para que "hoy" sea idéntico
// en bills, reports y print.

router.post('/', requireAuth, requireRole('owner', 'cashier'), validateBody(CreateBillSchema), async (req, res) => {
  const { orderId, paymentMethod, cashReceived, itemIds, billGroupId } = req.body

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
  } | undefined

  // P1: el número de boleta se genera en el SERVIDOR, dentro de la transacción,
  // calculando MAX+1 de forma atómica. El cliente ya no lo manda (eliminamos la
  // clase de bug de números duplicados entre dispositivos con contadores locales).
  // El UNIQUE de receiptNumber + el reintento cubren la carrera teórica de dos
  // cobros que calculen el mismo MAX+1 (con SQLite, un único escritor, es muy raro).
  try {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        result = await db.transaction(async (tx) => {
          // C7: número siguiente atómico (MAX del sufijo numérico + 1).
          const [maxRow] = await tx
            .select({
              max: sql<number | null>`MAX(CAST(SUBSTR(${bills.receiptNumber}, INSTR(${bills.receiptNumber}, '-')+1) AS INTEGER))`,
            })
            .from(bills)
          const receiptNumber = `B001-${String((maxRow?.max ?? 0) + 1).padStart(5, '0')}`

          const [bill] = await tx.insert(bills).values({
            orderId,
            subtotal: total,
            total,
            paymentMethod,
            // El schema + la validación anterior garantizan que cuando
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
          // sin facturar. Cubre items agregados al grupo entre la confirmación y el cobro.
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
        break // éxito
      } catch (err: any) {
        // Carrera de numeración: el UNIQUE de receiptNumber falló. Reintentamos
        // recalculando MAX+1. Cualquier otro error se propaga.
        if (/UNIQUE/i.test(String(err?.message ?? '')) && attempt < 2) continue
        throw err
      }
    }
  } catch (error: any) {
    // A2: no exponer error.message al cliente; loguear server-side.
    console.error('[bills POST] Error en transacción:', error)
    res.status(500).json({ error: 'Error interno al crear boleta' })
    return
  }

  if (!result) {
    console.error('[bills POST] No se pudo generar un número de boleta único tras varios intentos')
    res.status(500).json({ error: 'No se pudo generar el número de boleta. Reintentá.' })
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
