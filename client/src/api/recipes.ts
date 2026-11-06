// Recetas y calibración (RF08, RF09): llamadas HTTP tipadas, sin lógica
import api from './client'

export interface RecipeSupply {
  id: number
  code: string | null
  name: string
  unit: string
  yield: number
  shelfLifeDays: number | null
  serviceLevel: number | null
  factor: { value: number; from: string; to: string; computedAt: string | null; outOfRange: boolean } | null
}

export interface RecipeItem {
  variant: string
  supplyId: number
  gramsClean: number
  kgPerPortion?: number | null
}

export interface RecipeDish {
  dishId: number
  name: string
  price: number
  category: string | null
  items: RecipeItem[]
}

export interface RecipesResponse {
  supplies: RecipeSupply[]
  factorRange: { min: number; max: number }
  dishes: RecipeDish[]
}

export interface CalibrationResult {
  from: string
  to: string
  factors: { supplyId: number; code: string; name: string; factor: number | null; days: number; outOfRange: boolean }[]
  range: { min: number; max: number }
}

export async function getRecipes(): Promise<RecipesResponse> {
  const { data } = await api.get<RecipesResponse>('/recipes')
  return data
}

export async function saveRecipe(dishId: number, items: { variant: string; supplyId: number; gramsClean: number }[]) {
  const { data } = await api.put<RecipeItem[]>(`/recipes/${dishId}`, items)
  return data
}

export async function calibrate(from: string, to: string): Promise<CalibrationResult> {
  const { data } = await api.post<CalibrationResult>('/recipes/calibrate', { from, to }, { timeout: 30000 })
  return data
}
