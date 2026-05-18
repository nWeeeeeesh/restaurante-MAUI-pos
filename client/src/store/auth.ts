import { create } from 'zustand'
import api from '../api/client'
import { useOrdersStore } from './orders'
import { useOrderStore } from './order'

export type Role = 'owner' | 'cashier' | 'waiter'

interface User {
  id: number
  name: string
  username: string
  role: Role
}

interface AuthStore {
  user: User | null
  token: string | null
  login: (username: string, password: string) => Promise<void>
  logout: () => void
  init: () => Promise<void>
}

export const useAuthStore = create<AuthStore>((set) => ({
  user: null,
  token: localStorage.getItem('mauideskToken'),

  login: async (username, password) => {
    const { data } = await api.post('/auth/login', { username, password })
    localStorage.setItem('mauideskToken', data.token)
    set({ user: data.user, token: data.token })
  },

  logout: () => {
    localStorage.removeItem('mauideskToken')
    set({ user: null, token: null })
    useOrdersStore.getState().reset()
    useOrderStore.getState().clearOrder()
  },

  init: async () => {
    const token = localStorage.getItem('mauideskToken')
    if (!token) return
    try {
      const { data } = await api.get('/auth/me')
      set({ user: data.user, token })
    } catch {
      localStorage.removeItem('mauideskToken')
      set({ user: null, token: null })
    }
  },
}))
