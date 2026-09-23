const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright')
const assert = require('node:assert/strict')

;(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true })
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    await page.goto('http://127.0.0.1:5180', { waitUntil: 'networkidle' })
    assert.equal(await page.getByRole('button', { name: 'Mostrar contraseña' }).count(), 1, 'Debe existir el ojo de contraseña')
    await page.locator('input[type=email]').fill('admin@sanjose.bo')
    await page.locator('input[type=password]').fill('demo1234')
    await page.getByRole('button', { name: 'Iniciar Sesión', exact: true }).click()
    await page.locator('.distribution-header').waitFor()
    const vender = page.getByRole('button', { name: 'Vender', exact: true })
    if (!(await vender.count())) await page.getByRole('button', { name: 'Mas', exact: true }).click()
    await page.getByRole('button', { name: 'Vender', exact: true }).click()
    await page.getByText('Las ventas administrativas no se atribuyen a ninguna zona ni distribuidor.').waitFor()
    assert.equal(await page.getByText('Sin existencia', { exact: true }).count(), 0, 'Venta no debe listar productos sin stock')
    const product = page.locator('main button').filter({ hasText: /disponibles/ }).first()
    if (await product.count()) {
      await product.click()
      await page.getByRole('button', { name: /Agregar/ }).click()
      await page.getByRole('button', { name: 'Cobrar', exact: true }).click()
      await page.getByText('Efectivo recibido (Bs)', { exact: true }).waitFor()
      await page.getByText('Cambio a devolver', { exact: true }).waitFor()
      await page.getByText('Observaciones', { exact: true }).waitFor()
      await page.getByRole('button', { name: /Seleccionar cliente/ }).click()
      await page.getByPlaceholder('Buscar por nombre, código o carnet...').waitFor()
      await page.getByRole('button', { name: /Registrar cliente rápido/ }).waitFor()
    }
    assert.deepEqual(errors, [], `Errores de navegador: ${errors.join(' | ')}`)
    console.log('PASS venta móvil: Administración separada, stock disponible, cambio, observaciones y selector de clientes')
  } finally { await browser.close() }
})().catch(error => { console.error(error); process.exitCode = 1 })
