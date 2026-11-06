import { describe, it, expect } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import {
  consumoReal, costoPromedio, costoLoVendido, prorratearGastos, resultado, merma, factorCalibracion,
  fueraDeRango, costoPlato, margen, ingenieriaMenu, kgPorPorcion, type GastoMes,
} from '../domain/costing'

// Casos de la Tabla 26 de la tesis (plan-sistema §5), tolerancia de 0.01. Los mismos
// casos corren en Python sobre la referencia (scripts/tesis/pruebas_pu.py).
const TOL = 2 // toBeCloseTo(x, 2): |diferencia| < 0.005

const C = consumoReal(6.0, 10.0, 0.5, 4.0)
const p = costoPromedio(6.0, 22.00, 10.0, 24.00)!
const CV = costoLoVendido([{ C, M: 0.5, p }], 120.00)
const f = factorCalibracion([11.5], [42 * 0.25])!

describe('dominio de costeo (incremento 2)', () => {
  it('[PU-01][RF12] consumo real (F7)', () => {
    expect(C).toBeCloseTo(11.5, TOL)
  })

  it('[PU-02][RF10] costo promedio con compra (F8)', () => {
    expect(p).toBeCloseTo(23.25, TOL)
  })

  it('[PU-03][RF10] costo promedio sin compra: no cambia', () => {
    expect(costoPromedio(6.0, 22.00, 0, null)).toBe(22.00)
    // Sin historia, la primera compra fija el precio
    expect(costoPromedio(0, null, 5, 24)).toBe(24)
  })

  it('[PU-04][RF12] costo de lo vendido (F9)', () => {
    expect(CV).toBeCloseTo(399.00, TOL)
  })

  it('[PU-05][RF12] prorrateo de gastos y utilidad operativa (F10)', () => {
    const gastos = new Map<string, GastoMes[]>([['2026-06', [
      { categoria: 'sueldos', monto: 9000, tipo: 'fijo' },
      { categoria: 'alquiler', monto: 2400, tipo: 'fijo' },
      { categoria: 'luz', monto: 600, tipo: 'fijo' },
    ]]])
    const { G, GF } = prorratearGastos(gastos, new Map([['2026-06', 30]]), new Map([['2026-06', 1]]))
    expect(G).toBeCloseTo(400.00, TOL)
    expect(GF).toBeCloseTo(400.00, TOL)
    expect(resultado(1450, CV, G, GF).UO).toBeCloseTo(651.00, TOL)
    // Solo los fijos entran en GF
    const conVariable = new Map<string, GastoMes[]>([['2026-06', [{ categoria: 'gas', monto: 600, tipo: 'variable' }]]])
    expect(prorratearGastos(conVariable, new Map([['2026-06', 30]]), new Map([['2026-06', 3]]))).toEqual({ G: 60, GF: 0 })
  })

  it('[PU-06][RF12] merma (F11)', () => {
    const m = merma([0.5], [10.0], [p])
    expect(m.pct).toBeCloseTo(5.00, TOL)
    expect(m.soles).toBeCloseTo(11.63, 1)
    expect(Math.round(m.soles * 100) / 100).toBe(11.63)
    expect(merma([0.5], [0], [p]).pct).toBeNull()
  })

  it('[PU-07][RF09] factor de calibración (F12)', () => {
    expect(f).toBeCloseTo(1.0952, 4)
    expect(factorCalibracion([1], [0])).toBeNull()
  })

  it('[PU-08][RF09] factor fuera de rango: advertencia «revisar receta»', () => {
    expect(fueraDeRango(1.45)).toBe(true)
    expect(fueraDeRango(0.65)).toBe(true)
    expect(fueraDeRango(f)).toBe(false)
  })

  it('[PU-09][RF11] costo y margen del plato (F13, F14)', () => {
    const c = costoPlato(new Map([['PESCADO', 0.25]]), new Map([['PESCADO', f]]), new Map([['PESCADO', p]]), 120 / 1450, 30.00)
    expect(c).toBeCloseTo(8.85, TOL)
    expect(margen(30.00, c).MC).toBeCloseTo(21.15, TOL)
    // Sin receta: solo los otros insumos
    expect(costoPlato(new Map(), new Map(), new Map(), 120 / 1450, 30.00)).toBeCloseTo(2.48, TOL)
  })

  it('[PU-10][RF12] ventas de equilibrio (F15)', () => {
    expect(resultado(1450, CV, 400, 400).Veq).toBeCloseTo(551.86, TOL)
  })

  it('[PU-11][RF12] periodo sin ventas: food cost y Veq null, sin error', () => {
    const r = resultado(0, 0, 0, 0)
    expect(r.foodCost).toBeNull()
    expect(r.Veq).toBeNull()
    expect(Number.isNaN(r.UO)).toBe(false)
  })

  it('[PU-12][RF13] ingeniería de menú', () => {
    const cat = ingenieriaMenu(
      new Map([['a', 42], ['b', 30], ['c', 8], ['d', 10]]),
      new Map([['a', 21.15], ['b', 15.00], ['c', 22.00], ['d', 12.00]]),
    )
    expect(Object.fromEntries(cat)).toEqual({ a: 'Estrella', b: 'Caballo de batalla', c: 'Rompecabezas', d: 'Perro' })
    expect(ingenieriaMenu(new Map(), new Map()).size).toBe(0)
  })

  it('[PU-17][RF08] receta en la unidad de compra', () => {
    expect(kgPorPorcion(180, 0.80)).toBeCloseTo(0.225, 4)
  })

  it('domain/ es puro: no importa la BD, el entorno ni el reloj', () => {
    const dir = path.join(__dirname, '..', 'domain')
    for (const file of fs.readdirSync(dir).filter(f => f.endsWith('.ts'))) {
      const src = fs.readFileSync(path.join(dir, file), 'utf-8')
      expect(src, file).not.toMatch(/from '\.\.\/(db|services|repositories|routes|utils\/local)/)
      expect(src, file).not.toMatch(/process\.env|new Date\(\)|Date\.now/)
    }
  })
})
