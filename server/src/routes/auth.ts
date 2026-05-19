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

router.post('/login', validateBody(LoginSchema), async (req, res) => {
  const { username, password } = req.body

  const [user] = await db.select().from(users).where(eq(users.username, username))
  if (!user || !user.active) {
    res.status(401).json({ error: 'Credenciales inválidas' })
    return
  }

  const valid = await bcrypt.compare(password, user.passwordHash)
  if (!valid) {
    res.status(401).json({ error: 'Credenciales inválidas' })
    return
  }

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
