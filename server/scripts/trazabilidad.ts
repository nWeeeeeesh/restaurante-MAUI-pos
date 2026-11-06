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

// Requisitos de la tesis. Los nombres vienen de plan-sistema y de CLAUDE.md; `manual`
// indica cómo se acepta cuando no hay prueba automática.
const RF: [string, string, string?][] = [
  ['RF01', 'Registro de la «Compra del día» (incremento 1)', 'PA-01'],
  ['RF02', '«Hoy no compré»'],
  ['RF03', 'Registro del incremento 1', 'PA-01'],
  ['RF04', 'Registro del incremento 1', 'PA-01'],
  ['RF05', 'Traslados entre locales'],
  ['RF06', 'Tipo de gasto fijo o variable'],
  ['RF07', 'Exportación del dataset'],
  ['RF08', 'Recetas en gramos limpios y unidad de compra'],
  ['RF09', 'Calibración de recetas (F12)'],
  ['RF10', 'Costo promedio ponderado (F8)'],
  ['RF11', 'Costo y margen por plato (F13, F14)'],
  ['RF12', 'Rentabilidad operativa del periodo (F9, F10, F11, F15)'],
  ['RF13', 'Ingeniería de menú'],
  ['RF14', 'Totales trazables a los registros'],
  ['RF15', 'Stock teórico (F6)'],
  ['RF16', 'Pronóstico de demanda (F4, F5, métodos y selección)'],
  ['RF17', 'Cantidad sugerida y lista de compra (F2)'],
  ['RF18', 'Aviso de pocas porciones'],
  ['RF19', 'Propuesta de agotado confirmada por una persona'],
]
const RNF: [string, string, string?][] = [
  ['RNF01', '—', 'PA (revisión manual, T20)'],
  ['RNF02', 'Ayuda de una línea en cada campo de captura', 'Revisión de pantallas (T20)'],
  ['RNF03', '—', 'PA (revisión manual, T20)'],
  ['RNF04', '—', 'PA (revisión manual, T20)'],
  ['RNF05', '—', 'PA (revisión manual, T20)'],
  ['RNF06', 'Permisos por rol (401 / 403)'],
  ['RNF07', 'Esquema solo aditivo'],
  ['RNF08', '—', 'PA (revisión manual, T20)'],
  ['RNF09', 'Tiempos de respuesta', 'PA-07 en la Raspberry Pi'],
  ['RNF10', '—', 'PA (revisión manual, T20)'],
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

Los requisitos del incremento 1 sin etiqueta (RF01, RF03, RF04) tienen pruebas en \`inventory.daily.test.ts\`, \`inventory.test.ts\` y \`inventory.transfers.test.ts\`, pero sin el ID en el nombre, porque el repositorio no define a qué corresponde cada uno. Al ponerles la etiqueta, este informe los cuenta.

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
