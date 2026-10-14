import express from 'express'
import cors from 'cors'
import path from 'path'
import { existsSync } from 'fs'

import authRoutes from './routes/auth'
import menuRoutes from './routes/menu'
import ordersRoutes from './routes/orders'
import billsRoutes from './routes/bills'
import reportsRoutes from './routes/reports'
import printRoutes from './routes/print'
import tablesRoutes from './routes/tables'
import splitRoutes from './routes/split'
import usersRoutes from './routes/users'
import inventoryRoutes from './routes/inventory'
import { errorHandler } from './middleware/error'

export type AllowedOrigins = string[] | '*'

// Arma la app Express sin escuchar ni migrar: index.ts hace el bootstrap y los
// tests HTTP usan esta función directamente.
export function createApp(opts: { allowedOrigins: AllowedOrigins; serveClient?: boolean }) {
  const { allowedOrigins, serveClient = true } = opts
  const app = express()

  app.use(cors({
    origin: allowedOrigins === '*' ? '*' : allowedOrigins,
    credentials: allowedOrigins !== '*',
  }))
  app.use(express.json())

  app.use('/api/auth', authRoutes)
  app.use('/api/menu', menuRoutes)
  app.use('/api/orders', ordersRoutes)
  app.use('/api/orders/:id/split', splitRoutes)
  app.use('/api/bills', billsRoutes)
  app.use('/api/reports', reportsRoutes)
  app.use('/api/print', printRoutes)
  app.use('/api/tables', tablesRoutes)
  app.use('/api/users', usersRoutes)
  app.use('/api/inventory', inventoryRoutes)

  app.get('/api/health', (_req, res) => res.json({ status: 'ok', app: 'MauiDesk' }))

  // Rutas /api inexistentes: JSON en vez de la página HTML por defecto.
  app.use('/api', (_req, res) => { res.status(404).json({ error: 'Ruta no encontrada', code: 'NOT_FOUND' }) })

  // Servir el cliente compilado en producción (client/dist relativo a este archivo).
  const clientDist = path.resolve(__dirname, '..', '..', 'client', 'dist')
  if (serveClient && existsSync(clientDist)) {
    app.use(express.static(clientDist))
    // SPA fallback: cualquier ruta que no sea /api o /socket.io devuelve index.html
    app.get(/^(?!\/api|\/socket\.io).*/, (_req, res) => {
      res.sendFile(path.join(clientDist, 'index.html'))
    })
    console.log(`Serving client from ${clientDist}`)
  }

  app.use(errorHandler)
  return app
}
