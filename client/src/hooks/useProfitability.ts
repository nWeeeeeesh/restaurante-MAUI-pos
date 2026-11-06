import { useCallback, useEffect, useState } from 'react'
import { getProfitability, type GroupBy, type Profitability } from '../api/profitability'

function errorText(err: unknown): string {
  const data = (err as { response?: { data?: { error?: string; issues?: { message: string }[] } } })?.response?.data
  return data?.issues?.[0]?.message ?? data?.error ?? 'No se pudo calcular la rentabilidad. Verifica la conexión.'
}

// Estado de carga, error y datos de la rentabilidad de un periodo. «Cargando» se deriva
// de la consulta pendiente, sin setState síncrono dentro del efecto.
export function useProfitability(from: string, to: string, groupBy: GroupBy) {
  const [version, setVersion] = useState(0)
  const key = `${from}|${to}|${groupBy}|${version}`
  const [state, setState] = useState<{ key: string; data: Profitability | null; error: string | null }>({ key: '', data: null, error: null })

  useEffect(() => {
    let cancelled = false
    getProfitability({ from, to, groupBy })
      .then(data => { if (!cancelled) setState({ key, data, error: null }) })
      .catch(err => { if (!cancelled) setState(s => ({ key, data: s.data, error: errorText(err) })) })
    return () => { cancelled = true }
  }, [from, to, groupBy, key])

  const reload = useCallback(() => setVersion(v => v + 1), [])
  return { data: state.data, loading: state.key !== key, error: state.key === key ? state.error : null, reload }
}
