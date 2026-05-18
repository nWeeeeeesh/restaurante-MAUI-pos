import { useState } from 'react'
import { KeyRound, Loader2, X } from 'lucide-react'
import api from '../api/client'
import { useToastStore } from '../store/toast'

export function ChangePasswordModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [current, setCurrent] = useState('')
  const [next, setNext]       = useState('')
  const [confirm, setConfirm] = useState('')
  const [saving, setSaving]   = useState(false)
  const { push: toast }       = useToastStore()

  if (!open) return null

  const handleSave = async () => {
    if (!current || !next) { toast({ variant: 'warning', title: 'Completa todos los campos' }); return }
    if (next.length < 4)   { toast({ variant: 'warning', title: 'La nueva contraseña debe tener al menos 4 caracteres' }); return }
    if (next !== confirm)  { toast({ variant: 'warning', title: 'Las contraseñas no coinciden' }); return }
    setSaving(true)
    try {
      await api.post('/users/me/password', { currentPassword: current, newPassword: next })
      toast({ variant: 'success', title: 'Contraseña actualizada' })
      setCurrent(''); setNext(''); setConfirm('')
      onClose()
    } catch (e: any) {
      toast({ variant: 'error', title: 'No se pudo actualizar', message: e?.response?.data?.error })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-white rounded-t-3xl sm:rounded-3xl w-full max-w-sm shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-[#E2E8F0] flex items-center justify-between">
          <h3 className="font-black text-lg text-[#0F172A] flex items-center gap-2">
            <KeyRound size={18} className="text-[#0077B6]"/> Mi contraseña
          </h3>
          <button onClick={onClose} className="w-8 h-8 rounded-xl bg-[#EEF3F8] flex items-center justify-center"><X size={15}/></button>
        </div>
        <div className="p-5 space-y-3">
          <input value={current} onChange={e => setCurrent(e.target.value)}
            placeholder="Contraseña actual" type="password" autoFocus
            className="w-full bg-white border-2 border-[#E2E8F0] focus:border-[#0077B6] rounded-xl px-3 py-2.5 text-sm focus:outline-none"/>
          <input value={next} onChange={e => setNext(e.target.value)}
            placeholder="Nueva contraseña" type="password"
            className="w-full bg-white border-2 border-[#E2E8F0] focus:border-[#0077B6] rounded-xl px-3 py-2.5 text-sm focus:outline-none"/>
          <input value={confirm} onChange={e => setConfirm(e.target.value)}
            placeholder="Confirmar nueva contraseña" type="password"
            onKeyDown={e => { if (e.key === 'Enter') handleSave() }}
            className="w-full bg-white border-2 border-[#E2E8F0] focus:border-[#0077B6] rounded-xl px-3 py-2.5 text-sm focus:outline-none"/>
        </div>
        <div className="p-5 pt-2 flex gap-2 border-t border-[#E2E8F0]">
          <button onClick={onClose} disabled={saving}
            className="flex-1 font-semibold py-3 rounded-xl text-[#64748B] bg-[#EEF3F8] hover:bg-[#E2E8F0] disabled:opacity-50">
            Cancelar
          </button>
          <button onClick={handleSave} disabled={saving}
            className="flex-1 font-bold py-3 rounded-xl text-white bg-[#0077B6] hover:bg-[#005a8a] shadow-md disabled:opacity-60 flex items-center justify-center gap-2">
            {saving ? <Loader2 size={15} className="animate-spin"/> : <KeyRound size={15}/>}
            Guardar
          </button>
        </div>
      </div>
    </div>
  )
}
