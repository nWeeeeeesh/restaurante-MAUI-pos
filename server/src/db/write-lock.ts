// Serializa las escrituras dentro del proceso.
//
// Con @libsql/client, dos transacciones de escritura simultáneas no se encolan:
// la segunda falla al instante con SQLITE_BUSY. Un `PRAGMA busy_timeout` no sirve
// porque se pierde tras cada transacción (la transacción se lleva la conexión y el
// cliente abre otra nueva sin el pragma; verificado con 0.17.3). Como el servidor
// es un único proceso Node, un mutex en memoria basta para ordenar las escrituras.
//
// Importante: no anidar withWriteLock (la llamada interna esperaría a la externa
// para siempre). Se toma una sola vez, en el borde del servicio.

let tail: Promise<unknown> = Promise.resolve()

export function withWriteLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = tail.then(() => withBusyRetry(fn))
  // La cola sigue aunque esta operación falle.
  tail = run.catch(() => undefined)
  return run
}

export function isBusyError(err: unknown): boolean {
  const e = err as { code?: string; message?: string } | undefined
  return e?.code === 'SQLITE_BUSY' || /SQLITE_BUSY|database is locked/i.test(String(e?.message ?? err ?? ''))
}

// Defensa para escrituras que no pasan por el candado (p. ej., ediciones de
// administración que coinciden con un cobro): reintenta ante SQLITE_BUSY.
export async function withBusyRetry<T>(fn: () => Promise<T>, delaysMs: number[] = [50, 100, 200]): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn()
    } catch (err) {
      if (!isBusyError(err) || attempt >= delaysMs.length) throw err
      await new Promise(r => setTimeout(r, delaysMs[attempt]))
    }
  }
}
