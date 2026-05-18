import { useEffect, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import api from '../api/client'
import { useAuthStore } from '../store/auth'
import { useToastStore, printerErrorMessage } from '../store/toast'
import {
  ArrowLeft, Receipt, Bike, LayoutGrid, Banknote, Smartphone,
  Printer, Loader2, RefreshCw, Calendar, X, Search,
} from 'lucide-react'

type PayMethod = 'cash' | 'yape' | 'plin'

interface BillRow {
  id: number
  receiptNumber: string
  paidAt: string
  total: number
  subtotal: number
  paymentMethod: PayMethod
  cashReceived: number | null
  changeAmount: number | null
  orderType: 'dine_in' | 'delivery' | null
  tableId: number | null
  customerName: string | null
  cashierName: string | null
  orderId: number | null
}

interface BillDetail {
  bill: BillRow
  order: { id: number; type: 'dine_in' | 'delivery'; tableId: number | null; customerName: string | null } | null
  cashier: { id: number; name: string; username: string } | null
  items: Array<{
    id: number
    dishName: string
    quantity: number
    unitPrice: number
    modifiers: Array<{ optionName?: string | null; freeText?: string | null }>
  }>
}

const PAY_LABEL: Record<PayMethod, string> = { cash: 'Efectivo', yape: 'Yape', plin: 'Plin' }
const PAY_ICON: Record<PayMethod, any>  = { cash: Banknote, yape: Smartphone, plin: Smartphone }
const PAY_COLOR: Record<PayMethod, string> = {
  cash: 'bg-emerald-50 text-emerald-700',
  yape: 'bg-purple-50 text-purple-700',
  plin: 'bg-sky-50 text-sky-700',
}

function formatLocal(paidAt: string): string {
  // paidAt es 'YYYY-MM-DD HH:MM:SS' UTC; lo convertimos a hora local
  return new Date(paidAt + 'Z').toLocaleString('es-PE', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

function todayISO(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export default function BillsHistory() {
  const navigate = useNavigate()
  const { user } = useAuthStore()
  const { push: toast } = useToastStore()
  const isOwner = user?.role === 'owner'

  const [from, setFrom] = useState(todayISO())
  const [to, setTo]     = useState(todayISO())
  const [search, setSearch] = useState('')
  const [bills, setBills]   = useState<BillRow[]>([])
  const [loading, setLoading] = useState(false)
  const [selected, setSelected] = useState<BillDetail | null>(null)
  const [loadingDetail, setLoadingDetail] = useState(false)
  const [reprinting, setReprinting] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = isOwner ? { from, to } : {}
      const { data } = await api.get<{ bills: BillRow[] }>('/bills', { params })
      setBills(data.bills)
    } catch (e: any) {
      toast({ variant: 'error', title: 'No se pudo cargar el historial', message: e.response?.data?.error ?? 'Error de servidor' })
    } finally {
      setLoading(false)
    }
  }, [from, to, isOwner, toast])

  useEffect(() => { load() }, [load])

  const filtered = bills.filter(b => {
    if (!search.trim()) return true
    const q = search.trim().toLowerCase()
    return (
      b.receiptNumber.toLowerCase().includes(q) ||
      (b.customerName ?? '').toLowerCase().includes(q) ||
      (b.tableId !== null && `mesa ${b.tableId}`.includes(q)) ||
      (b.cashierName ?? '').toLowerCase().includes(q)
    )
  })

  const totalDay = filtered.reduce((s, b) => s + b.total, 0)
  const cashTotal = filtered.filter(b => b.paymentMethod === 'cash').reduce((s, b) => s + b.total, 0)
  const yapeTotal = filtered.filter(b => b.paymentMethod === 'yape').reduce((s, b) => s + b.total, 0)
  const plinTotal = filtered.filter(b => b.paymentMethod === 'plin').reduce((s, b) => s + b.total, 0)

  const openDetail = async (bill: BillRow) => {
    setLoadingDetail(true)
    try {
      const { data } = await api.get<BillDetail>(`/bills/${bill.id}`)
      setSelected(data)
    } catch (e: any) {
      toast({ variant: 'error', title: 'No se pudo abrir la boleta', message: e.response?.data?.error ?? 'Error de servidor' })
    } finally {
      setLoadingDetail(false)
    }
  }

  const reprint = async (billId: number) => {
    setReprinting(true)
    try {
      await api.post(`/print/reprint/${billId}`)
      toast({ variant: 'success', title: 'Boleta enviada a la impresora' })
    } catch (e: any) {
      toast({ variant: 'error', title: 'No se pudo reimprimir', message: printerErrorMessage(e) })
    } finally {
      setReprinting(false)
    }
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Header */}
      <div className="bg-white border-b border-[#E2E8F0] px-4 sm:px-6 py-3 sm:py-4 flex items-center gap-3 sm:gap-4 shrink-0">
        <button onClick={() => navigate(-1)}
          className="w-9 h-9 rounded-xl bg-[#EEF3F8] flex items-center justify-center text-[#64748B] hover:bg-[#0077B6] hover:text-white transition-all shrink-0">
          <ArrowLeft size={18}/>
        </button>
        <div className="min-w-0 flex-1">
          <h1 className="text-lg sm:text-xl font-black text-[#0F172A]">Historial de boletas</h1>
          <p className="text-[#64748B] text-xs sm:text-sm">
            {isOwner ? 'Acceso completo al historial' : 'Solo boletas del día actual'}
          </p>
        </div>
        <button onClick={load} disabled={loading}
          className="w-9 h-9 rounded-xl bg-[#EEF3F8] hover:bg-[#0077B6] hover:text-white text-[#64748B] flex items-center justify-center transition-all disabled:opacity-50">
          {loading ? <Loader2 size={16} className="animate-spin"/> : <RefreshCw size={16}/>}
        </button>
      </div>

      {/* Filtros */}
      <div className="bg-white border-b border-[#E2E8F0] px-4 sm:px-6 py-3 shrink-0 flex flex-wrap items-center gap-2 sm:gap-3">
        {isOwner && (
          <div className="flex items-center gap-2">
            <Calendar size={14} className="text-[#64748B]"/>
            <input type="date" value={from} max={to} onChange={e => setFrom(e.target.value)}
              className="border border-[#E2E8F0] rounded-lg px-2.5 py-1.5 text-xs font-semibold focus:outline-none focus:border-[#0077B6]"/>
            <span className="text-xs text-[#94A3B8]">→</span>
            <input type="date" value={to} min={from} onChange={e => setTo(e.target.value)}
              className="border border-[#E2E8F0] rounded-lg px-2.5 py-1.5 text-xs font-semibold focus:outline-none focus:border-[#0077B6]"/>
            <button
              onClick={() => { const t = todayISO(); setFrom(t); setTo(t) }}
              className="text-xs font-bold text-[#0077B6] hover:underline px-2"
            >Hoy</button>
          </div>
        )}
        <div className="flex-1 min-w-[180px] relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#94A3B8]"/>
          <input
            value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Buscar por boleta, mesa, cliente, cajero…"
            className="w-full border border-[#E2E8F0] rounded-lg pl-9 pr-3 py-1.5 text-sm focus:outline-none focus:border-[#0077B6]"
          />
        </div>
      </div>

      {/* KPIs */}
      <div className="bg-white border-b border-[#E2E8F0] px-4 sm:px-6 py-3 shrink-0 grid grid-cols-2 md:grid-cols-4 gap-2">
        <Stat label="Boletas" value={String(filtered.length)} color="text-[#0077B6]" bg="bg-[#EEF3F8]"/>
        <Stat label="Total" value={`S/ ${totalDay.toFixed(2)}`} color="text-[#F4792B]" bg="bg-orange-50"/>
        <Stat label="Efectivo" value={`S/ ${cashTotal.toFixed(2)}`} color="text-emerald-700" bg="bg-emerald-50"/>
        <Stat label="Yape + Plin" value={`S/ ${(yapeTotal + plinTotal).toFixed(2)}`} color="text-purple-700" bg="bg-purple-50"/>
      </div>

      {/* Lista */}
      <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-4">
        {loading ? (
          <div className="flex items-center justify-center h-40 text-[#94A3B8]">
            <Loader2 size={24} className="animate-spin"/>
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-60 text-center">
            <Receipt size={48} className="text-[#CBD5E1] mb-3"/>
            <p className="text-sm font-bold text-[#64748B]">Sin boletas en este rango</p>
            <p className="text-xs text-[#94A3B8] mt-1">{isOwner ? 'Cambia el rango de fechas' : 'Aún no hay cobros hoy'}</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {filtered.map(b => {
              const PayIcon = PAY_ICON[b.paymentMethod]
              return (
                <button key={b.id} onClick={() => openDetail(b)}
                  className="bg-white border-2 border-[#E2E8F0] hover:border-[#0077B6] rounded-2xl p-4 text-left transition-all hover:shadow-md">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      {b.orderType === 'delivery'
                        ? <Bike size={15} className="text-[#F4792B]"/>
                        : <LayoutGrid size={15} className="text-[#0077B6]"/>}
                      <span className="text-sm font-bold text-[#0F172A]">
                        {b.orderType === 'delivery' ? (b.customerName ?? 'Delivery') : `Mesa ${b.tableId}`}
                      </span>
                    </div>
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full flex items-center gap-1 ${PAY_COLOR[b.paymentMethod]}`}>
                      <PayIcon size={10}/>
                      {PAY_LABEL[b.paymentMethod]}
                    </span>
                  </div>
                  <p className="text-xs text-[#64748B] mb-1">{b.receiptNumber}</p>
                  <p className="text-xs text-[#94A3B8]">{formatLocal(b.paidAt)}</p>
                  <p className="text-xl font-black text-[#F4792B] mt-2">S/ {b.total.toFixed(2)}</p>
                  {b.cashierName && <p className="text-[10px] text-[#94A3B8] mt-1">Cajero: {b.cashierName}</p>}
                </button>
              )
            })}
          </div>
        )}
      </div>

      {/* Detail modal */}
      {(selected || loadingDetail) && (
        <div className="fixed inset-0 z-40 flex items-stretch sm:items-center justify-center p-0 sm:p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-white sm:rounded-3xl w-full max-w-lg shadow-2xl flex flex-col h-full sm:max-h-[92vh]">
            <div className="px-5 py-4 border-b border-[#E2E8F0] flex items-center justify-between shrink-0">
              <div>
                <p className="text-xs text-[#94A3B8] uppercase tracking-wider font-semibold">Boleta</p>
                <h3 className="text-lg font-black text-[#0F172A]">{selected?.bill.receiptNumber ?? '...'}</h3>
              </div>
              <button onClick={() => setSelected(null)}
                className="w-9 h-9 rounded-xl bg-[#EEF3F8] hover:bg-[#E2E8F0] flex items-center justify-center">
                <X size={16}/>
              </button>
            </div>

            {loadingDetail || !selected ? (
              <div className="flex-1 flex items-center justify-center">
                <Loader2 size={28} className="animate-spin text-[#0077B6]"/>
              </div>
            ) : (
              <>
                <div className="flex-1 overflow-y-auto p-5 space-y-3">
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <Info label="Fecha" value={formatLocal(selected.bill.paidAt)}/>
                    <Info label="Cajero" value={selected.cashier?.name ?? '—'}/>
                    <Info
                      label={selected.order?.type === 'delivery' ? 'Cliente' : 'Mesa'}
                      value={selected.order?.type === 'delivery'
                        ? (selected.order?.customerName ?? '—')
                        : `Mesa ${selected.order?.tableId ?? '—'}`}/>
                    <Info label="Pago" value={PAY_LABEL[selected.bill.paymentMethod]}/>
                  </div>

                  <div className="border-t border-[#E2E8F0] pt-3">
                    <p className="text-xs font-bold text-[#64748B] uppercase tracking-wider mb-2">Items</p>
                    <div className="space-y-2">
                      {selected.items.map(it => (
                        <div key={it.id} className="flex items-start justify-between gap-3 py-2 border-b border-[#F1F5F9] last:border-0">
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-semibold text-[#0F172A]">
                              {it.quantity > 1 && <span className="text-[#F4792B] mr-1">×{it.quantity}</span>}
                              {it.dishName}
                            </p>
                            {it.modifiers.filter(m => m.optionName).map((m, i) => (
                              <p key={i} className="text-xs text-[#F4792B]">🌶 {m.optionName}</p>
                            ))}
                            {it.modifiers.filter(m => m.freeText).map((m, i) => (
                              <p key={i} className="text-xs text-[#64748B] italic">{m.freeText}</p>
                            ))}
                          </div>
                          <span className="text-sm font-bold text-[#0F172A] shrink-0">
                            S/ {(it.unitPrice * it.quantity).toFixed(2)}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="border-t border-[#E2E8F0] pt-3 space-y-1">
                    <div className="flex justify-between text-sm font-semibold text-[#64748B]">
                      <span>Subtotal</span><span>S/ {selected.bill.subtotal.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between text-base font-black text-[#0F172A]">
                      <span>TOTAL</span><span>S/ {selected.bill.total.toFixed(2)}</span>
                    </div>
                    {selected.bill.paymentMethod === 'cash' && (
                      <>
                        <div className="flex justify-between text-xs text-[#64748B]">
                          <span>Recibido</span><span>S/ {(selected.bill.cashReceived ?? 0).toFixed(2)}</span>
                        </div>
                        <div className="flex justify-between text-xs text-[#64748B]">
                          <span>Vuelto</span><span>S/ {(selected.bill.changeAmount ?? 0).toFixed(2)}</span>
                        </div>
                      </>
                    )}
                  </div>
                </div>
                <div className="px-5 pb-5 shrink-0">
                  <button onClick={() => reprint(selected.bill.id)} disabled={reprinting}
                    className="w-full flex items-center justify-center gap-2 font-bold py-3.5 rounded-xl text-white text-sm shadow-md disabled:opacity-60"
                    style={{ background: 'linear-gradient(135deg,#0077B6,#004E86)' }}>
                    {reprinting ? <Loader2 size={15} className="animate-spin"/> : <Printer size={15}/>}
                    {reprinting ? 'Imprimiendo…' : 'Reimprimir boleta'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function Stat({ label, value, color, bg }: { label: string; value: string; color: string; bg: string }) {
  return (
    <div className={`${bg} rounded-xl px-3 py-2.5`}>
      <p className={`text-base md:text-lg font-black ${color}`}>{value}</p>
      <p className="text-xs text-[#94A3B8] mt-0.5">{label}</p>
    </div>
  )
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] text-[#94A3B8] uppercase tracking-wider font-semibold">{label}</p>
      <p className="text-sm font-semibold text-[#0F172A] truncate">{value}</p>
    </div>
  )
}
