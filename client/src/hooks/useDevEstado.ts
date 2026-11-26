import { useCallback, useEffect, useState } from 'react'
import { getEstado, type EstadoDev } from '../api/dev'

function errorText(err: unknown): string {
  const data = (err as { response?: { data?: { error?: string } } })?.response?.data
  return data?.error ?? 'No se pudo leer el estado. Verifica la conexión.'
}

// Estado de la pantalla «Desarrollador»: cada 3 s mientras corre algo, si no cada 15 s
export function useDevEstado() {
  const [version, setVersion] = useState(0)
  const [state, setState] = useState<{ version: number; data: EstadoDev | null; error: string | null }>({ version: -1, data: null, error: null })
  const ocupado = !!state.data && (!!state.data.enCurso || state.data.recuperacion.estado === 'corriendo' || !!state.data.jornada.enCurso)

  useEffect(() => {
    let cancelled = false
    getEstado()
      .then(data => { if (!cancelled) setState({ version, data, error: null }) })
      .catch(err => { if (!cancelled) setState(s => ({ version, data: s.data, error: errorText(err) })) })
    return () => { cancelled = true }
  }, [version])

  useEffect(() => {
    const t = setTimeout(() => setVersion(v => v + 1), ocupado ? 3000 : 15000)
    return () => clearTimeout(t)
  }, [ocupado, state.version])

  const reload = useCallback(() => setVersion(v => v + 1), [])
  return { data: state.data, loading: state.version !== version, error: state.error, reload }
}
