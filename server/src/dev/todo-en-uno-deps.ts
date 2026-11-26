// Los pasos reales de «Todo en uno» (en un módulo aparte para que la prueba del
// encadenamiento no cargue la base ni los procesos hijo).
import { calcularResultados, periodoPorDefecto } from './descarga'
import { jornadaEnCurso, programarJornadas } from './jornada'
import { medirCalculos } from './medir'
import { verificarPermisos } from './permisos'
import { correrPruebas } from './pruebas'
import { estadoRecuperacion, pruebasRecuperacion } from './recuperacion'
import type { Dependencias, TipoTrabajo } from './todo-en-uno'
import { iniciarTrabajo } from './trabajos'

export function dependenciasReales(puerto: number): Dependencias {
  const base = `http://127.0.0.1:${puerto}`
  const fns: Record<TipoTrabajo, Parameters<typeof iniciarTrabajo>[1]> = {
    medir: medirCalculos,
    permisos: a => verificarPermisos(base, a),
    pruebas: correrPruebas,
    recuperacion: pruebasRecuperacion,
  }
  return {
    correr: tipo => iniciarTrabajo(tipo, fns[tipo]),
    programar: p => { programarJornadas(puerto, p) },
    estadoRecuperacion,
    jornadaEnCurso,
    verificarDescarga: () => { calcularResultados(periodoPorDefecto(), { noches: null, respaldosRemotos: null }) },
    ahora: () => new Date(),
  }
}
