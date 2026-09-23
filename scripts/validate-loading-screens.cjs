const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright')
const assert = require('node:assert/strict')

;(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true })
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
    await page.goto('http://127.0.0.1:5180', { waitUntil: 'networkidle' })
    await page.locator('input[type=email]').fill('admin@sanjose.bo')
    await page.locator('input[type=password]').fill('demo1234')
    await page.getByRole('button', { name: 'Iniciar Sesión', exact: true }).click()
    await page.locator('.distribution-header').waitFor()

    const openModule = async (name) => {
      const direct = page.getByRole('button', { name, exact: true })
      if (!(await direct.count())) await page.getByRole('button', { name: 'Mas', exact: true }).click()
      await page.getByRole('button', { name, exact: true }).click()
    }

    await openModule('Configuración')
    await page.getByText('Reglas operativas', { exact: true }).waitFor({ timeout: 5000 })
    assert.equal(await page.getByText('Cargando configuración...', { exact: true }).count(), 0)

    await openModule('Usuarios')
    await page.getByText('Administración', { exact: true }).last().waitFor({ timeout: 5000 })
    await page.waitForFunction(() => !document.body.innerText.includes('Cargando usuarios...'), null, { timeout: 5000 })
    assert.match(await page.locator('body').innerText(), /usuario/)

    const overlay = await page.locator('.vite-error-overlay, #webpack-dev-server-client-overlay').count()
    assert.equal(overlay, 0, 'No debe existir una pantalla de error de Vite')
    assert.deepEqual(errors, [], `Errores de navegador: ${errors.join(' | ')}`)
    console.log('PASS Configuración y Usuarios cargan sin espera permanente ni errores de navegador')
  } finally {
    await browser.close()
  }
})().catch(error => { console.error(error); process.exitCode = 1 })
