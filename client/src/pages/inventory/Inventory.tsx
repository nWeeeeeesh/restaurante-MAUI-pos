import { useCallback, useEffect, useState } from 'react'
import { ClipboardCheck, Download, Loader2, Package, ShoppingCart, Trash2, X } from 'lucide-react'
import api from '../../api/client'
import { useAuthStore } from '../../store/auth'
import { useToastStore } from '../../store/toast'
import { addDays, localDateString } from '../../utils/dates'
import { errorMessage, inputCls, type Supply } from './model'
import { Field } from './ui'
import PurchasesTab from './PurchasesTab'
import WasteTab from './WasteTab'
import CountsTab from './CountsTab'
import SuppliesTab from './SuppliesTab'

type Tab = 'purchases' | 'waste' | 'counts' | 'supplies'

const TABS: { key: Tab; label: string; icon: typeof Package; ownerOnly?: boolean }[] = [
  { key: 'purchases', label: 'Compras',  icon: ShoppingCart },
  { key: 'waste',     label: 'Merma',    icon: Trash2 },
  { key: 'counts',    label: 'Cierre',   icon: ClipboardCheck },
  { key: 'supplies',  label: 'Insumos',  icon: Package, ownerOnly: true },
]

const EXPORTS: { table: string; label: string }[] = [
  { table: 'purchases',  label: 'Compras' },
  { table: 'waste',      label: 'Merma' },
  { table: 'counts',     label: 'Conteos de cierre' },
  { table: 'lost_sales', label: 'Ventas perdidas ("No había")' },
  { table: 'stockouts',  label: 'Quiebres (platos agotados)' },
  { table: 'supplies',   label: 'Catálogo de insumos' },
]

const TAB_KEY = 'mauidesk.inventory.tab'

function readTab(): Tab {
  try {
    const t = localStorage.getItem(TAB_KEY)
    if (t && TABS.some(x => x.key === t)) return t as Tab
  } catch { /* sin almacenamiento: pestaña por defecto */ }
  return 'purchases'
}

// CSV por tabla para el análisis de la tesis. El endpoint exige el token, por
// eso se descarga como blob y no con un enlace directo.
function ExportDialog({ onClose }: { onClose: () => void }) {
  const pushToast = useToastStore(s => s.push)
  const today = localDateString()
  const [from, setFrom] = useState(addDays(today, -29))
  const [to, setTo] = useState(today)
  const [busy, setBusy] = useState<string | null>(null)

  const download = async (table: string) => {
    setBusy(table)
    try {
      const res = await api.get<Blob>('/inventory/export', { params: { table, from, to }, responseType: 'blob', timeout: 30000 })
      const url = URL.createObjectURL(res.data)
      const a = document.createElement('a')
      a.href = url
      a.download = `maui-${table}-${from}_${to}.csv`
      a.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      // Con responseType blob el error JSON también llega como blob
      let message = errorMessage(err)
      const data = (err as { response?: { data?: unknown } })?.response?.data
      if (data instanceof Blob) {
        try { message = JSON.parse(await data.text()).error ?? message } catch { /* se queda el genérico */ }
      }
      pushToast({ variant: 'error', title: 'No se pudo exportar', message })
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-white rounded-3xl w-full max-w-md shadow-2xl p-5 space-y-4" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-black text-[#0F172A]">Exportar CSV</h3>
            <p className="text-xs text-[#64748B]">Un archivo por tabla, con fechas en hora local</p>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-xl bg-[#EEF3F8] flex items-center justify-center"><X size={15} /></button>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Desde">
            <input type="date" value={from} max={to} onChange={e => setFrom(e.target.value || from)} className={inputCls} />
          </Field>
          <Field label="Hasta">
            <input type="date" value={to} min={from} max={today} onChange={e => setTo(e.target.value || to)} className={inputCls} />
          </Field>
        </div>
        <div className="space-y-2">
          {EXPORTS.map(x => (
            <button key={x.table} onClick={() => download(x.table)} disabled={busy !== null}
              className="w-full flex items-center justify-between px-4 py-3 rounded-xl bg-[#EEF3F8] hover:bg-[#E2E8F0] text-sm font-semibold text-[#0F172A] disabled:opacity-50">
              {x.label}
              {busy === x.table ? <Loader2 size={15} className="animate-spin text-[#0077B6]" /> : <Download size={15} className="text-[#0077B6]" />}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

export default function Inventory() {
  const isOwner = useAuthStore(s => s.user?.role) === 'owner'
  const pushToast = useToastStore(s => s.push)
  const [tab, setTab] = useState<Tab>(readTab)
  const [supplies, setSupplies] = useState<Supply[]>([])
  const [showExport, setShowExport] = useState(false)

  const loadSupplies = useCallback(async () => {
    try {
      const { data } = await api.get<Supply[]>('/inventory/supplies')
      setSupplies(data)
    } catch (err) {
      pushToast({ variant: 'error', title: 'No se pudieron cargar los insumos', message: errorMessage(err, 'Verifica la conexión.') })
    }
  }, [pushToast])

  useEffect(() => { loadSupplies() }, [loadSupplies])

  const visibleTabs = TABS.filter(t => !t.ownerOnly || isOwner)
  const current = visibleTabs.some(t => t.key === tab) ? tab : 'purchases'

  const selectTab = (t: Tab) => {
    setTab(t)
    try { localStorage.setItem(TAB_KEY, t) } catch { /* solo es una comodidad */ }
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-2xl mx-auto p-4 md:p-6 space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-black text-[#0F172A]">Inventario</h1>
            <p className="text-xs text-[#64748B]">Compras, merma y cierre de insumos</p>
          </div>
          <button onClick={() => setShowExport(true)}
            className="flex items-center gap-2 px-3 py-2 rounded-xl bg-white border border-[#E2E8F0] text-sm font-semibold text-[#0077B6] hover:border-[#0077B6]">
            <Download size={15} /> Exportar
          </button>
        </div>

        <div className="flex bg-white rounded-2xl p-1 shadow-sm">
          {visibleTabs.map(({ key, label, icon: Icon }) => (
            <button key={key} onClick={() => selectTab(key)}
              className={`flex-1 flex flex-col sm:flex-row items-center justify-center gap-1 py-2.5 rounded-xl text-xs sm:text-sm font-semibold transition-all ${
                current === key ? 'bg-[#0077B6] text-white shadow-md' : 'text-[#64748B]'
              }`}>
              <Icon size={16} /> {label}
            </button>
          ))}
        </div>

        {current === 'purchases' && <PurchasesTab supplies={supplies} />}
        {current === 'waste' && <WasteTab supplies={supplies} />}
        {current === 'counts' && <CountsTab supplies={supplies} />}
        {current === 'supplies' && isOwner && <SuppliesTab onChanged={loadSupplies} />}
      </div>

      {showExport && <ExportDialog onClose={() => setShowExport(false)} />}
    </div>
  )
}
