import { db } from './index'
import { users, categories, dishes, modifierGroups, modifierOptions, tables } from './schema'
import bcrypt from 'bcryptjs'

async function seed() {
  console.log('Seeding database...')

  // Guard: skip if already seeded
  const existing = await db.select().from(categories)
  if (existing.length > 0) {
    console.log('Database already seeded, skipping.')
    process.exit(0)
  }

  // Users
  await db.insert(users).values([
    { name: 'Dueño', username: 'admin', passwordHash: await bcrypt.hash('admin123', 10), role: 'owner' },
    { name: 'Cajero', username: 'cajero', passwordHash: await bcrypt.hash('cajero123', 10), role: 'cashier' },
    { name: 'Mozo 1', username: 'mozo1', passwordHash: await bcrypt.hash('mozo123', 10), role: 'waiter' },
  ]).onConflictDoNothing()

  // Categories
  const [catCeviches, catTiraditos, catArroces, catBebidas, catExtras] = await db
    .insert(categories)
    .values([
      { name: 'Ceviches', displayOrder: 1 },
      { name: 'Tiraditos', displayOrder: 2 },
      { name: 'Arroces y Segundos', displayOrder: 3 },
      { name: 'Bebidas', displayOrder: 4 },
      { name: 'Extras', displayOrder: 5 },
    ])
    .returning()

  // Dishes
  const insertedDishes = await db.insert(dishes).values([
    { categoryId: catCeviches.id, name: 'Ceviche Clásico', description: 'Pescado fresco en leche de tigre', price: 28.00, hasSpiceLevel: true },
    { categoryId: catCeviches.id, name: 'Ceviche Mixto', description: 'Pescado, mariscos y pulpo', price: 35.00, hasSpiceLevel: true },
    { categoryId: catCeviches.id, name: 'Ceviche de Camarón', description: 'Camarones frescos en leche de tigre', price: 38.00, hasSpiceLevel: true },
    { categoryId: catTiraditos.id, name: 'Tiradito Clásico', description: 'Finas láminas de pescado en salsa amarilla', price: 30.00, hasSpiceLevel: true },
    { categoryId: catTiraditos.id, name: 'Tiradito Nikkei', description: 'Fusión peruano-japonesa', price: 33.00, hasSpiceLevel: true },
    { categoryId: catArroces.id, name: 'Arroz con Mariscos', description: 'Arroz cremoso con mariscos frescos', price: 32.00, hasSpiceLevel: false },
    { categoryId: catArroces.id, name: 'Jalea Mixta', description: 'Mariscos apanados y fritos', price: 36.00, hasSpiceLevel: false },
    { categoryId: catBebidas.id, name: 'Chicha Morada', description: 'Bebida tradicional peruana', price: 8.00, hasSpiceLevel: false },
    { categoryId: catBebidas.id, name: 'Gaseosa', description: 'Coca-Cola, Inca Kola, Sprite', price: 5.00, hasSpiceLevel: false },
    { categoryId: catBebidas.id, name: 'Agua Mineral', price: 4.00, hasSpiceLevel: false },
    { categoryId: catExtras.id, name: 'Cancha Serrana', price: 5.00, hasSpiceLevel: false },
    { categoryId: catExtras.id, name: 'Choclo', price: 4.00, hasSpiceLevel: false },
  ]).returning()

  // Spice level modifier for dishes that have it
  const spicyDishes = insertedDishes.filter(d => d.hasSpiceLevel)
  for (const dish of spicyDishes) {
    const [group] = await db.insert(modifierGroups).values({
      dishId: dish.id,
      name: 'Nivel de Picante',
      type: 'spice',
      required: true,
      multiple: false,
      displayOrder: 1,
    }).returning()

    await db.insert(modifierOptions).values([
      { groupId: group.id, name: 'Sin picante', displayOrder: 1 },
      { groupId: group.id, name: 'Poco picante', displayOrder: 2 },
      { groupId: group.id, name: 'Normal', displayOrder: 3 },
      { groupId: group.id, name: 'Picante', displayOrder: 4 },
      { groupId: group.id, name: 'Muy picante', displayOrder: 5 },
    ])

    // Free preference modifier
    await db.insert(modifierGroups).values({
      dishId: dish.id,
      name: 'Preferencias',
      type: 'preference',
      required: false,
      multiple: true,
      displayOrder: 2,
    })
  }

  // Tables (15 tables)
  await db.insert(tables).values(
    Array.from({ length: 15 }, (_, i) => ({
      number: i + 1,
      area: i < 8 ? 'salon' : i < 13 ? 'terraza' : 'barra',
      capacity: 4,
    }))
  ).onConflictDoNothing()

  console.log('Seed complete.')
  process.exit(0)
}

seed().catch(e => { console.error(e); process.exit(1) })
