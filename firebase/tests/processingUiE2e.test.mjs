// End-to-end UI against a disposable Firebase Emulator tenant and synthetic fixture.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { spawn } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium } from '@playwright/test'

process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8085'
process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9095'
const req = createRequire(new URL('../../functions/package.json', import.meta.url))
const { initializeApp } = req('firebase-admin/app')
const { getAuth } = req('firebase-admin/auth')
const { getFirestore } = req('firebase-admin/firestore')
const app = initializeApp({ projectId: 'demo-pachax-audit' }, 'processing-ui-e2e')
const auth = getAuth(app)
const db = getFirestore(app)
const root = db.doc('restaurants/sanjose')
const uid = 'processing-ui-qa'
const email = 'processing-ui-qa@example.test'
const password = 'QA-only-password-123!'
const date = new Date().toISOString()
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

async function waitForVite() {
  for (let tries = 0; tries < 60; tries++) {
    if (vite.exitCode !== null) throw new Error('Vite QA server exited early.')
    try { const response = await fetch('http://127.0.0.1:5174/scripts/processing-ui-harness.html'); if (response.ok) return } catch { /* wait for startup */ }
    await delay(500)
  }
  throw new Error('Vite QA server did not become ready.')
}

try {
  await auth.createUser({ uid, email, password }).catch(async error => {
    if (error.code !== 'auth/uid-already-exists' && error.code !== 'auth/email-already-exists') throw error
    return auth.getUser(uid)
  })
  await root.collection('members').doc(uid).set({ uid, role: 'admin', active: true, displayName: 'Administración QA' })
  await root.collection('distProducts').doc('qa-source-product').set({ id: 'qa-source-product', restaurantId: 'sanjose', name: 'QA Producto a granel', unitType: 'kg', active: true, productionCost: 5 })
  await root.collection('distProducts').doc('qa-sachet-product').set({ id: 'qa-sachet-product', restaurantId: 'sanjose', name: 'QA Sachet 250 g', unitType: 'package', active: true, productionCost: 999 })
  await root.collection('distLots').doc('qa-source-lot').set({ id: 'qa-source-lot', restaurantId: 'sanjose', productId: 'qa-source-product', productName: 'QA Producto a granel', unitType: 'kg', lotCode: 'QA-ORIGEN-2KG', manufacturedOn: '2026-10-20', expiresOn: '2026-12-20', productionCost: 5, quantities: { central: 2 }, processingUnavailable: { central: { courtesy: 0, repackPending: 2, reviewHold: 0 } }, processingReview: { caseId: 'qa-processing-case', revision: 0, status: 'pending_review', updatedAt: date, updatedBy: uid } })
  await root.collection('distLots').doc('qa-other-lot').set({ id: 'qa-other-lot', restaurantId: 'sanjose', productId: 'qa-source-product', productName: 'QA Producto a granel', unitType: 'kg', lotCode: 'QA-OTRO-1KG', manufacturedOn: '2026-10-20', expiresOn: '2026-12-20', productionCost: 5, quantities: { central: 1 }, processingUnavailable: { central: { courtesy: 0, repackPending: 0, reviewHold: 1 } }, processingReview: { caseId: 'qa-other-case', revision: 0, status: 'pending_review', updatedAt: date, updatedBy: uid } })
  await root.collection('distLots').doc('qa-free-lot').set({ id: 'qa-free-lot', restaurantId: 'sanjose', productId: 'qa-source-product', productName: 'QA Producto a granel', unitType: 'kg', lotCode: 'QA-LIBRE-1KG', manufacturedOn: '2026-10-20', expiresOn: '2026-12-20', productionCost: 5, quantities: { central: 1 }, processingUnavailable: { central: { courtesy: 0, repackPending: 0, reviewHold: 0 } } })
  await root.collection('distBalances').doc('central__qa-source-product').set({ id: 'central__qa-source-product', restaurantId: 'sanjose', locationKind: 'central', warehouseId: 'central', productId: 'qa-source-product', unitType: 'kg', quantity: 4 })
  await root.collection('distStockReservations').doc('qa-source-reservation').set({ id: 'qa-source-reservation', restaurantId: 'sanjose', branchId: 'main', schemaVersion: 1, productId: 'qa-source-product', productName: 'QA Producto a granel', lotId: 'qa-source-lot', lotCode: 'QA-ORIGEN-2KG', unitType: 'kg', location: 'central', purpose: 'repack_pending', originalQuantity: 2, remainingQuantity: 2, consumedQuantity: 0, physicalWeightG: 2000, remainingWeightG: 2000, remainingCostCents: 1000, status: 'active', source: 'qa', createdAt: date, createdBy: uid, createdByName: 'Administración QA', history: [] })
  await root.collection('distStockReservations').doc('qa-other-reservation').set({ id: 'qa-other-reservation', restaurantId: 'sanjose', branchId: 'main', schemaVersion: 1, productId: 'qa-source-product', productName: 'QA Producto a granel', lotId: 'qa-other-lot', lotCode: 'QA-OTRO-1KG', unitType: 'kg', location: 'central', purpose: 'review_hold', originalQuantity: 1, remainingQuantity: 1, consumedQuantity: 0, physicalWeightG: null, remainingWeightG: null, remainingCostCents: 500, status: 'active', source: 'qa', createdAt: date, createdBy: uid, createdByName: 'Administración QA', history: [] })
  await root.collection('distProcessingQualityAuthorizations').doc(uid).set({ id: 'qa-auth', authorizationId: 'qa-auth', restaurantId: 'sanjose', status: 'active', beneficiaryUid: uid, grantedBy: 'qa-system-fixture', grantedByName: 'Emulator fixture', expiresAt: '2026-12-31T23:59:59.000Z' })

  await waitForVite()
  browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  const pageErrors = []
  page.on('pageerror', error => pageErrors.push(error.message))
  await page.goto('http://127.0.0.1:5174/scripts/processing-ui-harness.html')
  await page.getByRole('heading', { name: 'Sacheteado y Embolsado' }).waitFor()

  const assertNoHorizontalOverflow = async (width, height) => {
    await page.setViewportSize({ width, height })
    await page.waitForTimeout(200)
    const sizes = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, document: document.documentElement.scrollWidth }))
    assert.ok(sizes.document <= sizes.viewport + 1, `overflow horizontal a ${width}px: ${JSON.stringify(sizes)}`)
  }
  for (const [width, height] of [[360, 800], [390, 844], [768, 1024], [1440, 900]]) {
    for (const tab of ['Nueva elaboración', 'Mercadería reservada', 'Revisión de producto', 'Reenvasado', 'Historial']) {
      await page.getByRole('button', { name: tab, exact: true }).click()
      await assertNoHorizontalOverflow(width, height)
      if (tab === 'Nueva elaboración') await page.getByRole('button', { name: /1\. Origen/ }).waitFor({ timeout: 5000 })
      if (tab === 'Mercadería reservada') await page.getByText('Las cantidades reservadas están inmovilizadas.').waitFor({ timeout: 5000 })
      if (tab === 'Revisión de producto') await page.getByText('Revisión física').waitFor({ timeout: 5000 })
      if (tab === 'Reenvasado') await page.getByText('Reenvasado guiado').waitFor({ timeout: 5000 })
      if (tab === 'Historial') await page.getByText('Elaboraciones', { exact: true }).waitFor({ timeout: 5000 })
    }
    await page.screenshot({ path: join(tmpdir(), `sanjose-processing-${width}.png`), fullPage: true })
  }

  await page.setViewportSize({ width: 360, height: 800 })
  await page.getByRole('button', { name: 'Nueva elaboración', exact: true }).click()
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
  await page.getByRole('button', { name: 'Registrar revisión' }).click()
  await page.getByText('Revisión registrada. La reserva, el inventario, los costos y el Kardex no se modificaron.').waitFor({ timeout: 30000 })

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
  await page.getByLabel('Vencimiento').fill('2026-11-20')
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
  console.log(`PASS: Playwright Chromium; pestañas y responsive 360/390/768/1440; teclado decimal móvil; revisión autorizada y reenvasado 2 kg → 8 sachets en UI con Functions/Firestore/Auth Emulator; historial y balances verificados. Capturas sintéticas: ${[360,390,768,1440].map(width => join(tmpdir(), `sanjose-processing-${width}.png`)).join(', ')}, ${join(tmpdir(), 'sanjose-processing-360-form.png')}`)
} finally {
  await browser?.close()
  vite.kill('SIGTERM')
  await app.delete()
}
