// End-to-end UI against a disposable Firebase Emulator tenant and synthetic fixture.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { spawn } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium, webkit } from '@playwright/test'

process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8085'
process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9095'
const req = createRequire(new URL('../../functions/package.json', import.meta.url))
const { initializeApp } = req('firebase-admin/app')
const { getAuth } = req('firebase-admin/auth')
const { getFirestore } = req('firebase-admin/firestore')
const { processCommand } = req('./operations.cjs')
const app = initializeApp({ projectId: 'demo-pachax-audit' }, 'processing-ui-e2e')
const auth = getAuth(app)
const db = getFirestore(app)
const root = db.doc('restaurants/sanjose')
const uid = 'processing-ui-qa'
const email = 'processing-ui-qa@example.test'
const password = 'QA-only-password-123!'
const date = new Date().toISOString()
const boliviaDayKey = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/La_Paz', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
const sourceManufacturedOn = '2026-10-20'
const safeExpiry = '2999-12-31'
const vite = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--mode', 'emulator', '--host', '127.0.0.1', '--port', '5174', '--strictPort'], {
  stdio: ['ignore', 'pipe', 'pipe'],
  env: {
    ...process.env,
    VITE_USE_FIREBASE_EMULATOR: 'true',
    VITE_FIREBASE_API_KEY: 'fake-api-key',
    VITE_FIREBASE_AUTH_DOMAIN: 'demo-pachax-audit.firebaseapp.com',
    VITE_FIREBASE_PROJECT_ID: 'demo-pachax-audit',
    VITE_FIREBASE_STORAGE_BUCKET: 'demo-pachax-audit.appspot.com',
    VITE_FIREBASE_MESSAGING_SENDER_ID: '123456789',
    VITE_FIREBASE_APP_ID: '1:123456789:web:processing-ui-qa',
  },
})
let browser
let viteOutput = ''
vite.stdout.on('data', chunk => { viteOutput += chunk.toString() })
vite.stderr.on('data', chunk => { viteOutput += chunk.toString() })

async function waitForVite() {
  for (let tries = 0; tries < 60; tries++) {
    if (vite.exitCode !== null) throw new Error('Vite QA server exited early: ' + viteOutput.slice(-4000))
    try { const response = await fetch('http://127.0.0.1:5174/scripts/processing-ui-harness.html'); if (response.ok) return } catch { /* wait for startup */ }
    await delay(500)
  }
  throw new Error('Vite QA server did not become ready.')
}

try {
  const qaAccounts = [
    { uid, email, role: 'admin', name: 'Administración QA' },
    { uid: 'processing-ui-warehouse', email: 'processing-ui-warehouse@example.test', role: 'warehouse', name: 'Almacén QA', warehouseId: 'qa-warehouse' },
    { uid: 'processing-ui-distributor', email: 'processing-ui-distributor@example.test', role: 'distributor', name: 'Distribuidor QA', routeId: 'qa-route' },
  ]
  for (const account of qaAccounts) {
    await auth.createUser({ uid: account.uid, email: account.email, password }).catch(async error => {
      if (error.code !== 'auth/uid-already-exists' && error.code !== 'auth/email-already-exists') throw error
      return auth.getUser(account.uid)
    })
    await root.collection('members').doc(account.uid).set({ uid: account.uid, role: account.role, active: true, displayName: account.name, ...(account.warehouseId ? { warehouseId: account.warehouseId } : {}), ...(account.routeId ? { routeId: account.routeId } : {}) })
  }
  await root.collection('distWarehouses').doc('qa-warehouse').set({ id: 'qa-warehouse', restaurantId: 'sanjose', name: 'Almacén QA', active: true })
  await root.collection('distProducts').doc('qa-source-product').set({ id: 'qa-source-product', restaurantId: 'sanjose', name: 'QA Producto a granel', unitType: 'kg', active: true, productionCost: 5 })
  await root.collection('distProducts').doc('qa-sachet-product').set({ id: 'qa-sachet-product', restaurantId: 'sanjose', name: 'QA Sachet 250 g', unitType: 'package', active: true, productionCost: 999 })
  await root.collection('distProducts').doc('qa-assessment-product').set({ id: 'qa-assessment-product', restaurantId: 'sanjose', name: 'QA Paquete para evaluación', unitType: 'package', active: true, productionCost: null })
  await root.collection('distLots').doc('qa-source-lot').set({ id: 'qa-source-lot', restaurantId: 'sanjose', productId: 'qa-source-product', productName: 'QA Producto a granel', unitType: 'kg', lotCode: 'QA-ORIGEN-2KG', manufacturedOn: sourceManufacturedOn, expiresOn: safeExpiry, productionCost: 5, quantities: { central: 2 }, processingUnavailable: { central: { courtesy: 0, repackPending: 2, reviewHold: 0 } }, processingReview: { caseId: 'qa-processing-case', revision: 0, status: 'pending_review', updatedAt: date, updatedBy: uid } })
  await root.collection('distLots').doc('qa-other-lot').set({ id: 'qa-other-lot', restaurantId: 'sanjose', productId: 'qa-source-product', productName: 'QA Producto a granel', unitType: 'kg', lotCode: 'QA-OTRO-1KG', manufacturedOn: sourceManufacturedOn, expiresOn: safeExpiry, productionCost: 5, quantities: { central: 1 }, processingUnavailable: { central: { courtesy: 0, repackPending: 0, reviewHold: 1 } }, processingReview: { caseId: 'qa-other-case', revision: 0, status: 'authorized_for_repack', updatedAt: date, updatedBy: uid } })
  await root.collection('distLots').doc('qa-free-lot').set({ id: 'qa-free-lot', restaurantId: 'sanjose', productId: 'qa-source-product', productName: 'QA Producto a granel', unitType: 'kg', lotCode: 'QA-LIBRE-1KG', manufacturedOn: sourceManufacturedOn, expiresOn: safeExpiry, productionCost: 5, quantities: { central: 1 }, processingUnavailable: { central: { courtesy: 0, repackPending: 0, reviewHold: 0 } } })
  await root.collection('distBalances').doc('central__qa-source-product').set({ id: 'central__qa-source-product', restaurantId: 'sanjose', locationKind: 'central', warehouseId: 'central', productId: 'qa-source-product', unitType: 'kg', quantity: 4 })
  await root.collection('distLots').doc('qa-warehouse-lot').set({ id: 'qa-warehouse-lot', restaurantId: 'sanjose', productId: 'qa-source-product', productName: 'QA Producto a granel', unitType: 'kg', lotCode: 'QA-ALMACEN-LOTE', manufacturedOn: sourceManufacturedOn, expiresOn: safeExpiry, productionCost: 5, quantities: { 'warehouse__qa-warehouse': 1 }, processingUnavailable: { 'warehouse__qa-warehouse': { courtesy: 0, repackPending: 1, reviewHold: 0 } } })
  await root.collection('distStockReservations').doc('qa-warehouse-reservation').set({ id: 'qa-warehouse-reservation', restaurantId: 'sanjose', branchId: 'main', schemaVersion: 1, productId: 'qa-source-product', productName: 'QA Producto a granel', lotId: 'qa-warehouse-lot', lotCode: 'QA-ALMACEN-PROPIO', unitType: 'kg', location: 'warehouse__qa-warehouse', purpose: 'repack_pending', originalQuantity: 1, remainingQuantity: 1, consumedQuantity: 0, physicalWeightG: 1000, remainingWeightG: 1000, remainingCostCents: 500, status: 'active', source: 'qa', createdAt: date, createdBy: uid, createdByName: 'QA', history: [] })
  await root.collection('distLots').doc('qa-other-warehouse-lot').set({ id: 'qa-other-warehouse-lot', restaurantId: 'sanjose', productId: 'qa-source-product', productName: 'QA Producto a granel', unitType: 'kg', lotCode: 'QA-OTRO-ALMACEN-LOTE', manufacturedOn: sourceManufacturedOn, expiresOn: safeExpiry, productionCost: 5, quantities: { 'warehouse__other-warehouse': 1 }, processingUnavailable: { 'warehouse__other-warehouse': { courtesy: 0, repackPending: 1, reviewHold: 0 } } })
  await root.collection('distStockReservations').doc('qa-other-warehouse-reservation').set({ id: 'qa-other-warehouse-reservation', restaurantId: 'sanjose', branchId: 'main', schemaVersion: 1, productId: 'qa-source-product', productName: 'QA Producto a granel', lotId: 'qa-other-warehouse-lot', lotCode: 'QA-OTRO-ALMACEN', unitType: 'kg', location: 'warehouse__other-warehouse', purpose: 'repack_pending', originalQuantity: 1, remainingQuantity: 1, consumedQuantity: 0, physicalWeightG: 1000, remainingWeightG: 1000, remainingCostCents: 500, status: 'active', source: 'qa', createdAt: date, createdBy: uid, createdByName: 'QA', history: [] })
  await root.collection('distStockReservations').doc('qa-source-reservation').set({ id: 'qa-source-reservation', restaurantId: 'sanjose', branchId: 'main', schemaVersion: 1, productId: 'qa-source-product', productName: 'QA Producto a granel', lotId: 'qa-source-lot', lotCode: 'QA-ORIGEN-2KG', unitType: 'kg', location: 'central', purpose: 'repack_pending', originalQuantity: 2, remainingQuantity: 2, consumedQuantity: 0, physicalWeightG: 2000, remainingWeightG: 2000, remainingCostCents: 1000, status: 'active', source: 'qa', createdAt: date, createdBy: uid, createdByName: 'Administración QA', history: [] })
  await root.collection('distLots').doc('qa-assessment-lot').set({ id: 'qa-assessment-lot', restaurantId: 'sanjose', productId: 'qa-assessment-product', productName: 'QA Paquete para evaluación', unitType: 'package', lotCode: 'QA-ASSESSMENT', manufacturedOn: sourceManufacturedOn, expiresOn: safeExpiry, productionCost: null, quantities: { central: 2 }, processingUnavailable: { central: { courtesy: 0, repackPending: 0, reviewHold: 2 } }, processingPhysicalWeightGRemaining: 500, processingCostCentsRemaining: 250, processingCommercialBlocked: true, processingDestinationKind: 'review_hold', quarantined: true, processingReview: { caseId: 'qa-assessment-case', latestReviewId: 'qa-assessment-existing-review', revision: 1, status: 'in_review', updatedAt: date, updatedBy: uid } })
  await root.collection('distBalances').doc('central__qa-assessment-product').set({ id: 'central__qa-assessment-product', restaurantId: 'sanjose', locationKind: 'central', warehouseId: 'central', productId: 'qa-assessment-product', unitType: 'package', quantity: 2 })
  await root.collection('distStockReservations').doc('qa-assessment-reservation').set({ id: 'qa-assessment-reservation', restaurantId: 'sanjose', branchId: 'main', schemaVersion: 1, productId: 'qa-assessment-product', productName: 'QA Paquete para evaluación', lotId: 'qa-assessment-lot', lotCode: 'QA-ASSESSMENT', unitType: 'package', location: 'central', purpose: 'review_hold', originalQuantity: 2, remainingQuantity: 2, consumedQuantity: 0, physicalWeightG: 500, remainingWeightG: 500, remainingCostCents: 250, status: 'active', source: 'qa', createdAt: date, createdBy: uid, createdByName: 'Administración QA', history: [] })
  await root.collection('distProcessingReviews').doc('qa-assessment-existing-review').set({ id: 'qa-assessment-existing-review', caseId: 'qa-assessment-case', restaurantId: 'sanjose', lotId: 'qa-assessment-lot', productId: 'qa-assessment-product', productName: 'QA Paquete para evaluación', lotCode: 'QA-ASSESSMENT', reservationId: 'qa-assessment-reservation', location: 'central', commercialQuantity: 2, commercialUnit: 'package', historicalAssignedWeightG: 500, physicalWeightG: null, weightDifferenceG: null, costCents: 250, packageCondition: 'package_damaged_partial', productObservation: 'uncertain', status: 'in_review', action: 'start_review', observations: 'Revisión previa de QA', reason: 'Caso sintético para validar evaluación', evidenceRefs: [], revision: 1, reviewedAt: date, reviewedBy: uid, reviewedByName: 'Administración QA' })
  await root.collection('distProcessingEvidence').doc('qa-disposition-evidence').set({ id: 'qa-disposition-evidence', restaurantId: 'sanjose', status: 'verified', evidenceType: 'measurement_record', lotId: 'qa-assessment-lot', reservationId: 'qa-assessment-reservation', reviewCaseId: 'qa-assessment-case', reviewRevision: 1, location: 'central', uploadedBy: uid, recordedAt: date, bucket: 'qa-fixture', objectPath: 'processing-evidence/sanjose/ui-fixture/qa-assessment.pdf', objectGeneration: '1', sha256: 'd'.repeat(64), byteSize: 512, contentType: 'application/pdf', viewers: [uid], verificationMethod: 'emulator_fixture', objectExists: true })
  await root.collection('distStockReservations').doc('qa-other-reservation').set({ id: 'qa-other-reservation', restaurantId: 'sanjose', branchId: 'main', schemaVersion: 1, productId: 'qa-source-product', productName: 'QA Producto a granel', lotId: 'qa-other-lot', lotCode: 'QA-OTRO-1KG', unitType: 'kg', location: 'central', purpose: 'review_hold', originalQuantity: 1, remainingQuantity: 1, consumedQuantity: 0, physicalWeightG: null, remainingWeightG: null, remainingCostCents: 500, status: 'active', source: 'qa', createdAt: date, createdBy: uid, createdByName: 'Administración QA', history: [] })
  await root.collection('distProcessingQualityAuthorizations').doc(uid).set({ id: 'qa-auth', authorizationId: 'qa-auth', restaurantId: 'sanjose', status: 'active', beneficiaryUid: uid, grantedBy: 'qa-system-fixture', grantedByName: 'Emulator fixture', expiresAt: '2999-12-31T23:59:59.000Z' })

  // Crea una venta derivada QR a través del handler real. La única autorización
  // se ejecuta en este proceso de Emulator; la prueba de navegador hará luego
  // el procedimiento visual de custodia y devolución bancaria.
  process.env.FUNCTIONS_EMULATOR = 'true'
  process.env.SANJOSE_DERIVED_SALES_EMULATOR_TEST = 'true'
  const voidProductId = 'qa-derived-qr-void-product'
  const voidLotId = 'qa-derived-qr-void-lot'
  const voidBatchId = 'qa-derived-qr-void-batch'
  const voidSaleOperationId = 'qa-derived-qr-void-sale'
  await root.collection('distProducts').doc(voidProductId).set({ id: voidProductId, restaurantId: 'sanjose', name: 'QA Sachet anulación QR', unitType: 'package', active: true, productionCost: 999, referencePrice: 45 })
  await root.collection('distLots').doc(voidLotId).set({
    id: voidLotId, restaurantId: 'sanjose', productId: voidProductId, productName: 'QA Sachet anulación QR', unitType: 'package',
    lotCode: 'QA-QR-VOID-LOT', manufacturedOn: '2026-10-20', expiresOn: safeExpiry, productionCost: 1.25,
    quantities: { central: 1 }, processingCommercialBlocked: true, processingBatchId: voidBatchId,
    processingDestinationId: 'qa-qr-void-destination', processingDestinationKind: 'finished',
    processingPhysicalWeightGRemaining: 250, processingCostCentsRemaining: 125,
    processingSourceAllocationBasis: 'batch_blend_accounting_allocation',
    processingByLocation: { central: { segments: [{ segmentId: `${voidBatchId}:${voidLotId}`, batchId: voidBatchId,
      destinationId: 'qa-qr-void-destination', sourceMovementId: 'qa-qr-void-output', weightBasis: 'documented_average',
      remainingQuantity: 1, remainingWeightG: 250, remainingCostCents: 125 }] } },
  })
  await root.collection('distBalances').doc(`central__${voidProductId}`).set({ id: `central__${voidProductId}`, restaurantId: 'sanjose', locationKind: 'central', warehouseId: 'central', productId: voidProductId, unitType: 'package', quantity: 1 })
  await root.collection('distProcessingBatches').doc(voidBatchId).set({ id: voidBatchId, restaurantId: 'sanjose', status: 'confirmed', result: { derivedLots: [{ lotId: voidLotId, productId: voidProductId, commercialQuantity: 1, netWeightG: 250, costCents: 125 }] } })
  await root.collection('distStockMovements').doc('qa-qr-void-output').set({ id: 'qa-qr-void-output', restaurantId: 'sanjose', productId: voidProductId, type: 'processing_output', fromLocation: '', toLocation: 'central', quantity: 1, physicalWeightG: 250, costCents: 125, batchId: voidBatchId, lotId: voidLotId })
  const voidOperationRef = root.collection('distOperations').doc(voidSaleOperationId)
  await voidOperationRef.set({ id: voidSaleOperationId, restaurantId: 'sanjose', createdBy: uid, createdAt: date, type: 'sale', status: 'queued', payload: {
    sourceLocation: 'centralWarehouse', routeId: 'administracion', routeName: 'Administración', dispatchId: '',
    lines: [{ productId: voidProductId, quantity: 1, actualUnitPrice: 45 }], cashAmount: 0, qrAmount: 45, creditAmount: 0, paymentKind: 'qr',
  } })
  await processCommand(db, voidOperationRef)
  assert.equal((await voidOperationRef.get()).data()?.status, 'confirmed', 'venta QR fixture de sachet creada por la operación real de Emulator')
  await root.collection('distQrVerifications').doc(`sale_${voidSaleOperationId}`).set({
    id: `sale_${voidSaleOperationId}`, restaurantId: 'sanjose', routeId: 'administracion', sourceType: 'sale',
    sourceId: voidSaleOperationId, sourceRevision: 0, amount: 45, reference: 'QA-QR-IN-2026-001', verifiedBy: uid, verifiedAt: date,
  })
  const qrSaleAfterSeed = (await root.collection('distSales').doc(voidSaleOperationId).get()).data()
  assert.equal(qrSaleAfterSeed.dayKey, boliviaDayKey, 'la venta fixture pertenece a la jornada actual de Bolivia')

  await waitForVite()
  if (process.env.SANJOSE_ANDROID_QA === 'true') {
    const { _android } = await import('@playwright/test')
    const devices = await _android.devices()
    assert.equal(devices.length, 1, 'Android QA requires exactly one isolated emulator')
    const device = devices[0]
    await device.shell('am start -n com.pachax.flow.qa/com.pachax.flow.MainActivity')
    await delay(1000)
    const webview = await device.webView({ pkg: 'com.pachax.flow.qa' })
    const nativePage = await webview.page()
    await nativePage.goto('http://localhost:5174/scripts/processing-ui-harness.html')
    await nativePage.getByRole('heading', { name: 'Sacheteado y Embolsado' }).waitFor({ timeout: 60000 })
    const nativeSize = await nativePage.evaluate(() => ({ width: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }))
    assert.ok(nativeSize.scroll <= nativeSize.width + 1)
    await nativePage.getByRole('button', { name: 'Tutorial', exact: true }).click()
    const nativeWalkthrough = nativePage.getByRole('dialog', { name: /Tutorial de sacheteado/ })
    await nativeWalkthrough.waitFor()
    assert.match(await nativeWalkthrough.innerText(), /Paso 1 de 20/i)
    await nativePage.getByRole('button', { name: 'Siguiente', exact: true }).click()
    await nativeWalkthrough.getByRole('heading', { name: 'Lote de origen', exact: true }).waitFor()
    await nativeWalkthrough.getByRole('button', { name: 'Anterior', exact: true }).click()
    assert.match(await nativeWalkthrough.innerText(), /Paso 1 de 20/i)
    const nativeTooltip = await nativeWalkthrough.evaluate(element => { const rect = element.getBoundingClientRect(); return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom } })
    const nativeViewport = await nativePage.evaluate(() => ({ width: document.documentElement.clientWidth, height: document.documentElement.clientHeight }))
    assert.ok(nativeTooltip.left >= 0 && nativeTooltip.top >= 0 && nativeTooltip.right <= nativeViewport.width + 1 && nativeTooltip.bottom <= nativeViewport.height + 1, 'tutorial dentro de viewport Android WebView')
    await nativePage.getByRole('button', { name: 'Cerrar tutorial' }).click()
    await nativePage.screenshot({ path: join(tmpdir(), 'sanjose-native-tutorial-qa.png'), fullPage: true })
    await device.close()
    console.log('PASS Android WebView QA: Sacheteado walkthrough opens, navigates, scrolls, highlights anchors and fits the viewport')
  }
  const browserType = process.env.SANJOSE_UI_ENGINE === 'webkit' ? webkit : chromium
  browser = await browserType.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  const pageErrors = []
  const channelSessions = new Set()
  const interruptedSessions = new Set()
  page.on('request', request => {
    if (/127\.0\.0\.1:8085\/google\.firestore\.v1\.Firestore\/(Listen|Write)\/channel/.test(request.url())) {
      const sid = new URL(request.url()).searchParams.get('SID')
      if (sid) channelSessions.add(sid)
    }
  })
  page.on('pageerror', error => {
    const sid = error.message.match(/[?&]SID=([^&\s]+)/)?.[1]
    // WebKit surfaces the deliberately interrupted XHR stream as a pageerror.
    // Limit the exception to session IDs captured at the exact injected outage.
    if (process.env.SANJOSE_UI_ENGINE === 'webkit' && sid && interruptedSessions.has(decodeURIComponent(sid))
      && /127\.0\.0\.1:8085\/google\.firestore\.v1\.Firestore\/(Listen|Write)\/channel/.test(error.message)
      && error.message.includes('due to access control checks.')) {
      console.log('EXPECTED WebKit transport abort from a deliberately interrupted session')
      return
    }
    pageErrors.push(error.message); console.error('QA browser error:', error.message)
  })
  const navigateQA = async url => {
    // Full document navigation terminates the previous document's XHR channels.
    // Errors from new sessions remain failures.
    for (const sid of channelSessions) interruptedSessions.add(sid)
    await page.goto(url)
  }
  await navigateQA('http://127.0.0.1:5174/scripts/processing-ui-harness.html')
  await page.getByRole('heading', { name: 'Sacheteado y Embolsado' }).waitFor()

  const assertNoHorizontalOverflow = async (width, height) => {
    await page.setViewportSize({ width, height })
    await page.waitForTimeout(200)
    const sizes = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, document: document.documentElement.scrollWidth }))
    assert.ok(sizes.document <= sizes.viewport + 1, `overflow horizontal a ${width}px: ${JSON.stringify(sizes)}`)
  }
  for (const [width, height] of [[320, 740], [360, 800], [375, 812], [390, 844], [414, 896], [768, 1024], [1440, 900]]) {
    for (const tab of ['Nueva elaboración', 'Mercadería reservada', 'Revisión de producto', 'Reenvasado', 'Historial']) {
      await page.getByRole('button', { name: tab, exact: true }).click()
      await assertNoHorizontalOverflow(width, height)
      if (tab === 'Nueva elaboración') await page.getByRole('button', { name: /1\. Origen/ }).waitFor({ timeout: 5000 })
      if (tab === 'Mercadería reservada') {
        try { await page.getByText(/Las cantidades reservadas están inmovilizadas/).waitFor({ timeout: 10000 }) }
        catch (error) { console.error('Contenido visible en reservas QA:', (await page.locator('body').innerText()).slice(0, 3000), 'URL:', page.url(), 'JS:', pageErrors); await page.screenshot({ path: join(tmpdir(), 'processing-reservations-failure.png'), fullPage: true }); throw error }
      }
      if (tab === 'Revisión de producto') await page.getByText('Revisión física').waitFor({ timeout: 5000 })
      if (tab === 'Reenvasado') await page.getByText('Reenvasado guiado').waitFor({ timeout: 5000 })
      if (tab === 'Historial') await page.getByText('Elaboraciones', { exact: true }).waitFor({ timeout: 5000 })
    }
    await page.screenshot({ path: join(tmpdir(), `sanjose-processing-${width}.png`), fullPage: true })
  }

  // Report fixture exceeds one server page; no business operations are seeded in production.
  const reportSeed = db.batch()
  for (let index = 0; index < 52; index++) {
    const id = `qa-report-${index}`
    const reportBatch = {
      id, operationId: id, restaurantId: 'sanjose', branchId: 'central', schemaVersion: 1,
      status: 'confirmed', processType: 'bagging', processingDate: boliviaDayKey,
      sourceProductId: 'qa-source-product', sourceProductName: `QA report ${index}`, sourceLocation: 'central',
      sourceAllocations: [], inputWeightG: 250, destinations: [{ id: 'finished', kind: 'finished', productId: 'qa-sachet-product', lotId: `${id}-lot`, lotCode: `${id}-lot`, commercialUnit: 'package', commercialQuantity: 1, netWeightG: 250, costCents: 125, sourceAllocations: [] }],
      packagingMaterials: [], costComponents: [], responsibleUid: uid, responsibleName: 'QA report owner', createdAt: date, dayKey: boliviaDayKey, sourceCostCents: 125, auditEventIds: [], reversal: { status: 'blocked', dependencyIds: [], reason: 'fixture' },
    }
    if (index === 51) {
      delete reportBatch.processingDate
      reportBatch.processType = 'repackaging'
      reportBatch.sourceUnitType = 'kg'
      reportBatch.sourceAllocations = [{ lotId: 'qa-free-lot', lotCode: 'QA-LIBRE-1KG', quantity: 0.25, productionCost: 5, expiresOn: safeExpiry }]
      reportBatch.result = { sourceLotId: 'qa-free-lot', openedQuantity: 0.25 }
      delete reportBatch.destinations[0].kind
    }
    reportSeed.set(root.collection('distProcessingBatches').doc(id), reportBatch)
  }
  await reportSeed.commit()
  await Promise.all([
    ['qa-expense-filter-admin', 'administration', 'administration-1', 'QA egreso administración', 11],
    ['qa-expense-filter-indirect', 'indirect', 'indirect-1', 'QA egreso indirecto', 17],
  ].map(([id, group, categoryId, concept, amount]) => root.collection('distExpenses').doc(id).set({
    id, restaurantId: 'sanjose', branchId: 'main', createdAt: date, createdBy: uid, dayKey: boliviaDayKey, schemaVersion: 1,
    operationId: id, group, groupName: group === 'administration' ? 'Gastos de administración' : 'Gastos indirectos', categoryId,
    categoryName: categoryId, economicType: 'operating_expense', affectsOperatingResult: true, classificationStatus: 'reviewed',
    classificationSource: 'admin_review', transactionKind: 'expense', concept, amount, paymentMethod: 'cash', cashPaidAmount: amount,
    routeId: 'administracion', routeName: 'Administración', registeredByUid: uid, registeredByName: 'Administración QA',
  })))
  await page.getByRole('button', { name: 'Historial', exact: true }).click()
  await page.getByRole('button', { name: 'Reportes', exact: true }).click()
  await page.getByText(/52 filtrados \/ 52 registros cargados/).waitFor({ timeout: 30000 })
  assert.equal(await page.locator('#processing-report-print-root tbody tr').count(), 52)
  assert.doesNotMatch(await page.locator('#processing-report-print-root').innerText(), /NaN/, 'historical repack weights are normalized without invented values')
  const excelDownload = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Excel', exact: true }).click()
  const excelFile = await (await excelDownload).path()
  const { default: ExcelJS } = await import('exceljs')
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.readFile(excelFile)
  let exportedRows = 0
  workbook.worksheets[0].eachRow(row => { if (JSON.stringify(row.values).includes('QA report ')) exportedRows++ })
  assert.equal(exportedRows, 52, 'Excel contains both complete Firestore pages')
  const pdfDownload = page.waitForEvent('download')
  await page.getByRole('button', { name: 'PDF', exact: true }).click()
  const pdfFile = await (await pdfDownload).path()
  const { readFile } = await import('node:fs/promises')
  const pdfBytes = await readFile(pdfFile)
  assert.equal(pdfBytes.subarray(0, 4).toString(), '%PDF')
  assert.ok(pdfBytes.length > 1000)
  await page.evaluate(() => { window.__qaPrinted = false; window.print = () => { window.__qaPrinted = true } })
  await page.getByRole('button', { name: 'Imprimir', exact: true }).click()
  assert.equal(await page.evaluate(() => window.__qaPrinted), true)
  await page.getByRole('button', { name: 'Elaboraciones', exact: true }).first().click()
  console.log('PASS complete 52-record Firestore report including historical repack: screen, real Excel/PDF downloads and print action')

  await page.setViewportSize({ width: 360, height: 800 })
  await page.getByRole('button', { name: 'Nueva elaboración', exact: true }).click()
  const walkthroughDraftKey = `sanjose_processing_draft_v1:${uid}`
  const walkthroughDraftBefore = await page.evaluate(key => localStorage.getItem(key), walkthroughDraftKey)
  const operationsBeforeWalkthrough = (await root.collection('distOperations').get()).size
  await page.getByRole('button', { name: 'Tutorial', exact: true }).click()
  const walkthrough = page.getByRole('dialog', { name: /Tutorial de sacheteado/ })
  await walkthrough.waitFor()
  assert.match(await walkthrough.innerText(), /Paso 1 de 20/i)
  await page.getByRole('button', { name: 'Siguiente', exact: true }).click()
  await walkthrough.getByRole('button', { name: 'Anterior', exact: true }).click()
  assert.match(await walkthrough.innerText(), /Paso 1 de 20/i, 'Anterior vuelve al paso previo')
  for (const [width, height] of [[320, 740], [360, 800], [390, 844], [414, 896], [768, 1024], [1440, 900]]) {
    await page.setViewportSize({ width, height })
    await page.waitForTimeout(500)
    const bounds = await walkthrough.boundingBox()
    assert.ok(bounds && bounds.x >= 0 && bounds.y >= 0 && bounds.x + bounds.width <= width + 1 && bounds.y + bounds.height <= height + 1, `tooltip dentro de viewport ${width}x${height}: ${JSON.stringify(bounds)}`)
    assert.equal(await page.locator('[data-processing-arrow="true"]').count(), 1, `flecha de anclaje visible en ${width}px`)
  }
  await page.setViewportSize({ width: 390, height: 844 })
  const walkthroughTitles = ['Producto a granel', 'Lote de origen', 'Kg reales utilizados', 'Fecha del proceso', 'Destino físico', 'SKU terminado existente', 'Cantidad comercial', 'Peso neto real medido (g)', 'Peso nominal informativo', 'Código de lote', 'Fecha de elaboración', 'Fecha de embolsado', 'Fecha de vencimiento', 'Base del peso real', 'Descarte físico real', 'Materiales', 'Notas', 'Guardar borrador', 'Resumen final', 'Confirmar elaboración']
  for (let index = 0; index < walkthroughTitles.length; index++) {
    console.log(`QA walkthrough step ${index + 1}: ${walkthroughTitles[index]}`)
    assert.match(await walkthrough.innerText(), new RegExp(`Paso ${index + 1} de 20`, 'i'))
    assert.ok((await walkthrough.getByRole('heading', { name: walkthroughTitles[index], exact: true }).count()) === 1, `contenido del paso ${index + 1}: ${walkthroughTitles[index]}`)
    const targetName = ['source-product','source-product','source-product','processing-date','destination-kind','finished-product','commercial-quantity','net-weight','nominal-weight','lot-code','manufactured-date','packaged-date','expiry-date','net-weight','destination-kind','materials','notes','save-draft','summary-metrics','confirm'][index]
    const target = page.locator(`[data-processing-anchor="${targetName}"]`).first()
    assert.ok(await target.count(), `anchor ${targetName} del paso ${index + 1} está presente; contenido: ${(await page.locator('#root').innerText()).slice(-900)}`)
    const box = await target.boundingBox()
    assert.ok(box, `anchor del paso ${index + 1} existe`)
    const arrow = page.locator('[data-processing-arrow="true"]')
    await arrow.waitFor({ state: 'attached', timeout: 4000 }).catch(() => { throw new Error(`no se posicionó flecha para paso ${index + 1} anchor ${targetName}`) })
    const arrowEnd = await arrow.getAttribute('d')
    const end = arrowEnd.match(/L ([\d.]+) ([\d.]+)$/)
    assert.ok(end && Math.abs(Number(end[1]) - (box.x + box.width / 2)) < 2 && Math.abs(Number(end[2]) - (box.y + box.height / 2)) < 2, `la flecha apunta al centro del anchor del paso ${index + 1}`)
    if (index < walkthroughTitles.length - 1) {
      await page.getByRole('button', { name: 'Siguiente', exact: true }).click()
      await page.waitForTimeout(800)
    }
  }
  await page.getByRole('button', { name: 'Cerrar tutorial' }).click()
  assert.equal(await walkthrough.count(), 0, 'Cerrar elimina el walkthrough')
  await page.getByRole('button', { name: 'Tutorial', exact: true }).click()
  assert.match(await page.getByRole('dialog', { name: /Tutorial de sacheteado/ }).innerText(), /Paso 1 de 20/i, 'el tutorial se puede reabrir desde el inicio')
  await page.getByRole('button', { name: 'Cerrar tutorial' }).click()
  assert.equal(await page.evaluate(key => localStorage.getItem(key), walkthroughDraftKey), walkthroughDraftBefore, 'el tutorial no cambia ningún valor del borrador local')
  assert.equal((await root.collection('distOperations').get()).size, operationsBeforeWalkthrough, 'el tutorial no crea operaciones ni confirma movimientos')
  console.log('PASS: walkthrough interactivo de 20 pasos; navegación, anchors, flecha, scroll y tooltips dentro de 320/360/390/414/768/1440 px; no cambia borrador ni crea operaciones')
  if (process.env.SANJOSE_WALKTHROUGH_ONLY !== 'true') {
  await page.getByLabel('Producto a granel · unidad kg').selectOption('qa-source-product')
  await page.getByRole('checkbox', { name: 'Seleccionar lote QA-LIBRE-1KG' }).check()
  const mobileKgInput = page.getByLabel('Kg reales utilizados')
  assert.equal(await mobileKgInput.getAttribute('inputmode'), 'decimal', 'el campo de kilogramos solicita teclado decimal en Android')
  await mobileKgInput.fill('0.5')
  await assertNoHorizontalOverflow(360, 800)
  await page.screenshot({ path: join(tmpdir(), 'sanjose-processing-360-form.png'), fullPage: true })

  await page.setViewportSize({ width: 1440, height: 900 })
  await page.getByRole('button', { name: 'Revisión de producto', exact: true }).click()
  await page.getByLabel('Reserva para revisar').selectOption('qa-source-reservation')
  await page.getByPlaceholder('Describe lo observado; separa peso asignado y medido.').fill('Borrador conservado del lote de 2 kg')
  await page.getByPlaceholder('Motivo de la revisión o solicitud').fill('Revisión de origen A')
  await page.getByLabel('Reserva para revisar').selectOption('qa-other-reservation')
  assert.equal(await page.getByPlaceholder('Describe lo observado; separa peso asignado y medido.').inputValue(), '', 'cambiar de lote no mezcla observaciones')
  await page.getByLabel('Reserva para revisar').selectOption('qa-source-reservation')
  assert.equal(await page.getByPlaceholder('Describe lo observado; separa peso asignado y medido.').inputValue(), 'Borrador conservado del lote de 2 kg', 'al volver se recupera el borrador propio')
  await page.getByLabel('Acción').selectOption('start_review')
  const reviewDraftKey = 'sanjose_processing_review_draft_v1:' + uid + ':qa-source-reservation'
  const originalReviewDraft = await page.evaluate(key => JSON.parse(localStorage.getItem(key) || 'null'), reviewDraftKey)
  assert.ok(originalReviewDraft?.operationId)
  const lostOperationId = originalReviewDraft.operationId
  let operationWriteWasCommitted = false
  let connectionDroppedAfterCommit = false
  let faultInjectionArmed = false
  await page.route('**/google.firestore.v1.Firestore/**', async route => {
    const request = route.request()
    const url = request.url()
    const decodedBody = decodeURIComponent(request.postData() || '')
    const isLostOperationWrite = request.method() === 'POST' && url.includes('/Write/channel') && decodedBody.includes(lostOperationId) && decodedBody.includes('distOperations')
    if (faultInjectionArmed && isLostOperationWrite) {
      if (operationWriteWasCommitted) {
        // Block the SDK retry so it cannot overwrite the already-confirmed
        // operation while the explicit getDocFromServer recovery is tested.
        await route.abort('failed')
        return
      }
      const response = await route.fetch()
      assert.equal(response.status(), 200, 'el Emulator persiste la operación antes de perderse la respuesta')
      operationWriteWasCommitted = true
      for (const sid of channelSessions) interruptedSessions.add(sid)
      await page.context().setOffline(true)
      connectionDroppedAfterCommit = true
      await route.abort('failed')
      return
    }
    await route.continue()
  })
  faultInjectionArmed = true
  await page.getByRole('button', { name: 'Registrar revisión' }).click()
  await page.getByText('Resultado pendiente de comprobación.').waitFor({ timeout: 90000 })
  assert.equal(operationWriteWasCommitted, true, 'se confirmó la escritura en Emulator')
  assert.equal(connectionDroppedAfterCommit, true, 'la conexión se interrumpió tras persistir la operación')
  const draftDuringUnknown = await page.evaluate(key => JSON.parse(localStorage.getItem(key) || 'null'), reviewDraftKey)
  assert.equal(draftDuringUnknown.operationId, lostOperationId, 'el ID se conserva mientras el resultado es desconocido')
  assert.equal(draftDuringUnknown.observations, 'Borrador conservado del lote de 2 kg', 'se conservan las observaciones')
  assert.equal(await page.getByPlaceholder('Describe lo observado; separa peso asignado y medido.').isDisabled(), true)
  await page.context().setOffline(false)
  await page.unroute('**/google.firestore.v1.Firestore/**')
  let confirmedAfterReconnect = false
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const snapshot = await root.collection('distOperations').doc(lostOperationId).get()
    if (snapshot.data()?.status === 'confirmed') {
      await new Promise(resolve => setTimeout(resolve, 750))
      if ((await root.collection('distOperations').doc(lostOperationId).get()).data()?.status === 'confirmed') { confirmedAfterReconnect = true; break }
    }
    await new Promise(resolve => setTimeout(resolve, 1000))
  }
  assert.equal(confirmedAfterReconnect, true, 'el servidor terminó la única operación persistida después del reintento de red')
  const checkStatusButton = page.getByRole('button', { name: 'Comprobar estado de la revisión' })
  if (await checkStatusButton.isVisible().catch(() => false)) await checkStatusButton.click()
  try { await page.getByText('Revisión registrada. La reserva, el inventario, los costos y el Kardex no se modificaron.').waitFor({ timeout: 30000 }) }
  catch (error) { console.error('No se recuperó confirmación:', { operation: (await root.collection('distOperations').doc(lostOperationId).get()).data(), text: await page.locator('body').innerText(), draft: await page.evaluate(key => localStorage.getItem(key), reviewDraftKey), pageErrors }); throw error }
  const lostOperation = (await root.collection('distOperations').doc(lostOperationId).get()).data()
  assert.equal(lostOperation.status, 'confirmed')
  assert.equal(lostOperation.type, 'recordProcessingReview')
  assert.equal(lostOperation.payload.observations, 'Borrador conservado del lote de 2 kg')
  const lostReviewId = lostOperation.result.reviewId
  assert.ok(lostReviewId)
  assert.equal((await root.collection('distProcessingReviews').doc(lostReviewId).get()).exists, true)

  // Un rechazo definitivo corregido crea otro ID; el primer intento permanece rechazado.
  await page.getByLabel('Reserva para revisar').selectOption('qa-other-reservation')
  await page.getByPlaceholder('Describe lo observado; separa peso asignado y medido.').fill('Observación corregida luego del rechazo')
  await page.getByPlaceholder('Motivo de la revisión o solicitud').fill('Motivo corregido')
  await page.getByLabel('Acción').selectOption('start_review')
  const rejectedDraftKey = 'sanjose_processing_review_draft_v1:' + uid + ':qa-other-reservation'
  const rejectedOperationId = await page.evaluate(key => JSON.parse(localStorage.getItem(key) || 'null')?.operationId, rejectedDraftKey)
  await page.getByRole('button', { name: 'Registrar revisión' }).click()
  await page.getByText('La operación fue rechazada. Corrige un dato para iniciar un intento nuevo; las observaciones permanecen guardadas.').waitFor({ timeout: 30000 })
  assert.equal((await root.collection('distOperations').doc(rejectedOperationId).get()).data().status, 'rejected')
  await page.getByPlaceholder('Motivo de la revisión o solicitud').fill('Motivo corregido para reintento')
  await page.getByLabel('Acción').selectOption('record_observation')
  const retryOperationId = await page.evaluate(key => JSON.parse(localStorage.getItem(key) || 'null')?.operationId, rejectedDraftKey)
  assert.notEqual(retryOperationId, rejectedOperationId, 'un rechazo definitivo corregido utiliza un ID nuevo')
  await page.getByRole('button', { name: 'Registrar revisión' }).click()
  await page.getByText('Revisión registrada. La reserva, el inventario, los costos y el Kardex no se modificaron.').waitFor({ timeout: 30000 })
  assert.equal((await root.collection('distOperations').doc(retryOperationId).get()).data().status, 'confirmed')

  const lotAfterStart = (await root.collection('distLots').doc('qa-source-lot').get()).data()
  const revision = lotAfterStart.processingReview.revision
  const caseId = lotAfterStart.processingReview.caseId
  const evidenceId = 'qa-ui-verified-evidence'
  await root.collection('distProcessingEvidence').doc(evidenceId).set({ id: evidenceId, restaurantId: 'sanjose', status: 'verified', evidenceType: 'measurement_record', lotId: 'qa-source-lot', reservationId: 'qa-source-reservation', reviewCaseId: caseId, reviewRevision: revision, location: 'central', uploadedBy: uid, recordedAt: new Date().toISOString(), bucket: 'qa-fixture', objectPath: 'processing-evidence/sanjose/ui-fixture/qa-source-lot.pdf', objectGeneration: '1', sha256: 'c'.repeat(64), byteSize: 512, contentType: 'application/pdf', viewers: [uid], verificationMethod: 'emulator_fixture', objectExists: true })
  await page.evaluate(lot => window.__qaUpdateSourceLot?.(lot), lotAfterStart)

  await page.getByLabel('Reserva para revisar').selectOption('qa-other-reservation')
  await page.getByLabel('Reserva para revisar').selectOption('qa-source-reservation')
  await page.waitForTimeout(200)
  await page.getByLabel('Reserva para revisar').selectOption('qa-source-reservation')
  await page.getByLabel('Acción').selectOption('authorize_repack')
  await page.getByLabel('Condición del envase').selectOption('no_package')
  await page.getByLabel('Estado observado del alimento').selectOption('apparently_apt')
  await page.getByLabel('Peso físico medido (g)').fill('2000')
  await page.getByPlaceholder('Describe lo observado; separa peso asignado y medido.').fill('Producto apto; peso medido 2000 g en UI QA')
  await page.getByPlaceholder('Motivo de la revisión o solicitud').fill('Autorización sintética de reenvasado QA')
  await page.getByRole('checkbox').check()
  await page.getByRole('button', { name: 'Registrar revisión' }).click()
  await page.getByText('Revisión registrada. La reserva, el inventario, los costos y el Kardex no se modificaron.').waitFor({ timeout: 30000 })
  const lotAfterAuthorization = (await root.collection('distLots').doc('qa-source-lot').get()).data()
  assert.equal(lotAfterAuthorization.processingReview.status, 'authorized_for_repack')
  await page.evaluate(lot => window.__qaUpdateSourceLot?.(lot), lotAfterAuthorization)

  await page.getByRole('button', { name: 'Reenvasado', exact: true }).click()
  await page.getByLabel('Origen autorizado').selectOption('qa-source-reservation')
  await page.getByRole('button', { name: 'Siguiente' }).click()
  await page.getByLabel('Peso neto medido al abrir (g)').fill('2000')
  await page.getByRole('button', { name: 'Siguiente' }).click()
  const output = page.locator('article').filter({ has: page.getByLabel('SKU de salida') }).first()
  await page.getByLabel('SKU de salida').selectOption('qa-sachet-product')
  await page.getByLabel('Cantidad comercial (package)').fill('8')
  await page.getByLabel('Peso neto real (g)').fill('2000')
  await page.getByLabel('Código de lote').fill('QA-SACHET-8-UI')
  await page.getByLabel('Fecha de reenvasado').fill('2026-10-29')
  await page.getByLabel('Vencimiento').fill(safeExpiry)
  await page.getByRole('button', { name: 'Siguiente' }).click()
  await page.getByLabel('Motivo del reenvasado').fill('Flujo completo visual sintético: 2 kg en 8 sachets')
  await page.getByRole('button', { name: 'Siguiente' }).click()
  await page.getByLabel('Motivo y observación de confirmación').fill('Confirmación E2E exclusiva del Emulator')
  await page.getByRole('button', { name: 'Confirmar reenvasado en QA' }).click()
  await page.getByText('Reenvasado confirmado por el servidor de QA. Las nuevas presentaciones siguen bloqueadas para venta.').waitFor({ timeout: 30000 })

  const reservation = (await root.collection('distStockReservations').doc('qa-source-reservation').get()).data()
  const sourceBalance = (await root.collection('distBalances').doc('central__qa-source-product').get()).data()
  const targetBalance = (await root.collection('distBalances').doc('central__qa-sachet-product').get()).data()
  assert.equal(reservation.remainingQuantity, 0)
  assert.equal(sourceBalance.quantity, 2)
  assert.equal(targetBalance.quantity, 8)
  assert.equal(pageErrors.length, 0, `errores JS: ${pageErrors.join('; ')}`)

  await page.getByRole('button', { name: 'Historial', exact: true }).click()
  await page.getByRole('button', { name: 'Reenvasados', exact: true }).click()
  await page.getByText(/Reenvasado de QA Producto a granel/).waitFor({ timeout: 30000 })
  await page.getByText(/QA-SACHET-8-UI/).waitFor()

  // La evaluación documenta una propuesta de destino, sin alterar inventario ni costo.
  const assessmentEvidenceId = 'qa-disposition-evidence'
  const assessmentLotForUi = (await root.collection('distLots').doc('qa-assessment-lot').get()).data()
  await page.evaluate(lot => window.__qaUpdateAssessmentLot?.(lot), assessmentLotForUi)
  await page.getByRole('button', { name: 'Revisión de producto', exact: true }).click()
  await page.getByLabel('Reserva para revisar').selectOption('qa-assessment-reservation')
  await page.getByText('Lote QA-ASSESSMENT · Almacén central').waitFor({ timeout: 10000 })
  await page.getByLabel('Acción').selectOption('record_disposition_assessment')
  await page.getByLabel('Evaluación de Calidad').selectOption('partially_recoverable')
  await page.getByLabel('Peso físico medido (g)').fill('470')
  await page.getByLabel('Gramos recuperables propuestos').fill('300')
  await page.getByLabel('Gramos de descarte pendientes').fill('170')
  await page.getByPlaceholder('Describe lo observado; separa peso asignado y medido.').fill('Medición de cuarentena ingresada en la interfaz de QA')
  await page.getByPlaceholder('Motivo de la revisión o solicitud').fill('Registrar propuesta sin modificar inventario')
  await page.locator('label').filter({ hasText: assessmentEvidenceId }).locator('input[type="checkbox"]').check()
  await page.getByRole('button', { name: 'Registrar revisión' }).click()
  try { await page.getByText(/parcialmente recuperable propuesto/).waitFor({ timeout: 30000 }) }
  catch (error) {
    console.error('QA assessment lot state:', JSON.stringify((await root.collection('distLots').doc('qa-assessment-lot').get()).data()?.processingReview))
    console.error('QA assessment UI:', (await page.locator('body').innerText()).slice(-2200))
    throw error
  }
  const assessmentLotAfter = (await root.collection('distLots').doc('qa-assessment-lot').get()).data()
  assert.equal(assessmentLotAfter.processingReview.status, 'pending_economic_disposition')
  assert.equal(assessmentLotAfter.quantities.central, 2)
  assert.equal((await root.collection('distStockReservations').doc('qa-assessment-reservation').get()).data().remainingQuantity, 2)
  assert.equal((await root.collection('distBalances').doc('central__qa-assessment-product').get()).data().quantity, 2)
  assert.equal((await root.collection('distStockMovements').where('productId', '==', 'qa-assessment-product').get()).size, 0)

  // Navegación habitual de DistributionApp con cuentas ficticias autenticadas en Emulator.
  await navigateQA('http://127.0.0.1:5174/scripts/processing-ui-harness.html?app=1&role=admin')
  await page.getByRole('button', { name: 'Sacheteado y Embolsado' }).waitFor({ timeout: 30000 })
  await page.getByRole('button', { name: 'Sacheteado y Embolsado' }).click()
  await page.getByRole('heading', { name: 'Sacheteado y Embolsado' }).waitFor()
  await page.getByText('QA-LIBRE-1KG').click()
  const fullAppQuantity = page.getByLabel('Kg reales utilizados')
  try { await fullAppQuantity.fill('0.5') }
  catch (error) { console.error('Formulario de elaboración no visible en navegación app completa:', { text: await page.locator('body').innerText(), pageErrors }); throw error }
  await page.getByRole('button', { name: 'Inventario', exact: true }).click()
  await page.getByText('Inventario').first().waitFor()
  await page.getByRole('button', { name: 'Sacheteado y Embolsado' }).click()
  await page.getByText('QA-LIBRE-1KG').waitFor()
  assert.equal(await page.getByLabel('Kg reales utilizados').inputValue(), '0.5', 'navegar a otro módulo y volver conserva el borrador')
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.getByRole('button', { name: 'Egresos', exact: true }).click()
  await page.getByRole('heading', { name: 'Egresos', exact: true }).waitFor()
  const expenseSelects = page.locator('select')
  assert.ok(await expenseSelects.count() >= 6, `controles de filtro presentes en Egresos: ${(await page.locator('body').innerText()).slice(-1600)}`)
  const expenseOrigin = expenseSelects.nth(0)
  const expenseGroup = expenseSelects.nth(1)
  const expenseCategory = expenseSelects.nth(2)
  const expenseStatus = expenseSelects.nth(3)
  const expensePayment = expenseSelects.nth(4)
  const expenseSearch = page.getByPlaceholder('Concepto u observación')
  const categoryOptionValues = () => expenseCategory.locator('option').evaluateAll(options => options.map(option => option.value))
  for (const [width, height] of [[375, 812], [1440, 900]]) {
    await page.setViewportSize({ width, height })
    const weekPreset = page.getByRole('button', { name: 'Semana', exact: true })
    await weekPreset.click()
    const weekPresetClass = await weekPreset.getAttribute('class')
    await expenseGroup.selectOption('administration')
    assert.ok((await categoryOptionValues()).every(value => value === 'all' || value.startsWith('administration-')), `a ${width}px el selector limita categorías al grupo de Administración`)
    await expenseOrigin.selectOption('administracion')
    await expensePayment.selectOption('cash')
    await expenseStatus.selectOption('all')
    await expenseCategory.selectOption('all')
    await expenseSearch.fill('QA egreso administración')
    await page.getByText('QA egreso administración').waitFor()
    assert.equal(await page.getByText('QA egreso indirecto').count(), 0, `a ${width}px el resultado coincide con el grupo seleccionado`)
    await expenseCategory.selectOption('administration-1')
    await expenseGroup.selectOption('indirect')
    assert.equal(await expenseCategory.inputValue(), 'all', `a ${width}px una categoría de otro grupo vuelve a Todas las categorías`)
    assert.ok((await categoryOptionValues()).every(value => value === 'all' || value.startsWith('indirect-')), `a ${width}px cambiar de grupo actualiza las opciones inmediatamente`)
    assert.equal(await expenseOrigin.inputValue(), 'administracion', 'cambiar grupo conserva origen')
    assert.equal(await expensePayment.inputValue(), 'cash', 'cambiar grupo conserva forma de pago')
    assert.equal(await expenseStatus.inputValue(), 'all', 'cambiar grupo conserva estado')
    assert.equal(await expenseSearch.inputValue(), 'QA egreso administración', 'cambiar grupo conserva búsqueda')
    assert.equal(await weekPreset.getAttribute('class'), weekPresetClass, 'cambiar grupo conserva el período por fecha')
    await expenseSearch.fill('')
    await expenseCategory.selectOption('all')
    await page.getByText('QA egreso indirecto').waitFor()
    assert.equal(await page.getByText('QA egreso administración').count(), 0, `a ${width}px el resultado coincide con el segundo grupo`)
    await expenseGroup.selectOption('all')
    assert.ok((await categoryOptionValues()).includes('administration-1') && (await categoryOptionValues()).includes('indirect-1'), 'Todos los grupos muestra ambas categorías')
    await expenseCategory.selectOption('all')
    await page.getByText('QA egreso administración').waitFor()
    await page.getByText('QA egreso indirecto').waitFor()
    const viewport = await page.evaluate(() => ({ client: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }))
    assert.ok(viewport.scroll <= viewport.client + 1, `el panel Egresos no desborda a ${width}px: ${JSON.stringify(viewport)}`)
  }
  await page.getByRole('button', { name: 'Cuentas por pagar', exact: true }).click()
  await page.getByRole('heading', { name: 'Cuentas por pagar', exact: true }).waitFor()
  await page.getByRole('button', { name: 'Proveedores', exact: true }).click()
  await page.getByRole('heading', { name: 'Proveedores', exact: true }).waitFor()
  await page.getByRole('button', { name: 'Nuevo proveedor', exact: true }).click()
  await page.getByLabel(/Nombre comercial/).fill('QA proveedor UI')
  await page.getByLabel('Razón social', { exact: true }).fill('QA proveedor UI SRL')
  await page.getByLabel('NIT', { exact: true }).fill('0012345')
  await page.getByLabel('Dirección', { exact: true }).fill('Dirección de prueba Emulator')
  await page.getByLabel('Correo electrónico', { exact: true }).fill('qa-proveedor@example.test')
  await page.getByRole('button', { name: 'Guardar proveedor', exact: true }).click()
  await page.getByText('0012345', { exact: true }).waitFor({ timeout: 30000 })
  page.once('dialog', dialog => dialog.accept())
  await page.getByRole('button', { name: 'Desactivar', exact: true }).click()
  await page.getByText('Inactivo', { exact: true }).last().waitFor({ timeout: 30000 })
  page.once('dialog', dialog => dialog.accept())
  await page.getByRole('button', { name: 'Reactivar', exact: true }).click()
  await page.getByText('Activo', { exact: true }).last().waitFor({ timeout: 30000 })
  await page.locator('[role="dialog"][aria-label="Proveedores"]').getByRole('button', { name: 'Cerrar', exact: true }).last().click()
  await page.getByRole('button', { name: 'Nueva compra', exact: true }).click()
  await page.getByLabel('Tipo de comprobante').selectOption('invoice')
  await page.getByLabel('Número de comprobante').fill('0007-A')
  assert.equal(await page.getByLabel('Número de comprobante').inputValue(), '0007-A', 'el formulario de compra conserva ceros iniciales y series en el comprobante')
  assert.equal(pageErrors.length, 0, 'la navegación habitual admin no genera errores JavaScript')

  const boliviaDay = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/La_Paz', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
  await page.addInitScript(key => localStorage.setItem(key, 'ok'), 'sanjose_warehouse_shift_' + boliviaDay)
  await navigateQA('http://127.0.0.1:5174/scripts/processing-ui-harness.html?app=1&role=warehouse')
  await page.getByRole('button', { name: 'Sacheteado y Embolsado' }).waitFor({ timeout: 30000 })
  await page.getByRole('button', { name: 'Sacheteado y Embolsado' }).click()
  await page.getByText('Almacén asignado:').waitFor()
  await page.getByRole('button', { name: 'Mercadería reservada' }).click()
  await page.getByText('QA-ALMACEN-PROPIO').waitFor({ timeout: 30000 })
  assert.equal(await page.getByText('QA-OTRO-ALMACEN').count(), 0, 'Almacén solo consulta la reserva de su ubicación asignada')

  await navigateQA('http://127.0.0.1:5174/scripts/processing-ui-harness.html?app=1&role=distributor')
  await page.getByRole('heading', { name: /Embutidos San José/ }).waitFor({ timeout: 30000 })
  assert.equal(await page.getByRole('button', { name: 'Sacheteado y Embolsado' }).count(), 0, 'el distribuidor no ve el módulo en la navegación habitual')
  assert.equal(pageErrors.length, 0, 'los recorridos por rol no generan errores JavaScript')

  // Anulación y reembolso QR enteros desde SellView, verificando cada tamaño.
  await navigateQA('http://127.0.0.1:5174/scripts/processing-ui-harness.html?sell=1')
  await page.getByRole('button', { name: 'Historial' }).waitFor({ timeout: 30000 })
  await page.getByRole('button', { name: 'Historial' }).click()
  const saleCard = page.locator('article').filter({ hasText: 'QA Sachet anulación QR' }).first()
  await saleCard.getByRole('button', { name: 'Anular' }).waitFor({ timeout: 30000 })
  await saleCard.getByRole('button', { name: 'Anular' }).click()
  await page.getByRole('heading', { name: 'Anular venta completa' }).waitFor()
  const assertVoidNoHorizontalOverflow = async (width, height) => {
    await page.setViewportSize({ width, height })
    await page.waitForTimeout(150)
    const sizes = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, document: document.documentElement.scrollWidth }))
    assert.ok(sizes.document <= sizes.viewport + 1, `overflow horizontal en modal de anulación a ${width}px: ${JSON.stringify(sizes)}`)
  }
  for (const [width, height] of [[320, 740], [360, 800], [375, 812], [390, 844], [414, 896], [768, 1024], [1440, 900]]) {
    await assertVoidNoHorizontalOverflow(width, height)
    await page.getByLabel('Qué ocurrió con esta venta').selectOption('recorded_in_error_never_delivered')
    await page.getByPlaceholder('Ej.: venta registrada por error; la mercadería no fue entregada').fill('Venta de QA registrada por error; paquete quedó bajo custodia')
    await page.locator('label').filter({ hasText: 'Administración verificó físicamente los paquetes en Almacén central' }).locator('input[type="checkbox"]').check()
    await page.locator('label').filter({ hasText: 'Confirmo que se devolvieron Bs 45.00 por QR' }).locator('input[type="checkbox"]').check()
    await page.getByLabel('Referencia bancaria de devolución QR').fill('QA-QR-OUT-2026-001')
    await page.screenshot({ path: join(tmpdir(), `sanjose-qr-void-${width}.png`), fullPage: true })
    if (width !== 1440) {
      await page.getByLabel('Qué ocurrió con esta venta').selectOption('')
      await page.getByPlaceholder('Ej.: venta registrada por error; la mercadería no fue entregada').fill('')
      await page.locator('label').filter({ hasText: 'Administración verificó físicamente los paquetes en Almacén central' }).locator('input[type="checkbox"]').uncheck()
      await page.locator('label').filter({ hasText: 'Confirmo que se devolvieron Bs 45.00 por QR' }).locator('input[type="checkbox"]').uncheck()
      await page.getByLabel('Referencia bancaria de devolución QR').fill('')
    }
  }
  const confirmVoidButton = page.getByRole('button', { name: 'Confirmar anulación' })
  assert.equal(await confirmVoidButton.isEnabled(), true, 'la interfaz permite confirmar tras completar custodia y reembolso QR')
  await confirmVoidButton.click()
  await page.getByText('Venta anulada correctamente. Los productos volvieron al stock de origen.').waitFor({ timeout: 30000 })
  const finalSale = (await root.collection('distSales').doc(voidSaleOperationId).get()).data()
  const refund = (await root.collection('distClaims').where('saleId', '==', voidSaleOperationId).get()).docs.map(doc => doc.data()).find(row => row.isDerivedSaleVoid)
  const voidMovements = (await root.collection('distStockMovements').where('saleId', '==', voidSaleOperationId).get()).docs.map(doc => doc.data()).filter(row => row.type === 'sale_void')
  const finalVoidLot = (await root.collection('distLots').doc(voidLotId).get()).data()
  assert.ok(finalSale.voidedAt, 'la venta se anuló desde la interfaz')
  assert.equal(refund.qrOut, 45, 'el reembolso QR quedó auditado una sola vez')
  assert.equal(refund.qrRefundReference, 'QA-QR-OUT-2026-001')
  assert.equal(finalVoidLot.quantities.central, 1, 'se restauró exactamente un paquete bajo custodia')
  assert.equal(finalVoidLot.processingPhysicalWeightGRemaining, 250, 'se restauraron exactamente los 250 g históricos')
  assert.equal(finalVoidLot.processingCostCentsRemaining, 125, 'se restauraron exactamente los 125 centavos históricos')
  assert.equal(voidMovements.length, 1, 'se registró un solo movimiento de restitución')
  assert.equal(pageErrors.length, 0, `errores JavaScript del recorrido QR: ${pageErrors.join('; ')}`)
  console.log(`PASS: Playwright ${process.env.SANJOSE_UI_ENGINE === 'webkit' ? 'WebKit' : 'Chromium'} + Functions/Firestore/Auth Emulator; sacheteado y anulación/reembolso QR revisados en 320, 360, 375, 390, 414, 768 y 1440 px; un paquete, 250 g y 125 centavos restaurados una sola vez. Capturas sintéticas guardadas en ${tmpdir()}`)
  }
} finally {
  await browser?.close()
  vite.kill('SIGTERM')
  await app.delete()
}
