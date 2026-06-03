// Redondea a 2 decimales para evitar acumulación de error flotante en totales.
// Los precios del menú son múltiplos de 0.50 (representables exactamente en IEEE 754),
// así que en la práctica el error es cero; este guard existe para cuando se agreguen
// ajustes de modificadores con precios arbitrarios.
export function roundMoney(n: number): number {
  return Math.round(n * 100) / 100
}

// Suma una lista de (precio × cantidad) y devuelve el total redondeado.
export function sumItems(items: Array<{ unitPrice: number; quantity: number | null }>): number {
  return roundMoney(items.reduce((s, i) => s + i.unitPrice * (i.quantity ?? 1), 0))
}
