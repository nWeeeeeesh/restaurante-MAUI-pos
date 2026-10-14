import { useCallback, useEffect, useState } from 'react'
import { Loader2, Pencil, Trash2 } from 'lucide-react'
import api from '../../api/client'
import { useToastStore } from '../../store/toast'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { addDays, formatLocalDate, localDateString } from '../../utils/dates'
import {
  errorMessage, fmtQty, inputCls, parseNumber, UNIT_LABEL, WASTE_REASONS,
  type Supply, type WasteReason, type WasteRecord,
} from './model'
import { Field, RangeToggle, SupplyPicker } from './ui'

const reasonLabel = (r: WasteReason) => WASTE_REASONS.find(w => w.key === r)?.label ?? r

function ReasonButtons({ value, onChange }: { value: WasteReason | null; onChange: (r: WasteReason) => void }) {
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

export default function WasteTab({ supplies }: { supplies: Supply[] }) {
  const pushToast = useToastStore(s => s.push)
  const today = localDateString()

  const [supplyId, setSupplyId] = useState<number | null>(null)
  const [qty, setQty] = useState('')
  const [reason, setReason] = useState<WasteReason | null>(null)
  const [date, setDate] = useState(today)
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)

  const [range, setRange] = useState<'today' | 'week'>('week')
  const [rows, setRows] = useState<WasteRecord[]>([])
  const [loading, setLoading] = useState(true)

  const [edit, setEdit] = useState<{ row: WasteRecord; mode: 'edit' | 'delete' } | null>(null)
  const [editQty, setEditQty] = useState('')
  const [editCause, setEditCause] = useState<WasteReason | null>(null)
  const [editReason, setEditReason] = useState('')
  const [savingEdit, setSavingEdit] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const from = range === 'today' ? today : addDays(today, -6)
      const { data } = await api.get<WasteRecord[]>('/inventory/waste', { params: { from, to: today } })
      setRows(data)
    } catch (err) {
      pushToast({ variant: 'error', title: 'No se pudo cargar la merma', message: errorMessage(err, 'Verifica la conexión.') })
    } finally {
      setLoading(false)
    }
  }, [range, today, pushToast])

  useEffect(() => { load() }, [load])

  const supply = supplies.find(s => s.id === supplyId)
  const qtyN = parseNumber(qty)
  const canSave = supply !== undefined && qtyN !== null && qtyN > 0 && reason !== null && !saving

  const submit = async (ev: React.FormEvent) => {
    ev.preventDefault()
    if (!canSave || !supply || !reason) return
    setSaving(true)
    try {
      await api.post('/inventory/waste', { supplyId: supply.id, quantity: qtyN, reason, wastedAt: date, notes: notes.trim() || null })
      pushToast({ variant: 'success', title: 'Merma registrada', message: `${supply.name}: ${fmtQty(qtyN!, supply.unit)} · ${reasonLabel(reason)}` })
      setSupplyId(null); setQty(''); setReason(null); setNotes('')
      await load()
    } catch (err) {
      pushToast({ variant: 'error', title: 'No se pudo registrar la merma', message: errorMessage(err) })
    } finally {
      setSaving(false)
    }
  }

  const openEdit = (row: WasteRecord, mode: 'edit' | 'delete') => {
    setEdit({ row, mode })
    setEditQty(String(row.quantity))
    setEditCause(row.reason)
    setEditReason('')
  }

  const editQtyN = parseNumber(editQty)
  const editValid = editReason.trim().length >= 3 && (edit?.mode === 'delete' || (editQtyN !== null && editQtyN > 0 && editCause !== null))

  const confirmEdit = async () => {
    if (!edit || !editValid) return
    setSavingEdit(true)
    try {
      if (edit.mode === 'edit') {
        // `reason` es la causa de la merma; el motivo de la corrección va en correctionReason
        await api.patch(`/inventory/waste/${edit.row.id}`, { quantity: editQtyN, reason: editCause, correctionReason: editReason.trim() })
        pushToast({ variant: 'success', title: 'Merma corregida' })
      } else {
        await api.delete(`/inventory/waste/${edit.row.id}`, { data: { reason: editReason.trim() } })
        pushToast({ variant: 'success', title: 'Merma eliminada' })
      }
      setEdit(null)
      await load()
    } catch (err) {
      pushToast({ variant: 'error', title: 'No se pudo guardar', message: errorMessage(err) })
    } finally {
      setSavingEdit(false)
    }
  }

  return (
    <div className="space-y-4">
      <form onSubmit={submit} className="bg-white rounded-2xl shadow-sm p-4 space-y-4">
        <h2 className="font-black text-[#0F172A]">Nueva merma</h2>
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
          className="w-full bg-[#F4792B] hover:bg-[#e06a1f] text-white font-bold py-4 rounded-xl shadow-md disabled:opacity-40 flex items-center justify-center gap-2 transition-colors">
          {saving && <Loader2 size={16} className="animate-spin" />}
          Registrar merma
        </button>
      </form>

      <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-[#E2E8F0] flex items-center justify-between gap-3">
          <h2 className="font-black text-[#0F172A]">Merma</h2>
          <RangeToggle value={range} onChange={setRange} />
        </div>
        {loading ? (
          <div className="p-6 flex justify-center"><Loader2 className="animate-spin text-[#0077B6]" /></div>
        ) : rows.length === 0 ? (
          <p className="p-6 text-sm text-center text-[#94A3B8]">Sin merma registrada en el período.</p>
        ) : (
          <div className="divide-y divide-[#E2E8F0]">
            {rows.map(r => (
              <div key={r.id} className="px-4 py-3 flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-[#0F172A] truncate">{r.supplyName} · {fmtQty(r.quantity, r.unit)}</p>
                  <p className="text-xs text-[#64748B] truncate">
                    {formatLocalDate(r.wastedAt)} · {reasonLabel(r.reason)}
                    {r.createdByName ? ` · ${r.createdByName}` : ''}{r.notes ? ` · ${r.notes}` : ''}
                  </p>
                </div>
                <button onClick={() => openEdit(r, 'edit')} title="Corregir" className="p-2 rounded-lg text-[#94A3B8] hover:text-[#0077B6] hover:bg-blue-50"><Pencil size={15} /></button>
                <button onClick={() => openEdit(r, 'delete')} title="Eliminar" className="p-2 rounded-lg text-[#94A3B8] hover:text-red-500 hover:bg-red-50"><Trash2 size={15} /></button>
              </div>
            ))}
          </div>
        )}
      </div>

      <ConfirmDialog
        open={edit !== null}
        title={edit?.mode === 'edit' ? 'Corregir merma' : 'Eliminar merma'}
        message={edit ? `${edit.row.supplyName} · ${fmtQty(edit.row.quantity, edit.row.unit)} · ${reasonLabel(edit.row.reason)}` : ''}
        confirmLabel={edit?.mode === 'edit' ? 'Guardar' : 'Eliminar'}
        variant={edit?.mode === 'edit' ? 'info' : 'danger'}
        loading={savingEdit}
        confirmDisabled={!editValid}
        onConfirm={confirmEdit}
        onCancel={() => setEdit(null)}
      >
        <div className="space-y-3">
          {edit?.mode === 'edit' && (<>
            <Field label={`Cantidad (${UNIT_LABEL[edit.row.unit]})`}>
              <input value={editQty} onChange={e => setEditQty(e.target.value)} inputMode="decimal" className={inputCls} />
            </Field>
            <ReasonButtons value={editCause} onChange={setEditCause} />
          </>)}
          <Field label="Motivo de la corrección (queda registrado)">
            <input value={editReason} onChange={e => setEditReason(e.target.value)} maxLength={200} placeholder="ej: pesé mal" className={inputCls} />
          </Field>
        </div>
      </ConfirmDialog>
    </div>
  )
}
