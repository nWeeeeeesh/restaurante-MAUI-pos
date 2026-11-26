// Jornada simulada (E5 del artículo). Proceso hijo que, por HTTP contra el propio
// servicio y con los usuarios del simulador, repite el día de fixtures/sim12 con más
// boletas: pedido (con su comanda), ítems agregados, cobro y boleta, en el mismo orden y
// con los tiempos entre operaciones divididos por un factor (por defecto 60: unas 6 h
// en unos 6 min). Todo se mide en una sola corrida, no a lo largo de días.
// Cada petición va a jornada.csv; al final, jornada-resumen.json.
//
//   npm run dev:jornada -- [--puerto 3001] [--factor 60]
import { percentil, planSim12 } from '../src/dev/jornada-plan'
import { agregarFila, escribirJson, fechaLocal, rutaDev } from '../src/dev/modo'

const args = process.argv.slice(2)
const opcion = (nombre: string) => { const k = args.indexOf(nombre); return k !== -1 ? args[k + 1] : undefined }
const PUERTO = Number(opcion('--puerto') ?? process.env.PORT ?? 3001)
const FACTOR = Number(opcion('--factor') ?? process.env.MAUI_JORNADA_FACTOR ?? 60)
if (!Number.isFinite(FACTOR) || FACTOR < 1) throw new Error(`Factor de compresión inválido: ${FACTOR}`)
const BASE = `http://127.0.0.1:${PUERTO}`
const CLAVE = process.env.MAUI_SIM_CLAVE || 'sim12345'
const MESERO = 'sim-encargada' // abre los pedidos y agrega ítems
const CAJERO = 'sim-cajero'    // cobra e imprime la boleta

const tokens = new Map<string, string>()
const tiempos = new Map<string, number[]>()
let errores = 0
let pedidos = 0
const inicio = fechaLocal()
const t0Real = Date.now()

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
  const operaciones = [...tiempos.values()].reduce((s, t) => s + t.length, 0)
  escribirJson(rutaDev('jornada-resumen.json'), {
    estado, inicio, fin: fechaLocal(), factor: FACTOR, pedidos, operaciones, errores,
    duracionMin: Math.round((Date.now() - t0Real) / 6000) / 10,
    p95PedidoMs: percentil(tiempos.get('pedido') ?? [], 0.95),
    p95CobroMs: percentil(tiempos.get('cobro') ?? [], 0.95),
    porAccion, ...extra,
  })
}

async function main() {
  const plan = planSim12()
  console.log(`[jornada] día ${plan.fecha} de sim12: ${plan.boletas} boletas, ${plan.eventos.length} eventos en ${(plan.duracionS / 3600).toFixed(1)} h, comprimidos ${FACTOR} veces`)
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
    const espera = t0 + ev.offsetS * 1000 / FACTOR - Date.now()
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
