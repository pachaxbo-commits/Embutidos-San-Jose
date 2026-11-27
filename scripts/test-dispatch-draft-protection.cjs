// End-to-end desktop dispatch draft test. Requires demo-pachax-audit emulators and Vite on :5180.
// Every inventory item and dispatch operation in this test is synthetic and stays in Emulator.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright')

const BASE_URL = 'http://127.0.0.1:5180'
const outputDir = path.resolve('output/qa/dispatch-draft-protection')
const storageKeyPrefix = 'sanjose_dispatch_draft_v1:'

async function openDispatches(page) {
  const nav = page.getByRole('button', { name: 'Despachos', exact: true }).filter({ visible: true })
  if (await nav.count()) await nav.first().click()
  else {
    await page.getByRole('button', { name: 'Mas', exact: true }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Despachos', exact: true }).click()
  }
  await page.getByRole('button', { name: 'Nuevo', exact: true }).waitFor()
}

async function login(page) {
  await page.goto(BASE_URL, { waitUntil: 'networkidle' })
  if (await page.locator('input[type=email]').isVisible().catch(() => false)) {
    await page.locator('input[type=email]').fill('admin@sanjose.bo')
    await page.locator('input[type=password]').fill('demo1234')
    await page.getByRole('button', { name: 'Iniciar Sesión', exact: true }).click()
  }
  await page.locator('.distribution-header').waitFor()
  await openDispatches(page)
  const projectId = await page.evaluate(async () => {
    const { getFirebaseContext } = await import('/src/lib/firebase.ts')
    const context = await getFirebaseContext()
    return context?.app.options.projectId
  })
  assert.equal(projectId, 'demo-pachax-audit', 'la prueba bloquea Firebase fuera del Emulator demo')
}

async function selectDistributor(page, dialog, name) {
  console.log('QA dispatch form:', (await dialog.innerText()).slice(0, 500))
  const trigger = dialog.getByText('Selecciona distribuidor', { exact: true })
  await trigger.click({ timeout: 8000 })
  const chooser = page.getByRole('dialog', { name: 'Selecciona distribuidor' })
  await chooser.getByRole('button', { name: new RegExp(name) }).click()
}

async function addProducts(page, start, count, quantity = '2') {
  const dialog = page.getByRole('dialog', { name: 'Nuevo despacho' })
  await dialog.getByRole('button', { name: 'Seleccionar productos' }).click()
  const picker = page.getByRole('dialog', { name: 'Productos del despacho' })
  const search = picker.getByRole('textbox', { name: 'Buscar productos del despacho' })
  for (let i = start; i < start + count; i++) {
    const suffix = String(i).padStart(2, '0')
    await search.fill(`QA extra ${suffix}`)
    await picker.getByRole('button', { name: `Seleccionar QA extra ${suffix}`, exact: true }).click()
  }
  await picker.getByRole('button', { name: new RegExp(`Listo · ${count} productos`) }).click()

  for (let i = start; i < start + count; i++) {
    const suffix = String(i).padStart(2, '0')
    const productId = `qa-dispatch-extra-${suffix}`
    const line = page.locator(`[data-dispatch-product-line="${productId}"]`)
    await line.getByRole('spinbutton', { name: `Cantidad normal de QA extra ${suffix}` }).fill(quantity)
    await line.getByRole('button', { name: '+ Agregar otro lote' }).click()
    const lotSelects = line.getByRole('combobox', { name: `Lote de QA extra ${suffix}` })
    await lotSelects.first().selectOption(`qa-lot-${productId}`)
    if (i === start && Number(quantity) > 1) {
      await line.getByRole('button', { name: '+ Agregar otro lote' }).click()
      const twoLots = line.getByRole('combobox', { name: `Lote de QA extra ${suffix}` })
      await twoLots.nth(1).selectOption(`qa-lot-b-${productId}`)
      await line.getByRole('spinbutton', { name: `Cantidad del lote para QA extra ${suffix}` }).nth(0).fill('1')
      await line.getByRole('spinbutton', { name: `Cantidad del lote para QA extra ${suffix}` }).nth(1).fill('1')
    } else {
      await line.getByRole('spinbutton', { name: `Cantidad del lote para QA extra ${suffix}` }).fill(quantity)
    }
  }
  return dialog
}

async function addVienaMermaAndLoss(page) {
  const dialog = page.getByRole('dialog', { name: 'Nuevo despacho' })
  await dialog.getByRole('button', { name: 'Editar productos' }).click()
  const picker = page.getByRole('dialog', { name: 'Productos del despacho' })
  await picker.getByRole('textbox', { name: 'Buscar productos del despacho' }).fill('Salchicha tipo Viena')
  await picker.getByRole('button', { name: 'Seleccionar Salchicha tipo Viena' }).click()
  await picker.getByRole('button', { name: /Listo · 13 productos/ }).click()
  const line = page.locator('[data-dispatch-product-line="gra-viena"]')
  await line.getByRole('spinbutton', { name: 'Cantidad normal de Salchicha tipo Viena' }).fill('5')
  await line.getByRole('spinbutton', { name: 'Merma adicional de Salchicha tipo Viena' }).fill('0.5')
  await line.locator('details').locator('summary').click()
  await line.getByRole('spinbutton', { name: 'Pérdida real de Salchicha tipo Viena' }).fill('0.25')
  await line.getByRole('textbox').last().fill('Daño físico sintético de QA')
  await line.locator('input[type=checkbox]').check()
  await line.getByRole('button', { name: '+ Agregar otro lote' }).click()
  await line.getByRole('button', { name: '+ Agregar otro lote' }).click()
  const lots = line.getByRole('combobox', { name: 'Lote de Salchicha tipo Viena' })
  await lots.nth(0).selectOption('qa-lot-viena-100kg')
  await lots.nth(1).selectOption('qa-lot-viena-3kg')
  const lotQty = line.getByRole('spinbutton', { name: 'Cantidad del lote para Salchicha tipo Viena' })
  await lotQty.nth(0).fill('3')
  await lotQty.nth(1).fill('2.5')
}

async function getDraftSnapshot(page) {
  return page.evaluate(prefix => {
    const key = Object.keys(localStorage).find(candidate => candidate.startsWith(prefix))
    if (!key) return null
    return { key, raw: localStorage.getItem(key), draft: JSON.parse(localStorage.getItem(key)) }
  }, storageKeyPrefix)
}

async function assertDraftComplete(page, count, firstSuffix = '00') {
  const dialog = page.getByRole('dialog', { name: 'Nuevo despacho' })
  const lines = page.locator('[data-dispatch-product-line]')
  assert.equal(await lines.count(), count, `${count} productos permanecen en el despacho`)
  const firstLine = page.locator(`[data-dispatch-product-line="qa-dispatch-extra-${firstSuffix}"]`)
  assert.equal(await firstLine.getByRole('spinbutton', { name: `Cantidad normal de QA extra ${firstSuffix}` }).inputValue(), '2', 'cantidad comercial conservada')
  assert.equal(await firstLine.getByRole('combobox', { name: `Lote de QA extra ${firstSuffix}` }).count(), 2, 'las dos asignaciones por lote se conservan')
  const lotQuantities = await firstLine.getByRole('spinbutton', { name: `Cantidad del lote para QA extra ${firstSuffix}` }).evaluateAll(nodes => nodes.map(node => node.value))
  assert.deepEqual(lotQuantities, ['1', '1'], 'la distribución entre lotes permanece intacta')
  assert(await dialog.getByRole('textbox').count() > 0, 'el formulario conserva sus campos editables')
}

function inspectDispatchEmulator(operationId) {
  const output = execFileSync(process.execPath, [path.resolve('firebase/tests/inspectDispatchDraftEmulator.mjs'), operationId], { encoding: 'utf8' })
  return JSON.parse(output)
}

async function run() {
  fs.mkdirSync(outputDir, { recursive: true })
  const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH } : {}) })
  const context = await browser.newContext({ viewport: { width: 1366, height: 768 } })
  const page = await context.newPage()
  const pageErrors = []
  page.on('pageerror', error => pageErrors.push(error.message))

  try {
    await login(page)
    if (process.env.DISPATCH_DRAFT_VISUAL_ONLY !== 'true') {
      await page.getByRole('button', { name: 'Inventario', exact: true }).click()
      const qaProduct = page.locator('div.flex.w-full.min-w-0.items-start.justify-between.gap-2').filter({ hasText: 'QA extra 00' })
      await qaProduct.getByRole('button', { name: 'Ingreso', exact: true }).click()
      let intake = page.getByRole('dialog', { name: 'Ingreso a almacen' })
      await intake.getByRole('spinbutton').fill('1')
      await intake.locator('header').getByRole('button', { name: 'Cerrar' }).click()
      let intakeExit = page.getByRole('dialog', { name: 'Salir del movimiento' })
      await intakeExit.getByRole('button', { name: 'Continuar editando' }).click()
      assert.equal(await intake.getByRole('spinbutton').inputValue(), '1', 'la protección reutilizable conserva la cantidad del formulario de ingreso')
      await intake.locator('header').getByRole('button', { name: 'Cerrar' }).click()
      intakeExit = page.getByRole('dialog', { name: 'Salir del movimiento' })
      await intakeExit.getByRole('button', { name: 'Descartar cambios' }).click()
      await openDispatches(page)
    }
    await page.evaluate(prefix => Object.keys(localStorage).filter(key => key.startsWith(prefix)).forEach(key => localStorage.removeItem(key)), storageKeyPrefix)

    await page.getByRole('button', { name: 'Nuevo', exact: true }).click()
    let dialog = page.getByRole('dialog', { name: 'Nuevo despacho' })
    await selectDistributor(page, dialog, 'Hugo Herbas')
    dialog = await addProducts(page, 0, 12)
    if (process.env.DISPATCH_DRAFT_VISUAL_ONLY === 'true') {
      const scrollArea = dialog.locator('.modal-scrollbar-dispatch')
      const edgeTrack = dialog.locator('[data-dispatch-scrollbar]')
      assert.equal((await edgeTrack.boundingBox()).width, 14, 'barra vertical de 14 px en Edge de escritorio')
      await page.screenshot({ path: path.join(outputDir, 'edge-barra-1366x768.png'), fullPage: false })
      const box = await scrollArea.boundingBox()
      await page.mouse.move(box.x + 200, box.y + 80)
      await page.mouse.wheel(0, 540)
      assert(await scrollArea.evaluate(node => node.scrollTop > 0), 'Edge desplaza el cuerpo del formulario')
      await page.getByRole('dialog', { name: 'Nuevo despacho' }).getByRole('button', { name: 'Cerrar' }).click()
      const exit = page.getByRole('dialog', { name: 'Salir del despacho' })
      await exit.getByRole('button', { name: 'Descartar despacho' }).click()
      console.log('PASS Edge desktop: scrollbar visible 14 px y rueda del mouse')
      return
    }
    await addVienaMermaAndLoss(page)
    await dialog.locator('textarea').last().fill('Borrador sintético de QA; no usar en Production.')
    await page.waitForFunction(prefix => Object.keys(localStorage).some(key => key.startsWith(prefix)), storageKeyPrefix)
    const draftBefore = await getDraftSnapshot(page)
    assert.equal(draftBefore.draft.draftLines.length, 13, 'autoguardado progresivo guarda 13 productos')
    assert.equal(draftBefore.draft.draftLines[0].allocations.length, 2, 'autoguardado guarda lotes múltiples')
    assert.equal(draftBefore.draft.draftLines[0].allocations[1].quantity, '1', 'autoguardado guarda cantidad por lote')
    const savedViena = draftBefore.draft.draftLines.find(line => line.productId === 'gra-viena')
    assert.equal(savedViena.dispatchMerma, '0.5', 'autoguardado conserva la merma adicional')
    assert.equal(savedViena.warehouseLoss, '0.25', 'autoguardado conserva la pérdida física real')

    const scroller = dialog.locator('.modal-scrollbar-dispatch')
    const initialBox = await scroller.boundingBox()
    assert(initialBox, 'scroller principal disponible')
    const scrollbarTrack = dialog.locator('[data-dispatch-scrollbar]')
    const scrollbarTrackBox = await scrollbarTrack.boundingBox()
    assert.equal(scrollbarTrackBox.width, 14, 'barra de escritorio de 14 px')
    assert(await dialog.getByRole('heading', { name: 'Nuevo despacho' }).isVisible(), 'encabezado accesible en escritorio')
    assert(await dialog.locator(':scope > div > footer').isVisible().catch(() => false) || await dialog.getByRole('button', { name: 'Continuar', exact: true }).isVisible(), 'acciones inferiores accesibles')
    await scroller.evaluate(node => { node.scrollTop = 0 })
    await page.waitForTimeout(80)
    await page.screenshot({ path: path.join(outputDir, 'antes-scroll-1366x768.png'), fullPage: false })

    await page.mouse.move(initialBox.x + 200, initialBox.y + 100)
    await page.mouse.wheel(0, 620)
    await page.waitForTimeout(100)
    assert(await scroller.evaluate(node => node.scrollTop > 0), 'rueda del mouse desplaza el contenido principal')
    const afterWheel = await scroller.evaluate(node => node.scrollTop)
    await page.screenshot({ path: path.join(outputDir, 'despues-barra-visible-1366x768.png'), fullPage: false })

    await scroller.evaluate(node => { node.scrollTop = 0 })
    await page.waitForTimeout(100)
    const thumbBox = await scrollbarTrack.locator('[data-scroll-thumb]').boundingBox()
    assert(thumbBox, 'pulgar visible para arrastrar')
    const thumbX = scrollbarTrackBox.x + scrollbarTrackBox.width / 2
    const thumbY = thumbBox.y + thumbBox.height / 2
    await page.mouse.move(thumbX, thumbY)
    await page.mouse.down()
    await page.mouse.move(thumbX, thumbY + 110, { steps: 8 })
    assert(await scroller.evaluate(node => node.scrollTop > 0), 'arrastrar el pulgar desplaza el formulario')
    await page.mouse.move(4, 4, { steps: 5 })
    await page.mouse.up()
    await page.waitForTimeout(100)
    assert(await page.getByRole('dialog', { name: 'Nuevo despacho' }).isVisible(), 'soltar el mouse fuera de la barra no cierra el formulario')
    assert.equal(await page.locator('[data-dispatch-product-line]').count(), 13, 'arrastrar conserva los 13 productos')

    await page.mouse.click(4, 4)
    assert(await page.getByRole('dialog', { name: 'Nuevo despacho' }).isVisible(), 'clic accidental en el fondo no cierra el formulario')
    assert.equal(await scroller.evaluate(node => getComputedStyle(node).overflowY), 'auto', 'el diálogo controla un único scroll principal')
    await page.keyboard.press('Escape')
    let exitDialog = page.getByRole('dialog', { name: 'Salir del despacho' })
    await exitDialog.waitFor()
    await exitDialog.getByRole('button', { name: 'Continuar editando' }).click()
    await assertDraftComplete(page, 13)
    await page.getByRole('dialog', { name: 'Nuevo despacho' }).getByRole('button', { name: 'Cerrar' }).click()
    exitDialog = page.getByRole('dialog', { name: 'Salir del despacho' })
    await exitDialog.waitFor()
    await exitDialog.getByRole('button', { name: 'Continuar editando' }).click()
    await assertDraftComplete(page, 13)

    await page.getByRole('dialog', { name: 'Nuevo despacho' }).getByRole('button', { name: 'Cerrar' }).click()
    exitDialog = page.getByRole('dialog', { name: 'Salir del despacho' })
    await exitDialog.getByRole('button', { name: 'Guardar borrador y salir' }).click()
    await page.getByRole('dialog', { name: 'Nuevo despacho' }).waitFor({ state: 'detached' })
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.locator('.distribution-header').waitFor()
    await openDispatches(page)
    await page.getByRole('button', { name: 'Nuevo', exact: true }).click()
    dialog = page.getByRole('dialog', { name: 'Nuevo despacho' })
    await dialog.getByRole('button', { name: 'Continuar despacho pendiente' }).click()
    await page.waitForTimeout(250)
    await assertDraftComplete(page, 13)
    assert.equal(await dialog.locator('textarea').last().inputValue(), 'Borrador sintético de QA; no usar en Production.', 'observación recuperada')

    execFileSync(process.execPath, [path.resolve('firebase/tests/setDispatchDraftStock.mjs'), 'qa-dispatch-extra-00', '0'], { stdio: 'pipe' })
    await page.waitForTimeout(500)
    assert((await dialog.getByRole('region', { name: 'Validación del despacho' }).innerText()).includes('error'), 'al recuperar se vuelve a validar stock y lotes contra el estado actual')
    execFileSync(process.execPath, [path.resolve('firebase/tests/setDispatchDraftStock.mjs'), 'qa-dispatch-extra-00', '100'], { stdio: 'pipe' })
    await page.waitForTimeout(700)

    await dialog.getByRole('button', { name: 'Cerrar' }).click()
    exitDialog = page.getByRole('dialog', { name: 'Salir del despacho' })
    await exitDialog.getByRole('button', { name: 'Descartar despacho' }).click()
    await page.getByRole('dialog', { name: 'Nuevo despacho' }).waitFor({ state: 'detached' })
    assert.equal(await getDraftSnapshot(page), null, 'descartar voluntariamente elimina el borrador local')

    await page.getByRole('button', { name: 'Nuevo', exact: true }).click()
    dialog = page.getByRole('dialog', { name: 'Nuevo despacho' })
    await selectDistributor(page, dialog, 'Ricardo Jimenez')
    dialog = await addProducts(page, 12, 10, '1')
    await dialog.locator('textarea').last().fill('Operación confirmada solo en el Emulator.')
    const confirmationDraft = await getDraftSnapshot(page)
    assert.equal(confirmationDraft.draft.draftLines.length, 10, 'borrador final de diez productos guardado')
    const countBefore = inspectDispatchEmulator(confirmationDraft.draft.operationId).dispatchCount
    await dialog.getByRole('button', { name: 'Continuar', exact: true }).click()
    const confirmation = page.getByRole('dialog', { name: 'Confirmar carga física' })
    await confirmation.getByRole('button', { name: 'Confirmar despacho', exact: true }).click()
    try {
      await confirmation.waitFor({ state: 'detached', timeout: 12000 })
    } catch (failure) {
      console.error('QA confirmation state:', await confirmation.innerText(), JSON.stringify(inspectDispatchEmulator(confirmationDraft.draft.operationId).operation))
      await page.screenshot({ path: path.join(outputDir, 'fallo-confirmacion-emulador.png'), fullPage: false })
      throw failure
    }
    const confirmedOperation = inspectDispatchEmulator(confirmationDraft.draft.operationId)
    assert.equal(confirmedOperation.operation?.status, 'confirmed', 'emulador registra estado confirmado en el servidor')
    const countAfter = confirmedOperation.dispatchCount
    assert.equal(countAfter, countBefore + 1, 'confirmation created exactly one dispatch in Emulator')
    await page.screenshot({ path: path.join(outputDir, 'despacho-confirmado-emulador.png'), fullPage: false })

    await page.evaluate(({ key, raw }) => localStorage.setItem(key, raw), { key: confirmationDraft.key, raw: confirmationDraft.raw })
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.locator('.distribution-header').waitFor()
    await openDispatches(page)
    await page.getByRole('button', { name: 'Nuevo', exact: true }).click()
    dialog = page.getByRole('dialog', { name: 'Nuevo despacho' })
    await dialog.getByRole('button', { name: 'Continuar despacho pendiente' }).click()
    await page.getByRole('dialog', { name: 'Nuevo despacho' }).getByText(/ya figura confirmado en el servidor/).waitFor()
    assert.equal(inspectDispatchEmulator(confirmationDraft.draft.operationId).dispatchCount, countAfter, 'reintento con respuesta anterior desconocida detecta confirmación y no duplica')
    assert.deepEqual(pageErrors, [], `sin errores JS: ${pageErrors.join(' | ')}`)
    console.log(`PASS dispatch draft protection: mouse scroll=${afterWheel}px, 12-product recovery, revalidation, explicit discard, confirmation + idempotent recovery; screenshots=${outputDir}`)
  } finally {
    await browser.close()
  }
}

run().catch(error => { console.error(error); process.exitCode = 1 })
