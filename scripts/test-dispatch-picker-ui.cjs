// E2E del selector de Nuevo despacho. Requiere Auth/Firestore Emulator sembrados y Vite en 127.0.0.1:5180.
// Solo crea productos/saldos sintéticos directamente en el Emulator; nunca confirma despachos.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { chromium, webkit } = require(process.env.PLAYWRIGHT_MODULE || 'playwright')

const BASE_URL = 'http://127.0.0.1:5180'
const screenshotsDir = path.resolve('output/qa/dispatch-picker')
const projectProducts = [
  { id: 'qa-dispatch-order-a', name: 'Orden A' },
  { id: 'qa-dispatch-order-b', name: 'Orden B' },
  { id: 'qa-dispatch-order-c', name: 'Orden C', photo: true },
  { id: 'qa-dispatch-order-d', name: 'Orden D' },
]
async function addSyntheticProducts(page) {
  await page.evaluate(async () => {
    const firebase = await import('/src/lib/firebase.ts')
    const context = await firebase.getFirebaseContext()
    if (context.app.options.projectId !== 'demo-pachax-audit' || !window.__pachaxDevNetwork) {
      throw new Error('La prueba UI exige Firebase Emulator y rechaza cualquier proyecto no demo.')
    }
  })
  await page.waitForTimeout(500)
}

async function login(page) {
  await page.goto(BASE_URL, { waitUntil: 'networkidle' })
  await page.locator('input[type=email]').fill('admin@sanjose.bo')
  await page.locator('input[type=password]').fill('demo1234')
  await page.getByRole('button', { name: 'Iniciar Sesión', exact: true }).click()
  await page.locator('.distribution-header').waitFor()
  const dispatchButton = page.getByRole('button', { name: 'Despachos', exact: true }).filter({ visible: true })
  if (await dispatchButton.count()) await dispatchButton.first().click()
  else {
    await page.getByRole('button', { name: 'Mas', exact: true }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Despachos', exact: true }).click()
  }
  await page.getByRole('button', { name: 'Nuevo', exact: true }).click()
  await page.getByRole('button', { name: 'Seleccionar productos', exact: true }).click()
  await page.getByRole('dialog', { name: 'Productos del despacho' }).waitFor()
}

async function verifyPicker(page, sizes, isMobile = false, label = '') {
  fs.mkdirSync(screenshotsDir, { recursive: true })
  const dialog = page.getByRole('dialog', { name: 'Productos del despacho' })
  const search = dialog.getByRole('textbox', { name: 'Buscar productos del despacho' })
  const body = dialog.locator('.overflow-y-auto')
  for (const size of sizes) {
    await page.setViewportSize(size)
    const box = await dialog.locator(':scope > div').first().boundingBox()
    assert(box, `panel visible a ${size.width}x${size.height}`)
    if (isMobile && size.width <= 640) {
      assert(box.height < size.height * 0.61, `selector compacto ${size.width}x${size.height}: ${box.height}px`)
      assert(box.height > size.height * 0.4, `selector usable ${size.width}x${size.height}: ${box.height}px`)
    } else if (!isMobile) assert(box.width >= 900, `modal desktop amplio (${box.width}px)`)
    else assert(box.height <= size.height, `modal tablet no desborda ${size.width}x${size.height}`)
    assert(await search.isVisible(), `búsqueda visible a ${size.width}px`)
    assert(await dialog.getByRole('button', { name: /Listo ·/ }).isVisible(), `botón Listo accesible a ${size.width}px`)
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `sin scroll horizontal a ${size.width}px`)
  }
  if (label === 'Chromium desktop') await page.screenshot({ path: path.join(screenshotsDir, 'desktop.png') })
  if (isMobile) {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.screenshot({ path: path.join(screenshotsDir, label === 'WebKit mobile' ? 'webkit-mobile.png' : 'mobile-390.png') })
    await page.setViewportSize({ width: 390, height: 500 }) // viewport reducido, como cuando el teclado ocupa la parte inferior
    let mobileBox = await dialog.locator(':scope > div').first().boundingBox()
    assert(mobileBox && mobileBox.height <= 305, 'panel se adapta cuando el viewport se reduce por el teclado')
    assert(await search.isVisible(), 'búsqueda sigue visible con viewport reducido')
    assert(await dialog.getByRole('button', { name: /Listo ·/ }).isVisible(), 'Listo sigue accesible con viewport reducido')
    await dialog.getByRole('button', { name: 'Expandir', exact: true }).click()
    mobileBox = await dialog.locator(':scope > div').first().boundingBox()
    assert(mobileBox && mobileBox.height > 390, 'Expandir amplía el panel solo tras acción explícita')
    await dialog.getByRole('button', { name: 'Reducir', exact: true }).click()
    await page.setViewportSize(sizes[sizes.length - 1])
  }

  await search.fill('QA extra')
  const longResults = dialog.locator('[data-dispatch-product-card]')
  assert((await longResults.count()) >= 20, 'catálogo amplio visible en la búsqueda sintética')
  const scroller = await body.elementHandle()
  const target = dialog.locator('[data-dispatch-product-card="qa-dispatch-extra-10"]')
  await target.scrollIntoViewIfNeeded()
  await target.locator('img').scrollIntoViewIfNeeded()
  const before = await scroller.evaluate((node, card) => ({ scrollTop: node.scrollTop, clientHeight: node.clientHeight, windowHeight: innerHeight, scrollHeight: node.scrollHeight, cardTop: card.getBoundingClientRect().top, cardHeight: card.getBoundingClientRect().height, image: [card.querySelector('img')?.naturalWidth, card.querySelector('img')?.naturalHeight, card.querySelector('img')?.getBoundingClientRect().height, card.querySelector('img')?.style.visibility] }), await target.elementHandle())
  const imageBox = await target.locator('img').boundingBox()
  assert(imageBox, 'imagen del producto visible para pulsación')
  const imageX = imageBox.x + imageBox.width / 2
  const imageY = imageBox.y + imageBox.height / 2
  if (label === 'WebKit mobile') await target.locator('img').evaluate(image => image.click())
  else if (isMobile) await page.touchscreen.tap(imageX, imageY)
  else await page.mouse.click(imageX, imageY)
  await page.waitForTimeout(50)
  const after = await scroller.evaluate((node, card) => ({ scrollTop: node.scrollTop, clientHeight: node.clientHeight, windowHeight: innerHeight, scrollHeight: node.scrollHeight, cardTop: card.getBoundingClientRect().top, cardHeight: card.getBoundingClientRect().height, image: [card.querySelector('img')?.naturalWidth, card.querySelector('img')?.naturalHeight, card.querySelector('img')?.getBoundingClientRect().height, card.querySelector('img')?.style.visibility] }), await target.elementHandle())
  assert.equal(await search.inputValue(), 'QA extra', 'seleccionar conserva el texto de búsqueda')
  assert(Math.abs(after.scrollTop - before.scrollTop) <= 2, `seleccionar conserva scrollTop (${before.scrollTop} → ${after.scrollTop})`)
  assert(Math.abs(after.cardTop - before.cardTop) <= 3, `la tarjeta conserva posición visible (${before.cardTop} → ${after.cardTop})`)
  assert.equal(await target.getByRole('button', { name: /QA extra 10/ }).getAttribute('aria-pressed'), 'true', 'tocar la imagen selecciona la tarjeta correcta')
  assert(await target.isVisible(), 'la tarjeta seleccionada permanece visible')
  await target.getByRole('button', { name: /QA extra 10/ }).click()
  assert.equal(await search.inputValue(), 'QA extra', 'desmarcar también conserva la búsqueda')

  await search.fill('Orden')
  const order = dialog.locator('[data-dispatch-product-card]')
  const catalogOrder = await order.evaluateAll(cards => cards.map(card => card.getAttribute('data-dispatch-product-card')))
  assert.deepEqual(catalogOrder, projectProducts.map(product => product.id), 'el buscador conserva el orden global del catálogo')

  const pick = async letter => {
    await search.fill('Orden ' + letter)
    const card = dialog.locator('[data-dispatch-product-card="qa-dispatch-order-' + letter.toLowerCase() + '"]')
    const selectionButton = card.getByRole('button', { name: 'Seleccionar Orden ' + letter })
    if (letter === 'C') await card.locator('img').click()
    else if (letter === 'D') {
      await selectionButton.focus()
      await selectionButton.press('Enter')
      assert.equal(await selectionButton.getAttribute('aria-pressed'), 'true', 'Enter selecciona con accesibilidad de teclado')
      await selectionButton.press('Space')
      assert.equal(await selectionButton.getAttribute('aria-pressed'), 'false', 'Space deselecciona con accesibilidad de teclado')
      await selectionButton.click()
    } else await selectionButton.click()
    assert.equal(await search.inputValue(), 'Orden ' + letter, 'el selector mantiene búsqueda tras seleccionar Orden ' + letter)
    assert.equal(await selectionButton.getAttribute('aria-pressed'), 'true', 'solo se selecciona Orden ' + letter)
  }

  await pick('C')
  await pick('A')
  await pick('D')
  await pick('B')
  await search.fill('Orden')
  const checked = await dialog.locator('button[aria-pressed="true"]').evaluateAll(buttons => buttons.map(button => button.getAttribute('aria-label')))
  assert.deepEqual(checked, ['Seleccionar Orden A', 'Seleccionar Orden B', 'Seleccionar Orden C', 'Seleccionar Orden D'], 'los cuatro productos quedan seleccionados y el catálogo no cambia de orden')

  const selectedOrder = async () => page.locator('[data-dispatch-product-line]').evaluateAll(nodes => nodes.map(node => node.getAttribute('data-dispatch-product-line')))
  await dialog.getByRole('button', { name: /Listo · 4 productos/ }).click()
  assert.deepEqual(await selectedOrder(), ['qa-dispatch-order-c', 'qa-dispatch-order-a', 'qa-dispatch-order-d', 'qa-dispatch-order-b'], 'el formulario usa C, A, D, B según orden de selección')
  const newDispatch = page.getByRole('dialog', { name: 'Nuevo despacho' })
  const issues = newDispatch.getByRole('region', { name: 'Validación del despacho' })
  assert((await issues.innerText()).includes('4 productos pendientes de completar'), 'el resumen inferior compacta los productos que todavía se completan')
  assert(await newDispatch.getByRole('button', { name: 'Continuar', exact: true }).isDisabled(), 'Continuar permanece bloqueado mientras hay errores de lote/cantidad')
  await issues.getByRole('button', { name: 'Ver detalles' }).click()
  assert((await issues.innerText()).includes('Producto Orden C'), 'los detalles desplegados contienen el producto pendiente')
  await issues.getByRole('button', { name: 'Ir al campo' }).first().click()
  assert((await page.evaluate(() => document.activeElement?.getAttribute('aria-label')) || '').startsWith('Cantidad normal de '), 'Ir al campo enfoca la cantidad del producto relacionado')
  await page.getByRole('button', { name: 'Editar productos', exact: true }).click()
  const reopened = page.getByRole('dialog', { name: 'Productos del despacho' })
  const removeAButton = reopened.locator('[data-dispatch-product-card="qa-dispatch-order-a"]').getByRole('button', { name: 'Seleccionar Orden A' })
  await reopened.getByRole('textbox', { name: 'Buscar productos del despacho' }).fill('Orden A')
  await removeAButton.click()
  await reopened.getByRole('textbox', { name: 'Buscar productos del despacho' }).fill('Orden A')
  await removeAButton.click()
  await reopened.getByRole('button', { name: /Listo · 4 productos/ }).click()
  assert.deepEqual(await selectedOrder(), ['qa-dispatch-order-c', 'qa-dispatch-order-d', 'qa-dispatch-order-b', 'qa-dispatch-order-a'], 'deseleccionar y re-seleccionar agrega el producto al final')

  await newDispatch.getByRole('button', { name: 'Cerrar' }).last().click()
  await page.getByRole('button', { name: 'Nuevo', exact: true }).click()
  await page.getByRole('button', { name: 'Seleccionar productos', exact: true }).click()
  const nextDraftPicker = page.getByRole('dialog', { name: 'Productos del despacho' })
  await nextDraftPicker.getByRole('textbox', { name: 'Buscar productos del despacho' }).fill('Orden')
  const nextDraftCatalog = await nextDraftPicker.locator('[data-dispatch-product-card]').evaluateAll(cards => cards.map(card => card.getAttribute('data-dispatch-product-card')))
  assert.deepEqual(nextDraftCatalog, ['qa-dispatch-order-a', 'qa-dispatch-order-b', 'qa-dispatch-order-c', 'qa-dispatch-order-d'], 'el siguiente borrador vuelve al orden del catálogo global')
  await nextDraftPicker.getByRole('button', { name: /Listo · 0 productos/ }).click()
  await page.getByRole('button', { name: 'Seleccionar productos', exact: true }).click()
  const validationPicker = page.getByRole('dialog', { name: 'Productos del despacho' })
  await validationPicker.getByRole('textbox', { name: 'Buscar productos del despacho' }).fill('Salchicha tipo Viena')
  await validationPicker.locator('[data-dispatch-product-card]').first().getByRole('button', { name: 'Seleccionar Salchicha tipo Viena' }).click()
  await validationPicker.getByRole('textbox', { name: 'Buscar productos del despacho' }).fill('Orden A')
  await validationPicker.locator('[data-dispatch-product-card="qa-dispatch-order-a"]').getByRole('button', { name: 'Seleccionar Orden A' }).click()
  await validationPicker.getByRole('button', { name: /Listo · 2 productos/ }).click()

  const viennaLine = page.locator('[data-dispatch-product-line="gra-viena"]')
  await viennaLine.getByRole('spinbutton', { name: 'Cantidad normal de Salchicha tipo Viena' }).fill('5')
  await viennaLine.getByRole('button', { name: '+ Agregar otro lote' }).click()
  await viennaLine.getByRole('combobox', { name: 'Lote de Salchicha tipo Viena' }).selectOption('qa-lot-viena-3kg')
  await viennaLine.getByRole('spinbutton', { name: 'Cantidad del lote para Salchicha tipo Viena' }).fill('5')
  const contextualLotError = viennaLine.getByRole('alert').filter({ hasText: 'VIENA-TEST-3KG' })
  assert((await contextualLotError.innerText()).includes('ingresado 5 kg, disponible 3 kg; exceso 2 kg'), 'el error contextual identifica producto, lote, ingresado, disponible y exceso')
  const bothIssues = page.getByRole('dialog', { name: 'Nuevo despacho' }).getByRole('region', { name: 'Validación del despacho' })
  assert((await bothIssues.innerText()).includes('1 error que debes corregir') && (await bothIssues.innerText()).includes('1 producto pendiente de completar'), 'el resumen separa el error real de la línea incompleta')
  await bothIssues.getByRole('button', { name: 'Ver detalles' }).click()
  const bothIssueText = await bothIssues.innerText()
  assert(bothIssueText.includes('VIENA-TEST-3KG') && bothIssueText.includes('Producto Orden A'), 'el resumen expandido muestra el exceso de lote y la línea pendiente de otro producto')
  assert(await page.getByRole('dialog', { name: 'Nuevo despacho' }).getByRole('button', { name: 'Continuar', exact: true }).isDisabled(), 'el exceso de 2 kg bloquea Continuar')
  await bothIssues.getByRole('button', { name: 'Ir al campo' }).first().click()
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')), 'Cantidad del lote para Salchicha tipo Viena', 'Ir al error lleva y enfoca el campo de asignación del lote')
  assert((await viennaLine.locator('[data-dispatch-allocation-id]').first().getAttribute('class')).includes('ring-4'), 'el lote afectado queda resaltado')
  await page.getByRole('dialog', { name: 'Nuevo despacho' }).getByRole('button', { name: 'Cerrar' }).last().click()
  console.log(`PASS ${label}: lista grande, búsqueda/scroll estables, imagen seleccionable, orden de selección y errores accesibles`)
}

async function runEngine(browserType, label, viewports, isMobile = false) {
  const browser = await browserType.launch({ headless: true })
  const context = await browser.newContext({ viewport: viewports[0], isMobile, hasTouch: isMobile })
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  try {
    await login(page)
    await addSyntheticProducts(page)
    await verifyPicker(page, viewports, isMobile, label)
    assert.deepEqual(errors, [], `${label} sin errores JS: ${errors.join(' | ')}`)
  } finally {
    await browser.close()
  }
}

;(async () => {
  if (process.env.DISPATCH_PICKER_ENGINE === 'webkit') {
    await runEngine(webkit, 'WebKit mobile', [{ width: 390, height: 844 }], true)
    console.log('PASS WebKit mobile selector táctil')
    return
  }
  await runEngine(chromium, 'Chromium desktop', [{ width: 1440, height: 900 }])
  await runEngine(chromium, 'Chromium touch', [
    { width: 320, height: 640 },
    { width: 360, height: 740 },
    { width: 375, height: 812 },
    { width: 390, height: 844 },
    { width: 414, height: 896 },
    { width: 640, height: 800 },
    { width: 768, height: 900 },
  ], true)
  await runEngine(webkit, 'WebKit mobile', [{ width: 390, height: 844 }], true)
  console.log('PASS Playwright dispatch picker: Chromium escritorio, móvil táctil y WebKit')
})().catch(error => {
  console.error(error)
  process.exitCode = 1
})
