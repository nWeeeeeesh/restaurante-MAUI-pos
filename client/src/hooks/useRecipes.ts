import { useCallback, useEffect, useState } from 'react'
import { getRecipes, type RecipesResponse } from '../api/recipes'

// Carta con recetas, insumos críticos y factores vigentes
export function useRecipes() {
  const [version, setVersion] = useState(0)
  const [state, setState] = useState<{ version: number; data: RecipesResponse | null; error: string | null }>({ version: -1, data: null, error: null })

  useEffect(() => {
    let cancelled = false
    getRecipes()
      .then(data => { if (!cancelled) setState({ version, data, error: null }) })
      .catch(() => { if (!cancelled) setState(s => ({ version, data: s.data, error: 'No se pudieron cargar las recetas. Verifica la conexión.' })) })
    return () => { cancelled = true }
  }, [version])

  const reload = useCallback(() => setVersion(v => v + 1), [])
  return { data: state.data, loading: state.version !== version, error: state.version === version ? state.error : null, reload }
}
