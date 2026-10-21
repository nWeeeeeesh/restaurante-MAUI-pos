import { useCallback, useEffect, useState } from 'react'
import { Loader2, Pencil, Plus, Trash2, X } from 'lucide-react'
import api from '../../api/client'
import { useToastStore } from '../../store/toast'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { addDays, formatLocalDate, localDateString } from '../../utils/dates'
import {
  errorMessage, fmtQty, inputCls, parseNumber, UNIT_LABEL, WASTE_REASONS,
  type Purchase, type Supply, type WasteReason, type WasteRecord,
} from './model'
import { Field, RangeToggle } from './ui'
import { PurchaseForm, ReasonButtons, WasteForm } from './forms'

// Historial (plan v2.1, D): todo lo registrado —compras y mermas, de la «Compra del
// día» o sueltas— en una sola lista por día, para revisar y corregir con motivo.
// Sin totales ni tendencias: en la línea base el sistema solo refleja lo registrado.

type Filter = 'all' | 'purchase' | 'waste'
type Entry =
  | { kind: 'purchase'; date: string; row: Purchase }
  | { kind: 'waste'; date: string; row: WasteRecord }

const money = (n: number) => 'S/ ' + n.toFixed(2)
const reasonLabel = (r: WasteReason) => WASTE_REASONS.find(w => w.key === r)?.label ?? r

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'Todo' },
  { key: 'purchase', label: 'Compras' },
  { key: 'waste', label: 'Merma' },
]

export default function HistoryTab({ supplies }: { supplies: Supply[] }) {
  const pushToast = useToastStore(s => s.push)
  const today = localDateString()

  const [range, setRange] = useState<'today' | 'week'>('week')
  const [filter, setFilter] = useState<Filter>('all')
  const [entries, setEntries] = useState<Entry[]>([])
  const [loading, setLoading] = useState(true)
  const [adding, setAdding] = useState<'purchase' | 'waste' | null>(null)

  const [edit, setEdit] = useState<{ entry: Entry; mode: 'edit' | 'delete' } | null>(null)
  const [editQty, setEditQty] = useState('')
  const [editTotal, setEditTotal] = useState('')
  const [editCause, setEditCause] = useState<WasteReason | null>(null)
  const [editReason, setEditReason] = useState('')
  const [savingEdit, setSavingEdit] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = { from: range === 'today' ? today : addDays(today, -6), to: today }
      const [p, w] = await Promise.all([
        api.get<Purchase[]>('/inventory/purchases', { params }),
        api.get<WasteRecord[]>('/inventory/waste', { params }),
      ])
      const all: Entry[] = [
        ...p.data.map(row => ({ kind: 'purchase' as const, date: row.purchasedAt, row })),
        // La «Compra del día» guarda Botaste también en 0 (para medir constancia): no es merma que listar
        ...w.data.filter(row => row.quantity > 0).map(row => ({ kind: 'waste' as const, date: row.wastedAt, row })),
      ]
      all.sort((a, b) => b.date.localeCompare(a.date) || b.row.id - a.row.id)
      setEntries(all)
    } catch (err) {
      pushToast({ variant: 'error', title: 'No se pudo cargar el historial', message: errorMessage(err, 'Verifica la conexión.') })
    } finally {
      setLoading(false)
    }
  }, [range, today, pushToast])

  useEffect(() => { load() }, [load])

  const visible = entries.filter(e => filter === 'all' || e.kind === filter)
  const days = [...new Set(visible.map(e => e.date))]

  const openEdit = (entry: Entry, mode: 'edit' | 'delete') => {
    setEdit({ entry, mode })
    setEditQty(String(entry.row.quantity))
    setEditTotal(entry.kind === 'purchase' ? String(entry.row.totalCost) : '')
    setEditCause(entry.kind === 'waste' ? entry.row.reason : null)
    setEditReason('')
  }

  const qtyN = parseNumber(editQty)
  const totalN = parseNumber(editTotal)
  const editValid = editReason.trim().length >= 3 && (edit?.mode === 'delete' || (qtyN !== null && qtyN > 0 && (
    edit?.entry.kind === 'purchase' ? totalN !== null && totalN >= 0 : editCause !== null
  )))

  const confirmEdit = async () => {
    if (!edit || !editValid) return
    const { entry, mode } = edit
    const path = entry.kind === 'purchase' ? `/inventory/purchases/${entry.row.id}` : `/inventory/waste/${entry.row.id}`
    setSavingEdit(true)
    try {
      if (mode === 'delete') {
        await api.delete(path, { data: { reason: editReason.trim() } })
      } else if (entry.kind === 'purchase') {
        await api.patch(path, { quantity: qtyN, totalCost: totalN, reason: editReason.trim() })
      } else {
        // En la merma `reason` es la causa; el motivo de la corrección va aparte
        await api.patch(path, { quantity: qtyN, reason: editCause, correctionReason: editReason.trim() })
      }
      const what = entry.kind === 'purchase' ? 'Compra' : 'Merma'
      pushToast({ variant: 'success', title: mode === 'delete' ? `${what} eliminada` : `${what} corregida` })
      setEdit(null)
      await load()
    } catch (err) {
      pushToast({ variant: 'error', title: 'No se pudo guardar', message: errorMessage(err) })
    } finally {
      setSavingEdit(false)
    }
  }

  const unitOf = (e: Entry) => UNIT_LABEL[e.row.unit]

  return (
    <div className="space-y-3">
      <div className="bg-white rounded-2xl shadow-sm p-3.5 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex gap-1.5">
            {FILTERS.map(f => (
              <button key={f.key} onClick={() => setFilter(f.key)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold ${filter === f.key ? 'bg-[#0077B6] text-white' : 'bg-[#EEF3F8] text-[#64748B]'}`}>
                {f.label}
              </button>
            ))}
          </div>
          <RangeToggle value={range} onChange={setRange} />
        </div>
        <div className="grid grid-cols-2 gap-2">
          {(['purchase', 'waste'] as const).map(k => (
            <button key={k} onClick={() => setAdding(adding === k ? null : k)}
              className={`flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-sm font-semibold border-2 ${
                adding === k ? 'border-[#0077B6] text-[#0077B6]' : 'border-[#E2E8F0] text-[#0F172A]'
              }`}>
              {adding === k ? <X size={14} /> : <Plus size={14} />} {k === 'purchase' ? 'Otra compra' : 'Otra merma'}
            </button>
          ))}
        </div>
        {adding && (
          <p className="text-xs text-[#64748B]">
            {adding === 'purchase'
              ? 'Para insumos no críticos o compras fuera de la «Compra del día».'
              : 'Lo deteriorado de la mañana va en la «Compra del día»; aquí, sobras, preparación y otros.'}
          </p>
        )}
        {adding === 'purchase' && <PurchaseForm supplies={supplies} onSaved={() => { setAdding(null); load() }} />}
        {adding === 'waste' && <WasteForm supplies={supplies} onSaved={() => { setAdding(null); load() }} />}
      </div>

      {loading ? (
        <div className="py-8 flex justify-center"><Loader2 className="animate-spin text-[#0077B6]" /></div>
      ) : visible.length === 0 ? (
        <p className="bg-white rounded-2xl shadow-sm p-6 text-sm text-center text-[#94A3B8]">Nada registrado en el período.</p>
      ) : days.map(day => (
        <div key={day} className="bg-white rounded-2xl shadow-sm overflow-hidden">
          <p className="px-4 py-2 text-xs font-bold text-[#64748B] bg-[#F8FAFC] border-b border-[#E2E8F0] capitalize">{formatLocalDate(day)}</p>
          <div className="divide-y divide-[#E2E8F0]">
            {visible.filter(e => e.date === day).map(e => (
              <div key={`${e.kind}-${e.row.id}`} className="px-4 py-3 flex items-center gap-2">
                <span className={`shrink-0 text-[10px] font-black uppercase px-1.5 py-0.5 rounded ${
                  e.kind === 'purchase' ? 'bg-blue-50 text-[#0077B6]' : 'bg-orange-50 text-[#F4792B]'
                }`}>
                  {e.kind === 'purchase' ? 'Compra' : 'Merma'}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-[#0F172A] truncate">{e.row.supplyName} · {fmtQty(e.row.quantity, e.row.unit)}</p>
                  <p className="text-xs text-[#64748B] truncate">
                    {e.kind === 'purchase'
                      ? `${money(e.row.totalCost)} · ${money(e.row.totalCost / e.row.quantity)}/${unitOf(e)}${e.row.supplier ? ` · ${e.row.supplier}` : ''}`
                      : reasonLabel(e.row.reason)}
                    {e.row.source === 'daily' ? ' · del día' : ''}
                    {e.row.createdByName ? ` · ${e.row.createdByName}` : ''}{e.row.notes ? ` · ${e.row.notes}` : ''}
                  </p>
                </div>
                <button onClick={() => openEdit(e, 'edit')} title="Corregir" className="p-2 rounded-lg text-[#94A3B8] hover:text-[#0077B6] hover:bg-blue-50"><Pencil size={15} /></button>
                <button onClick={() => openEdit(e, 'delete')} title="Eliminar" className="p-2 rounded-lg text-[#94A3B8] hover:text-red-500 hover:bg-red-50"><Trash2 size={15} /></button>
              </div>
            ))}
          </div>
        </div>
      ))}

      <ConfirmDialog
        open={edit !== null}
        title={edit ? `${edit.mode === 'edit' ? 'Corregir' : 'Eliminar'} ${edit.entry.kind === 'purchase' ? 'compra' : 'merma'}` : ''}
        message={edit ? `${edit.entry.row.supplyName} · ${fmtQty(edit.entry.row.quantity, edit.entry.row.unit)} · ${formatLocalDate(edit.entry.date)}` : ''}
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
              <Field label={`Cantidad (${unitOf(edit.entry)})`}>
                <input value={editQty} onChange={e => setEditQty(e.target.value)} inputMode="decimal" className={inputCls} />
              </Field>
              {edit.entry.kind === 'purchase' && (
                <Field label="Total (S/)">
                  <input value={editTotal} onChange={e => setEditTotal(e.target.value)} inputMode="decimal" className={inputCls} />
                </Field>
              )}
            </div>
          )}
          {edit?.mode === 'edit' && edit.entry.kind === 'waste' && <ReasonButtons value={editCause} onChange={setEditCause} />}
          {edit?.entry.row.source === 'daily' && (
            <p className="text-xs text-[#94A3B8]">Viene de la «Compra del día»: si vuelves a guardar ese día, se reemplaza.</p>
          )}
          <Field label="Motivo (queda registrado)">
            <input value={editReason} onChange={e => setEditReason(e.target.value)} maxLength={200} placeholder="ej: error de digitación" className={inputCls} />
          </Field>
        </div>
      </ConfirmDialog>
    </div>
  )
}
