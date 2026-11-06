import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import api from '../../api/client'
import { useToastStore } from '../../store/toast'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { formatLocalDate } from '../../utils/dates'
import { errorMessage, inputCls, type AppSettings } from './model'
import { Field } from './ui'

// Ajustes del local (solo el dueño). Por ahora, la fecha de apertura del segundo
// local: desde ese día la «Compra del día» muestra y acepta los traslados.
export default function SettingsSection() {
  const pushToast = useToastStore(s => s.push)
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [opened, setOpened] = useState('')
  const [confirming, setConfirming] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    api.get<AppSettings>('/settings')
      .then(({ data }) => { setSettings(data); setOpened(data.second_local_opened_on ?? '') })
      .catch(err => pushToast({ variant: 'error', title: 'No se pudieron cargar los ajustes', message: errorMessage(err) }))
  }, [pushToast])

  const changed = settings !== null && (settings.second_local_opened_on ?? '') !== opened

  const save = async () => {
    setSaving(true)
    try {
      const { data } = await api.put<AppSettings>('/settings', { second_local_opened_on: opened.trim() === '' ? null : opened })
      setSettings(data)
      setOpened(data.second_local_opened_on ?? '')
      setConfirming(false)
      pushToast({ variant: 'success', title: 'Ajustes guardados' })
    } catch (err) {
      pushToast({ variant: 'error', title: 'No se pudo guardar', message: errorMessage(err) })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="bg-white rounded-2xl shadow-sm p-4 space-y-3">
      <div>
        <h2 className="font-black text-[#0F172A]">Ajustes</h2>
        <p className="text-xs text-[#64748B]">Desde la apertura del segundo local se registran los traslados entre locales.</p>
      </div>
      <Field label="Apertura del segundo local">
        <input type="date" value={opened} onChange={e => setOpened(e.target.value)} className={inputCls} />
      </Field>
      <button onClick={() => setConfirming(true)} disabled={!changed || saving}
        className="w-full bg-[#0077B6] hover:bg-[#005a8a] text-white font-bold py-3.5 rounded-xl shadow-md disabled:opacity-40 flex items-center justify-center gap-2">
        {saving && <Loader2 size={16} className="animate-spin" />}
        Guardar ajustes
      </button>
      <ConfirmDialog
        open={confirming}
        title="¿Guardar los ajustes?"
        message={`Apertura del segundo local: ${opened ? formatLocalDate(opened) : '(sin fecha)'}`}
        confirmLabel="Guardar"
        variant="info"
        loading={saving}
        onConfirm={save}
        onCancel={() => setConfirming(false)}
      />
    </div>
  )
}
