const fs = require('node:fs')
const assert = require('node:assert/strict')
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright')

;
(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true })
  const results = { passed: false, viewports: [], resetCompleted: false, errors: [] }
  try {
    for (const viewport of [{ width: 360, height: 800 }, { width: 768, height: 1024 }]) {
      const context = await browser.newContext({ viewport })
      const page = await context.newPage()
      page.on('pageerror', error => results.errors.push(error.message))
      await page.goto('http://127.0.0.1:5180')
      await page.locator('input[type=email]').fill('soporte@sanjose.bo')
      await page.locator('input[type=password]').fill('demo1234')
      await page.getByRole('button', { name: 'Iniciar Sesión', exact: true }).click()
      await page.locator('.distribution-header').waitFor()
      await page.getByRole('heading', { name: 'Configuración', exact: true }).waitFor()
      assert.equal(await page.getByRole('heading', { name: /Vender|Créditos|Clientes|Reportes/ }).count(), 0)
      assert(await page.getByText('Información comercial bloqueada').isVisible())
      assert(await page.getByRole('button', { name: /Configurar y probar impresora/ }).isVisible())
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'desbordamiento horizontal')
      await page.screenshot({ path: `../PACHAX_QA_RESULTS/Embutidos-San-Jose/support-${viewport.width}x${viewport.height}.png`, fullPage: true })
      results.viewports.push(`${viewport.width}x${viewport.height}`)

      if (viewport.width === 360) {
        await page.getByRole('button', { name: /Revisar limpieza/ }).click()
        await page.getByRole('button', { name: /Mostrar datos que se limpiarán/ }).click()
        await page.getByText(/registros serán respaldados/).waitFor()
        const execute = page.getByRole('button', { name: /Crear respaldo y limpiar datos/ })
        assert(await execute.isDisabled(), 'la confirmación final debe iniciar bloqueada')
        await page.getByLabel('Contraseña actual').fill('demo1234')
        await page.getByLabel(/Escribe:/).fill('LIMPIAR EMBUTIDOS SAN JOSE')
        await page.getByText(/Confirmo que revisé el conteo/).click()
        assert(!(await execute.isDisabled()), 'la confirmación final debe habilitarse después de los tres controles')
        await execute.click()
        await page.getByText(/Entrega limpia terminada/).waitFor({ timeout: 30000 })
        results.resetCompleted = true
      }
      await context.close()
    }
    assert.deepEqual(results.errors, [])
    results.passed = true
    fs.writeFileSync('../PACHAX_QA_RESULTS/Embutidos-San-Jose/support-center-result.json', JSON.stringify(results, null, 2))
    console.log('PASS Soporte: aislamiento comercial, configuración responsive y limpieza con doble confirmación')
  } finally { await browser.close() }
})().catch(error => { console.error(error); process.exitCode = 1 })
