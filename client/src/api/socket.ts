import { io as ioClient } from 'socket.io-client'

export const socket = ioClient({
  autoConnect: false,
  transports: ['websocket', 'polling'],
})
