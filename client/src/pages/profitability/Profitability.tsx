import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, Loader2, RefreshCw } from 'lucide-react'
import {
  Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import { useProfitability } from '../../hooks/useProfitability'
import type { GroupBy, MenuCategory, ProfitDish, ProfitWarning } from '../../api/profitability'
import { addDays, localDateString } from '../../utils/dates'

type Preset = 'today' | 'week' | 'month' | 'range'

const PRESETS: { id: Preset; label: string }[] = [
  { id: 'today', label: 'Hoy' },
  { id: 'week', label: 'Semana' },
  { id: 'month', label: 'Mes' },
  { id: 'range', label: 'Rango' },
]

const GROUP_LABEL: Record<GroupBy, string> = { day: 'Por día', week: 'Por semana', month: 'Por mes' }

const CATEGORY_STYLE: Record<MenuCategory, string> = {
  'Estrella': 'bg-emerald-50 text-emerald-700',
  'Caballo de batalla': 'bg-blue-50 text-[#0077B6]',
  'Rompecabezas': 'bg-amber-50 text-amber-700',
  'Perro': 'bg-red-50 text-red-600',
}

const CATEGORY_HELP: Record<MenuCategory, string> = {
  'Estrella': 'se vende mucho y deja buen margen',
  'Caballo de batalla': 'se vende mucho, margen bajo',
  'Rompecabezas': 'buen margen, se vende poco',
  'Perro': 'se vende poco y deja poco margen',
}

const money = (n: number | null | undefined) => (n === null || n === undefined ? '—' : `S/ ${n.toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`)
const pct = (n: number | null | undefined) => (n === null || n === undefined ? 'no aplica' : `${n.toFixed(1)} %`)

function mondayOf(date: string): string {
  const d = new Date(date + 'T00:00:00')
  return addDays(date, -((d.getDay() + 6) % 7))
}

function presetRange(p: Preset, today: string): { from: string; to: string; groupBy: GroupBy } {
  if (p === 'today') return { from: today, to: today, groupBy: 'day' }
  if (p === 'week') return { from: mondayOf(today), to: today, groupBy: 'day' }
  return { from: `${today.slice(0, 7)}-01`, to: today, groupBy: 'week' }
}

function warningText(w: ProfitWarning): string {
  switch (w.code) {
    case 'NO_RECIPE': return `${w.name}: sin receta, su costo solo incluye otros insumos`
    case 'FACTOR_OUT_OF_RANGE': return `${w.supplyCode}: factor ${w.factor.toFixed(2)} fuera de 0.70–1.30, revisa la receta`
    case 'NOT_CALIBRATED': return `${w.supplyCode}: sin calibrar, se usa la receta tal cual (factor 1)`
    case 'MISSING_COUNT': return `Sin conteo de apertura: ${w.dates.length} día${w.dates.length === 1 ? '' : 's'} (${w.dates.slice(0, 4).join(', ')}${w.dates.length > 4 ? '…' : ''}); ese consumo se estima con la receta`
    case 'NO_PURCHASE_PRICE': return `${w.supplyCode}: hubo consumo pero ninguna compra con precio`
  }
}

function Card({ label, value, help, tone = 'default' }: { label: string; value: string; help: string; tone?: 'default' | 'good' | 'bad' }) {
  const color = tone === 'good' ? 'text-emerald-600' : tone === 'bad' ? 'text-red-500' : 'text-[#0F172A]'
  return (
    <div className="bg-white rounded-2xl border border-[#E2E8F0] p-4">
      <p className="text-[11px] font-bold text-[#64748B] uppercase tracking-wider">{label}</p>
      <p className={`text-xl sm:text-2xl font-black mt-1 ${color}`}>{value}</p>
      <p className="text-[11px] text-[#94A3B8] mt-1 leading-snug">{help}</p>
    </div>
  )
}

export default function Profitability() {
  const today = localDateString()
  const [preset, setPreset] = useState<Preset>('month')
  const [range, setRange] = useState({ from: addDays(today, -27), to: today })
  const [rangeGroup, setRangeGroup] = useState<GroupBy>('week')
  const [sortBy, setSortBy] = useState<'portions' | 'margin' | 'name'>('portions')

  const q = preset === 'range' ? { ...range, groupBy: rangeGroup } : presetRange(preset, today)
  const { data, loading, error, reload } = useProfitability(q.from, q.to, q.groupBy)

  const chart = useMemo(() => (data?.series ?? []).map(s => ({
    label: q.groupBy === 'month' ? s.key : s.from.slice(5).split('-').reverse().join('/'),
    Ventas: s.sales, 'Costo de lo vendido': s.cogs, 'Utilidad operativa': s.operatingProfit,
  })), [data, q.groupBy])

  const dishes = useMemo(() => {
    const list = [...(data?.dishes ?? [])].filter(d => d.portions > 0 || !d.noRecipe)
    const by: Record<typeof sortBy, (a: ProfitDish, b: ProfitDish) => number> = {
      portions: (a, b) => b.portions - a.portions,
      margin: (a, b) => b.margin - a.margin,
      name: (a, b) => a.name.localeCompare(b.name, 'es'),
    }
    return list.sort(by[sortBy])
  }, [data, sortBy])

  const t = data?.totals

  return (
    <div className="h-full overflow-y-auto bg-[#EEF3F8]">
      <div className="bg-white border-b border-[#E2E8F0] px-3 sm:px-6 py-3 sm:py-4 sticky top-0 z-10">
        <div className="flex items-start sm:items-center justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <h1 className="text-lg sm:text-xl font-black text-[#0F172A]">Rentabilidad</h1>
            <p className="text-[#64748B] text-xs sm:text-sm">Lo que deja cada venta, calculado con lo registrado</p>
          </div>
          <div className="flex items-center gap-2 flex-wrap justify-end">
            <div className="flex bg-[#EEF3F8] rounded-xl p-1 gap-1">
              {PRESETS.map(p => (
                <button key={p.id} onClick={() => setPreset(p.id)}
                  className={`px-2.5 sm:px-4 py-1.5 sm:py-2 rounded-lg text-xs sm:text-sm font-bold transition-all ${preset === p.id ? 'bg-white text-[#0077B6] shadow-sm' : 'text-[#64748B] hover:text-[#0077B6]'}`}>
                  {p.label}
                </button>
              ))}
            </div>
            <button onClick={reload} disabled={loading} title="Volver a calcular"
              className="p-2 rounded-xl bg-[#EEF3F8] text-[#64748B] hover:text-[#0077B6] disabled:opacity-40">
              <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
            </button>
          </div>
        </div>
        {preset === 'range' && (
          <div className="flex flex-wrap items-end gap-2 mt-3">
            <label className="text-xs font-semibold text-[#64748B]">Desde
              <input type="date" value={range.from} max={range.to} onChange={e => setRange(r => ({ ...r, from: e.target.value }))}
                className="block mt-1 bg-[#EEF3F8] rounded-xl px-3 py-2 text-sm text-[#0F172A]" />
            </label>
            <label className="text-xs font-semibold text-[#64748B]">Hasta
              <input type="date" value={range.to} min={range.from} onChange={e => setRange(r => ({ ...r, to: e.target.value }))}
                className="block mt-1 bg-[#EEF3F8] rounded-xl px-3 py-2 text-sm text-[#0F172A]" />
            </label>
            <div className="flex bg-[#EEF3F8] rounded-xl p-1 gap-1">
              {(Object.keys(GROUP_LABEL) as GroupBy[]).map(g => (
                <button key={g} onClick={() => setRangeGroup(g)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold ${rangeGroup === g ? 'bg-white text-[#0077B6] shadow-sm' : 'text-[#64748B]'}`}>
                  {GROUP_LABEL[g]}
                </button>
              ))}
            </div>
            <p className="text-[11px] text-[#94A3B8] w-full">Hasta 366 días. El periodo usa los días locales de Tacna.</p>
          </div>
        )}
      </div>

      <div className="p-3 sm:p-6 space-y-4 max-w-5xl mx-auto">
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 rounded-2xl p-4 text-sm font-semibold">{error}</div>
        )}
        {loading && !data ? (
          <div className="flex items-center justify-center h-64 text-[#94A3B8]"><Loader2 className="animate-spin" /></div>
        ) : t && (
          <>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <Card label="Ventas" value={money(t.sales)} help="Boletas cobradas en el periodo" />
              <Card label="Costo de lo vendido" value={money(t.cogs)} help="Insumos críticos consumidos y botados, más otros insumos" />
              <Card label="Food cost" value={pct(t.foodCostPct)} help="Costo de lo vendido ÷ ventas" />
              <Card label="Utilidad bruta" value={money(t.grossProfit)} help="Ventas − costo de lo vendido" tone={t.grossProfit >= 0 ? 'good' : 'bad'} />
              <Card label="Utilidad operativa" value={money(t.operatingProfit)} help={`Utilidad bruta − gastos (${money(t.expenses)} prorrateados)`} tone={t.operatingProfit >= 0 ? 'good' : 'bad'} />
              <Card label="Merma" value={money(t.waste.cost)} help={`${t.waste.kg.toFixed(2)} kg botados · ${pct(t.waste.pct)} de lo que entró`} tone={t.waste.cost > 0 ? 'bad' : 'default'} />
              <Card label="Ventas de equilibrio" value={money(t.breakEvenSales)} help={`Lo que hay que vender para cubrir los gastos fijos (${money(t.fixedExpenses)})`} />
              <Card label="Otros insumos" value={money(t.otherSupplies)} help="Registrados en «Al volver de comprar»" />
            </div>

            {data.warnings.length > 0 && (
              <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 space-y-1.5">
                <p className="flex items-center gap-2 text-sm font-black text-amber-800"><AlertTriangle size={15} /> Revisa</p>
                {(() => {
                  // Los platos sin receta van en una sola línea: las bebidas siempre aparecen
                  const sinReceta = data.warnings.filter(w => w.code === 'NO_RECIPE').map(w => (w as { name: string }).name)
                  return sinReceta.length > 1 && (
                    <p className="text-xs text-amber-900">• {sinReceta.length} platos sin receta (su costo solo incluye otros insumos): {sinReceta.join(', ')}</p>
                  )
                })()}
                {data.warnings.filter(w => w.code !== 'NO_RECIPE' || data.warnings.filter(x => x.code === 'NO_RECIPE').length === 1).map((w, k) => (
                  <p key={k} className="text-xs text-amber-900">• {warningText(w)}</p>
                ))}
                {data.warnings.some(w => w.code === 'NO_RECIPE' || w.code === 'NOT_CALIBRATED' || w.code === 'FACTOR_OUT_OF_RANGE') && (
                  <Link to="/recipes" className="inline-block text-xs font-bold text-[#0077B6] mt-1">Ir a Recetas →</Link>
                )}
              </div>
            )}

            {chart.length > 1 && (
              <div className="bg-white rounded-2xl border border-[#E2E8F0] p-4">
                <h2 className="font-black text-[#0F172A] text-sm mb-3">{GROUP_LABEL[q.groupBy]}</h2>
                <ResponsiveContainer width="100%" height={240}>
                  <ComposedChart data={chart} margin={{ top: 0, right: 0, left: -10, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9" vertical={false} />
                    <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#94A3B8' }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 11, fill: '#94A3B8' }} axisLine={false} tickLine={false} />
                    <Tooltip formatter={(v) => money(Number(v))} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Bar dataKey="Ventas" fill="#0077B6" radius={[6, 6, 0, 0]} maxBarSize={40} />
                    <Bar dataKey="Costo de lo vendido" fill="#F4792B" radius={[6, 6, 0, 0]} maxBarSize={40} />
                    <Line dataKey="Utilidad operativa" stroke="#10B981" strokeWidth={2} dot={false} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            )}

            <div className="bg-white rounded-2xl border border-[#E2E8F0] overflow-hidden">
              <div className="px-4 py-3 border-b border-[#E2E8F0]">
                <h2 className="font-black text-[#0F172A] text-sm">Insumos críticos</h2>
                <p className="text-[11px] text-[#94A3B8]">Consumo = lo que quedaba + lo que entró − lo botado − lo que quedó al día siguiente</p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="text-[#64748B] text-left">
                    <tr>{['Insumo', 'Consumo', 'Botado', 'Costo prom.', 'Costo', 'Factor'].map(h => <th key={h} className="px-4 py-2 font-bold whitespace-nowrap">{h}</th>)}</tr>
                  </thead>
                  <tbody className="divide-y divide-[#F1F5F9]">
                    {data.supplies.map(s => (
                      <tr key={s.supplyId}>
                        <td className="px-4 py-2 font-semibold text-[#0F172A]">{s.name}</td>
                        <td className="px-4 py-2 whitespace-nowrap">{s.consumptionKg.toFixed(2)} kg</td>
                        <td className="px-4 py-2 whitespace-nowrap">{s.wasteKg.toFixed(2)} kg{s.wastePct !== null ? ` · ${s.wastePct.toFixed(1)} %` : ''}</td>
                        <td className="px-4 py-2 whitespace-nowrap">{money(s.averageCost)}/kg</td>
                        <td className="px-4 py-2 whitespace-nowrap">{money(s.cost)}</td>
                        <td className="px-4 py-2 whitespace-nowrap">{s.calibrated ? s.factor.toFixed(3) : 'sin calibrar'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="bg-white rounded-2xl border border-[#E2E8F0] overflow-hidden">
              <div className="px-4 py-3 border-b border-[#E2E8F0] flex items-center justify-between gap-2 flex-wrap">
                <div>
                  <h2 className="font-black text-[#0F172A] text-sm">Platos</h2>
                  <p className="text-[11px] text-[#94A3B8]">Costo = receta × factor × costo promedio + parte de otros insumos</p>
                </div>
                <select value={sortBy} onChange={e => setSortBy(e.target.value as typeof sortBy)}
                  className="bg-[#EEF3F8] rounded-xl px-3 py-2 text-xs font-semibold text-[#0F172A]">
                  <option value="portions">Más vendidos</option>
                  <option value="margin">Mayor margen</option>
                  <option value="name">Nombre</option>
                </select>
              </div>
              <div className="px-4 py-2 flex flex-wrap gap-x-4 gap-y-1 border-b border-[#F1F5F9]">
                {(Object.keys(CATEGORY_HELP) as MenuCategory[]).map(c => (
                  <span key={c} className="text-[11px] text-[#64748B]"><span className={`font-bold px-1.5 py-0.5 rounded ${CATEGORY_STYLE[c]}`}>{c}</span> {CATEGORY_HELP[c]}</span>
                ))}
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="text-[#64748B] text-left">
                    <tr>{['Plato', 'Vendidos', 'Precio', 'Costo', 'Margen', 'Categoría'].map(h => <th key={h} className="px-4 py-2 font-bold whitespace-nowrap">{h}</th>)}</tr>
                  </thead>
                  <tbody className="divide-y divide-[#F1F5F9]">
                    {dishes.map(d => (
                      <tr key={`${d.dishId}|${d.variant}`}>
                        <td className="px-4 py-2 font-semibold text-[#0F172A] min-w-[10rem]">
                          {d.name}{d.noRecipe && <span className="ml-1 text-[10px] font-bold text-amber-600">sin receta</span>}
                        </td>
                        <td className="px-4 py-2">{d.portions}</td>
                        <td className="px-4 py-2 whitespace-nowrap">{money(d.price)}</td>
                        <td className="px-4 py-2 whitespace-nowrap">{money(d.cost)}</td>
                        <td className="px-4 py-2 whitespace-nowrap">{money(d.margin)}{d.marginPct !== null ? ` · ${d.marginPct.toFixed(0)} %` : ''}</td>
                        <td className="px-4 py-2">
                          {d.category ? <span className={`font-bold px-1.5 py-0.5 rounded whitespace-nowrap ${CATEGORY_STYLE[d.category]}`}>{d.category}</span> : <span className="text-[#94A3B8]">sin ventas</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
