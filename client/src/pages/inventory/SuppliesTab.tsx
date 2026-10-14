import { useCallback, useEffect, useState } from 'react'
import { Loader2, Pencil } from 'lucide-react'
import api from '../../api/client'
import { useToastStore } from '../../store/toast'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { errorMessage, inputCls, UNIT_LABEL, type Supply, type Unit } from './model'
import { Field } from './ui'

const UNITS: Unit[] = ['kg', 'unit', 'l']

function UnitButtons({ value, onChange }: { value: Unit; onChange: (u: Unit) => void }) {
  return (
    <div className="flex gap-2">
      {UNITS.map(u => (
        <button key={u} type="button" onClick={() => onChange(u)}
          className={`flex-1 py-2.5 rounded-xl text-sm font-semibold border-2 ${value === u ? 'bg-[#0077B6] text-white border-[#0077B6]' : 'bg-white text-[#0F172A] border-[#E2E8F0]'}`}>
          {UNIT_LABEL[u]}
        </button>
      ))}
    </div>
  )
}

function Toggle({ on, label, onClick, disabled }: { on: boolean; label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled}
      className={`text-xs font-bold px-2.5 py-1.5 rounded-lg disabled:opacity-50 ${on ? 'bg-[#0077B6] text-white' : 'bg-[#EEF3F8] text-[#94A3B8]'}`}>
      {label}
    </button>
  )
}

// Catálogo de insumos (solo el dueño). "Crítico" = entra al conteo de cierre y
// al estudio; desactivar oculta el insumo sin perder su historial.
export default function SuppliesTab({ onChanged }: { onChanged: () => void }) {
  const pushToast = useToastStore(s => s.push)
  const [rows, setRows] = useState<Supply[]>([])
  const [loading, setLoading] = useState(true)

  const [name, setName] = useState('')
  const [unit, setUnit] = useState<Unit>('kg')
  const [critical, setCritical] = useState(false)
  const [perishable, setPerishable] = useState(true)
  const [saving, setSaving] = useState(false)
  const [busyId, setBusyId] = useState<number | null>(null)

  const [editing, setEditing] = useState<Supply | null>(null)
  const [editName, setEditName] = useState('')
  const [editUnit, setEditUnit] = useState<Unit>('kg')
  const [editOrder, setEditOrder] = useState('')
  const [savingEdit, setSavingEdit] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const { data } = await api.get<Supply[]>('/inventory/supplies', { params: { all: 'true' } })
      setRows(data)
    } catch (err) {
      pushToast({ variant: 'error', title: 'No se pudieron cargar los insumos', message: errorMessage(err, 'Verifica la conexión.') })
    } finally {
      setLoading(false)
    }
  }, [pushToast])

  useEffect(() => { load() }, [load])

  const afterChange = async () => { await load(); onChanged() }

  const create = async (ev: React.FormEvent) => {
    ev.preventDefault()
    if (!name.trim() || saving) return
    setSaving(true)
    try {
      // Al final del orden; el código lo genera el servidor desde el nombre
      const sortOrder = Math.max(0, ...rows.map(r => r.sortOrder ?? 0)) + 1
      await api.post('/inventory/supplies', { name: name.trim(), unit, critical, perishable, sortOrder })
      pushToast({ variant: 'success', title: 'Insumo agregado', message: name.trim() })
      setName(''); setCritical(false); setPerishable(true)
      await afterChange()
    } catch (err) {
      pushToast({ variant: 'error', title: 'No se pudo agregar', message: errorMessage(err) })
    } finally {
      setSaving(false)
    }
  }

  const patch = async (s: Supply, changes: Partial<Supply>) => {
    setBusyId(s.id)
    try {
      await api.patch(`/inventory/supplies/${s.id}`, changes)
      await afterChange()
    } catch (err) {
      pushToast({ variant: 'error', title: 'No se pudo actualizar', message: errorMessage(err) })
    } finally {
      setBusyId(null)
    }
  }

  const saveEdit = async () => {
    if (!editing || !editName.trim()) return
    setSavingEdit(true)
    try {
      const order = parseInt(editOrder, 10)
      await api.patch(`/inventory/supplies/${editing.id}`, {
        name: editName.trim(), unit: editUnit, ...(Number.isInteger(order) && order >= 0 ? { sortOrder: order } : {}),
      })
      pushToast({ variant: 'success', title: 'Insumo actualizado' })
      setEditing(null)
      await afterChange()
    } catch (err) {
      pushToast({ variant: 'error', title: 'No se pudo guardar', message: errorMessage(err) })
    } finally {
      setSavingEdit(false)
    }
  }

  return (
    <div className="space-y-4">
      <form onSubmit={create} className="bg-white rounded-2xl shadow-sm p-4 space-y-3">
        <h2 className="font-black text-[#0F172A]">Nuevo insumo</h2>
        <Field label="Nombre">
          <input value={name} onChange={e => setName(e.target.value)} maxLength={80} placeholder="ej: Pulpo" className={inputCls} />
        </Field>
        <UnitButtons value={unit} onChange={setUnit} />
        <div className="flex gap-2">
          <Toggle on={critical} label="Crítico (va en la compra del día)" onClick={() => setCritical(c => !c)} />
          <Toggle on={perishable} label="Perecible" onClick={() => setPerishable(p => !p)} />
        </div>
        <button type="submit" disabled={!name.trim() || saving}
          className="w-full bg-[#0077B6] hover:bg-[#005a8a] text-white font-bold py-3.5 rounded-xl shadow-md disabled:opacity-40 flex items-center justify-center gap-2">
          {saving && <Loader2 size={16} className="animate-spin" />}
          Agregar insumo
        </button>
      </form>

      <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-[#E2E8F0]">
          <h2 className="font-black text-[#0F172A]">Insumos ({rows.length})</h2>
        </div>
        {loading ? (
          <div className="p-6 flex justify-center"><Loader2 className="animate-spin text-[#0077B6]" /></div>
        ) : (
          <div className="divide-y divide-[#E2E8F0]">
            {rows.map(s => (
              <div key={s.id} className={`px-4 py-3 flex flex-wrap items-center gap-2 ${s.active === false ? 'opacity-50' : ''}`}>
                <div className="flex-1 min-w-[8rem]">
                  <p className="text-sm font-bold text-[#0F172A]">{s.name}</p>
                  <p className="text-xs text-[#64748B]">
                    <span className="font-mono">{s.code}</span> · {UNIT_LABEL[s.unit]}{s.perishable ? ' · perecible' : ''}
                  </p>
                </div>
                <Toggle on={s.critical === true} label="Crítico" disabled={busyId === s.id} onClick={() => patch(s, { critical: !s.critical })} />
                <Toggle on={s.active !== false} label={s.active === false ? 'Inactivo' : 'Activo'} disabled={busyId === s.id} onClick={() => patch(s, { active: s.active === false })} />
                <button onClick={() => { setEditing(s); setEditName(s.name); setEditUnit(s.unit); setEditOrder(String(s.sortOrder ?? 0)) }} title="Editar"
                  className="p-2 rounded-lg text-[#94A3B8] hover:text-[#0077B6] hover:bg-blue-50"><Pencil size={15} /></button>
              </div>
            ))}
          </div>
        )}
      </div>

      <ConfirmDialog
        open={editing !== null}
        title="Editar insumo"
        confirmLabel="Guardar"
        variant="info"
        loading={savingEdit}
        confirmDisabled={!editName.trim()}
        onConfirm={saveEdit}
        onCancel={() => setEditing(null)}
      >
        <div className="space-y-3">
          <Field label="Nombre">
            <input value={editName} onChange={e => setEditName(e.target.value)} maxLength={80} className={inputCls} />
          </Field>
          <UnitButtons value={editUnit} onChange={setEditUnit} />
          <Field label="Orden en la compra del día">
            <input value={editOrder} onChange={e => setEditOrder(e.target.value)} inputMode="numeric" className={inputCls} />
          </Field>
          <p className="text-xs text-[#94A3B8]">
            Código <span className="font-mono">{editing?.code}</span>: no cambia aunque cambie el nombre (identifica el insumo en los datos de la tesis).
            Cambiar la unidad no convierte lo ya registrado.
          </p>
        </div>
      </ConfirmDialog>
    </div>
  )
}
