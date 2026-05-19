import { useEffect } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useAuthStore } from './store/auth'
import { useOrdersStore } from './store/orders'
import Login from './pages/Login'
import ProtectedRoute from './components/ProtectedRoute'
import MenuAdmin from './pages/admin/MenuAdmin'
import Tables from './pages/Tables'
import POS from './pages/POS'
import Cash from './pages/Cash'
import BillsHistory from './pages/BillsHistory'
import Reports from './pages/Reports'
import Users from './pages/admin/Users'
import ToastHost from './components/ToastHost'
import ReconnectBanner from './components/ReconnectBanner'

export default function App() {
  const { init } = useAuthStore()
  const token = useAuthStore(s => s.token)
  const { init: initOrders, initialized } = useOrdersStore()

  useEffect(() => { init() }, [])

  useEffect(() => {
    if (token && !initialized) initOrders()
  }, [token, initialized])

  return (
    <BrowserRouter>
      <ReconnectBanner />
      <ToastHost />
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/" element={<Navigate to="/pos" replace />} />

        <Route path="/pos" element={
          <ProtectedRoute><POS /></ProtectedRoute>
        } />
        <Route path="/tables" element={
          <ProtectedRoute><Tables /></ProtectedRoute>
        } />
        {/* Cocina deshabilitada: el restaurante no usa pantalla en cocina, solo comanda impresa */}
        <Route path="/kitchen" element={<Navigate to="/tables" replace />} />
        <Route path="/cash" element={
          <ProtectedRoute roles={['owner', 'cashier']}><Cash /></ProtectedRoute>
        } />
        <Route path="/bills" element={
          <ProtectedRoute><BillsHistory /></ProtectedRoute>
        } />
        <Route path="/reports" element={
          <ProtectedRoute roles={['owner']}><Reports /></ProtectedRoute>
        } />
        <Route path="/admin/menu" element={
          <ProtectedRoute roles={['owner']}><MenuAdmin /></ProtectedRoute>
        } />
        <Route path="/admin/users" element={
          <ProtectedRoute roles={['owner']}><Users /></ProtectedRoute>
        } />

        <Route path="*" element={<Navigate to="/pos" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
