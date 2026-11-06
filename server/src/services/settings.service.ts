import { eq } from 'drizzle-orm'
import type { Executor } from '../db'
import { appSettings } from '../db/schema'
import { audit } from './audit'
import { SETTING_KEYS, type SettingKey, type Settings } from '../domain/settings'
import type { SettingsInput } from '../schemas/settings'

// Ajustes del local (plan-sistema T2). La escritura va dentro de la transacción que
// abre la ruta, con su auditoría.

export async function readSettings(ex: Executor): Promise<Settings> {
  const rows = await ex.select().from(appSettings)
  const settings: Settings = {}
  for (const r of rows) {
    if ((SETTING_KEYS as readonly string[]).includes(r.key) && r.value !== null) settings[r.key as SettingKey] = r.value
  }
  return settings
}

// Guarda solo las claves enviadas (null borra la clave) y deja el antes y el después
export async function saveSettings(ex: Executor, input: SettingsInput, userId: number): Promise<Settings> {
  const before = await readSettings(ex)
  for (const [key, value] of Object.entries(input) as [SettingKey, string | null | undefined][]) {
    if (value === undefined) continue
    await ex.delete(appSettings).where(eq(appSettings.key, key))
    if (value !== null) await ex.insert(appSettings).values({ key, value, updatedBy: userId })
  }
  const after = await readSettings(ex)
  await audit(ex, { userId, action: 'settings.update', entity: 'settings', entityId: null, data: { before, after } })
  return after
}
