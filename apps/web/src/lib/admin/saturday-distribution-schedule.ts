import type {
  EscalaDistribuicaoSabado,
  EscalaDistribuicaoSabadoParticipante,
  SaturdayDistributionScheduleEntryInput,
} from '@/lib/types/database'

export const SATURDAY_SCHEDULE_QUERY_PARAM = 'escalaMes'
export const MANAUS_TIME_ZONE = 'America/Manaus'

export interface SaturdayScheduleCandidate {
  id: string
  nome: string
  email: string
  ativo: boolean
  em_ferias: boolean
}

export interface SaturdayScheduleSlot {
  data_escala: string
  label: string
  ordinal: number
  hora_fim: string
  administrador_ids: string[]
}

interface SaturdayScheduleMonthWindow {
  year: number
  month: number
  startDate: string
  endExclusiveDate: string
}

type SaturdayScheduleRow = Pick<EscalaDistribuicaoSabado, 'id' | 'data_escala' | 'hora_fim'>
type SaturdayScheduleParticipantRow = Pick<EscalaDistribuicaoSabadoParticipante, 'escala_id' | 'administrador_id'>

function pad2(value: number): string {
  return String(value).padStart(2, '0')
}

function formatUtcDate(date: Date): string {
  return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}`
}

function parseMonthKey(value: string): SaturdayScheduleMonthWindow | null {
  const match = /^(\d{4})-(\d{2})$/.exec(value.trim())
  if (!match) return null

  const year = Number(match[1])
  const month = Number(match[2])
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    return null
  }

  const start = new Date(Date.UTC(year, month - 1, 1))
  const endExclusive = new Date(Date.UTC(year, month, 1))

  return {
    year,
    month,
    startDate: formatUtcDate(start),
    endExclusiveDate: formatUtcDate(endExclusive),
  }
}

function parseIsoDateUtc(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value.trim())) return null

  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))

  if (
    Number.isNaN(date.getTime())
    || date.getUTCFullYear() !== year
    || date.getUTCMonth() !== month - 1
    || date.getUTCDate() !== day
  ) {
    return null
  }

  return date
}

function getManausParts(now: Date): { year: string; month: string } {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: MANAUS_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
  })
  const parts = formatter.formatToParts(now)

  return {
    year: parts.find((part) => part.type === 'year')?.value ?? String(now.getUTCFullYear()),
    month: parts.find((part) => part.type === 'month')?.value ?? pad2(now.getUTCMonth() + 1),
  }
}

export function getCurrentManausMonthKey(now: Date = new Date()): string {
  const { year, month } = getManausParts(now)
  return `${year}-${month}`
}

export function normalizeSaturdayScheduleMonthKey(
  value: string | null | undefined,
  now: Date = new Date(),
): string {
  const trimmed = (value ?? '').trim()
  if (!trimmed) return getCurrentManausMonthKey(now)
  return parseMonthKey(trimmed) ? trimmed : getCurrentManausMonthKey(now)
}

export function getSaturdayScheduleMonthWindow(monthKey: string): SaturdayScheduleMonthWindow {
  const parsed = parseMonthKey(monthKey)
  if (!parsed) {
    throw new Error('Mes de escala invalido. Use o formato YYYY-MM.')
  }

  return parsed
}

export function normalizeSaturdayScheduleTime(value: string | null | undefined): string | null {
  const trimmed = (value ?? '').trim()
  if (!trimmed) return null

  const match = /^([01]\d|2[0-3]):([0-5]\d)(?::[0-5]\d)?$/.exec(trimmed)
  if (!match) return null

  return `${match[1]}:${match[2]}`
}

export function mergeSaturdayScheduleRows(
  rows: SaturdayScheduleRow[],
  participants: SaturdayScheduleParticipantRow[],
): SaturdayDistributionScheduleEntryInput[] {
  const participantMap = new Map<string, string[]>()

  for (const participant of participants) {
    const current = participantMap.get(participant.escala_id) ?? []
    current.push(participant.administrador_id)
    participantMap.set(participant.escala_id, current)
  }

  return rows
    .map((row) => ({
      data_escala: row.data_escala,
      hora_fim: normalizeSaturdayScheduleTime(row.hora_fim),
      administrador_ids: Array.from(new Set(participantMap.get(row.id) ?? [])).sort(),
    }))
    .sort((a, b) => a.data_escala.localeCompare(b.data_escala))
}

export function normalizeSaturdayScheduleEntries(
  monthKey: string,
  entries: SaturdayDistributionScheduleEntryInput[],
): SaturdayDistributionScheduleEntryInput[] {
  getSaturdayScheduleMonthWindow(monthKey)

  return entries
    .map((entry) => ({
      data_escala: (entry.data_escala ?? '').trim(),
      hora_fim: normalizeSaturdayScheduleTime(entry.hora_fim),
      administrador_ids: Array.from(
        new Set(
          (entry.administrador_ids ?? [])
            .map((item) => item.trim())
            .filter(Boolean),
        ),
      ).sort(),
    }))
    .sort((a, b) => a.data_escala.localeCompare(b.data_escala))
}

export function validateSaturdayScheduleEntries(
  monthKey: string,
  entries: SaturdayDistributionScheduleEntryInput[],
): string[] {
  const { year, month } = getSaturdayScheduleMonthWindow(monthKey)
  const normalizedEntries = normalizeSaturdayScheduleEntries(monthKey, entries)
  const seenDates = new Set<string>()
  const errors: string[] = []

  for (const entry of normalizedEntries) {
    const date = parseIsoDateUtc(entry.data_escala)
    if (!date) {
      errors.push('Cada escala de sabado precisa usar uma data valida no formato YYYY-MM-DD.')
      continue
    }

    if (seenDates.has(entry.data_escala)) {
      errors.push(`Existe mais de uma configuracao para o sabado ${entry.data_escala}.`)
      continue
    }
    seenDates.add(entry.data_escala)

    if (date.getUTCFullYear() !== year || date.getUTCMonth() + 1 !== month) {
      errors.push(`A data ${entry.data_escala} nao pertence ao mes selecionado.`)
    }

    if (date.getUTCDay() !== 6) {
      errors.push(`A data ${entry.data_escala} nao e um sabado.`)
    }

    if (entry.administrador_ids.length > 0 && !entry.hora_fim) {
      errors.push(`Informe o horario final da escala para o sabado ${entry.data_escala}.`)
    }
  }

  return errors
}

export function buildSaturdayScheduleSlots(
  monthKey: string,
  schedules: SaturdayDistributionScheduleEntryInput[],
): SaturdayScheduleSlot[] {
  const { year, month } = getSaturdayScheduleMonthWindow(monthKey)
  const scheduleMap = new Map(
    normalizeSaturdayScheduleEntries(monthKey, schedules).map((entry) => [entry.data_escala, entry]),
  )

  const slots: SaturdayScheduleSlot[] = []
  let ordinal = 0
  const cursor = new Date(Date.UTC(year, month - 1, 1))

  while (cursor.getUTCMonth() === month - 1) {
    if (cursor.getUTCDay() === 6) {
      ordinal += 1
      const dateKey = formatUtcDate(cursor)
      const persisted = scheduleMap.get(dateKey)

      slots.push({
        data_escala: dateKey,
        label: `${ordinal}o sabado - ${pad2(cursor.getUTCDate())}/${pad2(month)}`,
        ordinal,
        hora_fim: persisted?.hora_fim ?? '',
        administrador_ids: [...(persisted?.administrador_ids ?? [])],
      })
    }

    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }

  return slots
}
