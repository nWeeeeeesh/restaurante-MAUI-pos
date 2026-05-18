import { useState, useRef, useEffect, useMemo } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { useOrdersStore, type ActiveOrder, type ActiveOrderItem } from '../store/orders'
import { useReceiptStore } from '../store/receipt'
import { useAuthStore } from '../store/auth'
import { useToastStore } from '../store/toast'
import api from '../api/client'
import {
  Banknote, Smartphone, CreditCard, CheckCircle2,
  Printer, ArrowLeft, Receipt, Bike, LayoutGrid, Loader2,
  FileText, SplitSquareHorizontal, X, Lock, Undo2,
} from 'lucide-react'

type PayMethod = 'cash' | 'yape' | 'plin'

const PAY_CONFIG = {
  cash: { label: 'Efectivo',  icon: Banknote,    color: 'emerald', bg: 'bg-emerald-50', border: 'border-emerald-400', text: 'text-emerald-700', sel: 'bg-emerald-500' },
  yape: { label: 'Yape',     icon: Smartphone,  color: 'purple',  bg: 'bg-purple-50',  border: 'border-purple-400',  text: 'text-purple-700',  sel: 'bg-purple-500' },
  plin: { label: 'Plin',     icon: Smartphone,  color: 'blue',    bg: 'bg-sky-50',     border: 'border-sky-400',     text: 'text-sky-700',     sel: 'bg-sky-500' },
}

// ─── Helpers ────────────────────────────────────────────────────────────────────
const unpaidItems = (order: ActiveOrder): ActiveOrderItem[] =>
  order.items.filter(i => !i.billId)
const itemSubtotal = (i: ActiveOrderItem) => i.unitPrice * i.quantity

// ─── Receipt Modal ─────────────────────────────────────────────────────────────
function ReceiptModal({ order, items, receiptNumber, payMethod, cashReceived, onClose }: {
  order: ActiveOrder
  items: ActiveOrderItem[]
  receiptNumber: string
  payMethod: PayMethod
  cashReceived: number
  onClose: () => void
}) {
  const printRef  = useRef<HTMLDivElement>(null)
  const { user }  = useAuthStore()
  const total     = items.reduce((s, i) => s + i.unitPrice * i.quantity, 0)
  const change    = payMethod === 'cash' ? cashReceived - total : 0
  const date      = new Date().toLocaleString('es-PE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })

  const [printing, setPrinting]       = useState(false)
  const [printOk, setPrintOk]         = useState(false)
  const [finalizing, setFinalizing]   = useState(false)

  const windowPrintFallback = () => {
    const content = printRef.current
    if (!content) return
    const win = window.open('', '_blank', 'width=400,height=600')
    if (!win) return
    win.document.write(`
      <html><head><title>Boleta ${receiptNumber}</title>
      <style>
        body { font-family: monospace; font-size: 12px; margin: 0; padding: 8px; width: 280px; }
        .center { text-align: center; } .bold { font-weight: bold; }
        .line { border-top: 1px dashed #000; margin: 6px 0; }
        .row { display: flex; justify-content: space-between; }
        .big { font-size: 14px; font-weight: bold; }
      </style></head><body>
      ${content.innerHTML}
      </body></html>
    `)
    win.document.close()
    win.print()
    win.close()
  }

  const handlePrint = async () => {
    setPrinting(true)
    try {
      await api.post('/print/receipt', {
        receiptNumber,
        date,
        orderType: order.type === 'delivery' ? 'delivery' : 'dine-in',
        tableId: order.tableId,
        customerName: order.customerName,
        cashierName: user?.name ?? 'Cajero',
        items: items.map(i => ({
          dishName: i.dishName,
          quantity: i.quantity,
          unitPrice: i.unitPrice,
          modifiers: i.modifiers,
        })),
        paymentMethod: payMethod,
        cashReceived: payMethod === 'cash' ? cashReceived : null,
        changeAmount: payMethod === 'cash' ? change : null,
        total,
      })
      setPrintOk(true)
    } catch {
      windowPrintFallback()
    } finally {
      setPrinting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="bg-white rounded-3xl w-full max-w-sm shadow-2xl overflow-hidden max-h-[95vh] flex flex-col">
        {/* Success header */}
        <div className="bg-emerald-500 px-6 py-5 flex items-center gap-3 shrink-0">
          <CheckCircle2 size={28} className="text-white shrink-0" />
          <div>
            <p className="text-white font-black text-lg leading-tight">¡Pago confirmado!</p>
            <p className="text-white/80 text-sm">Boleta {receiptNumber}</p>
          </div>
        </div>

        {/* Receipt preview */}
        <div className="p-5 overflow-y-auto">
          <div ref={printRef} className="bg-[#FAFAF8] border border-[#E2E8F0] rounded-2xl p-4 font-mono text-xs space-y-2">
            <div className="center bold text-sm">CEVICHERÍA MAUI</div>
            <div className="center text-[#64748B]">Tacna, Perú</div>
            <div className="line" />
            <div className="row"><span>Boleta:</span><span className="bold">{receiptNumber}</span></div>
            <div className="row"><span>Fecha:</span><span>{date}</span></div>
            <div className="row">
              <span>{order.type === 'delivery' ? 'Delivery:' : 'Mesa:'}</span>
              <span>{order.type === 'delivery' ? order.customerName : `Mesa ${order.tableId}`}</span>
            </div>
            <div className="line" />
            {items.map(item => (
              <div key={item.id} className="space-y-0.5">
                <div className="row">
                  <span>{item.dishName} x{item.quantity}</span>
                  <span>S/ {(item.unitPrice * item.quantity).toFixed(2)}</span>
                </div>
                {item.modifiers.filter(m => m.optionName).map((m, i) => (
                  <div key={i} className="text-[#64748B] pl-2">  🌶 {m.optionName}</div>
                ))}
                {item.modifiers.filter(m => m.freeText).map((m, i) => (
                  <div key={i} className="text-[#64748B] pl-2">  · {m.freeText}</div>
                ))}
              </div>
            ))}
            <div className="line" />
            <div className="row big"><span>TOTAL:</span><span>S/ {total.toFixed(2)}</span></div>
            <div className="line" />
            <div className="row"><span>Pago:</span><span>{PAY_CONFIG[payMethod].label}</span></div>
            {payMethod === 'cash' && <>
              <div className="row"><span>Recibido:</span><span>S/ {cashReceived.toFixed(2)}</span></div>
              <div className="row bold"><span>Vuelto:</span><span>S/ {change.toFixed(2)}</span></div>
            </>}
            <div className="line" />
            <div className="center text-[#64748B]">¡Gracias por su visita!</div>
            <div className="center text-[#64748B]">Vuelva pronto 🌊</div>
          </div>
        </div>

        <div className="px-5 pb-5 flex gap-3 shrink-0">
          <button onClick={handlePrint} disabled={printing}
            className={`flex-1 flex items-center justify-center gap-2 font-semibold py-3.5 rounded-xl text-sm transition-colors disabled:opacity-60 ${
              printOk
                ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                : 'bg-[#EEF3F8] text-[#64748B] hover:bg-[#E2E8F0]'
            }`}>
            {printing
              ? <Loader2 size={15} className="animate-spin"/>
              : <Printer size={15}/>
            }
            {printing ? 'Imprimiendo...' : printOk ? 'Impreso' : 'Imprimir'}
          </button>
          <button onClick={async () => {
              setFinalizing(true)
              await onClose()
              setFinalizing(false)
            }}
            disabled={finalizing}
            className="flex-1 font-bold py-3.5 rounded-xl text-white text-sm shadow-md disabled:opacity-60 flex items-center justify-center gap-2"
            style={{ background: 'linear-gradient(135deg,#0077B6,#004E86)' }}>
            {finalizing && <Loader2 size={15} className="animate-spin" />}
            {finalizing ? 'Finalizando...' : 'Finalizar'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Split Bill Modal ─────────────────────────────────────────────────────────
type SplitColumn = {
  id: string
  label: string
  itemIds: Set<number>
  billGroupId?: number
  status?: 'open' | 'paid'
}

function SplitBillModal({ order, onClose, onCharge }: {
  order: ActiveOrder
  onClose: () => void
  onCharge: (items: ActiveOrderItem[], billGroupId: number) => void
}) {
  // Considera todos los items (incluso pagados) para mostrar el contexto cuando hay grupos pagados
  const allItems = order.items
  const items = useMemo(() => unpaidItems(order), [order])
  const { saveSplit, deleteSplit } = useOrdersStore()
  const { push: toast } = useToastStore()

  const persistedGroups = order.billGroups ?? []
  const hasPaidGroup = persistedGroups.some(g => g.status === 'paid')
  const paidGroupsCount = persistedGroups.filter(g => g.status === 'paid').length
  const hasPersistedSplit = persistedGroups.length > 0

  // Construye columnas iniciales desde persisted billGroups, o vacías 2x si no hay
  const initialColumns = useMemo<SplitColumn[]>(() => {
    if (persistedGroups.length === 0) {
      return [
        { id: 'A', label: 'Cuenta A', itemIds: new Set() },
        { id: 'B', label: 'Cuenta B', itemIds: new Set() },
      ]
    }
    return persistedGroups.map((g, idx) => ({
      id: String.fromCharCode(65 + idx),
      label: g.label,
      itemIds: new Set(allItems.filter(i => i.billGroupId === g.id).map(i => i.id)),
      billGroupId: g.id,
      status: g.status,
    }))
  }, [order.id, persistedGroups.length, hasPaidGroup])

  const [columns, setColumns] = useState<SplitColumn[]>(initialColumns)
  const [activeCol, setActiveCol] = useState(initialColumns[0]?.id ?? 'A')
  const [saving, setSaving] = useState(false)
  const [undoing, setUndoing] = useState(false)

  // Resync cuando el order cambia desde socket (otro dispositivo cobra un grupo)
  useEffect(() => {
    setColumns(initialColumns)
    setActiveCol(prev => initialColumns.find(c => c.id === prev)?.id ?? initialColumns[0]?.id ?? 'A')
  }, [initialColumns])

  // Items que ya están en un grupo pagado: no se pueden mover ni reasignar
  const lockedItemIds = useMemo(() => {
    const set = new Set<number>()
    for (const c of columns) if (c.status === 'paid') c.itemIds.forEach(id => set.add(id))
    return set
  }, [columns])

  const assignedTo = (itemId: number): string | null => {
    for (const c of columns) if (c.itemIds.has(itemId)) return c.id
    return null
  }

  const toggleAssign = (itemId: number) => {
    if (lockedItemIds.has(itemId)) return
    const activeColumn = columns.find(c => c.id === activeCol)
    if (activeColumn?.status === 'paid') return
    setColumns(cols => {
      const owner = cols.find(c => c.itemIds.has(itemId))?.id ?? null
      return cols.map(c => {
        const next = new Set(c.itemIds)
        if (c.id === activeCol) {
          if (owner === c.id) next.delete(itemId)
          else next.add(itemId)
        } else if (owner === c.id && c.status !== 'paid') {
          next.delete(itemId)
        }
        return { ...c, itemIds: next }
      })
    })
  }

  const moveItem = (itemId: number, toColId: string) => {
    if (lockedItemIds.has(itemId)) return
    const target = columns.find(c => c.id === toColId)
    if (target?.status === 'paid') return
    setColumns(cols => cols.map(c => {
      const next = new Set(c.itemIds)
      if (c.id === toColId) next.add(itemId)
      else if (c.status !== 'paid') next.delete(itemId)
      return { ...c, itemIds: next }
    }))
  }

  const addColumn = () => {
    if (columns.length >= 6) return
    const next = String.fromCharCode(65 + columns.length)
    setColumns([...columns, { id: next, label: `Cuenta ${next}`, itemIds: new Set() }])
  }

  const removeColumn = (id: string) => {
    const col = columns.find(c => c.id === id)
    if (col?.status === 'paid') return
    // Necesitamos al menos 1 columna abierta restante (las pagadas no cuentan para edición)
    const openCount = columns.filter(c => c.status !== 'paid').length
    if (openCount <= 1) return
    setColumns(cols => cols.filter(c => c.id !== id))
    if (activeCol === id) {
      const fallback = columns.find(c => c.id !== id && c.status !== 'paid')
      setActiveCol(fallback?.id ?? columns[0].id)
    }
  }

  const colTotal = (col: SplitColumn) =>
    allItems.filter(i => col.itemIds.has(i.id)).reduce((s, i) => s + itemSubtotal(i), 0)

  const unassigned = items.filter(i => !assignedTo(i.id))
  const totalOrder = items.reduce((s, i) => s + itemSubtotal(i), 0)

  // Firma de la división local vs persistida — para saber si hay cambios sin guardar
  const localSig = useMemo(() => columns
    .filter(c => c.itemIds.size > 0 && c.status !== 'paid')
    .map(c => `${c.label}:${[...c.itemIds].sort((a, b) => a - b).join(',')}`)
    .join('|'), [columns])

  const savedSig = useMemo(() => persistedGroups
    .filter(g => g.status !== 'paid')
    .map(g => `${g.label}:${allItems.filter(i => i.billGroupId === g.id).map(i => i.id).sort((a, b) => a - b).join(',')}`)
    .join('|'), [persistedGroups, allItems])

  const isDirty = localSig !== savedSig

  const handleUndo = async () => {
    if (!hasPersistedSplit) return
    setUndoing(true)
    try {
      await deleteSplit(order.id)
      toast({
        variant: 'success',
        title: hasPaidGroup ? 'Sub-cuentas abiertas deshechas' : 'División deshecha',
        message: hasPaidGroup ? 'Las sub-cuentas ya cobradas se conservan.' : undefined,
      })
      onClose()
    } catch (e: any) {
      toast({ variant: 'error', title: 'No se pudo deshacer', message: e?.response?.data?.error ?? 'Error de servidor' })
    } finally {
      setUndoing(false)
    }
  }

  const handleChargeColumn = async (col: SplitColumn) => {
    if (col.status === 'paid') return
    const colItems = allItems.filter(i => col.itemIds.has(i.id) && !i.billId)
    if (colItems.length === 0) return

    // Si no hay cambios desde lo guardado y la columna ya tiene billGroupId, cobramos directo
    if (!isDirty && col.billGroupId != null) {
      onCharge(colItems, col.billGroupId)
      return
    }

    // Hay cambios o la división aún no se persistió — guardar primero
    const nonEmpty = columns.filter(c => c.itemIds.size > 0 && c.status !== 'paid')
    // Si nunca hubo división persistida, se requieren al menos 2 grupos.
    // Si ya hay cobrados, basta 1 abierto (puede ser el último).
    const minRequired = paidGroupsCount > 0 ? 1 : 2
    if (nonEmpty.length < minRequired) {
      toast({
        variant: 'warning',
        title: minRequired === 2 ? 'Necesitas al menos 2 sub-cuentas con platos' : 'Asigna platos a la sub-cuenta antes de cobrar',
      })
      return
    }
    setSaving(true)
    try {
      const updated = await saveSplit(order.id, nonEmpty.map(c => ({
        label: c.label,
        itemIds: [...c.itemIds],
      })))
      // Buscar el billGroupId correspondiente a la columna que se está cobrando.
      // Después de saveSplit, los grupos abiertos en updated.billGroups están en el mismo orden
      // de creación que enviamos (el backend preserva los pagados al inicio del listado).
      const openInUpdated = (updated.billGroups ?? []).filter(g => g.status === 'open')
      const colIndex = nonEmpty.findIndex(c => c.id === col.id)
      const billGroupId = openInUpdated[colIndex]?.id
      if (billGroupId == null) {
        toast({ variant: 'error', title: 'No se pudo identificar la sub-cuenta' })
        return
      }
      onCharge(colItems, billGroupId)
    } catch (e: any) {
      toast({ variant: 'error', title: 'No se pudo guardar la división', message: e?.response?.data?.error ?? 'Error de servidor' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[55] flex items-stretch sm:items-center justify-center p-0 sm:p-4 bg-black/60 backdrop-blur-sm">
      <div className="bg-white sm:rounded-3xl w-full max-w-3xl shadow-2xl flex flex-col h-full sm:max-h-[92vh]"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
        {/* Header */}
        <div className="px-5 py-4 border-b border-[#E2E8F0] flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-[#0077B6] flex items-center justify-center shrink-0">
              <SplitSquareHorizontal size={18} className="text-white"/>
            </div>
            <div className="min-w-0">
              <h3 className="font-black text-[#0F172A] text-lg leading-tight truncate">Dividir cuenta</h3>
              <p className="text-xs text-[#64748B]">
                {order.type === 'delivery' ? order.customerName : `Mesa ${order.tableId}`} · Total S/ {totalOrder.toFixed(2)}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="w-9 h-9 rounded-xl bg-[#EEF3F8] hover:bg-[#E2E8F0] flex items-center justify-center shrink-0">
            <X size={16}/>
          </button>
        </div>

        {/* Helper banner */}
        {hasPaidGroup ? (
          <div className="px-5 py-2.5 bg-amber-50 border-b border-amber-100 text-xs text-amber-800 font-medium shrink-0 flex items-center justify-between gap-2">
            <span className="flex items-center gap-2">
              <Lock size={13}/>
              {paidGroupsCount === 1
                ? '1 sub-cuenta ya cobrada — sus platos están bloqueados, los demás siguen editables.'
                : `${paidGroupsCount} sub-cuentas ya cobradas — sus platos están bloqueados, los demás siguen editables.`}
            </span>
            {hasPersistedSplit && (
              <button onClick={handleUndo} disabled={undoing}
                className="flex items-center gap-1.5 text-amber-700 hover:text-amber-900 font-bold whitespace-nowrap disabled:opacity-50">
                {undoing ? <Loader2 size={12} className="animate-spin"/> : <Undo2 size={12}/>}
                Deshacer abiertas
              </button>
            )}
          </div>
        ) : (
          <div className="px-5 py-2.5 bg-blue-50 border-b border-blue-100 text-xs text-blue-700 font-medium shrink-0 flex items-center justify-between gap-2">
            <span>Selecciona una cuenta y toca los platos para asignarlos. Cada cuenta se cobra independientemente.</span>
            {hasPersistedSplit && (
              <button onClick={handleUndo} disabled={undoing}
                className="flex items-center gap-1.5 text-blue-700 hover:text-blue-900 font-bold whitespace-nowrap disabled:opacity-50">
                {undoing ? <Loader2 size={12} className="animate-spin"/> : <Undo2 size={12}/>}
                Deshacer división
              </button>
            )}
          </div>
        )}

        <div className="flex-1 overflow-hidden flex flex-col lg:flex-row">
          {/* Items list */}
          <div className="flex-1 overflow-y-auto p-4 lg:p-5 lg:border-r border-[#E2E8F0]">
            <p className="text-xs font-bold text-[#64748B] uppercase tracking-wider mb-3">
              Platos del pedido · {unassigned.length} sin asignar
            </p>
            <div className="space-y-2">
              {items.map(item => {
                const owner = assignedTo(item.id)
                const isOwnedByActive = owner === activeCol
                const isItemLocked = lockedItemIds.has(item.id)
                const colColors: Record<string, string> = {
                  A: 'bg-emerald-100 text-emerald-700 border-emerald-300',
                  B: 'bg-purple-100 text-purple-700 border-purple-300',
                  C: 'bg-amber-100 text-amber-700 border-amber-300',
                  D: 'bg-pink-100 text-pink-700 border-pink-300',
                  E: 'bg-cyan-100 text-cyan-700 border-cyan-300',
                  F: 'bg-rose-100 text-rose-700 border-rose-300',
                }
                const disabled = isItemLocked
                return (
                  <button key={item.id} onClick={() => toggleAssign(item.id)} disabled={disabled}
                    className={`w-full text-left p-3 rounded-xl border-2 transition-all flex items-center gap-3 ${
                      disabled ? 'cursor-not-allowed' : ''
                    } ${
                      isOwnedByActive
                        ? `${colColors[activeCol] ?? 'bg-blue-100 border-blue-300'} ring-2 ring-offset-1 ring-[#0077B6]/30`
                        : owner
                          ? `${colColors[owner] ?? 'bg-gray-100 border-gray-300'} ${isItemLocked ? 'opacity-70' : 'opacity-90'}`
                          : 'bg-white border-[#E2E8F0] hover:border-[#0077B6]/50'
                    }`}>
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center font-black text-sm shrink-0 ${
                      owner ? `${colColors[owner] ?? 'bg-gray-200'} border` : 'bg-[#EEF3F8] text-[#94A3B8]'
                    }`}>
                      {owner ?? '·'}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-[#0F172A] truncate flex items-center gap-1.5">
                        {item.quantity > 1 && <span className="text-[#F4792B] mr-1">×{item.quantity}</span>}
                        {item.dishName}
                        {isItemLocked && <Lock size={11} className="text-amber-600 shrink-0"/>}
                      </p>
                      {item.modifiers.find(m => m.optionName) && (
                        <p className="text-xs text-[#F4792B] truncate">🌶 {item.modifiers.find(m => m.optionName)?.optionName}</p>
                      )}
                    </div>
                    <span className="text-sm font-bold text-[#0F172A] shrink-0">
                      S/ {itemSubtotal(item).toFixed(2)}
                    </span>
                    {owner && owner !== activeCol && !disabled && (
                      <select
                        value={owner}
                        onClick={e => e.stopPropagation()}
                        onChange={e => { e.stopPropagation(); moveItem(item.id, e.target.value) }}
                        className="text-xs font-semibold border border-current bg-white/40 rounded-lg px-1.5 py-0.5"
                      >
                        {columns.filter(c => c.status !== 'paid').map(c => <option key={c.id} value={c.id}>→ {c.id}</option>)}
                      </select>
                    )}
                  </button>
                )
              })}
            </div>
          </div>

          {/* Columns */}
          <div className="lg:w-80 border-t lg:border-t-0 border-[#E2E8F0] bg-[#FAFAF8] flex flex-col overflow-hidden shrink-0 max-h-[60vh] lg:max-h-none">
            <div className="p-4 border-b border-[#E2E8F0] flex items-center justify-between">
              <p className="text-xs font-bold text-[#64748B] uppercase tracking-wider">Cuentas</p>
              <button onClick={addColumn} disabled={columns.length >= 6}
                className="text-xs font-bold text-[#0077B6] hover:underline disabled:opacity-40">
                + Agregar cuenta
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-3 space-y-3">
              {columns.map(col => {
                const t = colTotal(col)
                const isActive = col.id === activeCol
                const colItems = allItems.filter(i => col.itemIds.has(i.id))
                const isPaid = col.status === 'paid'
                const openCols = columns.filter(c => c.itemIds.size > 0 && c.status !== 'paid')
                const minRequired = paidGroupsCount > 0 ? 1 : 2
                const canCharge = !isPaid && colItems.some(i => !i.billId) && openCols.length >= minRequired
                return (
                  <div key={col.id}
                    className={`rounded-2xl border-2 transition-all ${
                      isPaid ? 'border-emerald-300 bg-emerald-50/40' :
                      isActive ? 'border-[#0077B6] bg-white shadow-md' : 'border-[#E2E8F0] bg-white'
                    }`}>
                    <button onClick={() => !isPaid && setActiveCol(col.id)} disabled={isPaid}
                      className="w-full px-4 py-3 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className={`w-7 h-7 rounded-lg font-black text-sm flex items-center justify-center ${
                          isPaid ? 'bg-emerald-500 text-white' :
                          isActive ? 'bg-[#0077B6] text-white' : 'bg-[#EEF3F8] text-[#64748B]'
                        }`}>{col.id}</span>
                        <span className="text-sm font-bold text-[#0F172A]">{col.label}</span>
                        {isPaid && (
                          <span className="text-[10px] font-bold bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full flex items-center gap-1">
                            <CheckCircle2 size={10}/> Pagado
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <span className={`text-sm font-black ${isPaid ? 'text-emerald-600' : 'text-[#F4792B]'}`}>S/ {t.toFixed(2)}</span>
                        {!isPaid && columns.filter(c => c.status !== 'paid').length > 1 && (
                          <span onClick={e => { e.stopPropagation(); removeColumn(col.id) }}
                            className="w-6 h-6 rounded-md hover:bg-red-50 hover:text-red-500 text-[#94A3B8] flex items-center justify-center cursor-pointer">
                            <X size={12}/>
                          </span>
                        )}
                      </div>
                    </button>
                    {colItems.length > 0 && (
                      <div className="px-4 pb-3 space-y-1 border-t border-[#E2E8F0] pt-2">
                        {colItems.map(it => (
                          <div key={it.id} className="text-xs flex justify-between text-[#64748B]">
                            <span className="truncate">{it.quantity > 1 && `×${it.quantity} `}{it.dishName}</span>
                            <span className="shrink-0 ml-2">S/ {itemSubtotal(it).toFixed(2)}</span>
                          </div>
                        ))}
                      </div>
                    )}
                    {isPaid ? (
                      <div className="w-full font-bold py-2.5 rounded-b-2xl text-emerald-700 bg-emerald-100/60 text-xs flex items-center justify-center gap-1.5">
                        <CheckCircle2 size={12}/> Sub-cuenta cobrada
                      </div>
                    ) : (
                      <button onClick={() => handleChargeColumn(col)} disabled={!canCharge || saving}
                        className="w-full font-bold py-2.5 rounded-b-2xl text-white text-xs disabled:opacity-30 disabled:bg-gray-300 transition-all flex items-center justify-center gap-1.5"
                        style={{ background: canCharge ? 'linear-gradient(135deg,#0077B6,#004E86)' : undefined }}>
                        {saving && <Loader2 size={12} className="animate-spin"/>}
                        Cobrar {col.id} · S/ {t.toFixed(2)}
                      </button>
                    )}
                  </div>
                )
              })}
            </div>
            {unassigned.length > 0 && (
              <div className="p-3 border-t border-[#E2E8F0] bg-amber-50 text-xs text-amber-700 shrink-0">
                ⚠ Quedan {unassigned.length} plato{unassigned.length !== 1 ? 's' : ''} sin asignar
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Payment Panel ─────────────────────────────────────────────────────────────
type OpenSubaccount = {
  id: number
  label: string
  total: number
  items: ActiveOrderItem[]
}

function PaymentPanel({
  order, items, onPaid, onPrePrint, onSplit, onBack,
  openSubaccounts, partialBillGroupId, onSwitchSubaccount, onExitPartial,
}: {
  order: ActiveOrder
  items: ActiveOrderItem[]
  onPaid: (method: PayMethod, cashReceived: number, receiptNumber: string, items: ActiveOrderItem[]) => void
  onPrePrint: () => void
  onSplit: () => void
  onBack?: () => void
  openSubaccounts: OpenSubaccount[]
  partialBillGroupId: number | null
  onSwitchSubaccount: (groupId: number) => void
  onExitPartial: () => void
}) {
  const [method, setMethod]           = useState<PayMethod>('cash')
  const [cashInput, setCashInput]     = useState('')
  const [walletConfirmed, setWalletConfirmed] = useState(false)
  const { nextReceiptNumber }         = useReceiptStore()

  const total      = items.reduce((s, i) => s + i.unitPrice * i.quantity, 0)
  const received   = parseFloat(cashInput) || 0
  const change     = received - total
  const canConfirm = method === 'cash'
    ? received >= total
    : walletConfirmed

  // Sin cocina, los pedidos no transicionan a 'ready' — el cajero cobra directo.
  const handleConfirmClick = () => {
    const num = nextReceiptNumber()
    onPaid(method, method === 'cash' ? received : total, num, items)
  }

  const QUICK = [total, Math.ceil(total / 10) * 10, Math.ceil(total / 50) * 50, Math.ceil(total / 100) * 100]
    .filter((v, i, a) => a.indexOf(v) === i).slice(0, 4)

  // Cobramos parcial si el cajero seleccionó una sub-cuenta específica.
  // Comparar item-counts no funciona cuando hay 1 sola sub-cuenta abierta que contiene
  // todos los items pendientes — ahí items.length === unpaidItems(order).length pero
  // igual estamos en flujo parcial.
  const isPartial = partialBillGroupId !== null
  const hasOpenSplit = openSubaccounts.length > 0
  const blockedBySplit = hasOpenSplit && !isPartial
  const currentSubaccount = partialBillGroupId
    ? (order.billGroups?.find(g => g.id === partialBillGroupId) ?? null)
    : null

  return (
    <div className="flex flex-col h-full">
      {/* Mobile back button */}
      {onBack && (
        <button onClick={onBack}
          className="md:hidden flex items-center gap-2 px-5 py-2.5 border-b border-[#E2E8F0] text-sm font-semibold text-[#0077B6] shrink-0 bg-white">
          <ArrowLeft size={16}/> Volver a la lista
        </button>
      )}

      {/* Action + subaccount switcher header */}
      <div className="px-4 sm:px-5 pt-3 pb-2 shrink-0 bg-white border-b border-[#E2E8F0] space-y-2">
        <div className="grid grid-cols-2 gap-2">
          <button onClick={onPrePrint} disabled={blockedBySplit}
            className="flex items-center justify-center gap-1.5 bg-white border-2 border-[#E2E8F0] hover:border-[#0077B6] text-[#0F172A] font-semibold py-2 rounded-xl text-xs transition-colors disabled:opacity-40">
            <FileText size={14} className="text-[#0077B6]"/> Pre-cuenta
          </button>
          <button onClick={onSplit}
            className="flex items-center justify-center gap-1.5 bg-white border-2 border-[#E2E8F0] hover:border-[#F4792B] text-[#0F172A] font-semibold py-2 rounded-xl text-xs transition-colors">
            <SplitSquareHorizontal size={14} className="text-[#F4792B]"/>
            {hasOpenSplit ? 'Editar división' : 'Dividir'}
          </button>
        </div>

        {hasOpenSplit && (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <p className="text-[10px] font-bold text-[#64748B] uppercase tracking-wider">
                {isPartial && currentSubaccount
                  ? <>Cobrando: <span className="text-[#0077B6]">{currentSubaccount.label}</span></>
                  : 'Selecciona una sub-cuenta'}
              </p>
              {isPartial && openSubaccounts.length > 1 && (
                <button onClick={onExitPartial}
                  className="text-[10px] font-bold text-[#64748B] hover:text-[#0077B6] flex items-center gap-1">
                  <X size={11}/> Vista completa
                </button>
              )}
            </div>
            <div className="flex gap-1.5 overflow-x-auto pb-0.5 -mx-1 px-1">
              {openSubaccounts.map(g => {
                const isActive = partialBillGroupId === g.id
                return (
                  <button key={g.id}
                    onClick={() => onSwitchSubaccount(g.id)}
                    className={`shrink-0 px-3 py-1.5 rounded-lg text-xs font-bold transition-colors flex items-center gap-2 ${
                      isActive
                        ? 'bg-[#0077B6] text-white shadow-sm'
                        : 'bg-[#EEF3F8] text-[#64748B] hover:bg-blue-50 hover:text-[#0077B6]'
                    }`}>
                    <span>{g.label}</span>
                    <span className={`text-[10px] ${isActive ? 'text-white/85' : 'text-[#94A3B8]'}`}>
                      S/ {g.total.toFixed(2)}
                    </span>
                  </button>
                )
              })}
            </div>
          </div>
        )}
      </div>

      {/* Order summary */}
      <div className="flex-1 overflow-y-auto px-4 sm:px-5 py-2">
        <div className="flex items-center justify-between mb-2">
          <p className="text-xs font-bold text-[#64748B] uppercase tracking-wider">
            {isPartial
              ? `Cobrando ${currentSubaccount?.label ?? 'parcial'}`
              : blockedBySplit ? 'Resumen completo (bloqueado)' : 'Resumen del pedido'}
          </p>
          <span className="text-[10px] font-semibold text-[#94A3B8]">
            {items.length} item{items.length !== 1 ? 's' : ''}
          </span>
        </div>
        {items.map(item => {
          const spice = item.modifiers.find(m => m.optionName)
          const pref  = item.modifiers.find(m => m.freeText)
          return (
            <div key={item.id} className="flex items-start justify-between gap-3 py-1.5 border-b border-[#E2E8F0] last:border-0">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-[#0F172A] leading-tight">
                  {item.quantity > 1 && <span className="text-[#F4792B] mr-1">×{item.quantity}</span>}
                  {item.dishName}
                </p>
                {spice && <p className="text-[11px] text-[#F4792B] leading-tight">🌶 {spice.optionName}</p>}
                {pref  && <p className="text-[11px] text-[#64748B] italic leading-tight">{pref.freeText}</p>}
              </div>
              <span className="text-sm font-bold text-[#0F172A] shrink-0">
                S/ {(item.unitPrice * item.quantity).toFixed(2)}
              </span>
            </div>
          )
        })}
      </div>

      {/* Banner: cuenta dividida sin sub-cuenta seleccionada */}
      {blockedBySplit && (
        <div className="mx-4 sm:mx-5 mb-2 bg-amber-50 border-2 border-amber-200 rounded-xl px-3 py-2 flex items-center gap-2 shrink-0">
          <SplitSquareHorizontal size={14} className="text-amber-600 shrink-0"/>
          <p className="text-xs text-amber-800 flex-1">Selecciona una sub-cuenta de arriba para cobrar.</p>
        </div>
      )}

      {/* Total + payment + confirm — compact bottom block */}
      <div className="px-4 sm:px-5 pt-2 pb-4 shrink-0 bg-white border-t border-[#E2E8F0] space-y-2.5">
        {/* Total + method switch */}
        <div className="bg-[#0077B6] rounded-xl px-4 py-2.5 flex items-center justify-between">
          <div>
            <p className="text-white/70 text-[10px] font-bold uppercase tracking-wider">
              {isPartial && currentSubaccount ? `Total ${currentSubaccount.label}` : 'Total a cobrar'}
            </p>
            <p className="text-white font-black text-2xl leading-tight">S/ {total.toFixed(2)}</p>
          </div>
          <div className="flex flex-col items-end gap-1">
            <p className="text-white/70 text-[10px] font-bold uppercase tracking-wider">Método</p>
            <div className="flex items-center gap-1">
              <button onClick={() => { setMethod('cash'); setWalletConfirmed(false) }}
                className={`text-[10px] font-bold px-2 py-1 rounded-full flex items-center gap-1 transition-colors ${
                  method === 'cash' ? 'bg-emerald-100 text-emerald-700' : 'bg-white/20 text-white/80 hover:bg-white/30'
                }`}>
                <Banknote size={11}/> Efectivo
              </button>
              <button onClick={() => { setMethod('yape'); setWalletConfirmed(false) }}
                className={`text-[10px] font-bold px-2 py-1 rounded-full flex items-center gap-1 transition-colors ${
                  method === 'yape' ? 'bg-purple-100 text-purple-700' : 'bg-white/20 text-white/80 hover:bg-white/30'
                }`}>
                <Smartphone size={11}/> Yape
              </button>
              <button onClick={() => { setMethod('plin'); setWalletConfirmed(false) }}
                className={`text-[10px] font-bold px-2 py-1 rounded-full flex items-center gap-1 transition-colors ${
                  method === 'plin' ? 'bg-sky-100 text-sky-700' : 'bg-white/20 text-white/80 hover:bg-white/30'
                }`}>
                <Smartphone size={11}/> Plin
              </button>
            </div>
          </div>
        </div>

        {/* Method-specific input */}
        {method === 'cash' ? (
          <div className="space-y-2">
            <div className="flex gap-2">
              <div className="relative flex-1">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[#64748B] font-bold text-sm">S/</span>
                <input
                  type="number" step="0.50" min={total} value={cashInput}
                  onChange={e => setCashInput(e.target.value)}
                  placeholder={total.toFixed(2)}
                  className="w-full bg-white border-2 border-[#E2E8F0] focus:border-emerald-400 rounded-xl pl-9 pr-3 py-2 text-lg font-black text-[#0F172A] focus:outline-none transition-colors"
                />
              </div>
              {received > 0 && (
                <div className={`flex items-center justify-between px-3 py-2 rounded-xl shrink-0 ${change >= 0 ? 'bg-emerald-50 border border-emerald-200' : 'bg-red-50 border border-red-200'}`}>
                  <div className="flex flex-col items-end">
                    <span className={`text-[10px] font-bold uppercase ${change >= 0 ? 'text-emerald-700' : 'text-red-600'}`}>
                      {change >= 0 ? 'Vuelto' : 'Falta'}
                    </span>
                    <span className={`text-base font-black leading-tight ${change >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                      S/ {Math.abs(change).toFixed(2)}
                    </span>
                  </div>
                </div>
              )}
            </div>
            <div className="flex gap-1.5">
              {QUICK.map(q => (
                <button key={q} onClick={() => setCashInput(q.toFixed(2))}
                  className="flex-1 bg-[#EEF3F8] hover:bg-emerald-50 hover:text-emerald-700 text-[#64748B] text-xs font-bold py-1.5 rounded-lg transition-colors">
                  S/ {q.toFixed(0)}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <label className={`flex items-center gap-3 ${PAY_CONFIG[method].bg} border-2 ${PAY_CONFIG[method].border} rounded-xl px-3 py-2 cursor-pointer transition-colors`}>
            <input type="checkbox" checked={walletConfirmed} onChange={e => setWalletConfirmed(e.target.checked)}
              className="w-5 h-5 accent-[#0077B6] cursor-pointer"/>
            <div className="flex-1">
              <p className={`text-sm font-bold ${PAY_CONFIG[method].text}`}>
                Solicitar S/ {total.toFixed(2)} por {PAY_CONFIG[method].label}
              </p>
              <p className="text-[10px] text-[#64748B]">Tickea cuando el cliente confirme la transferencia</p>
            </div>
          </label>
        )}

        {/* Confirm button */}
        <button onClick={handleConfirmClick} disabled={!canConfirm || blockedBySplit}
          className="w-full flex items-center justify-center gap-2 font-bold py-3 rounded-xl text-white text-base disabled:opacity-40 shadow-md shadow-[#0077B6]/20 transition-all"
          style={{ background: 'linear-gradient(135deg,#0077B6,#004E86)' }}>
          <CheckCircle2 size={18}/> Confirmar Pago · S/ {total.toFixed(2)}
        </button>
      </div>
    </div>
  )
}

// ─── Cash Page ─────────────────────────────────────────────────────────────────
export default function Cash() {
  const [searchParams]      = useSearchParams()
  const navigate            = useNavigate()
  const { user }            = useAuthStore()
  const { orders, removeOrder, replaceOrderItems } = useOrdersStore()
  const { syncWithBackend } = useReceiptStore()

  useEffect(() => {
    api.get('/bills/next-number').then(({ data }) => {
      syncWithBackend(data.lastNumber)
    }).catch(console.error)
  }, [syncWithBackend])

  const paramOrderId   = searchParams.get('orderId')
  const [selectedId, setSelectedId] = useState<number | null>(paramOrderId ? Number(paramOrderId) : null)
  const [receipt, setReceipt] = useState<{
    number: string
    method: PayMethod
    cashReceived: number
    items: ActiveOrderItem[]
  } | null>(null)

  const [splitOpen, setSplitOpen]       = useState(false)
  const [partialItems, setPartialItems] = useState<ActiveOrderItem[] | null>(null)
  const [partialBillGroupId, setPartialBillGroupId] = useState<number | null>(null)
  const [prePrinting, setPrePrinting]   = useState(false)
  const [prePrintMsg, setPrePrintMsg]   = useState<string | null>(null)

  const payableOrders = orders.filter(o => unpaidItems(o).length > 0)
  const selectedOrder = selectedId ? orders.find(o => o.id === selectedId) : null

  // Reset partial cuando cambia la orden seleccionada
  useEffect(() => { setPartialItems(null); setPartialBillGroupId(null); setSplitOpen(false) }, [selectedId])

  // Si el pedido seleccionado desaparece (cobrado por otro cajero, cancelado, etc.),
  // limpiar la selección para que el cajero vuelva a la lista en lugar de quedar con un id colgante.
  useEffect(() => {
    if (selectedId && !selectedOrder) setSelectedId(null)
  }, [selectedId, selectedOrder])

  const itemsForPayment: ActiveOrderItem[] = useMemo(() => {
    if (!selectedOrder) return []
    if (!partialItems) return unpaidItems(selectedOrder)
    // Re-resolve partialItems against current order so socket updates (status/items) propagate
    const byId = new Map(selectedOrder.items.map(i => [i.id, i]))
    const fresh = partialItems
      .map(p => byId.get(p.id))
      .filter((i): i is ActiveOrderItem => !!i && !i.billId)
    // Si el grupo se quedó vacío (todos cobrados o reasignados), fallback al total
    return fresh.length > 0 ? fresh : unpaidItems(selectedOrder)
  }, [selectedOrder, partialItems])

  const openSubaccounts: OpenSubaccount[] = useMemo(() => {
    if (!selectedOrder) return []
    const groups = selectedOrder.billGroups ?? []
    return groups
      .filter(g => g.status === 'open')
      .map(g => {
        const groupItems = selectedOrder.items.filter(i => i.billGroupId === g.id && !i.billId)
        const total = groupItems.reduce((s, i) => s + i.unitPrice * i.quantity, 0)
        return { id: g.id, label: g.label, total, items: groupItems }
      })
      .filter(g => g.items.length > 0)
  }, [selectedOrder])

  // Auto-seleccionar la única sub-cuenta abierta cuando es la última que queda.
  // Cubre: entrada al pedido, regreso después de pagar otra sub-cuenta, etc.
  // Debe ir DESPUÉS de openSubaccounts (TDZ).
  useEffect(() => {
    if (!selectedOrder) return
    if (partialBillGroupId !== null) return
    if (openSubaccounts.length !== 1) return
    const only = openSubaccounts[0]
    setPartialItems(only.items)
    setPartialBillGroupId(only.id)
  }, [selectedOrder, partialBillGroupId, openSubaccounts])

  const switchToSubaccount = (groupId: number) => {
    const g = openSubaccounts.find(o => o.id === groupId)
    if (!g) return
    setPartialItems(g.items)
    setPartialBillGroupId(groupId)
  }

  const exitPartial = () => {
    setPartialItems(null)
    setPartialBillGroupId(null)
  }

  const handlePaid = (method: PayMethod, cashReceived: number, receiptNumber: string, items: ActiveOrderItem[]) => {
    setReceipt({ number: receiptNumber, method, cashReceived, items })
  }

  const handleFinalize = async () => {
    if (selectedId && receipt) {
      try {
        const { data } = await api.post('/bills', {
          orderId: selectedId,
          paymentMethod: receipt.method,
          cashReceived: receipt.cashReceived,
          receiptNumber: receipt.number,
          itemIds: receipt.items.map(i => i.id),
          billGroupId: partialBillGroupId ?? undefined,
        })
        if (data?.fullyPaid) {
          removeOrder(selectedId)
          setReceipt(null)
          setPartialItems(null)
          setPartialBillGroupId(null)
          navigate('/tables')
        } else {
          // Marcar localmente los items como pagados
          replaceOrderItems(selectedId, receipt.items.map(i => i.id), data.id ?? -1)
          setReceipt(null)
          setPartialItems(null)
          setPartialBillGroupId(null)
        }
      } catch (e: any) {
        console.error('Failed to record bill', e)
        alert(e.response?.data?.error || 'Error al generar comprobante. Intente nuevamente.')
        setReceipt(null)
        api.get('/bills/next-number').then(({ data }) => syncWithBackend(data.lastNumber)).catch(console.error)
      }
    } else {
      setReceipt(null)
    }
  }

  const handlePrePrint = async () => {
    if (!selectedOrder) return
    const items = unpaidItems(selectedOrder)
    if (items.length === 0) return
    setPrePrinting(true)
    setPrePrintMsg(null)
    try {
      const total = items.reduce((s, i) => s + i.unitPrice * i.quantity, 0)
      const date = new Date().toLocaleString('es-PE', {
        day: '2-digit', month: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit',
      })
      await api.post('/print/pre-receipt', {
        date,
        orderType: selectedOrder.type === 'delivery' ? 'delivery' : 'dine-in',
        tableId: selectedOrder.tableId,
        customerName: selectedOrder.customerName,
        cashierName: user?.name ?? 'Cajero',
        items: items.map(i => ({
          dishName: i.dishName,
          quantity: i.quantity,
          unitPrice: i.unitPrice,
          modifiers: i.modifiers,
        })),
        total,
      })
      setPrePrintMsg('Pre-cuenta enviada a impresora')
    } catch (e: any) {
      setPrePrintMsg(e.response?.data?.error ?? 'Error al imprimir pre-cuenta')
    } finally {
      setPrePrinting(false)
      setTimeout(() => setPrePrintMsg(null), 3500)
    }
  }

  const handleSplitCharge = (items: ActiveOrderItem[], billGroupId: number) => {
    setPartialItems(items)
    setPartialBillGroupId(billGroupId)
    setSplitOpen(false)
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Header */}
      <div className="bg-white border-b border-[#E2E8F0] px-4 sm:px-6 py-3 sm:py-4 flex items-center gap-3 sm:gap-4 shrink-0">
        <button onClick={() => navigate('/tables')}
          className="w-9 h-9 rounded-xl bg-[#EEF3F8] flex items-center justify-center text-[#64748B] hover:bg-[#0077B6] hover:text-white transition-all shrink-0">
          <ArrowLeft size={18}/>
        </button>
        <div className="min-w-0">
          <h1 className="text-lg sm:text-xl font-black text-[#0F172A]">Caja</h1>
          <p className="text-[#64748B] text-xs sm:text-sm">{payableOrders.length} pedido{payableOrders.length !== 1 ? 's' : ''} activo{payableOrders.length !== 1 ? 's' : ''}</p>
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden">
        {/* Left: Order list (grid 2-col en lg+) */}
        <div className={`md:w-80 lg:w-[28rem] md:border-r border-[#E2E8F0] flex flex-col bg-white shrink-0 w-full ${
          selectedOrder ? 'hidden md:flex' : 'flex'
        }`}>
          <div className="px-4 py-2.5 border-b border-[#E2E8F0] flex items-center justify-between">
            <p className="text-xs font-bold text-[#64748B] uppercase tracking-wider">Pedidos activos</p>
            <span className="text-xs font-bold text-[#94A3B8]">{payableOrders.length}</span>
          </div>
          <div className="flex-1 overflow-y-auto p-3">
            {payableOrders.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-center py-12">
                <Receipt size={40} className="text-[#CBD5E1] mb-3"/>
                <p className="text-sm font-semibold text-[#64748B]">Sin cobros pendientes</p>
                <p className="text-xs text-[#94A3B8] mt-1">Los pedidos listos aparecen aquí</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
                {payableOrders.map(order => {
                  const pending = unpaidItems(order)
                  const total = pending.reduce((s, i) => s + i.unitPrice * i.quantity, 0)
                  const selected = selectedId === order.id
                  const isPartial = pending.length !== order.items.length
                  const hasOpenSplitCard = !!order.billGroups?.some(g => g.status === 'open')
                  const itemCount = pending.reduce((s, i) => s + i.quantity, 0)
                  return (
                    <button key={order.id} onClick={() => setSelectedId(order.id as number)}
                      className={`text-left p-2.5 rounded-xl border-2 transition-all ${
                        selected ? 'border-[#0077B6] bg-blue-50 shadow-sm' : 'border-[#E2E8F0] bg-white hover:border-[#0077B6]/40 hover:shadow-sm'
                      }`}>
                      <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center gap-1.5 min-w-0">
                          {order.type === 'delivery'
                            ? <Bike size={13} className="text-[#F4792B] shrink-0"/>
                            : <LayoutGrid size={13} className="text-[#0077B6] shrink-0"/>
                          }
                          <span className="font-bold text-xs text-[#0F172A] truncate">
                            {order.type === 'delivery' ? order.customerName : `Mesa ${order.tableId}`}
                          </span>
                        </div>
                        <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-semibold shrink-0 ${
                          order.status === 'ready' ? 'bg-emerald-100 text-emerald-700' :
                          order.status === 'paying' ? 'bg-orange-100 text-orange-700' :
                          order.status === 'preparing' ? 'bg-amber-100 text-amber-700' :
                          'bg-gray-100 text-gray-700'
                        }`}>
                          {order.status === 'ready' ? 'Listo' : order.status === 'paying' ? 'Cobrar' : order.status === 'preparing' ? 'Prepa' : 'Pend'}
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] text-[#94A3B8]">{itemCount} it</span>
                        <span className="text-sm font-black text-[#F4792B]">S/ {total.toFixed(2)}</span>
                      </div>
                      {(isPartial || hasOpenSplitCard) && (
                        <div className="mt-1 flex items-center gap-1 text-[9px] font-bold text-amber-600">
                          <SplitSquareHorizontal size={9}/>
                          {isPartial ? 'Parcial' : 'Dividida'}
                        </div>
                      )}
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        </div>

        {/* Right: Payment panel */}
        <div className={`flex-1 overflow-hidden flex-col bg-[#EEF3F8] ${
          selectedOrder ? 'flex' : 'hidden md:flex'
        }`}>
          {selectedOrder && itemsForPayment.length > 0 ? (
            <>
              {prePrintMsg && (
                <div className="bg-emerald-100 border-b border-emerald-200 text-emerald-800 px-5 py-2.5 text-sm font-medium flex items-center gap-2 shrink-0">
                  <CheckCircle2 size={16}/> {prePrintMsg}
                </div>
              )}
              {prePrinting && (
                <div className="bg-blue-100 border-b border-blue-200 text-blue-800 px-5 py-2.5 text-sm font-medium flex items-center gap-2 shrink-0">
                  <Loader2 size={16} className="animate-spin"/> Imprimiendo pre-cuenta...
                </div>
              )}
              <PaymentPanel
                order={selectedOrder}
                items={itemsForPayment}
                onPaid={handlePaid}
                onPrePrint={handlePrePrint}
                onSplit={() => setSplitOpen(true)}
                onBack={() => setSelectedId(null)}
                openSubaccounts={openSubaccounts}
                partialBillGroupId={partialBillGroupId}
                onSwitchSubaccount={switchToSubaccount}
                onExitPartial={exitPartial}
              />
            </>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-center p-8">
              <div className="w-20 h-20 rounded-3xl bg-white shadow-sm flex items-center justify-center mb-4">
                <CreditCard size={36} className="text-[#CBD5E1]"/>
              </div>
              <p className="text-lg font-bold text-[#64748B]">Selecciona un pedido</p>
              <p className="text-sm text-[#94A3B8] mt-1">Elige de la lista para procesar el cobro</p>
            </div>
          )}
        </div>
      </div>

      {/* Split bill modal */}
      {splitOpen && selectedOrder && (
        <SplitBillModal
          order={selectedOrder}
          onClose={() => setSplitOpen(false)}
          onCharge={handleSplitCharge}
        />
      )}

      {/* Receipt modal */}
      {receipt && selectedOrder && (
        <ReceiptModal
          order={selectedOrder}
          items={receipt.items}
          receiptNumber={receipt.number}
          payMethod={receipt.method}
          cashReceived={receipt.cashReceived}
          onClose={handleFinalize}
        />
      )}
    </div>
  )
}
