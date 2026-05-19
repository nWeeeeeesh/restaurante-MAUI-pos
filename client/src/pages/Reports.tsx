import { useState, useEffect, useCallback } from 'react'
import { TrendingUp, ShoppingBag, Banknote, Smartphone, Plus, Download, FileText, Receipt } from 'lucide-react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, PieChart, Pie, Cell,
} from 'recharts'
import api from '../api/client'
import { generateReportHTML } from '../utils/reportHTML'

type Period = 'today' | 'week' | 'month'

interface Summary {
  totalSales: number
  orderCount: number
  byMethod: { cash: number; yape: number; plin: number }
  topDishes: { dishName: string; totalQty: number; totalRevenue: number }[]
  daily: { date: string; total: number; count: number }[]
}

interface Expense {
  id: number
  description: string
  amount: number
  category: string
  date: string
}

interface BillRecord {
  id: number
  receiptNumber: string
  paidAt: string
  total: number
  paymentMethod: 'cash' | 'yape' | 'plin'
  orderType: 'dine_in' | 'delivery'
  tableId: number | null
  customerName: string | null
}

const EXPENSE_CATS = [
  { value: 'ingredientes', label: 'Ingredientes' },
  { value: 'personal',     label: 'Personal' },
  { value: 'servicios',    label: 'Servicios' },
  { value: 'mantenimiento',label: 'Mantenimiento' },
  { value: 'otros',        label: 'Otros' },
]

const PERIOD_LABELS: Record<Period, string> = {
  today: 'Hoy',
  week:  'Semana',
  month: 'Mes',
}

const MEDAL = ['bg-amber-400', 'bg-slate-400', 'bg-orange-400']
const PIE_COLORS = ['#10b981', '#a855f7', '#0ea5e9']

const PAY_METHODS = [
  { key: 'cash' as const, label: 'Efectivo', icon: Banknote,   color: PIE_COLORS[0] },
  { key: 'yape' as const, label: 'Yape',     icon: Smartphone, color: PIE_COLORS[1] },
  { key: 'plin' as const, label: 'Plin',     icon: Smartphone, color: PIE_COLORS[2] },
]

const PAY_BADGE: Record<BillRecord['paymentMethod'], string> = {
  cash: 'bg-emerald-100 text-emerald-700',
  yape: 'bg-purple-100 text-purple-700',
  plin: 'bg-sky-100 text-sky-700',
}

function buildCSV(period: Period, summary: Summary, expenses: Expense[], billHistory: BillRecord[], totalExp: number, netBal: number): string {
  const rows: string[][] = [
    ['REPORTE CEVICHERÍA MAUI'],
    [`Período: ${PERIOD_LABELS[period]}`],
    [`Exportado: ${new Date().toLocaleString('es-PE')}`],
    [],
    ['RESUMEN'],
    ['Total Ventas', `S/ ${summary.totalSales.toFixed(2)}`],
    ['Pedidos', summary.orderCount.toString()],
    ['Efectivo', `S/ ${summary.byMethod.cash.toFixed(2)}`],
    ['Yape', `S/ ${summary.byMethod.yape.toFixed(2)}`],
    ['Plin', `S/ ${summary.byMethod.plin.toFixed(2)}`],
    ['Total Gastos', `S/ ${totalExp.toFixed(2)}`],
    ['Balance Neto', `S/ ${netBal.toFixed(2)}`],
    [],
  ]

  if (summary.topDishes.length > 0) {
    rows.push(['TOP PLATOS'], ['#', 'Plato', 'Cantidad', 'Ingresos (S/)'])
    summary.topDishes.forEach((d, i) =>
      rows.push([(i + 1).toString(), d.dishName, d.totalQty.toString(), Number(d.totalRevenue).toFixed(2)])
    )
    rows.push([])
  }

  if (summary.daily.length > 0) {
    rows.push(['VENTAS DIARIAS'], ['Fecha', 'Total (S/)', 'Pedidos'])
    summary.daily.forEach(d =>
      rows.push([d.date, Number(d.total).toFixed(2), d.count.toString()])
    )
    rows.push([])
  }

  if (expenses.length > 0) {
    rows.push(['GASTOS'], ['Fecha', 'Categoría', 'Descripción', 'Monto (S/)'])
    expenses.forEach(e =>
      rows.push([e.date, e.category, e.description, e.amount.toFixed(2)])
    )
    rows.push([])
  }

  if (billHistory.length > 0) {
    rows.push(['HISTORIAL DE BOLETAS'], ['Boleta', 'Fecha y Hora', 'Mesa/Cliente', 'Método', 'Total (S/)'])
    billHistory.forEach(b => {
      const dest = b.orderType === 'delivery' ? `Delivery - ${b.customerName ?? ''}` : `Mesa ${b.tableId}`
      rows.push([b.receiptNumber, b.paidAt ?? '', dest, b.paymentMethod, b.total.toFixed(2)])
    })
  }

  return rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n')
}

function downloadCSV(content: string, filename: string) {
  const blob = new Blob(['﻿' + content], { type: 'text/csv;charset=utf-8;' })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href = url; a.download = filename; a.click()
  URL.revokeObjectURL(url)
}

export default function Reports() {
  const [period, setPeriod]       = useState<Period>('today')
  const [summary, setSummary]     = useState<Summary | null>(null)
  const [expenses, setExpenses]   = useState<Expense[]>([])
  const [billHistory, setBills]   = useState<BillRecord[]>([])
  const [loading, setLoading]     = useState(true)
  const [form, setForm]           = useState({ description: '', amount: '', category: 'ingredientes' })
  const [adding, setAdding]       = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [s, e, b] = await Promise.all([
        api.get<Summary>(`/reports/summary?period=${period}`),
        api.get<Expense[]>(`/reports/expenses?period=${period}`),
        api.get<BillRecord[]>(`/reports/bills?period=${period}`),
      ])
      setSummary(s.data)
      setExpenses(e.data)
      setBills(b.data)
    } finally {
      setLoading(false)
    }
  }, [period])

  useEffect(() => { load() }, [load])

  const handleAdd = async (ev: React.FormEvent) => {
    ev.preventDefault()
    if (!form.description.trim() || !form.amount) return
    setAdding(true)
    try {
      await api.post('/reports/expenses', {
        description: form.description.trim(),
        amount: parseFloat(form.amount),
        category: form.category,
      })
      setForm(f => ({ ...f, description: '', amount: '' }))
      await load()
    } finally {
      setAdding(false)
    }
  }

  const totalExp = expenses.reduce((s, e) => s + e.amount, 0)
  const netBal   = (summary?.totalSales ?? 0) - totalExp

  const pieData = PAY_METHODS
    .map(m => ({ name: m.label, value: summary?.byMethod[m.key] ?? 0, color: m.color }))
    .filter(d => d.value > 0)

  const chartData = (summary?.daily ?? []).map(d => ({
    day: period === 'month'
      ? new Date(d.date + 'T12:00:00').toLocaleDateString('es-PE', { day: 'numeric', month: 'short' })
      : new Date(d.date + 'T12:00:00').toLocaleDateString('es-PE', { weekday: 'short', day: 'numeric' }),
    total: Number(d.total),
    count: Number(d.count),
  }))

  const handleExportCSV = () => {
    if (!summary) return
    const csv = buildCSV(period, summary, expenses, billHistory, totalExp, netBal)
    downloadCSV(csv, `reporte-maui-${period}-${new Date().toISOString().slice(0, 10)}.csv`)
  }

  const handleVisualReport = () => {
    if (!summary) return
    const html = generateReportHTML(period, summary, expenses, billHistory, totalExp, netBal)
    const win  = window.open('', '_blank', 'width=1100,height=800')
    if (!win) return
    win.document.write(html)
    win.document.close()
  }

  const formatBillDate = (iso: string) =>
    new Date(iso).toLocaleString('es-PE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })

  return (
    <div className="h-full overflow-y-auto bg-[#EEF3F8]">
      {/* Header */}
      <div className="bg-white border-b border-[#E2E8F0] px-3 sm:px-6 py-3 sm:py-4 sticky top-0 z-10">
        <div className="flex items-start sm:items-center justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <h1 className="text-lg sm:text-xl font-black text-[#0F172A]">Reportes</h1>
            <p className="text-[#64748B] text-xs sm:text-sm">Cevichería MAUI · Tacna</p>
          </div>
          <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap justify-end">
            <div className="flex bg-[#EEF3F8] rounded-xl p-1 gap-1">
              {(Object.keys(PERIOD_LABELS) as Period[]).map(p => (
                <button key={p} onClick={() => setPeriod(p)}
                  className={`px-2.5 sm:px-4 py-1.5 sm:py-2 rounded-lg text-xs sm:text-sm font-bold transition-all ${
                    period === p ? 'bg-white text-[#0077B6] shadow-sm' : 'text-[#64748B] hover:text-[#0077B6]'
                  }`}>
                  {PERIOD_LABELS[p]}
                </button>
              ))}
            </div>
            <button onClick={handleExportCSV} disabled={!summary || loading}
              className="flex items-center gap-1.5 sm:gap-2 px-2.5 sm:px-4 py-1.5 sm:py-2 bg-[#EEF3F8] hover:bg-[#E2E8F0] disabled:opacity-40 text-[#64748B] text-xs sm:text-sm font-bold rounded-xl transition-colors">
              <Download size={14}/> <span className="hidden sm:inline">CSV</span>
            </button>
            <button onClick={handleVisualReport} disabled={!summary || loading}
              className="flex items-center gap-1.5 sm:gap-2 px-2.5 sm:px-4 py-1.5 sm:py-2 text-white text-xs sm:text-sm font-bold rounded-xl transition-colors disabled:opacity-40"
              style={{ background: 'linear-gradient(135deg,#0077B6,#004E86)' }}>
              <FileText size={14}/> <span className="hidden sm:inline">Reporte</span>
            </button>
          </div>
        </div>
      </div>

      <div className="p-3 sm:p-6 space-y-4 sm:space-y-5 max-w-5xl mx-auto">
        {loading ? (
          <div className="flex items-center justify-center h-64 text-[#94A3B8] text-sm font-semibold">
            Cargando datos...
          </div>
        ) : (
          <>
            {/* ── Summary cards ── */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="col-span-2 rounded-2xl p-5 text-white"
                style={{ background: 'linear-gradient(135deg,#0077B6,#004E86)' }}>
                <p className="text-white/70 text-xs font-bold uppercase tracking-wider mb-1">Total Ventas</p>
                <p className="text-4xl font-black">S/ {(summary?.totalSales ?? 0).toFixed(2)}</p>
                <p className="text-white/60 text-xs mt-2">
                  {summary?.orderCount ?? 0} pedido{summary?.orderCount !== 1 ? 's' : ''} cobrado{summary?.orderCount !== 1 ? 's' : ''}
                </p>
              </div>

              <div className="col-span-2 bg-white rounded-2xl p-5 border border-[#E2E8F0]">
                <p className="text-xs font-bold text-[#64748B] uppercase tracking-wider mb-3">Métodos de pago</p>
                {pieData.length > 0 ? (
                  <div className="flex items-center gap-4">
                    <div className="shrink-0" style={{ width: 120, height: 120 }}>
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie data={pieData} cx="50%" cy="50%" innerRadius={36} outerRadius={52}
                            paddingAngle={4} dataKey="value" startAngle={90} endAngle={-270}>
                            {pieData.map((entry, i) => <Cell key={i} fill={entry.color}/>)}
                          </Pie>
                          <Tooltip
                            contentStyle={{ borderRadius: '10px', border: '1px solid #E2E8F0', fontSize: 12 }}
                            formatter={(value) => [`S/ ${Number(value).toFixed(2)}`, '']}
                          />
                        </PieChart>
                      </ResponsiveContainer>
                    </div>
                    <div className="flex-1 space-y-2.5">
                      {PAY_METHODS.map(m => {
                        const val = summary?.byMethod[m.key] ?? 0
                        const Icon = m.icon
                        return (
                          <div key={m.key} className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: m.color }}/>
                              <Icon size={13} style={{ color: m.color }}/>
                              <span className="text-xs font-semibold text-[#64748B]">{m.label}</span>
                            </div>
                            <span className={`text-sm font-black ${val > 0 ? 'text-[#0F172A]' : 'text-[#CBD5E1]'}`}>
                              S/ {val.toFixed(2)}
                            </span>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center justify-center h-24">
                    <p className="text-sm text-[#94A3B8]">Sin ventas en este período</p>
                  </div>
                )}
              </div>
            </div>

            {/* ── Balance bar ── */}
            <div className={`rounded-2xl px-5 py-4 flex items-center justify-between border ${
              netBal >= 0 ? 'bg-emerald-50 border-emerald-200' : 'bg-red-50 border-red-200'
            }`}>
              <div>
                <p className={`text-sm font-bold ${netBal >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>
                  Balance neto del período
                </p>
                <p className={`text-xs mt-0.5 ${netBal >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                  Ventas S/ {(summary?.totalSales ?? 0).toFixed(2)} − Gastos S/ {totalExp.toFixed(2)}
                </p>
              </div>
              <p className={`text-3xl font-black ${netBal >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                {netBal < 0 ? '−' : ''}S/ {Math.abs(netBal).toFixed(2)}
              </p>
            </div>

            {/* ── Two columns: top dishes + expenses ── */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">

              {/* Top platos */}
              <div className="bg-white rounded-2xl border border-[#E2E8F0] overflow-hidden">
                <div className="px-5 py-4 border-b border-[#E2E8F0] flex items-center gap-2">
                  <TrendingUp size={17} className="text-[#0077B6]"/>
                  <h2 className="font-black text-[#0F172A] text-sm">Platos más vendidos</h2>
                </div>
                {(summary?.topDishes.length ?? 0) === 0 ? (
                  <div className="flex flex-col items-center justify-center py-14 text-center">
                    <ShoppingBag size={32} className="text-[#CBD5E1] mb-2"/>
                    <p className="text-sm text-[#64748B]">Sin ventas en este período</p>
                  </div>
                ) : (
                  <div className="divide-y divide-[#F1F5F9]">
                    {summary?.topDishes.map((dish, i) => (
                      <div key={dish.dishName} className="flex items-center gap-3 px-5 py-3.5">
                        <span className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-black text-white shrink-0 ${
                          i < 3 ? MEDAL[i] : 'bg-[#EEF3F8] !text-[#64748B]'
                        }`}>{i + 1}</span>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-[#0F172A] truncate">{dish.dishName}</p>
                          <p className="text-xs text-[#94A3B8]">{dish.totalQty} unid.</p>
                        </div>
                        <span className="text-sm font-black text-[#F4792B] shrink-0">
                          S/ {Number(dish.totalRevenue).toFixed(2)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Gastos */}
              <div className="bg-white rounded-2xl border border-[#E2E8F0] overflow-hidden flex flex-col">
                <div className="px-5 py-4 border-b border-[#E2E8F0] flex items-center justify-between">
                  <h2 className="font-black text-[#0F172A] text-sm">Gastos</h2>
                  {totalExp > 0 && (
                    <span className="text-sm font-black text-red-500">−S/ {totalExp.toFixed(2)}</span>
                  )}
                </div>
                <form onSubmit={handleAdd} className="p-4 border-b border-[#E2E8F0] space-y-2 bg-[#FAFBFC] shrink-0">
                  <div className="flex gap-2">
                    <input value={form.description}
                      onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                      placeholder="Descripción *"
                      className="flex-1 bg-white border border-[#E2E8F0] rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-[#0077B6] placeholder-[#94A3B8]"/>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[#64748B] text-xs font-bold">S/</span>
                      <input type="number" inputMode="decimal" step="0.50" min="0" value={form.amount}
                        onChange={e => setForm(f => ({ ...f, amount: e.target.value }))}
                        placeholder="0.00"
                        className="w-24 bg-white border border-[#E2E8F0] rounded-xl pl-8 pr-3 py-2.5 text-sm focus:outline-none focus:border-[#0077B6]"/>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <select value={form.category}
                      onChange={e => setForm(f => ({ ...f, category: e.target.value }))}
                      className="flex-1 bg-white border border-[#E2E8F0] rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-[#0077B6] text-[#0F172A]">
                      {EXPENSE_CATS.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                    </select>
                    <button type="submit" disabled={adding || !form.description.trim() || !form.amount}
                      className="flex items-center gap-1.5 px-4 py-2.5 bg-[#0077B6] hover:bg-[#005F8E] disabled:opacity-40 text-white text-sm font-bold rounded-xl transition-colors">
                      <Plus size={14}/> Agregar
                    </button>
                  </div>
                </form>
                <div className="flex-1 overflow-y-auto divide-y divide-[#F1F5F9] max-h-72">
                  {expenses.length === 0 ? (
                    <div className="flex items-center justify-center py-10">
                      <p className="text-sm text-[#94A3B8]">Sin gastos en este período</p>
                    </div>
                  ) : expenses.map(exp => (
                    <div key={exp.id} className="flex items-center gap-3 px-5 py-3.5">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-[#0F172A] truncate">{exp.description}</p>
                        <p className="text-xs text-[#94A3B8]">{exp.category} · {exp.date}</p>
                      </div>
                      <span className="text-sm font-black text-red-500 shrink-0">−S/ {exp.amount.toFixed(2)}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* ── Bar chart ventas diarias ── */}
            {period !== 'today' && chartData.length > 0 && (
              <div className="bg-white rounded-2xl border border-[#E2E8F0] overflow-hidden">
                <div className="px-5 py-4 border-b border-[#E2E8F0]">
                  <h2 className="font-black text-[#0F172A] text-sm">Ventas por día</h2>
                </div>
                <div className="px-5 pt-4 pb-2">
                  <ResponsiveContainer width="100%" height={200}>
                    <BarChart data={chartData} margin={{ top: 0, right: 0, left: -10, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9" vertical={false}/>
                      <XAxis dataKey="day" tick={{ fontSize: 11, fill: '#94A3B8' }}
                        axisLine={false} tickLine={false}/>
                      <YAxis tick={{ fontSize: 11, fill: '#94A3B8' }}
                        axisLine={false} tickLine={false}
                        tickFormatter={v => `S/${v}`}/>
                      <Tooltip
                        contentStyle={{ borderRadius: '12px', border: '1px solid #E2E8F0', fontSize: 12,
                          boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.08)' }}
                        cursor={{ fill: '#EEF3F8' }}
                        formatter={(value) => [`S/ ${Number(value).toFixed(2)}`, 'Ventas']}
                        labelFormatter={(label, payload) => {
                          const count = (payload?.[0]?.payload as { count?: number })?.count ?? 0
                          return `${label} · ${count} pedido${count !== 1 ? 's' : ''}`
                        }}
                      />
                      <Bar dataKey="total" fill="#0077B6" radius={[6, 6, 0, 0]} maxBarSize={52}/>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}

            {/* ── Historial de boletas ── */}
            <div className="bg-white rounded-2xl border border-[#E2E8F0] overflow-hidden">
              <div className="px-5 py-4 border-b border-[#E2E8F0] flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Receipt size={17} className="text-[#0077B6]"/>
                  <h2 className="font-black text-[#0F172A] text-sm">Historial de boletas</h2>
                </div>
                {billHistory.length > 0 && (
                  <span className="text-xs font-bold text-[#64748B] bg-[#EEF3F8] px-3 py-1 rounded-full">
                    {billHistory.length} transaccion{billHistory.length !== 1 ? 'es' : ''}
                  </span>
                )}
              </div>

              {billHistory.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-14 text-center">
                  <Receipt size={32} className="text-[#CBD5E1] mb-2"/>
                  <p className="text-sm text-[#64748B]">Sin boletas en este período</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="bg-[#F8FAFC] border-b border-[#E2E8F0]">
                        <th className="px-5 py-3 text-left text-xs font-bold text-[#64748B] uppercase tracking-wider">Boleta</th>
                        <th className="px-4 py-3 text-left text-xs font-bold text-[#64748B] uppercase tracking-wider">Fecha y hora</th>
                        <th className="px-4 py-3 text-left text-xs font-bold text-[#64748B] uppercase tracking-wider">Mesa / Cliente</th>
                        <th className="px-4 py-3 text-left text-xs font-bold text-[#64748B] uppercase tracking-wider">Método</th>
                        <th className="px-5 py-3 text-right text-xs font-bold text-[#64748B] uppercase tracking-wider">Total</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#F1F5F9]">
                      {billHistory.map(b => (
                        <tr key={b.id} className="hover:bg-[#FAFBFC] transition-colors">
                          <td className="px-5 py-3.5 font-mono text-xs font-bold text-[#0077B6]">
                            {b.receiptNumber}
                          </td>
                          <td className="px-4 py-3.5 text-sm text-[#64748B]">
                            {formatBillDate(b.paidAt ?? '')}
                          </td>
                          <td className="px-4 py-3.5 text-sm font-semibold text-[#0F172A]">
                            {b.orderType === 'delivery' ? (
                              <span className="flex items-center gap-1.5">
                                <span className="text-xs bg-orange-100 text-orange-700 px-2 py-0.5 rounded-full font-bold">Delivery</span>
                                {b.customerName}
                              </span>
                            ) : `Mesa ${b.tableId}`}
                          </td>
                          <td className="px-4 py-3.5">
                            <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${PAY_BADGE[b.paymentMethod]}`}>
                              {b.paymentMethod === 'cash' ? 'Efectivo' : b.paymentMethod === 'yape' ? 'Yape' : 'Plin'}
                            </span>
                          </td>
                          <td className="px-5 py-3.5 text-right text-sm font-black text-[#0F172A]">
                            S/ {b.total.toFixed(2)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
