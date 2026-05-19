import { useConnectionStore } from '../store/connection'
import { WifiOff, Loader2 } from 'lucide-react'

// Banner sticky superior. Solo aparece cuando el socket está perdido o reintentando.
// Importante: NO bloquea la UI ni captura input — el mozo puede seguir tomando pedidos
// (axios sigue funcionando con HTTP); lo que pierde temporalmente es la sincronización
// en tiempo real entre dispositivos.
export default function ReconnectBanner() {
  const status = useConnectionStore(s => s.status)

  if (status === 'connected' || status === 'idle') return null

  const isConnecting = status === 'connecting'

  return (
    <div
      role="status"
      aria-live="polite"
      className={`fixed top-0 inset-x-0 z-[110] flex items-center justify-center gap-2 px-3 py-1.5 text-xs font-semibold shadow ${
        isConnecting
          ? 'bg-amber-50 text-amber-800 border-b border-amber-200'
          : 'bg-red-50 text-red-800 border-b border-red-200'
      }`}
    >
      {isConnecting
        ? <Loader2 size={14} className="animate-spin" />
        : <WifiOff size={14} />}
      <span>
        {isConnecting
          ? 'Reconectando con el servidor...'
          : 'Sin conexión en tiempo real. Reintentando...'}
      </span>
    </div>
  )
}
