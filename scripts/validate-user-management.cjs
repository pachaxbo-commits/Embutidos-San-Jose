// Flujo destructivo confinado al emulador: edita, restaura y elimina usuarios ficticios.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright')

async function openUsers(page) {
  let button = page.getByRole('button', { name: 'Usuarios', exact: true }).filter({ visible: true })
  if (!(await button.count())) {
    await page.getByRole('button', { name: 'Mas', exact: true }).click()
    button = page.getByRole('dialog').getByRole('button', { name: 'Usuarios', exact: true })
  }
  await button.first().click()
  await page.getByRole('heading', { name: 'Usuarios', exact: true }).waitFor()
}

;(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true })
  try {
    const page = await browser.newPage({ viewport: { width: 360, height: 800 } })
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    await page.goto('http://127.0.0.1:5180')
    await page.locator('input[type=email]').fill('admin@sanjose.bo')
    await page.locator('input[type=password]').fill('demo1234')
    await page.getByRole('button', { name: 'Iniciar Sesión', exact: true }).click()
    await page.locator('.distribution-header').waitFor()
    await openUsers(page)

    await page.getByRole('button', { name: /Administración.*1 usuario/ }).click()
    await page.getByRole('button', { name: /Duena San Jose.*admin@sanjose\.bo.*ACTIVO/ }).click()
    assert(await page.getByRole('button', { name: 'Eliminar', exact: true }).isDisabled(), 'la única cuenta administrativa no debe poder eliminarse')
    assert.match(await page.locator('main').innerText(), /única cuenta administrativa activa/i)
    await page.getByRole('button', { name: 'Editar datos', exact: true }).click()
    const ownEdit = page.getByRole('dialog', { name: 'Editar usuario' })
    assert.equal(await ownEdit.locator('input[type=email]').inputValue(), 'admin@sanjose.bo')
    await ownEdit.getByRole('button', { name: 'Cerrar', exact: true }).last().click()

    await page.getByRole('button', { name: /Distribuidores.*2 usuarios/ }).click()
    await page.getByRole('button', { name: /Hugo Herbas.*hugo@sanjose\.bo.*ACTIVO/ }).click()
    await page.getByRole('button', { name: 'Editar datos', exact: true }).click()
    const edit = page.getByRole('dialog', { name: 'Editar usuario' })
    await edit.locator('input').first().fill('Hugo Herbas actualizado')
    await edit.getByRole('button', { name: 'Guardar cambios', exact: true }).click()
    await page.getByText('Información actualizada para Hugo Herbas actualizado.', { exact: true }).waitFor()
    assert.match(await page.locator('main').innerText(), /Hugo Herbas actualizado/)

    await page.getByRole('button', { name: /Ricardo Jimenez.*ricardo@sanjose\.bo.*ACTIVO/ }).click()
    await page.getByRole('button', { name: 'Eliminar', exact: true }).click()
    const remove = page.getByRole('dialog', { name: 'Eliminar usuario' })
    assert.match(await remove.innerText(), /ventas, despachos y movimientos anteriores permanecerán/i)
    await remove.getByRole('button', { name: 'Sí, eliminar usuario', exact: true }).click()
    await page.getByText('Usuario eliminado correctamente. Ya no podrá iniciar sesión.', { exact: true }).waitFor()
    assert(!/ricardo@sanjose\.bo/.test(await page.locator('main').innerText()))
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'la pantalla no debe desbordar horizontalmente')
    assert.deepEqual(errors, [])
    const result = { passed: true, checks: 8, at: new Date().toISOString() }
    fs.writeFileSync(path.resolve('docs/qa-san-jose/user-management-result.json'), JSON.stringify(result, null, 2))
    console.log('PASS gestión de usuarios: edición, correo visible, eliminación y protección de Administración')
  } finally {
    await browser.close()
  }
})().catch(error => {
  console.error(error)
  process.exitCode = 1
})
