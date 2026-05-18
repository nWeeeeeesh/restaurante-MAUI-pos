// node scripts/convert-logo.mjs
// Usa GS v 0 (raster, 203x203 DPI) — sin distorsión de aspecto
import Jimp from 'jimp'
import { writeFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const INPUT  = resolve(__dirname, '../../client/src/assets/Logo.jpg')
const OUTPUT = resolve(__dirname, '../src/utils/logo_bitmap.ts')

const LOGO_WIDTH     = 300   // dots — ~37mm (calidad óptima para 80mm de papel)
const PRINTER_BYTES  = 72    // 576 dots / 8 = 72 bytes por fila (papel 80mm)

async function main() {
  const img = await Jimp.read(INPUT)

  img.resize(LOGO_WIDTH, Jimp.AUTO)
  img.contrast(0.4)

  const W = img.getWidth()
  const H = img.getHeight()
  console.log(`Imagen: ${W}x${H} px`)

  const bytesPerRow  = Math.ceil(W / 8)
  const padBytesLeft = Math.floor((PRINTER_BYTES - bytesPerRow) / 2)
  const padBytesRight = PRINTER_BYTES - bytesPerRow - padBytesLeft

  if (padBytesLeft < 0) {
    console.error(`Logo demasiado ancho: ${bytesPerRow} bytes/fila > ${PRINTER_BYTES}. Reduce LOGO_WIDTH.`)
    process.exit(1)
  }

  const xL = PRINTER_BYTES & 0xFF
  const xH = (PRINTER_BYTES >> 8) & 0xFF
  const yL = H & 0xFF
  const yH = (H >> 8) & 0xFF

  // GS v 0 header
  const cmd = [0x1D, 0x76, 0x30, 0x00, xL, xH, yL, yH]

  for (let y = 0; y < H; y++) {
    // padding izquierdo
    for (let i = 0; i < padBytesLeft; i++) cmd.push(0x00)

    // datos de imagen — fila por fila, MSB = pixel izquierdo
    for (let bx = 0; bx < bytesPerRow; bx++) {
      let byte = 0
      for (let bit = 0; bit < 8; bit++) {
        const x = bx * 8 + bit
        if (x < W) {
          const { r, g, b } = Jimp.intToRGBA(img.getPixelColor(x, y))
          const isBackground = r > 215 && g > 215 && b > 215
          if (!isBackground) byte |= (0x80 >> bit)
        }
      }
      cmd.push(byte)
    }

    // padding derecho
    for (let i = 0; i < padBytesRight; i++) cmd.push(0x00)
  }

  const ts = `// Auto-generado — no editar. Origen: Logo.jpg | ${W}x${H}px | GS v 0 | 203 DPI
export const LOGO_CMD = Buffer.from([
  ${cmd.join(', ')}
])
`
  writeFileSync(OUTPUT, ts, 'utf8')
  console.log(`✓ logo_bitmap.ts: ${cmd.length} bytes (${W}x${H}px centrado en ${PRINTER_BYTES*8} dots)`)
}

main().catch(e => { console.error(e); process.exit(1) })
