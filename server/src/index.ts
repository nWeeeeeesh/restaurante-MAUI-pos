import { createServer } from 'http'
import { Server } from 'socket.io'
import jwt from 'jsonwebtoken'
import * as dotenv from 'dotenv'
dotenv.config()

import type { AuthPayload } from './middleware/auth'
import { createApp, type AllowedOrigins } from './app'
import { applyStartupMigrations } from './db/migrate'
import { setIo } from './realtime'

// ── Validación de configuración crítica al startup ────────────────────────
// JWT_SECRET es obligatorio y debe ser largo. Sin esto, todo el flujo de auth
// queda silenciosamente roto: el server arranca, pero jwt.sign falla en runtime.
const JWT_SECRET = process.env.JWT_SECRET
if (!JWT_SECRET) {
  console.error('[FATAL] JWT_SECRET no está definido. Configurá la variable en server/.env')
  process.exit(1)
}
if (JWT_SECRET.length < 32) {
  console.error(`[FATAL] JWT_SECRET es demasiado corto (${JWT_SECRET.length} chars). Mínimo 32 chars.`)
  console.error('        Generá uno con: node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'hex\'))"')
  process.exit(1)
}

// ── CORS allowlist ────────────────────────────────────────────────────────
// ALLOWED_ORIGINS es una lista separada por comas. Si no está seteada, en dev
// permitimos los puertos locales típicos. Usar "*" solo si lo configurás
// explícitamente (ej: redes LAN dinámicas).
const DEFAULT_DEV_ORIGINS = ['http://localhost:5173', 'http://localhost:3001']
const rawOrigins = (process.env.ALLOWED_ORIGINS ?? '').trim()
const allowedOrigins: AllowedOrigins = rawOrigins === '*'
  ? '*'
  : rawOrigins
    ? rawOrigins.split(',').map(s => s.trim()).filter(Boolean)
    : DEFAULT_DEV_ORIGINS

if (allowedOrigins !== '*' && allowedOrigins.length === 0) {
  console.error('[FATAL] ALLOWED_ORIGINS está vacío. Definí orígenes válidos o usá "*".')
  process.exit(1)
}

const app = createApp({ allowedOrigins })
const httpServer = createServer(app)

const io = new Server(httpServer, {
  cors: {
    origin: allowedOrigins,
    methods: ['GET', 'POST'],
    credentials: allowedOrigins !== '*',
  },
})
setIo(io)

// C3: middleware de autenticación para Socket.io. Antes, cualquier cliente sin
// token podía conectarse y escuchar todos los eventos (order:new, kitchen:print-result, etc).
// Ahora se exige un JWT válido en el handshake (mismo que se usa para REST).
io.use((socket, next) => {
  const token = socket.handshake.auth?.token
  if (typeof token !== 'string' || !token) {
    return next(new Error('Unauthorized: missing token'))
  }
  try {
    const payload = jwt.verify(token, JWT_SECRET) as AuthPayload
    socket.data.user = payload
    next()
  } catch {
    next(new Error('Unauthorized: invalid token'))
  }
})

io.on('connection', (socket) => {
  const user = socket.data.user as AuthPayload | undefined
  console.log(`Socket connected: ${socket.id} (user ${user?.username ?? '?'} / ${user?.role ?? '?'})`)
  socket.on('disconnect', () => console.log(`Socket disconnected: ${socket.id}`))
})

const PORT = process.env.PORT || 3001
applyStartupMigrations()
  .then(() => httpServer.listen(PORT, () => console.log(`MauiDesk server running on port ${PORT}`)))
  .catch(err => {
    console.error('Failed to apply startup migrations:', err)
    httpServer.listen(PORT, () => console.log(`MauiDesk server running on port ${PORT} (WITHOUT migrations)`))
  })
