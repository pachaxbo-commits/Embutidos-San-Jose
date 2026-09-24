const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright')
const assert = require('node:assert/strict')

;(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true })
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
    const updateRequests = []
    const errors = []
    page.on('request', request => {
      if (request.url().includes('/updates/san-jose/')) updateRequests.push(request.url())
    })
    page.on('pageerror', error => errors.push(error.message))
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
    await page.goto('http://127.0.0.1:5180', { waitUntil: 'networkidle' })
    await page.locator('input[type=email]').fill('admin@sanjose.bo')
    await page.locator('input[type=password]').fill('demo1234')
    await page.getByRole('button', { name: 'Iniciar Sesión', exact: true }).click()
    await page.locator('.distribution-header').waitFor()
    await page.waitForTimeout(1_000)

    await page.getByRole('button', { name: 'Mas', exact: true }).click()
    assert.equal(await page.getByText('Acerca de y actualizaciones', { exact: true }).count(), 0)
    assert.equal(await page.getByText('Buscar actualizaciones', { exact: true }).count(), 0)
    assert.deepEqual(updateRequests, [], `La web consultó el canal Android: ${updateRequests.join(', ')}`)
    assert.deepEqual(errors, [], `Errores de navegador: ${errors.join(' | ')}`)
    console.log('PASS web aislada: sin UI, solicitudes ni errores del actualizador Android')
  } finally {
    await browser.close()
  }
})().catch(error => { console.error(error); process.exitCode = 1 })
