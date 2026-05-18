import net from 'net'
import { execFile } from 'child_process'
import { writeFileSync, unlinkSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { LOGO_CMD } from './logo_bitmap'

const ESC = 0x1B
const GS  = 0x1D

const CMD = {
  INIT:         Buffer.from([ESC, 0x40]),
  ALIGN_LEFT:   Buffer.from([ESC, 0x61, 0x00]),
  ALIGN_CENTER: Buffer.from([ESC, 0x61, 0x01]),
  BOLD_ON:      Buffer.from([ESC, 0x45, 0x01]),
  BOLD_OFF:     Buffer.from([ESC, 0x45, 0x00]),
  DOUBLE_ON:    Buffer.from([ESC, 0x21, 0x30]),
  DOUBLE_OFF:   Buffer.from([ESC, 0x21, 0x00]),
  FEED3:        Buffer.from([ESC, 0x64, 0x03]),
  CUT:          Buffer.from([GS,  0x56, 0x42, 0x00]),
}

const WIDTH = 48

function sanitize(text: string): string {
  return text
    .replace(/á/g, 'a').replace(/Á/g, 'A')
    .replace(/é/g, 'e').replace(/É/g, 'E')
    .replace(/í/g, 'i').replace(/Í/g, 'I')
    .replace(/ó/g, 'o').replace(/Ó/g, 'O')
    .replace(/ú/g, 'u').replace(/Ú/g, 'U')
    .replace(/ñ/g, 'n').replace(/Ñ/g, 'N')
    .replace(/ü/g, 'u').replace(/Ü/g, 'U')
    .replace(/¡/g, '!').replace(/¿/g, '?')
    .replace(/[^\x00-\x7F]/g, '?')
}

function txt(text: string): Buffer {
  return Buffer.from(sanitize(text))
}

function line(text: string): Buffer {
  const s = sanitize(text)
  return Buffer.from(s.slice(0, WIDTH) + '\n')
}

function row(label: string, value: string): Buffer {
  const l = sanitize(label)
  const v = sanitize(value)
  const spaces = WIDTH - l.length - v.length
  if (spaces <= 0) return line(l.slice(0, WIDTH - v.length - 1) + ' ' + v)
  return line(l + ' '.repeat(spaces) + v)
}

function divider(): Buffer {
  return line('-'.repeat(WIDTH))
}

// ── Conexión por red TCP (impresora con IP) ──────────────────────────────────
function sendViaTCP(host: string, port: number, data: Buffer): Promise<void> {
  return new Promise((resolve, reject) => {
    const client = net.createConnection({ host, port }, () => {
      client.write(data, (err) => {
        if (err) { client.destroy(); reject(err) }
        else { client.end() }
      })
    })
    client.on('close', resolve)
    client.on('error', reject)
    client.setTimeout(5000, () => {
      client.destroy()
      reject(new Error('Tiempo de conexion con impresora agotado'))
    })
  })
}

// ── Conexión directa USB/Local en Windows (sin red) ─────────────────────────
function sendViaWindows(printerName: string, data: Buffer): Promise<void> {
  const tmpFile = join(tmpdir(), `receipt_${Date.now()}.bin`)
  writeFileSync(tmpFile, data)
  const escaped = tmpFile.replace(/\\/g, '\\\\')
  const name    = printerName.replace(/'/g, "''")

  // Usa P/Invoke con DOCINFO construido manualmente en memoria no gestionada
  // para evitar problemas de marshaling de structs con strings en PowerShell 5.1
  const ps = `
$bytes = [System.IO.File]::ReadAllBytes('${escaped}')
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class RawPrint {
  [DllImport("winspool.drv",CharSet=CharSet.Ansi,SetLastError=true)]
  public static extern bool OpenPrinter(string n, out IntPtr h, IntPtr p);
  [DllImport("winspool.drv",SetLastError=true)]
  public static extern bool ClosePrinter(IntPtr h);
  [DllImport("winspool.drv",CharSet=CharSet.Ansi,SetLastError=true)]
  public static extern int StartDocPrinter(IntPtr h, int l, IntPtr d);
  [DllImport("winspool.drv",SetLastError=true)]
  public static extern bool EndDocPrinter(IntPtr h);
  [DllImport("winspool.drv",SetLastError=true)]
  public static extern bool StartPagePrinter(IntPtr h);
  [DllImport("winspool.drv",SetLastError=true)]
  public static extern bool EndPagePrinter(IntPtr h);
  [DllImport("winspool.drv",SetLastError=true)]
  public static extern bool WritePrinter(IntPtr h, IntPtr b, int c, out int w);
  public static void Send(string printerName, byte[] data) {
    IntPtr h = IntPtr.Zero;
    OpenPrinter(printerName, out h, IntPtr.Zero);
    IntPtr pName  = Marshal.StringToHGlobalAnsi("receipt");
    IntPtr pType  = Marshal.StringToHGlobalAnsi("RAW");
    IntPtr pDoc   = Marshal.AllocHGlobal(3 * IntPtr.Size);
    Marshal.WriteIntPtr(pDoc, 0 * IntPtr.Size, pName);
    Marshal.WriteIntPtr(pDoc, 1 * IntPtr.Size, IntPtr.Zero);
    Marshal.WriteIntPtr(pDoc, 2 * IntPtr.Size, pType);
    StartDocPrinter(h, 1, pDoc);
    StartPagePrinter(h);
    IntPtr pBytes = Marshal.AllocHGlobal(data.Length);
    Marshal.Copy(data, 0, pBytes, data.Length);
    int w = 0;
    WritePrinter(h, pBytes, data.Length, out w);
    Marshal.FreeHGlobal(pBytes);
    EndPagePrinter(h);
    EndDocPrinter(h);
    ClosePrinter(h);
    Marshal.FreeHGlobal(pName);
    Marshal.FreeHGlobal(pType);
    Marshal.FreeHGlobal(pDoc);
  }
}
'@ -ErrorAction SilentlyContinue
[RawPrint]::Send('${name}', $bytes)
`

  return new Promise((resolve, reject) => {
    execFile('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps], (err, _out, stderr) => {
      try { unlinkSync(tmpFile) } catch {}
      if (err) reject(new Error(stderr || err.message))
      else resolve()
    })
  })
}

// ── Pre-check de conectividad (evita encolar trabajos si la impresora esta apagada) ──
export interface PrinterStatus {
  ok: boolean
  reason?: string
  type: 'tcp' | 'windows'
  identifier: string
  state?: string
}

function checkTCPReachable(host: string, port: number, timeoutMs = 1500): Promise<PrinterStatus> {
  return new Promise((resolve) => {
    const sock = net.createConnection({ host, port })
    let done = false
    const finalize = (ok: boolean, reason?: string) => {
      if (done) return
      done = true
      try { sock.destroy() } catch {}
      resolve({ ok, reason, type: 'tcp', identifier: `${host}:${port}` })
    }
    sock.setTimeout(timeoutMs, () => finalize(false, 'Tiempo de conexion agotado — impresora no responde'))
    sock.once('connect', () => finalize(true))
    sock.once('error', (e: any) => {
      const code = e?.code ?? ''
      if (code === 'ECONNREFUSED') finalize(false, 'Impresora rechazo la conexion (puerto cerrado)')
      else if (code === 'EHOSTUNREACH' || code === 'ENETUNREACH') finalize(false, 'Impresora no alcanzable en la red')
      else if (code === 'ETIMEDOUT') finalize(false, 'Tiempo de conexion agotado')
      else finalize(false, e?.message ?? 'Error de red')
    })
  })
}

const WIN_BAD_STATUS = new Set([
  'Offline', 'Paused', 'Error', 'PaperJam', 'PaperOut',
  'ManualFeed', 'PaperProblem', 'OutputBinFull', 'NotAvailable',
  'NoToner', 'PagePunt', 'UserIntervention', 'OutOfMemory',
  'DoorOpen', 'ServerUnknown', 'PowerSave',
])

// Si hay trabajos en cola más viejos que esto, la cola está atorada — el driver
// "Basic 200" reporta PrinterStatus=Normal incluso cuando la impresora física
// está apagada/desconectada/sin papel, así que la cola creciente es nuestra única
// señal de "no está imprimiendo realmente".
const STUCK_JOB_AGE_SECONDS = 30

function checkWindowsReachable(name: string): Promise<PrinterStatus> {
  const escaped = name.replace(/'/g, "''")
  // Get-Printer + Get-PrintJob para detectar trabajos atorados.
  const ps = `
$ErrorActionPreference = 'Stop'
try {
  $p = Get-Printer -Name '${escaped}' -ErrorAction Stop
  $offline = $false
  try { $offline = [bool]$p.WorkOffline } catch {}
  $oldest = 0
  $count = 0
  try {
    $jobs = @(Get-PrintJob -PrinterName '${escaped}' -ErrorAction SilentlyContinue)
    $count = $jobs.Count
    if ($count -gt 0) {
      $now = Get-Date
      foreach ($j in $jobs) {
        if ($j.SubmittedTime) {
          $age = [int]($now - $j.SubmittedTime).TotalSeconds
          if ($age -gt $oldest) { $oldest = $age }
        }
      }
    }
  } catch {}
  Write-Output ("STATUS:" + $p.PrinterStatus + "|OFFLINE:" + $offline + "|JOBS:" + $count + "|OLDEST:" + $oldest)
} catch {
  Write-Output "NOT_FOUND"
}
`
  return new Promise((resolve) => {
    execFile(
      'powershell',
      ['-NoProfile', '-NonInteractive', '-Command', ps],
      { timeout: 4000 },
      (err, out) => {
        const id = `Windows:${name}`
        if (err) {
          return resolve({ ok: false, reason: 'No se pudo consultar el estado de la impresora en Windows', type: 'windows', identifier: id })
        }
        const result = String(out ?? '').trim()
        if (result === 'NOT_FOUND') {
          return resolve({ ok: false, reason: `Impresora "${name}" no encontrada en Windows`, type: 'windows', identifier: id })
        }
        const m = result.match(/^STATUS:([^|]+)\|OFFLINE:(True|False)\|JOBS:(\d+)\|OLDEST:(\d+)/i)
        if (!m) {
          return resolve({ ok: false, reason: result || 'Estado desconocido', type: 'windows', identifier: id })
        }
        const state    = m[1].trim()
        const offline  = m[2].toLowerCase() === 'true'
        const jobCount = parseInt(m[3], 10)
        const oldest   = parseInt(m[4], 10)
        if (offline) {
          return resolve({ ok: false, reason: 'Impresora marcada como "Sin conexion" — verifica que este encendida y conectada', type: 'windows', identifier: id, state })
        }
        if (WIN_BAD_STATUS.has(state)) {
          return resolve({ ok: false, reason: `Impresora en estado "${state}" — verifica que este encendida y conectada`, type: 'windows', identifier: id, state })
        }
        if (oldest >= STUCK_JOB_AGE_SECONDS) {
          return resolve({
            ok: false,
            reason: `Hay ${jobCount} trabajo${jobCount !== 1 ? 's' : ''} atorado${jobCount !== 1 ? 's' : ''} en la cola (${oldest}s sin imprimir). Verifica que la impresora esté encendida, con papel y conectada por USB; luego limpia la cola desde el panel de admin.`,
            type: 'windows',
            identifier: id,
            state,
          })
        }
        resolve({ ok: true, type: 'windows', identifier: id, state })
      }
    )
  })
}

// Limpia todos los trabajos pendientes de la impresora Windows configurada.
// Útil cuando la cola se atora porque la impresora física quedó apagada/desconectada.
export function clearWindowsQueue(name: string): Promise<{ removed: number }> {
  const escaped = name.replace(/'/g, "''")
  const ps = `
$ErrorActionPreference = 'Stop'
try {
  $jobs = @(Get-PrintJob -PrinterName '${escaped}' -ErrorAction SilentlyContinue)
  $count = $jobs.Count
  foreach ($j in $jobs) { try { Remove-PrintJob -InputObject $j -ErrorAction SilentlyContinue } catch {} }
  Write-Output ("REMOVED:" + $count)
} catch {
  Write-Output "ERROR"
}
`
  return new Promise((resolve, reject) => {
    execFile('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps], { timeout: 8000 }, (err, out) => {
      if (err) return reject(new Error(err.message))
      const result = String(out ?? '').trim()
      const m = result.match(/^REMOVED:(\d+)/)
      if (!m) return reject(new Error('No se pudo limpiar la cola'))
      resolve({ removed: parseInt(m[1], 10) })
    })
  })
}

export async function checkPrinterStatus(): Promise<PrinterStatus> {
  const type = process.env.PRINTER_TYPE ?? 'tcp'
  if (type === 'windows') {
    const name = process.env.PRINTER_NAME
    if (!name) return { ok: false, reason: 'PRINTER_NAME no configurado en .env', type: 'windows', identifier: '' }
    return checkWindowsReachable(name)
  }
  const host = process.env.PRINTER_HOST
  const port = parseInt(process.env.PRINTER_PORT ?? '9100')
  if (!host) return { ok: false, reason: 'PRINTER_HOST no configurado en .env', type: 'tcp', identifier: `:${port}` }
  return checkTCPReachable(host, port)
}

// ── Despacho según configuración .env ────────────────────────────────────────
async function sendToPrinter(data: Buffer): Promise<void> {
  // Pre-check obligatorio: si la impresora no esta lista, fallamos rapido
  // para que ningun trabajo se encole en la cola de Windows ni espere TCP timeout.
  const status = await checkPrinterStatus()
  if (!status.ok) {
    throw new Error(status.reason ?? 'Impresora no disponible')
  }

  const type = process.env.PRINTER_TYPE ?? 'tcp'
  if (type === 'windows') {
    return sendViaWindows(process.env.PRINTER_NAME!, data)
  }
  const host = process.env.PRINTER_HOST!
  const port = parseInt(process.env.PRINTER_PORT ?? '9100')
  return sendViaTCP(host, port, data)
}

export interface ReceiptData {
  receiptNumber: string
  date: string
  orderType: 'dine-in' | 'delivery'
  tableId?: number | null
  customerName?: string | null
  cashierName: string
  items: Array<{
    dishName: string
    quantity: number
    unitPrice: number
    modifiers: Array<{ optionName?: string | null; freeText?: string | null }>
  }>
  paymentMethod: 'cash' | 'yape' | 'plin'
  cashReceived?: number | null
  changeAmount?: number | null
  total: number
}

export async function printReceipt(data: ReceiptData): Promise<void> {
  const PAY = { cash: 'Efectivo', yape: 'Yape', plin: 'Plin' }

  const chunks: Buffer[] = [
    CMD.INIT,
    CMD.FEED3,
    CMD.ALIGN_CENTER,
    LOGO_CMD,
    Buffer.from([0x0A]),        // line feed after logo
    CMD.BOLD_ON, CMD.DOUBLE_ON,
    txt('CEVICHERIA MAUI\n'),
    CMD.DOUBLE_OFF, CMD.BOLD_OFF,
    txt('Tacna, Peru\n'),
    CMD.ALIGN_LEFT,
    divider(),
    row('Boleta:', data.receiptNumber),
    row('Fecha:', data.date),
    row(
      data.orderType === 'delivery' ? 'Cliente:' : 'Mesa:',
      data.orderType === 'delivery'
        ? (data.customerName ?? 'Delivery')
        : `Mesa ${data.tableId}`,
    ),
    row('Cajero:', data.cashierName),
    divider(),
  ]

  for (const item of data.items) {
    const itemTotal = `S/ ${(item.unitPrice * item.quantity).toFixed(2)}`
    const itemLabel = `${item.dishName} x${item.quantity}`
    chunks.push(row(itemLabel, itemTotal))
    for (const mod of item.modifiers) {
      if (mod.optionName) chunks.push(line(`  * ${mod.optionName}`))
      if (mod.freeText)   chunks.push(line(`  - ${mod.freeText}`))
    }
  }

  chunks.push(
    divider(),
    CMD.BOLD_ON,
    row('TOTAL:', `S/ ${data.total.toFixed(2)}`),
    CMD.BOLD_OFF,
    divider(),
    row('Pago:', PAY[data.paymentMethod]),
  )

  if (data.paymentMethod === 'cash') {
    chunks.push(
      row('Recibido:', `S/ ${(data.cashReceived ?? 0).toFixed(2)}`),
      CMD.BOLD_ON,
      row('Vuelto:', `S/ ${(data.changeAmount ?? 0).toFixed(2)}`),
      CMD.BOLD_OFF,
    )
  }

  chunks.push(
    divider(),
    CMD.ALIGN_CENTER,
    txt('!Gracias por su visita!\n'),
    txt('Vuelva pronto!\n'),
    CMD.FEED3,
    CMD.CUT,
  )

  await sendToPrinter(Buffer.concat(chunks))
}

// ── Pre-cuenta (no es boleta fiscal) ─────────────────────────────────────────
export interface PreReceiptData {
  date: string
  orderType: 'dine-in' | 'delivery'
  tableId?: number | null
  customerName?: string | null
  cashierName: string
  items: Array<{
    dishName: string
    quantity: number
    unitPrice: number
    modifiers: Array<{ optionName?: string | null; freeText?: string | null }>
  }>
  total: number
}

export async function printPreReceipt(data: PreReceiptData): Promise<void> {
  const chunks: Buffer[] = [
    CMD.INIT,
    CMD.FEED3,
    CMD.ALIGN_CENTER,
    LOGO_CMD,
    Buffer.from([0x0A]),
    CMD.BOLD_ON, CMD.DOUBLE_ON,
    txt('CEVICHERIA MAUI\n'),
    CMD.DOUBLE_OFF,
    txt('** PRE-CUENTA **\n'),
    CMD.BOLD_OFF,
    txt('Tacna, Peru\n'),
    CMD.ALIGN_LEFT,
    divider(),
    row('Fecha:', data.date),
    row(
      data.orderType === 'delivery' ? 'Cliente:' : 'Mesa:',
      data.orderType === 'delivery'
        ? (data.customerName ?? 'Delivery')
        : `Mesa ${data.tableId}`,
    ),
    row('Atiende:', data.cashierName),
    divider(),
  ]

  for (const item of data.items) {
    const itemTotal = `S/ ${(item.unitPrice * item.quantity).toFixed(2)}`
    const itemLabel = `${item.dishName} x${item.quantity}`
    chunks.push(row(itemLabel, itemTotal))
    for (const mod of item.modifiers) {
      if (mod.optionName) chunks.push(line(`  * ${mod.optionName}`))
      if (mod.freeText)   chunks.push(line(`  - ${mod.freeText}`))
    }
  }

  chunks.push(
    divider(),
    CMD.BOLD_ON, CMD.DOUBLE_ON,
    row('TOTAL:', `S/ ${data.total.toFixed(2)}`),
    CMD.DOUBLE_OFF, CMD.BOLD_OFF,
    divider(),
    CMD.ALIGN_CENTER,
    txt('Documento informativo\n'),
    txt('No es comprobante de pago\n'),
    CMD.FEED3,
    CMD.CUT,
  )

  await sendToPrinter(Buffer.concat(chunks))
}

// ── Comanda de cocina ────────────────────────────────────────────────────────
export interface KitchenTicketData {
  orderId: number
  orderType: 'dine-in' | 'delivery'
  tableId?: number | null
  customerName?: string | null
  waiterName: string
  date: string
  isAddition: boolean
  items: Array<{
    dishName: string
    quantity: number
    modifiers: Array<{ optionName?: string | null; freeText?: string | null }>
    notes?: string | null
  }>
}

export async function printKitchenTicket(data: KitchenTicketData): Promise<void> {
  const headerLabel = data.orderType === 'delivery'
    ? 'DELIVERY'
    : `MESA ${data.tableId}`

  const chunks: Buffer[] = [
    CMD.INIT,
    CMD.FEED3,
    CMD.ALIGN_CENTER,
    CMD.BOLD_ON, CMD.DOUBLE_ON,
    txt(`${headerLabel}\n`),
    CMD.DOUBLE_OFF, CMD.BOLD_OFF,
    data.isAddition
      ? Buffer.concat([CMD.BOLD_ON, txt('++ ITEMS AGREGADOS ++\n'), CMD.BOLD_OFF])
      : txt('-- COMANDA NUEVA --\n'),
    CMD.ALIGN_LEFT,
    divider(),
    row(`Pedido #${String(data.orderId).padStart(4, '0')}`, data.date),
    row('Mozo:', data.waiterName),
  ]

  if (data.orderType === 'delivery' && data.customerName) {
    chunks.push(row('Cliente:', data.customerName))
  }

  chunks.push(divider())

  for (const item of data.items) {
    chunks.push(
      CMD.BOLD_ON, CMD.DOUBLE_ON,
      txt(`x${item.quantity}  ${sanitize(item.dishName)}\n`),
      CMD.DOUBLE_OFF, CMD.BOLD_OFF,
    )
    for (const mod of item.modifiers) {
      if (mod.optionName) chunks.push(line(`   * ${mod.optionName}`))
      if (mod.freeText)   chunks.push(line(`   - ${mod.freeText}`))
    }
    if (item.notes) {
      chunks.push(
        CMD.BOLD_ON,
        line(`   ! ${item.notes}`),
        CMD.BOLD_OFF,
      )
    }
    chunks.push(Buffer.from([0x0A]))
  }

  chunks.push(
    divider(),
    CMD.FEED3,
    CMD.CUT,
  )

  await sendToPrinter(Buffer.concat(chunks))
}

export async function printTestPage(): Promise<void> {
  const now = new Date().toLocaleString('es-PE')

  const data = Buffer.concat([
    CMD.INIT,
    CMD.FEED3,
    CMD.ALIGN_CENTER,
    CMD.BOLD_ON,
    txt('MauiDesk - Prueba de Impresora\n'),
    CMD.BOLD_OFF,
    txt(`Fecha: ${sanitize(now)}\n`),
    divider(),
    txt('Impresora conectada correctamente!\n'),
    CMD.FEED3,
    CMD.CUT,
  ])

  await sendToPrinter(data)
}
