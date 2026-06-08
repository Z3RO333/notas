import { NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'
import { createAdminClient } from '@/lib/supabase/admin'
import { callGestaoBaseRpc } from '@/lib/graficos/gestao-base-rpc'
import type { GestaoBaseOrdem } from '@/lib/types/database'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type RiskBand = 'sem_historico' | 'critico' | 'atencao' | 'ok'

interface ContatoUnidade {
  centro: string
  nome_unidade: string
  tipo: string
  emails: string[]
}

interface StoreResult {
  contato: ContatoUnidade
  lastDate: string | null
  monthsElapsed: number | null
  band: RiskBand
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function normalizeKey(value: string | null | undefined): string {
  return (value ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase()
}

function isPintura(textoBreve: string | null | undefined): boolean {
  return normalizeKey(textoBreve).includes('PINTURA')
}

function monthsAgo(dateStr: string): number {
  const [year, month] = dateStr.split('-').map(Number)
  const now = new Date()
  return (now.getFullYear() - year) * 12 + (now.getMonth() + 1 - month)
}

function formatDateBr(dateStr: string): string {
  const [year, month] = dateStr.split('-')
  const months = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']
  return `${months[Number(month) - 1]}/${year}`
}

const PADRAO_MESES = 3 // padrão trimestral

function classifyBand(elapsed: number | null): RiskBand {
  if (elapsed === null) return 'sem_historico'
  if (elapsed >= PADRAO_MESES * 2) return 'critico'
  if (elapsed >= PADRAO_MESES) return 'atencao'
  return 'ok'
}

function isForaDoPadrao(band: RiskBand): boolean {
  return band !== 'ok'
}

// ---------------------------------------------------------------------------
// Data fetching
// ---------------------------------------------------------------------------

async function fetchContatos(): Promise<ContatoUnidade[]> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('contatos_unidade')
    .select('centro, nome_unidade, tipo, emails')
    .eq('ativo', true)
    .eq('tipo', 'LOJA')
    .order('nome_unidade')
  if (error) throw new Error(`Erro ao buscar contatos: ${error.message}`)
  return (data ?? []) as ContatoUnidade[]
}

async function fetchPinturaOrders(): Promise<GestaoBaseOrdem[]> {
  const supabase = createAdminClient()
  const now = new Date()
  const currentYear = now.getFullYear()
  const currentMonth = now.getMonth() + 1

  const months = Array.from({ length: currentMonth }, (_, i) => i + 1)

  const results = await Promise.all(
    months.map((m) => callGestaoBaseRpc(supabase, { p_ano: currentYear, p_mes: m, p_tipo_ordem: null })),
  )

  for (let i = 0; i < results.length; i++) {
    const resultError = results[i].error
    if (resultError) throw new Error(`Erro ${currentYear}/${months[i]}: ${resultError.message}`)
  }

  return results.flatMap((r) => r.data ?? []).filter((row) => isPintura(row.texto_breve))
}

function buildLastPinturaMap(orders: GestaoBaseOrdem[]): Map<string, string> {
  const map = new Map<string, string>()
  for (const order of orders) {
    const store = order.nome_loja?.trim()
    const date = order.competencia_data?.trim()
    if (!store || !date) continue
    const key = normalizeKey(store)
    const current = map.get(key)
    if (!current || date > current) map.set(key, date)
  }
  return map
}

function lookupLastDate(map: Map<string, string>, nomeUnidade: string): string | null {
  return map.get(normalizeKey(nomeUnidade)) ?? null
}

// ---------------------------------------------------------------------------
// Email template (por unidade)
// ---------------------------------------------------------------------------

function readLogoBase64(): string {
  try {
    const logoPath = path.join(process.cwd(), 'public', 'images', 'bemol-manutencao-logo.png')
    return fs.readFileSync(logoPath).toString('base64')
  } catch {
    return ''
  }
}

function bandStyle(band: RiskBand) {
  if (band === 'sem_historico') return { bg: '#fff5f5', border: '#ffc5c5', color: '#c0392b', label: 'Sem histórico registrado' }
  if (band === 'critico')      return { bg: '#fff0f0', border: '#f5c6c6', color: '#c0392b', label: 'Crítico — mais de 12 meses' }
  if (band === 'atencao')      return { bg: '#fffbf0', border: '#fde8b3', color: '#b7770d', label: 'Atenção — entre 6 e 12 meses' }
  return                              { bg: '#f0fff4', border: '#b3f0c6', color: '#1e7e34', label: 'Recente — dentro de 6 meses' }
}

function buildStoreHtml(result: StoreResult, logoBase64: string, dateLabel: string): string {
  const { contato, lastDate, monthsElapsed, band } = result
  const bs = bandStyle(band)

  const logoTag = logoBase64
    ? `<img src="cid:bemol-logo" alt="Bemol Manutenção" style="max-width:200px;height:auto;display:block;margin:0 auto 10px;" />`
    : `<div style="font-size:18px;font-weight:bold;color:#fff;">Bemol Manutenção</div>`

  const statusBlock = band === 'ok'
    ? `<p style="margin:0;font-size:14px;color:#1e7e34;">Esta unidade realizou pintura recentemente. Nenhuma ação necessária no momento.</p>`
    : band === 'sem_historico'
    ? `<p style="margin:0;font-size:14px;color:#c0392b;line-height:1.6;">
        Não encontramos nenhuma ordem de pintura para esta unidade nos últimos <strong>24 meses</strong>.<br>
        Fachadas e áreas internas sem manutenção por tempo prolongado deterioram mais rapidamente,
        elevam o custo de recuperação e podem comprometer a integridade do imóvel.
       </p>`
    : `<p style="margin:0;font-size:14px;color:#555;line-height:1.6;">
        A última pintura registrada foi há <strong>${monthsElapsed} ${monthsElapsed === 1 ? 'mês' : 'meses'}</strong>.
        ${band === 'critico'
          ? 'Esse intervalo já ultrapassa 12 meses — recomendamos avaliar e planejar a execução com prioridade.'
          : 'Esse intervalo está se aproximando do limite recomendado — fique atento à necessidade de repintura.'}
       </p>`

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width,initial-scale=1.0" /></head>
<body style="margin:0;padding:0;background:#f0f2f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f0f2f5;padding:36px 16px;">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:580px;background:#ffffff;border-radius:14px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,0.10);">

  <tr>
    <td style="background:#1a1a2e;padding:28px 32px 20px;text-align:center;">
      ${logoTag}
      <p style="margin:6px 0 0;font-size:11px;color:#6666aa;letter-spacing:0.14em;text-transform:uppercase;">Alerta de Manutenção Preventiva</p>
    </td>
  </tr>

  <tr>
    <td style="background:#1e2a4a;padding:18px 32px;text-align:center;">
      <p style="margin:0 0 4px;font-size:11px;color:#8899cc;letter-spacing:0.12em;text-transform:uppercase;">Unidade</p>
      <p style="margin:0;font-size:22px;font-weight:700;color:#ffffff;">${contato.nome_unidade}</p>
    </td>
  </tr>

  <tr>
    <td style="background:${bs.bg};border-bottom:2px solid ${bs.border};padding:14px 32px;text-align:center;">
      <p style="margin:0;font-size:15px;font-weight:700;color:${bs.color};">${bs.label}</p>
    </td>
  </tr>

  <tr><td style="padding:28px 32px;">

    <h2 style="margin:0 0 6px;font-size:19px;font-weight:700;color:#1a1a2e;">Radar Preventivo: Pintura</h2>
    <p style="margin:0 0 22px;font-size:12px;color:#aaa;">${dateLabel}</p>

    <div style="background:${bs.bg};border:1px solid ${bs.border};border-radius:10px;padding:18px 20px;margin-bottom:24px;">
      ${statusBlock}
    </div>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
      <tr>
        <td width="50%" style="padding:4px;">
          <div style="background:#f8f9fa;border:1px solid #e9ecef;border-radius:10px;padding:16px;text-align:center;">
            <div style="font-size:11px;color:#aaa;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:6px;">Última pintura</div>
            <div style="font-size:20px;font-weight:700;color:#1a1a2e;">${lastDate ? formatDateBr(lastDate) : '—'}</div>
          </div>
        </td>
        <td width="50%" style="padding:4px;">
          <div style="background:${bs.bg};border:1px solid ${bs.border};border-radius:10px;padding:16px;text-align:center;">
            <div style="font-size:11px;color:#aaa;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:6px;">Tempo decorrido</div>
            <div style="font-size:20px;font-weight:700;color:${bs.color};">
              ${monthsElapsed !== null ? `${monthsElapsed} ${monthsElapsed === 1 ? 'mês' : 'meses'}` : 'N/D'}
            </div>
          </div>
        </td>
      </tr>
    </table>

    ${band !== 'ok' ? `
    <div style="background:#f8f9fa;border-left:3px solid #adb5bd;border-radius:4px;padding:14px 16px;">
      <p style="margin:0 0 6px;font-size:12px;font-weight:700;color:#555;text-transform:uppercase;letter-spacing:0.06em;">Recomendação</p>
      <p style="margin:0;font-size:13px;color:#666;line-height:1.6;">
        Solicite ao responsável de manutenção uma vistoria da pintura externa e interna da unidade.
        Caso haja demanda represada, abra uma ordem de serviço no SAP para registro e acompanhamento.
      </p>
    </div>` : ''}

  </td></tr>

  <tr>
    <td style="background:#f8f9fa;border-top:1px solid #e9ecef;padding:18px 32px;text-align:center;">
      <p style="margin:0;font-size:12px;color:#888;">Bemol Manutenção · Cockpit de Distribuição · ${dateLabel}</p>
      <p style="margin:4px 0 0;font-size:11px;color:#bbb;">Relatório automático — não responda a este e-mail.</p>
    </td>
  </tr>

</table>
</td></tr>
</table>
</body>
</html>`
}

// ---------------------------------------------------------------------------
// SendGrid
// ---------------------------------------------------------------------------

async function sendEmail(
  to: string[],
  subject: string,
  html: string,
  logoBase64: string,
): Promise<void> {
  const apiKey = process.env.SENDGRID_API_KEY
  const from = process.env.FROM_EMAIL ?? 'ordensmanutencao@bemol.com.br'
  if (!apiKey) throw new Error('SENDGRID_API_KEY não configurada')

  const body: Record<string, unknown> = {
    personalizations: [{ to: to.map((email) => ({ email })) }],
    from: { email: from, name: 'Bemol Manutenção' },
    subject,
    content: [{ type: 'text/html', value: html }],
  }

  if (logoBase64) {
    body.attachments = [{
      content: logoBase64,
      type: 'image/png',
      filename: 'bemol-manutencao-logo.png',
      disposition: 'inline',
      content_id: 'bemol-logo',
    }]
  }

  const response = await fetch('https://api.sendgrid.com/v3/mail/send', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`SendGrid ${response.status}: ${text}`)
  }
}

// ---------------------------------------------------------------------------
// Route Handler
// ---------------------------------------------------------------------------

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET

  if (!cronSecret) return NextResponse.json({ error: 'CRON_SECRET não configurado' }, { status: 500 })
  if (authHeader !== `Bearer ${cronSecret}`) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })

  try {
    const [contatos, orders] = await Promise.all([fetchContatos(), fetchPinturaOrders()])
    const lastMap = buildLastPinturaMap(orders)
    const logoBase64 = readLogoBase64()

    const now = new Date()
    const monthNames = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro']
    const dateLabel = `${monthNames[now.getMonth()]} de ${now.getFullYear()}`
    const monthLabel = `${monthNames[now.getMonth()]} ${now.getFullYear()}`

    // Por enquanto sempre envia para o endereço de teste; quando pronto, trocar por contato.emails
    const testRecipient = process.env.ALERTA_PINTURA_TEST_EMAIL ?? 'ordensmanutencao@bemol.com.br'

    const results: StoreResult[] = contatos.map((contato) => {
      const lastDate = lookupLastDate(lastMap, contato.nome_unidade)
      const elapsed = lastDate ? monthsAgo(lastDate) : null
      return { contato, lastDate, monthsElapsed: elapsed, band: classifyBand(elapsed) }
    })

    let sent = 0
    const errors: string[] = []

    for (const result of results) {
      const subject = `Pintura — ${result.contato.nome_unidade} | ${monthLabel}`
      const html = buildStoreHtml(result, logoBase64, dateLabel)

      if (!isForaDoPadrao(result.band)) continue

      try {
        await sendEmail([testRecipient], subject, html, logoBase64)
        sent++
        await new Promise((resolve) => setTimeout(resolve, 150))
      } catch (err) {
        errors.push(`${result.contato.nome_unidade}: ${err instanceof Error ? err.message : String(err)}`)
      }
    }

    const bands = { sem_historico: 0, critico: 0, atencao: 0, ok: 0 }
    for (const r of results) bands[r.band]++

    return NextResponse.json({ ok: true, sent, errors, sentTo: testRecipient, bands })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
