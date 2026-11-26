// Se importa primero en index.ts, antes que cualquier módulo que abra la base: en modo
// de pruebas, una DATABASE_URL que no sea la simulada no llega a abrirse (nunca se crea
// ni se toca mauidisk.db), y la impresora apunta a la simulada (C2).
import * as dotenv from 'dotenv'
import { errorModoPruebas, modoPruebas } from './modo'

dotenv.config()

const error = errorModoPruebas()
if (error) {
  console.error(`[FATAL] ${error}`)
  process.exit(1)
}

export const PUERTO_IMPRESORA_SIMULADA = Number(process.env.MAUI_IMPRESORA_SIMULADA_PUERTO || 9100)

if (modoPruebas()) {
  process.env.PRINTER_TYPE = 'tcp'
  process.env.PRINTER_HOST = '127.0.0.1'
  process.env.PRINTER_PORT = String(PUERTO_IMPRESORA_SIMULADA)
}
