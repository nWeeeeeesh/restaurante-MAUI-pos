// npm run db:recetas -- [--csv <ruta>] [--reemplazar] [--dry-run]
//
// Carga las recetas aproximadas (gramos limpios por porción de cada insumo crítico) en
// la base de DATABASE_URL (server/.env). La lógica está en
// src/services/recipes-import.service.ts. Nunca crea platos: al final lista los que no
// encontró. Por defecto no toca un plato que ya tenga receta.
//   --csv <ruta>    otro archivo (por defecto server/data/recetas_aproximadas.csv)
//   --reemplazar    sobrescribe la receta de los platos que ya tienen una
//   --dry-run       solo informa lo que haría; no escribe nada
import * as fs from 'fs'
import * as path from 'path'

const AYUDA = `Uso: npm run db:recetas -- [--csv <ruta>] [--reemplazar] [--dry-run]

  --csv <ruta>    CSV con plato, variante y <insumo>_g (por defecto server/data/recetas_aproximadas.csv)
  --reemplazar    sobrescribe la receta de los platos que ya tienen una
  --dry-run       solo informa lo que haría; no escribe nada`

async function main() {
  const args = process.argv.slice(2)
  if (args.includes('--help') || args.includes('-h')) { console.log(AYUDA); return }
  let csv = path.join(__dirname, '..', 'data', 'recetas_aproximadas.csv')
  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    if (a === '--csv') {
      if (!args[i + 1]) throw new Error('--csv necesita una ruta')
      csv = path.resolve(args[++i])
    } else if (a !== '--reemplazar' && a !== '--dry-run') {
      throw new Error(`Opción desconocida: ${a}\n\n${AYUDA}`)
    }
  }
  const reemplazar = args.includes('--reemplazar')
  const dryRun = args.includes('--dry-run')
  if (!fs.existsSync(csv)) throw new Error(`No existe el archivo ${csv}`)

  const { db } = await import('../src/db')
  const { importarRecetas } = await import('../src/services/recipes-import.service')
  console.log(`db:recetas: ${path.relative(process.cwd(), csv) || csv} → ${process.env.DATABASE_URL || 'file:./mauidisk.db'}${dryRun ? ' (dry-run: no escribe nada)' : ''}`)
  const r = await importarRecetas(db, fs.readFileSync(csv, 'utf-8'), { reemplazar, dryRun })

  const verbo = dryRun ? 'Cargaría' : 'Cargó'
  console.log(`\n${verbo} ${r.cargados.length} platos (${r.cargados.reduce((s, c) => s + c.items, 0)} filas de receta) de ${r.filas} filas del CSV.`)
  for (const c of r.cargados) {
    const v = c.variantes.map(x => x || 'base').join(', ')
    console.log(`  ${c.reemplazado ? '↻' : '+'} ${c.plato} [${v}] — ${c.items} insumos${c.reemplazado ? ' (reemplaza la receta anterior)' : ''}`)
  }
  if (r.conReceta.length) {
    console.log(`\nYa tenían receta y no se tocaron (${r.conReceta.length}; usa --reemplazar para sobrescribirlas):`)
    for (const p of r.conReceta) console.log(`  = ${p}`)
  }
  for (const o of r.insumosOmitidos) {
    console.log(`\nColumna ${o.codigo.toLowerCase()}_g omitida: ${o.motivo === 'no_critico' ? `${o.codigo} no es un insumo crítico (la receta solo lleva críticos)` : `no hay un insumo con código ${o.codigo}`}; ${o.valores} filas tenían gramos.`)
  }
  if (r.otrosInsumosSinCargar) {
    console.log(`\notros_insumos_S no se carga (${r.otrosInsumosSinCargar} filas): el costo del plato usa los otros insumos del día por sol vendido.`)
  }
  if (r.sinGramos.length) {
    console.log(`\nSin gramos de insumos críticos (${r.sinGramos.length}):`)
    for (const p of r.sinGramos) console.log(`  · ${p}`)
  }
  if (r.errores.length) {
    console.log(`\nFilas con errores (${r.errores.length}):`)
    for (const e of r.errores) console.log(`  ! ${e}`)
  }
  console.log(`\nPlatos no encontrados (${r.noEncontrados.length})${r.noEncontrados.length ? ':' : '.'}`)
  for (const p of r.noEncontrados) console.log(`  ? ${p}`)
}

main().then(() => process.exit(0)).catch(err => {
  console.error(`db:recetas: ${err instanceof Error ? err.message : err}`)
  process.exit(1)
})
