import { Navigate } from 'react-router-dom'
import { useAuthStore } from '../store/auth'
import type { Role } from '../store/auth'
import Layout from './Layout'

interface Props {
  children: React.ReactNode
  roles?: Role[]
}

export default function ProtectedRoute({ children, roles }: Props) {
  const { user, token, initialized } = useAuthStore()

  // Mientras init() está corriendo (refresh con token guardado), no redirigir
  // a /login: el usuario debe quedarse en la página actual una vez validado.
  if (!initialized) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-[#EEF3F8]">
        <div className="flex flex-col items-center gap-3">
          <div className="w-10 h-10 rounded-full border-4 border-[#E2E8F0] border-t-[#0077B6] animate-spin" />
          <p className="text-sm text-[#64748B] font-semibold">Cargando…</p>
        </div>
      </div>
    )
  }

  if (!token || !user) return <Navigate to="/login" replace />
  if (roles && !roles.includes(user.role)) return <Navigate to="/pos" replace />

  return <Layout>{children}</Layout>
}
