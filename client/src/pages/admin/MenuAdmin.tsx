import { useEffect, useState } from 'react'
import api from '../../api/client'
import { useToastStore } from '../../store/toast'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { useAuthStore } from '../../store/auth'
import { Trash2, Pencil, ArchiveRestore } from 'lucide-react'

interface Category { id: number; name: string; displayOrder: number; active: boolean }
interface Dish { id: number; categoryId: number; name: string; description: string | null; price: number; available: boolean; archived: boolean | null; hasSpiceLevel: boolean }

export default function MenuAdmin() {
  const { push: toast } = useToastStore()

  const [categories, setCategories] = useState<Category[]>([])
  const [dishes, setDishes] = useState<Dish[]>([])
  const [selectedCat, setSelectedCat] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)

  // New dish form state
  const [form, setForm] = useState({ name: '', description: '', price: '', hasSpiceLevel: true })
  const [submitting, setSubmitting] = useState(false)
  const [editingDish, setEditingDish] = useState<Dish | null>(null)
  const [editPrice, setEditPrice] = useState('')
  const [editAvailable, setEditAvailable] = useState(true)

  const [pendingDelete, setPendingDelete] = useState<Dish | null>(null)
  // Matriz de permisos (plan v1.1): el encargado solo marca agotado/disponible
  const isOwner = useAuthStore(st => st.user?.role) === 'owner'
  const [togglingId, setTogglingId] = useState<number | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [restoringId, setRestoringId] = useState<number | null>(null)

  const load = async () => {
    setLoading(true)
    try {
      const { data } = await api.get('/menu/dishes')
      setCategories(data.categories)
      setDishes(data.dishes)
      if (!selectedCat && data.categories.length > 0) setSelectedCat(data.categories[0].id)
    } catch (e: any) {
      toast({ variant: 'error', title: 'No se pudo cargar el menú', message: e.response?.data?.error ?? 'Error de servidor' })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  // Los archivados (dados de baja con historial) van aparte: no son "agotados"
  const filteredDishes = dishes.filter(d => d.categoryId === selectedCat && !d.archived)
  const archivedDishes = dishes.filter(d => d.categoryId === selectedCat && d.archived)

  const restoreDish = async (dish: Dish) => {
    setRestoringId(dish.id)
    try {
      await api.patch(`/menu/dishes/${dish.id}`, { archived: false })
      toast({ variant: 'success', title: `${dish.name}: restaurado`, message: 'Vuelve a aparecer en el menú y en el POS.' })
      load()
    } catch (err) {
      const message = (err as { response?: { data?: { error?: string } } })?.response?.data?.error
      toast({ variant: 'error', title: 'No se pudo restaurar', message: message ?? 'Error de servidor' })
    } finally {
      setRestoringId(null)
    }
  }

  const toggleAvailability = async (dish: Dish) => {
    setTogglingId(dish.id)
    try {
      await api.patch(`/menu/dishes/${dish.id}/availability`, { available: !dish.available })
      toast({ variant: 'success', title: dish.available ? `${dish.name}: agotado` : `${dish.name}: disponible` })
      load()
    } catch (err: any) {
      toast({ variant: 'error', title: 'No se pudo actualizar', message: err.response?.data?.error ?? 'Error de servidor' })
    } finally {
      setTogglingId(null)
    }
  }

  const handleAddDish = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedCat) return
    setSubmitting(true)
    try {
      await api.post('/menu/dishes', {
        categoryId: selectedCat,
        name: form.name,
        description: form.description || null,
        price: parseFloat(form.price),
        hasSpiceLevel: form.hasSpiceLevel,
      })
      setForm({ name: '', description: '', price: '', hasSpiceLevel: true })
      toast({ variant: 'success', title: 'Plato agregado' })
      load()
    } catch (err: any) {
      toast({ variant: 'error', title: 'No se pudo agregar el plato', message: err.response?.data?.error ?? 'Error de servidor' })
    } finally {
      setSubmitting(false)
    }
  }

  const handleSaveEdit = async () => {
    if (!editingDish) return
    setSubmitting(true)
    try {
      await api.patch(`/menu/dishes/${editingDish.id}`, {
        price: parseFloat(editPrice),
        available: editAvailable,
      })
      toast({ variant: 'success', title: 'Cambios guardados' })
      setEditingDish(null)
      load()
    } catch (err: any) {
      toast({ variant: 'error', title: 'No se pudo guardar', message: err.response?.data?.error ?? 'Error de servidor' })
    } finally {
      setSubmitting(false)
    }
  }

  const performDelete = async () => {
    if (!pendingDelete) return
    setDeleting(true)
    try {
      const { data } = await api.delete(`/menu/dishes/${pendingDelete.id}`)
      // Con historial el servidor lo archiva en vez de borrarlo (TD-31)
      if (data?.archived) {
        toast({
          variant: 'info',
          title: 'Plato archivado',
          message: 'Tiene pedidos históricos: ya no aparece en el menú ni en el POS. Puedes restaurarlo desde "Archivados".',
          durationMs: 6000,
        })
      } else {
        toast({ variant: 'success', title: 'Plato eliminado' })
      }
      // Si estábamos editando ese plato, cerramos el panel
      if (editingDish?.id === pendingDelete.id) setEditingDish(null)
      setPendingDelete(null)
      load()
    } catch (err: any) {
      toast({ variant: 'error', title: 'No se pudo eliminar', message: err.response?.data?.error ?? 'Error de servidor' })
    } finally {
      setDeleting(false)
    }
  }

  if (loading) return (
    <div className="flex items-center justify-center h-full text-gray-400">Cargando menú...</div>
  )

  return (
    <div className="p-3 sm:p-6 max-w-5xl mx-auto overflow-y-auto h-full">
      <h2 className="text-lg sm:text-xl font-bold text-[#1E1E2E] mb-4 sm:mb-6">Gestión de Menú</h2>

      {/* Category tabs */}
      <div className="flex flex-wrap gap-2 mb-4 sm:mb-6">
        {categories.map(cat => (
          <button
            key={cat.id}
            onClick={() => setSelectedCat(cat.id)}
            className={`px-4 py-2 rounded-full text-sm font-medium transition-colors ${
              selectedCat === cat.id
                ? 'bg-[#0077B6] text-white'
                : 'bg-white border border-gray-200 text-gray-600 hover:border-[#0077B6]'
            }`}
          >
            {cat.name}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
        {/* Dish list */}
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100 bg-gray-50">
            <span className="text-sm font-semibold text-gray-600">
              {categories.find(c => c.id === selectedCat)?.name} ({filteredDishes.length})
            </span>
          </div>
          <div className="divide-y divide-gray-100">
            {filteredDishes.length === 0 && (
              <p className="text-sm text-gray-400 p-4">No hay platos en esta categoría.</p>
            )}
            {filteredDishes.map(dish => (
              <div key={dish.id} className="flex items-center px-4 py-3 gap-3">
                <div className="flex-1 min-w-0">
                  <p className={`text-sm font-medium truncate ${!dish.available ? 'text-gray-400 line-through' : 'text-[#1E1E2E]'}`}>
                    {dish.name}
                  </p>
                  <p className="text-xs text-gray-400">{dish.description}</p>
                </div>
                <span className="text-sm font-semibold text-[#0077B6] shrink-0">
                  S/ {dish.price.toFixed(2)}
                </span>
                {dish.hasSpiceLevel && (
                  <span className="text-xs bg-orange-100 text-[#F4792B] px-1.5 py-0.5 rounded shrink-0">🌶</span>
                )}
                {isOwner ? (<>
                <button
                  onClick={() => { setEditingDish(dish); setEditPrice(dish.price.toString()); setEditAvailable(dish.available) }}
                  className="text-gray-400 hover:text-[#0077B6] shrink-0 p-1.5 rounded hover:bg-blue-50 transition-colors"
                  title="Editar plato"
                >
                  <Pencil size={14}/>
                </button>
                <button
                  onClick={() => setPendingDelete(dish)}
                  className="text-gray-400 hover:text-red-500 shrink-0 p-1.5 rounded hover:bg-red-50 transition-colors"
                  title="Eliminar plato"
                >
                  <Trash2 size={14}/>
                </button>
                </>) : (
                  <button onClick={() => toggleAvailability(dish)} disabled={togglingId === dish.id}
                    className={`text-xs font-bold px-2.5 py-1.5 rounded-lg shrink-0 disabled:opacity-50 ${dish.available ? 'bg-red-50 text-red-600 hover:bg-red-100' : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'}`}>
                    {dish.available ? 'Marcar agotado' : 'Habilitar'}
                  </button>
                )}
              </div>
            ))}
          </div>
          {isOwner && archivedDishes.length > 0 && (
            <details className="border-t border-gray-100">
              <summary className="px-4 py-3 text-xs font-semibold text-gray-500 cursor-pointer select-none">
                Archivados ({archivedDishes.length})
              </summary>
              <div className="divide-y divide-gray-100">
                {archivedDishes.map(dish => (
                  <div key={dish.id} className="flex items-center px-4 py-2.5 gap-3">
                    <p className="flex-1 min-w-0 text-sm text-gray-400 truncate">{dish.name}</p>
                    <button onClick={() => restoreDish(dish)} disabled={restoringId === dish.id}
                      className="flex items-center gap-1 text-xs font-bold px-2.5 py-1.5 rounded-lg shrink-0 bg-blue-50 text-[#0077B6] hover:bg-blue-100 disabled:opacity-50">
                      <ArchiveRestore size={13}/> Restaurar
                    </button>
                  </div>
                ))}
              </div>
            </details>
          )}
        </div>

        {/* Add / Edit panel */}
        {isOwner ? (
        <div className="space-y-4">
          {editingDish ? (
            <div className="bg-white rounded-xl border border-[#0077B6] p-4">
              <h3 className="text-sm font-semibold text-[#1E1E2E] mb-3">Editar: {editingDish.name}</h3>
              <div className="space-y-3">
                <div>
                  <label className="text-xs font-medium text-gray-500 block mb-1">Precio (S/)</label>
                  <input
                    type="number"
                    inputMode="decimal"
                    step="0.50"
                    value={editPrice}
                    onChange={e => setEditPrice(e.target.value)}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0077B6]"
                  />
                </div>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={editAvailable}
                    onChange={e => setEditAvailable(e.target.checked)}
                    className="accent-[#0077B6]"
                  />
                  <span className="text-sm text-gray-600">Disponible</span>
                </label>
                <div className="flex gap-2">
                  <button onClick={handleSaveEdit} disabled={submitting}
                    className="flex-1 bg-[#0077B6] text-white text-sm py-2 rounded-lg hover:bg-[#005f91] disabled:opacity-60">
                    {submitting ? 'Guardando...' : 'Guardar'}
                  </button>
                  <button onClick={() => setEditingDish(null)} disabled={submitting}
                    className="flex-1 border border-gray-200 text-gray-600 text-sm py-2 rounded-lg hover:bg-gray-50 disabled:opacity-60">
                    Cancelar
                  </button>
                </div>
                <button
                  onClick={() => setPendingDelete(editingDish)}
                  disabled={submitting}
                  className="w-full flex items-center justify-center gap-2 border-2 border-red-200 text-red-500 hover:bg-red-50 text-sm py-2 rounded-lg disabled:opacity-60 transition-colors"
                >
                  <Trash2 size={14}/> Eliminar plato
                </button>
              </div>
            </div>
          ) : (
            <div className="bg-white rounded-xl border border-gray-200 p-4">
              <h3 className="text-sm font-semibold text-[#1E1E2E] mb-3">Agregar plato</h3>
              <form onSubmit={handleAddDish} className="space-y-3">
                <input
                  type="text"
                  placeholder="Nombre del plato"
                  value={form.name}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  required
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0077B6]"
                />
                <input
                  type="text"
                  placeholder="Descripción (opcional)"
                  value={form.description}
                  onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0077B6]"
                />
                <input
                  type="number"
                  inputMode="decimal"
                  placeholder="Precio S/"
                  step="0.50"
                  value={form.price}
                  onChange={e => setForm(f => ({ ...f, price: e.target.value }))}
                  required
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0077B6]"
                />
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.hasSpiceLevel}
                    onChange={e => setForm(f => ({ ...f, hasSpiceLevel: e.target.checked }))}
                    className="accent-[#0077B6]"
                  />
                  <span className="text-sm text-gray-600">Tiene nivel de picante</span>
                </label>
                <button
                  type="submit"
                  disabled={submitting}
                  className="w-full bg-[#F4792B] hover:bg-[#d4621b] text-white text-sm font-medium py-2 rounded-lg transition-colors disabled:opacity-60"
                >
                  {submitting ? 'Agregando...' : '+ Agregar plato'}
                </button>
              </form>
            </div>
          )}
        </div>
        ) : (
          <div className="bg-white rounded-xl border border-gray-200 p-4 text-sm text-gray-600 h-fit">
            <p className="font-semibold text-[#1E1E2E] mb-1">Disponibilidad de platos</p>
            <p>Como encargado puedes marcar un plato como agotado o volver a habilitarlo. Los precios y las altas o bajas del menú los gestiona el dueño.</p>
          </div>
        )}
      </div>

      <ConfirmDialog
        open={!!pendingDelete}
        title={pendingDelete ? `¿Eliminar "${pendingDelete.name}"?` : ''}
        message={'Si el plato tiene pedidos históricos no se borra: se archiva (deja de aparecer en el menú y en el POS) para conservar los registros de ventas.'}
        confirmLabel="Eliminar"
        variant="danger"
        loading={deleting}
        onConfirm={performDelete}
        onCancel={() => !deleting && setPendingDelete(null)}
      />
    </div>
  )
}
