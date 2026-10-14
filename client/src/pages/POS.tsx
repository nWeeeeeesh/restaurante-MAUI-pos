import { useState, useMemo, useEffect, useRef, useCallback } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { useOrderStore, draftUnitPrice } from '../store/order'
import { useOrdersStore, type ActiveOrder, type ItemPayload } from '../store/orders'
import type { Category, Dish, OrderItem, SelectedModifier, TableStatus } from '../types'
import api from '../api/client'
import { socket } from '../api/socket'
import { useToastStore } from '../store/toast'
import { useAuthStore } from '../store/auth'
import { ConfirmDialog } from '../components/ConfirmDialog'
import {
  ArrowLeft, Search, Flame, Plus, Minus, X,
  Send, CreditCard, Bike, LayoutGrid, ChevronDown, Trash2, Loader2, Printer, Ban,
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
function ModifierModal({ dish, onConfirm, onClose, onLostSale, onSoldOut }: {
  dish: Dish; onConfirm: (item: Omit<OrderItem, 'id' | 'status'>) => void; onClose: () => void
  // Cocina avisa que se acabó aunque el plato figure disponible
  onLostSale: () => void
  // Solo cajero, encargado y dueño: marcar agotado desde aquí, sin ir a Menú
  onSoldOut?: () => void
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
    onConfirm({ dishId: dish.id, dishName: dish.name, unitPrice: draftUnitPrice(dish, modifiers), quantity: qty, modifiers, notes })
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
              {/* Opcional: el plan v2 no agrega pasos obligatorios al mozo */}
              <div className="mt-2 flex flex-wrap gap-2">
                <button onClick={onLostSale} title="Opcional: anota que lo pidieron y no había"
                  className="inline-flex items-center gap-1.5 text-xs font-bold text-[#F4792B] bg-orange-50 hover:bg-orange-100 px-2.5 py-1.5 rounded-lg transition-colors">
                  <Ban size={12}/> No había <span className="font-medium text-[#F4792B]/70">(opcional)</span>
                </button>
                {onSoldOut && (
                  <button onClick={onSoldOut}
                    className="inline-flex items-center gap-1.5 text-xs font-bold text-red-600 bg-red-50 hover:bg-red-100 px-2.5 py-1.5 rounded-lg transition-colors">
                    Se agotó
                  </button>
                )}
              </div>
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
    setOrderType, setTableId, setCustomer, addItem, removeItem, removeDishes, changeQty, clearOrder,
    syncWithMenu } = useOrderStore()

  const { createOrder, addItemsToOrder, cancelOrder, markOrderPaying, reprintKitchen, orders } = useOrdersStore()
  const pushToast = useToastStore(s => s.push)
  const [lostSending, setLostSending] = useState<number | null>(null)

  // "Pidieron X y no había": un toque desde el plato agotado o el detalle del
  // plato; alimenta la medición de ventas perdidas del inventario.
  const reportLostSale = async (dish: Dish) => {
    setLostSending(dish.id)
    try {
      await api.post('/inventory/lost-sales', { dishId: dish.id })
      pushToast({ variant: 'success', title: 'Anotado: no había', message: dish.name })
    } catch (err) {
      const message = (err as { response?: { data?: { error?: string } } })?.response?.data?.error
      pushToast({ variant: 'error', title: 'No se pudo anotar', message: message ?? 'Intenta nuevamente.' })
    } finally {
      setLostSending(null)
    }
  }
  const role = useAuthStore(s => s.user?.role)
  // Matriz de permisos (plan v1.1 §2): el servidor es quien realmente decide.
  const canCancel = role === 'owner' || role === 'manager' || role === 'cashier'
  const canCharge = canCancel
  // Plan inventario v2.1: quien se entera primero en el salón marca agotado desde el POS
  const canMarkSoldOut = canCancel
  const [availabilitySending, setAvailabilitySending] = useState<number | null>(null)
  const [cancelOpen, setCancelOpen]     = useState(false)
  const [cancelReason, setCancelReason] = useState('')
  const [cancelling, setCancelling]     = useState(false)
  const [sending, setSending]           = useState(false)
  const [reprinting, setReprinting]     = useState(false)

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
      // El borrador puede venir de horas atrás (localStorage): alinear con el menú vigente.
      const { removed, repriced } = syncWithMenu(data)
      if (removed.length > 0) {
        pushToast({ variant: 'warning', title: 'Se quitaron platos no disponibles', message: removed.join(', '), durationMs: 6000 })
      } else if (repriced) {
        pushToast({ variant: 'info', title: 'Precios del pedido actualizados' })
      }
    }).catch(() => {
      pushToast({ variant: 'error', title: 'No se pudo cargar el menú', message: 'Recarga la página o verifica la conexión.' })
    })
    api.get<PosTable[]>('/tables').then(({ data }) => setTables(data)).catch(() => {
      pushToast({ variant: 'error', title: 'No se pudieron cargar las mesas', message: 'Recarga la página.' })
    })
  }, [pushToast, syncWithMenu])

  // Disponibilidad en vivo: cuando alguien marca agotado o habilita un plato, todos los
  // POS se actualizan sin recargar. Si el plato estaba en el borrador se quita, igual
  // que al cargar el menú (el servidor lo rechazaría al enviar).
  const menuRef = useRef<Category[]>([])
  useEffect(() => { menuRef.current = menu }, [menu])
  const applyAvailability = useCallback((dishId: number, available: boolean) => {
    const next = menuRef.current.map(c => ({ ...c, dishes: c.dishes.map(d => (d.id === dishId ? { ...d, available } : d)) }))
    menuRef.current = next
    setMenu(next)
    if (!available) {
      const { removed } = syncWithMenu(next)
      if (removed.length > 0) {
        pushToast({ variant: 'warning', title: 'Se agotó y se quitó del pedido', message: removed.join(', '), durationMs: 6000 })
      }
    }
  }, [syncWithMenu, pushToast])
  useEffect(() => {
    const onAvailability = ({ dishId, available }: { dishId: number; available: boolean }) => applyAvailability(dishId, available)
    socket.on('menu:availability', onAvailability)
    return () => { socket.off('menu:availability', onAvailability) }
  }, [applyAvailability])

  const setDishAvailability = async (dish: Dish, available: boolean) => {
    setAvailabilitySending(dish.id)
    try {
      await api.patch(`/menu/dishes/${dish.id}/availability`, { available })
      applyAvailability(dish.id, available)
      pushToast({ variant: 'success', title: available ? `${dish.name}: disponible` : `${dish.name}: agotado` })
    } catch (err) {
      const message = (err as { response?: { data?: { error?: string } } })?.response?.data?.error
      pushToast({ variant: 'error', title: 'No se pudo actualizar', message: message ?? 'Intenta nuevamente.' })
    } finally {
      setAvailabilitySending(null)
    }
  }

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
  const hasPayments    = !!existingOrder?.items.some(i => i.billId)
  const unprintedCount = existingOrder?.items.filter(i => !i.kitchenPrinted && !i.billId).length ?? 0
  const pendingTotal   = existingOrder
    ? existingOrder.items.filter(i => !i.billId).reduce((s, i) => s + i.unitPrice * i.quantity, 0)
    : total

  const canSend = !isExistingMode && items.length > 0 && (
    orderType === 'dine_in' ? tableId !== null : customerName.trim() && customerPhone.trim() && customerAddress.trim()
  )
  const canAddToExisting = isExistingMode && items.length > 0

  // Solo se envía qué plato, cuántos y qué opciones: el servidor pone nombre y precio.
  const toPayload = (list: OrderItem[]): ItemPayload[] => list.map(i => ({
    dishId: i.dishId,
    quantity: i.quantity,
    modifiers: i.modifiers.map(m => ({ groupId: m.groupId, optionId: m.optionId, freeText: m.freeText })),
    notes: i.notes || undefined,
  }))

  const handleSendError = (err: any, title: string) => {
    const data = err?.response?.data
    if (data?.code === 'DISH_UNAVAILABLE') {
      // Se agotó algo entre que se armó el pedido y se envió: se quita del borrador
      // y el mozo revisa antes de reenviar.
      const dishes: Array<{ dishId: number; name: string }> = data.details?.dishes ?? []
      removeDishes(dishes.map(d => d.dishId))
      pushToast({
        variant: 'warning',
        title: 'Platos no disponibles',
        message: `Se quitaron del pedido: ${dishes.map(d => d.name).join(', ')}. Revisa y vuelve a enviar.`,
        durationMs: 7000,
      })
      return
    }
    pushToast({ variant: 'error', title, message: data?.error ?? 'Intenta nuevamente.', durationMs: 5000 })
  }

  // TD-04: un doble toque en el celular enviaba dos veces (pedidos, ítems y
  // comandas duplicados). Mientras hay un envío en curso, se ignoran los demás.
  const handleSend = async () => {
    if (sending) return
    setSending(true)
    try {
      await createOrder({
        tableId: orderType === 'dine_in' ? tableId : null,
        type: orderType,
        customerName: customerName || undefined,
        customerPhone: customerPhone || undefined,
        customerAddress: customerAddress || undefined,
        items: toPayload(items),
      })
      clearOrder()
      navigate('/tables')
    } catch (err: any) {
      handleSendError(err, 'No se pudo enviar el pedido')
    } finally {
      setSending(false)
    }
  }

  const handleAddToExisting = async () => {
    if (!existingOrder || sending) return
    setSending(true)
    try {
      await addItemsToOrder(existingOrder.id, toPayload(items))
      clearOrder()
      navigate('/tables')
    } catch (err: any) {
      handleSendError(err, 'No se pudieron agregar los items')
    } finally {
      setSending(false)
    }
  }

  // El resultado (ok o falla) lo informa el toast de kitchen:print-result por socket;
  // aquí solo se avisan errores que no pasan por la impresora (p. ej., 400/404).
  const handleReprint = async (onlyUnprinted: boolean) => {
    if (!existingOrder || reprinting) return
    setReprinting(true)
    try {
      await reprintKitchen(existingOrder.id, onlyUnprinted)
    } catch (err: any) {
      if (err?.response?.status !== 502) {
        pushToast({ variant: 'error', title: 'No se pudo reimprimir', message: err?.response?.data?.error ?? 'Intenta nuevamente.' })
      }
    } finally {
      setReprinting(false)
    }
  }

  // Cancelar requiere motivo; el servidor decide si el rol puede (D1: con cobros,
  // solo encargado o dueño) y lo deja registrado.
  const confirmCancelOrder = async () => {
    if (!existingOrder) return
    setCancelling(true)
    try {
      await cancelOrder(existingOrder.id, cancelReason.trim())
      setCancelOpen(false)
      clearOrder()
      pushToast({ variant: 'success', title: 'Pedido cancelado' })
      navigate('/tables')
    } catch (err: any) {
      pushToast({
        variant: 'error',
        title: 'No se pudo cancelar el pedido',
        message: err?.response?.data?.error ?? 'Intenta nuevamente.',
        durationMs: 6000,
      })
    } finally {
      setCancelling(false)
    }
  }

  // D2: el mozo "pide la cuenta" (marca por cobrar y vuelve a Mesas); quien cobra
  // marca y pasa directo a Caja.
  const handleRequestBill = async () => {
    const oid = existingOrder?.id
    if (!oid) return
    try {
      await markOrderPaying(oid)
      clearOrder()
      if (canCharge) {
        navigate(`/cash?orderId=${oid}`)
      } else {
        pushToast({ variant: 'success', title: 'Cuenta solicitada', message: 'La mesa quedó "Por cobrar".' })
        navigate('/tables')
      }
    } catch (err: any) {
      pushToast({ variant: 'error', title: 'No se pudo marcar por cobrar', message: err?.response?.data?.error ?? 'Intenta nuevamente.' })
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
        {isExistingMode && canCancel && (
          <button onClick={() => { setCancelReason(''); setCancelOpen(true) }}
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
              {filteredDishes.map(dish => !dish.available ? (
                <div key={dish.id} className="bg-white/60 border-2 border-dashed border-[#E2E8F0] rounded-2xl p-4 flex flex-col">
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <p className="text-sm font-bold text-[#94A3B8] leading-snug">{dish.name}</p>
                    <span className="shrink-0 text-[10px] font-black uppercase tracking-wide text-red-500 bg-red-50 px-1.5 py-0.5 rounded">Agotado</span>
                  </div>
                  <button onClick={() => reportLostSale(dish)} disabled={lostSending === dish.id}
                    className="mt-auto w-full flex items-center justify-center gap-1.5 text-xs font-bold py-2.5 rounded-xl bg-orange-50 text-[#F4792B] hover:bg-orange-100 disabled:opacity-50 active:scale-95 transition-all">
                    {lostSending === dish.id ? <Loader2 size={13} className="animate-spin"/> : <Ban size={13}/>} No había
                  </button>
                  <p className="mt-1 text-[10px] text-center text-[#94A3B8]">Opcional · si alguien lo pidió</p>
                  {canMarkSoldOut && (
                    <button onClick={() => setDishAvailability(dish, true)} disabled={availabilitySending === dish.id}
                      className="mt-2 w-full text-xs font-bold py-2 rounded-xl text-emerald-700 bg-emerald-50 hover:bg-emerald-100 disabled:opacity-50">
                      {availabilitySending === dish.id ? 'Habilitando…' : 'Habilitar'}
                    </button>
                  )}
                </div>
              ) : (
                <button key={dish.id} onClick={() => setSelectedDish(dish)}
                  className="bg-white border-2 border-transparent hover:border-[#0077B6] rounded-2xl p-4 text-left transition-all shadow-sm hover:shadow-md active:scale-95">
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
                  {/* Sin pantalla de cocina, lo útil es saber si el plato llegó a la comanda */}
                  <span className={`text-xs px-2 py-0.5 rounded-full mt-1 inline-block ${
                    item.billId ? 'bg-emerald-100 text-emerald-700' :
                    item.kitchenPrinted ? 'bg-gray-100 text-gray-600' : 'bg-red-100 text-red-700'
                  }`}>{item.billId ? 'Cobrado' : item.kitchenPrinted ? 'En cocina' : 'Sin comanda'}</span>
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

          {/* Comanda: aviso si algo no llegó a cocina (TD-17) y reimpresión manual */}
          {isExistingMode && (
            <div className="px-4 pt-3 shrink-0 space-y-2">
              {unprintedCount > 0 && (
                <div className="bg-red-50 border border-red-200 rounded-xl px-3 py-2 flex items-center justify-between gap-2">
                  <p className="text-xs text-red-700 font-semibold">
                    {unprintedCount} plato{unprintedCount !== 1 ? 's' : ''} no llegaron a cocina
                  </p>
                  <button onClick={() => handleReprint(true)} disabled={reprinting}
                    className="text-xs font-bold text-white bg-red-500 hover:bg-red-600 px-3 py-1.5 rounded-lg disabled:opacity-50 flex items-center gap-1 shrink-0">
                    {reprinting ? <Loader2 size={12} className="animate-spin"/> : <Printer size={12}/>} Reintentar
                  </button>
                </div>
              )}
              <button onClick={() => handleReprint(false)} disabled={reprinting}
                className="w-full text-xs font-semibold text-[#64748B] hover:text-[#0077B6] flex items-center justify-center gap-1.5 py-1 disabled:opacity-50">
                <Printer size={12}/> Reimprimir comanda completa
              </button>
            </div>
          )}

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
              <button onClick={handleSend} disabled={!canSend || sending}
                className="w-full flex items-center justify-center gap-2 font-bold py-4 rounded-xl text-white text-sm disabled:opacity-40 shadow-md"
                style={{ background: 'linear-gradient(135deg,#0077B6,#004E86)' }}>
                {sending ? <Loader2 size={15} className="animate-spin"/> : <Send size={15}/>}
                {sending ? 'Enviando...' : 'Enviar a Cocina'}
              </button>
            )}

            {isExistingMode && canAddToExisting && (
              <button onClick={handleAddToExisting} disabled={sending}
                className="w-full flex items-center justify-center gap-2 font-bold py-4 rounded-xl text-white text-sm disabled:opacity-40 shadow-md"
                style={{ background: 'linear-gradient(135deg,#0077B6,#004E86)' }}>
                {sending ? <Loader2 size={15} className="animate-spin"/> : <Send size={15}/>}
                {sending ? 'Enviando...' : 'Agregar a pedido existente'}
              </button>
            )}

            {isExistingMode && (
              <button onClick={handleRequestBill}
                className="w-full flex items-center justify-center gap-2 border-2 border-emerald-500 text-emerald-600 hover:bg-emerald-50 font-bold py-3.5 rounded-xl transition-colors text-sm">
                <CreditCard size={15}/> {canCharge ? 'Cobrar' : 'Pedir cuenta'} S/ {pendingTotal.toFixed(2)}
              </button>
            )}
          </div>
        </div>
      </div>

      {showTableModal && <TableSelectorModal tables={tables} current={tableId} onSelect={setTableId} onClose={() => setShowTableModal(false)}/>}
      {selectedDish && <ModifierModal dish={selectedDish} onConfirm={addItem} onClose={() => setSelectedDish(null)}
        onLostSale={() => { reportLostSale(selectedDish); setSelectedDish(null) }}
        onSoldOut={canMarkSoldOut ? () => { setDishAvailability(selectedDish, false); setSelectedDish(null) } : undefined}/>}
      <ConfirmDialog
        open={cancelOpen}
        title="Cancelar pedido"
        message={hasPayments
          ? 'Este pedido ya tiene cobros. Las boletas emitidas se mantienen; lo no cobrado queda registrado como pérdida.'
          : 'La mesa quedará libre. Esta acción queda registrada.'}
        confirmLabel="Cancelar pedido"
        cancelLabel="Volver"
        loading={cancelling}
        confirmDisabled={cancelReason.trim().length < 3}
        onConfirm={confirmCancelOrder}
        onCancel={() => setCancelOpen(false)}
      >
        <label className="text-xs font-bold text-[#64748B] uppercase tracking-wider mb-1.5 block">Motivo</label>
        <textarea value={cancelReason} onChange={e => setCancelReason(e.target.value)} rows={2} maxLength={200}
          placeholder="ej: mesa equivocada, cliente se retiró..."
          className="w-full bg-[#EEF3F8] rounded-xl px-3 py-2.5 text-sm placeholder-[#94A3B8] focus:outline-none focus:ring-2 focus:ring-red-300 border border-transparent focus:border-red-300 resize-none"/>
      </ConfirmDialog>
    </div>
  )
}
