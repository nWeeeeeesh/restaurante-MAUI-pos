import type { Supply } from './model'

// Selección de insumo con botones grandes: los críticos primero.
export function SupplyPicker({ supplies, value, onChange }: {
  supplies: Supply[]; value: number | null; onChange: (id: number) => void
}) {
  if (supplies.length === 0) {
    return <p className="text-sm text-[#64748B]">No hay insumos activos. El dueño los agrega en la pestaña Insumos.</p>
  }
  return (
    <div className="grid grid-cols-3 gap-2">
      {supplies.map(s => (
        <button key={s.id} type="button" onClick={() => onChange(s.id)}
          className={`py-3 px-2 rounded-xl text-sm font-semibold border-2 transition-all leading-tight ${
            value === s.id ? 'bg-[#0077B6] text-white border-[#0077B6] shadow-md' : 'bg-white text-[#0F172A] border-[#E2E8F0] hover:border-[#0077B6]'
          }`}>
          {s.name}
        </button>
      ))}
    </div>
  )
}

export function RangeToggle({ value, onChange }: { value: 'today' | 'week'; onChange: (v: 'today' | 'week') => void }) {
  return (
    <div className="flex bg-[#EEF3F8] rounded-xl p-1 text-xs font-semibold">
      {(['today', 'week'] as const).map(v => (
        <button key={v} onClick={() => onChange(v)}
          className={`px-3 py-1.5 rounded-lg transition-all ${value === v ? 'bg-white text-[#0077B6] shadow-sm' : 'text-[#64748B]'}`}>
          {v === 'today' ? 'Hoy' : '7 días'}
        </button>
      ))}
    </div>
  )
}

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-xs font-semibold text-[#64748B] block mb-1">{label}</span>
      {children}
    </label>
  )
}
