// Jornada simulada (C4, E5 del artículo: carga de fondo). Proceso hijo que, por HTTP
// contra el propio servicio y con los usuarios del simulador, repite A VELOCIDAD REAL el
// día de fixtures/sim12 con más boletas: pedido (con su comanda), ítems agregados, cobro
// y boleta, a las mismas horas relativas. No es una prueba de carga: no se acelera.
// Cada petición va a jornada.csv; al final, jornada-resumen.json.
//
//   npm run dev:jornada -- [--puerto 3001]
import { percentil, planSim12 } from '../src/dev/jornada-plan'
import { agregarFila, escribirJson, fechaLocal, rutaDev } from '../src/dev/modo'

const args = process.argv.slice(2)
const i = args.indexOf('--puerto')
const PUERTO = Number(i !== -1 ? args[i + 1] : process.env.PORT || 3001)
const BASE = `http://127.0.0.1:${PUERTO}`
const CLAVE = process.env.MAUI_SIM_CLAVE || 'sim12345'
const MESERO = 'sim-encargada' // abre los pedidos y agrega ítems
const CAJERO = 'sim-cajero'    // cobra e imprime la boleta

const tokens = new Map<string, string>()
const tiempos = new Map<string, number[]>()
let errores = 0
let pedidos = 0
const inicio = fechaLocal()

async function login(usuario: string) {
  const r = await fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: usuario, password: CLAVE }) })
  if (r.status !== 200) throw new Error(`login de ${usuario}: HTTP ${r.status}`)
  tokens.set(usuario, ((await r.json()) as { token: string }).token)
}

async function llamar<T = unknown>(accion: string | null, usuario: string, metodo: string, ruta: string, cuerpo?: unknown): Promise<{ codigo: number; datos: T | null }> {
  for (let intento = 0; intento < 2; intento++) {
    const t = Date.now()
    let codigo = 0
    let datos: T | null = null
    try {
      const r = await fetch(`${BASE}${ruta}`, {
        method: metodo,
        headers: { Authorization: `Bearer ${tokens.get(usuario)}`, ...(cuerpo ? { 'Content-Type': 'application/json' } : {}) },
        body: cuerpo ? JSON.stringify(cuerpo) : undefined,
      })
      codigo = r.status
      datos = await r.json().catch(() => null) as T | null
    } catch {
      codigo = 0 // sin respuesta: el servicio no estaba
    }
    const ms = Date.now() - t
    if (codigo === 401 && intento === 0) { await login(usuario).catch(() => undefined); continue }
    if (accion) {
      await agregarFila(rutaDev('jornada.csv'), ['fecha_hora', 'accion', 'ms', 'codigo'], [fechaLocal(), accion, ms, codigo])
      tiempos.set(accion, [...(tiempos.get(accion) ?? []), ms])
      if (codigo < 200 || codigo >= 300) errores++
    }
    return { codigo, datos }
  }
  return { codigo: 401, datos: null }
}

function resumen(estado: string, extra: Record<string, unknown> = {}) {
  const porAccion = Object.fromEntries([...tiempos].map(([a, t]) => [a, { n: t.length, medianaMs: percentil(t, 0.5), p95Ms: percentil(t, 0.95) }]))
  escribirJson(rutaDev('jornada-resumen.json'), { estado, inicio, fin: fechaLocal(), pedidos, errores, porAccion, ...extra })
}

async function main() {
  const plan = planSim12()
  console.log(`[jornada] día ${plan.fecha} de sim12: ${plan.boletas} boletas, ${plan.eventos.length} eventos en ${(plan.duracionS / 3600).toFixed(1)} h`)
  await login(MESERO)
  await login(CAJERO)
  const menu = (await llamar<{ dishes: { id: number; name: string }[] }[]>(null, MESERO, 'GET', '/api/menu')).datos ?? []
  const platos = new Map(menu.flatMap(c => c.dishes).map(d => [d.name, d.id]))
  const mesas = ((await llamar<{ id: number; status: string; active: boolean }[]>(null, MESERO, 'GET', '/api/tables')).datos ?? [])
    .filter(t => t.active !== false && t.status === 'free').map(t => t.id)
  const enUso = new Set<number>()
  const abiertos = new Map<string, { orderId: number; tableId: number | null }>()
  const sinPlato = new Set<string>()
  const extra = { diaSim12: plan.fecha, boletas: plan.boletas }
  process.on('SIGTERM', () => { resumen('detenida', extra); process.exit(0) })

  const t0 = Date.now()
  for (const ev of plan.eventos) {
    const espera = t0 + ev.offsetS * 1000 - Date.now()
    if (espera > 0) await new Promise(r => setTimeout(r, espera))
    const items = ev.items.flatMap(it => {
      const dishId = platos.get(it.plato)
      if (!dishId) { sinPlato.add(it.plato); return [] }
      return [{ dishId, quantity: it.cantidad }]
    })
    if (ev.accion === 'pedido') {
      if (items.length === 0) continue
      const tableId = mesas.find(m => !enUso.has(m)) ?? null
      const cuerpo = tableId ? { type: 'dine_in', tableId, items } : { type: 'delivery', customerName: 'Jornada simulada', items }
      const r = await llamar<{ id: number }>('pedido', MESERO, 'POST', '/api/orders', cuerpo)
      if (r.codigo === 201 && r.datos) {
        pedidos++
        abiertos.set(ev.boleta, { orderId: r.datos.id, tableId })
        if (tableId) enUso.add(tableId)
      }
    } else if (ev.accion === 'agregar') {
      const o = abiertos.get(ev.boleta)
      if (o && items.length) await llamar('agregar', MESERO, 'POST', `/api/orders/${o.orderId}/items`, { items })
    } else {
      const o = abiertos.get(ev.boleta)
      if (!o) continue
      const pedido = (await llamar<{ items: { unitPrice: number; quantity: number }[] }>(null, CAJERO, 'GET', `/api/orders/${o.orderId}`)).datos
      const total = Math.round((pedido?.items ?? []).reduce((s, x) => s + x.unitPrice * (x.quantity ?? 1), 0) * 100) / 100
      const b = await llamar<{ id: number }>('cobro', CAJERO, 'POST', '/api/bills', { orderId: o.orderId, paymentMethod: 'cash', cashReceived: total })
      if (b.codigo === 201 && b.datos) await llamar('boleta', CAJERO, 'POST', `/api/print/reprint/${b.datos.id}`)
      abiertos.delete(ev.boleta)
      if (o.tableId) enUso.delete(o.tableId)
    }
  }
  resumen('terminada', { ...extra, platosNoEncontrados: [...sinPlato] })
  console.log(`[jornada] terminada: ${pedidos} pedidos, ${errores} errores`)
}

main().catch(e => {
  console.error(`[jornada] ${e instanceof Error ? e.message : e}`)
  resumen('error', { error: String(e) })
  process.exit(1)
})
