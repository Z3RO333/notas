'use client'

import * as XLSX from 'xlsx'
import { useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { AlertCircle, CheckCircle2, FileSpreadsheet, Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useToast } from '@/components/ui/toast'
import type {
  FinanceiroImportBatchResult,
  FinanceiroImportError,
  FinanceiroImportProgress,
  FinanceiroImportRow,
  FinanceiroTipoOrdem,
} from '@/lib/types/database'

type RawSpreadsheetRow = Record<string, string>
type ImportField = Exclude<keyof FinanceiroImportRow, 'rowIndex'>

const FIELD_ALIASES: Record<ImportField, string[]> = {
  ordem_codigo: ['ORDEM'],
  tipo_ordem: ['TIPO_DE_ORDEM', 'TIPO_ORDEM'],
  numero_nota: ['NOTA'],
  data_entrada: ['DATA_DE_ENTRADA', 'DATA_ENTRADA'],
  inicio_programado: ['INICIO_PROGRAMADO', 'INICIO_PROG', 'DATA_INICIO_PROGRAMADO'],
  denominacao_unidade: ['DENOMINACAO', 'DENOMINACAO_UNIDADE'],
  texto_breve: ['TEXTO_BREVE'],
  fornecedor_codigo: ['FORNECEDOR'],
  fornecedor_nome: ['NOME_FORNECEDOR_CT'],
  custos_estimados: ['CUSTS_ESTIMADOS'],
  custos_totais_materiais: ['CUSTOS_TOT_MAT', 'CUSTOS_TOTAIS_MAT'],
  custos_adicionais: ['CUSTS_ADICIONAIS'],
  custos_totais_reais: ['CUST_TOT_REAIS', 'CUSTOS_TOTAIS_REAIS'],
}

const REQUIRED_FIELDS: ImportField[] = ['ordem_codigo', 'tipo_ordem', 'data_entrada']
const BATCH_SIZE = 250

function normalizeHeaderKey(value: string) {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .trim()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

function normalizeOptionalText(value: unknown): string | null {
  if (value === undefined || value === null) return null
  const trimmed = String(value).trim()
  return trimmed.length > 0 ? trimmed : null
}

function normalizeTipoOrdem(value: string | null): FinanceiroTipoOrdem | null {
  if (!value) return null
  const normalized = value.trim().toUpperCase()
  return normalized === 'PMOS' || normalized === 'PMPL'
    ? normalized
    : null
}

function normalizeMoney(value: string | null): number | null {
  if (!value) return 0

  const compact = value.replace(/\s+/g, '')
  const brPattern = /^-?\d{1,3}(\.\d{3})*(,\d+)?$/
  const usPattern = /^-?\d{1,3}(,\d{3})*(\.\d+)?$/
  let normalized = compact

  if (brPattern.test(compact)) {
    normalized = compact.replace(/\./g, '').replace(',', '.')
  } else if (usPattern.test(compact)) {
    normalized = compact.replace(/,/g, '')
  } else if (/^-?\d+,\d+$/.test(compact)) {
    normalized = compact.replace(',', '.')
  }

  const parsed = Number(normalized)
  return Number.isFinite(parsed) ? Number(parsed.toFixed(2)) : null
}

function extractCell(row: RawSpreadsheetRow, column: string | null) {
  if (!column) return null
  return normalizeOptionalText(row[column])
}

function parseDateToIso(value: string | null) {
  if (!value) return null
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value

  const isoDateTime = value.match(/^(\d{4})-(\d{2})-(\d{2})T/)
  if (isoDateTime) return `${isoDateTime[1]}-${isoDateTime[2]}-${isoDateTime[3]}`

  const brMatch = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/)
  if (brMatch) {
    return `${brMatch[3]}-${brMatch[2].padStart(2, '0')}-${brMatch[1].padStart(2, '0')}`
  }

  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return null
  return parsed.toISOString().slice(0, 10)
}

function autoDetectMapping(headers: string[]): Record<ImportField, string | null> {
  const normalizedHeaders = headers.map((header) => normalizeHeaderKey(header))
  const result = {} as Record<ImportField, string | null>

  for (const [field, aliases] of Object.entries(FIELD_ALIASES) as Array<[ImportField, string[]]>) {
    result[field] = null
    for (const alias of aliases) {
      const index = normalizedHeaders.indexOf(alias)
      if (index !== -1) {
        result[field] = headers[index]
        break
      }
    }
  }

  return result
}

function chunkArray<T>(items: T[], size: number) {
  const chunks: T[][] = []
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size))
  }
  return chunks
}

export function FinanceiroImportDialog() {
  const router = useRouter()
  const { toast } = useToast()
  const inputRef = useRef<HTMLInputElement | null>(null)

  const [open, setOpen] = useState(false)
  const [fileName, setFileName] = useState<string | null>(null)
  const [rows, setRows] = useState<FinanceiroImportRow[]>([])
  const [errors, setErrors] = useState<FinanceiroImportError[]>([])
  const [missingFields, setMissingFields] = useState<string[]>([])
  const [isImporting, setIsImporting] = useState(false)
  const [progress, setProgress] = useState<FinanceiroImportProgress | null>(null)

  const validRows = useMemo(() => {
    const invalidIndexes = new Set(errors.map((error) => error.linha))
    return rows.filter((row) => !invalidIndexes.has(row.rowIndex))
  }, [errors, rows])

  const summary = useMemo(() => {
    const pmos = validRows.filter((row) => row.tipo_ordem === 'PMOS').length
    const pmpl = validRows.filter((row) => row.tipo_ordem === 'PMPL').length
    const dates = validRows
      .map((row) => row.data_entrada)
      .filter((value): value is string => Boolean(value))
      .sort()

    return {
      total: rows.length,
      valid: validRows.length,
      invalid: errors.length,
      pmos,
      pmpl,
      firstDate: dates[0] ?? null,
      lastDate: dates[dates.length - 1] ?? null,
    }
  }, [errors.length, rows.length, validRows])

  function resetState() {
    setFileName(null)
    setRows([])
    setErrors([])
    setMissingFields([])
    setProgress(null)
    setIsImporting(false)
    if (inputRef.current) inputRef.current.value = ''
  }

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen && isImporting) return
    if (!nextOpen) resetState()
    setOpen(nextOpen)
  }

  async function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return

    try {
      const buffer = await file.arrayBuffer()
      const workbook = XLSX.read(buffer, {
        type: 'array',
        raw: false,
        cellDates: false,
        dateNF: 'YYYY-MM-DD',
      })
      const sheet = workbook.Sheets[workbook.SheetNames[0]]
      const rawLines = XLSX.utils.sheet_to_json<string[]>(sheet, {
        header: 1,
        raw: false,
        dateNF: 'YYYY-MM-DD',
      })

      const headers = ((rawLines[0] ?? []) as unknown[]).map((value) => String(value))
      const dataRows: RawSpreadsheetRow[] = (rawLines.slice(1) as unknown[][])
        .filter((row) => row.some((cell) => cell !== null && cell !== undefined && String(cell).trim() !== ''))
        .map((row) => {
          const mapped: RawSpreadsheetRow = {}
          headers.forEach((header, index) => {
            mapped[header] = String(row[index] ?? '')
          })
          return mapped
        })

      const columnMap = autoDetectMapping(headers)
      const missing = REQUIRED_FIELDS.filter((field) => !columnMap[field])
      setMissingFields(missing)

      const nextRows: FinanceiroImportRow[] = []
      const nextErrors: FinanceiroImportError[] = []

      dataRows.forEach((row, index) => {
        const rowIndex = index + 2
        const tipoOrdem = normalizeTipoOrdem(extractCell(row, columnMap.tipo_ordem))
        const dataEntrada = parseDateToIso(extractCell(row, columnMap.data_entrada))
        const ordemCodigo = extractCell(row, columnMap.ordem_codigo) ?? ''

        nextRows.push({
          rowIndex,
          ordem_codigo: ordemCodigo,
          tipo_ordem: tipoOrdem,
          numero_nota: extractCell(row, columnMap.numero_nota),
          data_entrada: dataEntrada,
          inicio_programado: parseDateToIso(extractCell(row, columnMap.inicio_programado)),
          denominacao_unidade: extractCell(row, columnMap.denominacao_unidade),
          texto_breve: extractCell(row, columnMap.texto_breve),
          fornecedor_codigo: extractCell(row, columnMap.fornecedor_codigo),
          fornecedor_nome: extractCell(row, columnMap.fornecedor_nome),
          custos_estimados: normalizeMoney(extractCell(row, columnMap.custos_estimados)),
          custos_totais_materiais: normalizeMoney(extractCell(row, columnMap.custos_totais_materiais)),
          custos_adicionais: normalizeMoney(extractCell(row, columnMap.custos_adicionais)),
          custos_totais_reais: normalizeMoney(extractCell(row, columnMap.custos_totais_reais)),
        })

        if (!ordemCodigo) {
          nextErrors.push({ linha: rowIndex, ordem_codigo: '', motivo: 'Codigo da ordem obrigatorio' })
          return
        }
        if (!tipoOrdem) {
          nextErrors.push({ linha: rowIndex, ordem_codigo: ordemCodigo, motivo: 'Tipo de ordem invalido (PMOS ou PMPL)' })
          return
        }
        if (!dataEntrada) {
          nextErrors.push({ linha: rowIndex, ordem_codigo: ordemCodigo, motivo: 'Data de entrada invalida' })
        }
      })

      setFileName(file.name)
      setRows(nextRows)
      setErrors(nextErrors)

      if (missing.length > 0) {
        toast({
          title: 'Colunas obrigatorias ausentes',
          description: `Faltando: ${missing.join(', ')}`,
          variant: 'error',
        })
      }
    } catch {
      toast({
        title: 'Erro ao ler planilha',
        description: 'Verifique se o arquivo esta em .xlsx ou .csv valido.',
        variant: 'error',
      })
    } finally {
      event.target.value = ''
    }
  }

  async function handleImport() {
    if (missingFields.length > 0) {
      toast({
        title: 'Nao foi possivel importar',
        description: 'A planilha esta sem as colunas obrigatorias.',
        variant: 'error',
      })
      return
    }

    if (validRows.length === 0) {
      toast({
        title: 'Nenhuma linha valida',
        description: 'Corrija a planilha antes de importar.',
        variant: 'error',
      })
      return
    }

    setIsImporting(true)
    const cumulative: FinanceiroImportProgress = {
      totalRows: validRows.length,
      processedRows: 0,
      created: 0,
      updated: 0,
      skipped: 0,
      errors: [...errors],
    }
    setProgress(cumulative)

    const batches = chunkArray(validRows, BATCH_SIZE)

    try {
      for (const batch of batches) {
        const response = await fetch('/api/financeiro/importar', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            rows: batch,
            sourceFileName: fileName,
          }),
        })

        const payload = await response.json() as FinanceiroImportBatchResult | { error: string }
        if (!response.ok || 'error' in payload) {
          throw new Error('error' in payload ? payload.error : 'Falha ao importar financeiro')
        }

        cumulative.processedRows += batch.length
        cumulative.created += payload.created
        cumulative.updated += payload.updated
        cumulative.skipped += payload.skipped
        cumulative.errors.push(...payload.errors)
        setProgress({ ...cumulative })
      }

      toast({
        title: 'Financeiro importado',
        description: `${cumulative.created} novas, ${cumulative.updated} atualizadas e ${cumulative.errors.length} erros.`,
        variant: 'success',
      })
      router.refresh()
      resetState()
      setOpen(false)
    } catch (error) {
      toast({
        title: 'Erro ao importar financeiro',
        description: error instanceof Error ? error.message : 'Falha inesperada',
        variant: 'error',
      })
    } finally {
      setIsImporting(false)
    }
  }

  return (
    <>
      <Button onClick={() => setOpen(true)} className="gap-2">
        <Upload className="h-4 w-4" />
        Importar planilha
      </Button>

      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Importar Financeiro SAP</DialogTitle>
            <DialogDescription>
              Use a planilha combinada com PMOS e PMPL. A importacao faz upsert por codigo da ordem.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="rounded-lg border border-dashed p-4">
              <label className="flex cursor-pointer flex-col gap-2">
                <span className="text-sm font-medium">Selecionar arquivo</span>
                <span className="text-xs text-muted-foreground">
                  Colunas esperadas: Ordem, Tipo de ordem, Data de entrada, Texto breve, fornecedor e custos.
                </span>
                <input
                  ref={inputRef}
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  className="mt-2 block text-sm"
                  onChange={handleFileChange}
                  disabled={isImporting}
                />
              </label>
            </div>

            {fileName && (
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <div className="rounded-lg border p-4">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Arquivo</p>
                  <p className="mt-2 flex items-center gap-2 text-sm font-medium">
                    <FileSpreadsheet className="h-4 w-4 text-emerald-500" />
                    {fileName}
                  </p>
                </div>
                <div className="rounded-lg border p-4">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Linhas</p>
                  <p className="mt-2 text-2xl font-semibold">{summary.total.toLocaleString('pt-BR')}</p>
                  <p className="text-xs text-muted-foreground">{summary.valid} validas</p>
                </div>
                <div className="rounded-lg border p-4">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">PMOS / PMPL</p>
                  <p className="mt-2 text-sm font-medium">
                    PMOS {summary.pmos.toLocaleString('pt-BR')} • PMPL {summary.pmpl.toLocaleString('pt-BR')}
                  </p>
                </div>
                <div className="rounded-lg border p-4">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Periodo</p>
                  <p className="mt-2 text-sm font-medium">
                    {summary.firstDate ?? '—'} ate {summary.lastDate ?? '—'}
                  </p>
                </div>
              </div>
            )}

            {missingFields.length > 0 && (
              <div className="rounded-lg border border-red-500/30 bg-red-500/5 p-4 text-sm">
                <div className="mb-2 flex items-center gap-2 font-medium text-red-500">
                  <AlertCircle className="h-4 w-4" />
                  Colunas obrigatorias ausentes
                </div>
                <p className="text-muted-foreground">{missingFields.join(', ')}</p>
              </div>
            )}

            {errors.length > 0 && (
              <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-4 text-sm">
                <div className="mb-2 flex items-center gap-2 font-medium text-amber-500">
                  <AlertCircle className="h-4 w-4" />
                  {errors.length} linha(s) sera(ao) ignorada(s)
                </div>
                <div className="space-y-1 text-muted-foreground">
                  {errors.slice(0, 6).map((error) => (
                    <p key={`${error.linha}-${error.ordem_codigo}-${error.motivo}`}>
                      Linha {error.linha}: {error.ordem_codigo || 'sem codigo'} — {error.motivo}
                    </p>
                  ))}
                  {errors.length > 6 && <p>...e mais {errors.length - 6} erro(s).</p>}
                </div>
              </div>
            )}

            {progress && (
              <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-4 text-sm">
                <div className="mb-2 flex items-center gap-2 font-medium text-emerald-500">
                  <CheckCircle2 className="h-4 w-4" />
                  Progresso da importacao
                </div>
                <p className="text-muted-foreground">
                  {progress.processedRows.toLocaleString('pt-BR')} / {progress.totalRows.toLocaleString('pt-BR')} processadas
                </p>
                <p className="text-muted-foreground">
                  Criadas {progress.created.toLocaleString('pt-BR')} • Atualizadas {progress.updated.toLocaleString('pt-BR')} • Ignoradas {progress.skipped.toLocaleString('pt-BR')}
                </p>
              </div>
            )}

            <div className="flex items-center justify-end gap-2">
              <Button variant="outline" onClick={() => handleOpenChange(false)} disabled={isImporting}>
                Cancelar
              </Button>
              <Button onClick={handleImport} disabled={isImporting || !fileName}>
                {isImporting ? 'Importando...' : 'Importar agora'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
