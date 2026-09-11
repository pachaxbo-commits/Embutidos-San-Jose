// Cross-distributor scenario. Local Firebase emulators only; never production.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright')

const base = 'http://127.0.0.1:5180'
const repo = '/src/modules/distribution/data/distributionRepository.ts'
const output = path.resolve('docs/qa-san-jose')
const today = new Date().toLocaleDateString('en-CA')
const run = (page, name, ...args) => page.evaluate(async ({ repo, name, args }) => (await import(repo))[name](...args), { repo, name, args })

async function login(browser, email) {
  const context = await browser.newContext({ viewport: { width: 360, height: 800 } })
  const page = await context.newPage()
  await page.goto(base)
  await page.locator('input[type=email]').fill(email)
  await page.locator('input[type=password]').fill('demo1234')
  await page.getByRole('button', { name: 'Iniciar Sesión', exact: true }).click()
  await page.locator('.distribution-header').waitFor()
  await page.waitForTimeout(400)
  return { context, page }
}

async function nav(page, name) {
  const direct = page.getByRole('button', { name, exact: true }).filter({ visible: true })
  if (await direct.count()) return direct.first().click()
  await page.getByRole('button', { name: 'Mas', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name, exact: true }).click()
}

async function list(page, collectionName, filters = []) {
  return page.evaluate(async ({ collectionName, filters }) => {
    const firebase = await import('/src/lib/firebase.ts')
    const source = await (await fetch('/src/lib/firebase.ts')).text()
    const sdk = await import(source.match(/from "([^"\n]*firebase_firestore[^"\n]*)"/)[1])
    const ctx = await firebase.getFirebaseContext()
    let ref = sdk.collection(ctx.db, 'restaurants', ctx.restaurantId, collectionName)
    if (filters.length) ref = sdk.query(ref, ...filters.map(([field, value]) => sdk.where(field, '==', value)))
    const snapshot = await sdk.getDocs(ref)
    return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }))
  }, { collectionName, filters })
}

async function deniedQuery(page, collectionName, field, value) {
  return page.evaluate(async ({ collectionName, field, value }) => {
    try {
      const firebase = await import('/src/lib/firebase.ts')
      const source = await (await fetch('/src/lib/firebase.ts')).text()
      const sdk = await import(source.match(/from "([^"\n]*firebase_firestore[^"\n]*)"/)[1])
      const ctx = await firebase.getFirebaseContext()
      await sdk.getDocs(sdk.query(sdk.collection(ctx.db, 'restaurants', ctx.restaurantId, collectionName), sdk.where(field, '==', value)))
      return false
    } catch (error) {
      return String(error.code || error.message).includes('permission-denied')
    }
  }, { collectionName, field, value })
}

async function runScenario() {
  const browser = await chromium.launch({ headless: true, channel: 'chrome' })
  const suffix = Date.now().toString(36)
  const contexts = []
  try {
    const adminLogin = await login(browser, 'admin@sanjose.bo'); contexts.push(adminLogin.context)
    const warehouseLogin = await login(browser, 'almacen@sanjose.bo'); contexts.push(warehouseLogin.context)
    const hugoLogin = await login(browser, 'hugo@sanjose.bo'); contexts.push(hugoLogin.context)
    const ricardoLogin = await login(browser, 'ricardo@sanjose.bo'); contexts.push(ricardoLogin.context)
    const admin = adminLogin.page, warehouse = warehouseLogin.page, hugo = hugoLogin.page, ricardo = ricardoLogin.page

    const members = await admin.evaluate(async () => (await import('/src/lib/firebase.ts')).listRestaurantMembers())
    const hugoMember = members.find(member => member.email === 'hugo@sanjose.bo')
    const ricardoMember = members.find(member => member.email === 'ricardo@sanjose.bo')
    assert(hugoMember && ricardoMember)
    const customer = (await list(admin, 'distCustomers')).find(row => row.name === 'Cliente con mismo nombre')
    const product = (await list(admin, 'distProducts')).find(row => row.id === 'gra-viena')
    assert(customer && product)

    const photoDataUrl = await admin.evaluate(() => {
      const canvas = document.createElement('canvas'); canvas.width = 8; canvas.height = 8
      const context = canvas.getContext('2d'); context.fillStyle = '#c1121f'; context.fillRect(0, 0, 8, 8)
      return canvas.toDataURL('image/jpeg', 0.7)
    })
    await run(admin, 'saveProduct', { ...product, photoDataUrl })
    await admin.waitForTimeout(700)
    assert.equal((await list(admin, 'distProducts', [['id', 'gra-viena']]))[0].photoDataUrl, photoDataUrl, 'foto de producto sincronizada')
    await run(admin, 'saveCustomer', { id: customer.id, name: customer.name, identityNumber: customer.identityNumber, photoDataUrl, phone: '70000000', address: 'Dirección de prueba', addressReference: 'Portón rojo', routeId: customer.routeId })

    const dispatchId = await run(warehouse, 'confirmDispatch', {
      warehouseId: 'central', routeId: 'route-sud', routeName: 'Zona Sud', distributorUid: ricardoMember.uid,
      distributorName: ricardoMember.displayName, operationId: `ricardo-dispatch-${suffix}`,
      lines: [{ productId: product.id, productName: product.name, unitType: product.unitType, quantity: 6 }],
    })
    const saleBase = { sourceLocation: 'route', routeId: 'route-sud', routeName: 'Zona Sud', sellerUid: ricardoMember.uid, sellerName: ricardoMember.displayName, dispatchId, customerId: customer.id, customerName: customer.name, customerCode: customer.customerCode }
    const line = { productId: product.id, productNameSnapshot: product.name, unitType: product.unitType, quantity: 1, actualUnitPrice: 48, subtotal: 48 }
    await run(ricardo, 'registerSale', { ...saleBase, operationId: `ricardo-cash-${suffix}`, lines: [line], total: 48, paymentKind: 'cash', cashAmount: 48, qrAmount: 0, creditAmount: 0 })
    await run(ricardo, 'registerSale', { ...saleBase, operationId: `ricardo-credit-${suffix}`, lines: [line], total: 48, paymentKind: 'credit', cashAmount: 0, qrAmount: 0, creditAmount: 48 })
    await run(ricardo, 'registerExpense', { operationId: `ricardo-expense-${suffix}`, concept: 'Combustible Zona Sud', amount: 5, routeId: 'route-sud', routeName: 'Zona Sud', registeredByUid: ricardoMember.uid, registeredByName: ricardoMember.displayName })
    await ricardo.waitForTimeout(500)

    const foreignDebt = (await list(ricardo, 'distReceivables')).find(row => row.distributorUid === hugoMember.uid && row.balance >= 10)
    assert(foreignDebt, 'Ricardo debe poder leer una deuda originada por Hugo')
    await run(ricardo, 'registerCollection', { operationId: `ricardo-foreign-collection-${suffix}`, receivable: foreignDebt, amount: 10, method: 'cash', collectedByUid: ricardoMember.uid, collectedByName: ricardoMember.displayName, routeId: foreignDebt.routeId })
    await ricardo.waitForTimeout(400)

    const ownRicardoSales = await list(ricardo, 'distSales', [['sellerUid', ricardoMember.uid], ['dayKey', today]])
    const ownHugoSales = await list(hugo, 'distSales', [['sellerUid', hugoMember.uid], ['dayKey', today]])
    assert.equal(ownRicardoSales.length, 2, 'Ricardo ve sus dos ventas')
    assert(ownHugoSales.length >= 3, 'Hugo conserva sus ventas del escenario anterior')
    assert(await deniedQuery(ricardo, 'distSales', 'sellerUid', hugoMember.uid), 'Ricardo no puede consultar ventas de Hugo')
    assert(await deniedQuery(hugo, 'distSales', 'sellerUid', ricardoMember.uid), 'Hugo no puede consultar ventas de Ricardo')

    await nav(ricardo, 'Cierre')
    await ricardo.locator('input[type=number]').first().fill('4')
    await ricardo.getByRole('button', { name: 'Declarar retorno para almacen', exact: true }).click()
    await ricardo.getByText(/Retorno declarado/).waitFor()
    await nav(warehouse, 'Cierre')
    await warehouse.locator('input[type=number]').first().fill('4')
    await warehouse.getByRole('button', { name: 'Guardar retorno de almacen', exact: true }).click()
    await warehouse.getByRole('button', { name: 'Retorno ya registrado', exact: true }).waitFor()
    await ricardo.locator('input[type=number]').last().fill('53')
    await ricardo.getByRole('button', { name: 'Cerrar ruta', exact: true }).click()
    await ricardo.getByText('No hay rutas abiertas', { exact: true }).waitFor()

    const closure = (await list(admin, 'distClosures')).find(row => row.dispatchId === dispatchId)
    assert.equal(closure.status, 'closed')
    assert.equal(closure.expectedCash, 53, 'Ricardo entrega venta + cobro ajeno - gasto')
    assert.equal(closure.cashDifference, 0)
    assert(await deniedQuery(ricardo, 'distClosures', 'distributorUid', hugoMember.uid), 'Ricardo no puede consultar cierres de Hugo')
    assert(await deniedQuery(hugo, 'distClosures', 'distributorUid', ricardoMember.uid), 'Hugo no puede consultar cierres de Ricardo')

    await nav(ricardo, 'Creditos'); await ricardo.waitForTimeout(250)
    await nav(hugo, 'Creditos'); await hugo.waitForTimeout(250)
    const ricardoCreditText = await ricardo.locator('main').innerText()
    const hugoCreditText = await hugo.locator('main').innerText()
    const extract = text => text.match(/CARTERA PENDIENTE\s+Bs\s+([0-9.,]+)/)?.[1]
    assert.equal(extract(ricardoCreditText), extract(hugoCreditText), 'ambos distribuidores conservan la misma cartera global')

    await nav(ricardo, 'Vender'); await ricardo.waitForTimeout(250)
    const image = ricardo.getByRole('img', { name: `Foto de ${product.name}` })
    await image.waitFor()
    assert(await image.evaluate(node => node.complete && node.naturalWidth > 0), 'foto del producto visible en el dispositivo de Ricardo')

    const directSale = await run(admin, 'registerSale', {
      operationId: `admin-direct-${suffix}`, sourceLocation: 'centralWarehouse', routeId: 'route-directa', routeName: 'Venta directa', sellerUid: members.find(member => member.email === 'admin@sanjose.bo').uid,
      sellerName: 'Administración San José', customerId: customer.id, customerName: customer.name, customerCode: customer.customerCode,
      lines: [line], total: 48, paymentKind: 'cash', cashAmount: 48, qrAmount: 0, creditAmount: 0,
    })
    assert.equal(directSale.sourceLocation, 'centralWarehouse', 'Administración vende directamente desde almacén central')

    const result = { passed: true, at: new Date().toISOString(), dispatchId, closureId: closure.id, ricardoSales: ownRicardoSales.length, hugoSales: ownHugoSales.length, globalCredit: extract(ricardoCreditText), photoOnSecondDevice: true, crossSellerCollection: 10, expectedCash: closure.expectedCash }
    fs.writeFileSync(path.join(output, 'distributor-isolation-result.json'), JSON.stringify(result, null, 2))
    console.log('PASS Zona Sud: operación propia, cartera global, cobro cruzado, aislamiento, foto y cierre')
  } finally {
    for (const context of contexts) await context.close().catch(() => {})
    await browser.close()
  }
}

runScenario().catch(error => { console.error(error); process.exitCode = 1 })
