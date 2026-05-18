import { sqliteTable, text, integer, real } from 'drizzle-orm/sqlite-core'
import { sql } from 'drizzle-orm'

export const users = sqliteTable('users', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  username: text('username').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  role: text('role', { enum: ['owner', 'cashier', 'waiter'] }).notNull(),
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
  available: integer('available', { mode: 'boolean' }).default(true),
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
  status: text('status', { enum: ['pending', 'preparing', 'ready', 'paid', 'cancelled'] }).default('pending'),
  customerName: text('customer_name'),
  customerPhone: text('customer_phone'),
  customerAddress: text('customer_address'),
  notes: text('notes'),
  createdBy: integer('created_by').references(() => users.id),
  createdAt: text('created_at').default(sql`(datetime('now'))`),
  updatedAt: text('updated_at').default(sql`(datetime('now'))`),
})

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
})

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
})

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
