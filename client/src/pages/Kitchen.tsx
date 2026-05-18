import { useState, useEffect } from 'react'
import {
  DndContext, closestCenter, PointerSensor, useSensor, useSensors, type DragEndEvent,
} from '@dnd-kit/core'
import { SortableContext, useSortable, arrayMove, rectSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useOrdersStore, type ActiveOrder } from '../store/orders'
import { Flame, Clock, Bike, CheckCircle2, Circle, GripVertical, ArrowUpDown, CreditCard } from 'lucide-react'

function elapsed(createdAt: string) {
  const mins = Math.floor((Date.now() - new Date(createdAt).getTime()) / 60000)
  const urgency: 'ok' | 'warn' | 'urgent' = mins < 10 ? 'ok' : mins < 20 ? 'warn' : 'urgent'
  return { label: mins < 1 ? '< 1 min' : `${mins} min`, urgency, mins }
}

const URGENCY = {
  ok:     { bar: 'bg-emerald-500', time: 'text-emerald-400', border: 'border-l-emerald-500' },
  warn:   { bar: 'bg-amber-400',   time: 'text-amber-400',   border: 'border-l-amber-400' },
  urgent: { bar: 'bg-red-500',     time: 'text-red-400',     border: 'border-l-red-500' },
}

type SortKey = 'time' | 'urgency' | 'table'

function KitchenCardInner({ order, isDragging }: { order: ActiveOrder; isDragging: boolean }) {
  const { toggleItemReady, markOrderReady } = useOrdersStore()
  const { label, urgency } = elapsed(order.createdAt)
  const u = URGENCY[urgency]
  const readyCount = order.items.filter(i => i.status === 'ready').length
  const allReady   = readyCount === order.items.length

  return (
    <div className={`bg-gray-800 rounded-b-2xl overflow-hidden flex flex-col border-l-4 ${u.border} shadow-xl transition-opacity ${isDragging ? 'opacity-50' : 'opacity-100'}`}>
      <div className={`h-1 ${u.bar} ${urgency === 'urgent' ? 'animate-pulse' : ''}`} />

      {/* Header */}
      <div className="px-4 py-3 flex items-center justify-between border-b border-gray-700">
        <div className="flex items-center gap-2.5">
          {order.type === 'delivery'
            ? <div className="w-9 h-9 rounded-xl bg-orange-500/20 flex items-center justify-center"><Bike size={16} className="text-orange-400"/></div>
            : <div className="w-9 h-9 rounded-xl bg-blue-500/20 flex items-center justify-center"><span className="text-blue-400 font-black text-sm">M{order.tableId}</span></div>
          }
          <div>
            <p className="text-white font-bold text-sm">{order.type === 'delivery' ? order.customerName : `Mesa ${order.tableId}`}</p>
            {order.type === 'delivery' && <p className="text-gray-400 text-xs">{order.customerPhone}</p>}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {order.status === 'paying' && (
            <span className="flex items-center gap-1 text-xs font-bold text-emerald-400 bg-emerald-500/20 px-2 py-0.5 rounded-full">
              <CreditCard size={10}/> Por cobrar
            </span>
          )}
          <span className={`flex items-center gap-1 text-xs font-bold ${u.time}`}><Clock size={11}/>{label}</span>
          <span className="text-gray-500 text-xs bg-gray-700 px-2 py-0.5 rounded-full">#{String(order.id).padStart(4, '0')}</span>
        </div>
      </div>

      {/* Items */}
      <div className="flex-1 p-4 space-y-2">
        {order.items.map(item => {
          const done  = item.status === 'ready'
          const spice = item.modifiers.find(m => m.optionName)
          const pref  = item.modifiers.find(m => m.freeText)
          return (
            <div key={item.id} onClick={() => toggleItemReady(order.id, item.id)}
              title={done ? 'Click para desmarcar' : 'Click para marcar como listo'}
              className={`flex items-start gap-3 p-3 rounded-xl cursor-pointer select-none transition-all ${done ? 'bg-emerald-500/10 opacity-60 hover:opacity-80' : 'bg-gray-700/50 hover:bg-gray-700'}`}>
              <div className="shrink-0 mt-0.5">
                {done ? <CheckCircle2 size={20} className="text-emerald-400"/> : <Circle size={20} className="text-gray-500"/>}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline gap-2">
                  {item.quantity > 1 && <span className="text-[#F4792B] font-black text-sm">×{item.quantity}</span>}
                  <span className={`text-sm font-bold ${done ? 'text-gray-400 line-through' : 'text-white'}`}>{item.dishName}</span>
                </div>
                {spice && <p className="flex items-center gap-1 text-xs text-orange-300 mt-0.5"><Flame size={10}/>{spice.optionName}</p>}
                {pref  && <p className="text-xs text-gray-400 italic mt-0.5">{pref.freeText}</p>}
                {item.notes && <p className="text-xs text-amber-400 mt-0.5">⚠ {item.notes}</p>}
              </div>
            </div>
          )
        })}
      </div>

      {/* Progress + action */}
      <div className="px-4 pb-4 space-y-3">
        <div>
          <div className="flex justify-between text-xs text-gray-400 mb-1.5">
            <span>{readyCount} de {order.items.length} listos</span>
            <span>{Math.round(readyCount / order.items.length * 100)}%</span>
          </div>
          <div className="h-1.5 bg-gray-700 rounded-full overflow-hidden">
            <div className="h-full bg-emerald-500 rounded-full transition-all duration-500" style={{ width: `${readyCount/order.items.length*100}%` }}/>
          </div>
        </div>
        <button onClick={() => markOrderReady(order.id)} disabled={!allReady}
          className={`w-full py-3 rounded-xl text-sm font-bold transition-all ${allReady ? 'bg-emerald-500 hover:bg-emerald-400 text-white shadow-lg shadow-emerald-500/30' : 'bg-gray-700 text-gray-500 cursor-not-allowed'}`}>
          {allReady ? '✓ Pedido Listo — Notificar' : `Faltan ${order.items.length - readyCount} items`}
        </button>
      </div>
    </div>
  )
}

function SortableCard({ order }: { order: ActiveOrder }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: order.id })
  return (
    <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }}>
      <div {...attributes} {...listeners}
        className="flex items-center justify-center h-7 cursor-grab active:cursor-grabbing text-gray-600 hover:text-gray-400 transition-colors rounded-t-xl bg-gray-700/40 hover:bg-gray-700/70"
        title="Arrastrar para reordenar">
        <GripVertical size={14}/>
      </div>
      <KitchenCardInner order={order} isDragging={isDragging}/>
    </div>
  )
}

export default function Kitchen() {
  const { orders } = useOrdersStore()
  const [manualIds, setManualIds]   = useState<number[]>([])
  const [sortKey, setSortKey]       = useState<SortKey>('time')
  const [manualOrder, setManualOrder] = useState(false)
  const [, tick] = useState(0)

  useEffect(() => { const id = setInterval(() => tick(n => n+1), 30000); return () => clearInterval(id) }, [])

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }))

  const active = orders

  // Sync manualIds when new orders arrive
  useEffect(() => {
    setManualIds(prev => {
      const existingIds = prev.filter(id => active.some(o => o.id === id))
      const newIds = active.filter(o => !prev.includes(o.id)).map(o => o.id)
      return [...existingIds, ...newIds]
    })
  }, [orders.length])

  const sorted = manualOrder
    ? manualIds.map(id => active.find(o => o.id === id)).filter(Boolean) as ActiveOrder[]
    : [...active].sort((a, b) => {
        if (sortKey === 'time')    return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
        if (sortKey === 'urgency') return elapsed(a.createdAt).mins - elapsed(b.createdAt).mins
        if (sortKey === 'table')   return (a.tableId ?? 999) - (b.tableId ?? 999)
        return 0
      })

  const handleDragEnd = (event: DragEndEvent) => {
    const { active: drag, over } = event
    if (!over || drag.id === over.id) return
    setManualIds(ids => {
      const oi = ids.indexOf(Number(drag.id))
      const ni = ids.indexOf(Number(over.id))
      return arrayMove(ids, oi, ni)
    })
    setManualOrder(true)
  }

  const counts = {
    pending:   active.filter(o => o.status === 'pending').length,
    preparing: active.filter(o => o.status === 'preparing').length,
    ready:     active.filter(o => o.status === 'ready').length,
  }

  const SORT_OPTIONS: { key: SortKey; label: string }[] = [
    { key: 'time',    label: 'Más antiguo' },
    { key: 'urgency', label: 'Urgencia' },
    { key: 'table',   label: 'Mesa' },
  ]

  return (
    <div className="h-full flex flex-col bg-gray-900">
      <div className="border-b border-gray-800 px-6 py-4 flex items-center justify-between shrink-0">
        <div>
          <h1 className="text-white font-black text-xl">Cocina</h1>
          <p className="text-gray-500 text-xs mt-0.5">Pantalla de producción · MauiDesk KDS</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 bg-gray-800 rounded-xl p-1">
            <div className="flex items-center gap-1.5 px-2 text-gray-400"><ArrowUpDown size={13}/><span className="text-xs font-semibold hidden sm:block">Ordenar:</span></div>
            {SORT_OPTIONS.map(opt => (
              <button key={opt.key} onClick={() => { setSortKey(opt.key); setManualOrder(false) }}
                className={`text-xs font-semibold px-3 py-1.5 rounded-lg transition-all ${!manualOrder && sortKey === opt.key ? 'bg-[#0077B6] text-white' : 'text-gray-400 hover:text-white hover:bg-gray-700'}`}>
                {opt.label}
              </button>
            ))}
            {manualOrder && (
              <button onClick={() => setManualOrder(false)} className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-amber-500/20 text-amber-400 hover:bg-amber-500/30">
                Manual ✕
              </button>
            )}
          </div>
          {[
            { label: 'Pendientes', count: counts.pending,   color: 'bg-gray-700 text-gray-300' },
            { label: 'Preparando', count: counts.preparing, color: 'bg-amber-500/20 text-amber-300' },
            { label: 'Listos',     count: counts.ready,     color: 'bg-emerald-500/20 text-emerald-300' },
          ].map(({ label, count, color }) => (
            <div key={label} className={`${color} rounded-xl px-4 py-2 text-center min-w-[72px] hidden md:block`}>
              <p className="text-xl font-black leading-none">{count}</p>
              <p className="text-xs mt-0.5 opacity-80">{label}</p>
            </div>
          ))}
        </div>
      </div>

      {active.length > 1 && (
        <div className="px-5 py-2 bg-gray-800/50 border-b border-gray-800 shrink-0">
          <p className="text-xs text-gray-500 flex items-center gap-1.5"><GripVertical size={12}/>Arrastra para reordenar según preferencia</p>
        </div>
      )}

      {sorted.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center text-center">
          <CheckCircle2 size={64} className="text-emerald-500 mb-4 opacity-50"/>
          <p className="text-gray-300 text-xl font-bold">Todo al día</p>
          <p className="text-gray-600 text-sm mt-1">Sin pedidos pendientes en cocina</p>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto p-5">
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={sorted.map(o => o.id)} strategy={rectSortingStrategy}>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 items-start">
                {sorted.map(order => <SortableCard key={order.id} order={order}/>)}
              </div>
            </SortableContext>
          </DndContext>
        </div>
      )}
    </div>
  )
}
