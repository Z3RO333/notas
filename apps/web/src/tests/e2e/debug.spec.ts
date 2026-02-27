import { test } from '@playwright/test'
import path from 'path'
import fs from 'fs'

const DIR = path.join(__dirname, '../../../../dark-mode-screenshots')

test('debug - ver o que renderiza', async ({ page }) => {
  fs.mkdirSync(DIR, { recursive: true })
  await page.goto('http://localhost:3000/login')
  await page.waitForTimeout(3000)
  await page.screenshot({ path: path.join(DIR, 'debug-login.png'), fullPage: true })

  console.log('URL atual:', page.url())
  console.log('Título:', await page.title())
  // verifica se tem inputs
  const inputs = await page.locator('input').count()
  console.log('Inputs encontrados:', inputs)
})
