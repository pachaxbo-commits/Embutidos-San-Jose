// Full role/navigation audit against local Firebase emulators only.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright')

const base = 'http://127.0.0.1:5180'
const output = path.resolve('../PACHAX_QA_RESULTS/Embutidos-San-Jose')
const password = 'demo1234'
fs.mkdirSync(output, { recursive: true })

const matrix = {
  admin: {
    email: 'admin@sanjose.bo',
    allowed: ['Inicio', 'Vender', 'Creditos', 'Gastos', 'Cierre', 'Inventario', 'Despachos', 'Cobros', 'Clientes', 'Productos', 'Reportes', 'Usuarios', 'Cambios y devoluciones', 'Verificar QR', 'Almacenes', 'Impresoras'],
    forbidden: [],
  },
  warehouse: {
    email: 'almacen@sanjose.bo',
    allowed: ['Inicio', 'Cierre', 'Inventario', 'Despachos', 'Almacenes'],
    forbidden: ['Vender', 'Creditos', 'Gastos', 'Cobros', 'Clientes', 'Productos', 'Reportes', 'Usuarios', 'Cambios y devoluciones', 'Verificar QR', 'Impresoras'],
  },
  hugo: {
    email: 'hugo@sanjose.bo',
    allowed: ['Inicio', 'Vender', 'Creditos', 'Gastos', 'Cierre', 'Impresoras'],
    forbidden: ['Inventario', 'Despachos', 'Cobros', 'Clientes', 'Productos', 'Reportes', 'Usuarios', 'Cambios y devoluciones', 'Verificar QR', 'Almacenes'],
  },
  ricardo: {
    email: 'ricardo@sanjose.bo',
    allowed: ['Inicio', 'Vender', 'Creditos', 'Gastos', 'Cierre', 'Impresoras'],
    forbidden: ['Inventario', 'Despachos', 'Cobros', 'Clientes', 'Productos', 'Reportes', 'Usuarios', 'Cambios y devoluciones', 'Verificar QR', 'Almacenes'],
  },
}

async function login(browser, account, errors) {
  const context = await browser.newContext({ viewport: { width: 360, height: 800 } })
  const page = await context.newPage()
  page.on('pageerror', error => errors.push(`${account}: ${error.message}`))
  page.on('console', message => {
    if (message.type() === 'error') errors.push(`${account} consola: ${message.text()}`)
  })
  await page.goto(base)
  await page.locator('input[type=email]').fill(matrix[account].email)
  await page.locator('input[type=password]').fill(password)
  await page.getByRole('button', { name: 'Iniciar Sesión', exact: true }).click()
  await page.locator('.distribution-header').waitFor()
  await page.waitForTimeout(500)
  return { context, page }
}

async function moreText(page) {
  await page.getByRole('button', { name: 'Mas', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await dialog.waitFor()
  const text = await dialog.innerText()
  await page.keyboard.press('Escape')
  return text
}

async function navigate(page, label) {
  const direct = page.getByRole('button', { name: label, exact: true }).filter({ visible: true })
  if (await direct.count()) {
    await direct.first().click()
  } else {
    await page.getByRole('button', { name: 'Mas', exact: true }).click()
    await page.getByRole('dialog').getByRole('button', { name: label, exact: true }).click()
  }
  if (label === 'Impresoras') await page.getByRole('heading', { name: 'Configurar impresora', exact: true }).waitFor()
  else await page.locator('main').waitFor()
  await page.waitForTimeout(150)
}

async function assertLayout(page, account, label) {
  const layout = await page.evaluate(() => ({
    width: innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
    headerTop: document.querySelector('.distribution-header')?.getBoundingClientRect().top ?? 0,
    body: document.body.innerText,
  }))
  assert(layout.scrollWidth <= layout.width + 1, `${account}/${label}: desbordamiento horizontal`)
  assert(layout.headerTop >= 0, `${account}/${label}: cabecera cortada`)
  assert(!/Missing or insufficient permissions|FirebaseError:\s*\[code=permission-denied\]/i.test(layout.body), `${account}/${label}: error de permisos visible`)
}

async function run() {
  const browser = await chromium.launch({ headless: true, channel: 'chrome' })
  const errors = []
  const result = { passed: false, roles: {}, globalCredit: {} }
  try {
    for (const account of Object.keys(matrix)) {
      const { context, page } = await login(browser, account, errors)
      const menu = await moreText(page)
      for (const forbidden of matrix[account].forbidden) {
        const directCount = await page.getByRole('button', { name: forbidden, exact: true }).filter({ visible: true }).count()
        assert.equal(directCount, 0, `${account}: ${forbidden} no debe estar en la barra`)
        assert(!menu.split('\n').includes(forbidden), `${account}: ${forbidden} no debe estar en Más`)
      }

      const visited = []
      for (const label of matrix[account].allowed) {
        await navigate(page, label)
        await assertLayout(page, account, label)
        visited.push(label)
        if (label === 'Creditos' && (account === 'hugo' || account === 'ricardo')) {
          const text = await page.locator('main').innerText()
          assert(text.includes('Cartera general de todos los clientes'), `${account}: créditos no indica cartera global`)
          assert(text.includes('Tienda Dona Rosa'), `${account}: no ve la deuda global disponible para todos los distribuidores`)
          result.globalCredit[account] = text.match(/CARTERA PENDIENTE\s+Bs\s+[0-9.,]+/)?.[0] || ''
        }
        if (label === 'Impresoras') {
          await page.getByRole('dialog').getByRole('button', { name: 'Cerrar', exact: true }).last().click()
          await page.locator('.distribution-header').waitFor()
        }
      }
      await page.screenshot({ path: path.join(output, `simulacro-${account}.png`), fullPage: true })
      result.roles[account] = { visited, forbidden: matrix[account].forbidden }
      await context.close()
    }
    assert(result.globalCredit.hugo && result.globalCredit.hugo === result.globalCredit.ricardo, 'Hugo y Ricardo deben ver el mismo total de cartera')
    assert.deepEqual(errors, [], 'errores de página o consola')
    result.passed = true
    result.at = new Date().toISOString()
    fs.writeFileSync(path.join(output, 'role-matrix-result.json'), JSON.stringify(result, null, 2))
    console.log(`PASS matriz completa: ${Object.values(result.roles).reduce((sum, role) => sum + role.visited.length, 0)} secciones recorridas en cuatro usuarios`)
  } finally {
    await browser.close()
  }
}

run().catch(error => {
  console.error(error)
  process.exitCode = 1
})
