import type { Table, Category, Order } from '../types'

export const mockTables: Table[] = [
  { id: 1, number: 1, area: 'salon', capacity: 4, status: 'occupied', activeOrderId: 101, orderTotal: 85.50, guestCount: 3 },
  { id: 2, number: 2, area: 'salon', capacity: 4, status: 'free' },
  { id: 3, number: 3, area: 'salon', capacity: 6, status: 'paying', activeOrderId: 102, orderTotal: 124.00, guestCount: 5 },
  { id: 4, number: 4, area: 'salon', capacity: 4, status: 'occupied', activeOrderId: 103, orderTotal: 56.00, guestCount: 2 },
  { id: 5, number: 5, area: 'salon', capacity: 4, status: 'free' },
  { id: 6, number: 6, area: 'salon', capacity: 4, status: 'free' },
  { id: 7, number: 7, area: 'salon', capacity: 4, status: 'occupied', activeOrderId: 104, orderTotal: 98.00, guestCount: 4 },
  { id: 8, number: 8, area: 'salon', capacity: 2, status: 'free' },
  { id: 9, number: 9, area: 'terraza', capacity: 4, status: 'occupied', activeOrderId: 105, orderTotal: 67.50, guestCount: 2 },
  { id: 10, number: 10, area: 'terraza', capacity: 4, status: 'free' },
  { id: 11, number: 11, area: 'terraza', capacity: 6, status: 'free' },
  { id: 12, number: 12, area: 'terraza', capacity: 4, status: 'occupied', activeOrderId: 106, orderTotal: 42.00, guestCount: 2 },
  { id: 13, number: 13, area: 'terraza', capacity: 4, status: 'free' },
  { id: 14, number: 14, area: 'barra', capacity: 2, status: 'free' },
  { id: 15, number: 15, area: 'barra', capacity: 2, status: 'occupied', activeOrderId: 107, orderTotal: 33.00, guestCount: 1 },
]

export const mockMenu: Category[] = [
  {
    id: 1, name: 'Ceviches', displayOrder: 1,
    dishes: [
      { id: 1, categoryId: 1, name: 'Ceviche Clásico', description: 'Pescado fresco en leche de tigre', price: 28.00, available: true, hasSpiceLevel: true,
        modifierGroups: [
          { id: 1, dishId: 1, name: 'Nivel de Picante', type: 'spice', required: true, multiple: false,
            options: [
              { id: 1, groupId: 1, name: 'Sin picante', priceAdjustment: 0, displayOrder: 1 },
              { id: 2, groupId: 1, name: 'Poco picante', priceAdjustment: 0, displayOrder: 2 },
              { id: 3, groupId: 1, name: 'Normal', priceAdjustment: 0, displayOrder: 3 },
              { id: 4, groupId: 1, name: 'Picante', priceAdjustment: 0, displayOrder: 4 },
              { id: 5, groupId: 1, name: 'Muy picante', priceAdjustment: 0, displayOrder: 5 },
            ]
          },
          { id: 2, dishId: 1, name: 'Preferencias', type: 'preference', required: false, multiple: true, options: [] },
        ]
      },
      { id: 2, categoryId: 1, name: 'Ceviche Mixto', description: 'Pescado, mariscos y pulpo', price: 35.00, available: true, hasSpiceLevel: true,
        modifierGroups: [
          { id: 3, dishId: 2, name: 'Nivel de Picante', type: 'spice', required: true, multiple: false,
            options: [
              { id: 6, groupId: 3, name: 'Sin picante', priceAdjustment: 0, displayOrder: 1 },
              { id: 7, groupId: 3, name: 'Poco picante', priceAdjustment: 0, displayOrder: 2 },
              { id: 8, groupId: 3, name: 'Normal', priceAdjustment: 0, displayOrder: 3 },
              { id: 9, groupId: 3, name: 'Picante', priceAdjustment: 0, displayOrder: 4 },
              { id: 10, groupId: 3, name: 'Muy picante', priceAdjustment: 0, displayOrder: 5 },
            ]
          },
          { id: 4, dishId: 2, name: 'Preferencias', type: 'preference', required: false, multiple: true, options: [] },
        ]
      },
      { id: 3, categoryId: 1, name: 'Ceviche de Camarón', description: 'Camarones frescos en leche de tigre', price: 38.00, available: true, hasSpiceLevel: true,
        modifierGroups: [
          { id: 5, dishId: 3, name: 'Nivel de Picante', type: 'spice', required: true, multiple: false,
            options: [
              { id: 11, groupId: 5, name: 'Sin picante', priceAdjustment: 0, displayOrder: 1 },
              { id: 12, groupId: 5, name: 'Poco picante', priceAdjustment: 0, displayOrder: 2 },
              { id: 13, groupId: 5, name: 'Normal', priceAdjustment: 0, displayOrder: 3 },
              { id: 14, groupId: 5, name: 'Picante', priceAdjustment: 0, displayOrder: 4 },
              { id: 15, groupId: 5, name: 'Muy picante', priceAdjustment: 0, displayOrder: 5 },
            ]
          },
          { id: 6, dishId: 3, name: 'Preferencias', type: 'preference', required: false, multiple: true, options: [] },
        ]
      },
    ]
  },
  {
    id: 2, name: 'Tiraditos', displayOrder: 2,
    dishes: [
      { id: 4, categoryId: 2, name: 'Tiradito Clásico', description: 'Finas láminas de pescado en salsa amarilla', price: 30.00, available: true, hasSpiceLevel: true,
        modifierGroups: [
          { id: 7, dishId: 4, name: 'Nivel de Picante', type: 'spice', required: true, multiple: false,
            options: [
              { id: 16, groupId: 7, name: 'Sin picante', priceAdjustment: 0, displayOrder: 1 },
              { id: 17, groupId: 7, name: 'Poco picante', priceAdjustment: 0, displayOrder: 2 },
              { id: 18, groupId: 7, name: 'Normal', priceAdjustment: 0, displayOrder: 3 },
              { id: 19, groupId: 7, name: 'Picante', priceAdjustment: 0, displayOrder: 4 },
              { id: 20, groupId: 7, name: 'Muy picante', priceAdjustment: 0, displayOrder: 5 },
            ]
          },
          { id: 8, dishId: 4, name: 'Preferencias', type: 'preference', required: false, multiple: true, options: [] },
        ]
      },
      { id: 5, categoryId: 2, name: 'Tiradito Nikkei', description: 'Fusión peruano-japonesa', price: 33.00, available: true, hasSpiceLevel: true,
        modifierGroups: [
          { id: 9, dishId: 5, name: 'Nivel de Picante', type: 'spice', required: true, multiple: false,
            options: [
              { id: 21, groupId: 9, name: 'Sin picante', priceAdjustment: 0, displayOrder: 1 },
              { id: 22, groupId: 9, name: 'Poco picante', priceAdjustment: 0, displayOrder: 2 },
              { id: 23, groupId: 9, name: 'Normal', priceAdjustment: 0, displayOrder: 3 },
              { id: 24, groupId: 9, name: 'Picante', priceAdjustment: 0, displayOrder: 4 },
              { id: 25, groupId: 9, name: 'Muy picante', priceAdjustment: 0, displayOrder: 5 },
            ]
          },
          { id: 10, dishId: 5, name: 'Preferencias', type: 'preference', required: false, multiple: true, options: [] },
        ]
      },
    ]
  },
  {
    id: 3, name: 'Arroces y Segundos', displayOrder: 3,
    dishes: [
      { id: 6, categoryId: 3, name: 'Arroz con Mariscos', description: 'Arroz cremoso con mariscos frescos', price: 32.00, available: true, hasSpiceLevel: false },
      { id: 7, categoryId: 3, name: 'Jalea Mixta', description: 'Mariscos apanados y fritos', price: 36.00, available: true, hasSpiceLevel: false },
    ]
  },
  {
    id: 4, name: 'Bebidas', displayOrder: 4,
    dishes: [
      { id: 8, categoryId: 4, name: 'Chicha Morada', description: 'Bebida tradicional peruana', price: 8.00, available: true, hasSpiceLevel: false },
      { id: 9, categoryId: 4, name: 'Gaseosa', description: 'Coca-Cola, Inca Kola, Sprite', price: 5.00, available: true, hasSpiceLevel: false },
      { id: 10, categoryId: 4, name: 'Agua Mineral', description: null, price: 4.00, available: true, hasSpiceLevel: false },
    ]
  },
  {
    id: 5, name: 'Extras', displayOrder: 5,
    dishes: [
      { id: 11, categoryId: 5, name: 'Cancha Serrana', description: null, price: 5.00, available: true, hasSpiceLevel: false },
      { id: 12, categoryId: 5, name: 'Choclo', description: null, price: 4.00, available: true, hasSpiceLevel: false },
    ]
  },
]

export const mockKitchenOrders: Order[] = [
  {
    id: 101, tableId: 1, type: 'dine_in', status: 'preparing',
    createdAt: new Date(Date.now() - 8 * 60000).toISOString(),
    items: [
      { id: 'i1', dishId: 1, dishName: 'Ceviche Clásico', unitPrice: 28, quantity: 2,
        modifiers: [{ groupId: 1, groupName: 'Nivel de Picante', optionId: 4, optionName: 'Picante' }], notes: '', status: 'preparing' },
      { id: 'i2', dishId: 8, dishName: 'Chicha Morada', unitPrice: 8, quantity: 2,
        modifiers: [], notes: '', status: 'ready' },
    ]
  },
  {
    id: 103, tableId: 4, type: 'dine_in', status: 'pending',
    createdAt: new Date(Date.now() - 3 * 60000).toISOString(),
    items: [
      { id: 'i3', dishId: 2, dishName: 'Ceviche Mixto', unitPrice: 35, quantity: 1,
        modifiers: [{ groupId: 3, groupName: 'Nivel de Picante', optionId: 8, optionName: 'Normal' },
                    { groupId: 4, groupName: 'Preferencias', freeText: 'sin cebolla' }], notes: '', status: 'pending' },
      { id: 'i4', dishId: 6, dishName: 'Arroz con Mariscos', unitPrice: 32, quantity: 1,
        modifiers: [], notes: 'sin ají', status: 'pending' },
    ]
  },
  {
    id: 108, tableId: null, type: 'delivery', status: 'preparing',
    customerName: 'Carlos Ramos', customerPhone: '951234567', customerAddress: 'Av. Bolognesi 432',
    createdAt: new Date(Date.now() - 15 * 60000).toISOString(),
    items: [
      { id: 'i5', dishId: 3, dishName: 'Ceviche de Camarón', unitPrice: 38, quantity: 1,
        modifiers: [{ groupId: 5, groupName: 'Nivel de Picante', optionId: 11, optionName: 'Sin picante' }], notes: '', status: 'preparing' },
      { id: 'i6', dishId: 7, dishName: 'Jalea Mixta', unitPrice: 36, quantity: 1,
        modifiers: [], notes: '', status: 'ready' },
      { id: 'i7', dishId: 9, dishName: 'Gaseosa', unitPrice: 5, quantity: 2,
        modifiers: [], notes: 'Inca Kola', status: 'ready' },
    ]
  },
  {
    id: 104, tableId: 7, type: 'dine_in', status: 'pending',
    createdAt: new Date(Date.now() - 1 * 60000).toISOString(),
    items: [
      { id: 'i8', dishId: 4, dishName: 'Tiradito Clásico', unitPrice: 30, quantity: 2,
        modifiers: [{ groupId: 7, groupName: 'Nivel de Picante', optionId: 18, optionName: 'Normal' }], notes: '', status: 'pending' },
      { id: 'i9', dishId: 5, dishName: 'Tiradito Nikkei', unitPrice: 33, quantity: 1,
        modifiers: [{ groupId: 9, groupName: 'Nivel de Picante', optionId: 24, optionName: 'Picante' }], notes: 'extra limón', status: 'pending' },
      { id: 'i10', dishId: 10, dishName: 'Agua Mineral', unitPrice: 4, quantity: 3,
        modifiers: [], notes: '', status: 'pending' },
    ]
  },
]
