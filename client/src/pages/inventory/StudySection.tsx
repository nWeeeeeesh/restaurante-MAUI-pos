import { useState } from 'react'
import { Loader2, Lock } from 'lucide-react'
import api from '../../api/client'
import { useToastStore } from '../../store/toast'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { formatLocalDate } from '../../utils/dates'
import { errorMessage, GROUP_LABEL, inputCls, type StudyKey, type StudyOverview } from './model'
import { Field } from './ui'

// Configuración del estudio de la tesis (plan v3 §2.3), solo para el dueño. Las fechas
// las carga Cesar tras el sorteo. Una fecha que ya llegó queda bloqueada: mover la
// activación de un grupo después de empezar rompería el diseño del estudio.

const DATE_FIELDS: { key: StudyKey; label: string }[] = [
  { key: 'baseline_starts_on', label: 'Inicio de la línea base' },
  { key: 'activates_calamar', label: 'Se activa calamar' },
  { key: 'activates_pescado', label: 'Se activa pescado' },
  { key: 'study_ends_on', label: 'Fin del estudio' },
  { key: 'activates_mariscos', label: 'Se activa mariscos (después del fin)' },
  { key: 'second_local_opens_on', label: 'Apertura del segundo local' },
]

const LABEL: Record<StudyKey, string> = {
  baseline_starts_on: 'Inicio de la línea base',
  study_ends_on: 'Fin del estudio',
  activation_order: 'Orden sorteado',
  activates_calamar: 'Activación de calamar',
  activates_pescado: 'Activación de pescado',
  activates_mariscos: 'Activación de mariscos',
  second_local_opens_on: 'Apertura del segundo local',
  protocol_url: 'Protocolo',
}

const ORDER_LABEL: Record<string, string> = { 'calamar,pescado': 'Calamar primero', 'pescado,calamar': 'Pescado primero' }

export default function StudySection({ overview, onSaved }: { overview: StudyOverview; onSaved: (o: StudyOverview) => void }) {
  const pushToast = useToastStore(s => s.push)
  const [form, setForm] = useState<Record<StudyKey, string>>(() => formFrom(overview))
  const [confirming, setConfirming] = useState(false)
  const [saving, setSaving] = useState(false)

  const { config, today } = overview
  const locked = (key: StudyKey) =>
    (key.startsWith('activates_') || key === 'baseline_starts_on') && !!config[key] && config[key]! <= today
  const changes = (Object.keys(form) as StudyKey[]).filter(k => (config[k] ?? '') !== form[k])

  const save = async () => {
    setSaving(true)
    try {
      const body = Object.fromEntries(changes.map(k => [k, form[k].trim() === '' ? null : form[k].trim()]))
      const { data } = await api.put<StudyOverview>('/inventory/study', body)
      pushToast({ variant: 'success', title: 'Estudio configurado' })
      setForm(formFrom(data))
      setConfirming(false)
      onSaved(data)
    } catch (err) {
      pushToast({ variant: 'error', title: 'No se pudo guardar', message: errorMessage(err) })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="bg-white rounded-2xl shadow-sm p-4 space-y-3">
      <div>
        <h2 className="font-black text-[#0F172A]">Estudio</h2>
        <p className="text-xs text-[#64748B]">Fechas del estudio de la tesis. Una fecha que ya llegó no se puede cambiar.</p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        {DATE_FIELDS.map(f => (
          <Field key={f.key} label={f.label}>
            <div className="relative">
              <input type="date" value={form[f.key]} disabled={locked(f.key)}
                onChange={e => setForm(v => ({ ...v, [f.key]: e.target.value }))}
                className={`${inputCls} disabled:opacity-60`} />
              {locked(f.key) && <Lock size={12} className="absolute right-2 top-1 text-[#94A3B8]" />}
            </div>
          </Field>
        ))}
        <Field label="Orden sorteado">
          <select value={form.activation_order} onChange={e => setForm(v => ({ ...v, activation_order: e.target.value }))} className={inputCls}>
            <option value="">—</option>
            <option value="calamar,pescado">Calamar primero</option>
            <option value="pescado,calamar">Pescado primero</option>
          </select>
        </Field>
        <Field label="Protocolo (URL)">
          <input value={form.protocol_url} onChange={e => setForm(v => ({ ...v, protocol_url: e.target.value }))}
            inputMode="url" placeholder="https://…" className={inputCls} />
        </Field>
      </div>

      <div className="rounded-xl bg-[#EEF3F8] divide-y divide-white">
        {overview.groups.map(g => (
          <div key={g.group} className="px-3 py-2 flex items-center justify-between gap-2 text-sm">
            <div className="min-w-0">
              <p className="font-bold text-[#0F172A]">{GROUP_LABEL[g.group]}</p>
              <p className="text-xs text-[#64748B] truncate font-mono">{g.supplies.join(', ') || 'sin insumos'}</p>
            </div>
            <span className={`shrink-0 text-xs font-semibold ${g.active_today ? 'text-emerald-700' : 'text-[#64748B]'}`}>
              {g.activates_on ? `${g.active_today ? 'Activo desde' : 'Se activa el'} ${formatLocalDate(g.activates_on)}` : 'Sin fecha'}
            </span>
          </div>
        ))}
      </div>

      <button onClick={() => setConfirming(true)} disabled={changes.length === 0 || saving}
        className="w-full bg-[#0077B6] hover:bg-[#005a8a] text-white font-bold py-3.5 rounded-xl shadow-md disabled:opacity-40 flex items-center justify-center gap-2">
        {saving && <Loader2 size={16} className="animate-spin" />}
        Guardar configuración
      </button>

      <ConfirmDialog
        open={confirming}
        title="¿Guardar la configuración del estudio?"
        message={changes.map(k => `${LABEL[k]}: ${show(k, form[k])}`).join('\n')}
        confirmLabel="Guardar"
        variant="warning"
        loading={saving}
        onConfirm={save}
        onCancel={() => setConfirming(false)}
      />
    </div>
  )
}

function formFrom(o: StudyOverview): Record<StudyKey, string> {
  const c = o.config
  return {
    baseline_starts_on: c.baseline_starts_on ?? '',
    study_ends_on: c.study_ends_on ?? '',
    activation_order: c.activation_order ?? '',
    activates_calamar: c.activates_calamar ?? '',
    activates_pescado: c.activates_pescado ?? '',
    activates_mariscos: c.activates_mariscos ?? '',
    second_local_opens_on: c.second_local_opens_on ?? '',
    protocol_url: c.protocol_url ?? '',
  }
}

function show(key: StudyKey, value: string) {
  if (value.trim() === '') return '(sin valor)'
  if (key === 'activation_order') return ORDER_LABEL[value] ?? value
  if (key === 'protocol_url') return value
  return formatLocalDate(value)
}
