'use client'

import { useRouter, useSearchParams, usePathname } from 'next/navigation'
import { useCallback } from 'react'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

type GestaoFilterOption = {
  value: string
  label: string
}

const MES_NOMES: Record<string, string> = {
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

const triggerClassName = 'h-9 rounded-full border-border/70 bg-background/70 px-3 shadow-none'

interface GestaoFiltersProps {
  tiposOrdem: string[]
  anos: number[]
  anoAtivo?: number
  mesAtivo?: number
  tipoOrdemAtivo?: string
  equipamentos?: GestaoFilterOption[]
  equipamentoAtivo?: string
  lojas?: string[]
  lojaAtiva?: string
  servicos?: string[]
  servicoAtivo?: string
}

export function GestaoFilters({
  tiposOrdem,
  anos,
  anoAtivo,
  mesAtivo,
  tipoOrdemAtivo,
  equipamentos = [],
  equipamentoAtivo,
  lojas = [],
  lojaAtiva,
  servicos = [],
  servicoAtivo,
}: GestaoFiltersProps) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const updateParam = useCallback(
    (key: string, value: string | undefined) => {
      const params = new URLSearchParams(searchParams.toString())
      if (value && value !== 'todos') {
        params.set(key, value)
      } else if (key === 'ano') {
        params.set(key, 'todos')
      } else {
        params.delete(key)
      }
      router.replace(`${pathname}?${params.toString()}`)
    },
    [router, pathname, searchParams],
  )

  return (
    <div className="flex flex-col gap-3 rounded-2xl border bg-card/60 p-3 sm:p-4">
      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
        Recorte
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <Select
          value={anoAtivo ? String(anoAtivo) : 'todos'}
          onValueChange={(value) => updateParam('ano', value)}
        >
          <SelectTrigger className={`${triggerClassName} w-28`}>
            <SelectValue placeholder="Ano" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">Todos anos</SelectItem>
            {anos.map((ano) => (
              <SelectItem key={ano} value={String(ano)}>
                {ano}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={mesAtivo ? String(mesAtivo) : 'todos'}
          onValueChange={(value) => updateParam('mes', value)}
        >
          <SelectTrigger className={`${triggerClassName} w-36`}>
            <SelectValue placeholder="Mes" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">Todos meses</SelectItem>
            {Array.from({ length: 12 }, (_, index) => index + 1).map((mes) => (
              <SelectItem key={mes} value={String(mes)}>
                {MES_NOMES[String(mes)]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {tiposOrdem.length > 0 ? (
          <Select
            value={tipoOrdemAtivo ?? 'todos'}
            onValueChange={(value) => updateParam('tipo_ordem', value)}
          >
            <SelectTrigger className={`${triggerClassName} w-36`}>
              <SelectValue placeholder="Tipo" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos tipos</SelectItem>
              {tiposOrdem.map((tipo) => (
                <SelectItem key={tipo} value={tipo}>
                  {tipo}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}

        {equipamentos.length > 0 ? (
          <Select
            value={equipamentoAtivo ?? 'todos'}
            onValueChange={(value) => updateParam('equipamento', value)}
          >
            <SelectTrigger className={`${triggerClassName} w-48`}>
              <SelectValue placeholder="Equipamento" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos equipamentos</SelectItem>
              {equipamentos.map((equipamento) => (
                <SelectItem key={equipamento.value} value={equipamento.value}>
                  {equipamento.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}

        {lojas.length > 0 ? (
          <Select
            value={lojaAtiva ?? 'todos'}
            onValueChange={(value) => updateParam('loja', value)}
          >
            <SelectTrigger className={`${triggerClassName} w-48`}>
              <SelectValue placeholder="Loja" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todas as lojas</SelectItem>
              {lojas.map((loja) => (
                <SelectItem key={loja} value={loja}>
                  {loja}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}

        {servicos.length > 0 ? (
          <Select
            value={servicoAtivo ?? 'todos'}
            onValueChange={(value) => updateParam('servico', value)}
          >
            <SelectTrigger className={`${triggerClassName} w-56`}>
              <SelectValue placeholder="Servico" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos os servicos</SelectItem>
              {servicos.map((servico) => (
                <SelectItem key={servico} value={servico}>
                  {servico}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}
      </div>
    </div>
  )
}
