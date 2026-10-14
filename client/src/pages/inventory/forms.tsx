import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import api from '../../api/client'
import { useToastStore } from '../../store/toast'
import { localDateString } from '../../utils/dates'
import {
  errorMessage, fmtQty, inputCls, parseNumber, UNIT_LABEL, WASTE_REASONS,
  type Supply, type WasteReason,
} from './model'
import { Field, SupplyPicker } from './ui'

// Registros fuera de la rutina diaria: compras de insumos no críticos o fuera de la
// «Compra del día», y merma por otras causas (sobras, preparación). Viven plegados
// dentro del Historial.

const money = (n: number) => 'S/ ' + n.toFixed(2)

export function ReasonButtons({ value, onChange }: { value: WasteReason | null; onChange: (r: WasteReason) => void }) {
  return (
    <div className="grid grid-cols-2 gap-2">
      {WASTE_REASONS.map(r => (
        <button key={r.key} type="button" onClick={() => onChange(r.key)}
          className={`py-3 px-2 rounded-xl text-sm font-semibold border-2 transition-all ${
            value === r.key ? 'bg-[#F4792B] text-white border-[#F4792B] shadow-md' : 'bg-white text-[#0F172A] border-[#E2E8F0] hover:border-[#F4792B]'
          }`}>
          {r.label}
        </button>
      ))}
    </div>
  )
}

export function PurchaseForm({ supplies, onSaved }: { supplies: Supply[]; onSaved: () => void }) {
  const pushToast = useToastStore(s => s.push)
  const today = localDateString()
  const [supplyId, setSupplyId] = useState<number | null>(null)
  const [qty, setQty] = useState('')
  const [total, setTotal] = useState('')
  const [date, setDate] = useState(today)
  const [supplier, setSupplier] = useState('')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)

  const supply = supplies.find(s => s.id === supplyId)
  const qtyN = parseNumber(qty)
  const totalN = parseNumber(total)
  const canSave = supply !== undefined && qtyN !== null && qtyN > 0 && totalN !== null && totalN >= 0 && !saving

  const submit = async (ev: React.FormEvent) => {
    ev.preventDefault()
    if (!canSave || !supply) return
    setSaving(true)
    try {
      await api.post('/inventory/purchases', {
        supplyId: supply.id, quantity: qtyN, totalCost: totalN, purchasedAt: date,
        supplier: supplier.trim() || null, notes: notes.trim() || null,
      })
      pushToast({ variant: 'success', title: 'Compra registrada', message: `${supply.name}: ${fmtQty(qtyN!, supply.unit)} · ${money(totalN!)}` })
      setSupplyId(null); setQty(''); setTotal(''); setNotes('')
      onSaved()
    } catch (err) {
      pushToast({ variant: 'error', title: 'No se pudo registrar la compra', message: errorMessage(err) })
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <SupplyPicker supplies={supplies} value={supplyId} onChange={setSupplyId} />
      <div className="grid grid-cols-2 gap-3">
        <Field label={`Cantidad${supply ? ` (${UNIT_LABEL[supply.unit]})` : ''}`}>
          <input value={qty} onChange={e => setQty(e.target.value)} inputMode="decimal" placeholder="0" className={inputCls} />
        </Field>
        <Field label="Total pagado (S/)">
          <input value={total} onChange={e => setTotal(e.target.value)} inputMode="decimal" placeholder="0.00" className={inputCls} />
        </Field>
      </div>
      {supply && qtyN !== null && qtyN > 0 && totalN !== null && (
        <p className="text-xs text-[#64748B] -mt-1">{money(totalN / qtyN)} por {UNIT_LABEL[supply.unit]}</p>
      )}
      <div className="grid grid-cols-2 gap-3">
        <Field label="Fecha">
          <input type="date" value={date} max={today} onChange={e => setDate(e.target.value || today)} className={inputCls} />
        </Field>
        <Field label="Proveedor (opcional)">
          <input value={supplier} onChange={e => setSupplier(e.target.value)} maxLength={80} placeholder="Puesto…" className={inputCls} />
        </Field>
      </div>
      <Field label="Nota (opcional)">
        <input value={notes} onChange={e => setNotes(e.target.value)} maxLength={500} className={inputCls} />
      </Field>
      <button type="submit" disabled={!canSave}
        className="w-full bg-[#0077B6] hover:bg-[#005a8a] text-white font-bold py-3.5 rounded-xl shadow-md disabled:opacity-40 flex items-center justify-center gap-2 transition-colors">
        {saving && <Loader2 size={16} className="animate-spin" />}
        Registrar compra
      </button>
    </form>
  )
}

export function WasteForm({ supplies, onSaved }: { supplies: Supply[]; onSaved: () => void }) {
  const pushToast = useToastStore(s => s.push)
  const today = localDateString()
  const [supplyId, setSupplyId] = useState<number | null>(null)
  const [qty, setQty] = useState('')
  const [reason, setReason] = useState<WasteReason | null>(null)
  const [date, setDate] = useState(today)
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)

  const supply = supplies.find(s => s.id === supplyId)
  const qtyN = parseNumber(qty)
  const canSave = supply !== undefined && qtyN !== null && qtyN > 0 && reason !== null && !saving

  const submit = async (ev: React.FormEvent) => {
    ev.preventDefault()
    if (!canSave || !supply || !reason) return
    setSaving(true)
    try {
      await api.post('/inventory/waste', { supplyId: supply.id, quantity: qtyN, reason, wastedAt: date, notes: notes.trim() || null })
      const label = WASTE_REASONS.find(w => w.key === reason)?.label ?? reason
      pushToast({ variant: 'success', title: 'Merma registrada', message: `${supply.name}: ${fmtQty(qtyN!, supply.unit)} · ${label}` })
      setSupplyId(null); setQty(''); setReason(null); setNotes('')
      onSaved()
    } catch (err) {
      pushToast({ variant: 'error', title: 'No se pudo registrar la merma', message: errorMessage(err) })
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <SupplyPicker supplies={supplies} value={supplyId} onChange={setSupplyId} />
      <Field label={`Cantidad${supply ? ` (${UNIT_LABEL[supply.unit]})` : ''}`}>
        <input value={qty} onChange={e => setQty(e.target.value)} inputMode="decimal" placeholder="0" className={inputCls} />
      </Field>
      <div>
        <span className="text-xs font-semibold text-[#64748B] block mb-1">Motivo</span>
        <ReasonButtons value={reason} onChange={setReason} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Fecha">
          <input type="date" value={date} max={today} onChange={e => setDate(e.target.value || today)} className={inputCls} />
        </Field>
        <Field label="Nota (opcional)">
          <input value={notes} onChange={e => setNotes(e.target.value)} maxLength={500} placeholder="Detalle…" className={inputCls} />
        </Field>
      </div>
      <button type="submit" disabled={!canSave}
        className="w-full bg-[#F4792B] hover:bg-[#e06a1f] text-white font-bold py-3.5 rounded-xl shadow-md disabled:opacity-40 flex items-center justify-center gap-2 transition-colors">
        {saving && <Loader2 size={16} className="animate-spin" />}
        Registrar merma
      </button>
    </form>
  )
}
