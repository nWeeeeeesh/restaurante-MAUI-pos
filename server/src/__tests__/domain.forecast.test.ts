import { describe, it, expect } from 'vitest'
import {
  ventasPerdidas, demandaNoCensurada, stockTeorico, cantidadSugerida, cobertura, beneficioPotencial, zNormal,
  pronosticar, seleccionar, respaldo, ingenuoEstacional, promedioEstacional, redondearMedioKilo, gauss, METODOS,
} from '../domain/forecast'

// Casos de la Tabla 26 de la tesis (plan-sistema §5) y de resultado conocido (T14). Los
// mismos corren en Python sobre la referencia (scripts/tesis/pruebas_pu.py).
const TOL = 2
const dows = Array.from({ length: 24 }, (_, i) => (i % 6) + 1)  // 1 = martes … 6 = domingo
const fer = new Array<boolean>(24).fill(false)
const fut = { d: [1, 2, 3], f: [false, false, false] }

describe('dominio de pronóstico (incremento 3)', () => {
  it('[PU-13][RF16] ventas perdidas y demanda no censurada (F4, F5)', () => {
    const L = ventasPerdidas(['x'], new Map([['x', 12]]), new Map([['x', 9]]), new Map([['x', 0.25]]), 1)
    expect(L).toBeCloseTo(0.75, TOL)
    expect(demandaNoCensurada(11.5, L)).toBeCloseTo(12.25, TOL)
    // Un plato que vendió más que lo habitual no resta, y uno sin receta no suma
    expect(ventasPerdidas(['x', 'y'], new Map([['x', 5], ['y', 10]]), new Map([['x', 9]]), new Map([['x', 0.25]]), 1)).toBe(0)
  })

  it('[PU-14][RF15] stock teórico (F6)', () => {
    expect(stockTeorico(6.0, 10.0, 11.5 / 10.5, 30 * 0.25)).toBeCloseTo(7.79, TOL)
  })

  it('[PU-15][RF17] cantidad sugerida (F2)', () => {
    expect(cantidadSugerida([12.0, 11.0], 2.0, zNormal(0.85), 4.0)).toBeCloseTo(21.07, TOL)
    expect(redondearMedioKilo(21.07)).toBe(21.5)
    expect(redondearMedioKilo(21.5)).toBe(21.5)
  })

  it('[PU-16][RF17] cobertura limitada por la vida útil', () => {
    expect(cobertura(5, 3)).toBe(3)
    expect(cobertura(2, 7)).toBe(2)
    expect(cobertura(2, null)).toBe(2)
  })

  it('[PU-18][RF17] beneficio potencial', () => {
    expect(beneficioPotencial(120, 15, 40, 25)).toBeCloseTo(70.00, TOL)
  })

  it('[RF17] z(0.85) = 1.0364 y z(0.99) = 2.3263', () => {
    expect(zNormal(0.85).toFixed(4)).toBe('1.0364')
    expect(zNormal(0.99).toFixed(4)).toBe('2.3263')
    expect(zNormal(0.5)).toBeCloseTo(0, 9)
    expect(() => zNormal(1)).toThrow()
  })

  it('[RF16] demanda constante 10: los cuatro métodos pronostican 10', () => {
    const y = new Array<number>(24).fill(10)
    for (const m of METODOS) {
      for (const v of pronosticar(m, y, 3, dows, fer, fut.d, fut.f)) expect(v, m).toBeCloseTo(10, 9)
    }
  })

  it('[RF16] patrón semanal exacto: ingenuo y promedio estacional lo reproducen y el elegido tiene MAE 0', () => {
    const patron = [8, 8, 9, 11, 16, 18]
    const y = [...patron, ...patron, ...patron, ...patron]
    expect(ingenuoEstacional(y, 3)).toEqual([8, 8, 9])
    expect(promedioEstacional(y, 6)).toEqual(patron)
    const sel = seleccionar(y, new Array<boolean>(24).fill(false), dows, fer, 2)!
    expect(sel.mae[sel.metodo]).toBe(0)
    expect(sel.metodo).toBe('ingenuo_estacional') // en empate, el primero de la lista
  })

  it('[RF16] historial menor que 2 semanas: se usa el método de respaldo', () => {
    expect(seleccionar(new Array<number>(10).fill(5), new Array<boolean>(10).fill(false), dows.slice(0, 10), fer.slice(0, 10), 2)).toBeNull()
    // Con 8 días hay una sola semana previa por día: el mismo día de la semana anterior
    expect(respaldo([5, 5, 7, 5, 5, 5, 6, 6], 2)).toEqual([7, 5])
    expect(respaldo([4, 6], 2)).toEqual([5, 5])
    expect(respaldo([], 3)).toEqual([0, 0, 0])
  })

  it('[RF17] demanda cero: pronóstico 0 y cantidad sugerida no negativa', () => {
    const y = new Array<number>(24).fill(0)
    for (const m of METODOS) expect(pronosticar(m, y, 2, dows, fer, fut.d, fut.f), m).toEqual([0, 0])
    const sel = seleccionar(y, new Array<boolean>(24).fill(false), dows, fer, 2)!
    expect(cantidadSugerida([0, 0], sel.sigmaH, zNormal(0.99), 3)).toBe(0)
  })

  it('los días imputados entran en la serie pero no en el error', () => {
    const patron = [8, 8, 9, 11, 16, 18]
    const y = [...patron, ...patron, ...patron, ...patron]
    const imp = new Array<boolean>(24).fill(false)
    y[22] = 100 // un día raro, pero imputado
    imp[22] = true
    const sel = seleccionar(y, imp, dows, fer, 2)!
    expect(sel.mae.ingenuo_estacional).toBe(0)
  })

  it('eliminación de Gauss: resuelve y detecta un sistema singular', () => {
    expect(gauss([[2, 1], [1, 3]], [3, 5])!.map(v => Number(v.toFixed(9)))).toEqual([0.8, 1.4])
    expect(gauss([[1, 2], [2, 4]], [1, 2])).toBeNull()
  })
})
