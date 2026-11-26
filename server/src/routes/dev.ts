// Perfil de desarrollador (bloque C): todo lo que necesitan el artículo y la tesis,
// desde el navegador, con datos simulados. Sin MAUI_MODO_PRUEBAS=1, /api/dev/* responde
// 404 como cualquier ruta inexistente; con el modo, solo el rol developer entra.
import * as fs from 'fs'
import { Router } from 'express'
import { and, eq, gte, lte } from 'drizzle-orm'
import { db } from '../db'
import { forecastRuns } from '../db/schema'
import { requireAuth, requireRole } from '../middleware/auth'
import { validateBody, validateQuery } from '../middleware/validate'
import { ConfirmarSchema, EquipoSchema, PeriodoSchema, ProgramacionSchema, type EquipoInput, type ProgramacionInput } from '../schemas/dev'
import { audit } from '../services/audit'
import { calendarioHasta } from '../services/forecast.service'
import { currentLocalId } from '../utils/local'
import { toCsv } from '../utils/csv'
import { dirDev, escribirJson, fechaLocal, leerCsvDev, leerJson, modoPruebas, rutaDev } from '../dev/modo'
import { medirCalculos, p95s } from '../dev/medir'
import { verificarPermisos } from '../dev/permisos'
import { correrPruebas } from '../dev/pruebas'
import { cancelarRecuperacion, estadoRecuperacion, pruebasRecuperacion, VECES } from '../dev/recuperacion'
import { correrJornada, detenerJornada, jornadaEnCurso, programacion, programarJornadas, proximaJornada } from '../dev/jornada'
import { iniciarTrabajo, trabajoEnCurso, trabajos } from '../dev/trabajos'
import {
  almacenamiento, armarPaquete, calcularResultados, enPeriodo, listarRemoto, nochesDelPeriodo, periodoPorDefecto, resumenMd,
  soVersion, VECES_ARRANQUE, type Periodo,
} from '../dev/descarga'
import { fuentesPorDefecto } from '../dev/sistema'

const router = Router()
const puerto = () => Number(process.env.PORT || 3001)
const base = () => `http://127.0.0.1:${puerto()}`

router.use((_req, res, next) => {
  if (!modoPruebas()) { res.status(404).json({ error: 'Ruta no encontrada', code: 'NOT_FOUND' }); return }
  next()
})
router.use(requireAuth, requireRole('developer'))

const registrar = (userId: number, accion: string, data?: unknown) => audit(db, { userId, action: `dev.${accion}`, entity: 'dev', data })

function parte(archivo: string) {
  const ruta = rutaDev(archivo)
  return fs.existsSync(ruta) ? { hecho: true, fecha: fechaLocal(fs.statSync(ruta).mtime) } : { hecho: false, fecha: null }
}

const arranques = () => leerCsvDev(rutaDev('arranques.csv')).filter(a => a.motivo === 'arranque').length

router.get('/estado', async (_req, res) => {
  const prog = programacion()
  const f = fuentesPorDefecto()
  res.json({
    periodo: periodoPorDefecto(),
    dir: dirDev(),
    equipo: { ...(leerJson<EquipoInput>(rutaDev('equipo.json')) ?? {}), detectado: { almacenamiento: almacenamiento(f), so_version: soVersion(f), node: process.versions.node } },
    trabajos: trabajos(),
    enCurso: trabajoEnCurso()?.tipo ?? null,
    partes: {
      registro: parte('recursos.csv'),
      medir: parte('e2-pi.json'),
      permisos: parte('permisos.json'),
      pruebas: parte('pruebas.json'),
      recuperacion: parte('reinicio.csv'),
      jornada: parte('jornada.csv'),
      instalacion: parte('instalacion-tiempos.json'),
      impresiones: parte('impresiones.csv'),
    },
    arranques: { hechos: arranques(), de: VECES_ARRANQUE },
    e2: p95s(leerJson(rutaDev('e2-pi.json'))),
    permisos: leerJson(rutaDev('permisos.json')),
    pruebas: leerJson(rutaDev('pruebas.json')),
    recuperacion: { ...(estadoRecuperacion() ?? {}), veces: VECES },
    jornada: { enCurso: jornadaEnCurso(), resumen: leerJson(rutaDev('jornada-resumen.json')), programacion: prog, proxima: prog ? proximaJornada(prog)?.toISOString() ?? null : null },
  })
})

router.put('/equipo', validateBody(EquipoSchema), async (req, res) => {
  const datos = { ...(leerJson<EquipoInput>(rutaDev('equipo.json')) ?? {}), ...(req.body as EquipoInput) }
  escribirJson(rutaDev('equipo.json'), datos)
  await registrar(req.user!.id, 'equipo', datos)
  res.json(datos)
})

const lanzar = (tipo: string, fn: Parameters<typeof iniciarTrabajo>[1]) => async (req: import('express').Request, res: import('express').Response) => {
  const t = iniciarTrabajo(tipo, fn)
  await registrar(req.user!.id, tipo)
  res.status(202).json(t)
}

router.post('/medir', lanzar('medir', medirCalculos))
router.post('/permisos', lanzar('permisos', a => verificarPermisos(base(), a)))
router.post('/pruebas', lanzar('pruebas', correrPruebas))
router.post('/recuperacion', validateBody(ConfirmarSchema), lanzar('recuperacion', pruebasRecuperacion))
router.delete('/recuperacion', async (req, res) => {
  const habia = cancelarRecuperacion()
  await registrar(req.user!.id, 'recuperacion.cancelar')
  res.json({ cancelada: habia })
})

router.post('/jornada', async (req, res) => {
  const j = correrJornada(puerto())
  await registrar(req.user!.id, 'jornada')
  res.status(202).json(j)
})
router.delete('/jornada', async (req, res) => {
  const detenida = detenerJornada()
  await registrar(req.user!.id, 'jornada.detener')
  res.json({ detenida })
})
router.put('/jornada/programacion', validateBody(ProgramacionSchema), async (req, res) => {
  const b = req.body as ProgramacionInput
  const p = { hora: b.hora, dias: b.dias, desde: b.desde ?? fechaLocal().slice(0, 10), ejecutadas: [] as string[] }
  const proxima = programarJornadas(puerto(), p)
  await registrar(req.user!.id, 'jornada.programar', p)
  res.json({ programacion: p, proxima: proxima?.toISOString() ?? null })
})
router.delete('/jornada/programacion', async (req, res) => {
  programarJornadas(puerto(), null)
  await registrar(req.user!.id, 'jornada.desprogramar')
  res.json({ programacion: null })
})

function periodoDe(q: Record<string, unknown>): Periodo {
  const p = PeriodoSchema.parse(q)
  const d = periodoPorDefecto()
  return { desde: p.desde ?? d.desde, hasta: p.hasta ?? d.hasta }
}

async function nochesYRuns(p: Periodo) {
  const localId = currentLocalId()
  const runs = await db.select().from(forecastRuns)
    .where(and(eq(forecastRuns.localId, localId), gte(forecastRuns.madeOn, p.desde), lte(forecastRuns.madeOn, p.hasta)))
  const cal = await calendarioHasta(db, { localId, hasta: p.hasta })
  return { noches: nochesDelPeriodo(cal, runs, p), runs }
}

// GET /api/dev/resultados?desde&hasta — resultados.json sin armar el paquete
router.get('/resultados', validateQuery(PeriodoSchema), async (req, res) => {
  const p = periodoDe(req.query)
  const { noches } = await nochesYRuns(p)
  res.json({ periodo: p, resultados: calcularResultados(p, { noches, respaldosRemotos: await listarRemoto() }) })
})

// GET /api/dev/descargar?desde&hasta — maui-resultados-<fecha>.tar.gz
router.get('/descargar', validateQuery(PeriodoSchema), async (req, res) => {
  const p = periodoDe(req.query)
  const { noches, runs } = await nochesYRuns(p)
  const resultados = calcularResultados(p, { noches, respaldosRemotos: await listarRemoto() })
  const permisos = leerJson(rutaDev('permisos.json'))
  const pruebas = leerJson(rutaDev('pruebas.json'))
  const semana = enPeriodo(leerCsvDev(rutaDev('recursos.csv')), p)
  const columnas = ['fecha_hora', 'cpu_pct', 'mem_disponible_mb', 'rss_mb', 'temp_c', 'throttled', 'sectores_escritos', 'potencia_w']
  const paquete = await armarPaquete(p, [
    { destino: 'articulo/resultados.json', contenido: JSON.stringify(resultados, null, 2) + '\n' },
    { destino: 'articulo/recursos-e2.csv', origen: rutaDev('recursos-e2.csv') },
    { destino: 'articulo/recursos-semana.csv', contenido: [columnas.join(','), ...semana.map(f => columnas.map(c => f[c] ?? '').join(','))].join('\n') + '\n' },
    { destino: 'articulo/jornada.csv', origen: rutaDev('jornada.csv') },
    { destino: 'tesis/rendimiento.json', origen: rutaDev('e2-pi.json') },
    { destino: 'tesis/forecast_runs.csv', contenido: toCsv(['made_on', 'status', 'started_at', 'finished_at', 'error'], runs.map(r => [r.madeOn, r.status, r.startedAt, r.finishedAt, r.error])) },
    { destino: 'tesis/permisos.json', origen: rutaDev('permisos.json') },
    { destino: 'tesis/evidencias.md', origen: rutaDev('evidencias.md') },
    { destino: 'tesis/pruebas-ci.txt', origen: rutaDev('pruebas-ci.txt') },
    { destino: 'tesis/pruebas-report-tesis.txt', origen: rutaDev('pruebas-report-tesis.txt') },
    { destino: 'tesis/impresiones.csv', origen: rutaDev('impresiones.csv') },
    { destino: 'resumen.md', contenido: resumenMd(resultados, p, { permisos, pruebas, arranques: arranques() }) },
  ])
  await registrar(req.user!.id, 'descargar', p)
  res.download(paquete.archivo, paquete.nombre, () => fs.rmSync(paquete.archivo, { force: true }))
})

export default router
