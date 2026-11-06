import { useEffect, useState } from 'react'
import { AlertTriangle, ChevronDown, ChevronUp, X } from 'lucide-react'
import { socket } from '../api/socket'
import { confirmSoldOut, getAlerts, type LowPortionAlert } from '../api/forecast'
import { useAuthStore } from '../store/auth'
import { useToastStore } from '../store/toast'
import { ConfirmDialog } from './ConfirmDialog'

// Aviso discreto en el POS: platos a los que les quedan pocas porciones según el stock
// teórico (RF18). Propone marcarlos agotados, pero solo una persona lo confirma (RF19,
// RD02). Se actualiza por socket (inventory:low-portions) y al conectar.
export default function LowPortionsBanner({ dishNames }: { dishNames: Map<number, string> }) {
  const role = useAuthStore(s => s.user?.role)
  const canMark = role === 'owner' || role === 'manager' || role === 'cashier'
  const pushToast = useToastStore(s => s.push)
  const [alerts, setAlerts] = useState<Map<number, LowPortionAlert>>(new Map())
  const [open, setOpen] = useState(false)
  const [hidden, setHidden] = useState<Set<number>>(new Set())
  const [confirming, setConfirming] = useState<LowPortionAlert | null>(null)
  const [sending, setSending] = useState(false)

  useEffect(() => {
    const load = () => {
      getAlerts()
        .then(({ alerts: list }) => setAlerts(new Map(list.map(a => [a.dishId, a]))))
        .catch(() => { /* el aviso es opcional: sin conexión no se muestra */ })
    }
    const onLow = (a: LowPortionAlert) => setAlerts(m => new Map(m).set(a.dishId, { ...m.get(a.dishId), ...a }))
    const onAvailability = ({ dishId, available }: { dishId: number; available: boolean }) => {
      if (!available) setAlerts(m => { const n = new Map(m); n.delete(dishId); return n })
    }
    load()
    socket.on('connect', load)
    socket.on('inventory:low-portions', onLow)
    socket.on('menu:availability', onAvailability)
    return () => {
      socket.off('connect', load)
      socket.off('inventory:low-portions', onLow)
      socket.off('menu:availability', onAvailability)
    }
  }, [])

  const visible = [...alerts.values()].filter(a => !hidden.has(a.dishId)).sort((a, b) => a.portionsLeft - b.portionsLeft)
  if (visible.length === 0) return null
  const nameOf = (a: LowPortionAlert) => a.name ?? dishNames.get(a.dishId) ?? `Plato ${a.dishId}`

  const confirm = async () => {
    if (!confirming) return
    setSending(true)
    try {
      await confirmSoldOut(confirming.dishId)
      pushToast({ variant: 'success', title: `${nameOf(confirming)}: agotado` })
      setConfirming(null)
    } catch {
      pushToast({ variant: 'error', title: 'No se pudo marcar agotado', message: 'Intenta nuevamente.' })
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="bg-amber-50 border-b border-amber-200 px-5 py-2 shrink-0">
      <button onClick={() => setOpen(o => !o)} className="w-full flex items-center gap-2 text-left">
        <AlertTriangle size={14} className="text-amber-600 shrink-0" />
        <span className="text-xs font-semibold text-amber-900 flex-1 truncate">
          Quedan pocas porciones: {visible.slice(0, 3).map(a => `${nameOf(a)} (${a.portionsLeft})`).join(', ')}{visible.length > 3 ? ` y ${visible.length - 3} más` : ''}
        </span>
        {open ? <ChevronUp size={14} className="text-amber-600" /> : <ChevronDown size={14} className="text-amber-600" />}
      </button>
      {open && (
        <div className="mt-2 space-y-1.5 pb-1">
          <p className="text-[11px] text-amber-800">Es un estimado con la receta: revisa en cocina antes de marcar.</p>
          {visible.map(a => (
            <div key={a.dishId} className="flex items-center gap-2">
              <span className="flex-1 text-xs text-amber-950">{nameOf(a)}: {a.portionsLeft} porcion{a.portionsLeft === 1 ? '' : 'es'} ({a.supplyCode.toLowerCase()})</span>
              {canMark && (
                <button onClick={() => setConfirming(a)} className="text-[11px] font-bold px-2.5 py-1 rounded-lg bg-white border border-amber-300 text-amber-800">
                  Marcar agotado
                </button>
              )}
              <button onClick={() => setHidden(h => new Set(h).add(a.dishId))} title="Ocultar" className="p-1 text-amber-600"><X size={12} /></button>
            </div>
          ))}
        </div>
      )}
      <ConfirmDialog
        open={confirming !== null}
        title="¿Marcar como agotado?"
        confirmLabel="Sí, se agotó"
        variant="danger"
        loading={sending}
        onConfirm={confirm}
        onCancel={() => setConfirming(null)}
      >
        <p className="text-sm text-[#64748B]">{confirming && `${nameOf(confirming)} dejará de ofrecerse en todos los celulares. Confírmalo solo si en cocina ya no alcanza.`}</p>
      </ConfirmDialog>
    </div>
  )
}
