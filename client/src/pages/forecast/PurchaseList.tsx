import { useState } from 'react'
import { Loader2, Minus, Plus, Printer, RefreshCw } from 'lucide-react'
import { usePurchaseList } from '../../hooks/usePurchaseList'
import { printPurchaseList, type PurchaseListItem } from '../../api/forecast'
import { useToastStore } from '../../store/toast'
import { addDays, localDateString } from '../../utils/dates'

const kg = (n: number) => `${n.toLocaleString('es-PE', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} kg`
const dayLabel = (d: string) => new Date(d + 'T00:00:00').toLocaleDateString('es-PE', { weekday: 'short', day: '2-digit', month: '2-digit' })

// Máximo de días que se puede cubrir: lo pronosticado (3) y la vida útil del insumo
const maxCoverage = (it: PurchaseListItem) => Math.min(3, it.shelfLifeDays ?? 3)

function SupplyCard({ it, onCoverage, busy }: { it: PurchaseListItem; onCoverage: (d: number) => void; busy: boolean }) {
  const max = maxCoverage(it)
  return (
    <div className="bg-white rounded-2xl border border-[#E2E8F0] p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-black text-[#0F172A]">{it.name}</p>
          <p className="text-[11px] text-[#94A3B8]">Sugerido para cubrir {it.coverageDays} día{it.coverageDays === 1 ? '' : 's'} de atención</p>
        </div>
        <div className="text-right">
          <p className={`text-2xl font-black ${it.toBuy > 0 ? 'text-[#0077B6]' : 'text-[#94A3B8]'}`}>{it.toBuy > 0 ? kg(it.toBuy) : 'No comprar'}</p>
          <p className="text-[11px] text-[#94A3B8]">redondeado a medio kilo</p>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <span className="text-xs font-semibold text-[#64748B]">Cubrir</span>
        <button disabled={busy || it.coverageDays <= 1} onClick={() => onCoverage(it.coverageDays - 1)}
          className="w-8 h-8 rounded-lg bg-[#EEF3F8] flex items-center justify-center disabled:opacity-40"><Minus size={14} /></button>
        <span className="text-sm font-black w-14 text-center">{it.coverageDays} día{it.coverageDays === 1 ? '' : 's'}</span>
        <button disabled={busy || it.coverageDays >= max} onClick={() => onCoverage(it.coverageDays + 1)}
          className="w-8 h-8 rounded-lg bg-[#EEF3F8] flex items-center justify-center disabled:opacity-40"><Plus size={14} /></button>
        <span className="text-[11px] text-[#94A3B8]">máx. {max}{it.shelfLifeDays !== null && it.shelfLifeDays < 3 ? ` (dura ${it.shelfLifeDays} días)` : ''}</span>
      </div>

      <div className="grid grid-cols-3 gap-2 text-center">
        <div className="bg-[#EEF3F8] rounded-xl p-2">
          <p className="text-[10px] font-bold text-[#64748B] uppercase">Se usará</p>
          <p className="text-sm font-black text-[#0F172A]">{kg(it.forecastSum)}</p>
        </div>
        <div className="bg-[#EEF3F8] rounded-xl p-2">
          <p className="text-[10px] font-bold text-[#64748B] uppercase">Hay</p>
          <p className="text-sm font-black text-[#0F172A]">{kg(it.available)}</p>
          <p className="text-[10px] text-[#94A3B8]">{it.availableSource === 'conteo' ? 'contado hoy' : 'estimado'}</p>
        </div>
        <div className="bg-[#EEF3F8] rounded-xl p-2">
          <p className="text-[10px] font-bold text-[#64748B] uppercase">Por si acaso</p>
          <p className="text-sm font-black text-[#0F172A]">{kg(it.safetyStock)}</p>
          <p className="text-[10px] text-[#94A3B8]">{Math.round(it.serviceLevel * 100)} % seguro</p>
        </div>
      </div>
      <p className="text-[11px] text-[#94A3B8]">
        Pronóstico: {it.forecast.map(f => `${dayLabel(f.date)} ${f.kg.toFixed(1)} kg`).join(' · ')}
      </p>
    </div>
  )
}

export default function PurchaseList() {
  const pushToast = useToastStore(s => s.push)
  const [date, setDate] = useState(localDateString())
  const [coverage, setCoverage] = useState<Record<number, number>>({})
  const [printing, setPrinting] = useState(false)
  const { data, loading, error, reload } = usePurchaseList(date, coverage)

  const print = async () => {
    setPrinting(true)
    try {
      await printPurchaseList(date, coverage)
      pushToast({ variant: 'success', title: 'Lista enviada a la ticketera' })
    } catch (err) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error
      pushToast({ variant: 'error', title: 'No se pudo imprimir', message: msg ?? 'Revisa la impresora.' })
    } finally {
      setPrinting(false)
    }
  }

  return (
    <div className="h-full overflow-y-auto bg-[#EEF3F8]">
      <div className="bg-white border-b border-[#E2E8F0] px-3 sm:px-6 py-3 sm:py-4 sticky top-0 z-10">
        <div className="flex items-start sm:items-center justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-lg sm:text-xl font-black text-[#0F172A]">Lista de compra</h1>
            <p className="text-[#64748B] text-xs sm:text-sm">Cuánto comprar de cada insumo crítico, según lo que se espera vender</p>
          </div>
          <div className="flex items-center gap-2">
            <input type="date" value={date} max={addDays(localDateString(), 1)} onChange={e => e.target.value && setDate(e.target.value)}
              className="bg-[#EEF3F8] rounded-xl px-3 py-2 text-sm text-[#0F172A]" />
            <button onClick={reload} disabled={loading} title="Volver a calcular"
              className="p-2 rounded-xl bg-[#EEF3F8] text-[#64748B] hover:text-[#0077B6] disabled:opacity-40">
              <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
            </button>
          </div>
        </div>
      </div>
      <div className="p-3 sm:p-6 space-y-3 max-w-3xl mx-auto">
        {error && <div className="bg-red-50 border border-red-200 text-red-700 rounded-2xl p-4 text-sm font-semibold">{error}</div>}
        {loading && !data ? (
          <div className="flex items-center justify-center h-64 text-[#94A3B8]"><Loader2 className="animate-spin" /></div>
        ) : data && (
          <>
            <p className="text-[11px] text-[#64748B] px-1">
              Calculado con lo vendido hasta la noche del {dayLabel(data.night)}. «Hay» es el conteo de apertura de la fecha o, si no se contó, lo estimado con las ventas. Es una sugerencia: decide tú según el mercado.
            </p>
            {data.items.map(it => (
              <SupplyCard key={it.supplyId} it={it} busy={loading} onCoverage={d => setCoverage(c => ({ ...c, [it.supplyId]: d }))} />
            ))}
            <button onClick={print} disabled={printing || loading}
              className="w-full bg-[#0077B6] hover:bg-[#005a8a] text-white font-bold py-4 rounded-xl shadow-md disabled:opacity-40 flex items-center justify-center gap-2">
              {printing ? <Loader2 size={16} className="animate-spin" /> : <Printer size={16} />} Imprimir
            </button>
          </>
        )}
      </div>
    </div>
  )
}
