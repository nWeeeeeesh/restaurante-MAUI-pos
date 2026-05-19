import { useState, useMemo, useEffect } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { useOrderStore } from '../store/order'
import { useOrdersStore, type ActiveOrder } from '../store/orders'
import type { Category, Dish, OrderItem, SelectedModifier, TableStatus } from '../types'
import api from '../api/client'
import { useToastStore } from '../store/toast'
import {
  ArrowLeft, Search, Flame, Plus, Minus, X,
  Send, CreditCard, Bike, LayoutGrid, ChevronDown, Trash2,
} from 'lucide-react'

// ─── Table definitions (ahora vienen del API; el TABLE_DEFS hardcodeado quedó obsoleto) ─
interface PosTable {
  id: number
  number: number
  area: string | null
  capacity: number | null
  active: boolean | null
}

const TABLE_STATUS_STYLE: Record<TableStatus, string> = {
  free:     'bg-emerald-50 border-emerald-200 text-emerald-700 hover:bg-emerald-100',
  occupied: 'bg-blue-50 border-blue-200 text-blue-700 hover:bg-blue-100',
  paying:   'bg-orange-50 border-orange-100 text-orange-400 opacity-60 cursor-not-allowed',
}

// ─── Table Selector Modal ─────────────────────────────────────────────────────
function TableSelectorModal({ tables, current, onSelect, onClose }: {
  tables: PosTable[]
  current: number | null; onSelect: (id: number) => void; onClose: () => void
}) {
  const { getTableStatus } = useOrdersStore()
  const AREA_LABELS: Record<string, string> = { salon: 'Salón', terraza: 'Terraza', barra: 'Barra' }
  const activeTables = tables.filter(t => t.active !== false)
  const areasInUse = Array.from(new Set(activeTables.map(t => t.area ?? 'salon')))
  const ordered = ['salon', 'terraza', 'barra'].filter(a => areasInUse.includes(a))
  const others = areasInUse.filter(a => !['salon', 'terraza', 'barra'].includes(a))
  const allAreas = [...ordered, ...others]

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-white rounded-3xl w-full max-w-md shadow-2xl flex flex-col max-h-[90vh]" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-[#E2E8F0] flex items-center justify-between shrink-0">
          <div>
            <h3 className="font-black text-[#0F172A]">Seleccionar Mesa</h3>
            <p className="text-xs text-[#64748B] mt-0.5">Verde = libre · Azul = ocupada (agrega items)</p>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-xl bg-[#EEF3F8] flex items-center justify-center"><X size={15} /></button>
        </div>
        <div className="p-5 space-y-4 overflow-y-auto">
          {activeTables.length === 0 && (
            <p className="text-sm text-[#64748B] text-center py-8">No hay mesas activas. Agrégalas desde el plano.</p>
          )}
          {allAreas.map(area => {
            const areaTables = activeTables.filter(t => (t.area ?? 'salon') === area)
            if (areaTables.length === 0) return null
            return (
              <div key={area}>
                <p className="text-xs font-bold text-[#94A3B8] uppercase tracking-wider mb-2">{AREA_LABELS[area] ?? area}</p>
                <div className="grid grid-cols-4 sm:grid-cols-5 gap-2">
                  {areaTables.map(t => {
                    const status = getTableStatus(t.id)
                    return (
                      <button key={t.id} disabled={status === 'paying'}
                        onClick={() => { onSelect(t.id); onClose() }}
                        className={`border-2 rounded-xl py-2.5 text-sm font-bold transition-all ${
                          current === t.id
                            ? 'bg-[#0077B6] border-[#0077B6] text-white shadow-md'
                            : TABLE_STATUS_STYLE[status]
                        }`}>
                        {t.number}
                      </button>
                    )
                  })}
                </div>
              </div>
            )
          })}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[#64748B] pt-2 border-t border-[#E2E8F0]">
            <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded bg-emerald-200 border border-emerald-300"/>Libre</span>
            <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded bg-blue-200 border border-blue-300"/>Ocupada</span>
            <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded bg-orange-100 border border-orange-200"/>Por cobrar</span>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Modifier Modal ───────────────────────────────────────────────────────────
function ModifierModal({ dish, onConfirm, onClose }: {
  dish: Dish; onConfirm: (item: Omit<OrderItem, 'id' | 'status'>) => void; onClose: () => void
}) {
  const [qty, setQty] = useState(1)
  const [spiceOption, setSpiceOption] = useState<{ id: number; name: string } | null>(null)
  const [prefText, setPrefText] = useState('')
  const [notes, setNotes] = useState('')

  const spiceGroup = dish.modifierGroups?.find(g => g.type === 'spice')
  const prefGroup  = dish.modifierGroups?.find(g => g.type === 'preference')
  const canConfirm = !spiceGroup || spiceOption !== null

  const SPICE_COLORS   = ['text-blue-600 bg-blue-50 border-blue-200','text-green-600 bg-green-50 border-green-200','text-yellow-600 bg-yellow-50 border-yellow-200','text-orange-600 bg-orange-50 border-orange-200','text-red-600 bg-red-50 border-red-200']
  const SPICE_SELECTED = ['bg-blue-600 text-white border-blue-600','bg-green-600 text-white border-green-600','bg-yellow-500 text-white border-yellow-500','bg-orange-500 text-white border-orange-500','bg-red-600 text-white border-red-600']

  const handleConfirm = () => {
    const modifiers: SelectedModifier[] = []
    if (spiceGroup && spiceOption)
      modifiers.push({ groupId: spiceGroup.id, groupName: spiceGroup.name, optionId: spiceOption.id, optionName: spiceOption.name })
    if (prefGroup && prefText.trim())
      modifiers.push({ groupId: prefGroup.id, groupName: prefGroup.name, freeText: prefText.trim() })
    onConfirm({ dishId: dish.id, dishName: dish.name, unitPrice: dish.price, quantity: qty, modifiers, notes })
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-white rounded-3xl w-full max-w-md shadow-2xl flex flex-col max-h-[90vh]" onClick={e => e.stopPropagation()}>
        {/* Header — fixed */}
        <div className="px-6 pt-6 pb-4 border-b border-[#E2E8F0] shrink-0">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="text-lg font-black text-[#0F172A]">{dish.name}</h3>
              {dish.description && <p className="text-sm text-[#64748B] mt-0.5">{dish.description}</p>}
            </div>
            <p className="text-2xl font-black text-[#F4792B] shrink-0">S/ {dish.price.toFixed(2)}</p>
          </div>
          <div className="flex items-center justify-between mt-4">
            <span className="text-sm font-semibold text-[#0F172A]">Cantidad</span>
            <div className="flex items-center gap-3 bg-[#EEF3F8] rounded-xl p-1">
              <button onClick={() => setQty(q => Math.max(1, q-1))} className="w-9 h-9 rounded-lg bg-white shadow-sm flex items-center justify-center hover:bg-[#0077B6] hover:text-white transition-colors"><Minus size={16}/></button>
              <span className="text-lg font-black w-8 text-center">{qty}</span>
              <button onClick={() => setQty(q => q+1)} className="w-9 h-9 rounded-lg bg-white shadow-sm flex items-center justify-center hover:bg-[#0077B6] hover:text-white transition-colors"><Plus size={16}/></button>
            </div>
          </div>
        </div>
        {/* Scrollable content */}
        <div className="px-6 py-5 space-y-5 overflow-y-auto">
          {spiceGroup && (
            <div>
              <div className="flex items-center gap-2 mb-3">
                <Flame size={15} className="text-[#F4792B]" />
                <p className="text-sm font-bold text-[#0F172A]">Nivel de Picante</p>
                <span className="text-xs text-red-400 font-medium">* requerido</span>
              </div>
              <div className="flex gap-2 flex-wrap">
                {spiceGroup.options.map((opt, i) => (
                  <button key={opt.id} onClick={() => setSpiceOption({ id: opt.id, name: opt.name })}
                    className={`flex-1 min-w-0 py-2.5 px-2 rounded-xl text-xs font-semibold border-2 transition-all ${spiceOption?.id === opt.id ? SPICE_SELECTED[i] : SPICE_COLORS[i]}`}>
                    {opt.name}
                  </button>
                ))}
              </div>
            </div>
          )}
          {prefGroup && (
            <div>
              <p className="text-sm font-bold text-[#0F172A] mb-2">Preferencias <span className="text-[#94A3B8] font-normal">(opcional)</span></p>
              <input value={prefText} onChange={e => setPrefText(e.target.value)} placeholder="ej: sin cebolla, extra limón..."
                className="w-full bg-[#EEF3F8] rounded-xl px-4 py-3 text-sm placeholder-[#94A3B8] focus:outline-none focus:ring-2 focus:ring-[#0077B6]/30 border border-transparent focus:border-[#0077B6]"/>
            </div>
          )}
          <div>
            <p className="text-sm font-bold text-[#0F172A] mb-2">Nota para cocina <span className="text-[#94A3B8] font-normal">(opcional)</span></p>
            <input value={notes} onChange={e => setNotes(e.target.value)} placeholder="ej: traer primero, alergia a mariscos..."
              className="w-full bg-[#EEF3F8] rounded-xl px-4 py-3 text-sm placeholder-[#94A3B8] focus:outline-none focus:ring-2 focus:ring-[#0077B6]/30 border border-transparent focus:border-[#0077B6]"/>
          </div>
        </div>
        {/* Footer — fixed */}
        <div className="px-6 pb-6 pt-3 flex gap-3 shrink-0 border-t border-[#E2E8F0]">
          <button onClick={onClose} className="flex-1 bg-[#EEF3F8] text-[#64748B] font-semibold py-4 rounded-xl hover:bg-[#E2E8F0] text-sm">Cerrar</button>
          <button onClick={handleConfirm} disabled={!canConfirm}
            className="flex-1 font-bold py-4 rounded-xl text-white text-sm disabled:opacity-40 shadow-md transition-all"
            style={{ background: canConfirm ? 'linear-gradient(135deg,#0077B6,#004E86)' : '#CBD5E1' }}>
            {`Agregar · S/ ${(dish.price * qty).toFixed(2)}`}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Order Item Row ───────────────────────────────────────────────────────────
function OrderItemRow({ item, onRemove, onQtyChange }: {
  item: OrderItem; onRemove: () => void; onQtyChange: (d: number) => void
}) {
  const spice = item.modifiers.find(m => m.optionName)
  const pref  = item.modifiers.find(m => m.freeText)
  return (
    <div className="bg-[#EEF3F8] rounded-xl p-3 flex gap-3">
      <div className="flex-1 min-w-0">
        <p className="text-sm font-bold text-[#0F172A] leading-tight">{item.dishName}</p>
        {spice && <p className="text-xs text-[#F4792B] mt-0.5 flex items-center gap-1"><Flame size={10}/>{spice.optionName}</p>}
        {pref  && <p className="text-xs text-[#64748B] italic mt-0.5 truncate">{pref.freeText}</p>}
        {item.notes && <p className="text-xs text-amber-600 mt-0.5 truncate">⚠ {item.notes}</p>}
      </div>
      <div className="flex flex-col items-end gap-2 shrink-0">
        <span className="text-sm font-black text-[#0077B6]">S/ {(item.unitPrice * item.quantity).toFixed(2)}</span>
        <div className="flex items-center gap-1">
          <button onClick={() => onQtyChange(-1)} className="w-7 h-7 rounded-lg bg-white shadow-sm flex items-center justify-center hover:bg-[#0077B6] hover:text-white transition-colors"><Minus size={12}/></button>
          <span className="text-xs font-bold w-5 text-center">{item.quantity}</span>
          <button onClick={() => onQtyChange(1)}  className="w-7 h-7 rounded-lg bg-white shadow-sm flex items-center justify-center hover:bg-[#0077B6] hover:text-white transition-colors"><Plus size={12}/></button>
          <button onClick={onRemove} className="w-7 h-7 rounded-lg bg-white shadow-sm flex items-center justify-center hover:bg-red-500 hover:text-white text-[#94A3B8] transition-colors ml-1"><X size={12}/></button>
        </div>
      </div>
    </div>
  )
}

// ─── POS Page ─────────────────────────────────────────────────────────────────
export default function POS() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()

  const { orderType, tableId, items, customerName, customerPhone, customerAddress,
    setOrderType, setTableId, setCustomer, addItem, removeItem, changeQty, clearOrder } = useOrderStore()

  const { createOrder, addItemsToOrder, cancelOrder, markOrderPaying, orders } = useOrdersStore()
  const pushToast = useToastStore(s => s.push)

  const [menu, setMenu]                   = useState<Category[]>([])
  const [tables, setTables]               = useState<PosTable[]>([])
  const [activeCat, setActiveCat]         = useState(0)
  const [selectedDish, setSelectedDish]   = useState<Dish | null>(null)
  const [showTableModal, setShowTableModal] = useState(false)
  const [search, setSearch]               = useState('')
  const [mobileTab, setMobileTab]         = useState<'menu' | 'order'>('menu')

  // Existing order (when navigating from an occupied table)
  const paramOrderId = searchParams.get('orderId')
  const existingOrder: ActiveOrder | undefined = paramOrderId
    ? orders.find(o => o.id === Number(paramOrderId))
    : undefined

  // Fetch menu and tables from API
  useEffect(() => {
    api.get<Category[]>('/menu').then(({ data }) => {
      setMenu(data)
      if (data.length > 0) setActiveCat(data[0].id)
    }).catch(() => {
      pushToast({ variant: 'error', title: 'No se pudo cargar el menú', message: 'Recarga la página o verifica la conexión.' })
    })
    api.get<PosTable[]>('/tables').then(({ data }) => setTables(data)).catch(() => {
      pushToast({ variant: 'error', title: 'No se pudieron cargar las mesas', message: 'Recarga la página.' })
    })
  }, [pushToast])

  // Apply URL params on mount
  useEffect(() => {
    const paramTable    = searchParams.get('table')
    const paramDelivery = searchParams.get('delivery') === 'true'
    if (paramDelivery) {
      setOrderType('delivery')
      setTableId(null)
    } else if (paramTable) {
      setOrderType('dine_in')
      setTableId(Number(paramTable))
    } else {
      clearOrder()
    }
  }, [])

  const selectedTable  = tables.find(t => t.id === tableId)
  const currentCat     = menu.find(c => c.id === activeCat)
  const filteredDishes = useMemo(() => {
    if (!search.trim()) return currentCat?.dishes ?? []
    const q = search.toLowerCase()
    return menu.flatMap(c => c.dishes).filter(d => d.name.toLowerCase().includes(q))
  }, [currentCat, search, menu])

  // Show existing order items if viewing an occupied table
  const displayItems   = existingOrder ? existingOrder.items : items
  const total          = displayItems.reduce((s, i) => s + i.unitPrice * i.quantity, 0)
  const itemsQty       = displayItems.reduce((s, i) => s + i.quantity, 0)
  const isExistingMode = !!existingOrder

  const canSend = !isExistingMode && items.length > 0 && (
    orderType === 'dine_in' ? tableId !== null : customerName.trim() && customerPhone.trim() && customerAddress.trim()
  )
  const canAddToExisting = isExistingMode && items.length > 0

  const handleSend = async () => {
    try {
      await createOrder({
        tableId: orderType === 'dine_in' ? tableId : null,
        type: orderType,
        customerName: customerName || undefined,
        customerPhone: customerPhone || undefined,
        customerAddress: customerAddress || undefined,
        items: items.map(i => ({
          dishId: i.dishId, dishName: i.dishName,
          unitPrice: i.unitPrice, quantity: i.quantity,
          modifiers: i.modifiers, notes: i.notes || undefined,
        })),
      })
      clearOrder()
      navigate('/tables')
    } catch (err: any) {
      pushToast({
        variant: 'error',
        title: 'No se pudo enviar el pedido',
        message: err?.response?.data?.error ?? 'Intenta nuevamente.',
        durationMs: 5000,
      })
    }
  }

  const handleAddToExisting = async () => {
    if (!existingOrder) return
    try {
      await addItemsToOrder(existingOrder.id, items.map(i => ({
        dishId: i.dishId, dishName: i.dishName,
        unitPrice: i.unitPrice, quantity: i.quantity,
        modifiers: i.modifiers, notes: i.notes || undefined,
      })))
      clearOrder()
      navigate('/tables')
    } catch (err: any) {
      pushToast({
        variant: 'error',
        title: 'No se pudieron agregar los items',
        message: err?.response?.data?.error ?? 'Intenta nuevamente.',
        durationMs: 5000,
      })
    }
  }

  const handleCancelOrder = async () => {
    if (!existingOrder) return
    if (confirm('¿Cancelar este pedido? La mesa quedará libre.')) {
      try {
        await cancelOrder(existingOrder.id)
        clearOrder()
        navigate('/tables')
      } catch (err: any) {
        pushToast({
          variant: 'error',
          title: 'No se pudo cancelar el pedido',
          message: err?.response?.data?.error ?? 'Intenta nuevamente.',
          durationMs: 5000,
        })
      }
    }
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Header */}
      <div className="bg-white border-b border-[#E2E8F0] px-5 py-3.5 flex items-center gap-4 shrink-0">
        <button onClick={() => navigate('/tables')}
          className="w-9 h-9 rounded-xl bg-[#EEF3F8] flex items-center justify-center text-[#64748B] hover:bg-[#0077B6] hover:text-white transition-all">
          <ArrowLeft size={18}/>
        </button>
        <h1 className="text-base font-black text-[#0F172A]">
          {isExistingMode
            ? existingOrder?.type === 'delivery' ? `Delivery — ${existingOrder.customerName}` : `Mesa ${selectedTable?.number ?? ''} — Pedido activo`
            : 'Nuevo Pedido'
          }
        </h1>
        {isExistingMode && (
          <button onClick={handleCancelOrder}
            className="ml-auto flex items-center gap-1.5 text-xs text-red-400 hover:text-red-600 bg-red-50 hover:bg-red-100 px-3 py-2 rounded-xl transition-colors">
            <Trash2 size={13}/> Cancelar pedido
          </button>
        )}
      </div>

      <div className="flex-1 flex overflow-hidden">
        {/* Left: Menu */}
        <div className={`flex-1 flex-col overflow-hidden ${mobileTab === 'order' ? 'hidden md:flex' : 'flex'}`}>
          <div className="px-5 pt-4 pb-3 shrink-0">
            <div className="relative">
              <Search size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-[#94A3B8]"/>
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar plato..."
                className="w-full bg-white border border-[#E2E8F0] rounded-xl pl-11 pr-4 py-3 text-sm placeholder-[#94A3B8] focus:outline-none focus:ring-2 focus:ring-[#0077B6]/30 focus:border-[#0077B6] shadow-sm"/>
            </div>
          </div>

          {!search && (
            <div className="flex gap-2 px-5 pb-3 overflow-x-auto shrink-0">
              {menu.map(cat => (
                <button key={cat.id} onClick={() => setActiveCat(cat.id)}
                  className={`shrink-0 text-sm font-semibold px-4 py-2 rounded-xl transition-all ${
                    activeCat === cat.id ? 'bg-[#0077B6] text-white shadow-md' : 'bg-white text-[#64748B] border border-[#E2E8F0] hover:border-[#0077B6]'
                  }`}>
                  {cat.name}
                </button>
              ))}
            </div>
          )}

          <div className="flex-1 overflow-y-auto px-4 md:px-5 pb-20 md:pb-5">
            {isExistingMode && (
              <div className="mb-3 p-3 bg-blue-50 border border-blue-200 rounded-xl text-xs text-blue-700 font-medium">
                Selecciona platos para agregar al pedido existente de {existingOrder?.type === 'delivery' ? existingOrder.customerName : `Mesa ${selectedTable?.number}`}
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              {filteredDishes.map(dish => (
                <button key={dish.id} onClick={() => setSelectedDish(dish)} disabled={!dish.available}
                  className="bg-white border-2 border-transparent hover:border-[#0077B6] rounded-2xl p-4 text-left transition-all shadow-sm hover:shadow-md disabled:opacity-40 active:scale-95">
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <p className="text-sm font-bold text-[#0F172A] leading-snug">{dish.name}</p>
                    {dish.hasSpiceLevel && <span className="shrink-0 w-6 h-6 rounded-lg bg-orange-50 flex items-center justify-center"><Flame size={13} className="text-[#F4792B]"/></span>}
                  </div>
                  {dish.description && <p className="text-xs text-[#94A3B8] mb-3 line-clamp-2">{dish.description}</p>}
                  <p className="text-xl font-black text-[#F4792B]">S/ {dish.price.toFixed(2)}</p>
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Botón flotante móvil — ver pedido */}
        {mobileTab === 'menu' && (
          <div className="md:hidden fixed bottom-16 inset-x-0 px-4 z-40">
            <button
              onClick={() => setMobileTab('order')}
              className="w-full flex items-center justify-between bg-[#0077B6] text-white rounded-2xl px-5 py-3.5 shadow-xl shadow-[#0077B6]/30"
            >
              <div className="flex items-center gap-2">
                <span className="bg-white text-[#0077B6] text-xs font-black w-6 h-6 rounded-full flex items-center justify-center">
                  {itemsQty}
                </span>
                <span className="font-semibold text-sm">
                  {itemsQty === 0 ? 'Ver pedido' : `${itemsQty} item${itemsQty !== 1 ? 's' : ''}`}
                </span>
              </div>
              <span className="font-black">S/ {total.toFixed(2)} →</span>
            </button>
          </div>
        )}

        {/* Right: Order panel */}
        <div className={`flex-col bg-white border-l border-[#E2E8F0] shrink-0 w-full md:w-80 ${mobileTab === 'menu' ? 'hidden md:flex' : 'flex'}`}>
          {/* Order type + assignment (only for new orders) */}
          {!isExistingMode && (
            <div className="px-4 pt-4 pb-3 border-b border-[#E2E8F0] space-y-3 shrink-0">
              <div className="flex bg-[#EEF3F8] rounded-xl p-1 gap-1">
                <button onClick={() => setOrderType('dine_in')}
                  className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-lg text-sm font-bold transition-all ${orderType === 'dine_in' ? 'bg-white text-[#0077B6] shadow-sm' : 'text-[#64748B]'}`}>
                  <LayoutGrid size={14}/> Mesa
                </button>
                <button onClick={() => setOrderType('delivery')}
                  className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-lg text-sm font-bold transition-all ${orderType === 'delivery' ? 'bg-[#F4792B] text-white shadow-sm' : 'text-[#64748B]'}`}>
                  <Bike size={14}/> Delivery
                </button>
              </div>

              {orderType === 'dine_in' && (
                <button onClick={() => setShowTableModal(true)}
                  className={`w-full flex items-center justify-between px-4 py-3 rounded-xl border-2 text-sm font-semibold transition-all ${
                    tableId ? 'bg-blue-50 border-blue-200 text-blue-700' : 'bg-[#EEF3F8] border-[#E2E8F0] text-[#94A3B8] hover:border-[#0077B6]'
                  }`}>
                  <div className="flex items-center gap-2"><LayoutGrid size={15}/>
                    {tableId ? `Mesa ${selectedTable?.number} · ${selectedTable?.area}` : 'Seleccionar mesa'}
                  </div>
                  <ChevronDown size={15}/>
                </button>
              )}

              {orderType === 'delivery' && (
                <div className="space-y-2">
                  {[
                    { val: customerName,    fn: (v: string) => setCustomer(v, customerPhone, customerAddress),  ph: 'Nombre del cliente *', inputMode: undefined,  type: 'text' as const },
                    { val: customerPhone,   fn: (v: string) => setCustomer(customerName, v, customerAddress),   ph: 'Teléfono *',           inputMode: 'tel' as const, type: 'tel' as const  },
                    { val: customerAddress, fn: (v: string) => setCustomer(customerName, customerPhone, v),     ph: 'Dirección de entrega *', inputMode: undefined, type: 'text' as const },
                  ].map(({ val, fn, ph, inputMode, type }) => (
                    <input key={ph} value={val} onChange={e => fn(e.target.value)} placeholder={ph}
                      type={type} inputMode={inputMode} autoComplete={type === 'tel' ? 'tel' : 'off'}
                      className="w-full bg-[#EEF3F8] rounded-xl px-3 py-2.5 text-sm placeholder-[#94A3B8] focus:outline-none focus:ring-2 focus:ring-[#F4792B]/30 border border-transparent focus:border-[#F4792B]"/>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Volver al menú — solo móvil */}
          {mobileTab === 'order' && (
            <button
              onClick={() => setMobileTab('menu')}
              className="md:hidden flex items-center gap-2 px-4 py-3 border-b border-[#E2E8F0] text-sm font-semibold text-[#0077B6] w-full bg-white shrink-0"
            >
              <ArrowLeft size={16} /> Volver al menú
            </button>
          )}

          {/* Items header */}
          <div className="px-4 py-3 border-b border-[#E2E8F0] shrink-0 flex items-center justify-between">
            <p className="text-xs font-bold text-[#64748B] uppercase tracking-wider">
              {isExistingMode ? 'Pedido actual' : 'Nuevo pedido'}
              {itemsQty > 0 && <span className="text-[#0077B6] ml-1">· {itemsQty} items</span>}
            </p>
            {!isExistingMode && items.length > 0 && (
              <button onClick={clearOrder} className="text-xs text-red-400 hover:text-red-600">Limpiar</button>
            )}
          </div>

          {/* Items */}
          <div className="flex-1 overflow-y-auto p-4 space-y-2">
            {displayItems.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-center pb-8">
                <div className="w-16 h-16 rounded-2xl bg-[#EEF3F8] flex items-center justify-center mb-3"><span className="text-3xl">🍽️</span></div>
                <p className="text-sm font-semibold text-[#64748B]">Sin platos aún</p>
                <p className="text-xs text-[#94A3B8] mt-1">Selecciona del menú</p>
              </div>
            ) : isExistingMode ? (
              (displayItems as ActiveOrder['items']).map(item => (
                <div key={item.id} className="bg-[#EEF3F8] rounded-xl p-3">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-bold text-[#0F172A]">
                      {item.quantity > 1 && <span className="text-[#F4792B] mr-1">×{item.quantity}</span>}
                      {item.dishName}
                    </p>
                    <span className="text-sm font-black text-[#0077B6]">S/ {(item.unitPrice*item.quantity).toFixed(2)}</span>
                  </div>
                  {item.modifiers.find(m=>m.optionName) && (
                    <p className="text-xs text-[#F4792B] mt-0.5 flex items-center gap-1"><Flame size={10}/>{item.modifiers.find(m=>m.optionName)?.optionName}</p>
                  )}
                  <span className={`text-xs px-2 py-0.5 rounded-full mt-1 inline-block ${
                    item.status === 'ready' ? 'bg-emerald-100 text-emerald-700' :
                    item.status === 'preparing' ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-600'
                  }`}>{item.status === 'ready' ? 'Listo' : item.status === 'preparing' ? 'Preparando' : 'Pendiente'}</span>
                </div>
              ))
            ) : (
              (displayItems as OrderItem[]).map(item => (
                <OrderItemRow key={item.id} item={item}
                  onRemove={() => removeItem(item.id)}
                  onQtyChange={d => changeQty(item.id, d)}
                />
              ))
            )}
            {/* New items being added to existing order */}
            {isExistingMode && items.length > 0 && (
              <div className="border-t border-dashed border-[#E2E8F0] pt-3 space-y-2">
                <p className="text-xs font-bold text-[#0077B6] uppercase tracking-wide">Agregar al pedido:</p>
                {items.map(item => (
                  <OrderItemRow key={item.id} item={item}
                    onRemove={() => removeItem(item.id)}
                    onQtyChange={d => changeQty(item.id, d)}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Total & actions */}
          <div className="border-t border-[#E2E8F0] p-4 space-y-3 shrink-0">
            <div className="flex items-center justify-between bg-[#EEF3F8] rounded-xl px-4 py-3">
              <span className="text-sm font-semibold text-[#64748B]">Total</span>
              <span className="text-2xl font-black text-[#0F172A]">S/ {total.toFixed(2)}</span>
            </div>

            {!isExistingMode && !canSend && items.length > 0 && (
              <p className="text-xs text-amber-600 text-center">
                {orderType === 'dine_in' ? '⚠ Selecciona una mesa' : '⚠ Completa los datos del cliente'}
              </p>
            )}

            {!isExistingMode && (
              <button onClick={handleSend} disabled={!canSend}
                className="w-full flex items-center justify-center gap-2 font-bold py-4 rounded-xl text-white text-sm disabled:opacity-40 shadow-md"
                style={{ background: 'linear-gradient(135deg,#0077B6,#004E86)' }}>
                <Send size={15}/> Enviar a Cocina
              </button>
            )}

            {isExistingMode && canAddToExisting && (
              <button onClick={handleAddToExisting}
                className="w-full flex items-center justify-center gap-2 font-bold py-4 rounded-xl text-white text-sm shadow-md"
                style={{ background: 'linear-gradient(135deg,#0077B6,#004E86)' }}>
                <Send size={15}/> Agregar a pedido existente
              </button>
            )}

            {isExistingMode && (
              <button onClick={() => {
                const oid = existingOrder?.id
                if (oid) { markOrderPaying(oid); clearOrder(); navigate(`/cash?orderId=${oid}`) }
              }}
                className="w-full flex items-center justify-center gap-2 border-2 border-emerald-500 text-emerald-600 hover:bg-emerald-50 font-bold py-3.5 rounded-xl transition-colors text-sm">
                <CreditCard size={15}/> Cobrar S/ {total.toFixed(2)}
              </button>
            )}
          </div>
        </div>
      </div>

      {showTableModal && <TableSelectorModal tables={tables} current={tableId} onSelect={setTableId} onClose={() => setShowTableModal(false)}/>}
      {selectedDish && <ModifierModal dish={selectedDish} onConfirm={addItem} onClose={() => setSelectedDish(null)}/>}
    </div>
  )
}
