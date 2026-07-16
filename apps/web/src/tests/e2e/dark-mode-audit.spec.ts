import { expect, test, type Page } from '@playwright/test'
import path from 'path'
import fs from 'fs'

const SCREENSHOTS_DIR = path.join(__dirname, '../../../../dark-mode-screenshots')
const AUTH_STORAGE_STATE = process.env.PLAYWRIGHT_AUTH_STORAGE_STATE

test.beforeAll(() => {
  if (!fs.existsSync(SCREENSHOTS_DIR)) {
    fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true })
  }
})

async function goto(page: Page, url: string) {
  await page.goto(url, { waitUntil: 'domcontentloaded' })
  // Ensure dark class is applied after any client-side redirects settle
  await page.waitForLoadState('networkidle').catch(() => {})
  await page.evaluate(() => {
    document.documentElement.classList.add('dark')
    localStorage.setItem('cockpit:theme', 'dark')
  })
  await page.waitForTimeout(400)
}

async function screenshot(page: Page, name: string) {
  await page.screenshot({
    path: path.join(SCREENSHOTS_DIR, `${name}.png`),
    fullPage: true,
  })
}

test('dark mode audit - login', async ({ page }) => {
  page.setDefaultTimeout(30000)

  await page.addInitScript(() => {
    localStorage.setItem('cockpit:theme', 'dark')
  })

  await page.goto('/login', { waitUntil: 'domcontentloaded' })
  await page.evaluate(() => document.documentElement.classList.add('dark'))
  await page.waitForTimeout(400)
  await expect(page.getByRole('button', { name: 'Entrar com Microsoft' })).toBeVisible()
  await screenshot(page, '01-login-dark')
})

test.describe('dark mode audit - páginas autenticadas', () => {
  test.skip(
    !AUTH_STORAGE_STATE,
    'Defina PLAYWRIGHT_AUTH_STORAGE_STATE com uma sessão Entra válida para auditar páginas autenticadas.',
  )
  test.use({
    storageState: AUTH_STORAGE_STATE ?? { cookies: [], origins: [] },
  })

  test('todas as páginas internas', async ({ page }) => {
    page.setDefaultTimeout(30000)

    // A autenticação Microsoft é externa ao Cockpit. O teste reutiliza um
    // storageState local, informado por variável de ambiente e nunca versionado.
    await page.addInitScript(() => {
      localStorage.setItem('cockpit:theme', 'dark')
    })

    // ── PAINEL PRINCIPAL (home) ────────────────────────────
    await goto(page, '/')
    await screenshot(page, '02-home-dark')

    // ── ADMIN DASHBOARD ────────────────────────────────────
    await goto(page, '/admin')
    await screenshot(page, '03-admin-dashboard-dark')

    // ── DISTRIBUIÇÃO ───────────────────────────────────────
    await goto(page, '/admin/distribuicao')
    await screenshot(page, '04-distribuicao-dark')

    // ── GRAFICOS ───────────────────────────────────────────
    await goto(page, '/admin/graficos')
    await screenshot(page, '05-graficos-dark')

    // ── PESSOAS ────────────────────────────────────────────
    await goto(page, '/admin/pessoas')
    await screenshot(page, '06-pessoas-dark')

    // ── AUDITORIA ──────────────────────────────────────────
    await goto(page, '/admin/auditoria')
    await screenshot(page, '07-auditoria-dark')

    // ── COPILOT ────────────────────────────────────────────
    await goto(page, '/admin/copilot')
    await screenshot(page, '08-copilot-dark')

    // ── ADMINISTRAÇÃO ──────────────────────────────────────
    await goto(page, '/admin/administracao')
    await screenshot(page, '09-administracao-dark')

    // ── NOTAS ──────────────────────────────────────────────
    await goto(page, '/notas')
    await screenshot(page, '10-notas-dark')

    // ── ORDENS ─────────────────────────────────────────────
    await goto(page, '/ordens')
    await screenshot(page, '11-ordens-dark')

    // ── LIGHT MODE para comparação ─────────────────────────
    await page.goto('/admin', { waitUntil: 'domcontentloaded' })
    await page.waitForLoadState('networkidle').catch(() => {})
    await page.evaluate(() => {
      document.documentElement.classList.remove('dark')
      localStorage.setItem('cockpit:theme', 'light')
    })
    await page.waitForTimeout(400)
    await screenshot(page, '12-admin-dashboard-light')

    await page.goto('/admin/distribuicao', { waitUntil: 'domcontentloaded' })
    await page.waitForLoadState('networkidle').catch(() => {})
    await page.evaluate(() => {
      document.documentElement.classList.remove('dark')
      localStorage.setItem('cockpit:theme', 'light')
    })
    await page.waitForTimeout(400)
    await screenshot(page, '13-distribuicao-light')

    console.log(`\n✅ Screenshots salvas em: ${SCREENSHOTS_DIR}`)
  })
})
