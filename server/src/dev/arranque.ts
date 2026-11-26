// Arranque del modo de pruebas desde index.ts: la impresora simulada antes de escuchar
// y, después, el registro continuo, el arranque, la recuperación pendiente y las
// jornadas programadas.
import * as fs from 'fs'
import { PUERTO_IMPRESORA_SIMULADA } from './guardia'
import { iniciarImpresoraSimulada } from './impresora'
import { programarJornadas } from './jornada'
import { dirDev, modoPruebas, rutaDev } from './modo'
import { reanudarRecuperacion } from './recuperacion'
import { registrarArranque, registrarLatidos, registrarRecursos } from './registro'

export async function prepararModoPruebas() {
  if (!modoPruebas()) return
  fs.mkdirSync(dirDev(), { recursive: true })
  try {
    await iniciarImpresoraSimulada(PUERTO_IMPRESORA_SIMULADA)
    console.log(`[startup] MODO DE PRUEBAS: base ${process.env.DATABASE_URL}, impresora simulada en 127.0.0.1:${PUERTO_IMPRESORA_SIMULADA}`)
  } catch (e) {
    console.log(`[startup] ATENCIÓN: la impresora simulada no pudo abrir el puerto ${PUERTO_IMPRESORA_SIMULADA}: ${(e as Error).message}`)
  }
}

export function iniciarModoPruebas(puerto: number) {
  if (!modoPruebas()) return
  registrarRecursos(rutaDev('recursos.csv'), 10_000)
  registrarLatidos()
  programarJornadas(puerto)
  void registrarArranque(puerto).then(a => {
    if (a?.motivo === 'prueba_reinicio') return reanudarRecuperacion(a.primer200)
  }).catch(e => console.log(`[dev] Registro del arranque falló: ${(e as Error).message}`))
  console.log(`[startup] Registro de recursos en ${dirDev()}; perfil de desarrollador en /api/dev`)
}
