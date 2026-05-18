import { useToastStore, type ToastVariant } from '../store/toast'
import { CheckCircle2, AlertTriangle, Info, X, Loader2 } from 'lucide-react'

const VARIANT: Record<ToastVariant, { icon: any; bg: string; border: string; text: string; iconColor: string }> = {
  success: { icon: CheckCircle2,    bg: 'bg-emerald-50',  border: 'border-emerald-200', text: 'text-emerald-800', iconColor: 'text-emerald-500' },
  error:   { icon: AlertTriangle,   bg: 'bg-red-50',      border: 'border-red-200',     text: 'text-red-800',     iconColor: 'text-red-500' },
  warning: { icon: AlertTriangle,   bg: 'bg-amber-50',    border: 'border-amber-200',   text: 'text-amber-800',   iconColor: 'text-amber-500' },
  info:    { icon: Info,            bg: 'bg-blue-50',     border: 'border-blue-200',    text: 'text-blue-800',    iconColor: 'text-blue-500' },
  loading: { icon: Loader2,         bg: 'bg-white',       border: 'border-[#E2E8F0]',   text: 'text-[#0F172A]',   iconColor: 'text-[#0077B6]' },
}

export default function ToastHost() {
  const { toasts, dismiss } = useToastStore()

  return (
    <div className="fixed top-4 right-4 z-[100] flex flex-col gap-2 max-w-sm w-[calc(100%-2rem)] sm:w-96 pointer-events-none">
      {toasts.map(t => {
        const v = VARIANT[t.variant]
        const Icon = v.icon
        return (
          <div key={t.id}
            className={`pointer-events-auto rounded-2xl border ${v.border} ${v.bg} shadow-lg p-3.5 flex items-start gap-3`}
            style={{ animation: 'toast-in 180ms ease-out' }}>
            <div className={`shrink-0 mt-0.5 ${v.iconColor}`}>
              <Icon size={20} className={t.variant === 'loading' ? 'animate-spin' : ''} />
            </div>
            <div className="flex-1 min-w-0">
              <p className={`text-sm font-bold ${v.text} leading-tight`}>{t.title}</p>
              {t.message && <p className={`text-xs mt-0.5 ${v.text} opacity-80`}>{t.message}</p>}
            </div>
            <button onClick={() => dismiss(t.id)}
              className={`shrink-0 ${v.text} opacity-50 hover:opacity-100 transition-opacity`}>
              <X size={15}/>
            </button>
          </div>
        )
      })}
    </div>
  )
}

// Helpers convenientes para escenarios comunes de impresora
export function showPrinterStarted(action: string): number {
  return useToastStore.getState().push({
    variant: 'loading',
    title: 'Imprimiendo...',
    message: action,
    durationMs: 0,
  })
}

export function showPrinterSuccess(toastId: number, title: string, message?: string) {
  useToastStore.getState().update(toastId, {
    variant: 'success',
    title,
    message,
    durationMs: 3000,
  })
}

export function showPrinterError(toastId: number, message: string) {
  useToastStore.getState().update(toastId, {
    variant: 'error',
    title: 'Impresora no disponible',
    message,
    durationMs: 5000,
  })
}
