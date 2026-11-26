// Impresora simulada del modo de pruebas (C2): un receptor TCP en 127.0.0.1:9100 que
// acepta el ESC/POS como la ticketera, sin papel. Cuenta cada trabajo en
// impresiones.csv. Las conexiones sin datos son el pre-chequeo de checkPrinterStatus.
import * as net from 'net'
import { agregarFila, fechaLocal, rutaDev } from './modo'

// El tipo sale del texto del ticket (utils/printer.ts)
export function tipoDeTrabajo(datos: Buffer): string {
  const t = datos.toString('latin1')
  if (t.includes('PRE-CUENTA')) return 'precuenta'
  if (t.includes('LISTA DE COMPRA')) return 'lista_compra'
  if (t.includes('Prueba de Impresora')) return 'prueba'
  if (t.includes('Boleta:')) return 'boleta'
  if (t.includes('COMANDA NUEVA') || t.includes('ITEMS AGREGADOS') || t.includes('REIMPRESION')) return 'comanda'
  return 'otro'
}

// DLE EOT n (estado en tiempo real): la ticketera responde un byte; 0x12 = en línea, sin error
const DLE = 0x10
const EOT = 0x04

export function iniciarImpresoraSimulada(puerto: number, archivo = rutaDev('impresiones.csv')): Promise<net.Server> {
  const servidor = net.createServer(socket => {
    const partes: Buffer[] = []
    socket.on('data', (d: Buffer) => {
      partes.push(d)
      for (let i = 0; i < d.length - 1; i++) if (d[i] === DLE && d[i + 1] === EOT) socket.write(Buffer.from([0x12]))
    })
    socket.on('error', () => undefined)
    socket.on('close', () => {
      const datos = Buffer.concat(partes)
      if (datos.length === 0) return
      void agregarFila(archivo, ['fecha_hora', 'tipo', 'bytes'], [fechaLocal(), tipoDeTrabajo(datos), datos.length]).catch(() => undefined)
    })
  })
  servidor.unref()
  return new Promise((resolve, reject) => {
    servidor.once('error', reject)
    servidor.listen(puerto, '127.0.0.1', () => resolve(servidor))
  })
}
