import { sqliteTable, text, integer, real, index, uniqueIndex } from 'drizzle-orm/sqlite-core'
import { sql } from 'drizzle-orm'

export const users = sqliteTable('users', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  username: text('username').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  // 'manager' = Encargado: el dueño delega el local (D5). La columna es texto sin CHECK.
  role: text('role', { enum: ['owner', 'manager', 'cashier', 'waiter'] }).notNull(),
  active: integer('active', { mode: 'boolean' }).default(true),
  createdAt: text('created_at').default(sql`(datetime('now'))`),
})

export const categories = sqliteTable('categories', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  displayOrder: integer('display_order').default(0),
  active: integer('active', { mode: 'boolean' }).default(true),
})

export const dishes = sqliteTable('dishes', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  categoryId: integer('category_id').references(() => categories.id),
  name: text('name').notNull(),
  description: text('description'),
  price: real('price').notNull(),
  // available=false es solo "agotado" (lo registra audit_log como dish.availability);
  // archived=true es un plato dado de baja que conserva su historial (TD-31).
  available: integer('available', { mode: 'boolean' }).default(true),
  archived: integer('archived', { mode: 'boolean' }).default(false),
  hasSpiceLevel: integer('has_spice_level', { mode: 'boolean' }).default(true),
  createdAt: text('created_at').default(sql`(datetime('now'))`),
})

export const modifierGroups = sqliteTable('modifier_groups', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  dishId: integer('dish_id').references(() => dishes.id),
  name: text('name').notNull(),
  type: text('type', { enum: ['spice', 'preference'] }).notNull(),
  required: integer('required', { mode: 'boolean' }).default(false),
  multiple: integer('multiple', { mode: 'boolean' }).default(false),
  displayOrder: integer('display_order').default(0),
})

export const modifierOptions = sqliteTable('modifier_options', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  groupId: integer('group_id').references(() => modifierGroups.id),
  name: text('name').notNull(),
  priceAdjustment: real('price_adjustment').default(0),
  displayOrder: integer('display_order').default(0),
})

export const tables = sqliteTable('tables', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  number: integer('number').notNull().unique(),
  area: text('area').default('salon'),
  capacity: integer('capacity').default(4),
  status: text('status', { enum: ['free', 'occupied', 'paying'] }).default('free'),
  posX: real('pos_x'),
  posY: real('pos_y'),
  // active=false marca la mesa como inhabilitada (sigue en historial pero oculta en POS).
  // Permite "borrar" mesas que tienen pedidos pagados referenciándolas (FK constraint impide DELETE).
  active: integer('active', { mode: 'boolean' }).default(true),
})

// Decoraciones del plano: labels (texto) y zones (rectángulos coloreados con título).
// Posiciones en el mismo canvas virtual que las mesas (1200x700).
export const layoutItems = sqliteTable('layout_items', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  type: text('type', { enum: ['label', 'zone'] }).notNull(),
  text: text('text').notNull(),
  posX: real('pos_x').notNull(),
  posY: real('pos_y').notNull(),
  width: real('width'),     // solo para zones
  height: real('height'),   // solo para zones
  color: text('color').default('#94A3B8'),
})

export const orders = sqliteTable('orders', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  tableId: integer('table_id').references(() => tables.id),
  type: text('type', { enum: ['dine_in', 'delivery'] }).notNull(),
  // Activos: pending, paying ('por cobrar'). Cerrados: paid, cancelled.
  // preparing/ready son heredados de la pantalla de cocina retirada; se tratan como pending.
  status: text('status', { enum: ['pending', 'paying', 'preparing', 'ready', 'paid', 'cancelled'] }).default('pending'),
  customerName: text('customer_name'),
  customerPhone: text('customer_phone'),
  customerAddress: text('customer_address'),
  notes: text('notes'),
  createdBy: integer('created_by').references(() => users.id),
  createdAt: text('created_at').default(sql`(datetime('now'))`),
  updatedAt: text('updated_at').default(sql`(datetime('now'))`),
}, (t) => [
  // Los índices se declaran aquí además de en migrate.ts: si solo estuvieran
  // allí, `drizzle-kit push` los eliminaría (verificado).
  index('idx_orders_table_status').on(t.tableId, t.status),
  // Un solo pedido activo por mesa, garantizado también por la BD (TD-04).
  uniqueIndex('uq_orders_active_table').on(t.tableId)
    .where(sql`table_id IS NOT NULL AND status NOT IN ('paid', 'cancelled')`),
])

export const orderItems = sqliteTable('order_items', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  orderId: integer('order_id').references(() => orders.id),
  dishId: integer('dish_id').references(() => dishes.id),
  dishName: text('dish_name').notNull(),
  unitPrice: real('unit_price').notNull(),
  quantity: integer('quantity').default(1),
  modifiers: text('modifiers').default('[]'),
  notes: text('notes'),
  status: text('status', { enum: ['pending', 'preparing', 'ready'] }).default('pending'),
  kitchenPrinted: integer('kitchen_printed', { mode: 'boolean' }).default(false),
  billId: integer('bill_id'),
  billGroupId: integer('bill_group_id'),
}, (t) => [
  index('idx_order_items_order_id').on(t.orderId),
  index('idx_order_items_bill_id').on(t.billId),
])

export const billGroups = sqliteTable('bill_groups', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  orderId: integer('order_id').notNull().references(() => orders.id),
  label: text('label').notNull(),
  status: text('status', { enum: ['open', 'paid'] }).default('open'),
  billId: integer('bill_id'),
  createdAt: text('created_at').default(sql`(datetime('now'))`),
})

export const bills = sqliteTable('bills', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  orderId: integer('order_id').references(() => orders.id),
  subtotal: real('subtotal').notNull(),
  total: real('total').notNull(),
  paymentMethod: text('payment_method', { enum: ['cash', 'yape', 'plin'] }).notNull(),
  cashReceived: real('cash_received'),
  changeAmount: real('change_amount'),
  receiptNumber: text('receipt_number').notNull().unique(),
  paidAt: text('paid_at').default(sql`(datetime('now'))`),
  createdBy: integer('created_by').references(() => users.id),
}, (t) => [
  index('idx_bills_paid_at').on(t.paidAt),
])

// Registro de operaciones sensibles (cancelaciones, correcciones, cambios de
// permisos o precios). Se escribe en la misma transacción que la operación.
export const auditLog = sqliteTable('audit_log', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  at: text('at').default(sql`(datetime('now'))`),
  userId: integer('user_id').references(() => users.id),
  action: text('action').notNull(),
  entity: text('entity').notNull(),
  entityId: integer('entity_id'),
  data: text('data'),
}, (t) => [
  index('idx_audit_log_at').on(t.at),
])

export const expenses = sqliteTable('expenses', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  description: text('description').notNull(),
  amount: real('amount').notNull(),
  category: text('category').default('general'),
  date: text('date').notNull(),
  notes: text('notes'),
  createdBy: integer('created_by').references(() => users.id),
  createdAt: text('created_at').default(sql`(datetime('now'))`),
})

// ── Inventario de insumos (Fase 0 de la tesis: solo registro, sin alertas) ──
// Las fechas de compra, merma y conteo son días LOCALES 'YYYY-MM-DD' (como
// expenses.date); lost_sales.occurred_at es UTC como el resto de timestamps.
// Definiciones y formato del export: docs/diccionario-datos-tesis.md (instrumento
// congelado de la tesis). local_id es siempre 1: existe para no mapear datos si
// algún día hay más sucursales; no se muestra en la UI.

// Origen de compras y merma: 'daily' = lo creó la «Compra del día» (que reemplaza
// solo lo suyo al corregir); 'manual' = pestañas de detalle.
const SOURCES = ['manual', 'daily'] as const

export const supplies = sqliteTable('supplies', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull().unique(),
  unit: text('unit', { enum: ['kg', 'unit', 'l'] }).notNull(),
  perishable: integer('perishable', { mode: 'boolean' }).default(true),
  // Insumos que entran al estudio (pescado, calamar, mariscos)
  critical: integer('critical', { mode: 'boolean' }).default(false),
  active: integer('active', { mode: 'boolean' }).default(true),
  // Identificador estable para el análisis (CALAMAR): no cambia aunque cambie el nombre
  code: text('code').unique(),
  // Orden en la «Compra del día»
  sortOrder: integer('sort_order').default(0),
  createdAt: text('created_at').default(sql`(datetime('now'))`),
})

export const supplyPurchases = sqliteTable('supply_purchases', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  supplyId: integer('supply_id').notNull().references(() => supplies.id),
  quantity: real('quantity').notNull(),
  // Lo pagado en total; el precio unitario se deriva (total / cantidad)
  totalCost: real('total_cost').notNull(),
  purchasedAt: text('purchased_at').notNull(),
  notes: text('notes'),
  supplier: text('supplier'),
  source: text('source', { enum: SOURCES }).notNull().default('manual'),
  // Fecha de la «Compra del día» que creó la fila (solo source='daily')
  sourceDate: text('source_date'),
  localId: integer('local_id').notNull().default(1),
  createdBy: integer('created_by').references(() => users.id),
  createdAt: text('created_at').default(sql`(datetime('now'))`),
}, (t) => [
  index('idx_supply_purchases_purchased_at').on(t.purchasedAt),
])

export const supplyWaste = sqliteTable('supply_waste', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  supplyId: integer('supply_id').notNull().references(() => supplies.id),
  quantity: real('quantity').notNull(),
  reason: text('reason', { enum: ['deterioro', 'sobra_comensal', 'preparacion', 'otro'] }).notNull(),
  wastedAt: text('wasted_at').notNull(),
  notes: text('notes'),
  source: text('source', { enum: SOURCES }).notNull().default('manual'),
  // La merma de la «Compra del día» se imputa al día operativo anterior: sourceDate
  // guarda el día en que se registró, para poder reemplazarla al corregir
  sourceDate: text('source_date'),
  localId: integer('local_id').notNull().default(1),
  createdBy: integer('created_by').references(() => users.id),
  createdAt: text('created_at').default(sql`(datetime('now'))`),
}, (t) => [
  index('idx_supply_waste_wasted_at').on(t.wastedAt),
])

export const supplyCounts = sqliteTable('supply_counts', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  supplyId: integer('supply_id').notNull().references(() => supplies.id),
  quantity: real('quantity').notNull(),
  countedOn: text('counted_on').notNull(),
  // 'apertura' = antes de comprar (instrumento v1); 'cierre' = conteos de prueba de la v1
  moment: text('moment', { enum: ['apertura', 'cierre'] }).notNull().default('apertura'),
  localId: integer('local_id').notNull().default(1),
  createdBy: integer('created_by').references(() => users.id),
  createdAt: text('created_at').default(sql`(datetime('now'))`),
}, (t) => [
  // Un conteo por insumo, día y momento: volver a registrarlo lo corrige
  uniqueIndex('uq_supply_counts_day_moment').on(t.supplyId, t.countedOn, t.moment),
])

export const lostSales = sqliteTable('lost_sales', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  dishId: integer('dish_id').references(() => dishes.id),
  supplyId: integer('supply_id').references(() => supplies.id),
  quantity: integer('quantity').default(1),
  occurredAt: text('occurred_at').default(sql`(datetime('now'))`),
  createdBy: integer('created_by').references(() => users.id),
  localId: integer('local_id').notNull().default(1),
}, (t) => [
  index('idx_lost_sales_occurred_at').on(t.occurredAt),
])

// Variables de control de la tesis (feriado, evento, cambio de proveedor…).
// Se escriben desde la «Compra del día»; varias por día.
export const dayNotes = sqliteTable('day_notes', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  date: text('date').notNull(),
  kind: text('kind', { enum: ['feriado', 'cerrado', 'evento', 'proveedor', 'otro'] }).notNull(),
  text: text('text'),
  localId: integer('local_id').notNull().default(1),
  createdBy: integer('created_by').references(() => users.id),
  createdAt: text('created_at').default(sql`(datetime('now'))`),
}, (t) => [
  index('idx_day_notes_date').on(t.date),
])
