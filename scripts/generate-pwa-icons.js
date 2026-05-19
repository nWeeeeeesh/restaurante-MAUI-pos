// Genera los iconos PWA (icon-192.png e icon-512.png) a partir del logo de
// la cevicheria. Los iconos PWA con purpose "maskable" requieren ~20% de
// padding alrededor del contenido principal para que Android pueda recortarlos
// en circulos/squircles sin cortar el logo.
//
// Uso: node scripts/generate-pwa-icons.js
//
// Reutilizamos jimp porque ya esta instalado en server/ para el bitmap de
// boletas — no agregamos dependencias.

const path = require('path')
const Jimp = require('jimp')

const PROJECT_ROOT = path.resolve(__dirname, '..')
const LOGO_SRC = path.join(PROJECT_ROOT, 'client', 'src', 'assets', 'Logo.jpg')
const OUT_DIR  = path.join(PROJECT_ROOT, 'client', 'public')

// Color de fondo de la manifest (theme bg). Hex 0xEEF3F8FF (RRGGBBAA).
const BG = 0xEEF3F8FF

// Maskable safe zone: el contenido debe quedar dentro del 80% central.
const SAFE_ZONE = 0.80

async function generate(size, outFile) {
  const logo = await Jimp.read(LOGO_SRC)
  const target = Math.round(size * SAFE_ZONE)
  logo.resize(target, target)

  const canvas = await new Jimp(size, size, BG)
  const offset = Math.round((size - target) / 2)
  canvas.composite(logo, offset, offset)

  await canvas.writeAsync(outFile)
  console.log(`  -> ${path.relative(PROJECT_ROOT, outFile)} (${size}x${size})`)
}

;(async () => {
  console.log('Generando iconos PWA desde:', path.relative(PROJECT_ROOT, LOGO_SRC))
  await generate(192, path.join(OUT_DIR, 'icon-192.png'))
  await generate(512, path.join(OUT_DIR, 'icon-512.png'))
  console.log('Listo.')
})().catch(err => {
  console.error('Error generando iconos:', err)
  process.exit(1)
})
