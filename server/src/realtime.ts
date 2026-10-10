import type { Server } from 'socket.io'

// Punto único para emitir eventos en tiempo real. Los routers importaban `io`
// desde index.ts (dependencia circular: importar un router arrancaba el servidor).
// Sin `io` configurado (tests) las emisiones no hacen nada.
let io: Server | null = null

export function setIo(server: Server) {
  io = server
}

export function emit(event: string, payload: unknown) {
  io?.emit(event, payload)
}

// Corta las conexiones de un usuario (p. ej., al inhabilitarlo o cambiarle el rol)
// para que deje de recibir eventos sin esperar a que expire su token.
export function disconnectUser(userId: number) {
  if (!io) return
  for (const socket of io.sockets.sockets.values()) {
    if (socket.data.user?.id === userId) socket.disconnect(true)
  }
}
