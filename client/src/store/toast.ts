import { create } from 'zustand'

export type ToastVariant = 'success' | 'error' | 'info' | 'warning' | 'loading'

export interface Toast {
  id: number
  variant: ToastVariant
  title: string
  message?: string
  durationMs?: number  // 0 = no auto-dismiss
}

interface ToastStore {
  toasts: Toast[]
  push: (t: Omit<Toast, 'id'>) => number
  update: (id: number, patch: Partial<Omit<Toast, 'id'>>) => void
  dismiss: (id: number) => void
  clear: () => void
}

let nextId = 1

export const useToastStore = create<ToastStore>((set, get) => ({
  toasts: [],

  push: (t) => {
    const id = nextId++
    const toast: Toast = { id, durationMs: 3500, ...t }
    set(s => ({ toasts: [...s.toasts, toast] }))
    if (toast.durationMs && toast.durationMs > 0) {
      setTimeout(() => get().dismiss(id), toast.durationMs)
    }
    return id
  },

  update: (id, patch) => {
    set(s => ({ toasts: s.toasts.map(t => t.id === id ? { ...t, ...patch } : t) }))
    const updated = get().toasts.find(t => t.id === id)
    if (updated?.durationMs && updated.durationMs > 0) {
      setTimeout(() => get().dismiss(id), updated.durationMs)
    }
  },

  dismiss: (id) => set(s => ({ toasts: s.toasts.filter(t => t.id !== id) })),
  clear: () => set({ toasts: [] }),
}))

// Helper: extrae mensaje legible de un error de axios para impresora
export function printerErrorMessage(err: any): string {
  const raw = err?.response?.data?.error ?? err?.message ?? ''
  const lower = String(raw).toLowerCase()
  if (lower.includes('econnrefused') || lower.includes('tiempo de conexion') || lower.includes('timeout') || lower.includes('ehostunreach')) {
    return 'Impresora no responde. Verifica que esté conectada y encendida.'
  }
  if (lower.includes('printer_host') || lower.includes('printer_name')) {
    return 'Impresora no configurada en el servidor (.env)'
  }
  if (lower.includes('no se pudo')) return raw
  return raw || 'Error al comunicar con la impresora'
}
