import { useEffect } from 'react'
import { AlertTriangle, Loader2 } from 'lucide-react'

export interface ConfirmDialogProps {
  open: boolean
  title: string
  message?: string
  confirmLabel?: string
  cancelLabel?: string
  variant?: 'danger' | 'warning' | 'info'
  loading?: boolean
  onConfirm: () => void
  onCancel: () => void
}

const VARIANTS = {
  danger:  { icon: 'text-red-500',   iconBg: 'bg-red-50',    btn: 'bg-red-500 hover:bg-red-600' },
  warning: { icon: 'text-amber-500', iconBg: 'bg-amber-50',  btn: 'bg-amber-500 hover:bg-amber-600' },
  info:    { icon: 'text-[#0077B6]', iconBg: 'bg-[#EEF3F8]', btn: 'bg-[#0077B6] hover:bg-[#005a8a]' },
}

export function ConfirmDialog({
  open, title, message,
  confirmLabel = 'Confirmar',
  cancelLabel  = 'Cancelar',
  variant = 'danger',
  loading = false,
  onConfirm, onCancel,
}: ConfirmDialogProps) {
  // Cerrar con Escape
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !loading) onCancel()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, loading, onCancel])

  if (!open) return null
  const v = VARIANTS[variant]

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="bg-white rounded-3xl w-full max-w-sm shadow-2xl p-6 text-center">
        <div className={`w-16 h-16 ${v.iconBg} rounded-full flex items-center justify-center mx-auto mb-4`}>
          <AlertTriangle size={28} className={v.icon}/>
        </div>
        <h3 className="text-lg font-black text-[#0F172A] mb-2">{title}</h3>
        {message && <p className="text-[#64748B] text-sm mb-6 whitespace-pre-line">{message}</p>}
        <div className="flex gap-3">
          <button onClick={onCancel} disabled={loading}
            className="flex-1 font-semibold py-3 rounded-xl text-[#64748B] bg-[#EEF3F8] hover:bg-[#E2E8F0] transition-colors disabled:opacity-50">
            {cancelLabel}
          </button>
          <button onClick={onConfirm} disabled={loading}
            className={`flex-1 font-bold py-3 rounded-xl text-white shadow-md transition-colors disabled:opacity-60 flex items-center justify-center gap-2 ${v.btn}`}>
            {loading && <Loader2 size={15} className="animate-spin"/>}
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
