import { describe, expect, it } from 'vitest'
import {
  buildSaturdayScheduleSlots,
  normalizeSaturdayScheduleMonthKey,
  normalizeSaturdayScheduleTime,
  validateSaturdayScheduleEntries,
} from './saturday-distribution-schedule'

describe('saturday-distribution-schedule', () => {
  it('falls back to the current Manaus month when the query param is invalid', () => {
    const fixedNow = new Date('2026-04-09T15:00:00.000Z')

    expect(normalizeSaturdayScheduleMonthKey('2026-13', fixedNow)).toBe('2026-04')
    expect(normalizeSaturdayScheduleMonthKey('', fixedNow)).toBe('2026-04')
  })

  it('normalizes database time values to HH:mm', () => {
    expect(normalizeSaturdayScheduleTime('12:30:00')).toBe('12:30')
    expect(normalizeSaturdayScheduleTime('08:05')).toBe('08:05')
    expect(normalizeSaturdayScheduleTime('')).toBeNull()
  })

  it('builds all Saturdays of the selected month and overlays persisted schedules', () => {
    const slots = buildSaturdayScheduleSlots('2026-05', [
      {
        data_escala: '2026-05-02',
        hora_fim: '12:00',
        administrador_ids: ['a2', 'a1', 'a1'],
      },
      {
        data_escala: '2026-05-23',
        hora_fim: '15:30:00',
        administrador_ids: ['a3'],
      },
    ])

    expect(slots).toHaveLength(5)
    expect(slots[0]).toMatchObject({
      data_escala: '2026-05-02',
      label: '1o sabado - 02/05',
      hora_fim: '12:00',
      administrador_ids: ['a1', 'a2'],
    })
    expect(slots[3]).toMatchObject({
      data_escala: '2026-05-23',
      label: '4o sabado - 23/05',
      hora_fim: '15:30',
      administrador_ids: ['a3'],
    })
    expect(slots[4]).toMatchObject({
      data_escala: '2026-05-30',
      hora_fim: '',
      administrador_ids: [],
    })
  })

  it('requires hora_fim whenever a Saturday has participants', () => {
    const errors = validateSaturdayScheduleEntries('2026-05', [
      {
        data_escala: '2026-05-02',
        hora_fim: null,
        administrador_ids: ['admin-1'],
      },
    ])

    expect(errors).toContain('Informe o horario final da escala para o sabado 2026-05-02.')
  })

  it('rejects dates outside the selected month or non-Saturday dates', () => {
    const errors = validateSaturdayScheduleEntries('2026-05', [
      {
        data_escala: '2026-05-01',
        hora_fim: '12:00',
        administrador_ids: ['admin-1'],
      },
      {
        data_escala: '2026-06-06',
        hora_fim: '12:00',
        administrador_ids: ['admin-2'],
      },
    ])

    expect(errors).toContain('A data 2026-05-01 nao e um sabado.')
    expect(errors).toContain('A data 2026-06-06 nao pertence ao mes selecionado.')
  })
})
