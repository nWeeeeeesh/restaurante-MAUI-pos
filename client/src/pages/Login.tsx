import { useState, type FormEvent } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { useAuthStore } from '../store/auth'
import { Waves, Lock, User } from 'lucide-react'

export default function Login() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const { login, user, token, initialized } = useAuthStore()
  const navigate = useNavigate()

  // Si ya hay sesión válida, no mostrar el formulario de login
  if (initialized && token && user) return <Navigate to="/tables" replace />
  // Mientras init() valida el token guardado, evitar parpadeo del formulario
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

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      await login(username, password)
      navigate('/tables')
    } catch {
      setError('Usuario o contraseña incorrectos')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex">
      {/* Left — brand panel */}
      <div
        className="hidden lg:flex lg:w-1/2 flex-col items-center justify-center p-12 relative overflow-hidden"
        style={{ background: 'linear-gradient(145deg, #002D4E 0%, #004E86 60%, #0077B6 100%)' }}
      >
        {/* Decorative circles */}
        <div className="absolute -top-24 -left-24 w-96 h-96 rounded-full bg-white/5" />
        <div className="absolute -bottom-32 -right-20 w-[500px] h-[500px] rounded-full bg-white/5" />
        <div className="absolute top-1/3 -right-10 w-48 h-48 rounded-full bg-[#F4792B]/10" />

        <div className="relative z-10 text-center">
          <div className="w-24 h-24 rounded-3xl bg-[#F4792B] flex items-center justify-center mx-auto mb-6 shadow-2xl">
            <Waves size={44} className="text-white" />
          </div>
          <h1 className="text-5xl font-black text-white mb-2 tracking-tight">MAUI</h1>
          <p className="text-white/60 text-lg mb-1">Cevichería</p>
          <p className="text-white/40 text-sm">Tacna, Perú</p>

          <div className="mt-16 grid grid-cols-3 gap-4 text-center">
            {[['Mesas', '15'], ['Platos', '12'], ['Años', '3+']].map(([label, val]) => (
              <div key={label} className="bg-white/10 rounded-2xl p-4">
                <p className="text-white font-black text-2xl">{val}</p>
                <p className="text-white/50 text-xs mt-0.5">{label}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Right — login form */}
      <div className="flex-1 flex items-center justify-center bg-[#EEF3F8] p-6">
        <div className="w-full max-w-sm">
          {/* Mobile brand */}
          <div className="lg:hidden flex items-center gap-3 mb-8">
            <div className="w-12 h-12 rounded-2xl bg-[#0077B6] flex items-center justify-center">
              <Waves size={22} className="text-white" />
            </div>
            <div>
              <p className="font-black text-[#0F172A] text-xl">MauiDesk</p>
              <p className="text-[#64748B] text-xs">Cevichería MAUI</p>
            </div>
          </div>

          <h2 className="text-2xl font-black text-[#0F172A] mb-1">Bienvenido</h2>
          <p className="text-[#64748B] text-sm mb-8">Ingresa tus credenciales para continuar</p>

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Username */}
            <div>
              <label className="block text-sm font-semibold text-[#0F172A] mb-2">Usuario</label>
              <div className="relative">
                <User size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-[#94A3B8]" />
                <input
                  type="text"
                  value={username}
                  onChange={e => setUsername(e.target.value)}
                  className="w-full bg-white border border-[#E2E8F0] rounded-xl pl-11 pr-4 py-3.5 text-sm text-[#0F172A] placeholder-[#94A3B8] focus:outline-none focus:ring-2 focus:ring-[#0077B6]/30 focus:border-[#0077B6] transition-all"
                  placeholder="Tu usuario"
                  required
                  autoFocus
                />
              </div>
            </div>

            {/* Password */}
            <div>
              <label className="block text-sm font-semibold text-[#0F172A] mb-2">Contraseña</label>
              <div className="relative">
                <Lock size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-[#94A3B8]" />
                <input
                  type="password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  className="w-full bg-white border border-[#E2E8F0] rounded-xl pl-11 pr-4 py-3.5 text-sm text-[#0F172A] placeholder-[#94A3B8] focus:outline-none focus:ring-2 focus:ring-[#0077B6]/30 focus:border-[#0077B6] transition-all"
                  placeholder="••••••••"
                  required
                />
              </div>
            </div>

            {error && (
              <div className="bg-red-50 border border-red-100 text-red-600 text-sm px-4 py-3 rounded-xl">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full font-bold py-4 rounded-xl text-white text-sm transition-all disabled:opacity-50 shadow-lg shadow-[#0077B6]/20 hover:shadow-[#0077B6]/30 hover:-translate-y-0.5 active:translate-y-0"
              style={{ background: 'linear-gradient(135deg, #0077B6, #004E86)' }}
            >
              {loading ? 'Ingresando...' : 'Ingresar al sistema'}
            </button>
          </form>

          <p className="text-center text-xs text-[#94A3B8] mt-8">MauiDesk v1.0 · Cevichería MAUI</p>
        </div>
      </div>
    </div>
  )
}
