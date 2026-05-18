import { Navigate } from 'react-router-dom'
import { useAuthStore } from '../store/auth'
import type { Role } from '../store/auth'
import Layout from './Layout'

interface Props {
  children: React.ReactNode
  roles?: Role[]
}

export default function ProtectedRoute({ children, roles }: Props) {
  const { user, token } = useAuthStore()

  if (!token || !user) return <Navigate to="/login" replace />
  if (roles && !roles.includes(user.role)) return <Navigate to="/pos" replace />

  return <Layout>{children}</Layout>
}
