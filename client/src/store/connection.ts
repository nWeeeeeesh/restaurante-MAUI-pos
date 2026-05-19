import { create } from 'zustand'

// Estado del socket para mostrar un banner global de "Reconectando..." cuando
// la conexión se cae. No es un toast: el banner es persistente (sticky) y desaparece
// solo cuando recuperamos conexión.
export type SocketStatus = 'idle' | 'connecting' | 'connected' | 'disconnected'

interface ConnectionStore {
  status: SocketStatus
  lastError: string | null
  set: (status: SocketStatus, lastError?: string | null) => void
}

export const useConnectionStore = create<ConnectionStore>((set) => ({
  status: 'idle',
  lastError: null,
  set: (status, lastError = null) => set({ status, lastError }),
}))
