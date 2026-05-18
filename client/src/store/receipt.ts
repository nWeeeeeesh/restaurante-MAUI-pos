import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface ReceiptStore {
  lastNumber: number
  nextReceiptNumber: () => string
  syncWithBackend: (maxFromBackend: number) => void
}

export const useReceiptStore = create<ReceiptStore>()(
  persist(
    (set, get) => ({
      lastNumber: 0,
      nextReceiptNumber: () => {
        const next = get().lastNumber + 1
        set({ lastNumber: next })
        return `B001-${String(next).padStart(5, '0')}`
      },
      syncWithBackend: (maxFromBackend: number) => {
        if (maxFromBackend > get().lastNumber) {
          set({ lastNumber: maxFromBackend })
        }
      }
    }),
    { name: 'mauideskReceipts' }
  )
)
