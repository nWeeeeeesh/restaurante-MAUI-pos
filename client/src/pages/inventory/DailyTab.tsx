import { useCallback, useEffect, useState } from 'react'
import { Check, Loader2, Plus, X } from 'lucide-react'
import api from '../../api/client'
import { useToastStore } from '../../store/toast'
import { formatLocalDate, localDateString } from '../../utils/dates'
import {
  errorMessage, NOTE_KINDS, parseNumber, UNIT_LABEL,
  type DailyDay, type DailyItem, type DayNoteKind,
} from './model'

// «Compra del día» (plan v2 §2.2 y v2.1): la única rutina obligatoria de la tesis. El
// dueño la llena al volver de comprar. «Compraste» empieza vacío y la compra de
// referencia se ofrece con [Usar]: un toque, pero cada compra registrada es una que el
// dueño confirmó. Meta: 5 insumos en ≤ 60 s desde el celular.

interface Row {
  opening: string
  wasted: string
  purchased: string
  price: string
  total: string
  // Si el total se escribió a mano manda sobre cantidad × precio
  totalEdited: boolean
  supplier: string
  showSupplier: boolean
}

const num = (n: number | null | undefined) => (n === null || n === undefined ? '' : String(n))
// Mostrar con punto, como el resto del sistema; al escribir se acepta coma o punto
const qty = (n: number) => String(Number(n.toFixed(2)))
const money = (n: number) => n.toFixed(2)

function rowFrom(item: DailyItem, saved: boolean): Row {
  const price = item.unitPrice ?? item.suggestion.unitPrice
  if (saved) {
    const auto = item.purchased > 0 && price !== null ? Math.round(item.purchased * price * 100) / 100 : null
    return {
      opening: num(item.opening),
      wasted: item.wasted > 0 ? num(item.wasted) : '0',
      purchased: item.purchased > 0 ? num(item.purchased) : '',
      price: num(price),
      total: num(item.totalCost),
      totalEdited: item.totalCost !== null && item.totalCost !== auto,
      supplier: item.supplier ?? item.suggestion.supplier ?? '',
      showSupplier: false,
    }
  }
  return {
    opening: '',
    wasted: '0',
    purchased: '',
    price: num(price),
    total: '',
    totalEdited: false,
    supplier: item.suggestion.supplier ?? '',
    showSupplier: false,
  }
}

function NumberCell({ label, value, onChange, unit, highlight }: {
  label: string; value: string; onChange: (v: string) => void; unit: string; highlight?: boolean
}) {
  return (
    <label className="block min-w-0">
      <span className="text-[11px] font-semibold text-[#64748B] block mb-1">{label}</span>
      <div className={`flex items-center rounded-xl border-2 transition-colors ${highlight ? 'border-[#0077B6]/40 bg-white' : 'border-transparent bg-[#EEF3F8]'} focus-within:border-[#0077B6]`}>
        <input value={value} onChange={e => onChange(e.target.value)} onFocus={e => e.target.select()}
          inputMode="decimal" placeholder="—"
          className="w-full min-w-0 bg-transparent px-2.5 py-3 text-base font-bold text-right focus:outline-none" />
        <span className="pr-2 text-[11px] text-[#94A3B8] shrink-0">{unit}</span>
      </div>
    </label>
  )
}

export default function DailyTab() {
  const pushToast = useToastStore(s => s.push)
  const today = localDateString()

  const [date, setDate] = useState(today)
  const [day, setDay] = useState<DailyDay | null>(null)
  const [rows, setRows] = useState<Record<number, Row>>({})
  const [notes, setNotes] = useState<{ kind: DayNoteKind; text: string }[]>([])
  const [noteKind, setNoteKind] = useState<DayNoteKind | null>(null)
  const [noteText, setNoteText] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const apply = (d: DailyDay) => {
    setDay(d)
    setRows(Object.fromEntries(d.items.map(i => [i.supplyId, rowFrom(i, d.saved)])))
    setNotes(d.notes.map(n => ({ kind: n.kind, text: n.text ?? '' })))
    setNoteKind(null)
    setNoteText('')
  }

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const { data } = await api.get<DailyDay>('/inventory/daily', { params: { date } })
      apply(data)
    } catch (err) {
      pushToast({ variant: 'error', title: 'No se pudo cargar la compra del día', message: errorMessage(err, 'Verifica la conexión.') })
    } finally {
      setLoading(false)
    }
  }, [date, pushToast])

  useEffect(() => { load() }, [load])

  const update = (id: number, patch: Partial<Row>) => setRows(r => ({ ...r, [id]: { ...r[id], ...patch } }))

  // Total mostrado: el escrito a mano o cantidad × precio
  const totalOf = (r: Row) => {
    if (r.totalEdited) return parseNumber(r.total)
    const q = parseNumber(r.purchased)
    const p = parseNumber(r.price)
    return q !== null && p !== null ? Math.round(q * p * 100) / 100 : null
  }

  const errors = (day?.items ?? []).flatMap(item => {
    const r = rows[item.supplyId]
    if (!r) return []
    const values = [r.opening, r.wasted, r.purchased, r.price].map(parseNumber)
    if ([r.opening, r.wasted, r.purchased, r.price].some((v, i) => v.trim() !== '' && (values[i] === null || values[i]! < 0))) {
      return [`${item.name}: revisa los números`]
    }
    const q = parseNumber(r.purchased) ?? 0
    if (q > 0 && totalOf(r) === null) return [`${item.name}: falta el precio`]
    return []
  })

  const addNote = () => {
    if (!noteKind) return
    setNotes(n => [...n, { kind: noteKind, text: noteText.trim() }])
    setNoteKind(null)
    setNoteText('')
  }

  const save = async () => {
    if (!day || errors.length > 0) return
    setSaving(true)
    try {
      const items = day.items.map(item => {
        const r = rows[item.supplyId]
        const purchased = parseNumber(r.purchased) ?? 0
        return {
          supplyId: item.supplyId,
          opening: parseNumber(r.opening),
          wasted: parseNumber(r.wasted) ?? 0,
          purchased,
          unitPrice: purchased > 0 ? parseNumber(r.price) : null,
          totalCost: purchased > 0 ? totalOf(r) : null,
          supplier: purchased > 0 ? r.supplier.trim() || null : null,
        }
      })
      // Una nota elegida pero sin "Agregar" también se guarda
      const allNotes = noteKind ? [...notes, { kind: noteKind, text: noteText.trim() }] : notes
      const { data } = await api.post<DailyDay>('/inventory/daily', {
        date,
        items,
        notes: allNotes.map(n => ({ kind: n.kind, text: n.text || null })),
      })
      const bought = items.filter(i => i.purchased > 0)
      const spent = bought.reduce((t, i) => t + (i.totalCost ?? 0), 0)
      pushToast({
        variant: 'success',
        title: day.saved ? 'Compra del día corregida' : 'Compra del día guardada',
        message: bought.length > 0 ? `${bought.length} compras · S/ ${money(spent)}` : 'Sin compras',
      })
      apply(data)
    } catch (err) {
      pushToast({ variant: 'error', title: 'No se pudo guardar', message: errorMessage(err) })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-3">
      <div className="bg-white rounded-2xl shadow-sm p-4 space-y-2">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="font-black text-[#0F172A]">Compra del día</h2>
            <p className="text-xs text-[#64748B]">Al volver de comprar. Viene prellenado: corrige solo lo que cambió.</p>
          </div>
          <input type="date" value={date} min={day?.minDate} max={today}
            onChange={e => setDate(e.target.value || today)}
            className="shrink-0 w-[9.5rem] bg-[#EEF3F8] rounded-xl px-3 py-2 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-[#0077B6]/30" />
        </div>
        {day?.saved && (
          <p className="flex items-center gap-1.5 text-xs font-semibold text-emerald-700">
            <Check size={14} /> Ya registrada · guardar otra vez la corrige
          </p>
        )}
      </div>

      {!loading && day?.saved && <StartedWith day={day} />}

      {loading || !day ? (
        <div className="py-10 flex justify-center"><Loader2 className="animate-spin text-[#0077B6]" /></div>
      ) : day.items.length === 0 ? (
        <p className="bg-white rounded-2xl shadow-sm p-4 text-sm text-[#64748B]">
          No hay insumos críticos. El dueño los marca en la pestaña Insumos.
        </p>
      ) : (
        <>
          {day.items.map(item => {
            const r = rows[item.supplyId]
            if (!r) return null
            const unit = UNIT_LABEL[item.unit]
            const bought = (parseNumber(r.purchased) ?? 0) > 0
            const total = totalOf(r)
            return (
              <div key={item.supplyId} className="bg-white rounded-2xl shadow-sm p-3.5 space-y-2.5">
                <p className="font-black text-[#0F172A]">{item.name}</p>
                <div className="grid grid-cols-3 gap-2">
                  <NumberCell label="Quedaba" unit={unit} value={r.opening} onChange={v => update(item.supplyId, { opening: v })} />
                  <NumberCell label="Botaste" unit={unit} value={r.wasted} onChange={v => update(item.supplyId, { wasted: v })} />
                  <NumberCell label="Compraste" unit={unit} value={r.purchased} highlight
                    onChange={v => update(item.supplyId, { purchased: v })} />
                </div>
                {!bought && item.suggestion.purchased !== null && item.suggestion.purchased > 0 && (
                  <button onClick={() => update(item.supplyId, { purchased: num(item.suggestion.purchased) })}
                    className="w-full flex items-center justify-between gap-2 rounded-xl bg-[#EEF3F8] px-3 py-2 text-xs text-[#64748B]">
                    <span className="truncate">
                      {item.suggestion.fromDate ? `El ${formatLocalDate(item.suggestion.fromDate)}` : 'La última vez'} compraste{' '}
                      <b className="text-[#0F172A]">{qty(item.suggestion.purchased)} {unit}</b>
                      {item.suggestion.unitPrice !== null ? ` a S/ ${money(item.suggestion.unitPrice)}` : ''}
                    </span>
                    <span className="shrink-0 font-bold text-[#0077B6]">Usar</span>
                  </button>
                )}
                {bought && (
                  <div className="grid grid-cols-2 gap-2">
                    <NumberCell label={`Precio por ${unit}`} unit="S/" value={r.price}
                      onChange={v => update(item.supplyId, { price: v, totalEdited: false })} />
                    <NumberCell label="Total" unit="S/" value={r.totalEdited ? r.total : num(total)}
                      onChange={v => update(item.supplyId, { total: v, totalEdited: true })} />
                  </div>
                )}
                {bought && (r.showSupplier ? (
                  <input value={r.supplier} onChange={e => update(item.supplyId, { supplier: e.target.value })} maxLength={80}
                    placeholder="Proveedor o puesto" autoFocus
                    className="w-full bg-[#EEF3F8] rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#0077B6]/30" />
                ) : (
                  <button onClick={() => update(item.supplyId, { showSupplier: true })}
                    className="text-xs font-semibold text-[#0077B6]">
                    {r.supplier ? `Proveedor: ${r.supplier} · cambiar` : '+ proveedor'}
                  </button>
                ))}
              </div>
            )
          })}

          <p className="px-1 text-[11px] text-[#94A3B8]">
            Lo que botaste cuenta como merma del {formatLocalDate(day.wasteDate)} (último día con ventas).
          </p>

          <div className="bg-white rounded-2xl shadow-sm p-3.5 space-y-2.5">
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

          {errors.length > 0 && <p className="px-1 text-xs font-semibold text-red-600">{errors[0]}</p>}

          <button onClick={save} disabled={saving || errors.length > 0}
            className="w-full bg-[#0077B6] hover:bg-[#005a8a] text-white font-bold py-4 rounded-xl shadow-md disabled:opacity-40 flex items-center justify-center gap-2 transition-colors">
            {saving && <Loader2 size={16} className="animate-spin" />}
            Guardar
          </button>
        </>
      )}
    </div>
  )
}

// Lo que había al abrir, con lo ya guardado: quedaba (contado después de botar lo
// malogrado) + compraste. En la fase 0 no descuenta ventas: eso requiere recetas y
// es la intervención de la fase 2. Solo refleja lo que el dueño registró.
function StartedWith({ day }: { day: DailyDay }) {
  const rows = day.items.map(i => ({
    id: i.supplyId,
    name: i.name,
    unit: UNIT_LABEL[i.unit],
    total: i.opening === null && i.purchased === 0 ? null : (i.opening ?? 0) + i.purchased,
    uncounted: i.opening === null && i.purchased > 0,
  }))
  const anyUncounted = rows.some(r => r.uncounted)
  return (
    <div className="bg-white rounded-2xl shadow-sm p-4">
      <h3 className="font-black text-[#0F172A]">Hoy empezaste con</h3>
      <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1.5">
        {rows.map(r => (
          <div key={r.id} className="flex items-baseline justify-between gap-2 text-sm">
            <span className="text-[#64748B] truncate">{r.name}</span>
            <span className="font-bold text-[#0F172A] shrink-0">
              {r.total === null ? '—' : `${qty(r.total)} ${r.unit}${r.uncounted ? '*' : ''}`}
            </span>
          </div>
        ))}
      </div>
      <p className="mt-2 text-[11px] text-[#94A3B8]">
        Quedaba + compraste. No descuenta lo vendido durante el día.
        {anyUncounted ? ' * Sin contar lo que quedaba.' : ''}
      </p>
    </div>
  )
}
