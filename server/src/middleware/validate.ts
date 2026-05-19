import { Request, Response, NextFunction } from 'express'
import type { ZodTypeAny } from 'zod'

// Middleware genérico para validar req.body contra un schema de Zod.
// Si la validación pasa, reemplaza req.body por el dato parseado (con coerciones
// y valores default aplicados) para que los handlers reciban data ya saneada.
export const validateBody = <T extends ZodTypeAny>(schema: T) =>
  (req: Request, res: Response, next: NextFunction): void => {
    const r = schema.safeParse(req.body)
    if (!r.success) {
      const issues = r.error.issues.map(i => ({
        path: i.path.join('.') || '(root)',
        message: i.message,
        code: i.code,
      }))
      res.status(400).json({ error: 'Validación fallida', issues })
      return
    }
    req.body = r.data
    next()
  }

// Variante para validar query params (algunas rutas usan ?period=today&from=...).
export const validateQuery = <T extends ZodTypeAny>(schema: T) =>
  (req: Request, res: Response, next: NextFunction): void => {
    const r = schema.safeParse(req.query)
    if (!r.success) {
      const issues = r.error.issues.map(i => ({
        path: i.path.join('.') || '(root)',
        message: i.message,
        code: i.code,
      }))
      res.status(400).json({ error: 'Parámetros inválidos', issues })
      return
    }
    // No reasignamos req.query (es read-only en Express 5).
    // El handler puede re-parsear con el mismo schema si necesita los valores transformados.
    next()
  }
