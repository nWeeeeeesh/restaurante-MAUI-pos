import { useCallback, useEffect, useMemo, useState } from 'react'
import { Ban, Loader2 } from 'lucide-react'
import api from '../../api/client'
import { useToastStore } from '../../store/toast'
import { localDateString } from '../../utils/dates'
import { errorMessage, inputCls, parseNumber, UNIT_LABEL, type CountRow, type LostSale, type Supply } from './model'
import { Field } from './ui'

// Conteo físico al cierre: solo los insumos críticos (los del estudio).
// Volver a guardar el mismo día corrige el conteo (queda en el registro).
export default function CountsTab({ supplies }: { supplies: Supply[] }) {
  const pushToast = useToastStore(s => s.push)
  const today = localDateString()
  const critical = useMemo(() => supplies.filter(s => s.critical), [supplies])

  const [date, setDate] = useState(today)
  const [values, setValues] = useState<Record<number, string>>({})
  const [saved, setSaved] = useState<CountRow[]>([])
  const [lost, setLost] = useState<LostSale[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const applySaved = (rows: CountRow[]) => {
    setSaved(rows)
    setValues(Object.fromEntries(rows.map(r => [r.supplyId, String(r.quantity)])))
  }

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [counts, lostSales] = await Promise.all([
        api.get<CountRow[]>('/inventory/counts', { params: { date } }),
        api.get<LostSale[]>('/inventory/lost-sales', { params: { from: date, to: date } }),
      ])
      applySaved(counts.data)
      setLost(lostSales.data)
    } catch (err) {
      pushToast({ variant: 'error', title: 'No se pudo cargar el cierre', message: errorMessage(err, 'Verifica la conexión.') })
    } finally {
      setLoading(false)
    }
  }, [date, pushToast])

  useEffect(() => { load() }, [load])

  const items = critical
    .map(s => ({ supplyId: s.id, quantity: parseNumber(values[s.id] ?? '') }))
    .filter((i): i is { supplyId: number; quantity: number } => i.quantity !== null)
  const invalid = items.some(i => i.quantity < 0)
  const missing = critical.length - items.length

  const save = async () => {
    if (items.length === 0 || invalid) return
    setSaving(true)
    try {
      const { data } = await api.put<CountRow[]>(`/inventory/counts/${date}`, { items })
      applySaved(data)
      pushToast({
        variant: 'success', title: 'Conteo guardado',
        message: missing > 0 ? `${items.length} insumos · faltan ${missing}` : `${items.length} insumos`,
      })
    } catch (err) {
      pushToast({ variant: 'error', title: 'No se pudo guardar el conteo', message: errorMessage(err) })
    } finally {
      setSaving(false)
    }
  }

  // "No había" del día agrupado por plato o insumo
  const lostSummary = Object.entries(lost.reduce<Record<string, number>>((acc, l) => {
    const name = l.dishName ?? l.supplyName ?? '—'
    acc[name] = (acc[name] ?? 0) + (l.quantity ?? 1)
    return acc
  }, {})).sort((a, b) => b[1] - a[1])

  const countedBy = [...new Set(saved.map(r => r.createdByName).filter(Boolean))].join(', ')

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-2xl shadow-sm p-4 space-y-4">
        <div className="flex items-end justify-between gap-3">
          <div>
            <h2 className="font-black text-[#0F172A]">Cierre del día</h2>
            <p className="text-xs text-[#64748B]">Cuánto queda de cada insumo al cerrar</p>
          </div>
          <div className="w-40">
            <Field label="Fecha">
              <input type="date" value={date} max={today} onChange={e => setDate(e.target.value || today)} className={inputCls} />
            </Field>
          </div>
        </div>

        {loading ? (
          <div className="py-6 flex justify-center"><Loader2 className="animate-spin text-[#0077B6]" /></div>
        ) : critical.length === 0 ? (
          <p className="text-sm text-[#64748B]">No hay insumos marcados como críticos. El dueño los marca en la pestaña Insumos.</p>
        ) : (
          <div className="divide-y divide-[#E2E8F0]">
            {critical.map(s => (
              <label key={s.id} className="flex items-center gap-3 py-2.5">
                <span className="flex-1 text-sm font-semibold text-[#0F172A]">{s.name}</span>
                <input value={values[s.id] ?? ''} onChange={e => setValues(v => ({ ...v, [s.id]: e.target.value }))}
                  inputMode="decimal" placeholder="—"
                  className="w-24 bg-[#EEF3F8] rounded-xl px-3 py-2.5 text-right text-base font-bold focus:outline-none focus:ring-2 focus:ring-[#0077B6]/30 border border-transparent focus:border-[#0077B6]" />
                <span className="w-10 text-xs text-[#64748B]">{UNIT_LABEL[s.unit]}</span>
              </label>
            ))}
          </div>
        )}

        {saved.length > 0 && (
          <p className="text-xs text-[#64748B]">
            Ya hay conteo de este día ({saved.length} insumos{countedBy ? `, ${countedBy}` : ''}). Guardar otra vez lo corrige.
          </p>
        )}

        <button onClick={save} disabled={items.length === 0 || invalid || saving}
          className="w-full bg-[#0077B6] hover:bg-[#005a8a] text-white font-bold py-4 rounded-xl shadow-md disabled:opacity-40 flex items-center justify-center gap-2 transition-colors">
          {saving && <Loader2 size={16} className="animate-spin" />}
          Guardar conteo{missing > 0 && items.length > 0 ? ` (faltan ${missing})` : ''}
        </button>
      </div>

      <div className="bg-white rounded-2xl shadow-sm p-4">
        <h2 className="font-black text-[#0F172A] flex items-center gap-2"><Ban size={16} className="text-[#F4792B]" /> Pidieron y no había</h2>
        {lostSummary.length === 0 ? (
          <p className="text-sm text-[#94A3B8] mt-2">Sin registros este día.</p>
        ) : (
          <ul className="mt-2 space-y-1">
            {lostSummary.map(([name, n]) => (
              <li key={name} className="flex justify-between text-sm">
                <span className="text-[#0F172A]">{name}</span>
                <span className="font-bold text-[#F4792B]">×{n}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
