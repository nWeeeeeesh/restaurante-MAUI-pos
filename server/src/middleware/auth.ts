import { Request, Response, NextFunction } from 'express'
import jwt from 'jsonwebtoken'
import { eq } from 'drizzle-orm'
import { db } from '../db'
import { users } from '../db/schema'

export interface AuthPayload {
  id: number
  username: string
  role: 'owner' | 'manager' | 'cashier' | 'waiter'
  name: string
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthPayload
    }
  }
}

// Verifica el JWT y además que el usuario siga activo, tomando rol y nombre de la
// BD (TD-13). Antes el rol viajaba en el token: un usuario inhabilitado o degradado
// conservaba sus permisos hasta 12 h. Es una consulta por PK por request.
export async function resolveSessionUser(token: string): Promise<AuthPayload | null> {
  let payload: AuthPayload
  try {
    payload = jwt.verify(token, process.env.JWT_SECRET!) as AuthPayload
  } catch {
    return null
  }
  const [user] = await db.select().from(users).where(eq(users.id, payload.id))
  if (!user || user.active === false) return null
  return { id: user.id, username: user.username, role: user.role, name: user.name }
}

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const token = req.headers.authorization?.split(' ')[1]
  if (!token) {
    res.status(401).json({ error: 'No autorizado' })
    return
  }
  const user = await resolveSessionUser(token)
  if (!user) {
    res.status(401).json({ error: 'Sesión no válida' })
    return
  }
  req.user = user
  next()
}

export function requireRole(...roles: AuthPayload['role'][]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user || !roles.includes(req.user.role)) {
      res.status(403).json({ error: 'Sin permisos' })
      return
    }
    next()
  }
}
