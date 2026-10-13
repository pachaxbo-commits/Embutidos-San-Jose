// Matriz visual del editor de corrección. Requiere emuladores sembrados y Vite en :5180.
const assert = require('node:assert/strict')
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright')

;(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true })
  try {
    const page = await browser.newPage({ viewport: { width: 1366, height: 900 } })
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    await page.goto('http://127.0.0.1:5180', { waitUntil: 'networkidle' })
    await page.locator('input[type=email]').fill('admin@sanjose.bo')
    await page.locator('input[type=password]').fill('demo1234')
    await page.getByRole('button', { name: 'Iniciar Sesión', exact: true }).click()
    await page.locator('.distribution-header').waitFor()
    const vender = page.getByRole('button', { name: 'Ventas', exact: true })
    if (!(await vender.count())) await page.getByRole('button', { name: 'Mas', exact: true }).click()
    await page.getByRole('button', { name: 'Ventas', exact: true }).click()
    await page.getByRole('button', { name: 'Historial', exact: true }).click()
    const correct = page.getByRole('button', { name: /Corregir/ }).first()
    await correct.waitFor()
    await correct.click()
    await page.getByText('Corrección auditada de venta', { exact: true }).waitFor()
    assert(await page.getByLabel(/Nuevo precio de/).count(), 'Debe existir el precio editable')
    for (const width of [320, 360, 390, 430, 768, 1366]) {
      await page.setViewportSize({ width, height: width < 600 ? 844 : 900 })
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)
      assert.equal(overflow, false, `No debe existir desborde horizontal a ${width}px`)
      const price = page.getByLabel(/Nuevo precio de/).first()
      const box = await price.boundingBox()
      assert(box && box.width >= 100 && box.height >= 32, `Precio debe ser utilizable a ${width}px`)
    }
    assert.deepEqual(errors, [], `Errores de navegador: ${errors.join(' | ')}`)
    console.log('PASS corrección de venta responsive: 320, 360, 390, 430, 768 y escritorio')
  } finally {
    await browser.close()
  }
})().catch(error => { console.error(error); process.exitCode = 1 })
