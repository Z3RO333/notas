'use client'

import * as XLSX from 'xlsx'
import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { AlertCircle, CheckCircle2, CreditCard, Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useToast } from '@/components/ui/toast'
import type { CartaoImportRow, CartaoImportBatchResult } from '@/app/api/financeiro/cartao/importar/route'

type RawRow = Record<string, unknown>

const SKIP_FORNECEDOR_PATTERNS = /saldo\s*atual|^recarga$|^saldo$/i

const BATCH_SIZE = 500

function normalizeHeaderKey(value: string) {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .trim()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

function normalizeText(value: unknown): string | null {
  if (value === undefined || value === null) return null
  const trimmed = String(value).trim()
  return trimmed.length > 0 ? trimmed : null
}

function normalizeMoney(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value > 0 ? Number(value.toFixed(2)) : null
  }
  const text = normalizeText(value)
  if (!text) return null

  // Remove símbolo de moeda e espaços
  const clean = text.replace(/R\$\s*/g, '').replace(/\s+/g, '')
  const brPattern = /^-?\d{1,3}(\.\d{3})*(,\d+)?$/
  const usPattern = /^-?\d{1,3}(,\d{3})*(\.\d+)?$/
  let normalized = clean

  if (brPattern.test(clean)) {
    normalized = clean.replace(/\./g, '').replace(',', '.')
  } else if (usPattern.test(clean)) {
    normalized = clean.replace(/,/g, '')
  } else if (/^-?\d+,\d+$/.test(clean)) {
    normalized = clean.replace(',', '.')
  }

  const parsed = Number(normalized)
  return Number.isFinite(parsed) && parsed > 0 ? Number(parsed.toFixed(2)) : null
}

function parseDateToIso(value: unknown): string | null {
  const text = normalizeText(value)
  if (!text) return null

  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text

  const isoMatch = text.match(/^(\d{4})-(\d{2})-(\d{2})T/)
  if (isoMatch) return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`

  const brMatch = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/)
  if (brMatch) {
    return `${brMatch[3]}-${brMatch[2].padStart(2, '0')}-${brMatch[1].padStart(2, '0')}`
  }

  // Tenta parsear como número serial do Excel (dias desde 1900-01-01)
  const num = Number(text)
  if (Number.isFinite(num) && num > 40000 && num < 60000) {
    const date = XLSX.SSF.parse_date_code(num)
    if (date) {
      return `${date.y}-${String(date.m).padStart(2, '0')}-${String(date.d).padStart(2, '0')}`
    }
  }

  return null
}

function findColumn(headers: string[], candidates: string[]): string | null {
  const normalizedHeaders = headers.map(normalizeHeaderKey)
  for (const candidate of candidates) {
    const idx = normalizedHeaders.indexOf(candidate)
    if (idx !== -1) return headers[idx]
  }
  return null
}

function parseSheetRows(sheet: XLSX.WorkSheet, sheetName: string): CartaoImportRow[] {
  const rawLines = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    raw: true,
    dateNF: 'YYYY-MM-DD',
  })

  // Encontra a linha de cabeçalho (primeira com pelo menos 3 células não vazias)
  let headerRowIdx = -1
  for (let i = 0; i < Math.min(rawLines.length, 10); i++) {
    const row = rawLines[i] as unknown[]
    const nonEmpty = row.filter((cell) => cell !== null && cell !== undefined && String(cell).trim() !== '')
    if (nonEmpty.length >= 3) {
      headerRowIdx = i
      break
    }
  }

  if (headerRowIdx === -1) return []

  const headers = ((rawLines[headerRowIdx] ?? []) as unknown[]).map((cell) => String(cell ?? ''))

  const dataCol = findColumn(headers, ['DATA', 'DT_CRIACAO', 'CARIMBO_DE_DATA_HORA'])
  const fornecedorCol = findColumn(headers, ['FORNECEDOR', 'CODIGO_FORNECEDOR', 'DESCRICAO_FORNECEDOR'])
  const centroCustoCol = findColumn(headers, ['CENTRO_DE_CUSTO', 'CENTRO_CUSTO', 'CENTRODE_CUSTO'])
  const valorCol = findColumn(headers, ['VALOR'])

  if (!dataCol || !fornecedorCol || !valorCol) return []

  const result: CartaoImportRow[] = []

  for (let i = headerRowIdx + 1; i < rawLines.length; i++) {
    const raw = rawLines[i] as unknown[]
    const row: RawRow = {}
    headers.forEach((header, idx) => {
      row[header] = raw[idx]
    })

    const data = parseDateToIso(row[dataCol])
    const fornecedor = normalizeText(row[fornecedorCol])
    const valor = normalizeMoney(row[valorCol])
    const centroCusto = centroCustoCol ? normalizeText(row[centroCustoCol]) : null

    // Ignora linhas de saldo/recarga e linhas incompletas
    if (!data || !fornecedor || valor === null) continue
    if (SKIP_FORNECEDOR_PATTERNS.test(fornecedor)) continue

    result.push({
      data,
      fornecedor,
      centro_custo: centroCusto,
      valor,
      source_sheet: sheetName,
    })
  }

  return result
}

function chunkArray<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size))
  }
  return chunks
}

export function CartaoImportDialog() {
  const router = useRouter()
  const { toast } = useToast()
  const inputRef = useRef<HTMLInputElement | null>(null)

  const [open, setOpen] = useState(false)
  const [fileName, setFileName] = useState<string | null>(null)
  const [sheetNames, setSheetNames] = useState<string[]>([])
  const [selectedSheet, setSelectedSheet] = useState<string>('')
  const [workbook, setWorkbook] = useState<XLSX.WorkBook | null>(null)
  const [rows, setRows] = useState<CartaoImportRow[]>([])
  const [isImporting, setIsImporting] = useState(false)
  const [progress, setProgress] = useState<{ processed: number; total: number; inserted: number } | null>(null)

  function resetState() {
    setFileName(null)
    setSheetNames([])
    setSelectedSheet('')
    setWorkbook(null)
    setRows([])
    setProgress(null)
    setIsImporting(false)
    if (inputRef.current) inputRef.current.value = ''
  }

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen && isImporting) return
    if (!nextOpen) resetState()
    setOpen(nextOpen)
  }

  function loadSheet(wb: XLSX.WorkBook, sheet: string) {
    const ws = wb.Sheets[sheet]
    if (!ws) return
    const parsed = parseSheetRows(ws, sheet)
    setRows(parsed)
  }

  async function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return

    try {
      const buffer = await file.arrayBuffer()
      const wb = XLSX.read(buffer, { type: 'array', raw: true })

      // Filtra abas relevantes (ignora Planilha1 e abas vazias)
      const validSheets = wb.SheetNames.filter((name) => {
        const ws = wb.Sheets[name]
        const range = ws['!ref']
        return range && name.toLowerCase() !== 'planilha1'
      })

      setFileName(file.name)
      setWorkbook(wb)
      setSheetNames(validSheets)

      // Seleciona a aba mais recente por padrão
      const defaultSheet = validSheets[validSheets.length - 1] ?? validSheets[0] ?? ''
      setSelectedSheet(defaultSheet)
      if (defaultSheet) loadSheet(wb, defaultSheet)
    } catch {
      toast({
        title: 'Erro ao ler planilha',
        description: 'Verifique se o arquivo esta em .xlsx ou .xls valido.',
        variant: 'error',
      })
    } finally {
      event.target.value = ''
    }
  }

  function handleSheetChange(event: React.ChangeEvent<HTMLSelectElement>) {
    const sheet = event.target.value
    setSelectedSheet(sheet)
    if (workbook) loadSheet(workbook, sheet)
  }

  async function handleImport() {
    if (rows.length === 0) {
      toast({
        title: 'Nenhuma linha valida',
        description: 'Verifique se a aba selecionada contem dados de gastos.',
        variant: 'error',
      })
      return
    }

    setIsImporting(true)
    const cumulative = { processed: 0, total: rows.length, inserted: 0 }
    setProgress({ ...cumulative })

    const batches = chunkArray(rows, BATCH_SIZE)

    try {
      for (const batch of batches) {
        const response = await fetch('/api/financeiro/cartao/importar', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ rows: batch }),
        })

        const payload = await response.json() as CartaoImportBatchResult | { error: string }
        if (!response.ok || 'error' in payload) {
          throw new Error('error' in payload ? payload.error : 'Falha ao importar')
        }

        cumulative.processed += batch.length
        cumulative.inserted += payload.inserted
        setProgress({ ...cumulative })
      }

      toast({
        title: 'Cartao importado',
        description: `${cumulative.inserted} registros novos inseridos de ${cumulative.total} linhas processadas.`,
        variant: 'success',
      })
      router.refresh()
      resetState()
      setOpen(false)
    } catch (error) {
      toast({
        title: 'Erro ao importar',
        description: error instanceof Error ? error.message : 'Falha inesperada',
        variant: 'error',
      })
    } finally {
      setIsImporting(false)
    }
  }

  const firstDate = rows.length > 0 ? rows[0].data : null
  const lastDate = rows.length > 0 ? rows[rows.length - 1].data : null
  const totalValor = rows.reduce((sum, row) => sum + row.valor, 0)

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)} className="gap-2">
        <CreditCard className="h-4 w-4" />
        Importar Cartao
      </Button>

      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Importar Gastos do Cartao Corporativo</DialogTitle>
            <DialogDescription>
              Selecione a planilha e a aba do ano desejado. Linhas de saldo e recarga sao ignoradas automaticamente.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="rounded-lg border border-dashed p-4">
              <label className="flex cursor-pointer flex-col gap-2">
                <span className="text-sm font-medium">Selecionar arquivo</span>
                <span className="text-xs text-muted-foreground">
                  Colunas esperadas: Data, Fornecedor, Centro de Custo, Valor
                </span>
                <input
                  ref={inputRef}
                  type="file"
                  accept=".xlsx,.xls"
                  className="mt-2 block text-sm"
                  onChange={handleFileChange}
                  disabled={isImporting}
                />
              </label>
            </div>

            {sheetNames.length > 0 && (
              <div className="flex items-center gap-3">
                <label className="text-sm font-medium whitespace-nowrap">Aba do ano:</label>
                <select
                  className="flex-1 rounded-md border bg-background px-3 py-2 text-sm"
                  value={selectedSheet}
                  onChange={handleSheetChange}
                  disabled={isImporting}
                >
                  {sheetNames.map((name) => (
                    <option key={name} value={name}>{name}</option>
                  ))}
                </select>
              </div>
            )}

            {rows.length > 0 && (
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="rounded-lg border p-4">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Gastos validos</p>
                  <p className="mt-2 text-2xl font-semibold">{rows.length.toLocaleString('pt-BR')}</p>
                </div>
                <div className="rounded-lg border p-4">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Periodo</p>
                  <p className="mt-2 text-sm font-medium">{firstDate ?? '—'} ate {lastDate ?? '—'}</p>
                </div>
                <div className="rounded-lg border p-4">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Total</p>
                  <p className="mt-2 text-sm font-medium">
                    {totalValor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                  </p>
                </div>
              </div>
            )}

            {rows.length === 0 && fileName && (
              <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-4 text-sm">
                <div className="flex items-center gap-2 font-medium text-amber-500">
                  <AlertCircle className="h-4 w-4" />
                  Nenhuma linha valida encontrada na aba selecionada
                </div>
                <p className="mt-1 text-muted-foreground">
                  Verifique se as colunas Data, Fornecedor e Valor estao presentes.
                </p>
              </div>
            )}

            {progress && (
              <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-4 text-sm">
                <div className="mb-2 flex items-center gap-2 font-medium text-emerald-500">
                  <CheckCircle2 className="h-4 w-4" />
                  Importando...
                </div>
                <p className="text-muted-foreground">
                  {progress.processed.toLocaleString('pt-BR')} / {progress.total.toLocaleString('pt-BR')} processadas
                  • {progress.inserted.toLocaleString('pt-BR')} inseridas
                </p>
              </div>
            )}

            <div className="flex items-center justify-end gap-2">
              <Button variant="outline" onClick={() => handleOpenChange(false)} disabled={isImporting}>
                Cancelar
              </Button>
              <Button onClick={handleImport} disabled={isImporting || rows.length === 0}>
                <Upload className="mr-2 h-4 w-4" />
                {isImporting ? 'Importando...' : `Importar ${rows.length.toLocaleString('pt-BR')} registros`}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
