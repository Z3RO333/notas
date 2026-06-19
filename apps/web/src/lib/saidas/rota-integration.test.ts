import { describe, expect, it } from 'vitest'

import { buildPublishRoutePayload } from './rota-integration'

const saida = {
  id: '89585fa1-8dd7-4314-b01e-d626b3f2087a',
  dataSaida: '2026-06-20T02:30:00.000Z',
  ordens: [
    { ordemCodigo: 'OS-2', unidade: ' MATRIZ ', createdAt: '2026-06-19T12:00:00Z' },
    { ordemCodigo: 'OS-1', unidade: 'matriz', createdAt: '2026-06-19T11:00:00Z' },
    { ordemCodigo: 'OS-1', unidade: 'MATRIZ', createdAt: '2026-06-19T13:00:00Z' },
    { ordemCodigo: 'OS-3', unidade: null, createdAt: '2026-06-19T14:00:00Z' },
  ],
}

describe('buildPublishRoutePayload', () => {
  it('groups units, preserves operational order, and removes duplicate orders', () => {
    expect(buildPublishRoutePayload(saida, 'operational-user-id')).toEqual({
      operational_id: 'operational-user-id',
      planned_date: '2026-06-19',
      cockpit_cargo_id: saida.id,
      stops: [
        {
          unit_name: 'matriz',
          planned_sequence: 1,
          orders: [{ order_number: 'OS-1' }, { order_number: 'OS-2' }],
        },
        {
          unit_name: 'SEM UNIDADE',
          planned_sequence: 2,
          orders: [{ order_number: 'OS-3' }],
        },
      ],
    })
  })

  it('rejects a cargo without valid order numbers', () => {
    expect(() =>
      buildPublishRoutePayload(
        {
          ...saida,
          ordens: [{ ordemCodigo: '  ', unidade: 'MATRIZ', createdAt: '2026-06-19' }],
        },
        'operational-user-id',
      ),
    ).toThrow('A saída não possui ordens válidas')
  })

  it('rejects an invalid departure date', () => {
    expect(() =>
      buildPublishRoutePayload({ ...saida, dataSaida: 'invalid' }, 'operational-user-id'),
    ).toThrow('Data de saída inválida')
  })
})
