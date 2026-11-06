import { describe, it, expect, beforeAll } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import request from 'supertest'
import { sql } from 'drizzle-orm'
import { setupHttpApp } from './helpers/http'
import { loadSim, SIM12_DIR } from './helpers/sim'

// Paridad del incremento 3 con la referencia en Python: para cada noche de las semanas
// 9 a 12, el método elegido, los pronósticos, σ_H y la cantidad sugerida.
type Noche = {
  noche: string
  insumos: Record<string, {
    metodo: string; pronosticos: { fecha: string; horizonte: number; kg: number }[]; sigma_h: number | null
    H: number; fecha_lista: string; disponible: number; fuente_disponible: string; cantidad: number
  }>
}
const esperado = JSON.parse(fs.readFileSync(path.join(SIM12_DIR, 'esperado.json'), 'utf-8')) as {
  meta: { calibracion: [string, string] }
  pronosticos: Noche[]
}

let ctx: Awaited<ReturnType<typeof setupHttpApp>>
let svc: typeof import('../services/forecast.service')
let sim: Awaited<ReturnType<typeof loadSim>>
let ownerId: number

beforeAll(async () => {
  ctx = await setupHttpApp()
  sim = await loadSim(ctx.db)
  svc = await import('../services/forecast.service')
  const prof = await import('../services/profitability.service')
  ownerId = (await ctx.as('owner', 'Dueño pronóstico')).user.id
  const [from, to] = esperado.meta.calibracion
  await prof.calibrar(ctx.db, { localId: 1, from, to }, ownerId)
}, 60_000)

const codeOf = (id: number) => [...sim.supplyId].find(([, v]) => v === id)![0]

describe('[PP-02][RF16] pronóstico de cada noche de las semanas 9 a 12', () => {
  it('el método elegido coincide y los pronósticos difieren en 0.01 kg o menos', async () => {
    for (const n of esperado.pronosticos) {
      await svc.generarPronosticos(ctx.db, { localId: 1, madeOn: n.noche })
      const rows = await ctx.db.select().from(ctx.schema.demandForecasts).where(sql`made_on = ${n.noche}`)
      expect(rows, n.noche).toHaveLength(12)
      for (const r of rows) {
        const want = n.insumos[codeOf(r.supplyId)]
        const p = want.pronosticos[r.horizon - 1]
        expect(r.method, `${n.noche} ${codeOf(r.supplyId)}`).toBe(want.metodo)
        expect(r.targetDate).toBe(p.fecha)
        expect(Math.abs(r.valueKg - p.kg), `${n.noche} ${codeOf(r.supplyId)} h${r.horizon}`).toBeLessThanOrEqual(0.01)
        expect(r.modelVersion).toBe('mauidesk-forecast-1')
      }
    }
  }, 120_000)
})

describe('[PP-03][RF17] σ_H y cantidad sugerida con cobertura de 2 días', () => {
  it('coinciden con la referencia en cada noche', async () => {
    for (const n of esperado.pronosticos) {
      const fecha = Object.values(n.insumos)[0].fecha_lista
      const lista = await svc.listaCompra(ctx.db, { localId: 1, date: fecha, coverageDays: 2 }, ownerId)
      expect(lista.night).toBe(n.noche)
      for (const it of lista.items) {
        const want = n.insumos[it.code]
        expect(it.coverageDays).toBe(want.H)
        expect(Math.abs((it.sigmaH ?? 0) - (want.sigma_h ?? 0)), `${n.noche} ${it.code} σ`).toBeLessThanOrEqual(0.01)
        expect(it.availableSource).toBe(want.fuente_disponible)
        expect(Math.abs(it.available! - want.disponible), `${n.noche} ${it.code} A`).toBeLessThanOrEqual(0.01)
        expect(Math.abs(it.quantity! - want.cantidad), `${n.noche} ${it.code} Q`).toBeLessThanOrEqual(0.01)
      }
    }
    // Cada sugerencia mostrada queda guardada
    const [c] = await ctx.db.all<{ n: number }>(sql`SELECT COUNT(*) AS n FROM purchase_suggestions`)
    expect(Number(c.n)).toBe(esperado.pronosticos.length * 4)
  }, 120_000)
})

describe('[PI-10][RF16][RD04] tarea nocturna idempotente', () => {
  it('guarda los cuatro insumos × 3 horizontes y una segunda ejecución no cambia nada', async () => {
    const madeOn = '2026-08-04'
    const first = await svc.generarPronosticos(ctx.db, { localId: 1, madeOn })
    expect(first.created).toHaveLength(4)
    const before = await ctx.db.select().from(ctx.schema.demandForecasts).where(sql`made_on = ${madeOn}`)
    expect(before).toHaveLength(12)
    expect(new Set(before.map(r => r.horizon))).toEqual(new Set([1, 2, 3]))
    // Alguien cambia los datos de esa noche: el pronóstico guardado no se rehace
    await ctx.db.run(sql`UPDATE supply_counts SET quantity = quantity + 50 WHERE counted_on = ${madeOn}`)
    const second = await svc.generarPronosticos(ctx.db, { localId: 1, madeOn })
    expect(second.created).toEqual([])
    expect(second.skipped).toHaveLength(4)
    const after = await ctx.db.select().from(ctx.schema.demandForecasts).where(sql`made_on = ${madeOn}`)
    expect(after).toEqual(before)
    await ctx.db.run(sql`UPDATE supply_counts SET quantity = quantity - 50 WHERE counted_on = ${madeOn}`)
    const runs = await ctx.db.select().from(ctx.schema.forecastRuns).where(sql`made_on = ${madeOn}`)
    expect(runs.map(r => r.status)).toEqual(['ok', 'ok'])
  })
})

describe('[PI-11][RD01] la «Compra del día» no cambia con los pronósticos', () => {
  it('GET /api/inventory/daily/:date responde idéntico antes y después de pronosticar', async () => {
    const { localDateString, addDays } = await import('../utils/dates')
    // Un día reciente con datos propios, para que la ruta lo acepte
    const day = addDays(localDateString(), -1)
    const manager = (await ctx.as('manager', 'Encargada RD01')).auth
    const pescado = sim.supplyId.get('PESCADO')!
    await ctx.db.insert(ctx.schema.supplyCounts).values({ supplyId: pescado, quantity: 7.5, countedOn: day })
    const before = await request(ctx.app).get(`/api/inventory/daily/${day}`).set('Authorization', manager)
    expect(before.status).toBe(200)
    await svc.generarPronosticos(ctx.db, { localId: 1, madeOn: addDays(day, -1) })
    await svc.generarPronosticos(ctx.db, { localId: 1, madeOn: day })
    await svc.listaCompra(ctx.db, { localId: 1, date: day }, null)
    const after = await request(ctx.app).get(`/api/inventory/daily/${day}`).set('Authorization', manager)
    expect(after.body).toEqual(before.body)
    expect(JSON.stringify(after.body)).not.toMatch(/forecast|suggest|pronost|sugerid/i)
  })
})

describe('[RF15][RF18] stock teórico y avisos de pocas porciones', () => {
  it('el stock teórico parte del último conteo y resta lo vendido hasta la hora', async () => {
    const at = new Date('2026-08-15T23:00:00Z') // 18:00 en Lima, con el día vendido
    const st = await svc.stockTeorico(ctx.db, { localId: 1, at })
    const pescado = st.items.find(i => i.code === 'PESCADO')!
    expect(pescado.countedOn).toBe('2026-08-15')
    const temprano = await svc.stockTeorico(ctx.db, { localId: 1, at: new Date('2026-08-15T15:00:00Z') })
    expect(temprano.items.find(i => i.code === 'PESCADO')!.stockKg!).toBeGreaterThan(pescado.stockKg!)
  })

  it('avisa los platos con pocas porciones sin marcarlos agotados (RD02)', async () => {
    const at = new Date('2026-08-15T23:00:00Z')
    const list = await svc.avisos(ctx.db, { localId: 1, at, umbralPorciones: 1000 })
    expect(list.length).toBeGreaterThan(0)
    expect(list[0]).toMatchObject({ dishId: expect.any(Number), portionsLeft: expect.any(Number), supplyCode: expect.any(String) })
    const none = await svc.avisos(ctx.db, { localId: 1, at, umbralPorciones: -1 })
    expect(none).toEqual([])
    const [agotados] = await ctx.db.all<{ n: number }>(sql`SELECT COUNT(*) AS n FROM dishes WHERE available = 0`)
    expect(Number(agotados.n)).toBe(0)
  })
})

describe('[PI-10] tarea nocturna', () => {
  it('se programa a las 23:30 de Lima', async () => {
    const { proximaEjecucion } = await import('../jobs/nightly')
    expect(proximaEjecucion(new Date('2026-08-11T15:00:00Z')).toISOString()).toBe('2026-08-12T04:30:00.000Z')
    expect(proximaEjecucion(new Date('2026-08-12T04:30:00Z')).toISOString()).toBe('2026-08-13T04:30:00.000Z')
    expect(proximaEjecucion(new Date('2026-08-12T04:29:00Z')).toISOString()).toBe('2026-08-12T04:30:00.000Z')
  })

  it('al arrancar corre la noche anterior si falta, una sola vez; un lunes cerrado no se pronostica', async () => {
    const { ponerseAlDia, correrNoche, iniciarTareaNocturna } = await import('../jobs/nightly')
    // Jueves 2026-07-23 a las 10:00 de Lima: falta la noche del miércoles 22 (fuera de las
    // semanas que ya pronosticó la paridad)
    const r = await ponerseAlDia(ctx.db, 1, new Date('2026-07-23T15:00:00Z'))
    expect(r?.madeOn).toBe('2026-07-22')
    expect(await ponerseAlDia(ctx.db, 1, new Date('2026-07-23T16:00:00Z'))).toBeNull()
    // A las 23:45 del jueves, la pendiente es la de ese mismo día
    expect((await ponerseAlDia(ctx.db, 1, new Date('2026-07-24T04:45:00Z')))?.madeOn).toBe('2026-07-23')
    // Martes 2026-07-21 a las 08:00: la noche anterior de atención es el domingo 19
    const tue = await ponerseAlDia(ctx.db, 1, new Date('2026-07-21T13:00:00Z'))
    expect(tue?.madeOn).toBe('2026-07-19')
    expect(await correrNoche(ctx.db, 1, '2026-07-20')).toBeNull()
    expect(iniciarTareaNocturna({ localId: 1 })).toBeNull() // NIGHTLY_JOBS=off en los tests
  })
})
