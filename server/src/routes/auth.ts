import { Router } from 'express'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { eq } from 'drizzle-orm'
import { db } from '../db'
import { users } from '../db/schema'
import { requireAuth } from '../middleware/auth'
import { validateBody } from '../middleware/validate'
import { LoginSchema } from '../schemas/auth'

const router = Router()

// Límite de intentos fallidos por IP + usuario (TD-15). En memoria: el servidor es
// un único proceso y, si se reinicia, perder el contador es aceptable.
const MAX_FAILURES = 5
const WINDOW_MS = 5 * 60 * 1000
const failures = new Map<string, { count: number; firstAt: number }>()

function attemptKey(ip: string | undefined, username: string) {
  return `${ip ?? '?'}|${username.toLowerCase()}`
}

function isBlocked(key: string) {
  const entry = failures.get(key)
  if (!entry) return false
  if (Date.now() - entry.firstAt > WINDOW_MS) { failures.delete(key); return false }
  return entry.count >= MAX_FAILURES
}

function registerFailure(key: string) {
  const entry = failures.get(key)
  if (!entry || Date.now() - entry.firstAt > WINDOW_MS) failures.set(key, { count: 1, firstAt: Date.now() })
  else entry.count++
  // Evita que el mapa crezca sin límite con intentos de usuarios inventados
  if (failures.size > 1000) {
    for (const [k, v] of failures) if (Date.now() - v.firstAt > WINDOW_MS) failures.delete(k)
  }
}

router.post('/login', validateBody(LoginSchema), async (req, res) => {
  const { username, password } = req.body
  const key = attemptKey(req.ip, username)
  if (isBlocked(key)) {
    res.status(429).json({ error: 'Demasiados intentos. Espera unos minutos.', code: 'TOO_MANY_ATTEMPTS' })
    return
  }

  const [user] = await db.select().from(users).where(eq(users.username, username))
  const valid = !!user && user.active !== false && await bcrypt.compare(password, user.passwordHash)
  if (!user || !valid) {
    registerFailure(key)
    res.status(401).json({ error: 'Credenciales inválidas' })
    return
  }
  failures.delete(key)

  const token = jwt.sign(
    { id: user.id, username: user.username, role: user.role, name: user.name },
    process.env.JWT_SECRET!,
    { expiresIn: '12h' }
  )

  res.json({ token, user: { id: user.id, name: user.name, username: user.username, role: user.role } })
})

router.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.user })
})

export default router
