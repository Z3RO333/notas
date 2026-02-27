import { test } from '@playwright/test'
import path from 'path'
import fs from 'fs'

const SCREENSHOTS_DIR = path.join(__dirname, '../../../../dark-mode-screenshots')

test.beforeAll(() => {
  if (!fs.existsSync(SCREENSHOTS_DIR)) {
    fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true })
  }
})

async function goto(page: any, url: string) {
  await page.goto(url, { waitUntil: 'domcontentloaded' })
  // Ensure dark class is applied after any client-side redirects settle
  await page.waitForLoadState('networkidle').catch(() => {})
  await page.evaluate(() => {
    document.documentElement.classList.add('dark')
    localStorage.setItem('cockpit:theme', 'dark')
  })
  await page.waitForTimeout(400)
}

async function screenshot(page: any, name: string) {
  await page.screenshot({
    path: path.join(SCREENSHOTS_DIR, `${name}.png`),
    fullPage: true,
  })
}

test('dark mode audit - todas as páginas', async ({ page }) => {
  page.setDefaultTimeout(30000)

  // Persist dark mode across all navigations via initScript
  await page.addInitScript(() => {
    localStorage.setItem('cockpit:theme', 'dark')
  })

  // ── LOGIN ──────────────────────────────────────────────
  await page.goto('http://localhost:3000/login', { waitUntil: 'domcontentloaded' })
  await page.evaluate(() => document.documentElement.classList.add('dark'))
  await page.waitForTimeout(400)
  await screenshot(page, '01-login-dark')

  // Faz login
  await page.waitForSelector('#email', { timeout: 15000 })
  await page.fill('#email', 'gustavoandrade@bemol.com.br')
  await page.fill('#password', '231321@Gg')
  await page.click('button[type="submit"]')
  await page.waitForURL(/\/(admin|notas|ordens|$)/, { timeout: 30000 })
  await page.waitForLoadState('networkidle').catch(() => {})

  // ── PAINEL PRINCIPAL (home) ────────────────────────────
  await goto(page, 'http://localhost:3000')
  await screenshot(page, '02-home-dark')

  // ── ADMIN DASHBOARD ────────────────────────────────────
  await goto(page, 'http://localhost:3000/admin')
  await screenshot(page, '03-admin-dashboard-dark')

  // ── DISTRIBUIÇÃO ───────────────────────────────────────
  await goto(page, 'http://localhost:3000/admin/distribuicao')
  await screenshot(page, '04-distribuicao-dark')

  // ── GRAFICOS ───────────────────────────────────────────
  await goto(page, 'http://localhost:3000/admin/graficos')
  await screenshot(page, '05-graficos-dark')

  // ── PESSOAS ────────────────────────────────────────────
  await goto(page, 'http://localhost:3000/admin/pessoas')
  await screenshot(page, '06-pessoas-dark')

  // ── AUDITORIA ──────────────────────────────────────────
  await goto(page, 'http://localhost:3000/admin/auditoria')
  await screenshot(page, '07-auditoria-dark')

  // ── COPILOT ────────────────────────────────────────────
  await goto(page, 'http://localhost:3000/admin/copilot')
  await screenshot(page, '08-copilot-dark')

  // ── ADMINISTRAÇÃO ──────────────────────────────────────
  await goto(page, 'http://localhost:3000/admin/administracao')
  await screenshot(page, '09-administracao-dark')

  // ── NOTAS ──────────────────────────────────────────────
  await goto(page, 'http://localhost:3000/notas')
  await screenshot(page, '10-notas-dark')

  // ── ORDENS ─────────────────────────────────────────────
  await goto(page, 'http://localhost:3000/ordens')
  await screenshot(page, '11-ordens-dark')

  // ── LIGHT MODE para comparação ─────────────────────────
  await page.goto('http://localhost:3000/admin', { waitUntil: 'domcontentloaded' })
  await page.waitForLoadState('networkidle').catch(() => {})
  await page.evaluate(() => {
    document.documentElement.classList.remove('dark')
    localStorage.setItem('cockpit:theme', 'light')
  })
  await page.waitForTimeout(400)
  await screenshot(page, '12-admin-dashboard-light')

  await page.goto('http://localhost:3000/admin/distribuicao', { waitUntil: 'domcontentloaded' })
  await page.waitForLoadState('networkidle').catch(() => {})
  await page.evaluate(() => {
    document.documentElement.classList.remove('dark')
    localStorage.setItem('cockpit:theme', 'light')
  })
  await page.waitForTimeout(400)
  await screenshot(page, '13-distribuicao-light')

  console.log(`\n✅ Screenshots salvas em: ${SCREENSHOTS_DIR}`)
})
