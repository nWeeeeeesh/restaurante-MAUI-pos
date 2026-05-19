import { io as ioClient } from 'socket.io-client'
import { useConnectionStore } from '../store/connection'

// Pasamos el token JWT en el handshake. El servidor lo valida en io.use(...)
// y rechaza la conexión si falta o es inválido. La forma de función se invoca
// en cada conexión, así que login/logout/refresh funcionan sin recrear el socket.
export const socket = ioClient({
  autoConnect: false,
  transports: ['websocket', 'polling'],
  auth: (cb) => {
    const token = localStorage.getItem('mauideskToken')
    cb({ token: token ?? '' })
  },
})

// Observabilidad de conexión: alimenta el store que el banner global lee.
// `connecting` cubre el primer intento y los reintentos automáticos del cliente.
socket.on('connect', () => useConnectionStore.getState().set('connected'))
socket.on('disconnect', (reason: string) => {
  // Si el servidor cerró la conexión deliberadamente (logout / token inválido),
  // no mostramos banner de reconexión: el flujo de auth ya redirige a /login.
  if (reason === 'io server disconnect' || reason === 'io client disconnect') {
    useConnectionStore.getState().set('idle')
  } else {
    useConnectionStore.getState().set('disconnected', reason)
  }
})
socket.on('connect_error', (err: Error) => {
  useConnectionStore.getState().set('connecting', err?.message ?? 'connect_error')
})
socket.io.on('reconnect_attempt', () => useConnectionStore.getState().set('connecting'))
