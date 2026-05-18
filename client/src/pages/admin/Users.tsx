import { useEffect, useState } from 'react'
import api from '../../api/client'
import { useToastStore } from '../../store/toast'
import { useAuthStore } from '../../store/auth'
import {
  UserPlus, Pencil, KeyRound, Eye, EyeOff, Loader2, X, Save,
  Shield, Users as UsersIcon,
} from 'lucide-react'

type Role = 'owner' | 'cashier' | 'waiter'

interface User {
  id: number
  name: string
  username: string
  role: Role
  active: boolean | null
  createdAt: string | null
}

const ROLE_LABELS: Record<Role, string> = { owner: 'Dueño', cashier: 'Cajero', waiter: 'Mozo' }
const ROLE_COLORS: Record<Role, string> = {
  owner:   'bg-amber-100 text-amber-700',
  cashier: 'bg-blue-100 text-blue-700',
  waiter:  'bg-emerald-100 text-emerald-700',
}

export default function Users() {
  const [users, setUsers] = useState<User[]>([])
  const [loading, setLoading] = useState(true)
  const [showAdd, setShowAdd] = useState(false)
  const [editing, setEditing] = useState<User | null>(null)
  const [resetting, setResetting] = useState<User | null>(null)
  const { user: currentUser } = useAuthStore()
  const { push: toast } = useToastStore()

  const refresh = async () => {
    setLoading(true)
    try {
      const { data } = await api.get<User[]>('/users')
      setUsers(data)
    } catch (e: any) {
      toast({ variant: 'error', title: 'No se pudo cargar usuarios', message: e?.response?.data?.error })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { refresh() }, [])

  const toggleActive = async (u: User) => {
    try {
      const { data } = await api.patch<User>(`/users/${u.id}`, { active: u.active === false })
      setUsers(us => us.map(x => x.id === data.id ? data : x))
      toast({ variant: 'success', title: data.active ? 'Usuario reactivado' : 'Usuario inhabilitado' })
    } catch (e: any) {
      toast({ variant: 'error', title: 'No se pudo actualizar', message: e?.response?.data?.error ?? 'Error de servidor' })
    }
  }

  return (
    <div className="h-full overflow-y-auto bg-[#EEF3F8]">
      <div className="bg-white border-b border-[#E2E8F0] px-3 sm:px-6 py-3 sm:py-4 sticky top-0 z-10">
        <div className="flex items-center justify-between gap-3 max-w-3xl mx-auto">
          <div className="min-w-0">
            <h1 className="text-lg sm:text-xl font-black text-[#0F172A] flex items-center gap-2">
              <UsersIcon size={20} className="text-[#0077B6]"/> Usuarios
            </h1>
            <p className="text-[#64748B] text-xs sm:text-sm">Gestión de credenciales</p>
          </div>
          <button onClick={() => setShowAdd(true)}
            className="flex items-center gap-1.5 bg-[#0077B6] hover:bg-[#005a8a] text-white font-bold px-3 sm:px-4 py-2 sm:py-2.5 rounded-xl text-xs sm:text-sm shadow-md">
            <UserPlus size={14}/> <span className="hidden sm:inline">Nuevo usuario</span>
          </button>
        </div>
      </div>

      <div className="p-3 sm:p-6 space-y-2 max-w-3xl mx-auto">
        {loading ? (
          <div className="flex items-center justify-center h-64 text-[#94A3B8]">
            <Loader2 size={20} className="animate-spin mr-2"/> Cargando...
          </div>
        ) : users.length === 0 ? (
          <p className="text-center text-[#94A3B8] py-12 text-sm">No hay usuarios registrados.</p>
        ) : users.map(u => {
          const isMe = currentUser?.id === u.id
          const isInactive = u.active === false
          return (
            <div key={u.id} className={`bg-white rounded-2xl border p-3 sm:p-4 flex items-center gap-3 ${
              isInactive ? 'border-amber-200 bg-amber-50/30' : 'border-[#E2E8F0]'
            }`}>
              <div className={`w-10 h-10 sm:w-12 sm:h-12 rounded-full flex items-center justify-center font-black text-sm sm:text-base shrink-0 ${
                u.role === 'owner' ? 'bg-amber-500 text-white' :
                u.role === 'cashier' ? 'bg-[#0077B6] text-white' :
                'bg-emerald-500 text-white'
              }`}>
                {u.name[0]?.toUpperCase() ?? '?'}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="font-bold text-[#0F172A] truncate">{u.name}</p>
                  {isMe && <span className="text-[10px] font-bold text-[#0077B6] bg-blue-50 px-1.5 py-0.5 rounded-full">tú</span>}
                  {isInactive && <span className="text-[10px] font-bold text-amber-700 bg-amber-100 px-1.5 py-0.5 rounded-full">Inhabilitado</span>}
                </div>
                <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                  <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full flex items-center gap-1 ${ROLE_COLORS[u.role]}`}>
                    <Shield size={9}/>{ROLE_LABELS[u.role]}
                  </span>
                  <span className="text-xs text-[#64748B] truncate">@{u.username}</span>
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button onClick={() => setEditing(u)}
                  title="Editar"
                  className="w-9 h-9 rounded-xl bg-[#EEF3F8] hover:bg-[#0077B6] hover:text-white text-[#64748B] flex items-center justify-center transition-colors">
                  <Pencil size={14}/>
                </button>
                <button onClick={() => setResetting(u)}
                  title="Cambiar contraseña"
                  className="w-9 h-9 rounded-xl bg-[#EEF3F8] hover:bg-[#F4792B] hover:text-white text-[#64748B] flex items-center justify-center transition-colors">
                  <KeyRound size={14}/>
                </button>
                <button onClick={() => toggleActive(u)}
                  title={isInactive ? 'Reactivar' : 'Inhabilitar'}
                  className={`w-9 h-9 rounded-xl flex items-center justify-center transition-colors ${
                    isInactive
                      ? 'bg-emerald-50 text-emerald-600 hover:bg-emerald-500 hover:text-white'
                      : 'bg-amber-50 text-amber-600 hover:bg-amber-500 hover:text-white'
                  }`}>
                  {isInactive ? <Eye size={14}/> : <EyeOff size={14}/>}
                </button>
              </div>
            </div>
          )
        })}
      </div>

      {showAdd && (
        <UserFormModal
          onClose={() => setShowAdd(false)}
          onSaved={u => { setUsers(us => [...us, u]); setShowAdd(false) }}
        />
      )}
      {editing && (
        <UserFormModal
          user={editing}
          onClose={() => setEditing(null)}
          onSaved={u => { setUsers(us => us.map(x => x.id === u.id ? u : x)); setEditing(null) }}
        />
      )}
      {resetting && (
        <PasswordResetModal user={resetting} onClose={() => setResetting(null)}/>
      )}
    </div>
  )
}

// ─── Modal: crear / editar usuario ──────────────────────────────────────────
function UserFormModal({ user, onClose, onSaved }: {
  user?: User
  onClose: () => void
  onSaved: (u: User) => void
}) {
  const [name, setName] = useState(user?.name ?? '')
  const [username, setUsername] = useState(user?.username ?? '')
  const [role, setRole] = useState<Role>(user?.role ?? 'cashier')
  const [password, setPassword] = useState('')
  const [saving, setSaving] = useState(false)
  const { push: toast } = useToastStore()
  const isEdit = !!user

  const handleSave = async () => {
    if (!name.trim() || !username.trim() || (!isEdit && !password)) {
      toast({ variant: 'warning', title: 'Completa todos los campos' })
      return
    }
    setSaving(true)
    try {
      if (isEdit) {
        const { data } = await api.patch<User>(`/users/${user.id}`, {
          name: name.trim(),
          username: username.trim().toLowerCase(),
          role,
        })
        toast({ variant: 'success', title: 'Usuario actualizado' })
        onSaved(data)
      } else {
        const { data } = await api.post<User>('/users', {
          name: name.trim(),
          username: username.trim().toLowerCase(),
          role,
          password,
        })
        toast({ variant: 'success', title: `Usuario "${data.username}" creado` })
        onSaved(data)
      }
    } catch (e: any) {
      toast({ variant: 'error', title: 'No se pudo guardar', message: e?.response?.data?.error ?? 'Error de servidor' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-white rounded-t-3xl sm:rounded-3xl w-full max-w-md shadow-2xl flex flex-col max-h-[95vh]" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-[#E2E8F0] flex items-center justify-between shrink-0">
          <h3 className="font-black text-lg text-[#0F172A]">{isEdit ? 'Editar usuario' : 'Nuevo usuario'}</h3>
          <button onClick={onClose} className="w-8 h-8 rounded-xl bg-[#EEF3F8] flex items-center justify-center"><X size={15}/></button>
        </div>
        <div className="p-5 space-y-3 overflow-y-auto">
          <div>
            <label className="text-xs font-bold text-[#64748B] uppercase tracking-wider mb-1.5 block">Nombre</label>
            <input value={name} onChange={e => setName(e.target.value)}
              placeholder="Ej: Carlos Pérez"
              className="w-full bg-white border-2 border-[#E2E8F0] focus:border-[#0077B6] rounded-xl px-3 py-2.5 text-sm focus:outline-none"/>
          </div>
          <div>
            <label className="text-xs font-bold text-[#64748B] uppercase tracking-wider mb-1.5 block">Usuario (login)</label>
            <input value={username} onChange={e => setUsername(e.target.value.toLowerCase())}
              placeholder="ej: carlos"
              autoCapitalize="none" autoCorrect="off"
              className="w-full bg-white border-2 border-[#E2E8F0] focus:border-[#0077B6] rounded-xl px-3 py-2.5 text-sm focus:outline-none lowercase"/>
          </div>
          {!isEdit && (
            <div>
              <label className="text-xs font-bold text-[#64748B] uppercase tracking-wider mb-1.5 block">Contraseña inicial</label>
              <input value={password} onChange={e => setPassword(e.target.value)}
                placeholder="Mínimo 4 caracteres"
                type="password"
                className="w-full bg-white border-2 border-[#E2E8F0] focus:border-[#0077B6] rounded-xl px-3 py-2.5 text-sm focus:outline-none"/>
              <p className="text-[10px] text-[#94A3B8] mt-1">El usuario podrá cambiarla después desde su sesión.</p>
            </div>
          )}
          <div>
            <label className="text-xs font-bold text-[#64748B] uppercase tracking-wider mb-1.5 block">Rol</label>
            <div className="grid grid-cols-3 gap-2">
              {(['owner', 'cashier', 'waiter'] as Role[]).map(r => (
                <button key={r} onClick={() => setRole(r)} type="button"
                  className={`py-2.5 rounded-xl text-xs font-bold transition-colors border-2 ${
                    role === r
                      ? r === 'owner' ? 'bg-amber-500 border-amber-500 text-white'
                      : r === 'cashier' ? 'bg-[#0077B6] border-[#0077B6] text-white'
                      : 'bg-emerald-500 border-emerald-500 text-white'
                      : 'bg-white border-[#E2E8F0] text-[#64748B] hover:border-[#0077B6]'
                  }`}>
                  {ROLE_LABELS[r]}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="p-5 pt-3 flex gap-2 shrink-0 border-t border-[#E2E8F0]">
          <button onClick={onClose} disabled={saving}
            className="flex-1 font-semibold py-3 rounded-xl text-[#64748B] bg-[#EEF3F8] hover:bg-[#E2E8F0] disabled:opacity-50">
            Cancelar
          </button>
          <button onClick={handleSave} disabled={saving}
            className="flex-1 font-bold py-3 rounded-xl text-white bg-[#0077B6] hover:bg-[#005a8a] shadow-md disabled:opacity-60 flex items-center justify-center gap-2">
            {saving ? <Loader2 size={15} className="animate-spin"/> : <Save size={15}/>}
            Guardar
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Modal: cambiar contraseña a otro usuario (owner) ──────────────────────
function PasswordResetModal({ user, onClose }: { user: User; onClose: () => void }) {
  const [password, setPassword] = useState('')
  const [confirm, setConfirm]   = useState('')
  const [saving, setSaving]     = useState(false)
  const { push: toast }         = useToastStore()

  const handleSave = async () => {
    if (!password || password.length < 4) {
      toast({ variant: 'warning', title: 'Mínimo 4 caracteres' }); return
    }
    if (password !== confirm) {
      toast({ variant: 'warning', title: 'Las contraseñas no coinciden' }); return
    }
    setSaving(true)
    try {
      await api.post(`/users/${user.id}/password`, { password })
      toast({ variant: 'success', title: 'Contraseña actualizada' })
      onClose()
    } catch (e: any) {
      toast({ variant: 'error', title: 'No se pudo actualizar', message: e?.response?.data?.error })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-white rounded-t-3xl sm:rounded-3xl w-full max-w-sm shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-[#E2E8F0] flex items-center justify-between">
          <h3 className="font-black text-lg text-[#0F172A] flex items-center gap-2">
            <KeyRound size={18} className="text-[#F4792B]"/> Cambiar contraseña
          </h3>
          <button onClick={onClose} className="w-8 h-8 rounded-xl bg-[#EEF3F8] flex items-center justify-center"><X size={15}/></button>
        </div>
        <div className="p-5 space-y-3">
          <p className="text-sm text-[#64748B]">
            Nueva contraseña para <strong className="text-[#0F172A]">{user.name}</strong> (@{user.username}).
          </p>
          <input value={password} onChange={e => setPassword(e.target.value)}
            placeholder="Nueva contraseña" type="password" autoFocus
            className="w-full bg-white border-2 border-[#E2E8F0] focus:border-[#0077B6] rounded-xl px-3 py-2.5 text-sm focus:outline-none"/>
          <input value={confirm} onChange={e => setConfirm(e.target.value)}
            placeholder="Confirmar contraseña" type="password"
            onKeyDown={e => { if (e.key === 'Enter') handleSave() }}
            className="w-full bg-white border-2 border-[#E2E8F0] focus:border-[#0077B6] rounded-xl px-3 py-2.5 text-sm focus:outline-none"/>
        </div>
        <div className="p-5 pt-2 flex gap-2 border-t border-[#E2E8F0]">
          <button onClick={onClose} disabled={saving}
            className="flex-1 font-semibold py-3 rounded-xl text-[#64748B] bg-[#EEF3F8] hover:bg-[#E2E8F0] disabled:opacity-50">
            Cancelar
          </button>
          <button onClick={handleSave} disabled={saving}
            className="flex-1 font-bold py-3 rounded-xl text-white bg-[#F4792B] hover:bg-[#d4621b] shadow-md disabled:opacity-60 flex items-center justify-center gap-2">
            {saving ? <Loader2 size={15} className="animate-spin"/> : <KeyRound size={15}/>}
            Guardar
          </button>
        </div>
      </div>
    </div>
  )
}
