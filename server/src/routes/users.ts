import { Router } from 'express'
import bcrypt from 'bcryptjs'
import { eq, and } from 'drizzle-orm'
import { db } from '../db'
import { users } from '../db/schema'
import { requireAuth, requireRole } from '../middleware/auth'

const router = Router()

const ROLES = ['owner', 'cashier', 'waiter'] as const
type Role = typeof ROLES[number]
const isValidRole = (r: any): r is Role => ROLES.includes(r)

function publicShape(u: typeof users.$inferSelect) {
  return {
    id: u.id, name: u.name, username: u.username,
    role: u.role, active: u.active, createdAt: u.createdAt,
  }
}

// POST /api/users/me/password — cambiar la propia contraseña.
// (Definida antes que /:id para evitar colisión con la ruta paramétrica.)
router.post('/me/password', requireAuth, async (req, res) => {
  const { currentPassword, newPassword } = req.body
  if (!currentPassword || !newPassword) {
    res.status(400).json({ error: 'Faltan campos' })
    return
  }
  if (String(newPassword).length < 4) {
    res.status(400).json({ error: 'La nueva contraseña debe tener al menos 4 caracteres' })
    return
  }
  const [u] = await db.select().from(users).where(eq(users.id, req.user!.id))
  if (!u) { res.status(404).json({ error: 'Usuario no encontrado' }); return }
  const valid = await bcrypt.compare(currentPassword, u.passwordHash)
  if (!valid) { res.status(401).json({ error: 'Contraseña actual incorrecta' }); return }
  const passwordHash = await bcrypt.hash(newPassword, 10)
  await db.update(users).set({ passwordHash }).where(eq(users.id, req.user!.id))
  res.json({ ok: true })
})

// GET /api/users — listar (solo owner)
router.get('/', requireAuth, requireRole('owner'), async (_req, res) => {
  const all = await db.select().from(users).orderBy(users.id)
  res.json(all.map(publicShape))
})

// POST /api/users — crear (solo owner)
router.post('/', requireAuth, requireRole('owner'), async (req, res) => {
  const { name, username, password, role } = req.body
  if (!name || !username || !password || !role) {
    res.status(400).json({ error: 'Nombre, usuario, contraseña y rol son requeridos' })
    return
  }
  if (String(password).length < 4) {
    res.status(400).json({ error: 'La contraseña debe tener al menos 4 caracteres' })
    return
  }
  if (!isValidRole(role)) {
    res.status(400).json({ error: 'Rol inválido' })
    return
  }
  const trimmedUsername = String(username).trim().toLowerCase()
  const dup = await db.select().from(users).where(eq(users.username, trimmedUsername))
  if (dup.length > 0) {
    res.status(409).json({ error: `El usuario "${trimmedUsername}" ya existe` })
    return
  }
  const passwordHash = await bcrypt.hash(password, 10)
  const [created] = await db.insert(users).values({
    name: String(name).trim(),
    username: trimmedUsername,
    passwordHash,
    role,
    active: true,
  }).returning()
  res.status(201).json(publicShape(created))
})

// PATCH /api/users/:id — actualizar nombre, rol, username, active (solo owner)
router.patch('/:id', requireAuth, requireRole('owner'), async (req, res) => {
  const id = Number(req.params.id)
  const { name, role, active, username } = req.body

  const updates: any = {}
  if (name !== undefined) updates.name = String(name).trim()
  if (role !== undefined) {
    if (!isValidRole(role)) { res.status(400).json({ error: 'Rol inválido' }); return }
    updates.role = role
  }
  if (active !== undefined) updates.active = !!active
  if (username !== undefined) {
    const trimmed = String(username).trim().toLowerCase()
    const dup = await db.select().from(users).where(eq(users.username, trimmed))
    if (dup.some(u => u.id !== id)) {
      res.status(409).json({ error: `El usuario "${trimmed}" ya existe` })
      return
    }
    updates.username = trimmed
  }
  if (Object.keys(updates).length === 0) {
    res.status(400).json({ error: 'Sin cambios' })
    return
  }

  // Salvaguarda: no quedarse sin owners activos.
  if (updates.active === false || (updates.role && updates.role !== 'owner')) {
    const [target] = await db.select().from(users).where(eq(users.id, id))
    if (target?.role === 'owner') {
      const activeOwners = await db.select().from(users)
        .where(and(eq(users.role, 'owner'), eq(users.active, true)))
      const others = activeOwners.filter(o => o.id !== id)
      if (others.length === 0) {
        res.status(400).json({ error: 'No puedes inhabilitar o degradar al último dueño activo' })
        return
      }
    }
  }

  await db.update(users).set(updates).where(eq(users.id, id))
  const [u] = await db.select().from(users).where(eq(users.id, id))
  if (!u) { res.status(404).json({ error: 'Usuario no encontrado' }); return }
  res.json(publicShape(u))
})

// POST /api/users/:id/password — cambiar contraseña de otro usuario (solo owner)
router.post('/:id/password', requireAuth, requireRole('owner'), async (req, res) => {
  const id = Number(req.params.id)
  const { password } = req.body
  if (!password || String(password).length < 4) {
    res.status(400).json({ error: 'La contraseña debe tener al menos 4 caracteres' })
    return
  }
  const [u] = await db.select().from(users).where(eq(users.id, id))
  if (!u) { res.status(404).json({ error: 'Usuario no encontrado' }); return }
  const passwordHash = await bcrypt.hash(password, 10)
  await db.update(users).set({ passwordHash }).where(eq(users.id, id))
  res.json({ ok: true })
})

export default router
