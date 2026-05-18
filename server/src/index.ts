import express from 'express'
import { createServer } from 'http'
import { Server } from 'socket.io'
import cors from 'cors'
import path from 'path'
import { existsSync } from 'fs'
import * as dotenv from 'dotenv'
dotenv.config()

import authRoutes from './routes/auth'
import menuRoutes from './routes/menu'
import ordersRoutes from './routes/orders'
import billsRoutes from './routes/bills'
import reportsRoutes from './routes/reports'
import printRoutes from './routes/print'
import tablesRoutes from './routes/tables'
import splitRoutes from './routes/split'
import usersRoutes from './routes/users'
import { applyStartupMigrations } from './db/migrate'

const app = express()
const httpServer = createServer(app)

export const io = new Server(httpServer, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
})

app.use(cors())
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

app.get('/api/health', (_req, res) => res.json({ status: 'ok', app: 'MauiDesk' }))

// Servir el cliente compilado en producción.
// Buscamos client/dist primero (build de Vite) — la ruta es relativa al cwd del servidor.
const clientDist = path.resolve(__dirname, '..', '..', 'client', 'dist')
if (existsSync(clientDist)) {
  app.use(express.static(clientDist))
  // SPA fallback: cualquier ruta que no sea /api o /socket.io devuelve index.html
  app.get(/^(?!\/api|\/socket\.io).*/, (_req, res) => {
    res.sendFile(path.join(clientDist, 'index.html'))
  })
  console.log(`Serving client from ${clientDist}`)
}

io.on('connection', (socket) => {
  console.log(`Socket connected: ${socket.id}`)
  socket.on('disconnect', () => console.log(`Socket disconnected: ${socket.id}`))
})

const PORT = process.env.PORT || 3001
applyStartupMigrations()
  .then(() => httpServer.listen(PORT, () => console.log(`MauiDesk server running on port ${PORT}`)))
  .catch(err => {
    console.error('Failed to apply startup migrations:', err)
    httpServer.listen(PORT, () => console.log(`MauiDesk server running on port ${PORT} (WITHOUT migrations)`))
  })
