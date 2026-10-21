import { asc, eq, isNotNull } from 'drizzle-orm'
import { db, type Executor } from '../db'
import { studyConfig, supplies, STUDY_GROUPS } from '../db/schema'
import { withWriteLock } from '../db/write-lock'
import { DomainError } from '../errors'
import { audit } from './audit'
import type { StudyConfigInput } from '../schemas/inventory'
import {
  activationDate, globalIndicatorsVisibleIn, isGroupActiveIn, limaDate,
  STUDY_KEYS, type StudyConfig, type StudyGroup, type StudyKey,
} from '../utils/study'

// Configuración del estudio de la tesis (plan v3 §2.3). Las reglas puras están en
// utils/study.ts; aquí se leen y escriben en la BD. Toda la fase 2 debe preguntar
// por isGroupActive antes de mostrar algo (invariante 2).

export async function readStudyConfig(ex: Executor = db): Promise<StudyConfig> {
  const rows = await ex.select().from(studyConfig)
  const config: StudyConfig = {}
  for (const r of rows) {
    if ((STUDY_KEYS as readonly string[]).includes(r.key) && r.value !== null) config[r.key as StudyKey] = r.value
  }
  return config
}

export async function isGroupActive(group: StudyGroup, date: Date | string = new Date()): Promise<boolean> {
  return isGroupActiveIn(await readStudyConfig(), group, date)
}

export async function areGlobalIndicatorsVisible(date: Date | string = new Date()): Promise<boolean> {
  return globalIndicatorsVisibleIn(await readStudyConfig(), date)
}

export async function studyOverview(ex: Executor = db) {
  const config = await readStudyConfig(ex)
  const today = limaDate()
  const grouped = await ex.select({ code: supplies.code, group: supplies.studyGroup }).from(supplies)
    .where(isNotNull(supplies.studyGroup)).orderBy(asc(supplies.sortOrder), asc(supplies.id))
  return {
    today,
    config,
    groups: STUDY_GROUPS.map(group => ({
      group,
      activates_on: activationDate(config, group),
      active_today: isGroupActiveIn(config, group, today),
      supplies: grouped.filter(g => g.group === group).map(g => g.code ?? ''),
    })),
  }
}

// Guarda solo las claves enviadas (null borra la clave). Una fecha que ya llegó no
// se mueve: activar un grupo antes o después de lo registrado rompería el diseño.
export async function saveStudyConfig(input: StudyConfigInput, userId: number) {
  const today = limaDate()
  await withWriteLock(() => db.transaction(async (tx) => {
    const before = await readStudyConfig(tx)
    const changes = Object.entries(input) as [StudyKey, string | null | undefined][]

    for (const [key, value] of changes) {
      if (value === undefined || before[key] === (value ?? undefined)) continue
      const current = before[key]
      if (key.startsWith('activates_')) {
        if (current && current <= today) {
          throw new DomainError(`La activación de ${key.slice(10)} ya llegó (${current}): no se puede cambiar`, 409, 'study.activation_locked')
        }
        if (value && value < today) {
          throw new DomainError('No se puede activar un grupo con fecha pasada', 400, 'study.activation_in_past')
        }
      }
      if (key === 'baseline_starts_on' && current && current <= today) {
        throw new DomainError(`La línea base ya empezó (${current}): no se puede cambiar`, 409, 'study.baseline_locked')
      }
    }

    const after: StudyConfig = { ...before }
    for (const [key, value] of changes) {
      if (value === undefined) continue
      if (value === null) delete after[key]
      else after[key] = value
    }

    // Mariscos es el grupo de comparación: no recibe nada hasta terminar el estudio
    if (after.activates_mariscos && after.study_ends_on && after.activates_mariscos <= after.study_ends_on) {
      throw new DomainError('Mariscos debe activarse después del fin del estudio', 400, 'study.mariscos_before_end')
    }
    // El orden sorteado y las fechas deben decir lo mismo
    if (after.activation_order && after.activates_calamar && after.activates_pescado) {
      const [first, second] = after.activation_order.split(',') as StudyGroup[]
      if (activationDate(after, first)! >= activationDate(after, second)!) {
        throw new DomainError(`El orden sorteado (${after.activation_order}) no coincide con las fechas`, 400, 'study.order_mismatch')
      }
    }

    for (const [key, value] of changes) {
      if (value === undefined) continue
      await tx.delete(studyConfig).where(eq(studyConfig.key, key))
      if (value !== null) await tx.insert(studyConfig).values({ key, value, updatedBy: userId })
    }
    await audit(tx, { userId, action: 'study.configure', entity: 'study', entityId: null, data: { before, after } })
  }))
  return studyOverview()
}
