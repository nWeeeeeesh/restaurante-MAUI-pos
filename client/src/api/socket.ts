import { io as ioClient } from 'socket.io-client'

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
