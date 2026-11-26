import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import bcrypt from 'bcryptjs'
import { eq } from 'drizzle-orm'
import * as fs from 'fs'
import * as net from 'net'
import * as os from 'os'
import * as path from 'path'
import { spawnSync } from 'child_process'
import { setupHttpApp } from './helpers/http'
import { errorModoPruebas, escribirJson, fechaLocal, leerJson, rutaDev } from '../dev/modo'
import { CABECERA_RECURSOS, cpuPct, discoDe, muestra, potenciaDe, tiemposCpu, type Fuentes } from '../dev/sistema'
import { registrarRecursos } from '../dev/registro'
import { iniciarImpresoraSimulada, tipoDeTrabajo } from '../dev/impresora'
import { planSim12, percentil } from '../dev/jornada-plan'
import { proximaJornada } from '../dev/jornada'
import { entornoPruebas, totalesVitest } from '../dev/pruebas'
import { respaldos, type EstadoRecuperacion } from '../dev/recuperacion'
import { iniciarTrabajo } from '../dev/trabajos'
import type { Programacion } from '../dev/jornada'
import {
  iniciarTodoEnUno, momentoRecuperacion, planTodo, reanudarTodoEnUno, reintentarDesde, type Dependencias, type PlanTodo,
} from '../dev/todo-en-uno'
import { addDaysIso } from '../domain/calendar'
import {
  almacenamiento, calcularResultados, fechasDeRclone, nochesDelPeriodo, periodoPorDefecto, RUTA_PLANTILLA, resumenMd, soVersion,
  validarContraPlantilla,
} from '../dev/descarga'

// Perfil de desarrollador y modo de pruebas (tarea de despliegue, bloque C), con /proc
// y vcgencmd simulados
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'maui-dev-test-'))
const RAIZ = path.join(TMP, 'raiz')
process.env.MAUI_DEV_DIR = path.join(TMP, 'dev')
const MODO_ANTES = process.env.MAUI_MODO_PRUEBAS

function escribir(rel: string, contenido: string, raiz = RAIZ) {
  const f = path.join(raiz, rel)
  fs.mkdirSync(path.dirname(f), { recursive: true })
  fs.writeFileSync(f, contenido)
}

// Una Raspberry Pi 5 de mentira: /proc, /sys, /etc y vcgencmd
const VCGENCMD = path.join(TMP, 'vcgencmd.js')
const FUENTES: Fuentes = { raiz: RAIZ, vcgencmd: [process.execPath, VCGENCMD] }
function piSimulada(idle: number, total: number, escritos: number) {
  const resto = total - idle
  escribir('proc/stat', `cpu  ${resto} 0 0 ${idle} 0 0 0 0 0 0\ncpu0 1 2 3 4\n`)
  escribir('proc/meminfo', 'MemTotal:        8245000 kB\nMemFree:          100000 kB\nMemAvailable:    6291456 kB\n')
  escribir('sys/class/thermal/thermal_zone0/temp', '52350\n')
  escribir('proc/self/mountinfo', '22 1 179:2 / / rw,noatime shared:1 - ext4 /dev/mmcblk0p2 rw\n25 22 179:1 / /boot/firmware rw - vfat /dev/mmcblk0p1 rw\n')
  escribir('proc/diskstats', ` 179       0 mmcblk0 100 0 2000 50 300 0 ${escritos} 900 0 0 0\n 179       2 mmcblk0p2 90 0 1800 40 280 0 ${escritos - 10} 800 0 0 0\n`)
  escribir('proc/uptime', '23.71 80.12\n')
  escribir('etc/os-release', 'PRETTY_NAME="Debian GNU/Linux 13 (trixie)"\nNAME="Debian GNU/Linux"\nVERSION_ID="13"\nID=debian\n')
  escribir('proc/sys/kernel/osrelease', '6.12.47+rpt-rpi-2712\n')
  escribir('sys/block/mmcblk0/size', '124735488\n')
  escribir('sys/block/mmcblk0/device/manfid', '0x000003\n')
}

beforeAll(() => {
  fs.writeFileSync(VCGENCMD, `const a = process.argv[2]
if (a === 'get_throttled') console.log('throttled=0x50000')
else if (a === 'pmic_read_adc') console.log([
  ' 3V7_WL_SW_A current(0)=0.10000000A', ' 3V3_SYS_A current(1)=0.50000000A', ' VDD_CORE_A current(7)=2.00000000A',
  ' 3V7_WL_SW_V volt(8)=3.70000000V', ' 3V3_SYS_V volt(9)=3.30000000V', ' VDD_CORE_V volt(15)=0.80000000V', ' EXT5V_V volt(24)=5.10000000V',
].join('\\n'))
else process.exit(1)
`)
  piSimulada(1000, 2000, 5000)
})

afterAll(() => {
  if (MODO_ANTES === undefined) delete process.env.MAUI_MODO_PRUEBAS
  else process.env.MAUI_MODO_PRUEBAS = MODO_ANTES
  fs.rmSync(TMP, { recursive: true, force: true })
})

describe('[RNF06] /api/dev y el rol developer', () => {
  let ctx: Awaited<ReturnType<typeof setupHttpApp>>
  const roles = ['owner', 'manager', 'cashier', 'waiter'] as const
  let auth: Record<string, string>

  beforeAll(async () => {
    ctx = await setupHttpApp()
    auth = {}
    for (const r of [...roles, 'developer'] as const) auth[r] = (await ctx.as(r)).auth
    await ctx.db.insert(ctx.schema.users).values({ name: 'Desarrollador', username: 'dev1', passwordHash: await bcrypt.hash('clave-dev-123', 4), role: 'developer' })
  })

  it('sin MAUI_MODO_PRUEBAS, /api/dev/* da 404 y el developer no entra', async () => {
    process.env.MAUI_MODO_PRUEBAS = '0'
    expect((await request(ctx.app).get('/api/dev/estado')).status).toBe(404)
    for (const a of Object.values(auth)) {
      expect((await request(ctx.app).get('/api/dev/estado').set('Authorization', a)).status).toBe(404)
      expect((await request(ctx.app).post('/api/dev/medir').set('Authorization', a)).status).toBe(404)
    }
    expect((await request(ctx.app).post('/api/auth/login').send({ username: 'dev1', password: 'clave-dev-123' })).status).toBe(401)
    // Un token de antes deja de valer
    expect((await request(ctx.app).get('/api/auth/me').set('Authorization', auth.developer)).status).toBe(401)
  })

  it('con modo de pruebas, los demás roles reciben 403 y el developer entra', async () => {
    process.env.MAUI_MODO_PRUEBAS = '1'
    expect((await request(ctx.app).get('/api/dev/estado')).status).toBe(401)
    for (const r of roles) {
      expect((await request(ctx.app).get('/api/dev/estado').set('Authorization', auth[r])).status).toBe(403)
      expect((await request(ctx.app).post('/api/dev/permisos').set('Authorization', auth[r])).status).toBe(403)
      expect((await request(ctx.app).get('/api/dev/descargar').set('Authorization', auth[r])).status).toBe(403)
    }
    const login = await request(ctx.app).post('/api/auth/login').send({ username: 'dev1', password: 'clave-dev-123' })
    expect(login.status).toBe(200)
    expect(login.body.user.role).toBe('developer')
    const estado = await request(ctx.app).get('/api/dev/estado').set('Authorization', auth.developer)
    expect(estado.status).toBe(200)
    expect(estado.body.arranques).toEqual({ hechos: 0, de: 5 })
    expect(estado.body.periodo).toEqual(periodoPorDefecto())
    // «Todo en uno» pide confirmación
    expect((await request(ctx.app).post('/api/dev/todo-en-uno').set('Authorization', auth.developer).send({})).status).toBe(400)
    expect((await request(ctx.app).post('/api/dev/todo-en-uno').set('Authorization', auth.manager).send({ confirmar: true })).status).toBe(403)
  })

  it('no aparece en Usuarios ni en la auditoría del negocio, pero sus acciones quedan en audit_log', async () => {
    process.env.MAUI_MODO_PRUEBAS = '1'
    const put = await request(ctx.app).put('/api/dev/equipo').set('Authorization', auth.developer).send({ refrigeracion: 'Caja oficial con ventilador' })
    expect(put.status).toBe(200)
    const lista = await request(ctx.app).get('/api/users').set('Authorization', auth.owner)
    expect(lista.body.some((u: { role: string }) => u.role === 'developer')).toBe(false)
    const auditoria = await request(ctx.app).get('/api/reports/audit?period=today').set('Authorization', auth.owner)
    expect(auditoria.body.some((a: { action: string }) => a.action.startsWith('dev.'))).toBe(false)
    const filas = await ctx.db.select().from(ctx.schema.auditLog)
    expect(filas.some(a => a.action === 'dev.equipo')).toBe(true)
  })

  it('PATCH y cambio de contraseña de un developer: 404 para el dueño', async () => {
    const [d] = await ctx.db.select().from(ctx.schema.users).where(eq(ctx.schema.users.username, 'dev1'))
    expect((await request(ctx.app).patch(`/api/users/${d.id}`).set('Authorization', auth.owner).send({ active: false })).status).toBe(404)
    expect((await request(ctx.app).post(`/api/users/${d.id}/password`).set('Authorization', auth.owner).send({ password: 'otra-clave-123' })).status).toBe(404)
  })
})

describe('modo de pruebas: nunca se abre ni se crea mauidisk.db', () => {
  it('la guardia exige una base -sim.db', () => {
    expect(errorModoPruebas({ MAUI_MODO_PRUEBAS: '1' })).toMatch(/-sim\.db/)
    expect(errorModoPruebas({ MAUI_MODO_PRUEBAS: '1', DATABASE_URL: 'file:./mauidisk.db' })).toMatch(/-sim\.db/)
    expect(errorModoPruebas({ MAUI_MODO_PRUEBAS: '1', DATABASE_URL: 'file:./mauidisk-sim.db' })).toBeNull()
    expect(errorModoPruebas({ DATABASE_URL: 'file:./mauidisk.db' })).toBeNull()
  })

  it('el servidor no arranca sin la base simulada y no deja mauidisk.db', () => {
    const dir = path.join(TMP, 'arranque')
    fs.mkdirSync(dir, { recursive: true })
    const src = path.join(__dirname, '..').replace(/\\/g, '/')
    fs.writeFileSync(path.join(dir, 'probar.ts'), `import '${src}/dev/guardia'\nimport { db } from '${src}/db'\nvoid db\nconsole.log('abrió la base')\nprocess.exit(0)\n`)
    const tsx = path.join(__dirname, '..', '..', 'node_modules', 'tsx', 'dist', 'cli.mjs')
    const correr = (env: NodeJS.ProcessEnv) => spawnSync(process.execPath, [tsx, 'probar.ts'], { cwd: dir, env, encoding: 'utf-8', timeout: 20_000 })
    const base = { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, MAUI_MODO_PRUEBAS: '1' }
    const sin = correr(base)
    expect(sin.status).toBe(1)
    expect(sin.stderr).toMatch(/-sim\.db/)
    const con = correr({ ...base, DATABASE_URL: 'file:./prueba-sim.db' })
    expect(con.status).toBe(0)
    expect(fs.existsSync(path.join(dir, 'mauidisk.db'))).toBe(false)
  }, 30_000)
})

describe('registro de recursos con /proc y vcgencmd simulados (C1)', () => {
  it('lee CPU, memoria, temperatura, estrangulamiento, sectores y potencia', async () => {
    piSimulada(1000, 2000, 5000)
    const antes = await tiemposCpu(FUENTES)
    piSimulada(1150, 2200, 5400) // 200 ticks, 150 ociosos → 25 %
    const { fila } = await muestra(FUENTES, antes, '2026-12-02T14:05:10')
    expect(fila).toEqual(['2026-12-02T14:05:10', 25, 6144, expect.any(Number), 52.4, '0x50000', 5400, 3.62])
    expect(cpuPct({ total: 10, ocioso: 5 }, { total: 10, ocioso: 5 })).toBeNull()
    expect(discoDe('mmcblk0p2')).toBe('mmcblk0')
    expect(discoDe('nvme0n1p2')).toBe('nvme0n1')
    expect(discoDe('sda2')).toBe('sda')
    // 0.1·3.7 + 0.5·3.3 + 2·0.8 = 3.62; EXT5V no tiene corriente
    expect(potenciaDe(' A_A current(0)=1.00000000A\n A_V volt(1)=5.00000000V\n')).toBe(5)
  })

  it('un campo que no se puede leer queda vacío', async () => {
    const otra = path.join(TMP, 'vacia')
    fs.mkdirSync(otra, { recursive: true })
    const { fila } = await muestra({ raiz: otra, vcgencmd: [path.join(TMP, 'no-existe')] }, null, '2026-12-02T14:05:20')
    expect(fila.filter((v, i) => i !== 0 && i !== 3)).toEqual([null, null, null, null, null, null])
  })

  it('recursos.csv: cabecera con las columnas exactas y filas sin repetirla', async () => {
    const archivo = path.join(TMP, 'recursos-prueba.csv')
    fs.writeFileSync(archivo, CABECERA_RECURSOS.join(',') + '\n2026-12-01T00:00:00,1,2,3,4,0x0,5,6\n')
    const reg = registrarRecursos(archivo, 40, FUENTES)
    await new Promise(r => setTimeout(r, 400))
    reg.detener()
    const lineas = fs.readFileSync(archivo, 'utf-8').trim().split('\n')
    expect(lineas[0]).toBe('fecha_hora,cpu_pct,mem_disponible_mb,rss_mb,temp_c,throttled,sectores_escritos,potencia_w')
    expect(lineas.filter(l => l.startsWith('fecha_hora'))).toHaveLength(1)
    expect(lineas.length).toBeGreaterThan(2)
    expect(lineas[lineas.length - 1].split(',')).toHaveLength(8)
  })

  it('equipo para la Tabla III: almacenamiento y versión del sistema', () => {
    expect(almacenamiento(FUENTES)).toBe('microSD SanDisk de 64 GB')
    expect(soVersion(FUENTES)).toBe('(Debian 13, núcleo 6.12)')
  })
})

describe('impresora simulada (C2)', () => {
  it('cuenta trabajos por tipo y bytes, ignora el pre-chequeo y responde el estado', async () => {
    const archivo = path.join(TMP, 'impresiones.csv')
    const srv = await iniciarImpresoraSimulada(0, archivo)
    const puerto = (srv.address() as net.AddressInfo).port
    const enviar = (datos: Buffer) => new Promise<Buffer>(resolve => {
      const recibido: Buffer[] = []
      const s = net.createConnection({ host: '127.0.0.1', port: puerto }, () => { s.write(datos); setTimeout(() => s.end(), 50) })
      s.on('data', (d: Buffer) => recibido.push(d))
      s.on('close', () => resolve(Buffer.concat(recibido)))
    })
    await enviar(Buffer.alloc(0))
    await enviar(Buffer.from('\x1b@CEVICHERIA MAUI\nBoleta:   B-000001\n'))
    const estado = await enviar(Buffer.from([0x10, 0x04, 0x01]))
    await new Promise(r => setTimeout(r, 100))
    srv.close()
    expect(estado).toEqual(Buffer.from([0x12]))
    const filas = fs.readFileSync(archivo, 'utf-8').trim().split('\n')
    expect(filas[0]).toBe('fecha_hora,tipo,bytes')
    expect(filas.slice(1).map(f => f.split(',')[1])).toEqual(['boleta', 'otro'])
    expect(tipoDeTrabajo(Buffer.from('MESA 3\n-- COMANDA NUEVA --'))).toBe('comanda')
    expect(tipoDeTrabajo(Buffer.from('** PRE-CUENTA **'))).toBe('precuenta')
  })
})

describe('jornada simulada (C4)', () => {
  it('repite el día de sim12 con más boletas, con pedido y cobro por boleta', () => {
    const plan = planSim12()
    expect(plan.fecha).toMatch(/^2026-/)
    expect(plan.boletas).toBeGreaterThan(20)
    const pedidos = plan.eventos.filter(e => e.accion === 'pedido')
    expect(pedidos).toHaveLength(plan.boletas)
    expect(plan.eventos.filter(e => e.accion === 'cobro')).toHaveLength(plan.boletas)
    expect(plan.eventos[0].offsetS).toBe(0)
    expect(plan.eventos.every((e, i, a) => i === 0 || a[i - 1].offsetS <= e.offsetS)).toBe(true)
    expect(pedidos[0].items[0].plato).toMatch(/\S/)
  })

  it('programación: hoy si la hora no pasó, si no el día siguiente; termina con los N días', () => {
    const p = { hora: '12:00', dias: 2, desde: '2026-12-01', ejecutadas: [] as string[] }
    expect(proximaJornada(p, new Date('2026-12-01T09:00:00'))?.getDate()).toBe(1)
    expect(proximaJornada(p, new Date('2026-12-01T13:00:00'))?.getDate()).toBe(2)
    expect(proximaJornada({ ...p, ejecutadas: ['2026-12-02'] }, new Date('2026-12-01T13:00:00'))).toBeNull()
  })

  it('percentil por rango más cercano', () => {
    expect(percentil([5, 1, 3, 2, 4], 0.5)).toBe(3)
    expect(percentil(Array.from({ length: 20 }, (_, i) => i + 1), 0.95)).toBe(19)
    expect(percentil([], 0.95)).toBeNull()
  })
})

describe('pruebas de recuperación: respaldos seguidos (C5)', () => {
  // El bash disponible: en Windows puede ser el de WSL (/mnt/c/…) o el de Git (/c/…)
  const sonda = spawnSync('bash', ['-c', 'uname -s'], { encoding: 'utf-8' })
  const hayBash = sonda.status === 0
  const rutaBash = (p: string) => {
    const m = /^([A-Za-z]):[\\/](.*)$/.exec(p)
    if (process.platform !== 'win32' || !m) return p
    const resto = m[2].replace(/\\/g, '/')
    return /Linux/.test(sonda.stdout) ? `/mnt/${m[1].toLowerCase()}/${resto}` : `/${m[1].toLowerCase()}/${resto}`
  }

  it.skipIf(!hayBash)('[RNF05] dos respaldos seguidos con un backup.sh que nombra al segundo no chocan', async () => {
    const dev = path.join(TMP, 'dev-respaldos')
    const dir = path.join(TMP, 'respaldos')
    fs.mkdirSync(dir, { recursive: true })
    const script = path.join(TMP, 'backup-falso.sh')
    // Como el backup.sh de la Fase 11: gzip se niega a sobrescribir un .gz existente
    fs.writeFileSync(script, `#!/bin/bash\nset -e\nDATE=$(date +%Y%m%d-%H%M%S)\nDEST=${rutaBash(dir)}/mauidisk-sim-$DATE.db\necho datos > "$DEST"\ngzip "$DEST"\n`)
    const antes = { dev: process.env.MAUI_DEV_DIR, script: process.env.BACKUP_SCRIPT, dir: process.env.MAUI_BACKUP_DIR }
    Object.assign(process.env, { MAUI_DEV_DIR: dev, BACKUP_SCRIPT: rutaBash(script), MAUI_BACKUP_DIR: dir })
    try {
      await respaldos(() => undefined, 2)
      const gz = fs.readdirSync(dir).filter(f => f.endsWith('.db.gz'))
      expect(gz).toHaveLength(2)
      const filas = fs.readFileSync(path.join(dev, 'respaldo.csv'), 'utf-8').trim().split('\n').slice(1)
      expect(filas).toHaveLength(2)
      // Duración con 2 decimales: con 1 salían «0» en la Tabla V
      for (const f of filas) expect(f.split(',')[2]).toMatch(/^\d+(\.\d{1,2})?$/)
    } finally {
      process.env.MAUI_DEV_DIR = antes.dev
      for (const [k, v] of [['BACKUP_SCRIPT', antes.script], ['MAUI_BACKUP_DIR', antes.dir]] as const) {
        if (v === undefined) delete process.env[k]
        else process.env[k] = v
      }
    }
  }, 30_000)
})

describe('«Todo en uno»: encadenamiento con tiempos acortados', () => {
  const DEV = path.join(TMP, 'dev-todo')
  let devAntes: string | undefined
  const llamadas: string[] = []
  const programadas: Programacion[] = []
  let fallarPruebas = true

  const deps = (): Dependencias => ({
    correr: tipo => iniciarTrabajo(`todo-${tipo}`, async () => {
      llamadas.push(tipo)
      await new Promise(r => setTimeout(r, 20))
      if (tipo === 'pruebas' && fallarPruebas) { fallarPruebas = false; throw new Error('2 pruebas fallidas') }
      if (tipo === 'recuperacion') {
        // Los cortes de verdad reinician el proceso; aquí solo cambia el estado como lo dejaría el quinto reinicio
        escribirJson(rutaDev('recuperacion.json'), { estado: 'corriendo', fase: 'Respaldo 1 de 5', inicio: '', fin: null, error: null })
        setTimeout(() => escribirJson(rutaDev('recuperacion.json'), { estado: 'hecho', fase: 'Terminado', inicio: '', fin: '', error: null }), 80)
      }
    }),
    programar: p => { programadas.push(p) },
    estadoRecuperacion: () => leerJson<EstadoRecuperacion>(rutaDev('recuperacion.json')),
    jornadaEnCurso: () => null,
    verificarDescarga: () => undefined,
    ahora: () => new Date(),
  })

  async function hasta(cond: (p: PlanTodo) => boolean) {
    for (let i = 0; i < 300; i++) {
      const p = planTodo()
      if (p && cond(p)) return p
      await new Promise(r => setTimeout(r, 20))
    }
    throw new Error(`el plan no llegó al estado esperado: ${JSON.stringify(planTodo())}`)
  }

  beforeAll(() => {
    devAntes = process.env.MAUI_DEV_DIR
    Object.assign(process.env, { MAUI_DEV_DIR: DEV, MAUI_TODO_ESPERA_RECUPERACION_MS: '150', MAUI_TODO_SONDEO_MS: '30' })
  })
  afterAll(() => {
    process.env.MAUI_DEV_DIR = devAntes
    delete process.env.MAUI_TODO_ESPERA_RECUPERACION_MS
    delete process.env.MAUI_TODO_SONDEO_MS
  })

  it('se detiene en el paso que falla y sigue desde ahí hasta dejar la descarga lista', async () => {
    const plan = iniciarTodoEnUno(deps())
    expect(plan.desde).toBe(addDaysIso(fechaLocal().slice(0, 10), 1))
    expect(() => iniciarTodoEnUno(deps())).toThrow(/en marcha/)

    const detenido = await hasta(p => p.estado === 'detenido')
    expect(detenido.pasos.map(p => p.estado)).toEqual(['hecho', 'hecho', 'error', 'pendiente', 'pendiente', 'pendiente'])
    expect(detenido.pasos[2].error).toBe('2 pruebas fallidas')
    expect(programadas).toHaveLength(0)

    reintentarDesde(deps(), 'pruebas')
    const esperando = await hasta(p => p.pasos[4].estado === 'esperando')
    expect(esperando.pasos[3].detalle).toMatch(/^7 jornadas desde el \d{4}-\d{2}-\d{2} a las 12:00$/)
    const listo = await hasta(p => p.estado === 'listo')
    expect(listo.pasos.every(p => p.estado === 'hecho')).toBe(true)
    expect(listo.pasos[5].detalle).toBe('Listo para descargar')
    expect(llamadas).toEqual(['medir', 'permisos', 'pruebas', 'pruebas', 'recuperacion'])
    expect(programadas).toEqual([{ hora: '12:00', dias: 7, desde: plan.desde, ejecutadas: [] }])
    // El plan quedó en disco
    expect(JSON.parse(fs.readFileSync(path.join(DEV, 'todo-en-uno.json'), 'utf-8')).estado).toBe('listo')
  })

  it('al arrancar repite el paso que un reinicio cortó y espera el fin de los cortes de C5', async () => {
    llamadas.length = 0
    const p = planTodo()!
    p.estado = 'corriendo'
    for (const x of p.pasos) Object.assign(x, { estado: 'hecho' })
    p.pasos[2].estado = 'corriendo' // pruebas, cortado por el reinicio
    p.pasos[4].estado = 'corriendo' // recuperación entre cortes
    p.pasos[5].estado = 'pendiente'
    escribirJson(path.join(DEV, 'todo-en-uno.json'), p)
    escribirJson(path.join(DEV, 'recuperacion.json'), { estado: 'corriendo', fase: 'Reinicio 3 de 5', inicio: '', fin: null, error: null })

    expect(reanudarTodoEnUno(deps())).not.toBeNull()
    await hasta(x => x.pasos[4].detalle === 'Reinicio 3 de 5')
    expect(planTodo()!.estado).toBe('corriendo')
    escribirJson(path.join(DEV, 'recuperacion.json'), { estado: 'hecho', fase: 'Terminado', inicio: '', fin: '', error: null })
    await hasta(x => x.estado === 'listo')
    expect(llamadas).toEqual(['pruebas'])
  })

  it('sin acortar, la recuperación es la mañana siguiente a la última jornada, a las 09:00', () => {
    const ms = process.env.MAUI_TODO_ESPERA_RECUPERACION_MS
    delete process.env.MAUI_TODO_ESPERA_RECUPERACION_MS
    try {
      expect(momentoRecuperacion('2026-12-01', 7, new Date())).toBe(new Date('2026-12-08T09:00:00').toISOString())
    } finally {
      process.env.MAUI_TODO_ESPERA_RECUPERACION_MS = ms
    }
  })
})

describe('pruebas automatizadas en la Pi (C7)', () => {
  it('corren con una base temporal -sim.db y sin el modo de pruebas', () => {
    const { env, tmp } = entornoPruebas({ DATABASE_URL: 'file:./mauidisk-sim.db', MAUI_MODO_PRUEBAS: '1', PORT: '3001' })
    expect(env.DATABASE_URL).toBe(`file:${tmp.replace(/\\/g, '/')}`)
    expect(env.DATABASE_URL).toMatch(/-sim\.db$/)
    expect(env.MAUI_MODO_PRUEBAS).toBe('0')
    expect(env.PORT).toBeUndefined()
    expect(totalesVitest(' Test Files  31 passed (31)\n      Tests  248 passed (248)\n')).toEqual({ total: 248, fallidas: 0 })
    expect(totalesVitest('      Tests  2 failed | 246 passed (248)\n')).toEqual({ total: 248, fallidas: 2 })
  })
})

describe('resumen y resultados.json (C8)', () => {
  const P = { desde: '2026-12-01', hasta: '2026-12-02' }
  const csv = (archivo: string, filas: string[]) => {
    fs.mkdirSync(path.dirname(rutaDev(archivo)), { recursive: true })
    fs.writeFileSync(rutaDev(archivo), filas.join('\n') + '\n')
  }

  beforeAll(() => {
    const cab = CABECERA_RECURSOS.join(',')
    csv('recursos-e2.csv', [cab, '2026-12-03T10:00:00,,6000,80,48.1,0x0,100,3.1', '2026-12-03T10:00:01,97.5,5800,121.4,61.2,0x80000,120,5.9'])
    // Un reinicio vuelve el contador a cero: solo cuentan los saltos positivos
    csv('recursos.csv', [cab,
      '2026-11-30T23:59:50,1,6000,80,45,0x0,999999,2',
      '2026-12-01T00:00:00,1,6000,80,45,0x0,1000,2.0',
      '2026-12-01T12:00:00,1,6000,80,45,0x0,1000+',
      '2026-12-01T12:00:10,1,6000,80,45,0x0,205800,3.0',
      '2026-12-02T08:00:00,1,6000,80,45,0x0,50,4.0',
      '2026-12-02T08:00:10,1,6000,80,45,0x0,2098,',
    ].map(l => l.replace('1000+', '1000,')))
    csv('latidos.csv', ['fecha_hora', ...Array.from({ length: 1440 }, (_, k) => `2026-12-01T${String(Math.floor(k / 60)).padStart(2, '0')}:${String(k % 60).padStart(2, '0')}:05`), '2026-12-02T00:00:05', '2026-12-02T00:00:40'])
    csv('arranques.csv', ['fecha_hora,uptime_s,motivo', ...[31.2, 30.8, 29.9, 33.1, 30.2, 31].map((u, k) => `2026-12-0${k < 3 ? 1 : 2}T0${k}:00:00,${u},arranque`), '2026-12-02T09:00:00,40,prueba_reinicio'])
    csv('reinicio.csv', ['fecha_hora,n,duracion_s', '2026-12-02T09:00:00,1,9.5'])
    csv('respaldo.csv', ['fecha_hora,n,duracion_s,tamano_mb,archivo', '2026-12-02T09:00:00,1,1.2,3.4,a.db.gz', '2026-12-02T09:00:05,2,1.1,3.4,b.db.gz'])
    csv('restauracion.csv', ['fecha_hora,n,duracion_s,codigo', '2026-12-02T09:01:00,1,0.8,0'])
    csv('jornada.csv', ['fecha_hora,accion,ms,codigo',
      ...Array.from({ length: 20 }, (_, k) => `2026-12-01T12:${String(k).padStart(2, '0')}:00,pedido,${k + 1},201`),
      '2026-12-01T13:00:00,cobro,40,201', '2026-12-01T13:01:00,cobro,60,201', '2026-12-01T13:02:00,cobro,999,409',
      '2026-12-05T12:00:00,pedido,5000,201'])
    fs.writeFileSync(rutaDev('e2-pi.json'), JSON.stringify({ incremento2: { mes: { p95Ms: 300, limiteMs: 3000, cumple: true } }, tamanoBaseMb: 3.2 }))
    fs.writeFileSync(rutaDev('instalacion-tiempos.json'), JSON.stringify({ fases_min: [5, 3, 4, 12, 1, 1, 2, 1, 2, 3, 2], compilacion_min: 9.5, fecha: '2026-12-01', etiqueta: 'maui-tesis-v1.0' }))
    fs.writeFileSync(rutaDev('equipo.json'), JSON.stringify({ refrigeracion: 'Caja oficial con ventilador' }))
  })

  it('calcula E3, E4, E5 y la jornada del periodo', () => {
    const r = calcularResultados(P, { noches: { ok: 2, total: 2 }, respaldosRemotos: ['2026-11-30', '2026-12-01'] }, FUENTES) as Record<string, Record<string, unknown>>
    expect(r.equipo).toEqual({ almacenamiento: 'microSD SanDisk de 64 GB', so_version: '(Debian 13, núcleo 6.12)', node: process.versions.node, refrigeracion: 'Caja oficial con ventilador' })
    expect(r.e2).toMatchObject({ tamanoBaseMb: 3.2 })
    expect(r.e3).toEqual({
      cpu_max_pct: 97.5, rss_max_mb: 121.4, temp_max_c: 61.2, estrangulamiento: true,
      // (204800 + 2048) sectores × 512 B = 101 MiB en 2 días
      escritura_mb_dia: 50.5, potencia_media_w: 3,
    })
    expect(r.e4).toEqual({ fases_min: [5, 3, 4, 12, 1, 1, 2, 1, 2, 3, 2], compilacion_min: 9.5 })
    expect(r.e5).toEqual({
      arranque_s: [30.8, 29.9, 33.1, 30.2, 31], reinicio_s: [9.5], respaldo_s: [1.2, 1.1], respaldo_mb: [3.4, 3.4], restauracion_s: [0.8],
      disponibilidad_pct: 50.03, noches_ok: 2, noches: 2, respaldos_ok: 1, respaldos: 2,
    })
    expect(r.jornada).toEqual({ pedidos: 20, p95_pedido_ms: 19, p95_cobro_ms: 60, errores: 1 })
  })

  it('resultados.json valida contra la plantilla, que no se cambia', () => {
    const plantilla = JSON.parse(fs.readFileSync(RUTA_PLANTILLA, 'utf-8'))
    expect(Object.keys(plantilla)).toEqual(['equipo', 'e2', 'e3', 'e4', 'e5', 'jornada'])
    const lleno = calcularResultados(P, { noches: null, respaldosRemotos: null }, FUENTES)
    expect(validarContraPlantilla(lleno, plantilla)).toEqual([])
    expect(validarContraPlantilla({ ...lleno, extra: 1 }, plantilla)).toEqual(['extra: clave que no está en la plantilla'])
    const { e3: _e3, ...sinE3 } = lleno as Record<string, unknown>
    expect(validarContraPlantilla(sinE3, plantilla)).toContain('e3: falta')
    expect(validarContraPlantilla({ ...lleno, e5: { ...(lleno.e5 as object), otra: 1 } }, plantilla)).toEqual(['e5.otra: clave que no está en la plantilla'])
  })

  it('sin datos, cada valor queda en null y el resumen dice «pendiente»', () => {
    const vacio = path.join(TMP, 'dev-vacio')
    const antes = process.env.MAUI_DEV_DIR
    process.env.MAUI_DEV_DIR = vacio
    try {
      const r = calcularResultados(P, { noches: null, respaldosRemotos: null }, { raiz: path.join(TMP, 'nada'), vcgencmd: ['no-existe'] })
      expect(r.e2).toBeNull()
      expect(r.e3).toEqual({ cpu_max_pct: null, rss_max_mb: null, temp_max_c: null, estrangulamiento: null, escritura_mb_dia: null, potencia_media_w: null })
      expect(r.jornada).toEqual({ pedidos: null, p95_pedido_ms: null, p95_cobro_ms: null, errores: null })
      const md = resumenMd(r, P, { permisos: null, pruebas: null, arranques: 0 })
      expect(md).toMatch(/\| CPU máxima \(%\) \| pendiente \|/)
      expect(md).toMatch(/0 de 5/)
    } finally {
      process.env.MAUI_DEV_DIR = antes
    }
  })

  it('noches con pronóstico y respaldos de la copia externa', () => {
    const cal = { conVentas: new Set(['2026-12-01', '2026-12-02']), cerrados: new Set<string>() }
    expect(nochesDelPeriodo(cal, [{ madeOn: '2026-12-01', status: 'ok' }, { madeOn: '2026-12-02', status: 'error' }], P)).toEqual({ ok: 1, total: 2 })
    expect(fechasDeRclone('  3456789 2026-12-01 03:00:05.123456789 mauidisk-sim-20261201-0300.db.gz\n     12 2026-12-01 03:00:06.1 backup.log\n')).toEqual(['2026-12-01'])
  })
})
