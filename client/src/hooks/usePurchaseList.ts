import { useCallback, useEffect, useState } from 'react'
import { getPurchaseList, type PurchaseList } from '../api/forecast'

function errorText(err: unknown): string {
  const data = (err as { response?: { data?: { error?: string; issues?: { message: string }[] } } })?.response?.data
  return data?.issues?.[0]?.message ?? data?.error ?? 'No se pudo calcular la lista de compra. Verifica la conexión.'
}

// Lista de compra de una fecha con la cobertura elegida por insumo
export function usePurchaseList(date: string, coverage: Record<number, number>) {
  const [version, setVersion] = useState(0)
  const coverageKey = JSON.stringify(coverage)
  const key = `${date}|${coverageKey}|${version}`
  const [state, setState] = useState<{ key: string; data: PurchaseList | null; error: string | null }>({ key: '', data: null, error: null })

  useEffect(() => {
    let cancelled = false
    getPurchaseList(date, JSON.parse(coverageKey) as Record<number, number>)
      .then(data => { if (!cancelled) setState({ key, data, error: null }) })
      .catch(err => { if (!cancelled) setState(s => ({ key, data: s.data, error: errorText(err) })) })
    return () => { cancelled = true }
  }, [date, coverageKey, key])

  const reload = useCallback(() => setVersion(v => v + 1), [])
  return { data: state.data, loading: state.key !== key, error: state.key === key ? state.error : null, reload }
}
