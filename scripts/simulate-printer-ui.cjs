// Simulación de la configuración de impresora en navegador; no imprime físicamente.
const assert = require('node:assert/strict')
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright')

;(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'chrome' })
  const context = await browser.newContext({ viewport: { width: 360, height: 800 } })
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', error => errors.push(error.message))

  try {
    await page.goto('http://127.0.0.1:5180')
    await page.locator('input[type=email]').fill('admin@sanjose.bo')
    await page.locator('input[type=password]').fill('demo1234')
    await page.getByRole('button', { name: 'Iniciar Sesión', exact: true }).click()
    await page.locator('.distribution-header').waitFor()

    const openPrinter = async () => {
      await page.getByRole('button', { name: 'Mas', exact: true }).click()
      await page.getByRole('dialog').getByRole('button', { name: 'Impresoras', exact: true }).click()
      return page.getByRole('dialog')
    }
    const closeDialog = async dialog => dialog.getByRole('button', { name: 'Cerrar', exact: true }).last().click()

    let dialog = await openPrinter()
    await dialog.getByRole('heading', { name: 'Configurar impresora', exact: true }).waitFor()
    assert.equal(await dialog.getByText('IMPRESORA VINCULADA CORRECTAMENTE').count(), 0, 'sin perfil guardado empieza en configuración')

    await page.evaluate(async () => {
      const adapter = await import('/src/adapters/printing/androidBluetoothSppAdapter.ts')
      adapter.AndroidBluetoothSppAdapter.prototype.listPairedDevices = async () => [{ name: 'QIRUI QR-368BT', address: 'AA:BB:CC:DD:EE:FF' }]
      window.__printerProfileWrites = 0
      const originalSetItem = Storage.prototype.setItem
      Storage.prototype.setItem = function (key, value) {
        if (key === 'pachax:printer-profiles') window.__printerProfileWrites += 1
        return originalSetItem.call(this, key, value)
      }
    })
    await dialog.getByRole('button', { name: 'Buscar equipos vinculados', exact: true }).click()
    await dialog.getByRole('button', { name: /QIRUI QR-368BT/ }).click()
    assert(await dialog.getByRole('button', { name: 'Guardar', exact: true }).isVisible(), 'seleccionar no guarda ni abandona el formulario')
    await dialog.getByText('QIRUI QR-368BT seleccionada. Guarda para utilizar esta impresora.', { exact: true }).waitFor()
    await dialog.getByRole('button', { name: 'Guardar', exact: true }).click()
    await dialog.getByText('IMPRESORA VINCULADA CORRECTAMENTE', { exact: true }).waitFor()
    assert.equal(await dialog.getByRole('button', { name: 'Buscar equipos vinculados', exact: true }).count(), 0, 'al guardar desaparece búsqueda')
    assert.equal(await dialog.getByRole('button', { name: 'Guardar', exact: true }).count(), 0, 'al guardar desaparece Guardar')
    assert.equal(await page.evaluate(() => window.__printerProfileWrites), 1, 'guardar perfil ejecuta un único guardado')
    for (const value of ['QIRUI QR-368BT', 'Bluetooth', 'AA:BB:CC:DD:EE:FF', '58 mm', 'Automático · TSPL']) {
      await dialog.getByText(value, { exact: true }).waitFor()
    }
    assert(await dialog.getByRole('button', { name: 'Probar impresión', exact: true }).isVisible())
    assert(await dialog.getByRole('button', { name: 'Cambiar impresora', exact: true }).isVisible())
    await closeDialog(dialog)

    dialog = await openPrinter()
    await dialog.getByText('IMPRESORA VINCULADA CORRECTAMENTE', { exact: true }).waitFor()
    await dialog.getByRole('button', { name: 'Cambiar impresora', exact: true }).click()
    await dialog.getByRole('heading', { name: 'Configurar impresora', exact: true }).waitFor()
    await closeDialog(dialog)
    dialog = await openPrinter()
    await dialog.getByText('QIRUI QR-368BT', { exact: true }).waitFor()
    await dialog.getByText('AA:BB:CC:DD:EE:FF', { exact: true }).waitFor()

    await page.evaluate(async () => {
      const engine = (await import('/src/services/printing/printEngineService.ts')).PrintEngineService.getInstance()
      engine.submitPrintRequest = async () => ({ status: 'transmitted' })
    })
    await dialog.getByRole('button', { name: 'Probar impresión', exact: true }).click()
    await dialog.getByText('IMPRESORA LISTA', { exact: true }).waitFor()
    await dialog.getByText('La prueba se envió correctamente. Comprueba que el ticket salió completo.', { exact: true }).waitFor()

    await page.evaluate(async () => {
      const engine = (await import('/src/services/printing/printEngineService.ts')).PrintEngineService.getInstance()
      engine.submitPrintRequest = async () => { throw new Error('Fallo simulado de prueba') }
    })
    await dialog.getByRole('button', { name: 'Probar impresión', exact: true }).click()
    await dialog.getByRole('alert').waitFor()
    await dialog.getByText('QIRUI QR-368BT', { exact: true }).waitFor()
    await dialog.getByText('AA:BB:CC:DD:EE:FF', { exact: true }).waitFor()

    await dialog.getByRole('button', { name: 'Cambiar impresora', exact: true }).click()
    await dialog.getByRole('button', { name: 'Red local', exact: true }).click()
    const ip = dialog.getByPlaceholder('192.168.1.150')
    await ip.fill('999.1.1.1')
    assert(!(await dialog.getByRole('button', { name: 'Guardar', exact: true }).isEnabled()), 'IP inválida bloqueada')
    await ip.fill('192.168.1.150')
    await dialog.getByText('80 mm opcional', { exact: true }).click()
    await dialog.getByRole('button', { name: 'Guardar', exact: true }).click()
    await dialog.getByText('IMPRESORA VINCULADA CORRECTAMENTE', { exact: true }).waitFor()
    for (const value of ['Impresora de red', 'Red local', 'IP: 192.168.1.150 · Puerto 9100', '80 mm', 'Automático · ESC/POS']) {
      await dialog.getByText(value, { exact: true }).waitFor()
    }

    await dialog.getByRole('button', { name: 'Cambiar impresora', exact: true }).click()
    await dialog.getByPlaceholder('192.168.1.150').fill('192.168.1.151')
    await closeDialog(dialog)
    dialog = await openPrinter()
    await dialog.getByText('IP: 192.168.1.150 · Puerto 9100', { exact: true }).waitFor()
    await dialog.getByText('80 mm', { exact: true }).waitFor()

    for (const width of [320, 360, 390, 430, 768, 1280]) {
      await page.setViewportSize({ width, height: 900 })
      assert((await page.evaluate(() => document.documentElement.scrollWidth)) <= width + 1, `sin desborde horizontal en ${width}px`)
    }
    assert.deepEqual(errors, [], 'sin errores JavaScript')
    console.log('PASS interfaz de impresora: primera configuración, guardado, resumen Bluetooth/TCP, prueba, conservación al cancelar y responsive')
  } finally {
    await context.close()
    await browser.close()
  }
})().catch(error => {
  console.error(error)
  process.exitCode = 1
})
