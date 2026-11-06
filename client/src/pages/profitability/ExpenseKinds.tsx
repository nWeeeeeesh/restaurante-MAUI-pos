import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { getExpenseCategories, setExpenseKind, type ExpenseCategory } from '../../api/profitability'
import { useToastStore } from '../../store/toast'

// Tipo de cada categoría de gasto (RF06, solo el dueño). Los fijos entran en las
// ventas de equilibrio; los variables, solo en la utilidad operativa.
export default function ExpenseKinds() {
  const pushToast = useToastStore(s => s.push)
  const [rows, setRows] = useState<ExpenseCategory[] | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [version, setVersion] = useState(0)

  useEffect(() => {
    let cancelled = false
    getExpenseCategories()
      .then(r => { if (!cancelled) setRows(r) })
      .catch(() => {
        if (cancelled) return
        setRows(r => r ?? [])
        pushToast({ variant: 'error', title: 'No se pudieron cargar las categorías de gasto' })
      })
    return () => { cancelled = true }
  }, [version, pushToast])

  const change = async (row: ExpenseCategory, kind: 'fijo' | 'variable') => {
    if (row.kind === kind && row.classified) return
    setBusy(row.category)
    try {
      await setExpenseKind(row.category, kind)
      pushToast({ variant: 'success', title: `«${row.category}» ahora es ${kind}` })
      setVersion(v => v + 1)
    } catch {
      pushToast({ variant: 'error', title: 'No se pudo cambiar el tipo de gasto' })
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="bg-white rounded-2xl border border-[#E2E8F0] overflow-hidden">
      <div className="px-5 py-4 border-b border-[#E2E8F0]">
        <h2 className="font-black text-[#0F172A] text-sm">Tipo de gasto</h2>
        <p className="text-[11px] text-[#94A3B8]">Fijo: se paga igual venda o no (alquiler, sueldos). Variable: sube con las ventas (gas, descartables).</p>
      </div>
      {rows === null ? (
        <div className="p-6 flex justify-center"><Loader2 className="animate-spin text-[#0077B6]" /></div>
      ) : rows.length === 0 ? (
        <p className="px-5 py-6 text-sm text-[#94A3B8]">Todavía no hay gastos registrados.</p>
      ) : (
        <div className="divide-y divide-[#F1F5F9]">
          {rows.map(r => (
            <div key={r.category} className="flex items-center gap-3 px-5 py-3">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-[#0F172A] truncate">{r.category}</p>
                <p className="text-[11px] text-[#94A3B8]">{r.expenses} gasto{r.expenses === 1 ? '' : 's'}{r.classified ? '' : ' · sin clasificar (cuenta como fijo)'}</p>
              </div>
              <div className="flex bg-[#EEF3F8] rounded-xl p-1 gap-1 shrink-0">
                {(['fijo', 'variable'] as const).map(k => (
                  <button key={k} disabled={busy === r.category} onClick={() => change(r, k)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold disabled:opacity-50 ${r.kind === k ? 'bg-white text-[#0077B6] shadow-sm' : 'text-[#64748B]'}`}>
                    {k === 'fijo' ? 'Fijo' : 'Variable'}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
