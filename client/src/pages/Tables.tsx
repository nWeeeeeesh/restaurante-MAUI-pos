import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useOrdersStore } from '../store/orders'
import { useAuthStore } from '../store/auth'
import { useToastStore } from '../store/toast'
import { ConfirmDialog } from '../components/ConfirmDialog'
import api from '../api/client'
import type { TableStatus } from '../types'
import {
  Users, Bike, Receipt, Pencil, Save, X, RotateCcw, Move, MapPin, Plus,
  Type, Square, EyeOff, Eye, Trash2, ZoomIn, ZoomOut, Maximize2,
} from 'lucide-react'

interface ApiTable {
  id: number
  number: number
  area: string | null
  capacity: number | null
  status: TableStatus | null
  posX: number | null
  posY: number | null
  active: boolean | null
}

interface LayoutItem {
  id?: number
  type: 'label' | 'zone'
  text: string
  posX: number
  posY: number
  width?: number | null
  height?: number | null
  color?: string | null
}

const STATUS: Record<TableStatus, {
  label: string; cardBg: string; numColor: string
  badge: string; ring: string
}> = {
  free:     { label: 'Libre',      cardBg: 'bg-white',       numColor: 'text-[#0F172A]', badge: 'bg-emerald-100 text-emerald-700', ring: 'ring-1 ring-[#E2E8F0]' },
  occupied: { label: 'Ocupada',    cardBg: 'bg-white',       numColor: 'text-[#0077B6]', badge: 'bg-blue-100 text-blue-700',      ring: 'ring-2 ring-[#0077B6]/40' },
  paying:   { label: 'Por cobrar', cardBg: 'bg-orange-50',   numColor: 'text-[#F4792B]', badge: 'bg-orange-100 text-orange-700',  ring: 'ring-2 ring-[#F4792B]/60' },
}

const AREA_LABELS: Record<string, string> = { salon: 'Salón', terraza: 'Terraza', barra: 'Barra' }

const ZONE_PALETTE = [
  { color: '#94A3B8', label: 'Gris' },
  { color: '#F4792B', label: 'Naranja' },
  { color: '#0077B6', label: 'Azul' },
  { color: '#10B981', label: 'Verde' },
  { color: '#F59E0B', label: 'Ámbar' },
  { color: '#EF4444', label: 'Rojo' },
]

// Tamaño de cada mesa en el plano (en píxeles del canvas virtual)
const TABLE_W = 110
const TABLE_H = 110
// Tamaño del canvas virtual (coordenadas guardadas)
const CANVAS_W = 1200
const CANVAS_H = 700
// Defaults para items nuevos
const ZONE_DEFAULT_W = 240
const ZONE_DEFAULT_H = 160
const LABEL_DEFAULT_W = 180

type DragMode = 'move' | 'resize'

export default function Tables() {
  const navigate                                              = useNavigate()
  const { user }                                              = useAuthStore()
  const { getTableStatus, getTableOrder, getTableTotal, orders } = useOrdersStore()

  const { push: toast } = useToastStore()

  const [apiTables, setApiTables]   = useState<ApiTable[]>([])
  const [layoutItems, setLayoutItems] = useState<LayoutItem[]>([])
  const [editing, setEditing]       = useState(false)
  const [draft, setDraft]           = useState<Record<number, { posX: number | null; posY: number | null; area: string }>>({})
  const [draftItems, setDraftItems] = useState<LayoutItem[]>([])
  const [saving, setSaving]         = useState(false)
  const [planMode, setPlanMode]     = useState<boolean>(() => localStorage.getItem('mauidesk:plan-mode') === 'true')
  const [showInactive, setShowInactive] = useState(false)

  const [pendingDelete, setPendingDelete] = useState<ApiTable | null>(null)
  const [confirmReset, setConfirmReset]   = useState(false)
  const [busy, setBusy]                   = useState(false)
  const [editingItemIdx, setEditingItemIdx] = useState<number | null>(null)
  const [itemTextValue, setItemTextValue] = useState('')
  // Zoom del plano. >=1 (1=ajusta al ancho disponible, >1 amplifica). Mobile arranca con 2.
  const [zoom, setZoom] = useState<number>(() => {
    if (typeof window === 'undefined') return 1
    return window.innerWidth < 640 ? 2 : 1
  })

  const canvasRef = useRef<HTMLDivElement>(null)
  const tableDrag = useRef<{ id: number; offsetX: number; offsetY: number } | null>(null)
  const itemDrag  = useRef<{ idx: number; mode: DragMode; offsetX: number; offsetY: number; startW?: number; startH?: number } | null>(null)

  // Cargar mesas + layout items del backend
  useEffect(() => {
    Promise.all([
      api.get<ApiTable[]>('/tables').then(r => r.data),
      api.get<LayoutItem[]>('/tables/layout-items').then(r => r.data).catch(() => []),
    ]).then(([t, items]) => {
      setApiTables(t)
      setLayoutItems(items)
      // Si nunca se eligió modo y hay layout guardado, mostrar plano por defecto
      if (localStorage.getItem('mauidesk:plan-mode') === null) {
        const has = t.some(x => x.posX !== null && x.posY !== null) || items.length > 0
        if (has) { setPlanMode(true); localStorage.setItem('mauidesk:plan-mode', 'true') }
      }
    }).catch(console.error)
  }, [])

  // Inicializar draft cuando entra a edición — auto-coloca las que no tienen posición
  useEffect(() => {
    if (editing) {
      const initial: typeof draft = {}
      const cols = Math.floor(CANVAS_W / (TABLE_W + 20))
      const placed = apiTables.filter(t => t.posX !== null && t.posY !== null)
      const unplaced = apiTables.filter(t => t.posX === null || t.posY === null)
      placed.forEach(t => {
        initial[t.id] = { posX: t.posX!, posY: t.posY!, area: t.area ?? 'salon' }
      })
      unplaced.forEach((t, i) => {
        const col = i % cols
        const row = Math.floor(i / cols)
        initial[t.id] = {
          posX: 20 + col * (TABLE_W + 20),
          posY: CANVAS_H - TABLE_H - 20 - row * (TABLE_H + 15),
          area: t.area ?? 'salon',
        }
      })
      setDraft(initial)
      setDraftItems(layoutItems.map(it => ({ ...it })))
    }
  }, [editing])

  const isOwner = user?.role === 'owner'

  // Mesas activas vs inactivas. La vista "normal" filtra inactivas; en edición se muestran todas
  // si el flag showInactive está activo.
  const activeTables = apiTables.filter(t => t.active !== false)
  const visibleTables = editing
    ? (showInactive ? apiTables : activeTables)
    : activeTables

  const counts = {
    free:     activeTables.filter(t => getTableStatus(t.id) === 'free').length,
    occupied: activeTables.filter(t => getTableStatus(t.id) === 'occupied').length,
    paying:   activeTables.filter(t => getTableStatus(t.id) === 'paying').length,
  }
  const income = activeTables.reduce((s, t) => s + getTableTotal(t.id), 0)
  const deliveryOrders = orders.filter(o => o.type === 'delivery')

  const handleTable = (tableId: number) => {
    if (editing) return
    const order = getTableOrder(tableId)
    if (order) navigate(`/pos?table=${tableId}&orderId=${order.id}`)
    else       navigate(`/pos?table=${tableId}`)
  }

  // ─── Drag & drop en modo edición — mesas ───────────────────────────────────
  const onTablePointerDown = (e: React.PointerEvent<HTMLDivElement>, tableId: number) => {
    if (!editing) return
    e.stopPropagation()
    const target = e.currentTarget
    target.setPointerCapture(e.pointerId)
    const rect = target.getBoundingClientRect()
    tableDrag.current = {
      id: tableId,
      offsetX: e.clientX - rect.left,
      offsetY: e.clientY - rect.top,
    }
  }

  // ─── Drag & resize en modo edición — items ─────────────────────────────────
  const onItemPointerDown = (e: React.PointerEvent<HTMLDivElement>, idx: number, mode: DragMode = 'move') => {
    if (!editing) return
    e.stopPropagation()
    const target = e.currentTarget
    target.setPointerCapture(e.pointerId)
    const rect = target.getBoundingClientRect()
    const it = draftItems[idx]
    itemDrag.current = {
      idx,
      mode,
      offsetX: e.clientX - rect.left,
      offsetY: e.clientY - rect.top,
      startW: it.width ?? undefined,
      startH: it.height ?? undefined,
    }
  }

  const onCanvasPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!editing) return
    const canvas = canvasRef.current
    if (!canvas) return
    const cRect = canvas.getBoundingClientRect()
    const scale = cRect.width / CANVAS_W
    if (scale === 0) return

    if (tableDrag.current) {
      const localX = (e.clientX - cRect.left - tableDrag.current.offsetX) / scale
      const localY = (e.clientY - cRect.top  - tableDrag.current.offsetY) / scale
      const x = Math.max(0, Math.min(CANVAS_W - TABLE_W, localX))
      const y = Math.max(0, Math.min(CANVAS_H - TABLE_H, localY))
      const id = tableDrag.current.id
      setDraft(d => ({ ...d, [id]: { ...d[id], posX: x, posY: y } }))
      return
    }

    if (itemDrag.current) {
      const { idx, mode, offsetX, offsetY } = itemDrag.current
      if (mode === 'move') {
        const localX = (e.clientX - cRect.left - offsetX) / scale
        const localY = (e.clientY - cRect.top  - offsetY) / scale
        setDraftItems(items => items.map((it, i) => {
          if (i !== idx) return it
          const w = it.width ?? (it.type === 'zone' ? ZONE_DEFAULT_W : LABEL_DEFAULT_W)
          const h = it.height ?? (it.type === 'zone' ? ZONE_DEFAULT_H : 40)
          return { ...it, posX: Math.max(0, Math.min(CANVAS_W - w, localX)), posY: Math.max(0, Math.min(CANVAS_H - h, localY)) }
        }))
      } else if (mode === 'resize') {
        // resize desde la esquina inferior-derecha — el offset del pointer al inicio era cerca del corner
        const it = draftItems[idx]
        const localX = (e.clientX - cRect.left) / scale
        const localY = (e.clientY - cRect.top)  / scale
        const w = Math.max(80,  Math.min(CANVAS_W - it.posX, localX - it.posX))
        const h = Math.max(40,  Math.min(CANVAS_H - it.posY, localY - it.posY))
        setDraftItems(items => items.map((x, i) => i === idx ? { ...x, width: w, height: h } : x))
      }
    }
  }

  const onCanvasPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!editing) return
    if (tableDrag.current) {
      try { e.currentTarget.releasePointerCapture(e.pointerId) } catch {}
      tableDrag.current = null
    }
    if (itemDrag.current) {
      try { e.currentTarget.releasePointerCapture(e.pointerId) } catch {}
      itemDrag.current = null
    }
  }

  // ─── Layout items: agregar / editar / borrar ───────────────────────────────
  const addLabel = () => {
    setDraftItems(its => [...its, {
      type: 'label',
      text: 'Etiqueta',
      posX: CANVAS_W / 2 - LABEL_DEFAULT_W / 2,
      posY: CANVAS_H / 2 - 20,
      width: LABEL_DEFAULT_W,
      height: 40,
      color: '#0F172A',
    }])
  }

  const addZone = () => {
    setDraftItems(its => [...its, {
      type: 'zone',
      text: 'Zona',
      posX: 60,
      posY: 60,
      width: ZONE_DEFAULT_W,
      height: ZONE_DEFAULT_H,
      color: '#94A3B8',
    }])
  }

  const removeItem = (idx: number) => {
    setDraftItems(its => its.filter((_, i) => i !== idx))
    if (editingItemIdx === idx) setEditingItemIdx(null)
  }

  const startEditItem = (idx: number) => {
    setEditingItemIdx(idx)
    setItemTextValue(draftItems[idx]?.text ?? '')
  }

  const commitItemText = () => {
    if (editingItemIdx == null) return
    const idx = editingItemIdx
    setDraftItems(its => its.map((it, i) => i === idx ? { ...it, text: itemTextValue.trim() || it.text } : it))
    setEditingItemIdx(null)
  }

  const setItemColor = (idx: number, color: string) => {
    setDraftItems(its => its.map((it, i) => i === idx ? { ...it, color } : it))
  }

  // ─── Persistencia ──────────────────────────────────────────────────────────
  const saveLayout = async () => {
    setSaving(true)
    try {
      const positions = Object.entries(draft).map(([id, v]) => ({
        id: Number(id),
        posX: v.posX,
        posY: v.posY,
        area: v.area,
      }))
      const { data } = await api.post<{ tables: ApiTable[]; layoutItems: LayoutItem[] }>(
        '/tables/layout',
        { positions, layoutItems: draftItems },
      )
      setApiTables(data.tables)
      setLayoutItems(data.layoutItems)
      setEditing(false)
      setPlanMode(true)
      localStorage.setItem('mauidesk:plan-mode', 'true')
      toast({ variant: 'success', title: 'Mapa guardado' })
    } catch (err: any) {
      toast({ variant: 'error', title: 'Error al guardar', message: err.response?.data?.error ?? 'Intenta nuevamente' })
    } finally {
      setSaving(false)
    }
  }

  const performReset = async () => {
    setBusy(true)
    try {
      const positions = apiTables.map(t => ({ id: t.id, posX: null, posY: null, area: t.area ?? 'salon' }))
      const { data } = await api.post<{ tables: ApiTable[]; layoutItems: LayoutItem[] }>(
        '/tables/layout',
        { positions, layoutItems: [] },
      )
      setApiTables(data.tables)
      setLayoutItems([])
      setDraftItems([])
      setEditing(false)
      setPlanMode(false)
      localStorage.setItem('mauidesk:plan-mode', 'false')
      setConfirmReset(false)
      toast({ variant: 'success', title: 'Mapa restablecido' })
    } catch (err: any) {
      toast({ variant: 'error', title: 'Error al restablecer', message: err.response?.data?.error ?? 'Intenta nuevamente' })
    } finally {
      setBusy(false)
    }
  }

  const handleAddTable = async () => {
    setBusy(true)
    try {
      const { data: created } = await api.post<ApiTable>('/tables', {})
      const cols = Math.floor(CANVAS_W / (TABLE_W + 20))
      const idx  = Object.keys(draft).length
      const col  = idx % cols
      const row  = Math.floor(idx / cols)
      const posX = 20 + col * (TABLE_W + 20)
      const posY = CANVAS_H - TABLE_H - 20 - row * (TABLE_H + 15)

      setApiTables(ts => [...ts, created])
      setDraft(d => ({ ...d, [created.id]: { posX, posY, area: created.area ?? 'salon' } }))
      toast({ variant: 'success', title: `Mesa ${created.number} agregada`, message: 'Recuerda guardar el mapa para confirmar.' })
    } catch (err: any) {
      toast({ variant: 'error', title: 'No se pudo agregar la mesa', message: err.response?.data?.error ?? 'Error de servidor' })
    } finally {
      setBusy(false)
    }
  }

  const performDelete = async () => {
    if (!pendingDelete) return
    setBusy(true)
    try {
      const { data } = await api.delete<{ ok: true; deleted?: boolean; disabled?: boolean; table?: ApiTable }>(`/tables/${pendingDelete.id}`)
      const removed = pendingDelete
      if (data.deleted) {
        setApiTables(ts => ts.filter(t => t.id !== removed.id))
        setDraft(d => { const next = { ...d }; delete next[removed.id]; return next })
        toast({ variant: 'success', title: `Mesa ${removed.number} eliminada` })
      } else if (data.disabled && data.table) {
        const updated = data.table
        setApiTables(ts => ts.map(t => t.id === updated.id ? updated : t))
        toast({
          variant: 'success',
          title: `Mesa ${removed.number} inhabilitada`,
          message: 'Tenía pedidos en historial, así que se ocultó en lugar de borrarse. Puedes reactivarla cuando quieras.',
          durationMs: 5500,
        })
      }
      setPendingDelete(null)
    } catch (err: any) {
      toast({ variant: 'error', title: 'No se pudo eliminar', message: err.response?.data?.error ?? 'Error de servidor' })
    } finally {
      setBusy(false)
    }
  }

  const toggleTableActive = async (t: ApiTable) => {
    setBusy(true)
    try {
      const next = t.active === false   // null/true → desactivar (false); false → reactivar (true)
      const { data: updated } = await api.patch<ApiTable>(`/tables/${t.id}`, { active: next })
      setApiTables(ts => ts.map(x => x.id === updated.id ? updated : x))
      toast({
        variant: 'success',
        title: updated.active ? `Mesa ${updated.number} reactivada` : `Mesa ${updated.number} inhabilitada`,
      })
    } catch (err: any) {
      toast({ variant: 'error', title: 'No se pudo actualizar', message: err.response?.data?.error ?? 'Error de servidor' })
    } finally {
      setBusy(false)
    }
  }

  // ¿Mostramos plano (canvas) o lista por áreas?
  const hasLayout = activeTables.some(t => t.posX !== null && t.posY !== null) || layoutItems.length > 0
  const showPlan  = editing || (planMode && hasLayout)

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Header */}
      <div className="bg-white border-b border-[#E2E8F0] px-3 sm:px-4 md:px-6 py-3 md:py-4 shrink-0">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="min-w-0 flex-1">
            <h1 className="text-lg md:text-xl font-black text-[#0F172A]">Mesas</h1>
            <p className="text-[#64748B] text-xs md:text-sm mt-0.5">
              {editing ? 'Editando distribución · arrastra mesas, etiquetas y zonas' : 'Plano del restaurante'}
            </p>
          </div>
          <div className="flex items-center gap-1.5 flex-wrap justify-end">
            {hasLayout && !editing && (
              <button onClick={() => { setPlanMode(p => !p); localStorage.setItem('mauidesk:plan-mode', String(!planMode)) }}
                className="flex items-center gap-1.5 bg-[#EEF3F8] hover:bg-[#E2E8F0] text-[#0077B6] font-semibold px-3 py-2 rounded-xl transition-all text-xs sm:text-sm">
                <MapPin size={14}/>
                <span className="hidden sm:inline">{planMode ? 'Ver lista' : 'Ver plano'}</span>
              </button>
            )}
            {isOwner && !editing && (
              <button onClick={() => setEditing(true)}
                className="flex items-center gap-1.5 bg-white border-2 border-[#0077B6] text-[#0077B6] hover:bg-[#0077B6] hover:text-white font-semibold px-3 py-2 rounded-xl transition-all text-xs sm:text-sm">
                <Pencil size={14}/>
                <span className="hidden sm:inline">Editar mapa</span>
              </button>
            )}
            {editing && (
              <>
                <button onClick={handleAddTable} disabled={busy || saving}
                  title="Agregar mesa"
                  className="flex items-center gap-1.5 bg-white border-2 border-emerald-400 text-emerald-600 hover:bg-emerald-50 font-semibold px-2.5 sm:px-3 py-2 rounded-xl text-xs sm:text-sm disabled:opacity-50">
                  <Plus size={14}/><span className="hidden md:inline">Mesa</span>
                </button>
                <button onClick={addLabel} disabled={busy || saving}
                  title="Agregar etiqueta de texto"
                  className="flex items-center gap-1.5 bg-white border-2 border-[#94A3B8] text-[#64748B] hover:bg-[#EEF3F8] font-semibold px-2.5 sm:px-3 py-2 rounded-xl text-xs sm:text-sm disabled:opacity-50">
                  <Type size={14}/><span className="hidden md:inline">Etiqueta</span>
                </button>
                <button onClick={addZone} disabled={busy || saving}
                  title="Agregar zona"
                  className="flex items-center gap-1.5 bg-white border-2 border-[#F4792B] text-[#F4792B] hover:bg-orange-50 font-semibold px-2.5 sm:px-3 py-2 rounded-xl text-xs sm:text-sm disabled:opacity-50">
                  <Square size={14}/><span className="hidden md:inline">Zona</span>
                </button>
                <button onClick={() => setShowInactive(s => !s)} disabled={busy || saving}
                  title={showInactive ? 'Ocultar inhabilitadas' : 'Mostrar inhabilitadas'}
                  className={`flex items-center gap-1.5 border-2 font-semibold px-2.5 sm:px-3 py-2 rounded-xl text-xs sm:text-sm disabled:opacity-50 ${
                    showInactive ? 'bg-[#0077B6] border-[#0077B6] text-white' : 'bg-white border-[#E2E8F0] text-[#64748B]'
                  }`}>
                  {showInactive ? <Eye size={14}/> : <EyeOff size={14}/>}
                  <span className="hidden md:inline">Inhabilitadas</span>
                </button>
                <button onClick={() => setConfirmReset(true)} disabled={saving || busy}
                  className="flex items-center gap-1.5 bg-white border border-red-200 text-red-500 hover:bg-red-50 font-semibold px-2.5 sm:px-3 py-2 rounded-xl text-xs sm:text-sm disabled:opacity-50">
                  <RotateCcw size={13}/><span className="hidden md:inline">Restablecer</span>
                </button>
                <button onClick={() => setEditing(false)} disabled={busy}
                  className="flex items-center gap-1.5 bg-[#EEF3F8] text-[#64748B] font-semibold px-2.5 sm:px-3 py-2 rounded-xl text-xs sm:text-sm disabled:opacity-50">
                  <X size={14}/><span className="hidden md:inline">Cancelar</span>
                </button>
                <button onClick={saveLayout} disabled={saving || busy}
                  className="flex items-center gap-1.5 bg-[#0077B6] hover:bg-[#005a8a] text-white font-bold px-3 sm:px-4 py-2 rounded-xl text-xs sm:text-sm disabled:opacity-50 shadow-md">
                  <Save size={14}/>
                  {saving ? 'Guardando...' : 'Guardar'}
                </button>
              </>
            )}
            {!editing && (
              <button
                onClick={() => navigate('/pos?delivery=true')}
                className="flex items-center gap-1.5 bg-[#F4792B] hover:bg-[#d4621b] text-white font-semibold px-3 md:px-5 py-2 md:py-2.5 rounded-xl transition-all shadow-md shadow-[#F4792B]/20 text-xs sm:text-sm"
              >
                <Bike size={15} /> <span className="hidden sm:inline">Nuevo </span>Delivery
              </button>
            )}
          </div>
        </div>

        {/* Stats */}
        {!editing && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 md:gap-3 mt-3">
            {[
              { label: 'Libres',     val: counts.free,              color: 'text-emerald-600', bg: 'bg-emerald-50' },
              { label: 'Ocupadas',   val: counts.occupied,          color: 'text-blue-600',    bg: 'bg-blue-50' },
              { label: 'Por cobrar', val: counts.paying,            color: 'text-orange-600',  bg: 'bg-orange-50' },
              { label: 'En caja',    val: `S/ ${income.toFixed(0)}`,color: 'text-[#0077B6]',  bg: 'bg-[#EEF3F8]' },
            ].map(({ label, val, color, bg }) => (
              <div key={label} className={`${bg} rounded-xl px-3 md:px-4 py-2.5 md:py-3`}>
                <p className={`text-base md:text-lg font-black ${color}`}>{val}</p>
                <p className="text-xs text-[#94A3B8] mt-0.5">{label}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-3 sm:px-4 md:px-6 py-4 md:py-5">
        {/* Delivery orders */}
        {!editing && deliveryOrders.length > 0 && (
          <div className="mb-5">
            <div className="flex items-center gap-3 mb-3">
              <h2 className="text-xs font-bold text-[#64748B] uppercase tracking-widest">Delivery Activos</h2>
              <div className="flex-1 h-px bg-[#E2E8F0]" />
              <span className="text-xs text-[#94A3B8]">{deliveryOrders.length}</span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
              {deliveryOrders.map(o => (
                <button key={o.id}
                  onClick={() => navigate(`/pos?delivery=true&orderId=${o.id}`)}
                  className="bg-orange-50 ring-2 ring-[#F4792B]/40 rounded-2xl p-3 sm:p-4 text-left hover:shadow-md hover:-translate-y-0.5 transition-all shadow-sm">
                  <div className="flex items-start justify-between mb-2 sm:mb-3 gap-2">
                    <Bike size={20} className="text-[#F4792B] shrink-0" />
                    <span className={`text-[10px] sm:text-xs font-semibold px-2 py-0.5 rounded-full whitespace-nowrap ${
                      o.status === 'ready' ? 'bg-emerald-100 text-emerald-700' :
                      o.status === 'preparing' ? 'bg-amber-100 text-amber-700' :
                      'bg-gray-100 text-gray-600'
                    }`}>
                      {o.status === 'ready' ? 'Listo' : o.status === 'preparing' ? 'Preparando' : 'Pendiente'}
                    </span>
                  </div>
                  <p className="text-sm font-bold text-[#0F172A] truncate">{o.customerName}</p>
                  <p className="text-xs text-[#64748B] truncate mt-0.5">{o.customerAddress}</p>
                  <p className="text-sm font-black text-[#F4792B] mt-2">S/ {o.items.reduce((s,i) => s + i.unitPrice * i.quantity, 0).toFixed(2)}</p>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Plano (canvas) */}
        {showPlan ? (
          <PlanView
            tables={visibleTables}
            draft={draft}
            layoutItems={editing ? draftItems : layoutItems}
            editing={editing}
            zoom={zoom}
            onZoomIn={() => setZoom(z => Math.min(z + 0.5, 4))}
            onZoomOut={() => setZoom(z => Math.max(z - 0.5, 1))}
            onZoomReset={() => setZoom(typeof window !== 'undefined' && window.innerWidth < 640 ? 2 : 1)}
            canvasRef={canvasRef}
            onTablePointerDown={onTablePointerDown}
            onItemPointerDown={onItemPointerDown}
            onCanvasPointerMove={onCanvasPointerMove}
            onCanvasPointerUp={onCanvasPointerUp}
            onTableClick={handleTable}
            onRequestDelete={(t) => setPendingDelete(t)}
            onToggleActive={toggleTableActive}
            onItemRemove={removeItem}
            onItemEditText={startEditItem}
            onItemColor={setItemColor}
            getTableStatus={getTableStatus}
            getTableOrder={getTableOrder}
            getTableTotal={getTableTotal}
          />
        ) : (
          <ListView
            tables={visibleTables}
            getTableStatus={getTableStatus}
            getTableOrder={getTableOrder}
            getTableTotal={getTableTotal}
            onTableClick={handleTable}
          />
        )}
      </div>

      <ConfirmDialog
        open={!!pendingDelete}
        title={pendingDelete ? `¿Eliminar Mesa ${pendingDelete.number}?` : ''}
        message={'Si la mesa tiene pedidos en historial, se inhabilitará en lugar de borrarse (para no perder reportes). Si no, se eliminará por completo.'}
        confirmLabel="Continuar"
        variant="danger"
        loading={busy}
        onConfirm={performDelete}
        onCancel={() => !busy && setPendingDelete(null)}
      />

      <ConfirmDialog
        open={confirmReset}
        title="¿Restablecer mapa?"
        message="Las mesas vuelven al modo lista y se borran todas las etiquetas y zonas. No se eliminan mesas."
        confirmLabel="Restablecer"
        variant="warning"
        loading={busy}
        onConfirm={performReset}
        onCancel={() => !busy && setConfirmReset(false)}
      />

      {/* Modal para editar texto de label/zone */}
      {editingItemIdx !== null && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
          onClick={() => setEditingItemIdx(null)}>
          <div className="bg-white rounded-3xl w-full max-w-sm shadow-2xl p-5" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-black text-[#0F172A] mb-3">Editar texto</h3>
            <input
              autoFocus
              value={itemTextValue}
              onChange={e => setItemTextValue(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') commitItemText() }}
              className="w-full bg-white border-2 border-[#E2E8F0] focus:border-[#0077B6] rounded-xl px-4 py-3 text-sm font-semibold text-[#0F172A] focus:outline-none mb-4"
              placeholder="Texto"
            />
            <div className="flex gap-2">
              <button onClick={() => setEditingItemIdx(null)}
                className="flex-1 font-semibold py-2.5 rounded-xl text-[#64748B] bg-[#EEF3F8] hover:bg-[#E2E8F0]">
                Cancelar
              </button>
              <button onClick={commitItemText}
                className="flex-1 font-bold py-2.5 rounded-xl text-white bg-[#0077B6] hover:bg-[#005a8a] shadow-md">
                Guardar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Vista Plano (canvas) ─────────────────────────────────────────────────────
function PlanView({
  tables, draft, layoutItems, editing, zoom, canvasRef,
  onZoomIn, onZoomOut, onZoomReset,
  onTablePointerDown, onItemPointerDown, onCanvasPointerMove, onCanvasPointerUp,
  onTableClick, onRequestDelete, onToggleActive,
  onItemRemove, onItemEditText, onItemColor,
  getTableStatus, getTableOrder, getTableTotal,
}: {
  tables: ApiTable[]
  draft: Record<number, { posX: number | null; posY: number | null; area: string }>
  layoutItems: LayoutItem[]
  editing: boolean
  zoom: number
  onZoomIn: () => void
  onZoomOut: () => void
  onZoomReset: () => void
  canvasRef: React.RefObject<HTMLDivElement | null>
  onTablePointerDown: (e: React.PointerEvent<HTMLDivElement>, id: number) => void
  onItemPointerDown: (e: React.PointerEvent<HTMLDivElement>, idx: number, mode?: DragMode) => void
  onCanvasPointerMove: (e: React.PointerEvent<HTMLDivElement>) => void
  onCanvasPointerUp: (e: React.PointerEvent<HTMLDivElement>) => void
  onTableClick: (id: number) => void
  onRequestDelete: (t: ApiTable) => void
  onToggleActive: (t: ApiTable) => void
  onItemRemove: (idx: number) => void
  onItemEditText: (idx: number) => void
  onItemColor: (idx: number, color: string) => void
  getTableStatus: (id: number) => TableStatus
  getTableOrder: (id: number) => any
  getTableTotal: (id: number) => number
}) {
  return (
    <div className="space-y-3">
      {/* Controles de zoom — útiles sobre todo en móvil */}
      <div className="flex items-center justify-between gap-2 bg-white rounded-xl p-2 border border-[#E2E8F0]">
        <div className="flex items-center gap-1.5">
          <button onClick={onZoomOut} disabled={zoom <= 1}
            title="Alejar"
            className="w-9 h-9 rounded-lg bg-[#EEF3F8] hover:bg-[#E2E8F0] text-[#0077B6] flex items-center justify-center disabled:opacity-30">
            <ZoomOut size={16}/>
          </button>
          <span className="text-xs font-bold text-[#64748B] min-w-[44px] text-center">{Math.round(zoom * 100)}%</span>
          <button onClick={onZoomIn} disabled={zoom >= 4}
            title="Acercar"
            className="w-9 h-9 rounded-lg bg-[#EEF3F8] hover:bg-[#E2E8F0] text-[#0077B6] flex items-center justify-center disabled:opacity-30">
            <ZoomIn size={16}/>
          </button>
          <button onClick={onZoomReset}
            title="Ajustar"
            className="w-9 h-9 rounded-lg bg-[#EEF3F8] hover:bg-[#E2E8F0] text-[#64748B] flex items-center justify-center">
            <Maximize2 size={14}/>
          </button>
        </div>
        <p className="text-[10px] sm:text-xs text-[#94A3B8] truncate">
          {zoom > 1 ? 'Desliza el plano para navegar' : 'Plano del restaurante'}
        </p>
      </div>

      {/* Wrapper con scroll horizontal y vertical para el zoom */}
      <div
        className="bg-white rounded-3xl shadow-sm border-2 border-dashed border-[#E2E8F0] overflow-auto"
        style={{ maxHeight: '78vh' }}
      >
      <div
        ref={canvasRef}
        onPointerMove={onCanvasPointerMove}
        onPointerUp={onCanvasPointerUp}
        onPointerCancel={onCanvasPointerUp}
        className="relative bg-white touch-none select-none"
        style={{
          width: `${zoom * 100}%`,
          minWidth: zoom > 1 ? `${CANVAS_W * zoom * 0.6}px` : undefined,
          aspectRatio: `${CANVAS_W} / ${CANVAS_H}`,
        }}
      >
        {/* Grid sutil de fondo en modo edición */}
        {editing && (
          <div
            className="absolute inset-0 opacity-50 pointer-events-none"
            style={{
              backgroundImage:
                'linear-gradient(to right, #E2E8F0 1px, transparent 1px), linear-gradient(to bottom, #E2E8F0 1px, transparent 1px)',
              backgroundSize: '5% 9%',
            }}
          />
        )}

        {!editing && (
          <div className="absolute inset-x-0 top-3 flex justify-center pointer-events-none z-30">
            <span className="text-xs font-bold text-[#94A3B8] uppercase tracking-widest bg-white/80 px-3 py-1 rounded-full">
              Plano del restaurante
            </span>
          </div>
        )}

        {/* Layout items (zonas y etiquetas) — debajo de las mesas */}
        {layoutItems.map((it, idx) => {
          const w = it.width  ?? (it.type === 'zone' ? ZONE_DEFAULT_W : LABEL_DEFAULT_W)
          const h = it.height ?? (it.type === 'zone' ? ZONE_DEFAULT_H : 40)
          const color = it.color ?? '#94A3B8'
          if (it.type === 'zone') {
            return (
              <div key={idx}
                onPointerDown={editing ? e => onItemPointerDown(e, idx, 'move') : undefined}
                className={`absolute rounded-2xl border-2 ${editing ? 'cursor-grab active:cursor-grabbing' : ''}`}
                style={{
                  left:   `${(it.posX / CANVAS_W) * 100}%`,
                  top:    `${(it.posY / CANVAS_H) * 100}%`,
                  width:  `${(w / CANVAS_W) * 100}%`,
                  height: `${(h / CANVAS_H) * 100}%`,
                  backgroundColor: color + '22',
                  borderColor: color + '88',
                  zIndex: 5,
                }}
              >
                <div className="absolute top-1.5 left-2 text-[11px] sm:text-xs font-bold uppercase tracking-wider"
                  style={{ color }}>
                  {it.text}
                </div>
                {editing && (
                  <>
                    {/* Toolbar: editar texto / paleta / borrar */}
                    <div className="absolute -top-2 -right-2 flex gap-1 z-10">
                      <button onPointerDown={e => e.stopPropagation()}
                        onClick={(e) => { e.stopPropagation(); onItemEditText(idx) }}
                        title="Editar texto"
                        className="w-5 h-5 rounded-md bg-white border border-[#E2E8F0] text-[#64748B] hover:bg-[#0077B6] hover:text-white flex items-center justify-center shadow-sm">
                        <Pencil size={10}/>
                      </button>
                      <button onPointerDown={e => e.stopPropagation()}
                        onClick={(e) => { e.stopPropagation(); onItemRemove(idx) }}
                        title="Eliminar zona"
                        className="w-5 h-5 rounded-md bg-white border border-[#E2E8F0] text-red-500 hover:bg-red-500 hover:text-white flex items-center justify-center shadow-sm">
                        <X size={11}/>
                      </button>
                    </div>
                    {/* Paleta de colores en la esquina inferior izquierda */}
                    <div className="absolute -bottom-2 left-2 flex gap-0.5 bg-white rounded-md p-0.5 shadow-sm border border-[#E2E8F0]">
                      {ZONE_PALETTE.map(c => (
                        <button key={c.color} onPointerDown={e => e.stopPropagation()}
                          onClick={(e) => { e.stopPropagation(); onItemColor(idx, c.color) }}
                          title={c.label}
                          className={`w-3 h-3 rounded-full transition-transform ${color === c.color ? 'ring-2 ring-[#0077B6] scale-125' : ''}`}
                          style={{ backgroundColor: c.color }}
                        />
                      ))}
                    </div>
                    {/* Resize handle */}
                    <div onPointerDown={e => onItemPointerDown(e, idx, 'resize')}
                      className="absolute bottom-0 right-0 w-4 h-4 cursor-nwse-resize"
                      style={{ background: `linear-gradient(135deg, transparent 50%, ${color} 50%)` }}/>
                  </>
                )}
              </div>
            )
          }
          // label
          return (
            <div key={idx}
              onPointerDown={editing ? e => onItemPointerDown(e, idx, 'move') : undefined}
              onDoubleClick={editing ? () => onItemEditText(idx) : undefined}
              className={`absolute flex items-center justify-center font-bold text-sm sm:text-base ${editing ? 'cursor-grab active:cursor-grabbing border-2 border-dashed border-[#94A3B8]/40 rounded-lg bg-white/40' : ''}`}
              style={{
                left:   `${(it.posX / CANVAS_W) * 100}%`,
                top:    `${(it.posY / CANVAS_H) * 100}%`,
                width:  `${(w / CANVAS_W) * 100}%`,
                height: `${(h / CANVAS_H) * 100}%`,
                color,
                zIndex: 6,
              }}
            >
              <span className="px-2 py-0.5 truncate text-center w-full">{it.text}</span>
              {editing && (
                <>
                  <div className="absolute -top-2 -right-2 flex gap-1 z-10">
                    <button onPointerDown={e => e.stopPropagation()}
                      onClick={(e) => { e.stopPropagation(); onItemEditText(idx) }}
                      title="Editar texto"
                      className="w-5 h-5 rounded-md bg-white border border-[#E2E8F0] text-[#64748B] hover:bg-[#0077B6] hover:text-white flex items-center justify-center shadow-sm">
                      <Pencil size={10}/>
                    </button>
                    <button onPointerDown={e => e.stopPropagation()}
                      onClick={(e) => { e.stopPropagation(); onItemRemove(idx) }}
                      title="Eliminar etiqueta"
                      className="w-5 h-5 rounded-md bg-white border border-[#E2E8F0] text-red-500 hover:bg-red-500 hover:text-white flex items-center justify-center shadow-sm">
                      <X size={11}/>
                    </button>
                  </div>
                </>
              )}
            </div>
          )
        })}

        {/* Mesas — encima de zonas/labels */}
        {tables.map(t => {
          const live = editing ? draft[t.id] : { posX: t.posX, posY: t.posY, area: t.area ?? 'salon' }
          if (!live || live.posX === null || live.posY === null || live.posX === undefined || live.posY === undefined) return null
          const status = getTableStatus(t.id)
          const total  = getTableTotal(t.id)
          const order  = getTableOrder(t.id)
          const s      = STATUS[status]
          const isInactive = t.active === false
          return (
            <div
              key={t.id}
              onPointerDown={e => onTablePointerDown(e, t.id)}
              onClick={() => !editing && !isInactive && onTableClick(t.id)}
              className={`absolute rounded-2xl p-2.5 transition-shadow ${s.cardBg} ${s.ring} ${
                editing ? 'cursor-grab active:cursor-grabbing shadow-lg' : (isInactive ? 'cursor-not-allowed opacity-50' : 'cursor-pointer hover:shadow-lg')
              } shadow-sm`}
              style={{
                left:  `${(live.posX! / CANVAS_W) * 100}%`,
                top:   `${(live.posY! / CANVAS_H) * 100}%`,
                width: `${(TABLE_W / CANVAS_W) * 100}%`,
                height:`${(TABLE_H / CANVAS_H) * 100}%`,
                zIndex: 10,
                filter: isInactive && !editing ? 'grayscale(0.8)' : undefined,
              }}
            >
              <div className="h-full flex flex-col justify-between">
                <div className="flex items-start justify-between">
                  <span className={`text-3xl md:text-4xl font-black ${s.numColor} leading-none`}>{t.number}</span>
                  {editing ? (
                    <div className="flex items-center gap-1">
                      <Move size={14} className="text-[#94A3B8]"/>
                      <button
                        onPointerDown={e => e.stopPropagation()}
                        onClick={(e) => { e.stopPropagation(); onToggleActive(t) }}
                        title={isInactive ? 'Reactivar mesa' : 'Inhabilitar mesa'}
                        className={`w-5 h-5 rounded-md flex items-center justify-center transition-colors ${
                          isInactive
                            ? 'bg-emerald-50 text-emerald-600 hover:bg-emerald-500 hover:text-white'
                            : 'bg-amber-50 text-amber-600 hover:bg-amber-500 hover:text-white'
                        }`}
                      >
                        {isInactive ? <Eye size={10}/> : <EyeOff size={10}/>}
                      </button>
                      <button
                        onPointerDown={e => e.stopPropagation()}
                        onClick={(e) => { e.stopPropagation(); onRequestDelete(t) }}
                        title={status === 'free' ? 'Eliminar / inhabilitar mesa' : 'Mesa ocupada — libérala primero'}
                        disabled={status !== 'free'}
                        className="w-5 h-5 rounded-md bg-red-50 hover:bg-red-500 hover:text-white text-red-500 flex items-center justify-center transition-colors disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-red-50 disabled:hover:text-red-500"
                      >
                        <Trash2 size={10}/>
                      </button>
                    </div>
                  ) : (
                    <span className={`text-[9px] md:text-[10px] font-bold px-1.5 py-0.5 rounded-full ${s.badge}`}>{s.label}</span>
                  )}
                </div>
                <div className="flex items-end justify-between">
                  <div className="flex items-center gap-1 text-[#94A3B8]">
                    <Users size={10}/>
                    <span className="text-[9px]">{t.capacity ?? 4}</span>
                  </div>
                  {!editing && status !== 'free' && (
                    <div className="text-right">
                      <p className="text-[9px] text-[#94A3B8]">{order?.items.reduce((sm: number, i: any) => sm + i.quantity, 0)}it</p>
                      <p className="text-[10px] font-bold text-[#F4792B]">S/{total.toFixed(0)}</p>
                    </div>
                  )}
                </div>
                {!editing && status === 'paying' && (
                  <div className="absolute bottom-1 left-1 right-1 flex items-center justify-center gap-1 bg-orange-100 rounded-md py-0.5">
                    <Receipt size={9} className="text-orange-500" />
                    <p className="text-[8px] font-semibold text-orange-600">Por cobrar</p>
                  </div>
                )}
                {isInactive && editing && (
                  <div className="absolute top-1/2 left-0 right-0 -translate-y-1/2 text-center">
                    <span className="text-[9px] font-bold text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded-full">Inhabilitada</span>
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>
      </div>

      {editing && (
        <div className="bg-blue-50 border border-blue-200 rounded-2xl p-3 text-xs text-blue-800 flex items-start gap-2">
          <Move size={14} className="shrink-0 mt-0.5"/>
          <div className="space-y-1">
            <p><strong>Mesas:</strong> arrastra para mover; clic en X (rojo) para eliminar/inhabilitar; clic en ojo para alternar visibilidad.</p>
            <p><strong>Etiquetas y zonas:</strong> arrastra para mover; doble clic en etiqueta o lápiz en zona para cambiar texto; en zonas usa la paleta de colores y la esquina inferior derecha para redimensionar.</p>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Vista Lista por áreas (default) ─────────────────────────────────────────
function ListView({
  tables, getTableStatus, getTableOrder, getTableTotal, onTableClick,
}: {
  tables: ApiTable[]
  getTableStatus: (id: number) => TableStatus
  getTableOrder: (id: number) => any
  getTableTotal: (id: number) => number
  onTableClick: (id: number) => void
}) {
  const areasSet = new Set(tables.map(t => t.area ?? 'salon'))
  const areas = ['salon', 'terraza', 'barra'].filter(a => areasSet.has(a))
  const otherAreas = [...areasSet].filter(a => !['salon', 'terraza', 'barra'].includes(a))
  const allAreas = [...areas, ...otherAreas]

  return (
    <div className="space-y-5 md:space-y-6">
      {allAreas.map(area => {
        const areaTables = tables.filter(t => (t.area ?? 'salon') === area)
        if (areaTables.length === 0) return null
        return (
          <div key={area}>
            <div className="flex items-center gap-3 mb-3">
              <h2 className="text-xs font-bold text-[#64748B] uppercase tracking-widest">{AREA_LABELS[area] ?? area}</h2>
              <div className="flex-1 h-px bg-[#E2E8F0]" />
              <span className="text-xs text-[#94A3B8]">{areaTables.length} mesas</span>
            </div>
            <div className="grid grid-cols-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2 md:gap-3">
              {areaTables.map(t => {
                const status = getTableStatus(t.id)
                const total  = getTableTotal(t.id)
                const order  = getTableOrder(t.id)
                const s      = STATUS[status]
                return (
                  <button key={t.id} onClick={() => onTableClick(t.id)}
                    className={`${s.cardBg} ${s.ring} rounded-2xl p-3 md:p-5 text-left transition-all duration-150 hover:shadow-lg active:scale-95 w-full shadow-sm`}>
                    <div className="flex items-start justify-between mb-2 md:mb-4 gap-2">
                      <span className={`text-3xl md:text-5xl font-black ${s.numColor} leading-none`}>{t.number}</span>
                      <span className={`text-[10px] md:text-xs font-semibold px-1.5 md:px-2.5 py-0.5 md:py-1 rounded-full whitespace-nowrap ${s.badge}`}>{s.label}</span>
                    </div>
                    <div className="flex items-end justify-between">
                      <div className="flex items-center gap-1 text-[#94A3B8]">
                        <Users size={11} />
                        <span className="text-[10px]">{t.capacity ?? 4}</span>
                      </div>
                      {status !== 'free' && (
                        <div className="text-right">
                          <p className="text-[10px] text-[#94A3B8]">{order?.items.reduce((sm: number, i: any) => sm + i.quantity, 0)}it</p>
                          <p className="text-xs font-bold text-[#F4792B]">S/{total.toFixed(0)}</p>
                        </div>
                      )}
                    </div>
                    {status === 'paying' && (
                      <div className="mt-2 pt-2 border-t border-orange-200 flex items-center gap-1">
                        <Receipt size={10} className="text-orange-500" />
                        <p className="text-[10px] font-semibold text-orange-600">Por cobrar</p>
                      </div>
                    )}
                  </button>
                )
              })}
            </div>
          </div>
        )
      })}
    </div>
  )
}
