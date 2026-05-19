import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useOrdersStore } from '../store/orders'
import { useAuthStore } from '../store/auth'
import { useToastStore } from '../store/toast'
import { ConfirmDialog } from '../components/ConfirmDialog'
import api from '../api/client'
import type { TableStatus } from '../types'
import {
  Users, Bike, Receipt, Pencil, Save, X, RotateCcw, Move, MapPin, Plus,
  Type, Square, EyeOff, Eye, Trash2, ZoomIn, ZoomOut, Maximize2, ArrowRightLeft,
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

// Mapeo legacy para mesas que se sembraron con keys en minúscula. Para nuevas zonas
// el nombre tipeado por el usuario se usa tal cual.
const LEGACY_AREA_LABELS: Record<string, string> = { salon: 'Salón', terraza: 'Terraza', barra: 'Barra' }
const areaLabel = (a: string) => LEGACY_AREA_LABELS[a] ?? a
const DEFAULT_AREA = 'salon'

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

// Padding (en coords del canvas) alrededor del contenido cuando se recorta el bbox
const CONTENT_PAD = 60
// Límites de aspect ratio del área visible — evita que en móvil quede una franja
// imposible de usar cuando todas las mesas están en una línea horizontal/vertical.
const MAX_AR = 2.4   // ancho/alto
const MIN_AR = 0.5   // ancho/alto (≈ alto/ancho de 2)

type DragMode = 'move' | 'resize'

// Calcula el bbox del contenido (mesas + items) para que la vista de lectura
// no muestre franjas vacías. En edición se usa el canvas completo para que el
// dueño pueda mover mesas a cualquier lugar sin restricción.
function computeContentBounds(tables: ApiTable[], items: LayoutItem[]) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity

  for (const t of tables) {
    if (t.posX == null || t.posY == null) continue
    if (t.posX < minX) minX = t.posX
    if (t.posY < minY) minY = t.posY
    if (t.posX + TABLE_W > maxX) maxX = t.posX + TABLE_W
    if (t.posY + TABLE_H > maxY) maxY = t.posY + TABLE_H
  }
  for (const it of items) {
    const w = it.width  ?? (it.type === 'zone' ? ZONE_DEFAULT_W : LABEL_DEFAULT_W)
    const h = it.height ?? (it.type === 'zone' ? ZONE_DEFAULT_H : 40)
    if (it.posX < minX) minX = it.posX
    if (it.posY < minY) minY = it.posY
    if (it.posX + w > maxX) maxX = it.posX + w
    if (it.posY + h > maxY) maxY = it.posY + h
  }

  if (minX === Infinity) return { minX: 0, minY: 0, maxX: CANVAS_W, maxY: CANVAS_H }

  minX = Math.max(0, minX - CONTENT_PAD)
  minY = Math.max(0, minY - CONTENT_PAD)
  maxX = Math.min(CANVAS_W, maxX + CONTENT_PAD)
  maxY = Math.min(CANVAS_H, maxY + CONTENT_PAD)

  let w = maxX - minX
  let h = maxY - minY
  const ar = w / h
  if (ar > MAX_AR) {
    const newH = w / MAX_AR
    const delta = (newH - h) / 2
    minY = Math.max(0, minY - delta)
    maxY = Math.min(CANVAS_H, maxY + delta)
  } else if (ar < MIN_AR) {
    const newW = h * MIN_AR
    const delta = (newW - w) / 2
    minX = Math.max(0, minX - delta)
    maxX = Math.min(CANVAS_W, maxX + delta)
  }
  return { minX, minY, maxX, maxY }
}

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
  const [draftAreas, setDraftAreas] = useState<string[]>([])
  const [saving, setSaving]         = useState(false)
  const [planMode, setPlanMode]     = useState<boolean>(() => localStorage.getItem('mauidesk:plan-mode') === 'true')
  const [showInactive, setShowInactive] = useState(false)

  const [pendingDelete, setPendingDelete] = useState<ApiTable | null>(null)
  const [confirmReset, setConfirmReset]   = useState(false)
  const [busy, setBusy]                   = useState(false)
  const [editingItemIdx, setEditingItemIdx] = useState<number | null>(null)
  const [itemTextValue, setItemTextValue] = useState('')
  // Modal de zona: 'new' = crear; string = renombrar esa zona
  const [editingArea, setEditingArea]     = useState<{ mode: 'new' | 'rename'; old?: string } | null>(null)
  const [areaTextValue, setAreaTextValue] = useState('')
  // Zoom del plano. >=1 (1=ajusta al ancho disponible, >1 amplifica). Mobile arranca con 2.
  const [zoom, setZoom] = useState<number>(() => {
    if (typeof window === 'undefined') return 1
    return window.innerWidth < 640 ? 2 : 1
  })

  const canvasRef = useRef<HTMLDivElement>(null)
  // Estado del drag — vive en refs para no causar re-renders en cada pointermove
  const tableDrag = useRef<{ id: number; offsetX: number; offsetY: number } | null>(null)
  const itemDrag  = useRef<{ idx: number; mode: DragMode; offsetX: number; offsetY: number } | null>(null)
  const editingRef = useRef(editing)
  useEffect(() => { editingRef.current = editing }, [editing])

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
    }).catch(() => {
      toast({ variant: 'error', title: 'No se pudieron cargar las mesas', message: 'Recarga la página o verifica la conexión.' })
    })
  }, [toast])

  // Inicializar draft cuando entra a edición — auto-coloca las que no tienen posición
  useEffect(() => {
    if (editing) {
      const initial: typeof draft = {}
      const cols = Math.floor(CANVAS_W / (TABLE_W + 20))
      const placed = apiTables.filter(t => t.posX !== null && t.posY !== null)
      const unplaced = apiTables.filter(t => t.posX === null || t.posY === null)
      placed.forEach(t => {
        initial[t.id] = { posX: t.posX!, posY: t.posY!, area: t.area ?? DEFAULT_AREA }
      })
      unplaced.forEach((t, i) => {
        const col = i % cols
        const row = Math.floor(i / cols)
        initial[t.id] = {
          posX: 20 + col * (TABLE_W + 20),
          posY: CANVAS_H - TABLE_H - 20 - row * (TABLE_H + 15),
          area: t.area ?? DEFAULT_AREA,
        }
      })
      setDraft(initial)
      setDraftItems(layoutItems.map(it => ({ ...it })))

      // Zonas iniciales = unión de áreas existentes + defaults legacy en orden conocido
      const used = new Set(apiTables.map(t => t.area ?? DEFAULT_AREA))
      const ordered: string[] = []
      ;['salon', 'terraza', 'barra'].forEach(k => { if (used.has(k)) { ordered.push(k); used.delete(k) } })
      Array.from(used).sort().forEach(k => ordered.push(k))
      setDraftAreas(ordered.length > 0 ? ordered : [DEFAULT_AREA])
    }
  }, [editing])

  // ─── Drag global a nivel documento ────────────────────────────────────────
  // Razon: setPointerCapture es poco fiable en mobile cuando el wrapper tiene
  // overflow-auto. Escuchamos en document para que el move/up siempre llegue
  // aunque el dedo se salga del elemento original.
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      if (!editingRef.current) return
      const canvas = canvasRef.current
      if (!canvas) return
      if (!tableDrag.current && !itemDrag.current) return

      const cRect = canvas.getBoundingClientRect()
      const scale = cRect.width / CANVAS_W
      if (scale === 0) return

      if (tableDrag.current) {
        e.preventDefault()
        const localX = (e.clientX - cRect.left - tableDrag.current.offsetX) / scale
        const localY = (e.clientY - cRect.top  - tableDrag.current.offsetY) / scale
        const x = Math.max(0, Math.min(CANVAS_W - TABLE_W, localX))
        const y = Math.max(0, Math.min(CANVAS_H - TABLE_H, localY))
        const id = tableDrag.current.id
        setDraft(d => ({ ...d, [id]: { ...d[id], posX: x, posY: y } }))
        return
      }

      if (itemDrag.current) {
        e.preventDefault()
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
          const localX = (e.clientX - cRect.left) / scale
          const localY = (e.clientY - cRect.top)  / scale
          setDraftItems(items => items.map((it, i) => {
            if (i !== idx) return it
            const w = Math.max(80, Math.min(CANVAS_W - it.posX, localX - it.posX))
            const h = Math.max(40, Math.min(CANVAS_H - it.posY, localY - it.posY))
            return { ...it, width: w, height: h }
          }))
        }
      }
    }
    const onUp = () => {
      tableDrag.current = null
      itemDrag.current = null
    }
    document.addEventListener('pointermove', onMove, { passive: false })
    document.addEventListener('pointerup', onUp)
    document.addEventListener('pointercancel', onUp)
    return () => {
      document.removeEventListener('pointermove', onMove)
      document.removeEventListener('pointerup', onUp)
      document.removeEventListener('pointercancel', onUp)
    }
  }, [])

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

  // ─── Inicio del drag — solo registra estado, el move se maneja en document ─
  const onTablePointerDown = (e: React.PointerEvent<HTMLDivElement>, tableId: number) => {
    if (!editing) return
    e.stopPropagation()
    const target = e.currentTarget
    const rect = target.getBoundingClientRect()
    tableDrag.current = {
      id: tableId,
      offsetX: e.clientX - rect.left,
      offsetY: e.clientY - rect.top,
    }
  }

  const onItemPointerDown = (e: React.PointerEvent<HTMLDivElement>, idx: number, mode: DragMode = 'move') => {
    if (!editing) return
    e.stopPropagation()
    const target = e.currentTarget
    const rect = target.getBoundingClientRect()
    itemDrag.current = {
      idx,
      mode,
      offsetX: e.clientX - rect.left,
      offsetY: e.clientY - rect.top,
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

  // ─── Áreas / zonas (vista lista) ──────────────────────────────────────────
  const openNewArea = () => {
    setAreaTextValue('')
    setEditingArea({ mode: 'new' })
  }

  const openRenameArea = (old: string) => {
    setAreaTextValue(areaLabel(old))
    setEditingArea({ mode: 'rename', old })
  }

  const commitArea = () => {
    if (!editingArea) return
    const raw = areaTextValue.trim()
    if (!raw) { setEditingArea(null); return }
    const newName = raw.slice(0, 40)

    if (editingArea.mode === 'new') {
      // No duplicar (case-insensitive)
      if (draftAreas.some(a => areaLabel(a).toLowerCase() === newName.toLowerCase())) {
        toast({ variant: 'warning', title: 'Ese grupo ya existe' })
        return
      }
      setDraftAreas(arr => [...arr, newName])
    } else if (editingArea.mode === 'rename' && editingArea.old !== undefined) {
      const oldKey = editingArea.old
      if (areaLabel(oldKey) === newName) { setEditingArea(null); return }
      if (draftAreas.some(a => a !== oldKey && areaLabel(a).toLowerCase() === newName.toLowerCase())) {
        toast({ variant: 'warning', title: 'Ese grupo ya existe' })
        return
      }
      setDraftAreas(arr => arr.map(a => a === oldKey ? newName : a))
      setDraft(d => {
        const next: typeof d = {}
        for (const [id, v] of Object.entries(d)) {
          next[Number(id)] = v.area === oldKey ? { ...v, area: newName } : v
        }
        return next
      })
    }
    setEditingArea(null)
  }

  const deleteArea = (name: string) => {
    if (draftAreas.length <= 1) {
      toast({ variant: 'warning', title: 'Debe quedar al menos un grupo' })
      return
    }
    const remaining = draftAreas.filter(a => a !== name)
    const fallback = remaining[0]
    setDraftAreas(remaining)
    setDraft(d => {
      const next: typeof d = {}
      for (const [id, v] of Object.entries(d)) {
        next[Number(id)] = v.area === name ? { ...v, area: fallback } : v
      }
      return next
    })
    const count = Object.values(draft).filter(v => v.area === name).length
    if (count > 0) {
      toast({ variant: 'success', title: 'Grupo eliminado', message: `${count} mesa${count !== 1 ? 's movidas' : ' movida'} a "${areaLabel(fallback)}"` })
    }
  }

  const changeTableArea = (tableId: number, newArea: string) => {
    setDraft(d => ({ ...d, [tableId]: { ...(d[tableId] ?? { posX: null, posY: null, area: newArea }), area: newArea } }))
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
      // Si hay layout dibujado, mantener plano; si solo se editaron zonas (lista), no forzar
      const hasPositions = data.tables.some(t => t.posX !== null && t.posY !== null) || data.layoutItems.length > 0
      if (hasPositions) {
        setPlanMode(true)
        localStorage.setItem('mauidesk:plan-mode', 'true')
      }
      toast({ variant: 'success', title: 'Cambios guardados' })
    } catch (err: any) {
      toast({ variant: 'error', title: 'Error al guardar', message: err.response?.data?.error ?? 'Intenta nuevamente' })
    } finally {
      setSaving(false)
    }
  }

  const performReset = async () => {
    setBusy(true)
    try {
      const positions = apiTables.map(t => ({ id: t.id, posX: null, posY: null, area: t.area ?? DEFAULT_AREA }))
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

  const handleAddTable = async (areaForNew?: string) => {
    setBusy(true)
    try {
      const area = areaForNew ?? draftAreas[0] ?? DEFAULT_AREA
      const { data: created } = await api.post<ApiTable>('/tables', { area })
      const cols = Math.floor(CANVAS_W / (TABLE_W + 20))
      const idx  = Object.keys(draft).length
      const col  = idx % cols
      const row  = Math.floor(idx / cols)
      const posX = 20 + col * (TABLE_W + 20)
      const posY = CANVAS_H - TABLE_H - 20 - row * (TABLE_H + 15)

      setApiTables(ts => [...ts, created])
      setDraft(d => ({ ...d, [created.id]: { posX, posY, area: created.area ?? area } }))
      // Asegurar que esta área esté en draftAreas
      setDraftAreas(arr => arr.includes(area) ? arr : [...arr, area])
      toast({ variant: 'success', title: `Mesa ${created.number} agregada`, message: 'Recuerda guardar para confirmar.' })
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
  // En edición, respetamos siempre la elección del usuario (planMode) para que pueda
  // alternar lista <-> plano dentro del modo edición.
  const showPlan  = editing ? planMode : (planMode && hasLayout)

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Header */}
      <div className="bg-white border-b border-[#E2E8F0] px-3 sm:px-4 md:px-6 py-3 md:py-4 shrink-0">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="min-w-0 flex-1">
            <h1 className="text-lg md:text-xl font-black text-[#0F172A]">Mesas</h1>
            <p className="text-[#64748B] text-xs md:text-sm mt-0.5">
              {editing
                ? (showPlan ? 'Editando plano · arrastra mesas, etiquetas y zonas' : 'Editando grupos · renombra, agrega o reasigna mesas')
                : 'Plano del restaurante'}
            </p>
          </div>
          <div className="flex items-center gap-1.5 flex-wrap justify-end">
            {/* Toggle vista — ahora disponible siempre, incluso en edición */}
            {(hasLayout || editing) && (
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
                <span className="hidden sm:inline">Editar</span>
              </button>
            )}
            {editing && (
              <>
                <button onClick={() => handleAddTable()} disabled={busy || saving}
                  title="Agregar mesa"
                  className="flex items-center gap-1.5 bg-white border-2 border-emerald-400 text-emerald-600 hover:bg-emerald-50 font-semibold px-2.5 sm:px-3 py-2 rounded-xl text-xs sm:text-sm disabled:opacity-50">
                  <Plus size={14}/><span className="hidden md:inline">Mesa</span>
                </button>
                {showPlan && (
                  <>
                    <button onClick={addLabel} disabled={busy || saving}
                      title="Agregar etiqueta de texto"
                      className="flex items-center gap-1.5 bg-white border-2 border-[#94A3B8] text-[#64748B] hover:bg-[#EEF3F8] font-semibold px-2.5 sm:px-3 py-2 rounded-xl text-xs sm:text-sm disabled:opacity-50">
                      <Type size={14}/><span className="hidden md:inline">Etiqueta</span>
                    </button>
                    <button onClick={addZone} disabled={busy || saving}
                      title="Agregar zona visual"
                      className="flex items-center gap-1.5 bg-white border-2 border-[#F4792B] text-[#F4792B] hover:bg-orange-50 font-semibold px-2.5 sm:px-3 py-2 rounded-xl text-xs sm:text-sm disabled:opacity-50">
                      <Square size={14}/><span className="hidden md:inline">Zona</span>
                    </button>
                  </>
                )}
                {!showPlan && (
                  <button onClick={openNewArea} disabled={busy || saving}
                    title="Crear nuevo grupo"
                    className="flex items-center gap-1.5 bg-white border-2 border-[#F4792B] text-[#F4792B] hover:bg-orange-50 font-semibold px-2.5 sm:px-3 py-2 rounded-xl text-xs sm:text-sm disabled:opacity-50">
                    <Plus size={14}/><span className="hidden md:inline">Grupo</span>
                  </button>
                )}
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

        {/* Plano o Lista */}
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
            editing={editing}
            draftAreas={draftAreas}
            draft={draft}
            getTableStatus={getTableStatus}
            getTableOrder={getTableOrder}
            getTableTotal={getTableTotal}
            onTableClick={handleTable}
            onChangeTableArea={changeTableArea}
            onRenameArea={openRenameArea}
            onDeleteArea={deleteArea}
            onAddArea={openNewArea}
            onAddTableInArea={handleAddTable}
            onRequestDelete={(t) => setPendingDelete(t)}
            onToggleActive={toggleTableActive}
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
        message="Las mesas vuelven al modo lista y se borran todas las etiquetas y zonas visuales del plano. No se eliminan mesas ni zonas."
        confirmLabel="Restablecer"
        variant="warning"
        loading={busy}
        onConfirm={performReset}
        onCancel={() => !busy && setConfirmReset(false)}
      />

      {/* Modal para editar texto de label/zone del PLANO */}
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

      {/* Modal para crear / renombrar ZONA (vista lista) */}
      {editingArea && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
          onClick={() => setEditingArea(null)}>
          <div className="bg-white rounded-3xl w-full max-w-sm shadow-2xl p-5" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-black text-[#0F172A] mb-3">
              {editingArea.mode === 'new' ? 'Nuevo grupo' : 'Renombrar grupo'}
            </h3>
            <input
              autoFocus
              value={areaTextValue}
              onChange={e => setAreaTextValue(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') commitArea() }}
              maxLength={40}
              className="w-full bg-white border-2 border-[#E2E8F0] focus:border-[#0077B6] rounded-xl px-4 py-3 text-sm font-semibold text-[#0F172A] focus:outline-none mb-4"
              placeholder="Ej. Terraza, VIP, Patio…"
            />
            <div className="flex gap-2">
              <button onClick={() => setEditingArea(null)}
                className="flex-1 font-semibold py-2.5 rounded-xl text-[#64748B] bg-[#EEF3F8] hover:bg-[#E2E8F0]">
                Cancelar
              </button>
              <button onClick={commitArea}
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
  onTablePointerDown, onItemPointerDown,
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
  // touch-action: 'none' SOLO sobre elementos arrastrables cuando se edita —
  // así el dedo arrastra esos elementos sin que el navegador intente hacer
  // scroll/zoom. En el resto del canvas, touch-action 'auto' deja que el wrapper
  // haga pan/scroll normalmente. Sin esto en mobile no se puede ni arrastrar
  // ni navegar el plano.
  const dragTouch: React.CSSProperties = editing ? { touchAction: 'none' } : {}

  // En edición usamos canvas completo (el dueño puede mover mesas a cualquier
  // lugar). En lectura recortamos al bbox real del contenido + padding, así
  // los márgenes no se rompen al 100% y no hay franjas vacías scrolleables.
  const bounds = useMemo(() => {
    if (editing) return { minX: 0, minY: 0, maxX: CANVAS_W, maxY: CANVAS_H }
    return computeContentBounds(tables, layoutItems)
  }, [editing, tables, layoutItems])
  const viewW = bounds.maxX - bounds.minX
  const viewH = bounds.maxY - bounds.minY
  // Posicionamiento relativo al bbox (en %, relativo al canvas renderizado)
  const px = (x: number) => `${((x - bounds.minX) / viewW) * 100}%`
  const py = (y: number) => `${((y - bounds.minY) / viewH) * 100}%`
  const pw = (w: number) => `${(w / viewW) * 100}%`
  const ph = (h: number) => `${(h / viewH) * 100}%`

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
          {zoom > 1 ? 'Desliza con el dedo para navegar' : 'Plano del restaurante'}
        </p>
      </div>

      {/* Wrapper con scroll para zoom — touchAction auto deja al wrapper hacer pan con el dedo */}
      <div
        className="bg-white rounded-3xl shadow-sm border-2 border-dashed border-[#E2E8F0] overflow-auto"
        style={{ maxHeight: '78vh', touchAction: 'auto' }}
      >
        <div
          ref={canvasRef}
          className="relative bg-white select-none"
          style={{
            width: `${zoom * 100}%`,
            minWidth: zoom > 1 ? `${viewW * zoom * 0.6}px` : undefined,
            // Aspect ratio dinámico: en lectura sigue al bbox del contenido para
            // no dejar márgenes/franjas vacías en mobile; en edición es 12:7 fijo.
            aspectRatio: `${viewW} / ${viewH}`,
            // En el canvas SI dejamos pan touch para que el wrapper haga scroll al
            // tocar áreas vacías; las mesas/zonas tienen touchAction:'none' propio.
            touchAction: 'auto',
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
                    left:   px(it.posX),
                    top:    py(it.posY),
                    width:  pw(w),
                    height: ph(h),
                    backgroundColor: color + '22',
                    borderColor: color + '88',
                    zIndex: 5,
                    ...dragTouch,
                  }}
                >
                  <div className="absolute top-1.5 left-2 text-[11px] sm:text-xs font-bold uppercase tracking-wider"
                    style={{ color }}>
                    {it.text}
                  </div>
                  {editing && (
                    <>
                      {/* Toolbar: editar texto / borrar */}
                      <div className="absolute -top-2 -right-2 flex gap-1 z-10">
                        <button onPointerDown={e => e.stopPropagation()}
                          onClick={(e) => { e.stopPropagation(); onItemEditText(idx) }}
                          title="Editar texto"
                          className="w-6 h-6 rounded-md bg-white border border-[#E2E8F0] text-[#64748B] hover:bg-[#0077B6] hover:text-white flex items-center justify-center shadow-sm">
                          <Pencil size={11}/>
                        </button>
                        <button onPointerDown={e => e.stopPropagation()}
                          onClick={(e) => { e.stopPropagation(); onItemRemove(idx) }}
                          title="Eliminar zona"
                          className="w-6 h-6 rounded-md bg-white border border-[#E2E8F0] text-red-500 hover:bg-red-500 hover:text-white flex items-center justify-center shadow-sm">
                          <X size={12}/>
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
                      {/* Resize handle más grande para touch */}
                      <div onPointerDown={e => onItemPointerDown(e, idx, 'resize')}
                        className="absolute bottom-0 right-0 w-6 h-6 cursor-nwse-resize"
                        style={{ background: `linear-gradient(135deg, transparent 50%, ${color} 50%)`, touchAction: 'none' }}/>
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
                  left:   px(it.posX),
                  top:    py(it.posY),
                  width:  pw(w),
                  height: ph(h),
                  color,
                  zIndex: 6,
                  ...dragTouch,
                }}
              >
                <span className="px-2 py-0.5 truncate text-center w-full">{it.text}</span>
                {editing && (
                  <div className="absolute -top-2 -right-2 flex gap-1 z-10">
                    <button onPointerDown={e => e.stopPropagation()}
                      onClick={(e) => { e.stopPropagation(); onItemEditText(idx) }}
                      title="Editar texto"
                      className="w-6 h-6 rounded-md bg-white border border-[#E2E8F0] text-[#64748B] hover:bg-[#0077B6] hover:text-white flex items-center justify-center shadow-sm">
                      <Pencil size={11}/>
                    </button>
                    <button onPointerDown={e => e.stopPropagation()}
                      onClick={(e) => { e.stopPropagation(); onItemRemove(idx) }}
                      title="Eliminar etiqueta"
                      className="w-6 h-6 rounded-md bg-white border border-[#E2E8F0] text-red-500 hover:bg-red-500 hover:text-white flex items-center justify-center shadow-sm">
                      <X size={12}/>
                    </button>
                  </div>
                )}
              </div>
            )
          })}

          {/* Mesas — encima de zonas/labels */}
          {tables.map(t => {
            const live = editing ? draft[t.id] : { posX: t.posX, posY: t.posY, area: t.area ?? DEFAULT_AREA }
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
                  left:  px(live.posX!),
                  top:   py(live.posY!),
                  width: pw(TABLE_W),
                  height:ph(TABLE_H),
                  zIndex: 10,
                  filter: isInactive && !editing ? 'grayscale(0.8)' : undefined,
                  ...dragTouch,
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
                          className={`w-6 h-6 rounded-md flex items-center justify-center transition-colors ${
                            isInactive
                              ? 'bg-emerald-50 text-emerald-600 hover:bg-emerald-500 hover:text-white'
                              : 'bg-amber-50 text-amber-600 hover:bg-amber-500 hover:text-white'
                          }`}
                        >
                          {isInactive ? <Eye size={11}/> : <EyeOff size={11}/>}
                        </button>
                        <button
                          onPointerDown={e => e.stopPropagation()}
                          onClick={(e) => { e.stopPropagation(); onRequestDelete(t) }}
                          title={status === 'free' ? 'Eliminar / inhabilitar mesa' : 'Mesa ocupada — libérala primero'}
                          disabled={status !== 'free'}
                          className="w-6 h-6 rounded-md bg-red-50 hover:bg-red-500 hover:text-white text-red-500 flex items-center justify-center transition-colors disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-red-50 disabled:hover:text-red-500"
                        >
                          <Trash2 size={11}/>
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
            <p><strong>Arrastrar con el dedo o mouse:</strong> tocá una mesa o zona y deslizá para moverla.</p>
            <p><strong>Pan/zoom:</strong> tocá áreas vacías del plano para desplazarte; usá los botones +/- para acercar.</p>
            <p><strong>Acciones:</strong> el botón rojo elimina/inhabilita; el ojo alterna visibilidad; en zonas, el lápiz cambia texto y la esquina inferior derecha redimensiona.</p>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Vista Lista por áreas ───────────────────────────────────────────────────
function ListView({
  tables, editing, draftAreas, draft,
  getTableStatus, getTableOrder, getTableTotal, onTableClick,
  onChangeTableArea, onRenameArea, onDeleteArea, onAddArea, onAddTableInArea,
  onRequestDelete, onToggleActive,
}: {
  tables: ApiTable[]
  editing: boolean
  draftAreas: string[]
  draft: Record<number, { posX: number | null; posY: number | null; area: string }>
  getTableStatus: (id: number) => TableStatus
  getTableOrder: (id: number) => any
  getTableTotal: (id: number) => number
  onTableClick: (id: number) => void
  onChangeTableArea: (tableId: number, newArea: string) => void
  onRenameArea: (name: string) => void
  onDeleteArea: (name: string) => void
  onAddArea: () => void
  onAddTableInArea: (area: string) => void
  onRequestDelete: (t: ApiTable) => void
  onToggleActive: (t: ApiTable) => void
}) {
  // En lectura: derivar áreas de los datos reales (legacy en orden conocido + otras alfabéticas)
  let allAreas: string[]
  if (editing) {
    allAreas = draftAreas
  } else {
    const used = new Set(tables.map(t => t.area ?? DEFAULT_AREA))
    const ordered: string[] = []
    ;['salon', 'terraza', 'barra'].forEach(k => { if (used.has(k)) { ordered.push(k); used.delete(k) } })
    Array.from(used).sort().forEach(k => ordered.push(k))
    allAreas = ordered
  }

  // En edición, el área "real" de cada mesa viene del draft
  const tableAreaOf = (t: ApiTable): string =>
    editing ? (draft[t.id]?.area ?? t.area ?? DEFAULT_AREA) : (t.area ?? DEFAULT_AREA)

  return (
    <div className="space-y-5 md:space-y-6">
      {allAreas.map(area => {
        const areaTables = tables.filter(t => tableAreaOf(t) === area)
        // En lectura ocultamos áreas vacías; en edición SI las mostramos para que
        // el usuario las vea y pueda agregarles mesas o eliminarlas.
        if (!editing && areaTables.length === 0) return null
        return (
          <div key={area}>
            <div className="flex items-center gap-2 mb-3 flex-wrap">
              <h2 className="text-xs font-bold text-[#64748B] uppercase tracking-widest">{areaLabel(area)}</h2>
              <div className="flex-1 h-px bg-[#E2E8F0] min-w-[20px]" />
              <span className="text-xs text-[#94A3B8]">{areaTables.length} mesa{areaTables.length !== 1 ? 's' : ''}</span>
              {editing && (
                <div className="flex items-center gap-1">
                  <button onClick={() => onAddTableInArea(area)}
                    title="Agregar mesa a este grupo"
                    className="w-7 h-7 rounded-md bg-emerald-50 text-emerald-600 hover:bg-emerald-500 hover:text-white flex items-center justify-center transition-colors">
                    <Plus size={13}/>
                  </button>
                  <button onClick={() => onRenameArea(area)}
                    title="Renombrar grupo"
                    className="w-7 h-7 rounded-md bg-[#EEF3F8] text-[#64748B] hover:bg-[#0077B6] hover:text-white flex items-center justify-center transition-colors">
                    <Pencil size={12}/>
                  </button>
                  <button onClick={() => onDeleteArea(area)}
                    title="Eliminar grupo (las mesas se mueven a otro)"
                    className="w-7 h-7 rounded-md bg-red-50 text-red-500 hover:bg-red-500 hover:text-white flex items-center justify-center transition-colors">
                    <Trash2 size={12}/>
                  </button>
                </div>
              )}
            </div>
            {areaTables.length === 0 && editing && (
              <div className="bg-[#F8FAFC] border-2 border-dashed border-[#E2E8F0] rounded-2xl py-6 text-center">
                <p className="text-xs text-[#94A3B8]">Sin mesas en este grupo</p>
                <button onClick={() => onAddTableInArea(area)}
                  className="mt-2 inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-600 hover:text-emerald-700">
                  <Plus size={12}/> Agregar mesa
                </button>
              </div>
            )}
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2 md:gap-3">
              {areaTables.map(t => {
                const status = getTableStatus(t.id)
                const total  = getTableTotal(t.id)
                const order  = getTableOrder(t.id)
                const s      = STATUS[status]
                const isInactive = t.active === false
                if (editing) {
                  return (
                    <div key={t.id}
                      className={`${s.cardBg} ${s.ring} rounded-2xl p-3 md:p-4 shadow-sm relative ${isInactive ? 'opacity-60' : ''}`}>
                      <div className="flex items-start justify-between mb-2 gap-2">
                        <span className={`text-3xl md:text-4xl font-black ${s.numColor} leading-none`}>{t.number}</span>
                        <div className="flex items-center gap-1">
                          <button onClick={() => onToggleActive(t)}
                            title={isInactive ? 'Reactivar' : 'Inhabilitar'}
                            className={`w-6 h-6 rounded-md flex items-center justify-center transition-colors ${
                              isInactive
                                ? 'bg-emerald-50 text-emerald-600 hover:bg-emerald-500 hover:text-white'
                                : 'bg-amber-50 text-amber-600 hover:bg-amber-500 hover:text-white'
                            }`}>
                            {isInactive ? <Eye size={11}/> : <EyeOff size={11}/>}
                          </button>
                          <button onClick={() => onRequestDelete(t)}
                            title={status === 'free' ? 'Eliminar' : 'Mesa ocupada — libérala primero'}
                            disabled={status !== 'free'}
                            className="w-6 h-6 rounded-md bg-red-50 hover:bg-red-500 hover:text-white text-red-500 flex items-center justify-center transition-colors disabled:opacity-30 disabled:cursor-not-allowed">
                            <Trash2 size={11}/>
                          </button>
                        </div>
                      </div>
                      <div className="flex items-center gap-1 text-[#94A3B8] mb-2">
                        <Users size={11}/>
                        <span className="text-[10px]">{t.capacity ?? 4} pers.</span>
                      </div>
                      {/* Selector de grupo — la clave de la edición en lista */}
                      <label className="block">
                        <span className="text-[10px] font-semibold text-[#64748B] flex items-center gap-1 mb-1">
                          <ArrowRightLeft size={10}/> Grupo
                        </span>
                        <select
                          value={tableAreaOf(t)}
                          onChange={e => onChangeTableArea(t.id, e.target.value)}
                          className="w-full bg-white border border-[#E2E8F0] rounded-lg px-2 py-1.5 text-xs font-semibold text-[#0F172A] focus:outline-none focus:border-[#0077B6]">
                          {draftAreas.map(a => (
                            <option key={a} value={a}>{areaLabel(a)}</option>
                          ))}
                        </select>
                      </label>
                      {isInactive && (
                        <div className="absolute top-2 left-2">
                          <span className="text-[9px] font-bold text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded-full">Inhabilitada</span>
                        </div>
                      )}
                    </div>
                  )
                }
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

      {editing && (
        <div className="pt-2">
          <button onClick={onAddArea}
            className="w-full sm:w-auto inline-flex items-center justify-center gap-2 bg-white border-2 border-dashed border-[#F4792B] text-[#F4792B] hover:bg-orange-50 font-bold px-5 py-3 rounded-2xl transition-all">
            <Plus size={16}/> Agregar nuevo grupo
          </button>
          <div className="bg-blue-50 border border-blue-200 rounded-2xl p-3 mt-3 text-xs text-blue-800 flex items-start gap-2">
            <ArrowRightLeft size={14} className="shrink-0 mt-0.5"/>
            <div>
              Los grupos de la lista son independientes del plano del mapa: podés crear los que quieras (VIP, Patio, Sótano, etc.) y mover cualquier mesa entre ellos con el menú "Grupo" de cada tarjeta. Los cambios se aplican al apretar <strong>Guardar</strong>.
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
