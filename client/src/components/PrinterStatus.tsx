import { useEffect, useState, useCallback } from 'react'
import { Printer, Loader2, RefreshCw, Trash2 } from 'lucide-react'
import api from '../api/client'
import { useToastStore } from '../store/toast'

export interface PrinterStatusResult {
  ok: boolean
  reason?: string
  type: 'tcp' | 'windows'
  identifier: string
  state?: string
}

interface Props {
  /** Estilo: 'sidebar' (oscuro, vertical) o 'inline' (claro, en headers) */
  variant?: 'sidebar' | 'inline'
  pollMs?: number
}

export function PrinterStatusPill({ variant = 'inline', pollMs = 30000 }: Props) {
  const [status, setStatus] = useState<PrinterStatusResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [clearing, setClearing] = useState(false)
  const [showActions, setShowActions] = useState(false)
  const { push: toast } = useToastStore()

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const { data } = await api.get<PrinterStatusResult>('/print/status')
      setStatus(data)
    } catch {
      setStatus({ ok: false, reason: 'No se pudo consultar la impresora', type: 'tcp', identifier: '' })
    } finally {
      setLoading(false)
    }
  }, [])

  const clearQueue = useCallback(async () => {
    setClearing(true)
    try {
      const { data } = await api.post<{ ok: true; removed: number }>('/print/clear-queue')
      toast({
        variant: 'success',
        title: `Cola limpiada · ${data.removed} trabajo${data.removed !== 1 ? 's' : ''} eliminado${data.removed !== 1 ? 's' : ''}`,
      })
      refresh()
    } catch (e: any) {
      toast({ variant: 'error', title: 'No se pudo limpiar', message: e?.response?.data?.error ?? 'Error de servidor' })
    } finally {
      setClearing(false)
    }
  }, [refresh, toast])

  useEffect(() => {
    refresh()
    if (pollMs <= 0) return
    const interval = setInterval(refresh, pollMs)
    return () => clearInterval(interval)
  }, [refresh, pollMs])

  const ok = status?.ok ?? false
  const isStuck = !ok && /atorado/i.test(status?.reason ?? '')
  const tooltip = !status
    ? 'Consultando impresora…'
    : ok
      ? `Impresora lista (${status.identifier})`
      : (status.reason ?? 'Impresora no disponible')

  if (variant === 'sidebar') {
    return (
      <div className="space-y-1">
        <button
          onClick={() => { if (!ok) setShowActions(s => !s); refresh() }}
          title={tooltip}
          className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-semibold transition-colors ${
            !status ? 'bg-white/5 text-white/60' :
            ok ? 'bg-emerald-500/15 text-emerald-200 hover:bg-emerald-500/25' :
                'bg-red-500/15 text-red-200 hover:bg-red-500/25'
          }`}
        >
          <span className="relative flex shrink-0">
            <Printer size={14}/>
            <span className={`absolute -top-1 -right-1 w-2 h-2 rounded-full ring-2 ring-[#003B6A] ${
              !status ? 'bg-white/40' : ok ? 'bg-emerald-400' : 'bg-red-400'
            } ${loading ? 'animate-pulse' : ''}`}/>
          </span>
          <span className="flex-1 text-left truncate">
            {!status ? 'Consultando…' : ok ? 'Impresora OK' : (isStuck ? 'Cola atorada' : (status.state ?? 'Offline'))}
          </span>
          {loading
            ? <Loader2 size={11} className="animate-spin shrink-0"/>
            : <RefreshCw size={11} className="opacity-50 shrink-0"/>
          }
        </button>
        {!ok && status && showActions && (
          <div className="px-3 py-2 rounded-xl bg-red-500/10 text-red-100/90 text-[11px] leading-snug space-y-1.5">
            <p>{status.reason}</p>
            {status.type === 'windows' && (
              <button onClick={clearQueue} disabled={clearing}
                className="w-full flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-lg bg-red-500/20 hover:bg-red-500/30 text-white font-bold disabled:opacity-50">
                {clearing ? <Loader2 size={11} className="animate-spin"/> : <Trash2 size={11}/>}
                Limpiar cola
              </button>
            )}
          </div>
        )}
      </div>
    )
  }

  // inline
  return (
    <button
      onClick={refresh}
      title={tooltip}
      className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-xs font-semibold transition-colors ${
        !status ? 'bg-gray-50 text-gray-500' :
        ok ? 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100' :
            'bg-red-50 text-red-700 hover:bg-red-100'
      }`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${
        !status ? 'bg-gray-400' : ok ? 'bg-emerald-500' : 'bg-red-500'
      } ${loading ? 'animate-pulse' : ''}`}/>
      <Printer size={12}/>
      <span className="hidden sm:inline">{!status ? 'Impresora' : ok ? 'OK' : (isStuck ? 'Cola atorada' : (status.state ?? 'Offline'))}</span>
      {loading && <Loader2 size={11} className="animate-spin"/>}
    </button>
  )
}
