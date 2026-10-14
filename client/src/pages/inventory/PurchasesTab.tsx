import { useCallback, useEffect, useState } from 'react'
import { Loader2, Pencil, Trash2 } from 'lucide-react'
import api from '../../api/client'
import { useToastStore } from '../../store/toast'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { addDays, formatLocalDate, localDateString } from '../../utils/dates'
import { errorMessage, fmtQty, inputCls, parseNumber, UNIT_LABEL, type Purchase, type Supply } from './model'
import { Field, RangeToggle, SupplyPicker } from './ui'

const money = (n: number) => 'S/ ' + n.toFixed(2)

export default function PurchasesTab({ supplies }: { supplies: Supply[] }) {
  const pushToast = useToastStore(s => s.push)
  const today = localDateString()

  const [supplyId, setSupplyId] = useState<number | null>(null)
  const [qty, setQty] = useState('')
  const [total, setTotal] = useState('')
  const [date, setDate] = useState(today)
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)

  const [range, setRange] = useState<'today' | 'week'>('week')
  const [rows, setRows] = useState<Purchase[]>([])
  const [loading, setLoading] = useState(true)

  const [edit, setEdit] = useState<{ row: Purchase; mode: 'edit' | 'delete' } | null>(null)
  const [editQty, setEditQty] = useState('')
  const [editTotal, setEditTotal] = useState('')
  const [editReason, setEditReason] = useState('')
  const [savingEdit, setSavingEdit] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const from = range === 'today' ? today : addDays(today, -6)
      const { data } = await api.get<Purchase[]>('/inventory/purchases', { params: { from, to: today } })
      setRows(data)
    } catch (err) {
      pushToast({ variant: 'error', title: 'No se pudieron cargar las compras', message: errorMessage(err, 'Verifica la conexión.') })
    } finally {
      setLoading(false)
    }
  }, [range, today, pushToast])

  useEffect(() => { load() }, [load])

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
        supplyId: supply.id, quantity: qtyN, totalCost: totalN, purchasedAt: date, notes: notes.trim() || null,
      })
      pushToast({ variant: 'success', title: 'Compra registrada', message: `${supply.name}: ${fmtQty(qtyN!, supply.unit)} · ${money(totalN!)}` })
      setSupplyId(null); setQty(''); setTotal(''); setNotes('')
      await load()
    } catch (err) {
      pushToast({ variant: 'error', title: 'No se pudo registrar la compra', message: errorMessage(err) })
    } finally {
      setSaving(false)
    }
  }

  const openEdit = (row: Purchase, mode: 'edit' | 'delete') => {
    setEdit({ row, mode })
    setEditQty(String(row.quantity))
    setEditTotal(String(row.totalCost))
    setEditReason('')
  }

  const editQtyN = parseNumber(editQty)
  const editTotalN = parseNumber(editTotal)
  const editValid = editReason.trim().length >= 3 && (edit?.mode === 'delete'
    || (editQtyN !== null && editQtyN > 0 && editTotalN !== null && editTotalN >= 0))

  const confirmEdit = async () => {
    if (!edit || !editValid) return
    setSavingEdit(true)
    try {
      if (edit.mode === 'edit') {
        await api.patch(`/inventory/purchases/${edit.row.id}`, { quantity: editQtyN, totalCost: editTotalN, reason: editReason.trim() })
        pushToast({ variant: 'success', title: 'Compra corregida' })
      } else {
        await api.delete(`/inventory/purchases/${edit.row.id}`, { data: { reason: editReason.trim() } })
        pushToast({ variant: 'success', title: 'Compra eliminada' })
      }
      setEdit(null)
      await load()
    } catch (err) {
      pushToast({ variant: 'error', title: 'No se pudo guardar', message: errorMessage(err) })
    } finally {
      setSavingEdit(false)
    }
  }

  const periodTotal = rows.reduce((s, r) => s + r.totalCost, 0)

  return (
    <div className="space-y-4">
      <form onSubmit={submit} className="bg-white rounded-2xl shadow-sm p-4 space-y-4">
        <h2 className="font-black text-[#0F172A]">Nueva compra</h2>
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
          <p className="text-xs text-[#64748B] -mt-2">{money(totalN / qtyN)} por {UNIT_LABEL[supply.unit]}</p>
        )}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Fecha">
            <input type="date" value={date} max={today} onChange={e => setDate(e.target.value || today)} className={inputCls} />
          </Field>
          <Field label="Nota (opcional)">
            <input value={notes} onChange={e => setNotes(e.target.value)} maxLength={500} placeholder="Proveedor…" className={inputCls} />
          </Field>
        </div>
        <button type="submit" disabled={!canSave}
          className="w-full bg-[#0077B6] hover:bg-[#005a8a] text-white font-bold py-4 rounded-xl shadow-md disabled:opacity-40 flex items-center justify-center gap-2 transition-colors">
          {saving && <Loader2 size={16} className="animate-spin" />}
          Registrar compra
        </button>
      </form>

      <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-[#E2E8F0] flex items-center justify-between gap-3">
          <div>
            <h2 className="font-black text-[#0F172A]">Compras</h2>
            <p className="text-xs text-[#64748B]">Total: {money(periodTotal)}</p>
          </div>
          <RangeToggle value={range} onChange={setRange} />
        </div>
        {loading ? (
          <div className="p-6 flex justify-center"><Loader2 className="animate-spin text-[#0077B6]" /></div>
        ) : rows.length === 0 ? (
          <p className="p-6 text-sm text-center text-[#94A3B8]">Sin compras registradas en el período.</p>
        ) : (
          <div className="divide-y divide-[#E2E8F0]">
            {rows.map(r => (
              <div key={r.id} className="px-4 py-3 flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-[#0F172A] truncate">{r.supplyName} · {fmtQty(r.quantity, r.unit)}</p>
                  <p className="text-xs text-[#64748B] truncate">
                    {formatLocalDate(r.purchasedAt)} · {money(r.totalCost / r.quantity)}/{UNIT_LABEL[r.unit]}
                    {r.createdByName ? ` · ${r.createdByName}` : ''}{r.notes ? ` · ${r.notes}` : ''}
                  </p>
                </div>
                <p className="text-sm font-black text-[#0F172A] shrink-0">{money(r.totalCost)}</p>
                <button onClick={() => openEdit(r, 'edit')} title="Corregir" className="p-2 rounded-lg text-[#94A3B8] hover:text-[#0077B6] hover:bg-blue-50"><Pencil size={15} /></button>
                <button onClick={() => openEdit(r, 'delete')} title="Eliminar" className="p-2 rounded-lg text-[#94A3B8] hover:text-red-500 hover:bg-red-50"><Trash2 size={15} /></button>
              </div>
            ))}
          </div>
        )}
      </div>

      <ConfirmDialog
        open={edit !== null}
        title={edit?.mode === 'edit' ? 'Corregir compra' : 'Eliminar compra'}
        message={edit ? `${edit.row.supplyName} · ${fmtQty(edit.row.quantity, edit.row.unit)} · ${money(edit.row.totalCost)}` : ''}
        confirmLabel={edit?.mode === 'edit' ? 'Guardar' : 'Eliminar'}
        variant={edit?.mode === 'edit' ? 'info' : 'danger'}
        loading={savingEdit}
        confirmDisabled={!editValid}
        onConfirm={confirmEdit}
        onCancel={() => setEdit(null)}
      >
        <div className="space-y-3">
          {edit?.mode === 'edit' && (
            <div className="grid grid-cols-2 gap-3">
              <Field label={`Cantidad (${UNIT_LABEL[edit.row.unit]})`}>
                <input value={editQty} onChange={e => setEditQty(e.target.value)} inputMode="decimal" className={inputCls} />
              </Field>
              <Field label="Total (S/)">
                <input value={editTotal} onChange={e => setEditTotal(e.target.value)} inputMode="decimal" className={inputCls} />
              </Field>
            </div>
          )}
          <Field label="Motivo (queda registrado)">
            <input value={editReason} onChange={e => setEditReason(e.target.value)} maxLength={200} placeholder="ej: error de digitación" className={inputCls} />
          </Field>
        </div>
      </ConfirmDialog>
    </div>
  )
}
