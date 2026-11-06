// Reglas puras de los ajustes del local: sin BD, sin entorno, sin reloj.

export const SETTING_KEYS = ['second_local_opened_on'] as const
export type SettingKey = typeof SETTING_KEYS[number]
export type Settings = Partial<Record<SettingKey, string>>

// Los traslados entre locales se muestran y se aceptan desde la apertura del segundo
// local ('YYYY-MM-DD' de Lima)
export function transfersEnabled(settings: Settings, date: string): boolean {
  const opened = settings.second_local_opened_on
  return !!opened && opened <= date
}
