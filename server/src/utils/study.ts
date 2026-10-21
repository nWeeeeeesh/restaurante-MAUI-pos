// Reglas puras del estudio (plan v3 §2.3), sin acceso a la BD para poder probarlas
// en el borde de medianoche. Toda función de la fase 2 debe pasar por aquí:
// nada de la intervención llega a un grupo antes de su fecha (invariante 2) y los
// indicadores del negocio en conjunto quedan ocultos hasta el fin (invariante 4).

export const STUDY_KEYS = [
  'baseline_starts_on',
  'study_ends_on',
  'activation_order',
  'activates_calamar',
  'activates_pescado',
  'activates_mariscos',
  'second_local_opens_on',
  'protocol_url',
] as const
export type StudyKey = typeof STUDY_KEYS[number]
export type StudyConfig = Partial<Record<StudyKey, string>>
export type StudyGroup = 'calamar' | 'pescado' | 'mariscos'

const LIMA = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Lima', year: 'numeric', month: '2-digit', day: '2-digit' })

// Fecha de Lima 'YYYY-MM-DD'. Un string 'YYYY-MM-DD' ya es una fecha de Lima; un
// instante se convierte con la zona explícita (no con la del proceso): a las 04:30 UTC
// del 11 de enero en Lima todavía es 10 de enero.
export function limaDate(d: Date | string = new Date()): string {
  if (typeof d === 'string') return d.slice(0, 10)
  return LIMA.format(d)
}

export function activationDate(config: StudyConfig, group: StudyGroup): string | null {
  return config[`activates_${group}`] ?? null
}

// true si el grupo tiene fecha de activación y `date` (hora de Lima) ya la alcanzó
export function isGroupActiveIn(config: StudyConfig, group: StudyGroup, date: Date | string = new Date()): boolean {
  const from = activationDate(config, group)
  return from !== null && limaDate(date) >= from
}

// true solo si hay fecha de fin y `date` es posterior: sin configuración, ocultos
export function globalIndicatorsVisibleIn(config: StudyConfig, date: Date | string = new Date()): boolean {
  const end = config.study_ends_on
  return !!end && limaDate(date) > end
}

// Los traslados entre locales se muestran y se aceptan desde la apertura del segundo local
export function transfersEnabledIn(config: StudyConfig, date: string): boolean {
  const opens = config.second_local_opens_on
  return !!opens && opens <= date
}

// La medición corre desde el inicio de la línea base hasta el fin (sin fin: sigue abierta)
export function studyRunningIn(config: StudyConfig, date: Date | string = new Date()): boolean {
  const d = limaDate(date)
  return !!config.baseline_starts_on && d >= config.baseline_starts_on && (!config.study_ends_on || d <= config.study_ends_on)
}
