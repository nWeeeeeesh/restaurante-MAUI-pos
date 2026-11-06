import { useMemo, useState } from 'react'
import { AlertTriangle, ChevronDown, ChevronRight, Loader2, Plus, Scale } from 'lucide-react'
import { useRecipes } from '../../hooks/useRecipes'
import { calibrate, saveRecipe, type RecipeDish, type RecipeSupply } from '../../api/recipes'
import { useToastStore } from '../../store/toast'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { addDays, localDateString } from '../../utils/dates'

const inputCls = 'w-full bg-[#EEF3F8] rounded-lg px-2 py-2 text-sm text-right focus:outline-none focus:ring-2 focus:ring-[#0077B6]/30'

function errorMessage(err: unknown, fallback = 'Intenta nuevamente.'): string {
  const data = (err as { response?: { data?: { error?: string; issues?: { message: string }[] } } })?.response?.data
  return data?.issues?.[0]?.message ?? data?.error ?? fallback
}

const parseGrams = (v: string) => {
  const n = Number(v.trim().replace(',', '.'))
  return v.trim() !== '' && Number.isFinite(n) ? n : null
}

// Editor de la receta de un plato: una fila por variante, una columna por insumo crítico
function DishEditor({ dish, supplies, onSaved }: { dish: RecipeDish; supplies: RecipeSupply[]; onSaved: () => void }) {
  const pushToast = useToastStore(s => s.push)
  const initial = useMemo(() => {
    const variants = ['', ...new Set(dish.items.map(i => i.variant).filter(v => v !== ''))]
    const grams: Record<string, string> = {}
    for (const i of dish.items) grams[`${i.variant}|${i.supplyId}`] = String(i.gramsClean)
    return { variants, grams }
  }, [dish])
  const [variants, setVariants] = useState(initial.variants)
  const [grams, setGrams] = useState(initial.grams)
  const [newVariant, setNewVariant] = useState('')
  const [saving, setSaving] = useState(false)

  const invalid = Object.values(grams).some(v => v.trim() !== '' && ((parseGrams(v) ?? -1) <= 0 || (parseGrams(v) ?? 0) > 5000))

  const save = async () => {
    setSaving(true)
    try {
      const items = variants.flatMap(variant => supplies.flatMap(s => {
        const g = parseGrams(grams[`${variant}|${s.id}`] ?? '')
        return g !== null && g > 0 ? [{ variant, supplyId: s.id, gramsClean: g }] : []
      }))
      await saveRecipe(dish.dishId, items)
      pushToast({ variant: 'success', title: 'Receta guardada', message: dish.name })
      onSaved()
    } catch (err) {
      pushToast({ variant: 'error', title: 'No se pudo guardar la receta', message: errorMessage(err) })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="px-4 pb-4 space-y-3">
      <p className="text-[11px] text-[#94A3B8]">Gramos de producto limpio por porción (ya sin espinas ni cáscara). El sistema los convierte a kg comprados con el rendimiento de cada insumo. Deja vacío lo que el plato no lleva.</p>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-[#64748B]">
              <th className="text-left py-1 pr-2 font-bold">Variante</th>
              {supplies.map(s => <th key={s.id} className="py-1 px-1 font-bold text-right whitespace-nowrap">{s.name} (g)</th>)}
            </tr>
          </thead>
          <tbody>
            {variants.map(v => (
              <tr key={v || 'base'}>
                <td className="py-1 pr-2 font-semibold text-[#0F172A] whitespace-nowrap">{v || 'Receta del plato'}</td>
                {supplies.map(s => (
                  <td key={s.id} className="py-1 px-1 min-w-[4.5rem]">
                    <input inputMode="decimal" value={grams[`${v}|${s.id}`] ?? ''} placeholder="—"
                      onChange={e => setGrams(g => ({ ...g, [`${v}|${s.id}`]: e.target.value }))} className={inputCls} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex gap-2 items-center">
        <input value={newVariant} onChange={e => setNewVariant(e.target.value)} maxLength={60} placeholder="Opción del modificador, ej: Calamar"
          className="flex-1 bg-[#EEF3F8] rounded-lg px-3 py-2 text-xs" />
        <button type="button" disabled={!newVariant.trim() || variants.includes(newVariant.trim())}
          onClick={() => { setVariants(vs => [...vs, newVariant.trim()]); setNewVariant('') }}
          className="flex items-center gap-1 px-3 py-2 rounded-lg bg-[#EEF3F8] text-xs font-bold text-[#0077B6] disabled:opacity-40">
          <Plus size={12} /> Variante
        </button>
      </div>
      <p className="text-[11px] text-[#94A3B8]">Una variante reemplaza la receta cuando el mozo elige esa opción (mismo nombre que en el menú).</p>
      <button onClick={save} disabled={saving || invalid}
        className="w-full bg-[#0077B6] hover:bg-[#005a8a] text-white font-bold py-3 rounded-xl disabled:opacity-40 flex items-center justify-center gap-2">
        {saving && <Loader2 size={15} className="animate-spin" />} Guardar receta
      </button>
      {invalid && <p className="text-xs text-red-500">Los gramos van de 1 a 5000.</p>}
    </div>
  )
}

export default function Recipes() {
  const pushToast = useToastStore(s => s.push)
  const { data, loading, error, reload } = useRecipes()
  const [open, setOpen] = useState<number | null>(null)
  const [filter, setFilter] = useState('')
  const today = localDateString()
  const [calFrom, setCalFrom] = useState(addDays(today, -27))
  const [calTo, setCalTo] = useState(addDays(today, -1))
  const [confirming, setConfirming] = useState(false)
  const [calibrating, setCalibrating] = useState(false)

  const supplies = useMemo(() => data?.supplies ?? [], [data])
  const nameOf = useMemo(() => new Map(supplies.map(s => [s.id, s.name])), [supplies])
  const dishes = (data?.dishes ?? []).filter(d => d.name.toLowerCase().includes(filter.trim().toLowerCase()))
  const byCategory = useMemo(() => {
    const m = new Map<string, RecipeDish[]>()
    for (const d of dishes) {
      const c = d.category ?? 'Sin categoría'
      m.set(c, [...(m.get(c) ?? []), d])
    }
    return [...m.entries()]
  }, [dishes])

  const runCalibration = async () => {
    setCalibrating(true)
    try {
      const r = await calibrate(calFrom, calTo)
      const out = r.factors.filter(f => f.outOfRange).map(f => f.code)
      pushToast({
        variant: out.length > 0 ? 'warning' : 'success',
        title: 'Recetas calibradas',
        message: out.length > 0 ? `Revisa la receta de ${out.join(', ')}: el factor está fuera de 0.70–1.30` : r.factors.map(f => `${f.code} ${f.factor?.toFixed(3) ?? '—'}`).join(' · '),
      })
      setConfirming(false)
      reload()
    } catch (err) {
      pushToast({ variant: 'error', title: 'No se pudo calibrar', message: errorMessage(err) })
    } finally {
      setCalibrating(false)
    }
  }

  return (
    <div className="h-full overflow-y-auto bg-[#EEF3F8]">
      <div className="bg-white border-b border-[#E2E8F0] px-3 sm:px-6 py-3 sm:py-4 sticky top-0 z-10">
        <h1 className="text-lg sm:text-xl font-black text-[#0F172A]">Recetas</h1>
        <p className="text-[#64748B] text-xs sm:text-sm">Cuánto de cada insumo crítico lleva una porción</p>
      </div>
      <div className="p-3 sm:p-6 space-y-4 max-w-4xl mx-auto">
        {error && <div className="bg-red-50 border border-red-200 text-red-700 rounded-2xl p-4 text-sm font-semibold">{error}</div>}
        {loading && !data ? (
          <div className="flex items-center justify-center h-64 text-[#94A3B8]"><Loader2 className="animate-spin" /></div>
        ) : data && (
          <>
            <div className="bg-white rounded-2xl border border-[#E2E8F0] p-4 space-y-3">
              <h2 className="font-black text-[#0F172A] text-sm flex items-center gap-2"><Scale size={15} /> Calibración</h2>
              <p className="text-[11px] text-[#94A3B8]">El factor compara lo que realmente se gastó (según los conteos) con lo que dice la receta. 1.05 = se usa 5 % más que la receta.</p>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {supplies.map(s => (
                  <div key={s.id} className={`rounded-xl p-3 ${s.factor?.outOfRange ? 'bg-amber-50' : 'bg-[#EEF3F8]'}`}>
                    <p className="text-xs font-bold text-[#64748B]">{s.name}</p>
                    <p className="text-lg font-black text-[#0F172A]">{s.factor ? s.factor.value.toFixed(3) : '—'}</p>
                    <p className="text-[10px] text-[#94A3B8]">{s.factor ? `${s.factor.from} a ${s.factor.to}` : 'sin calibrar (se usa 1)'}</p>
                    {s.factor?.outOfRange && <p className="text-[10px] font-bold text-amber-700 flex items-center gap-1 mt-1"><AlertTriangle size={10} /> revisar receta</p>}
                  </div>
                ))}
              </div>
              <div className="flex flex-wrap items-end gap-2">
                <label className="text-xs font-semibold text-[#64748B]">Desde
                  <input type="date" value={calFrom} max={calTo} onChange={e => setCalFrom(e.target.value)} className="block mt-1 bg-[#EEF3F8] rounded-xl px-3 py-2 text-sm text-[#0F172A]" />
                </label>
                <label className="text-xs font-semibold text-[#64748B]">Hasta
                  <input type="date" value={calTo} min={calFrom} onChange={e => setCalTo(e.target.value)} className="block mt-1 bg-[#EEF3F8] rounded-xl px-3 py-2 text-sm text-[#0F172A]" />
                </label>
                <button onClick={() => setConfirming(true)} className="px-4 py-2.5 rounded-xl bg-[#0077B6] text-white text-sm font-bold">
                  Calibrar con {calFrom} a {calTo}
                </button>
              </div>
              <p className="text-[11px] text-[#94A3B8]">Usa al menos 4 semanas con conteos completos. Solo cuentan los días con conteo de apertura ese día y el siguiente.</p>
            </div>

            <input value={filter} onChange={e => setFilter(e.target.value)} placeholder="Buscar plato"
              className="w-full bg-white border border-[#E2E8F0] rounded-xl px-4 py-3 text-sm" />

            {byCategory.map(([cat, list]) => (
              <div key={cat} className="bg-white rounded-2xl border border-[#E2E8F0] overflow-hidden">
                <p className="px-4 py-2.5 text-xs font-black text-[#64748B] uppercase tracking-wider border-b border-[#F1F5F9]">{cat}</p>
                <div className="divide-y divide-[#F1F5F9]">
                  {list.map(d => (
                    <div key={d.dishId}>
                      <button onClick={() => setOpen(o => (o === d.dishId ? null : d.dishId))}
                        className="w-full flex items-center gap-2 px-4 py-3 text-left hover:bg-[#F8FAFC]">
                        {open === d.dishId ? <ChevronDown size={14} className="text-[#94A3B8]" /> : <ChevronRight size={14} className="text-[#94A3B8]" />}
                        <span className="flex-1 min-w-0">
                          <span className="block text-sm font-semibold text-[#0F172A] truncate">{d.name}</span>
                          <span className="block text-[11px] text-[#94A3B8] truncate">
                            {d.items.length === 0 ? 'Sin receta: su costo solo incluye otros insumos'
                              : d.items.filter(i => i.variant === '').map(i => `${nameOf.get(i.supplyId) ?? '?'} ${i.gramsClean} g`).join(' · ') || 'Solo variantes'}
                          </span>
                        </span>
                        {d.items.length === 0 && <span className="text-[10px] font-bold text-amber-600 shrink-0">sin receta</span>}
                      </button>
                      {open === d.dishId && <DishEditor key={JSON.stringify(d.items)} dish={d} supplies={supplies} onSaved={reload} />}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </>
        )}
      </div>

      <ConfirmDialog
        open={confirming}
        title="Calibrar recetas"
        confirmLabel="Calibrar"
        variant="info"
        loading={calibrating}
        onConfirm={runCalibration}
        onCancel={() => setConfirming(false)}
      >
        <p className="text-sm text-[#64748B]">Se calcula un factor por insumo con los días del {calFrom} al {calTo} y pasa a ser el vigente. Los factores anteriores quedan en el historial.</p>
      </ConfirmDialog>
    </div>
  )
}
