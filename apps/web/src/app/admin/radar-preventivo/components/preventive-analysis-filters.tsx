'use client'

import { useCallback, useMemo } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { SearchableSelect } from '@/components/ui/searchable-select'
import type {
  PreventiveFilterOption,
  PreventivePeriodPreset,
  PreventiveUnitTypeFilter,
} from '../preventive-analysis-utils'

interface PreventiveAnalysisFiltersProps {
  years: number[]
  periodPreset: PreventivePeriodPreset
  selectedYear: number
  selectedMonth: number | null
  selectedUnitType: PreventiveUnitTypeFilter
  selectedStore: string | null
  selectedService: string | null
  unitTypeOptions: PreventiveFilterOption[]
  storeOptions: PreventiveFilterOption[]
  serviceOptions: PreventiveFilterOption[]
  orderTypeOptions: string[]
  selectedOrderType?: string
}

const MONTH_NAMES: Record<string, string> = {
  '1': 'Janeiro',
  '2': 'Fevereiro',
  '3': 'Marco',
  '4': 'Abril',
  '5': 'Maio',
  '6': 'Junho',
  '7': 'Julho',
  '8': 'Agosto',
  '9': 'Setembro',
  '10': 'Outubro',
  '11': 'Novembro',
  '12': 'Dezembro',
}

const PERIOD_LABEL: Record<PreventivePeriodPreset, string> = {
  mes: 'Mes',
  trimestre: 'Trimestre',
  semestre: 'Semestre',
  ano: 'Ano',
}

const ALL_SERVICES_VALUE = '__todos_servicos__'

function withMeta(option: PreventiveFilterOption) {
  if (!option.meta) return option
  return {
    ...option,
    label: `${option.label} - ${option.meta}`,
  }
}

export function PreventiveAnalysisFilters({
  years,
  periodPreset,
  selectedYear,
  selectedMonth,
  selectedUnitType,
  selectedStore,
  selectedService,
  unitTypeOptions,
  storeOptions,
  serviceOptions,
  orderTypeOptions,
  selectedOrderType,
}: PreventiveAnalysisFiltersProps) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const storeSelectOptions = useMemo(
    () => storeOptions.map(withMeta),
    [storeOptions],
  )
  const serviceSelectOptions = useMemo(
    () => [
      { value: ALL_SERVICES_VALUE, label: 'Todos os servicos' },
      ...serviceOptions.map(withMeta),
    ],
    [serviceOptions],
  )

  const updateParams = useCallback((changes: Record<string, string | null>) => {
    const params = new URLSearchParams(searchParams.toString())

    for (const [key, value] of Object.entries(changes)) {
      if (value === null || value === '' || value === 'todos') {
        params.delete(key)
      } else {
        params.set(key, value)
      }
    }

    router.replace(`${pathname}?${params.toString()}`)
  }, [pathname, router, searchParams])

  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-7">
      {orderTypeOptions.length > 0 && (
        <Select
          value={selectedOrderType ?? 'todos'}
          onValueChange={(value) => updateParams({ tipo_ordem: value === 'todos' ? null : value })}
        >
          <SelectTrigger aria-label="Tipo de ordem">
            <SelectValue placeholder="Tipo de ordem" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">Todos os tipos</SelectItem>
            {orderTypeOptions.map((option) => (
              <SelectItem key={option} value={option}>{option}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      <Select
        value={periodPreset}
        onValueChange={(value) => {
          updateParams({
            preventiva_periodo: value,
            preventiva_mes: value === 'ano' ? null : (selectedMonth ? String(selectedMonth) : null),
          })
        }}
      >
        <SelectTrigger aria-label="Periodo preventivo">
          <SelectValue placeholder="Periodo" />
        </SelectTrigger>
        <SelectContent>
          {Object.entries(PERIOD_LABEL).map(([value, label]) => (
            <SelectItem key={value} value={value}>{label}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        value={String(selectedYear)}
        onValueChange={(value) => updateParams({ preventiva_ano: value })}
      >
        <SelectTrigger aria-label="Ano preventivo">
          <SelectValue placeholder="Ano" />
        </SelectTrigger>
        <SelectContent>
          {years.map((year) => (
            <SelectItem key={year} value={String(year)}>{year}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      {periodPreset !== 'ano' && (
        <Select
          value={selectedMonth ? String(selectedMonth) : '1'}
          onValueChange={(value) => updateParams({ preventiva_mes: value })}
        >
          <SelectTrigger aria-label="Mes de referencia">
            <SelectValue placeholder="Mes" />
          </SelectTrigger>
          <SelectContent>
            {Array.from({ length: 12 }, (_, index) => index + 1).map((month) => (
              <SelectItem key={month} value={String(month)}>
                {MONTH_NAMES[String(month)]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      <Select
        value={selectedUnitType}
        onValueChange={(value) => updateParams({ preventiva_tipo_unidade: value })}
      >
        <SelectTrigger aria-label="Tipo de unidade">
          <SelectValue placeholder="Tipo de unidade" />
        </SelectTrigger>
        <SelectContent>
          {unitTypeOptions.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.meta ? `${option.label} - ${option.meta}` : option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <div className="xl:col-span-1">
        <SearchableSelect
          id="preventiva-loja"
          options={storeSelectOptions}
          value={selectedStore ?? storeSelectOptions[0]?.value ?? ''}
          onValueChange={(value) => updateParams({ preventiva_loja: value })}
          placeholder="Loja em foco"
        />
      </div>

      <div className="xl:col-span-1">
        <SearchableSelect
          id="preventiva-servico"
          options={serviceSelectOptions}
          value={selectedService ?? ALL_SERVICES_VALUE}
          onValueChange={(value) => updateParams({
            preventiva_servico: value === ALL_SERVICES_VALUE ? null : value,
          })}
          placeholder="Servico em foco"
        />
      </div>
    </div>
  )
}
