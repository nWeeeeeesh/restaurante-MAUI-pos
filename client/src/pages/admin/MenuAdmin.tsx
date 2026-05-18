import { useEffect, useState } from 'react'
import api from '../../api/client'
import { useToastStore } from '../../store/toast'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { Trash2, Pencil } from 'lucide-react'

interface Category { id: number; name: string; displayOrder: number; active: boolean }
interface Dish { id: number; categoryId: number; name: string; description: string | null; price: number; available: boolean; hasSpiceLevel: boolean }

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
  const [deleting, setDeleting] = useState(false)

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

  const filteredDishes = dishes.filter(d => d.categoryId === selectedCat)

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
      // El backend devuelve { deactivated: true } si tiene historial — soft-delete
      if (data?.deactivated) {
        toast({
          variant: 'info',
          title: 'Plato desactivado',
          message: 'Tiene pedidos históricos, se marcó como no disponible en lugar de eliminarlo.',
          durationMs: 5000,
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
              </div>
            ))}
          </div>
        </div>

        {/* Add / Edit panel */}
        <div className="space-y-4">
          {editingDish ? (
            <div className="bg-white rounded-xl border border-[#0077B6] p-4">
              <h3 className="text-sm font-semibold text-[#1E1E2E] mb-3">Editar: {editingDish.name}</h3>
              <div className="space-y-3">
                <div>
                  <label className="text-xs font-medium text-gray-500 block mb-1">Precio (S/)</label>
                  <input
                    type="number"
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
      </div>

      <ConfirmDialog
        open={!!pendingDelete}
        title={pendingDelete ? `¿Eliminar "${pendingDelete.name}"?` : ''}
        message={'Si el plato tiene pedidos históricos, no se borrará — se marcará como no disponible para preservar los registros de ventas.'}
        confirmLabel="Eliminar"
        variant="danger"
        loading={deleting}
        onConfirm={performDelete}
        onCancel={() => !deleting && setPendingDelete(null)}
      />
    </div>
  )
}
