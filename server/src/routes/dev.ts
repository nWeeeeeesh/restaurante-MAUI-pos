// Perfil de desarrollador (bloque C): todo lo que necesitan el artículo y la tesis,
// desde el navegador, con datos simulados. Sin MAUI_MODO_PRUEBAS=1, /api/dev/* responde
// 404 como cualquier ruta inexistente; con el modo, solo el rol developer entra.
import * as fs from 'fs'
import { Router } from 'express'
import { requireAuth, requireRole } from '../middleware/auth'
import { validateBody } from '../middleware/validate'
import { ConfirmarSchema, EquipoSchema, ReintentarSchema, TodoEnUnoSchema, type EquipoInput } from '../schemas/dev'
import { audit } from '../services/audit'
import { toCsv } from '../utils/csv'
import { db } from '../db'
import { dirDev, escribirJson, fechaLocal, leerCsvDev, leerJson, modoPruebas, rutaDev } from '../dev/modo'
import { medirCalculos, p95s } from '../dev/medir'
import { verificarPermisos } from '../dev/permisos'
import { correrPruebas } from '../dev/pruebas'
import { tareaNocturna } from '../dev/nocturna'
import { cancelarRecuperacion, estadoRecuperacion, pruebasRecuperacion, VECES } from '../dev/recuperacion'
import { detenerJornada, FACTOR_JORNADA, jornadaEnCurso, jornadaSimulada, resumenJornada } from '../dev/jornada'
import { iniciarTrabajo, trabajoEnCurso, trabajos } from '../dev/trabajos'
import { almacenamiento, armarPaquete, calcularResultados, resumenMd, soVersion, VECES_ARRANQUE } from '../dev/descarga'
import { fuentesPorDefecto } from '../dev/sistema'
import { cancelarTodoEnUno, iniciarTodoEnUno, planTodo, reintentarDesde, type IdPaso } from '../dev/todo-en-uno'
import { dependenciasReales } from '../dev/todo-en-uno-deps'

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
  const f = fuentesPorDefecto()
  res.json({
    dir: dirDev(),
    equipo: { ...(leerJson<EquipoInput>(rutaDev('equipo.json')) ?? {}), detectado: { almacenamiento: almacenamiento(f), so_version: soVersion(f), node: process.versions.node } },
    trabajos: trabajos(),
    todoEnUno: planTodo(),
    enCurso: trabajoEnCurso()?.tipo ?? null,
    partes: {
      registro: parte('recursos.csv'),
      medir: parte('e2-pi.json'),
      permisos: parte('permisos.json'),
      pruebas: parte('pruebas.json'),
      recuperacion: parte('reinicio.csv'),
      jornada: parte('jornada-resumen.json'),
      nocturna: parte('nocturna.json'),
      instalacion: parte('instalacion-tiempos.json'),
      impresiones: parte('impresiones.csv'),
    },
    arranques: { hechos: arranques(), de: VECES_ARRANQUE },
    e2: p95s(leerJson(rutaDev('e2-pi.json'))),
    permisos: leerJson(rutaDev('permisos.json')),
    pruebas: leerJson(rutaDev('pruebas.json')),
    recuperacion: { ...(estadoRecuperacion() ?? {}), veces: VECES },
    nocturna: leerJson(rutaDev('nocturna.json')),
    jornada: { enCurso: jornadaEnCurso(), resumen: resumenJornada(), factor: FACTOR_JORNADA() },
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
router.post('/jornada', lanzar('jornada', a => jornadaSimulada(puerto(), a)))
router.post('/nocturna', lanzar('nocturna', tareaNocturna))
router.post('/recuperacion', validateBody(ConfirmarSchema), lanzar('recuperacion', pruebasRecuperacion))
router.delete('/recuperacion', async (req, res) => {
  const habia = cancelarRecuperacion()
  await registrar(req.user!.id, 'recuperacion.cancelar')
  res.json({ cancelada: habia })
})

// «Todo en uno», en una sola corrida: medir, jornada, nocturna, permisos, pruebas y recuperación
router.post('/todo-en-uno', validateBody(TodoEnUnoSchema), async (req, res) => {
  const plan = iniciarTodoEnUno(dependenciasReales(puerto()))
  await registrar(req.user!.id, 'todo-en-uno')
  res.status(202).json(plan)
})
router.post('/todo-en-uno/reintentar', validateBody(ReintentarSchema), async (req, res) => {
  const desde = (req.body as { desde: IdPaso }).desde
  const plan = reintentarDesde(dependenciasReales(puerto()), desde)
  await registrar(req.user!.id, 'todo-en-uno.reintentar', { desde })
  res.status(202).json(plan)
})
router.delete('/todo-en-uno', async (req, res) => {
  const plan = cancelarTodoEnUno()
  await registrar(req.user!.id, 'todo-en-uno.cancelar')
  res.json(plan)
})

router.delete('/jornada', async (req, res) => {
  const detenida = detenerJornada()
  await registrar(req.user!.id, 'jornada.detener')
  res.json({ detenida })
})

// forecast_runs de la noche que corrió la tarea nocturna real
async function runsNocturna() {
  const noc = leerJson<{ runs?: { madeOn: string; status: string; startedAt: string | null; finishedAt: string | null; error: string | null }[] }>(rutaDev('nocturna.json'))
  return noc?.runs ?? []
}

// GET /api/dev/resultados — resultados.json sin armar el paquete
router.get('/resultados', async (_req, res) => {
  res.json({ resultados: calcularResultados() })
})

// GET /api/dev/descargar — maui-resultados-<fecha>.tar.gz, con la última corrida
router.get('/descargar', async (req, res) => {
  const resultados = calcularResultados()
  const permisos = leerJson(rutaDev('permisos.json'))
  const pruebas = leerJson(rutaDev('pruebas.json'))
  const nocturna = leerJson(rutaDev('nocturna.json'))
  const runs = await runsNocturna()
  const paquete = await armarPaquete([
    { destino: 'articulo/resultados.json', contenido: JSON.stringify(resultados, null, 2) + '\n' },
    { destino: 'articulo/recursos-e2.csv', origen: rutaDev('recursos-e2.csv') },
    { destino: 'articulo/recursos-jornada.csv', origen: rutaDev('recursos-jornada.csv') },
    { destino: 'articulo/jornada.csv', origen: rutaDev('jornada.csv') },
    { destino: 'tesis/rendimiento.json', origen: rutaDev('e2-pi.json') },
    { destino: 'tesis/forecast_runs.csv', contenido: toCsv(['made_on', 'status', 'started_at', 'finished_at', 'error'], runs.map(r => [r.madeOn, r.status, r.startedAt, r.finishedAt, r.error])) },
    { destino: 'tesis/permisos.json', origen: rutaDev('permisos.json') },
    { destino: 'tesis/evidencias.md', origen: rutaDev('evidencias.md') },
    { destino: 'tesis/pruebas-ci.txt', origen: rutaDev('pruebas-ci.txt') },
    { destino: 'tesis/pruebas-report-tesis.txt', origen: rutaDev('pruebas-report-tesis.txt') },
    { destino: 'tesis/impresiones.csv', origen: rutaDev('impresiones.csv') },
    { destino: 'resumen.md', contenido: resumenMd(resultados, { permisos, pruebas, arranques: arranques(), nocturna }) },
  ])
  await registrar(req.user!.id, 'descargar')
  res.download(paquete.archivo, paquete.nombre, () => fs.rmSync(paquete.archivo, { force: true }))
})

export default router
