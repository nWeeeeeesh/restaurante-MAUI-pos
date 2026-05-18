import { useState } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { useAuthStore } from '../store/auth'
import {
  LayoutGrid, UtensilsCrossed, Receipt,
  BarChart3, BookOpen, LogOut, Waves, History, Users, KeyRound, User as UserIcon, X,
} from 'lucide-react'
import type { Role } from '../store/auth'
import { PrinterStatusPill } from './PrinterStatus'
import { ChangePasswordModal } from './ChangePasswordModal'

const navItems = [
  { to: '/tables',      label: 'Mesas',    icon: LayoutGrid,      roles: ['owner','cashier','waiter'] as Role[] },
  { to: '/pos',         label: 'Pedidos',  icon: UtensilsCrossed, roles: ['owner','cashier','waiter'] as Role[] },
  { to: '/cash',        label: 'Caja',     icon: Receipt,         roles: ['owner','cashier'] as Role[] },
  { to: '/bills',       label: 'Historial',icon: History,         roles: ['owner','cashier','waiter'] as Role[] },
  { to: '/reports',     label: 'Reportes', icon: BarChart3,       roles: ['owner'] as Role[] },
  { to: '/admin/menu',  label: 'Menú',     icon: BookOpen,        roles: ['owner'] as Role[] },
  { to: '/admin/users', label: 'Usuarios', icon: Users,           roles: ['owner'] as Role[] },
]

const ROLE_LABELS: Record<Role, string> = {
  owner: 'Dueño',
  cashier: 'Cajero',
  waiter: 'Mozo',
}

export default function Layout({ children }: { children: React.ReactNode }) {
  const { user, logout } = useAuthStore()
  const navigate = useNavigate()
  const [showPwd, setShowPwd] = useState(false)
  const [showProfile, setShowProfile] = useState(false)

  const visible = navItems.filter(item => user && item.roles.includes(user.role))

  const handleLogout = () => { logout(); navigate('/login') }

  return (
    <div className="flex h-screen overflow-hidden">

      {/* ── Sidebar (desktop) ── */}
      <aside
        className="hidden md:flex w-60 flex-col shrink-0"
        style={{ background: 'linear-gradient(180deg, #002D4E 0%, #004E86 100%)' }}
      >
        {/* Brand */}
        <div className="px-5 pt-6 pb-5 border-b border-white/10">
          <div className="flex items-center gap-3 mb-1">
            <div className="w-9 h-9 rounded-xl bg-[#F4792B] flex items-center justify-center shrink-0">
              <Waves size={18} className="text-white" />
            </div>
            <div>
              <p className="text-white font-bold text-base leading-tight">MauiDesk</p>
              <p className="text-white/50 text-xs leading-tight">Cevichería MAUI</p>
            </div>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
          {visible.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                `flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all ${
                  isActive
                    ? 'bg-white text-[#004E86] shadow-sm'
                    : 'text-white/75 hover:bg-white/10 hover:text-white'
                }`
              }
            >
              {({ isActive }) => (
                <>
                  <Icon size={18} className={isActive ? 'text-[#F4792B]' : ''} />
                  {label}
                </>
              )}
            </NavLink>
          ))}
        </nav>

        {/* User */}
        <div className="px-3 pb-4 border-t border-white/10 pt-4 space-y-2">
          <PrinterStatusPill variant="sidebar"/>
          <div className="flex items-center gap-3 px-2 pt-1">
            <div className="w-9 h-9 rounded-full bg-white/10 flex items-center justify-center shrink-0">
              <span className="text-white font-bold text-sm">{user?.name[0]}</span>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-white text-sm font-medium truncate">{user?.name}</p>
              <p className="text-white/50 text-xs">{user?.role ? ROLE_LABELS[user.role] : ''}</p>
            </div>
          </div>
          <button
            onClick={() => setShowPwd(true)}
            className="flex items-center gap-2 w-full px-4 py-2.5 rounded-xl text-white/60 hover:bg-white/10 hover:text-white text-sm transition-all"
          >
            <KeyRound size={15} />
            Cambiar contraseña
          </button>
          <button
            onClick={handleLogout}
            className="flex items-center gap-2 w-full px-4 py-2.5 rounded-xl text-white/60 hover:bg-white/10 hover:text-white text-sm transition-all"
          >
            <LogOut size={15} />
            Cerrar sesión
          </button>
        </div>
      </aside>

      {/* ── Main ── */}
      <main className="flex-1 overflow-hidden flex flex-col bg-[#EEF3F8] pb-16 md:pb-0">
        {children}
      </main>

      {/* ── Bottom nav (móvil) ── z-30 para que cualquier modal full-screen lo cubra ── */}
      <nav
        className="md:hidden fixed bottom-0 inset-x-0 z-30 flex border-t border-[#E2E8F0] bg-white overflow-x-auto"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        {visible.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              `flex-1 min-w-[56px] flex flex-col items-center justify-center gap-0.5 py-2 transition-colors ${
                isActive ? 'text-[#0077B6]' : 'text-[#94A3B8]'
              }`
            }
          >
            {({ isActive }) => (
              <>
                <Icon size={18} strokeWidth={isActive ? 2.5 : 1.8} />
                <span className="text-[10px] font-semibold">{label}</span>
              </>
            )}
          </NavLink>
        ))}
        {/* Botón "Cuenta" al final — abre drawer con perfil/logout */}
        <button
          onClick={() => setShowProfile(true)}
          className="flex-1 min-w-[56px] flex flex-col items-center justify-center gap-0.5 py-2 text-[#94A3B8] hover:text-[#0077B6] transition-colors"
        >
          <UserIcon size={18}/>
          <span className="text-[10px] font-semibold">Cuenta</span>
        </button>
      </nav>

      {/* Drawer perfil (móvil) */}
      {showProfile && (
        <div className="md:hidden fixed inset-0 z-[55] bg-black/50 backdrop-blur-sm flex items-end" onClick={() => setShowProfile(false)}>
          <div className="bg-white w-full rounded-t-3xl shadow-2xl pb-[env(safe-area-inset-bottom)]" onClick={e => e.stopPropagation()}>
            <div className="px-5 pt-5 pb-4 flex items-center justify-between border-b border-[#E2E8F0]">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-[#0077B6] text-white font-black flex items-center justify-center">
                  {user?.name[0]}
                </div>
                <div>
                  <p className="font-bold text-[#0F172A]">{user?.name}</p>
                  <p className="text-xs text-[#64748B]">{user?.role ? ROLE_LABELS[user.role] : ''}</p>
                </div>
              </div>
              <button onClick={() => setShowProfile(false)} className="w-9 h-9 rounded-xl bg-[#EEF3F8] flex items-center justify-center"><X size={16}/></button>
            </div>
            <div className="p-3 space-y-2">
              <PrinterStatusPill variant="inline"/>
              <button onClick={() => { setShowProfile(false); setShowPwd(true) }}
                className="w-full flex items-center gap-3 px-4 py-3 rounded-xl bg-[#EEF3F8] hover:bg-[#E2E8F0] text-[#0F172A] text-sm font-semibold transition-colors">
                <KeyRound size={16} className="text-[#0077B6]"/> Cambiar contraseña
              </button>
              <button onClick={() => { setShowProfile(false); handleLogout() }}
                className="w-full flex items-center gap-3 px-4 py-3 rounded-xl bg-red-50 hover:bg-red-100 text-red-600 text-sm font-semibold transition-colors">
                <LogOut size={16}/> Cerrar sesión
              </button>
            </div>
          </div>
        </div>
      )}

      <ChangePasswordModal open={showPwd} onClose={() => setShowPwd(false)}/>
    </div>
  )
}
