import { z } from 'zod'

// Receta de un plato (RF08): gramos de producto limpio de cada insumo crítico por
// porción. `variant` '' es la receta del plato; un texto, la opción de modificador que
// la reemplaza. El cuerpo reemplaza la receta completa del plato.
export const RecipeItemSchema = z.object({
  variant: z.string().trim().max(60).default(''),
  supplyId: z.number().int().positive(),
  gramsClean: z.number().positive('Los gramos deben ser mayores a 0').max(5000),
})

export const RecipeSchema = z.array(RecipeItemSchema).max(100)
  .refine(items => new Set(items.map(i => `${i.variant}|${i.supplyId}`)).size === items.length, {
    message: 'Un insumo aparece dos veces en la misma variante',
  })

export type RecipeItemInput = z.infer<typeof RecipeItemSchema>
export type RecipeInput = z.infer<typeof RecipeSchema>
