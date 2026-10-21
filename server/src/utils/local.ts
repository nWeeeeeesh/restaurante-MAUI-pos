// Cada local tiene su propia instancia y su propia base (invariante 7 del plan v3):
// el número de local sale del entorno y se escribe en `local_id` de todo lo nuevo.
// Se lee en cada uso (no al importar) para que los tests puedan simular el local 2.
export function currentLocalId(): number {
  const raw = process.env.MAUI_LOCAL_ID
  if (raw === undefined || raw.trim() === '') return 1
  const n = Number(raw)
  if (!Number.isInteger(n) || n < 1) throw new Error(`MAUI_LOCAL_ID inválido: "${raw}" (debe ser un entero ≥ 1)`)
  return n
}

// Solo hay dos locales: el principal envía y el segundo recibe
export function otherLocalId(localId = currentLocalId()): number {
  return localId === 1 ? 2 : 1
}
