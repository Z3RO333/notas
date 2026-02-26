'use client'

import * as XLSX from 'xlsx'
import { useCallback, useRef, useState } from 'react'
import { AlertCircle, CheckCircle2, Download, FileSpreadsheet, Upload, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useToast } from '@/components/ui/toast'
import type {
  ImportBatchResult,
  ImportMode,
  ImportProgress,
  ImportRowError,
  ImportSystemField,
  MappedImportRow,
  RawSpreadsheetRow,
  UserRole,
} from '@/lib/types/database'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const FIELD_ALIASES: Record<ImportSystemField, string[]> = {
  ordem_codigo: ['ORDEM', 'ORDER', 'CODIGO_ORDEM', 'ORDEM_SAP', 'CÓDIGO_ORDEM', 'CODIGO'],
  numero_nota: ['NOTA', 'NUMERO_NOTA', 'NOTE', 'NOTA_SAP', 'NÚMERO_NOTA', 'NUM_NOTA'],
  status_ordem_raw: ['STATUS', 'STATUS_ORDEM', 'STATUS_SAP', 'STATUS_ORDER', 'SITUACAO', 'SITUAÇÃO'],
  centro: ['CENTRO', 'CENTRO_LOCALIZACAO', 'CENTER', 'CENTRO_LOCALIZAÇÃO', 'CENTRO_LOC'],
  ordem_detectada_em: ['DATA_CRIACAO', 'DATA_ENTRADA', 'DATA_ABERTURA', 'DATA_CRIAÇÃO', 'DATA', 'DT_CRIACAO'],
}

const FIELD_LABELS: Record<ImportSystemField, { label: string; required: boolean; hint: string }> = {
  ordem_codigo: { label: 'Código da Ordem', required: true, hint: 'Chave unica — ex: ORDEM, ORDER, CODIGO_ORDEM' },
  numero_nota: { label: 'Número da Nota', required: false, hint: 'Necessario para criar novas ordens — ex: NOTA' },
  status_ordem_raw: { label: 'Status', required: false, hint: 'ex: STATUS, STATUS_ORDEM' },
  centro: { label: 'Centro', required: false, hint: 'ex: CENTRO, CENTER' },
  ordem_detectada_em: { label: 'Data de Criação', required: false, hint: 'ex: DATA_CRIACAO, DATA_ENTRADA' },
}

const IMPORT_MODE_OPTIONS: Array<{ value: ImportMode; label: string; gestorOnly?: boolean }> = [
  { value: 'create_and_update', label: 'Criar novas e atualizar existentes', gestorOnly: true },
  { value: 'create_only', label: 'Apenas criar novas (pular existentes)', gestorOnly: true },
  { value: 'update_only', label: 'Apenas atualizar existentes' },
  { value: 'skip_existing', label: 'Somente novas (pular se já existir)', gestorOnly: true },
]

const BATCH_SIZE = 100

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function autoDetectMapping(headers: string[]): Record<ImportSystemField, string | null> {
  const upperHeaders = headers.map((h) => h.toUpperCase().trim().replace(/\s+/g, '_'))
  const result: Record<ImportSystemField, string | null> = {
    ordem_codigo: null,
    numero_nota: null,
    status_ordem_raw: null,
    centro: null,
    ordem_detectada_em: null,
  }
  for (const [field, aliases] of Object.entries(FIELD_ALIASES) as [ImportSystemField, string[]][]) {
    for (const alias of aliases) {
      const idx = upperHeaders.indexOf(alias)
      if (idx !== -1) {
        result[field] = headers[idx]
        break
      }
    }
  }
  return result
}

function extractCell(row: RawSpreadsheetRow, col: string | null): string | null {
  if (!col) return null
  const val = row[col]
  if (val === undefined || val === null || String(val).trim() === '') return null
  return String(val).trim()
}

function applyMapping(
  rawRows: RawSpreadsheetRow[],
  columnMap: Record<ImportSystemField, string | null>,
): { mapped: MappedImportRow[]; errors: Map<number, string> } {
  const mapped: MappedImportRow[] = []
  const errors = new Map<number, string>()

  rawRows.forEach((row, idx) => {
    const rowIndex = idx + 1
    const ordem_codigo = extractCell(row, columnMap.ordem_codigo) ?? ''

    if (!ordem_codigo) {
      errors.set(idx, 'Código da ordem obrigatorio')
    }

    mapped.push({
      rowIndex,
      ordem_codigo,
      numero_nota: extractCell(row, columnMap.numero_nota),
      status_ordem_raw: extractCell(row, columnMap.status_ordem_raw),
      centro: extractCell(row, columnMap.centro),
      ordem_detectada_em: extractCell(row, columnMap.ordem_detectada_em),
    })
  })

  return { mapped, errors }
}

function chunkArray<T>(arr: T[], size: number): T[][] {
  const result: T[][] = []
  for (let i = 0; i < arr.length; i += size) {
    result.push(arr.slice(i, i + size))
  }
  return result
}

function downloadErrorCsv(errors: ImportRowError[]) {
  function cell(v: unknown) {
    const s = v === null || v === undefined ? '' : String(v)
    return `"${s.replace(/"/g, '""')}"`
  }
  const lines = ['Linha,Codigo_Ordem,Motivo', ...errors.map((e) =>
    [cell(e.linha), cell(e.ordem_codigo), cell(e.motivo)].join(',')
  )]
  const blob = new Blob(['\ufeff' + lines.join('\n')], { type: 'text/csv; charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `erros_importacao_${new Date().toISOString().slice(0, 10)}.csv`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface OrdersImportDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  userRole: UserRole
  adminId: string
}

type Step = 1 | 2 | 3 | 4

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function OrdersImportDialog({ open, onOpenChange, userRole }: OrdersImportDialogProps) {
  const { toast } = useToast()

  // --- Dialog state ---
  const [step, setStep] = useState<Step>(1)
  const [fileName, setFileName] = useState<string | null>(null)
  const [rawRows, setRawRows] = useState<RawSpreadsheetRow[]>([])
  const [headers, setHeaders] = useState<string[]>([])
  const [columnMap, setColumnMap] = useState<Record<ImportSystemField, string | null>>({
    ordem_codigo: null,
    numero_nota: null,
    status_ordem_raw: null,
    centro: null,
    ordem_detectada_em: null,
  })
  const [mappedRows, setMappedRows] = useState<MappedImportRow[]>([])
  const [validationErrors, setValidationErrors] = useState<Map<number, string>>(new Map())
  const [importMode, setImportMode] = useState<ImportMode>(
    userRole === 'admin' ? 'update_only' : 'create_and_update'
  )
  const [progress, setProgress] = useState<ImportProgress | null>(null)
  const [isImporting, setIsImporting] = useState(false)
  const abortRef = useRef(false)

  // --- Reset all state ---
  function resetState() {
    setStep(1)
    setFileName(null)
    setRawRows([])
    setHeaders([])
    setColumnMap({ ordem_codigo: null, numero_nota: null, status_ordem_raw: null, centro: null, ordem_detectada_em: null })
    setMappedRows([])
    setValidationErrors(new Map())
    setImportMode(userRole === 'admin' ? 'update_only' : 'create_and_update')
    setProgress(null)
    setIsImporting(false)
    abortRef.current = false
  }

  function handleOpenChange(next: boolean) {
    if (isImporting) return
    if (!next) resetState()
    onOpenChange(next)
  }

  // ---------------------------------------------------------------------------
  // Step 1 — File parsing
  // ---------------------------------------------------------------------------

  const handleFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    try {
      const buffer = await file.arrayBuffer()
      const workbook = XLSX.read(buffer, { type: 'array', raw: false, dateNF: 'YYYY-MM-DD' })
      const sheetName = workbook.SheetNames[0]
      const sheet = workbook.Sheets[sheetName]

      const allRows = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, raw: false, dateNF: 'YYYY-MM-DD' })
      const headerRow = ((allRows[0] ?? []) as unknown[]).map(String)
      const dataRows: RawSpreadsheetRow[] = (allRows.slice(1) as unknown[][])
        .filter((row) => (row as unknown[]).some((cell) => cell !== '' && cell != null))
        .map((row) => {
          const obj: RawSpreadsheetRow = {}
          headerRow.forEach((h, i) => { obj[h] = String((row as unknown[])[i] ?? '') })
          return obj
        })

      setFileName(file.name)
      setHeaders(headerRow)
      setRawRows(dataRows)
      setColumnMap(autoDetectMapping(headerRow))
      setStep(2)
    } catch {
      toast({ title: 'Erro ao ler arquivo', description: 'Verifique se o arquivo e válido (.xlsx ou .csv)', variant: 'error' })
    }
    // Reset input so the same file can be re-selected
    e.target.value = ''
  }, [toast])

  // ---------------------------------------------------------------------------
  // Step 2 → Step 3 transition
  // ---------------------------------------------------------------------------

  function handleGoToPreview() {
    const { mapped, errors } = applyMapping(rawRows, columnMap)
    setMappedRows(mapped)
    setValidationErrors(errors)
    setStep(3)
  }

  // ---------------------------------------------------------------------------
  // Step 3 → Step 4: run import
  // ---------------------------------------------------------------------------

  async function runImport() {
    const validRows = mappedRows.filter((_, idx) => !validationErrors.has(idx))
    if (validRows.length === 0) {
      toast({ title: 'Nenhuma linha valida para importar', variant: 'error' })
      return
    }

    const cumulative: ImportProgress = {
      totalRows: validRows.length,
      processedRows: 0,
      created: 0,
      updated: 0,
      skipped: 0,
      errors: [],
    }

    setProgress({ ...cumulative })
    setIsImporting(true)
    abortRef.current = false
    setStep(4)

    const batches = chunkArray(validRows, BATCH_SIZE)

    for (const batch of batches) {
      if (abortRef.current) break

      try {
        const response = await fetch('/api/ordens/importar', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ rows: batch, mode: importMode }),
        })

        if (!response.ok) {
          const payload = await response.json().catch(() => ({})) as { error?: string }
          toast({ title: 'Erro na importação', description: payload.error ?? 'Erro desconhecido', variant: 'error' })
          setIsImporting(false)
          return
        }

        const result = await response.json() as ImportBatchResult
        cumulative.processedRows += batch.length
        cumulative.created += result.created
        cumulative.updated += result.updated
        cumulative.skipped += result.skipped
        cumulative.errors.push(...result.errors)
        setProgress({ ...cumulative })
      } catch {
        toast({ title: 'Falha de conexão durante importação', variant: 'error' })
        setIsImporting(false)
        return
      }
    }

    setIsImporting(false)
  }

  // ---------------------------------------------------------------------------
  // Step indicator
  // ---------------------------------------------------------------------------

  const STEP_LABELS = ['Selecionar arquivo', 'Mapear colunas', 'Revisar e confirmar', 'Resultado']

  // ---------------------------------------------------------------------------
  // Render helpers per step
  // ---------------------------------------------------------------------------

  const validRowCount = mappedRows.length - validationErrors.size
  const progressPct = progress
    ? Math.min(100, Math.round((progress.processedRows / progress.totalRows) * 100))
    : 0

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileSpreadsheet className="h-5 w-5" />
            Importar Planilha
          </DialogTitle>
          <DialogDescription>{STEP_LABELS[step - 1]}</DialogDescription>
        </DialogHeader>

        {/* Step indicator */}
        <div className="flex items-center gap-1.5">
          {([1, 2, 3, 4] as Step[]).map((s) => (
            <div
              key={s}
              className={`h-1.5 flex-1 rounded-full transition-colors ${step >= s ? 'bg-primary' : 'bg-muted'}`}
            />
          ))}
        </div>

        {/* ---- Step 1: Upload ---- */}
        {step === 1 && (
          <div className="space-y-4 py-4">
            <label className="flex cursor-pointer flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed border-muted-foreground/30 p-10 transition-colors hover:border-primary/50 hover:bg-muted/30">
              <Upload className="h-10 w-10 text-muted-foreground" />
              <div className="text-center">
                <p className="text-sm font-semibold">Clique para selecionar o arquivo</p>
                <p className="text-xs text-muted-foreground">Suportados: .xlsx, .xls, .csv</p>
              </div>
              <input
                type="file"
                accept=".xlsx,.xls,.csv"
                className="sr-only"
                onChange={handleFileChange}
              />
            </label>

            <div className="rounded-lg border bg-muted/30 p-3 text-xs text-muted-foreground space-y-1">
              <p className="font-semibold text-foreground">Campos reconhecidos automaticamente:</p>
              <ul className="list-inside list-disc space-y-0.5">
                {(Object.entries(FIELD_LABELS) as [ImportSystemField, { label: string; hint: string }][]).map(([, info]) => (
                  <li key={info.label}><span className="font-medium">{info.label}</span> — {info.hint}</li>
                ))}
              </ul>
            </div>
          </div>
        )}

        {/* ---- Step 2: Column Mapper ---- */}
        {step === 2 && (
          <div className="space-y-4 py-2">
            <div className="rounded-lg border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
              <span className="font-medium">{fileName}</span> — {rawRows.length} linha{rawRows.length !== 1 ? 's' : ''} detectada{rawRows.length !== 1 ? 's' : ''}
            </div>

            <div className="space-y-2">
              {(Object.entries(FIELD_LABELS) as [ImportSystemField, { label: string; required: boolean; hint: string }][]).map(([field, info]) => (
                <div key={field} className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
                  <div>
                    <p className="text-sm font-medium">
                      {info.label}
                      {info.required && <span className="ml-1 text-destructive">*</span>}
                    </p>
                    <p className="text-[11px] text-muted-foreground">{info.hint}</p>
                  </div>
                  <span className="text-xs text-muted-foreground">→</span>
                  <Select
                    value={columnMap[field] ?? '__none__'}
                    onValueChange={(v) => setColumnMap((prev) => ({ ...prev, [field]: v === '__none__' ? null : v }))}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="(não mapear)" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">(não mapear)</SelectItem>
                      {headers.map((h) => (
                        <SelectItem key={h} value={h}>{h}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ))}
            </div>

            {!columnMap.ordem_codigo && (
              <div className="flex items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                <AlertCircle className="h-4 w-4 shrink-0" />
                O campo Codigo da Ordem e obrigatorio para continuar.
              </div>
            )}

            <div className="flex justify-between">
              <Button type="button" variant="outline" onClick={() => setStep(1)}>Voltar</Button>
              <Button type="button" disabled={!columnMap.ordem_codigo} onClick={handleGoToPreview}>
                Proxima etapa →
              </Button>
            </div>
          </div>
        )}

        {/* ---- Step 3: Preview + Options ---- */}
        {step === 3 && (
          <div className="space-y-4 py-2">
            {/* Import mode select */}
            <div className="space-y-1">
              <p className="text-sm font-medium">Modo de importação</p>
              <Select value={importMode} onValueChange={(v) => setImportMode(v as ImportMode)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {IMPORT_MODE_OPTIONS.filter((opt) => !opt.gestorOnly || userRole === 'gestor').map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {userRole === 'admin' && (
                <p className="text-[11px] text-muted-foreground">
                  Administradores só podem atualizar ordens já atribuídas a eles.
                </p>
              )}
            </div>

            {/* Summary */}
            <div className="flex items-center gap-3 rounded-lg border bg-muted/30 px-3 py-2 text-sm">
              <span><span className="font-semibold text-foreground">{validRowCount}</span> linha{validRowCount !== 1 ? 's' : ''} valida{validRowCount !== 1 ? 's' : ''}</span>
              {validationErrors.size > 0 && (
                <span className="flex items-center gap-1 text-destructive">
                  <AlertCircle className="h-3.5 w-3.5" />
                  {validationErrors.size} com erro
                </span>
              )}
            </div>

            {/* Preview table — first 20 rows */}
            <div className="overflow-auto rounded-lg border">
              <table className="w-full text-xs">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="px-2 py-1.5 text-left text-muted-foreground">#</th>
                    <th className="px-2 py-1.5 text-left text-muted-foreground">Ordem</th>
                    <th className="px-2 py-1.5 text-left text-muted-foreground">Nota</th>
                    <th className="px-2 py-1.5 text-left text-muted-foreground">Status</th>
                    <th className="px-2 py-1.5 text-left text-muted-foreground">Centro</th>
                    <th className="px-2 py-1.5 text-left text-muted-foreground">Data</th>
                  </tr>
                </thead>
                <tbody>
                  {mappedRows.slice(0, 20).map((row, idx) => {
                    const hasError = validationErrors.has(idx)
                    return (
                      <tr
                        key={row.rowIndex}
                        className={`border-t ${hasError ? 'bg-destructive/5' : 'hover:bg-muted/30'}`}
                      >
                        <td className={`px-2 py-1 font-mono ${hasError ? 'border-l-2 border-l-destructive text-destructive' : 'text-muted-foreground'}`}>
                          {row.rowIndex}
                        </td>
                        <td className="px-2 py-1 font-mono font-semibold">
                          {row.ordem_codigo || <span className="text-destructive">(vazio)</span>}
                        </td>
                        <td className="px-2 py-1 text-muted-foreground">{row.numero_nota ?? '—'}</td>
                        <td className="px-2 py-1 text-muted-foreground">{row.status_ordem_raw ?? '—'}</td>
                        <td className="px-2 py-1 text-muted-foreground">{row.centro ?? '—'}</td>
                        <td className="px-2 py-1 text-muted-foreground">{row.ordem_detectada_em ?? '—'}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
              {mappedRows.length > 20 && (
                <p className="px-3 py-2 text-center text-xs text-muted-foreground">
                  ... e mais {mappedRows.length - 20} linha{mappedRows.length - 20 !== 1 ? 's' : ''}
                </p>
              )}
            </div>

            <div className="flex justify-between">
              <Button type="button" variant="outline" onClick={() => setStep(2)}>Voltar</Button>
              <Button
                type="button"
                disabled={validRowCount === 0}
                onClick={runImport}
              >
                Importar {validRowCount} linha{validRowCount !== 1 ? 's' : ''}
              </Button>
            </div>
          </div>
        )}

        {/* ---- Step 4: Progress + Result ---- */}
        {step === 4 && (
          <div className="space-y-4 py-4">
            {isImporting ? (
              <div className="space-y-3">
                <p className="text-sm font-medium">Importando planilha...</p>
                <div className="h-3 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-3 rounded-full bg-primary transition-all duration-300"
                    style={{ width: `${progressPct}%` }}
                  />
                </div>
                <p className="text-center text-sm text-muted-foreground">
                  {progress?.processedRows ?? 0} de {progress?.totalRows ?? 0} ({progressPct}%)
                </p>
                <div className="flex justify-center">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => { abortRef.current = true }}
                  >
                    <X className="mr-2 h-3.5 w-3.5" />
                    Cancelar
                  </Button>
                </div>
              </div>
            ) : progress ? (
              <div className="space-y-4">
                <div className="flex items-center gap-2 text-green-700">
                  <CheckCircle2 className="h-5 w-5" />
                  <span className="font-semibold">Importação concluída</span>
                </div>

                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <div className="rounded-lg bg-emerald-50 px-3 py-2 text-center">
                    <p className="text-lg font-bold text-emerald-700">{progress.created}</p>
                    <p className="text-[11px] text-emerald-700">Criadas</p>
                  </div>
                  <div className="rounded-lg bg-sky-50 px-3 py-2 text-center">
                    <p className="text-lg font-bold text-sky-700">{progress.updated}</p>
                    <p className="text-[11px] text-sky-700">Atualizadas</p>
                  </div>
                  <div className="rounded-lg bg-slate-100 px-3 py-2 text-center">
                    <p className="text-lg font-bold text-slate-600">{progress.skipped}</p>
                    <p className="text-[11px] text-slate-600">Puladas</p>
                  </div>
                  <div className={`rounded-lg px-3 py-2 text-center ${progress.errors.length > 0 ? 'bg-red-50' : 'bg-muted'}`}>
                    <p className={`text-lg font-bold ${progress.errors.length > 0 ? 'text-red-700' : 'text-muted-foreground'}`}>
                      {progress.errors.length}
                    </p>
                    <p className={`text-[11px] ${progress.errors.length > 0 ? 'text-red-700' : 'text-muted-foreground'}`}>
                      Erros
                    </p>
                  </div>
                </div>

                {progress.errors.length > 0 && (
                  <div className="space-y-2">
                    <div className="max-h-32 overflow-y-auto rounded-lg border text-xs">
                      <table className="w-full">
                        <thead className="bg-muted/50">
                          <tr>
                            <th className="px-2 py-1.5 text-left text-muted-foreground">Linha</th>
                            <th className="px-2 py-1.5 text-left text-muted-foreground">Ordem</th>
                            <th className="px-2 py-1.5 text-left text-muted-foreground">Motivo</th>
                          </tr>
                        </thead>
                        <tbody>
                          {progress.errors.slice(0, 20).map((err, i) => (
                            <tr key={i} className="border-t">
                              <td className="px-2 py-1 font-mono text-muted-foreground">{err.linha}</td>
                              <td className="px-2 py-1 font-mono font-semibold">{err.ordem_codigo || '—'}</td>
                              <td className="px-2 py-1 text-destructive">{err.motivo}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => downloadErrorCsv(progress.errors)}
                    >
                      <Download className="mr-2 h-3.5 w-3.5" />
                      Baixar relatorio de erros (.csv)
                    </Button>
                  </div>
                )}

                <div className="flex justify-end">
                  <Button type="button" onClick={() => handleOpenChange(false)}>
                    Fechar
                  </Button>
                </div>
              </div>
            ) : null}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
