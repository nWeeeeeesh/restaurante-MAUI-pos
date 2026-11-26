import { useState, type ReactNode } from 'react'
import { CheckCircle2, CircleDashed, Clock, Download, FlaskConical, Gauge, Loader2, Moon, Play, Plug, RotateCcw, ShieldCheck, Square, Timer, XCircle, Zap } from 'lucide-react'
import {
  cancelarRecuperacion, cancelarTodoEnUno, iniciarTodoEnUno, reintentarTodoEnUno, type PasoTodo, descargarTodo, detenerJornada, iniciarRecuperacion, lanzar, putEquipo,
  type EstadoDev, type Parte, type Trabajo,
} from '../../api/dev'
import { useDevEstado } from '../../hooks/useDevEstado'
import { useToastStore } from '../../store/toast'
import { ConfirmDialog } from '../../components/ConfirmDialog'

// Perfil de desarrollador (modo de pruebas): todo lo que necesitan el artículo y la
// tesis, desde el navegador y con datos simulados. Solo existe con MAUI_MODO_PRUEBAS=1.

function errorText(err: unknown): string {
  const data = (err as { response?: { data?: { error?: string; issues?: { message: string }[] } } })?.response?.data
  return data?.issues?.[0]?.message ?? data?.error ?? 'No se pudo completar. Verifica la conexión.'
}

function Seccion({ titulo, icono, ayuda, children }: { titulo: string; icono: ReactNode; ayuda: string; children: ReactNode }) {
  return (
    <section className="bg-white rounded-2xl border border-[#E2E8F0] p-4 space-y-3">
      <div>
        <h2 className="font-black text-[#0F172A] text-sm flex items-center gap-2">{icono}{titulo}</h2>
        <p className="text-xs text-[#64748B] mt-0.5">{ayuda}</p>
      </div>
      {children}
    </section>
  )
}

function EstadoParte({ nombre, parte }: { nombre: string; parte: Parte }) {
  return (
    <li className="flex items-center justify-between gap-2 text-xs py-1">
      <span className="flex items-center gap-1.5 text-[#0F172A] font-semibold">
        {parte.hecho ? <CheckCircle2 size={14} className="text-emerald-600" /> : <CircleDashed size={14} className="text-[#94A3B8]" />}
        {nombre}
      </span>
      <span className={parte.hecho ? 'text-[#64748B]' : 'text-amber-600 font-semibold'}>{parte.hecho ? parte.fecha?.replace('T', ' ') : 'pendiente'}</span>
    </li>
  )
}

function Avance({ t }: { t?: Trabajo }) {
  if (!t) return null
  const color = t.estado === 'error' ? 'text-red-600' : t.estado === 'hecho' ? 'text-emerald-700' : 'text-[#0077B6]'
  return (
    <div className="text-xs space-y-1">
      <p className={`font-bold ${color}`}>
        {t.estado === 'corriendo' ? 'Corriendo…' : t.estado === 'hecho' ? 'Terminado' : `Error: ${t.error}`} · desde {t.inicio.slice(11)}{t.fin ? ` hasta ${t.fin.slice(11)}` : ''}
      </p>
      {t.avance.length > 0 && (
        <pre className="bg-[#F8FAFC] border border-[#E2E8F0] rounded-lg p-2 max-h-40 overflow-auto whitespace-pre-wrap text-[11px] text-[#334155]">{t.avance.slice(-12).join('\n')}</pre>
      )}
    </div>
  )
}

function IconoPaso({ estado }: { estado: PasoTodo['estado'] }) {
  if (estado === 'hecho') return <CheckCircle2 size={14} className="text-emerald-600 shrink-0" />
  if (estado === 'error') return <XCircle size={14} className="text-red-600 shrink-0" />
  if (estado === 'corriendo') return <Loader2 size={14} className="text-[#0077B6] animate-spin shrink-0" />
  if (estado === 'esperando') return <Clock size={14} className="text-amber-600 shrink-0" />
  return <CircleDashed size={14} className="text-[#94A3B8] shrink-0" />
}

function Boton({ onClick, disabled, children, variante = 'primario' }: { onClick: () => void; disabled?: boolean; children: ReactNode; variante?: 'primario' | 'secundario' | 'peligro' }) {
  const estilos = {
    primario: 'bg-[#0077B6] text-white hover:bg-[#00629A]',
    secundario: 'bg-[#EEF3F8] text-[#0F172A] hover:bg-[#E2E8F0]',
    peligro: 'bg-red-600 text-white hover:bg-red-700',
  }
  return (
    <button type="button" onClick={onClick} disabled={disabled}
      className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold disabled:opacity-50 ${estilos[variante]}`}>
      {children}
    </button>
  )
}

export default function Developer() {
  const { data, error, reload } = useDevEstado()
  const push = useToastStore(s => s.push)
  const [enviando, setEnviando] = useState<string | null>(null)
  const [confirmar, setConfirmar] = useState(false)
  const [equipo, setEquipo] = useState<{ refrigeracion?: string; almacenamiento?: string }>({})
  const [confirmarTodo, setConfirmarTodo] = useState(false)

  if (!data) {
    return <div className="p-4 text-sm text-[#64748B]">{error ?? 'Cargando…'}</div>
  }
  const d: EstadoDev = data
  const ocupado = !!d.enCurso || d.recuperacion.estado === 'corriendo'
  const j = d.jornada.resumen

  async function accion(nombre: string, fn: () => Promise<unknown>, ok: string) {
    setEnviando(nombre)
    try {
      await fn()
      push({ variant: 'success', title: ok })
    } catch (err) {
      push({ variant: 'error', title: errorText(err) })
    } finally {
      setEnviando(null)
      reload()
    }
  }

  const inputCls = 'w-full border border-[#E2E8F0] rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-[#0077B6]'
  const t = d.trabajos

  return (
    <div className="p-3 sm:p-4 max-w-3xl mx-auto space-y-3 pb-24">
      <div>
        <h1 className="text-lg font-black text-[#0F172A] flex items-center gap-2"><FlaskConical size={20} className="text-[#0077B6]" />Desarrollador</h1>
        <p className="text-xs text-[#64748B]">Modo de pruebas con datos simulados. Los resultados quedan en <code>{d.dir}</code>.</p>
        {error && <p className="text-xs text-red-600 font-semibold mt-1">{error}</p>}
      </div>

      <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-2xl p-3 text-xs text-amber-900">
        <Plug size={16} className="shrink-0 mt-0.5" />
        <p><b>Falta: desenchufar y enchufar la Pi 5 veces (arranques: {d.arranques.hechos} de {d.arranques.de}).</b> Es lo único que el sistema no puede hacer solo. Hazlo antes o después de «Todo en uno», no durante.</p>
      </div>

      <Seccion titulo="Todo en uno" icono={<Zap size={16} className="text-[#0077B6]" />}
        ayuda="Un clic, una sola corrida de unos 25 a 35 min: medir cálculos, jornada simulada comprimida, tarea nocturna real, permisos, pruebas automatizadas y pruebas de recuperación. Al final queda lista la descarga.">
        {(!d.todoEnUno || d.todoEnUno.estado !== 'corriendo') && (
          <Boton disabled={ocupado || enviando !== null || !!d.jornada.enCurso} onClick={() => setConfirmarTodo(true)}><Zap size={14} />Todo en uno</Boton>
        )}
        {d.todoEnUno && (
          <div className="space-y-1">
            <p className={`text-xs font-bold ${d.todoEnUno.estado === 'detenido' ? 'text-red-600' : d.todoEnUno.estado === 'listo' ? 'text-emerald-700' : 'text-[#0077B6]'}`}>
              {d.todoEnUno.estado === 'listo' ? 'Listo para descargar' : d.todoEnUno.estado === 'detenido' ? 'Detenido' : 'En marcha'} · iniciado el {d.todoEnUno.creado.replace('T', ' ')}
            </p>
            <ul className="divide-y divide-[#F1F5F9]">
              {d.todoEnUno.pasos.map(p => (
                <li key={p.id} className="py-1.5 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-1.5 font-semibold text-[#0F172A]"><IconoPaso estado={p.estado} />{p.nombre}</span>
                    {p.estado === 'error' && d.todoEnUno!.estado === 'detenido' && (
                      <Boton variante="secundario" disabled={enviando !== null || ocupado} onClick={() => accion('reintentar', () => reintentarTodoEnUno(p.id), 'Sigue desde ese paso')}>
                        <RotateCcw size={12} />Reintentar desde aquí
                      </Boton>
                    )}
                  </div>
                  {(p.detalle || p.error) && <p className={`ml-5 ${p.error ? 'text-red-600' : 'text-[#64748B]'}`}>{p.error ?? p.detalle}</p>}
                  {p.estado === 'corriendo' && ['medir', 'jornada', 'nocturna', 'permisos', 'pruebas', 'recuperacion'].includes(p.id) && <div className="ml-5 mt-1"><Avance t={t[p.id]} /></div>}
                </li>
              ))}
            </ul>
            {d.todoEnUno.estado === 'corriendo' && (
              <Boton variante="secundario" disabled={enviando !== null} onClick={() => accion('cancelarTodo', cancelarTodoEnUno, 'Plan detenido')}><Square size={14} />Detener el plan</Boton>
            )}
          </div>
        )}
      </Seccion>

      <Seccion titulo="Estado" icono={<CheckCircle2 size={16} className="text-[#0077B6]" />} ayuda="Qué partes ya tienen datos para el artículo y la tesis.">
        <ul className="divide-y divide-[#F1F5F9]">
          <EstadoParte nombre="Registro continuo (recursos, latidos)" parte={d.partes.registro} />
          <EstadoParte nombre="Medir cálculos (E2, E3)" parte={d.partes.medir} />
          <EstadoParte nombre="Jornada simulada (E5)" parte={d.partes.jornada} />
          <EstadoParte nombre="Tarea nocturna real (PA-08)" parte={d.partes.nocturna} />
          <EstadoParte nombre="Pruebas de recuperación (E5)" parte={d.partes.recuperacion} />
          <EstadoParte nombre="Verificar permisos (PA-08)" parte={d.partes.permisos} />
          <EstadoParte nombre="Pruebas automatizadas (Cap. IV)" parte={d.partes.pruebas} />
          <EstadoParte nombre="Instalación (E4, instalar.sh)" parte={d.partes.instalacion} />
          <EstadoParte nombre="Impresiones (impresora simulada)" parte={d.partes.impresiones} />
        </ul>
        <p className="text-xs text-[#0F172A]">
          Arranques registrados: <b>{d.arranques.hechos} de {d.arranques.de}</b> (desenchufa y enchufa la Pi; cada arranque cuenta solo).
        </p>
      </Seccion>

      <Seccion titulo="Equipo" icono={<Gauge size={16} className="text-[#0077B6]" />} ayuda="Para la Tabla III del artículo. Lo detectado se usa si dejas el campo vacío.">
        <label className="block text-xs font-semibold text-[#334155]">Refrigeración
          <input className={inputCls} placeholder="Ej.: caja oficial con ventilador" value={equipo.refrigeracion ?? d.equipo.refrigeracion ?? ''}
            onChange={e => setEquipo(q => ({ ...q, refrigeracion: e.target.value }))} />
        </label>
        <label className="block text-xs font-semibold text-[#334155]">Almacenamiento
          <input className={inputCls} placeholder={d.equipo.detectado.almacenamiento ?? 'Ej.: microSD SanDisk Extreme de 64 GB'}
            value={equipo.almacenamiento ?? d.equipo.almacenamiento ?? ''} onChange={e => setEquipo(q => ({ ...q, almacenamiento: e.target.value }))} />
        </label>
        <p className="text-xs text-[#64748B]">Sistema: {d.equipo.detectado.so_version ?? 'pendiente'} · Node {d.equipo.detectado.node}</p>
        <Boton disabled={enviando !== null} onClick={() => accion('equipo', () => putEquipo(equipo), 'Equipo guardado')}>Guardar</Boton>
      </Seccion>

      <Seccion titulo="Medir cálculos" icono={<Timer size={16} className="text-[#0077B6]" />} ayuda="E2 y E3 (Tabla 31 y PA-07): 30 s en reposo, npm run perf y 30 s más, con recursos cada 1 s.">
        <Boton disabled={ocupado || enviando !== null} onClick={() => accion('medir', () => lanzar('medir'), 'Medición iniciada')}><Play size={14} />Medir cálculos</Boton>
        <Avance t={t.medir} />
        {d.e2.length > 0 && (
          <table className="w-full text-xs">
            <thead><tr className="text-left text-[#64748B]"><th className="py-1">Operación</th><th>p95</th><th>Límite</th><th /></tr></thead>
            <tbody>
              {d.e2.map(m => (
                <tr key={m.operacion} className="border-t border-[#F1F5F9]">
                  <td className="py-1 pr-2">{m.operacion}</td><td>{m.p95Ms} ms</td><td>{m.limiteMs} ms</td>
                  <td>{m.cumple ? <CheckCircle2 size={14} className="text-emerald-600" /> : <XCircle size={14} className="text-red-600" />}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Seccion>

      <Seccion titulo="Jornada simulada" icono={<Play size={16} className="text-[#0077B6]" />}
        ayuda={`E5: el día de sim12 con más boletas, comprimido ${d.jornada.factor} veces (unos minutos), con pedido, comanda, cobro y boleta, y recursos cada 1 s.`}>
        <div className="flex flex-wrap gap-2">
          {d.jornada.enCurso
            ? <Boton variante="secundario" disabled={enviando !== null} onClick={() => accion('detener', detenerJornada, 'Jornada detenida')}><Square size={14} />Detener jornada (desde {d.jornada.enCurso.inicio?.slice(11)})</Boton>
            : <Boton disabled={ocupado || enviando !== null} onClick={() => accion('jornada', () => lanzar('jornada'), 'Jornada iniciada')}><Play size={14} />Correr la jornada</Boton>}
        </div>
        <Avance t={t.jornada} />
        {j && (
          <p className="text-xs text-[#64748B]">
            Última ({j.estado}, {j.inicio.replace('T', ' ')}): {j.operaciones} operaciones en {j.duracionMin} min · p95 pedido {j.p95PedidoMs ?? '—'} ms · p95 cobro {j.p95CobroMs ?? '—'} ms · {j.errores} errores
          </p>
        )}
      </Seccion>

      <Seccion titulo="Tarea nocturna real" icono={<Moon size={16} className="text-[#0077B6]" />} ayuda="PA-08: corre una vez la tarea nocturna por el mismo camino que la de las 23:30 y comprueba su fila ok en forecast_runs.">
        <Boton disabled={ocupado || enviando !== null} onClick={() => accion('nocturna', () => lanzar('nocturna'), 'Tarea nocturna iniciada')}><Moon size={14} />Correr la tarea nocturna</Boton>
        <Avance t={t.nocturna} />
        {d.nocturna && (
          <p className={`text-xs font-bold ${d.nocturna.ok ? 'text-emerald-700' : 'text-red-600'}`}>
            Noche del {d.nocturna.madeOn}: {d.nocturna.ok ? 'ok' : 'error'} en {d.nocturna.ms} ms ({d.nocturna.fecha.replace('T', ' ')})
          </p>
        )}
      </Seccion>

      <Seccion titulo="Pruebas de recuperación" icono={<RotateCcw size={16} className="text-[#0077B6]" />}
        ayuda="E5 y PA-08 (unos 15 min): respaldo ×5, restauración ×5 y reinicio tras falla ×5. El servicio se corta y systemd lo levanta.">
        <div className="flex flex-wrap gap-2">
          <Boton variante="peligro" disabled={ocupado || enviando !== null || !!d.jornada.enCurso} onClick={() => setConfirmar(true)}><RotateCcw size={14} />Pruebas de recuperación</Boton>
          {d.recuperacion.estado === 'corriendo' && <Boton variante="secundario" disabled={enviando !== null} onClick={() => accion('cancelar', cancelarRecuperacion, 'Secuencia cancelada')}>Cancelar</Boton>}
        </div>
        {d.recuperacion.estado && (
          <p className={`text-xs font-semibold ${d.recuperacion.estado === 'error' ? 'text-red-600' : d.recuperacion.estado === 'hecho' ? 'text-emerald-700' : 'text-[#0077B6]'}`}>
            {d.recuperacion.estado === 'corriendo' ? 'En curso' : d.recuperacion.estado === 'hecho' ? 'Terminadas' : `Error: ${d.recuperacion.error}`} · {d.recuperacion.fase}
          </p>
        )}
        <Avance t={t.recuperacion} />
        {d.jornada.enCurso && <p className="text-xs text-amber-600">Detén la jornada antes: el reinicio la cortaría.</p>}
      </Seccion>

      <Seccion titulo="Verificar permisos" icono={<ShieldCheck size={16} className="text-[#0077B6]" />} ayuda="PA-08: cada rol del simulador contra Rentabilidad, Recetas, Lista de compra, Inventario y POS.">
        <Boton disabled={ocupado || enviando !== null} onClick={() => accion('permisos', () => lanzar('permisos'), 'Verificación iniciada')}><ShieldCheck size={14} />Verificar permisos</Boton>
        <Avance t={t.permisos} />
        {d.permisos && (
          <div className="overflow-x-auto">
            <p className={`text-xs font-bold mb-1 ${d.permisos.todoCoincide ? 'text-emerald-700' : 'text-red-600'}`}>
              {d.permisos.todoCoincide ? 'Todo coincide con la regla de PA-08' : 'Hay diferencias con la regla de PA-08'} ({d.permisos.fecha.replace('T', ' ')})
            </p>
            <table className="w-full text-xs">
              <thead><tr className="text-left text-[#64748B]"><th className="py-1">Usuario</th>{[...new Set(d.permisos.matriz.map(m => m.pantalla))].map(p => <th key={p} className="px-1">{p}</th>)}</tr></thead>
              <tbody>
                {[...new Set(d.permisos.matriz.map(m => m.usuario))].map(u => (
                  <tr key={u} className="border-t border-[#F1F5F9]">
                    <td className="py-1 pr-2 font-semibold">{u}</td>
                    {d.permisos!.matriz.filter(m => m.usuario === u).map(m => (
                      <td key={m.pantalla} className={`px-1 ${m.coincide ? 'text-[#0F172A]' : 'text-red-600 font-black bg-red-50'}`} title={`esperado ${m.esperado}`}>{m.codigo}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Seccion>

      <Seccion titulo="Correr pruebas automatizadas" icono={<FlaskConical size={16} className="text-[#0077B6]" />} ayuda="Capítulo IV: npm run ci y npm run report:tesis en la Pi. Puede tardar varios minutos.">
        <Boton disabled={ocupado || enviando !== null} onClick={() => accion('pruebas', () => lanzar('pruebas'), 'Pruebas iniciadas')}><Play size={14} />Correr pruebas</Boton>
        <Avance t={t.pruebas} />
        {d.pruebas && (
          <p className={`text-xs font-bold ${d.pruebas.fallidas ? 'text-red-600' : 'text-emerald-700'}`}>
            {d.pruebas.total ?? '?'} pruebas, {d.pruebas.fallidas ?? '?'} fallidas ({d.pruebas.fecha.replace('T', ' ')})
          </p>
        )}
      </Seccion>

      <Seccion titulo="Descargar todo" icono={<Download size={16} className="text-[#0077B6]" />} ayuda="maui-resultados-<fecha>.tar.gz con la última corrida: resultados.json, los CSV, lo de la tesis y resumen.md.">
        <Boton disabled={enviando !== null} onClick={() => accion('descargar', descargarTodo, 'Descarga lista')}><Download size={14} />{enviando === 'descargar' ? 'Armando…' : 'Descargar todo'}</Boton>
      </Seccion>

      <ConfirmDialog
        open={confirmarTodo}
        title="¿Empezar «Todo en uno»?"
        message="Corre todo seguido, en unos 25 a 35 minutos: cálculos, jornada simulada comprimida, tarea nocturna, permisos, pruebas automatizadas y, al final, las pruebas de recuperación, en las que el servicio se corta 5 veces unos segundos. No desenchufes la Pi mientras corre."
        confirmLabel="Empezar"
        variant="warning"
        loading={enviando === 'todo'}
        onCancel={() => setConfirmarTodo(false)}
        onConfirm={() => { setConfirmarTodo(false); void accion('todo', iniciarTodoEnUno, '«Todo en uno» en marcha') }}
      />

      <ConfirmDialog
        open={confirmar}
        title="¿Correr las pruebas de recuperación?"
        message="Tardan unos 15 minutos. El servicio se cortará 5 veces (systemd lo levanta solo) y nadie podrá usar el POS mientras tanto."
        confirmLabel="Empezar"
        variant="danger"
        loading={enviando === 'recuperacion'}
        onCancel={() => setConfirmar(false)}
        onConfirm={() => { setConfirmar(false); void accion('recuperacion', iniciarRecuperacion, 'Pruebas de recuperación iniciadas') }}
      />
    </div>
  )
}
