// npm run report:tesis — evidencias para el Capítulo IV (plan-sistema T22). Ejecuta
// Vitest con el reporter JSON, agrupa las pruebas por las etiquetas de su nombre
// ([RFxx], [RNFxx], [RDxx], [PU-xx], [PI-xx], [PP-xx]) y escribe docs/tesis/evidencias.md
// con la matriz requisito → pruebas → estado, los totales por nivel, el rendimiento y
// los requisitos sin prueba.
import { spawnSync } from 'child_process'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'

const SERVER = path.join(__dirname, '..')
const DOCS = path.join(SERVER, '..', 'docs', 'tesis')
const OUT = path.join(DOCS, 'evidencias.md')

// Requisitos de la tesis: Tablas 10 y 11, con sus textos. `manual` indica dónde se
// verifican los que no tienen prueba automática (docs/tesis/aceptacion.md).
const RF: [string, string, string?][] = [
  ['RF01', 'Registrar al abrir, por insumo crítico, lo que quedaba y lo que se botó, con las notas del día'],
  ['RF02', 'Registrar al volver de comprar lo comprado y su precio por kg, o «Hoy no compré»'],
  ['RF03', 'Registrar el monto diario de otros insumos'],
  ['RF04', 'Registrar lo enviado al otro local y lo recibido (traslados)'],
  ['RF05', 'Marcar y desmarcar un plato como agotado desde el POS, con autor y hora'],
  ['RF06', 'Configurar por insumo la vida útil y el nivel de servicio, y clasificar los gastos en fijos y variables'],
  ['RF07', 'Exportar los datos con columnas fijas y diccionario'],
  ['RF08', 'Registrar las recetas (gramos limpios por porción) y el rendimiento de cada insumo'],
  ['RF09', 'Calcular el factor de calibración de cada insumo'],
  ['RF10', 'Calcular el costo promedio ponderado con cada compra'],
  ['RF11', 'Calcular el costo y el margen de contribución de cada plato'],
  ['RF12', 'Calcular por día, semana y mes el costo de lo vendido, food cost, utilidad bruta y operativa, merma y punto de equilibrio'],
  ['RF13', 'Clasificar los platos según la ingeniería de menú'],
  ['RF14', 'Mostrar el panel de rentabilidad con los indicadores de RF11 a RF13'],
  ['RF15', 'Calcular el stock teórico de cada insumo durante el día'],
  ['RF16', 'Pronosticar cada noche la demanda diaria de los insumos críticos y guardarla'],
  ['RF17', 'Mostrar e imprimir la lista de compra para los días que cubrirá la compra'],
  ['RF18', 'Avisar en el POS cuando queden pocas porciones de un plato'],
  ['RF19', 'Proponer marcar un plato como agotado, sin marcarlo hasta que una persona lo confirme'],
]
const RNF: [string, string, string?][] = [
  ['RNF01', 'Cada parte del registro se completa en 60 s o menos desde un celular', 'PA-01'],
  ['RNF02', 'Cada campo tiene una ayuda de una línea', 'revisión de pantallas'],
  ['RNF03', 'Opera sin internet dentro de la red local', 'PA-08'],
  ['RNF04', 'Cada guardado es atómico; volver a guardar una parte la reemplaza sin duplicarla'],
  ['RNF05', 'Respaldo diario con restauración probada', 'PA-08 (restauración del respaldo)'],
  ['RNF06', 'Cada función exige su rol y cada cambio queda en la auditoría'],
  ['RNF07', 'Cambios al esquema solo aditivos; cada regla con prueba automatizada'],
  ['RNF08', 'Un nuevo local se instala con la misma versión y su propio identificador', 'instalación con instalar.sh (DEPLOYMENT.md)'],
  ['RNF09', 'Panel de un mes ≤ 3 s en la Raspberry Pi; tarea nocturna antes de la apertura'],
  ['RNF10', 'Funciona en el navegador del celular y comparte el servidor con el POS sin afectarlo', 'PA-08'],
]
const RD: [string, string, string?][] = [
  ['RD01', 'La «Compra del día» nunca muestra el pronóstico'],
  ['RD02', 'Un plato solo queda agotado cuando lo confirma una persona'],
  ['RD03', 'No está definida en el repositorio', 'según la tesis'],
  ['RD04', 'Un pronóstico guardado no se modifica'],
  ['RD05', 'Dataset versionado y documentado'],
  ['RD06', 'Cada registro nuevo lleva local_id'],
]

interface Prueba { archivo: string; nombre: string; estado: string; etiquetas: string[] }

function correrVitest(): Prueba[] {
  const tmp = path.join(os.tmpdir(), `vitest-trazabilidad-${Date.now()}.json`)
  // Un solo comando de texto: npx necesita la shell en Windows
  const r = spawnSync(`npx vitest run --reporter=json --outputFile="${tmp}"`, { cwd: SERVER, shell: true, stdio: 'ignore' })
  if (!fs.existsSync(tmp)) throw new Error(`Vitest no dejó el reporte (código ${r.status})`)
  const json = JSON.parse(fs.readFileSync(tmp, 'utf-8')) as {
    testResults: { name: string; assertionResults: { ancestorTitles: string[]; title: string; status: string }[] }[]
  }
  fs.rmSync(tmp)
  const out: Prueba[] = []
  for (const f of json.testResults) {
    for (const a of f.assertionResults) {
      const nombre = [...a.ancestorTitles, a.title].join(' › ')
      const etiquetas = [...new Set([...nombre.matchAll(/\[((?:RNF|RF|RD)\d{2}|P[UIP]-\d{2})\]/g)].map(m => m[1]))]
      out.push({ archivo: path.relative(path.join(SERVER, 'src', '__tests__'), f.name).replace(/\\/g, '/'), nombre, estado: a.status, etiquetas })
    }
  }
  return out
}

const icono = (ps: Prueba[]) => (ps.length === 0 ? '—' : ps.every(p => p.estado === 'passed') ? '✅ en verde' : '❌ con fallos')

function matriz(titulo: string, reqs: [string, string, string?][], pruebas: Prueba[]) {
  const lines = [`### ${titulo}`, '', '| Requisito | Descripción | Pruebas | Estado | Si no hay prueba |', '|---|---|---|---|---|']
  for (const [id, desc, manual] of reqs) {
    const ps = pruebas.filter(p => p.etiquetas.includes(id))
    const casos = [...new Set(ps.flatMap(p => p.etiquetas.filter(e => /^P[UIP]-/.test(e))))].sort()
    const detalle = ps.length === 0 ? '—' : `${ps.length}${casos.length ? ` (${casos.join(', ')})` : ''}`
    lines.push(`| ${id} | ${desc} | ${detalle} | ${icono(ps)} | ${ps.length === 0 ? (manual ? `Aceptación manual: ${manual}` : '**Sin prueba**') : ''} |`)
  }
  return lines.join('\n')
}

function main() {
  const pruebas = correrVitest()
  const total = pruebas.length
  const verdes = pruebas.filter(p => p.estado === 'passed').length
  const unit = pruebas.filter(p => p.archivo.startsWith('domain.')).length
  const paridad = pruebas.filter(p => p.etiquetas.some(e => e.startsWith('PP-'))).length
  const casos = (pref: string) => [...new Set(pruebas.flatMap(p => p.etiquetas.filter(e => e.startsWith(pref))))].sort()

  const rend = fs.existsSync(path.join(DOCS, 'rendimiento.json')) ? JSON.parse(fs.readFileSync(path.join(DOCS, 'rendimiento.json'), 'utf-8')) : null
  const filasRend: string[] = []
  for (const inc of ['incremento2', 'incremento3']) {
    for (const [k, v] of Object.entries((rend?.[inc] ?? {}) as Record<string, { medianaMs: number; p95Ms: number; limiteMs: number; cumple: boolean; repeticiones: number }>)) {
      filasRend.push(`| ${inc === 'incremento2' ? '2' : '3'} | ${k} | ${v.repeticiones} | ${v.medianaMs} | ${v.p95Ms} | ${v.limiteMs} | ${v.cumple ? '✅' : '❌'} |`)
    }
  }

  const sinPrueba = [...RF, ...RNF].filter(([id]) => !pruebas.some(p => p.etiquetas.includes(id)))
  const md = `# Evidencias para el Capítulo IV

> Generado por \`npm run report:tesis\` (\`server/scripts/trazabilidad.ts\`) el ${new Date().toISOString().slice(0, 10)}. No editar a mano: se regenera desde las pruebas (Vitest), \`docs/tesis/rendimiento.json\` y la lista de requisitos del script.

## 1. Resumen

| | Cantidad |
|---|---|
| Pruebas automáticas | ${total} (${verdes} en verde${total - verdes ? `, **${total - verdes} con fallos u omitidas**` : ''}) |
| Unitarias (\`domain.*.test.ts\`: fórmulas puras) | ${unit} |
| Integración (servicios, API HTTP, migraciones) | ${total - unit - paridad} |
| Paridad con la referencia en Python (\`[PP-xx]\`) | ${paridad} |
| Casos unitarios de la tesis cubiertos | ${casos('PU-').length} de 18 (${casos('PU-').join(', ')}) |
| Casos de integración | ${casos('PI-').join(', ')} |
| Casos de paridad | ${casos('PP-').join(', ')} |

Los casos PU-01 a PU-18 también corren en Python sobre la implementación de referencia (\`python scripts/tesis/pruebas_pu.py\`).

## 2. Matriz requisito → pruebas → estado

${matriz('Requisitos funcionales (19)', RF, pruebas)}

${matriz('Requisitos no funcionales (10)', RNF, pruebas)}

${matriz('Reglas de diseño', RD, pruebas)}

## 3. Rendimiento (RNF09)

Equipo: ${rend?.equipo ? `${rend.equipo.cpu.trim()}, ${rend.equipo.nucleos} núcleos, ${rend.equipo.plataforma}, Node ${rend.equipo.node}` : '—'}. Datos: ${rend?.datos ?? '—'}. Medido: ${rend?.medidoEn ?? '—'}.

| Incremento | Operación | Repeticiones | Mediana (ms) | p95 (ms) | Límite (ms) | Cumple |
|---|---|---|---|---|---|---|
${filasRend.join('\n') || '| — | Sin mediciones: corre `npm run perf` | | | | | |'}

La medición en la Raspberry Pi es la prueba de aceptación PA-07 ([aceptacion.md](aceptacion.md)).

## 4. Requisitos sin prueba automática

${sinPrueba.length === 0 ? 'Ninguno.' : sinPrueba.map(([id, d, m]) => `- **${id}** (${d}): ${m ? `se acepta de forma manual (${m}).` : '**sin prueba ni aceptación manual definida.**'}`).join('\n')}

## 5. Pruebas por archivo

| Archivo | Pruebas | En verde |
|---|---|---|
${[...new Set(pruebas.map(p => p.archivo))].sort().map(f => {
    const ps = pruebas.filter(p => p.archivo === f)
    return `| \`${f}\` | ${ps.length} | ${ps.filter(p => p.estado === 'passed').length} |`
  }).join('\n')}
`
  fs.writeFileSync(OUT, md)
  console.log(`report:tesis: ${total} pruebas (${verdes} en verde) → ${path.relative(path.join(SERVER, '..'), OUT)}`)
  const rfSinNada = RF.filter(([id, , m]) => !m && !pruebas.some(p => p.etiquetas.includes(id)))
  if (verdes !== total || rfSinNada.length > 0) {
    console.error(`report:tesis: ${total - verdes} pruebas no están en verde; RF sin prueba ni aceptación manual: ${rfSinNada.map(r => r[0]).join(', ') || 'ninguno'}`)
    process.exit(2)
  }
}

main()
