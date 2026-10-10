import type { Request, Response, NextFunction } from 'express'
import { DomainError } from '../errors'
import { isBusyError } from '../db/write-lock'

// Manejador global: sin él, Express responde las excepciones con su página HTML
// por defecto (con stack si NODE_ENV≠production). Siempre devolvemos JSON.
export function errorHandler(err: unknown, req: Request, res: Response, next: NextFunction) {
  if (res.headersSent) { next(err); return }

  if (err instanceof DomainError) {
    res.status(err.statusCode).json({ error: err.message, code: err.code, details: err.details })
    return
  }
  if (isBusyError(err)) {
    res.status(503).json({ error: 'Servidor ocupado, reintenta en unos segundos', code: 'DB_BUSY' })
    return
  }
  // JSON malformado en el body (lo lanza express.json())
  if ((err as { type?: string })?.type === 'entity.parse.failed') {
    res.status(400).json({ error: 'JSON inválido', code: 'INVALID_JSON' })
    return
  }

  console.error('[error]', req.method, req.originalUrl, err)
  res.status(500).json({ error: 'Error interno', code: 'INTERNAL' })
}
