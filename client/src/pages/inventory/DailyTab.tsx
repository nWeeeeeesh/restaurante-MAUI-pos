import { useCallback, useEffect, useRef, useState } from 'react'
import { Check, Clock, Loader2, Plus, X } from 'lucide-react'
import api from '../../api/client'
import { useToastStore } from '../../store/toast'
import { formatDbDateTime, formatLocalDate, localDateString } from '../../utils/dates'
import {
  CLIENT_VERSION, errorMessage, NOTE_KINDS, parseNumber, UNIT_LABEL,
  type DailyDay, type DayNoteKind, type EntryMode, type PartStatus,
} from './model'

// «Compra del día» (plan v3 §2.2): la única rutina obligatoria de la tesis, en dos
// partes que se guardan por separado y pueden llenar personas distintas.
//   A «Al abrir» (normalmente el encargado): quedaba y botaste, y notas del día.
//   B «Al volver de comprar» (normalmente el dueño): compras, precio, otros insumos.
// Invariante 1: aquí nunca aparece nada de la fase 2 (sugerencias, stock teórico,
// alertas). Cada valor viaja con su modo de entrada y cada parte con su duración.

const num = (n: number | null | undefined) => (n === null || n === undefined ? '' : String(n))
const money = (n: number) => n.toFixed(2)
const qtyLabel = (n: number) => String(Number(n.toFixed(2)))
const hhmm = (ts: string | null) => formatDbDateTime(ts, { hour: '2-digit', minute: '2-digit' })

function NumberCell({ label, hint, value, onChange, unit, highlight }: {
  label: string; hint?: string; value: string; onChange: (v: string) => void; unit: string; highlight?: boolean
}) {
  return (
    <label className="block min-w-0">
      <span className="text-[11px] font-semibold text-[#64748B] block">{label}</span>
      {hint && <span className="text-[10px] text-[#94A3B8] block leading-tight mb-1">{hint}</span>}
      <div className={`mt-1 flex items-center rounded-xl border-2 transition-colors ${highlight ? 'border-[#0077B6]/40 bg-white' : 'border-transparent bg-[#EEF3F8]'} focus-within:border-[#0077B6]`}>
        <input value={value} onChange={e => onChange(e.target.value)} onFocus={e => e.target.select()}
          inputMode="decimal" placeholder="—"
          className="w-full min-w-0 bg-transparent px-2.5 py-3 text-base font-bold text-right focus:outline-none" />
        <span className="pr-2 text-[11px] text-[#94A3B8] shrink-0">{unit}</span>
      </div>
    </label>
  )
}

function PartLine({ label, status }: { label: string; status: PartStatus | null }) {
  return status ? (
    <span className="inline-flex items-center gap-1 text-emerald-700">
      <Check size={13} /> {label} ({status.by ?? '—'}, {hhmm(status.at)}{status.corrections > 0 ? ` · corregido ${hhmm(status.lastAt)}` : ''})
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 text-[#94A3B8]"><Clock size={13} /> {label}: pendiente</span>
  )
}

function PartsStatus({ day }: { day: DailyDay }) {
  return (
    <p className="flex flex-wrap gap-x-3 gap-y-1 text-xs font-semibold">
      <PartLine label="Al abrir" status={day.parts.apertura} />
      <PartLine label="Al volver de comprar" status={day.parts.compra} />
    </p>
  )
}

// Del primer render de la tarjeta (o del último guardado) al guardado exitoso
function useDuration() {
  const start = useRef(0)
  useEffect(() => { start.current = Date.now() }, [])
  return {
    elapsed: () => (start.current ? Date.now() - start.current : 0),
    restart: () => { start.current = Date.now() },
  }
}

// ── Parte A · «Al abrir» ─────────────────────────────────────────────────────

interface OpeningRow { opening: string; openingMode: EntryMode; wasted: string; wastedMode: EntryMode }

function openingRows(day: DailyDay): Record<number, OpeningRow> {
  const saved = day.parts.apertura !== null
  return Object.fromEntries(day.items.map(i => [i.supplyId, saved
    ? { opening: num(i.opening), openingMode: i.openingMode ?? 'typed', wasted: num(i.wasted), wastedMode: i.wastedMode ?? 'default' }
    : { opening: '', openingMode: 'typed', wasted: '0', wastedMode: 'default' }]))
}

function OpeningCard({ day, onSaved }: { day: DailyDay; onSaved: (d: DailyDay) => void }) {
  const pushToast = useToastStore(s => s.push)
  const duration = useDuration()
  const [rows, setRows] = useState(() => openingRows(day))
  const [notes, setNotes] = useState(() => day.notes.map(n => ({ kind: n.kind, text: n.text ?? '' })))
  const [noteKind, setNoteKind] = useState<DayNoteKind | null>(null)
  const [noteText, setNoteText] = useState('')
  const [saving, setSaving] = useState(false)

  const update = (id: number, patch: Partial<OpeningRow>) => setRows(r => ({ ...r, [id]: { ...r[id], ...patch } }))

  const errors = day.items.flatMap(item => {
    const r = rows[item.supplyId]
    if (!r) return []
    const opening = parseNumber(r.opening)
    const wasted = parseNumber(r.wasted)
    if (opening === null) return [`${item.name}: falta lo que quedaba`]
    if (opening < 0 || (r.wasted.trim() !== '' && (wasted === null || wasted < 0))) return [`${item.name}: revisa los números`]
    return []
  })

  const addNote = () => {
    if (!noteKind) return
    setNotes(n => [...n, { kind: noteKind, text: noteText.trim() }])
    setNoteKind(null)
    setNoteText('')
  }

  const save = async () => {
    if (errors.length > 0) return
    setSaving(true)
    try {
      // Una nota elegida pero sin "Agregar" también se guarda
      const allNotes = noteKind ? [...notes, { kind: noteKind, text: noteText.trim() }] : notes
      const { data } = await api.post<DailyDay>('/inventory/daily', {
        part: 'apertura',
        date: day.date,
        durationMs: duration.elapsed(),
        clientVersion: CLIENT_VERSION,
        items: day.items.map(i => {
          const r = rows[i.supplyId]
          return { supplyId: i.supplyId, opening: parseNumber(r.opening), openingMode: r.openingMode, wasted: parseNumber(r.wasted) ?? 0, wastedMode: r.wastedMode }
        }),
        notes: allNotes.map(n => ({ kind: n.kind, text: n.text || null })),
      })
      pushToast({ variant: 'success', title: day.parts.apertura ? 'Al abrir: corregido' : 'Al abrir: guardado' })
      setRows(openingRows(data))
      setNotes(data.notes.map(n => ({ kind: n.kind, text: n.text ?? '' })))
      setNoteKind(null)
      setNoteText('')
      duration.restart()
      onSaved(data)
    } catch (err) {
      pushToast({ variant: 'error', title: 'No se pudo guardar', message: errorMessage(err) })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="bg-white rounded-2xl shadow-sm p-4 space-y-3">
      <div>
        <h2 className="font-black text-[#0F172A]">Al abrir</h2>
        <p className="text-xs text-[#64748B]">Antes de que llegue la compra. Lo que se bota se registra como merma del {formatLocalDate(day.wasteDate)} (último día con ventas).</p>
      </div>
      {day.items.map(item => {
        const r = rows[item.supplyId]
        if (!r) return null
        const unit = UNIT_LABEL[item.unit]
        return (
          <div key={item.supplyId} className="border-t border-[#E2E8F0] pt-3">
            <p className="font-bold text-[#0F172A] mb-1.5">{item.name}</p>
            <div className="grid grid-cols-2 gap-2">
              <NumberCell label="Quedaba" hint="cuenta o pesa antes de que llegue la compra" unit={unit} value={r.opening} highlight
                onChange={v => update(item.supplyId, { opening: v, openingMode: 'typed' })} />
              <NumberCell label="Botaste" hint="pésalo en la balanza" unit={unit} value={r.wasted}
                onChange={v => update(item.supplyId, { wasted: v, wastedMode: 'typed' })} />
            </div>
          </div>
        )
      })}

      <div className="border-t border-[#E2E8F0] pt-3 space-y-2.5">
        <p className="text-sm font-bold text-[#0F172A]">Notas del día <span className="font-normal text-[#94A3B8]">(opcional)</span></p>
        {notes.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {notes.map((n, i) => (
              <span key={i} className="inline-flex items-center gap-1.5 bg-[#EEF3F8] rounded-lg pl-2.5 pr-1 py-1 text-xs font-semibold text-[#0F172A]">
                {NOTE_KINDS.find(k => k.key === n.kind)?.label ?? n.kind}{n.text ? `: ${n.text}` : ''}
                <button onClick={() => setNotes(ns => ns.filter((_, j) => j !== i))} className="p-0.5 text-[#94A3B8] hover:text-red-500"><X size={12} /></button>
              </span>
            ))}
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          {NOTE_KINDS.map(k => (
            <button key={k.key} onClick={() => setNoteKind(noteKind === k.key ? null : k.key)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold border-2 ${noteKind === k.key ? 'bg-[#0077B6] text-white border-[#0077B6]' : 'bg-white text-[#64748B] border-[#E2E8F0]'}`}>
              {k.label}
            </button>
          ))}
        </div>
        {noteKind && (
          <div className="flex gap-2">
            <input value={noteText} onChange={e => setNoteText(e.target.value)} maxLength={300} placeholder="Detalle (opcional)"
              className="flex-1 min-w-0 bg-[#EEF3F8] rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#0077B6]/30" />
            <button onClick={addNote} className="shrink-0 flex items-center gap-1 px-3 rounded-xl bg-[#0077B6] text-white text-sm font-semibold">
              <Plus size={14} /> Agregar
            </button>
          </div>
        )}
      </div>

      {errors.length > 0 && <p className="text-xs font-semibold text-red-600">{errors[0]}</p>}
      <button onClick={save} disabled={saving || errors.length > 0}
        className="w-full bg-[#0077B6] hover:bg-[#005a8a] text-white font-bold py-4 rounded-xl shadow-md disabled:opacity-40 flex items-center justify-center gap-2 transition-colors">
        {saving && <Loader2 size={16} className="animate-spin" />}
        Guardar «Al abrir»
      </button>
    </div>
  )
}

// ── Parte B · «Al volver de comprar» ─────────────────────────────────────────

interface PurchaseRow {
  purchased: string
  purchasedMode: EntryMode
  price: string
  priceMode: EntryMode
  total: string
  // Si el total se escribió a mano manda sobre cantidad × precio
  totalEdited: boolean
  supplier: string
  showSupplier: boolean
  transfer: string
  transferMode: EntryMode
}

function purchaseRows(day: DailyDay): Record<number, PurchaseRow> {
  const saved = day.parts.compra !== null
  return Object.fromEntries(day.items.map(i => {
    const savedPrice = saved && i.purchased > 0
    const price = savedPrice ? i.unitPrice : i.reference.unitPrice
    const auto = i.purchased > 0 && price !== null ? Math.round(i.purchased * price * 100) / 100 : null
    return [i.supplyId, {
      purchased: saved && i.purchased > 0 ? num(i.purchased) : '',
      purchasedMode: i.purchasedMode ?? 'typed',
      price: num(price),
      // El precio prellenado con el último pagado cuenta como copiado hasta que se cambie
      priceMode: savedPrice ? i.priceMode ?? 'typed' : price !== null ? 'copied' : 'typed',
      total: savedPrice ? num(i.totalCost) : '',
      totalEdited: savedPrice && i.totalCost !== auto,
      supplier: i.supplier ?? i.reference.supplier ?? '',
      showSupplier: false,
      transfer: saved && i.transfer > 0 ? num(i.transfer) : '',
      transferMode: i.transferMode ?? 'typed',
    }]
  }))
}

function PurchaseCard({ day, onSaved }: { day: DailyDay; onSaved: (d: DailyDay) => void }) {
  const pushToast = useToastStore(s => s.push)
  const duration = useDuration()
  const [rows, setRows] = useState(() => purchaseRows(day))
  const [other, setOther] = useState(() => num(day.otherCost?.amount))
  const [otherMode, setOtherMode] = useState<EntryMode>(day.otherCost?.mode ?? 'typed')
  const [saving, setSaving] = useState(false)
  const transferLabel = day.transfers.direction === 'envio' ? 'Enviaste al otro local' : 'Recibiste del local principal'

  const update = (id: number, patch: Partial<PurchaseRow>) => setRows(r => ({ ...r, [id]: { ...r[id], ...patch } }))

  const totalOf = (r: PurchaseRow) => {
    if (r.totalEdited) return parseNumber(r.total)
    const q = parseNumber(r.purchased)
    const p = parseNumber(r.price)
    return q !== null && p !== null ? Math.round(q * p * 100) / 100 : null
  }

  const errors = day.items.flatMap(item => {
    const r = rows[item.supplyId]
    if (!r) return []
    const fields = [r.purchased, r.price, r.transfer]
    if (fields.some(v => v.trim() !== '' && ((parseNumber(v) ?? -1) < 0))) return [`${item.name}: revisa los números`]
    if ((parseNumber(r.purchased) ?? 0) > 0 && totalOf(r) === null) return [`${item.name}: falta el precio`]
    return []
  }).concat(other.trim() !== '' && ((parseNumber(other) ?? -1) < 0) ? ['Otros insumos: revisa el monto'] : [])

  const save = async () => {
    if (errors.length > 0) return
    setSaving(true)
    try {
      const items = day.items.map(i => {
        const r = rows[i.supplyId]
        const purchased = parseNumber(r.purchased) ?? 0
        const transfer = day.transfers.enabled ? parseNumber(r.transfer) ?? 0 : 0
        return {
          supplyId: i.supplyId,
          purchased,
          purchasedMode: r.purchasedMode,
          unitPrice: purchased > 0 ? parseNumber(r.price) : null,
          totalCost: purchased > 0 ? totalOf(r) : null,
          priceMode: r.priceMode,
          supplier: purchased > 0 ? r.supplier.trim() || null : null,
          transfer,
          transferMode: r.transferMode,
        }
      })
      const amount = parseNumber(other)
      const { data } = await api.post<DailyDay>('/inventory/daily', {
        part: 'compra',
        date: day.date,
        durationMs: duration.elapsed(),
        clientVersion: CLIENT_VERSION,
        items,
        otherCost: amount === null ? null : { amount, mode: otherMode },
      })
      const bought = items.filter(i => i.purchased > 0)
      const spent = bought.reduce((t, i) => t + (i.totalCost ?? 0), 0) + (amount ?? 0)
      pushToast({
        variant: 'success',
        title: day.parts.compra ? 'Compra: corregida' : 'Compra: guardada',
        message: `${bought.length} insumos críticos · S/ ${money(spent)} en total`,
      })
      setRows(purchaseRows(data))
      setOther(num(data.otherCost?.amount))
      setOtherMode(data.otherCost?.mode ?? 'typed')
      duration.restart()
      onSaved(data)
    } catch (err) {
      pushToast({ variant: 'error', title: 'No se pudo guardar', message: errorMessage(err) })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="bg-white rounded-2xl shadow-sm p-4 space-y-3">
      <div>
        <h2 className="font-black text-[#0F172A]">Al volver de comprar</h2>
        <p className="text-xs text-[#64748B]">Lo que compraste hoy. Si no compraste un insumo, déjalo vacío.</p>
      </div>
      {day.items.map(item => {
        const r = rows[item.supplyId]
        if (!r) return null
        const unit = UNIT_LABEL[item.unit]
        const bought = (parseNumber(r.purchased) ?? 0) > 0
        const total = totalOf(r)
        const ref = item.reference
        return (
          <div key={item.supplyId} className="border-t border-[#E2E8F0] pt-3 space-y-2">
            <p className="font-bold text-[#0F172A]">{item.name}</p>
            <div className={`grid gap-2 ${day.transfers.enabled ? 'grid-cols-2' : 'grid-cols-1'}`}>
              <NumberCell label="Compraste" unit={unit} value={r.purchased} highlight
                onChange={v => update(item.supplyId, { purchased: v, purchasedMode: 'typed' })} />
              {day.transfers.enabled && (
                <NumberCell label={transferLabel} unit={unit} value={r.transfer}
                  onChange={v => update(item.supplyId, { transfer: v, transferMode: 'typed' })} />
              )}
            </div>
            {!bought && ref.purchased !== null && ref.purchased > 0 && (
              <button onClick={() => update(item.supplyId, { purchased: num(ref.purchased), purchasedMode: 'copied' })}
                className="w-full flex items-center justify-between gap-2 rounded-xl bg-[#EEF3F8] px-3 py-2 text-xs text-[#64748B]">
                <span className="truncate">
                  {ref.fromDate ? `El ${formatLocalDate(ref.fromDate)}` : 'La última vez'} compraste{' '}
                  <b className="text-[#0F172A]">{qtyLabel(ref.purchased)} {unit}</b>
                </span>
                <span className="shrink-0 font-bold text-[#0077B6]">Usar</span>
              </button>
            )}
            {bought && (
              <div className="grid grid-cols-2 gap-2">
                <NumberCell label={`Precio por ${unit}`} unit="S/" value={r.price}
                  onChange={v => update(item.supplyId, { price: v, priceMode: 'typed', totalEdited: false })} />
                <NumberCell label="Total" unit="S/" value={r.totalEdited ? r.total : num(total)}
                  onChange={v => update(item.supplyId, { total: v, totalEdited: true, priceMode: 'typed' })} />
              </div>
            )}
            {bought && (r.showSupplier ? (
              <input value={r.supplier} onChange={e => update(item.supplyId, { supplier: e.target.value })} maxLength={80}
                placeholder="Proveedor o puesto" autoFocus
                className="w-full bg-[#EEF3F8] rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#0077B6]/30" />
            ) : (
              <button onClick={() => update(item.supplyId, { showSupplier: true })} className="text-xs font-semibold text-[#0077B6]">
                {r.supplier ? `Proveedor: ${r.supplier} · cambiar` : '+ proveedor'}
              </button>
            ))}
          </div>
        )
      })}

      <div className="border-t border-[#E2E8F0] pt-3 space-y-2">
        <NumberCell label="Otros insumos del día" hint="todo lo demás que compraste hoy para este local (limón, cebolla, abarrotes…), sin contar lo de arriba"
          unit="S/" value={other} onChange={v => { setOther(v); setOtherMode('typed') }} />
        {other.trim() === '' && day.otherCostReference && (
          <button onClick={() => { setOther(num(day.otherCostReference!.amount)); setOtherMode('copied') }}
            className="w-full flex items-center justify-between gap-2 rounded-xl bg-[#EEF3F8] px-3 py-2 text-xs text-[#64748B]">
            <span className="truncate">El {formatLocalDate(day.otherCostReference.fromDate)}: <b className="text-[#0F172A]">S/ {money(day.otherCostReference.amount)}</b></span>
            <span className="shrink-0 font-bold text-[#0077B6]">Usar</span>
          </button>
        )}
      </div>

      {errors.length > 0 && <p className="text-xs font-semibold text-red-600">{errors[0]}</p>}
      <button onClick={save} disabled={saving || errors.length > 0}
        className="w-full bg-[#0077B6] hover:bg-[#005a8a] text-white font-bold py-4 rounded-xl shadow-md disabled:opacity-40 flex items-center justify-center gap-2 transition-colors">
        {saving && <Loader2 size={16} className="animate-spin" />}
        Guardar «Al volver de comprar»
      </button>
    </div>
  )
}

// Lo que había al empezar el día con lo ya guardado: quedaba + compras ± traslados.
// No descuenta ventas: eso requiere recetas y es la fase 2. Solo refleja lo registrado.
function StartedWith({ day }: { day: DailyDay }) {
  const sign = day.transfers.direction === 'envio' ? -1 : 1
  const rows = day.items.map(i => ({
    id: i.supplyId,
    name: i.name,
    unit: UNIT_LABEL[i.unit],
    total: i.opening === null && i.purchased === 0 && i.transfer === 0 ? null : (i.opening ?? 0) + i.purchased + sign * i.transfer,
    uncounted: i.opening === null,
  }))
  const anyUncounted = rows.some(r => r.uncounted && r.total !== null)
  return (
    <div className="bg-white rounded-2xl shadow-sm p-4">
      <h3 className="font-black text-[#0F172A]">Hoy empezaste con</h3>
      <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1.5">
        {rows.map(r => (
          <div key={r.id} className="flex items-baseline justify-between gap-2 text-sm">
            <span className="text-[#64748B] truncate">{r.name}</span>
            <span className="font-bold text-[#0F172A] shrink-0">
              {r.total === null ? '—' : `${qtyLabel(r.total)} ${r.unit}${r.uncounted ? '*' : ''}`}
            </span>
          </div>
        ))}
      </div>
      <p className="mt-2 text-[11px] text-[#94A3B8]">
        Quedaba + compraste{day.transfers.enabled ? (sign < 0 ? ' − enviado' : ' + recibido') : ''}. No descuenta lo vendido durante el día.
        {anyUncounted ? ' * Sin contar lo que quedaba.' : ''}
      </p>
    </div>
  )
}

export default function DailyTab() {
  const pushToast = useToastStore(s => s.push)
  const today = localDateString()
  const [date, setDate] = useState(today)
  const [day, setDay] = useState<DailyDay | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const { data } = await api.get<DailyDay>(`/inventory/daily/${date}`)
      setDay(data)
    } catch (err) {
      pushToast({ variant: 'error', title: 'No se pudo cargar la compra del día', message: errorMessage(err, 'Verifica la conexión.') })
    } finally {
      setLoading(false)
    }
  }, [date, pushToast])

  useEffect(() => { load() }, [load])

  return (
    <div className="space-y-3">
      <div className="bg-white rounded-2xl shadow-sm p-4 space-y-2">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="font-black text-[#0F172A]">Compra del día</h2>
            <p className="text-xs text-[#64748B]">Dos partes: al abrir y al volver de comprar. Cada una se guarda aparte.</p>
          </div>
          <input type="date" value={date} min={day?.minDate} max={today}
            onChange={e => setDate(e.target.value || today)}
            className="shrink-0 w-[9.5rem] bg-[#EEF3F8] rounded-xl px-3 py-2 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-[#0077B6]/30" />
        </div>
        {day && day.date === date && <PartsStatus day={day} />}
      </div>

      {loading || !day || day.date !== date ? (
        <div className="py-10 flex justify-center"><Loader2 className="animate-spin text-[#0077B6]" /></div>
      ) : day.items.length === 0 ? (
        <p className="bg-white rounded-2xl shadow-sm p-4 text-sm text-[#64748B]">
          No hay insumos críticos. El dueño los marca en la pestaña Insumos.
        </p>
      ) : (
        <>
          {(day.parts.apertura || day.parts.compra) && <StartedWith day={day} />}
          {/* key por fecha: al cambiar de día cada tarjeta empieza de cero (y su cronómetro) */}
          <OpeningCard key={`a-${day.date}`} day={day} onSaved={setDay} />
          <PurchaseCard key={`b-${day.date}`} day={day} onSaved={setDay} />
        </>
      )}
    </div>
  )
}
