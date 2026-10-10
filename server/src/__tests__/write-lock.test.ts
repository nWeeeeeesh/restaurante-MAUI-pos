import { describe, it, expect } from 'vitest'
import { withWriteLock, withBusyRetry, isBusyError } from '../db/write-lock'

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

describe('withWriteLock', () => {
  it('serializa operaciones concurrentes (no se solapan)', async () => {
    const log: string[] = []
    const op = (name: string) => withWriteLock(async () => {
      log.push(`${name}:inicio`)
      await sleep(20)
      log.push(`${name}:fin`)
      return name
    })
    const results = await Promise.all([op('a'), op('b'), op('c')])
    expect(results).toEqual(['a', 'b', 'c'])
    expect(log).toEqual(['a:inicio', 'a:fin', 'b:inicio', 'b:fin', 'c:inicio', 'c:fin'])
  })

  it('un error no bloquea la cola', async () => {
    await expect(withWriteLock(async () => { throw new Error('falla') })).rejects.toThrow('falla')
    await expect(withWriteLock(async () => 'sigue')).resolves.toBe('sigue')
  })
})

describe('withBusyRetry', () => {
  it('reintenta ante SQLITE_BUSY y termina bien', async () => {
    let calls = 0
    const result = await withBusyRetry(async () => {
      calls++
      if (calls < 3) throw Object.assign(new Error('SQLITE_BUSY: database is locked'), { code: 'SQLITE_BUSY' })
      return 'ok'
    }, [1, 1, 1])
    expect(result).toBe('ok')
    expect(calls).toBe(3)
  })

  it('no reintenta otros errores', async () => {
    let calls = 0
    await expect(withBusyRetry(async () => { calls++; throw new Error('otro') }, [1, 1])).rejects.toThrow('otro')
    expect(calls).toBe(1)
  })

  it('isBusyError reconoce el mensaje de libsql', () => {
    expect(isBusyError(new Error('SQLITE_BUSY: database is locked'))).toBe(true)
    expect(isBusyError(new Error('UNIQUE constraint failed'))).toBe(false)
  })
})
