import { auditLog } from '../db/schema'
import type { Executor } from '../db'

export interface AuditEntry {
  userId: number
  action: string
  entity: string
  entityId?: number | null
  data?: unknown
}

// Se llama con la transacción de la operación: si la operación se revierte,
// el registro también; si se confirma, queda constancia de quién, cuándo y por qué.
export async function audit(db: Executor, entry: AuditEntry) {
  await db.insert(auditLog).values({
    userId: entry.userId,
    action: entry.action,
    entity: entry.entity,
    entityId: entry.entityId ?? null,
    data: entry.data === undefined ? null : JSON.stringify(entry.data),
  })
}
