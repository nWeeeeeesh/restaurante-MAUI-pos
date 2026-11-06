// Carga los datos simulados de scripts/tesis (fixtures/sim12) en una base de prueba
// (plan-sistema T6). Inserta directo en las tablas: la «Compra del día» solo acepta 7
// días atrás y las ventas de 12 semanas no pasan por el POS. Requiere una base recién
// creada (sin carta ni insumos). Solo importa el esquema: sirve en tests HTTP y en
// scripts/load-sim.ts.
import * as fs from 'fs'
import * as path from 'path'
import type { LibSQLDatabase } from 'drizzle-orm/libsql'
import * as schema from '../../db/schema'

type Db = LibSQLDatabase<typeof schema>
type Row = Record<string, string>

export const SIM12_DIR = path.join(__dirname, '..', 'fixtures', 'sim12')
const LIMA_OFFSET = '-05:00'  // Lima no tiene horario de verano
const CHUNK = 200

// CSV simple con comillas dobles (lo que escribe el módulo csv de Python)
export function parseCsv(text: string): Row[] {
  const rows: string[][] = []
  let field = ''
  let row: string[] = []
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++ }
      else if (ch === '"') quoted = false
      else field += ch
    } else if (ch === '"') quoted = true
    else if (ch === ',') { row.push(field); field = '' }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++
      row.push(field); rows.push(row); row = []; field = ''
    } else field += ch
  }
  if (field !== '' || row.length > 0) { row.push(field); rows.push(row) }
  const [header, ...data] = rows.filter(r => r.length > 1 || r[0] !== '')
  return data.map(r => Object.fromEntries(header.map((h, k) => [h, r[k] ?? ''])))
}

export function readSim(table: string, dir = SIM12_DIR): Row[] {
  return parseCsv(fs.readFileSync(path.join(dir, `${table}.csv`), 'utf-8').replace(/^﻿/, ''))
}

// Fecha y hora locales de Lima → timestamp UTC como lo guarda SQLite ('YYYY-MM-DD HH:MM:SS')
export function limaToUtc(date: string, time = '00:00:00'): string {
  const t = time.length === 5 ? `${time}:00` : time
  return new Date(`${date}T${t}${LIMA_OFFSET}`).toISOString().slice(0, 19).replace('T', ' ')
}

const splitTs = (ts: string) => ts.split(' ') as [string, string]
const num = (s: string) => Number(s)

async function insertAll<T>(rows: T[], insert: (chunk: T[]) => Promise<unknown>) {
  for (let i = 0; i < rows.length; i += CHUNK) await insert(rows.slice(i, i + CHUNK))
}

export interface SimLoadOptions {
  dir?: string
  // Hash de contraseña de los usuarios simulados (los tests no inician sesión con ellos)
  passwordHash?: string
}

export async function loadSim(db: Db, opts: SimLoadOptions = {}) {
  const dir = opts.dir ?? SIM12_DIR
  const read = (t: string) => readSim(t, dir)
  const passwordHash = opts.passwordHash ?? 'x'

  // ── Usuarios: los nombres coinciden con registrado_por de los CSV ──
  const users = await db.insert(schema.users).values([
    { name: 'Dueño', username: 'sim-dueno', passwordHash, role: 'owner' },
    { name: 'Encargada', username: 'sim-encargada', passwordHash, role: 'manager' },
    { name: 'Cajero', username: 'sim-cajero', passwordHash, role: 'cashier' },
  ]).returning()
  const userId = new Map(users.map(u => [u.name, u.id]))
  const by = (name: string) => userId.get(name) ?? null

  // ── Carta: cada variante es un plato (sku) ──
  const carta = read('carta')
  const catId = new Map<string, number>()
  for (const c of carta) {
    if (catId.has(c.categoria)) continue
    const [cat] = await db.insert(schema.categories).values({ name: c.categoria, displayOrder: catId.size + 1 }).returning()
    catId.set(c.categoria, cat.id)
  }
  const dishRows = await db.insert(schema.dishes).values(carta.map(c => ({
    categoryId: catId.get(c.categoria)!, name: c.sku, price: num(c.precio), hasSpiceLevel: false,
  }))).returning()
  const dishId = new Map(dishRows.map(d => [d.name, d.id]))
  const skuOf = new Map(carta.map(c => [`${c.plato}|${c.variante}`, c.sku]))

  // ── Insumos ──
  const supplyRows = await db.insert(schema.supplies).values(read('insumos').map(s => ({
    code: s.codigo, name: s.nombre, unit: s.unidad as 'kg', perishable: s.perecible === '1',
    critical: s.critico === '1', active: s.activo === '1', sortOrder: num(s.orden),
  }))).returning()
  const supplyId = new Map(supplyRows.map(s => [s.code!, s.id]))

  // ── Ventas: una boleta pagada por número de boleta, en efectivo, sin mesa ──
  const items = read('ventas_items')
  const byBill = new Map<string, Row[]>()
  for (const it of items) {
    const list = byBill.get(it.boleta) ?? []
    list.push(it)
    byBill.set(it.boleta, list)
  }
  const cashier = by('Cajero')
  const bills = [...byBill.entries()]
  const orderRows = await insertReturning(bills, chunk => db.insert(schema.orders).values(chunk.map(([, its]) => {
    const first = its.reduce((a, b) => (b.hora < a.hora ? b : a))
    const at = limaToUtc(first.fecha, first.hora)
    return { type: 'dine_in' as const, status: 'paid' as const, createdBy: cashier, createdAt: at, updatedAt: at }
  })).returning({ id: schema.orders.id }))
  const billRows = await insertReturning(bills.map((b, k) => [b, orderRows[k].id] as const), chunk =>
    db.insert(schema.bills).values(chunk.map(([[n, its], orderId]) => {
      const last = its.reduce((a, b) => (b.hora > a.hora ? b : a))
      const total = its.reduce((t, i) => t + num(i.cantidad) * num(i.precio), 0)
      return {
        orderId, subtotal: total, total, paymentMethod: 'cash' as const, cashReceived: total, changeAmount: 0,
        receiptNumber: `S-${n.padStart(6, '0')}`, paidAt: limaToUtc(last.fecha, last.hora), createdBy: cashier,
      }
    })).returning({ id: schema.bills.id }))
  const orderItems = bills.flatMap(([, its], k) => its.map(i => {
    const sku = skuOf.get(`${i.plato}|${i.variante}`)!
    return {
      orderId: orderRows[k].id, dishId: dishId.get(sku)!, dishName: sku, unitPrice: num(i.precio),
      quantity: num(i.cantidad), kitchenPrinted: true, billId: billRows[k].id,
    }
  }))
  await insertAll(orderItems, chunk => db.insert(schema.orderItems).values(chunk))

  // ── Inventario ──
  const purchases = read('purchases')
  await insertAll(purchases, chunk => db.insert(schema.supplyPurchases).values(chunk.map(p => ({
    supplyId: supplyId.get(p.insumo_codigo)!, quantity: num(p.cantidad), totalCost: num(p.costo_total),
    purchasedAt: p.fecha, supplier: p.proveedor || null, notes: p.notas || null, source: p.origen as 'daily',
    sourceDate: p.origen === 'daily' ? p.fecha : null, entryMode: p.modo_entrada as 'typed',
    priceEntryMode: p.modo_precio as 'typed', createdBy: by(p.registrado_por), createdAt: limaToUtc(...splitTs(p.registrado_en)),
  }))))
  const waste = read('waste')
  await insertAll(waste, chunk => db.insert(schema.supplyWaste).values(chunk.map(w => ({
    supplyId: supplyId.get(w.insumo_codigo)!, quantity: num(w.cantidad), reason: w.motivo as 'deterioro',
    wastedAt: w.fecha, notes: w.notas || null, source: w.origen as 'daily',
    // Se registra en la «Compra del día» siguiente y se imputa al día de atención anterior
    sourceDate: w.origen === 'daily' ? w.registrado_en.slice(0, 10) : null,
    entryMode: w.modo_entrada as 'typed', createdBy: by(w.registrado_por), createdAt: limaToUtc(...splitTs(w.registrado_en)),
  }))))
  const counts = read('counts')
  await insertAll(counts, chunk => db.insert(schema.supplyCounts).values(chunk.map(c => ({
    supplyId: supplyId.get(c.insumo_codigo)!, quantity: num(c.cantidad), countedOn: c.fecha,
    moment: c.momento as 'apertura', entryMode: c.modo_entrada as 'typed', createdBy: by(c.registrado_por),
    createdAt: limaToUtc(...splitTs(c.registrado_en)),
  }))))
  const lost = read('lost_sales')
  await insertAll(lost, chunk => db.insert(schema.lostSales).values(chunk.map(l => ({
    dishId: dishId.get(l.plato)!, supplyId: supplyId.get(l.insumo_codigo)!, quantity: num(l.porciones),
    occurredAt: limaToUtc(l.fecha, l.hora), createdBy: by(l.registrado_por),
  }))))
  // Agotados: dos eventos dish.availability por intervalo, como los escribe /availability
  const stockouts = read('stockouts')
  const events = stockouts.flatMap(s => [
    { at: limaToUtc(...splitTs(s.inicio)), userId: by(s.marcado_por), entityId: dishId.get(s.plato)!, available: false, name: s.plato, source: s.origen },
    { at: limaToUtc(...splitTs(s.fin)), userId: by(s.habilitado_por), entityId: dishId.get(s.plato)!, available: true, name: s.plato, source: s.origen },
  ]).sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0))
  await insertAll(events, chunk => db.insert(schema.auditLog).values(chunk.map(e => ({
    at: e.at, userId: e.userId, action: 'dish.availability', entity: 'dish', entityId: e.entityId,
    data: JSON.stringify({ name: e.name, available: e.available, source: e.source }),
  }))))
  const notes = read('day_notes')
  await insertAll(notes, chunk => db.insert(schema.dayNotes).values(chunk.map(n => ({
    date: n.fecha, kind: n.tipo as 'feriado', text: n.texto || null, createdBy: by(n.registrado_por),
    createdAt: limaToUtc(...splitTs(n.registrado_en)),
  }))))
  const other = read('other_costs')
  await insertAll(other, chunk => db.insert(schema.otherSupplyCosts).values(chunk.map(o => ({
    date: o.fecha, amount: num(o.monto), source: o.origen as 'daily', entryMode: o.modo_entrada as 'typed',
    createdBy: by(o.registrado_por), createdAt: limaToUtc(...splitTs(o.registrado_en)),
  }))))
  const expenses = read('gastos')
  await insertAll(expenses, chunk => db.insert(schema.expenses).values(chunk.map(g => ({
    description: g.descripcion, amount: num(g.monto), category: g.categoria, date: g.fecha,
    createdBy: by('Dueño'), createdAt: limaToUtc(g.fecha, '08:00:00'),
  }))))

  return {
    users: userId, dishId, supplyId,
    counts: {
      dishes: dishRows.length, supplies: supplyRows.length, bills: bills.length, orderItems: orderItems.length,
      purchases: purchases.length, waste: waste.length, counts: counts.length, lostSales: lost.length,
      availabilityEvents: events.length, dayNotes: notes.length, otherCosts: other.length, expenses: expenses.length,
    },
  }
}

// SQLite no garantiza el orden de RETURNING: en una base nueva los ids crecen en el
// orden de inserción, así que se ordenan por id para emparejarlos con las filas
async function insertReturning<T, R extends { id: number }>(rows: T[], insert: (chunk: T[]) => Promise<R[]>): Promise<R[]> {
  const out: R[] = []
  for (let i = 0; i < rows.length; i += CHUNK) out.push(...(await insert(rows.slice(i, i + CHUNK))).sort((a, b) => a.id - b.id))
  return out
}
