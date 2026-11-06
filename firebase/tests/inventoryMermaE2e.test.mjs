import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { spawn } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'
import { chromium } from '@playwright/test'

process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8085'
process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9095'
const req = createRequire(new URL('../../functions/package.json', import.meta.url))
const { initializeApp } = req('firebase-admin/app')
const { getAuth } = req('firebase-admin/auth')
const { getFirestore } = req('firebase-admin/firestore')
const app = initializeApp({ projectId: 'demo-pachax-audit' }, 'inventory-merma-e2e')
const auth = getAuth(app)
const db = getFirestore(app)
const root = db.doc('restaurants/sanjose')
const uid = 'processing-ui-qa'
const email = 'processing-ui-qa@example.test'
const password = 'QA-only-password-123!'
const date = new Date().toISOString()
const dayKey = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/La_Paz', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
const vite = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--mode', 'emulator', '--host', '127.0.0.1', '--port', '5175', '--strictPort'], {
  stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, VITE_USE_FIREBASE_EMULATOR: 'true', VITE_FIREBASE_API_KEY: 'fake-api-key', VITE_FIREBASE_AUTH_DOMAIN: 'demo-pachax-audit.firebaseapp.com', VITE_FIREBASE_PROJECT_ID: 'demo-pachax-audit', VITE_FIREBASE_STORAGE_BUCKET: 'demo-pachax-audit.appspot.com', VITE_FIREBASE_MESSAGING_SENDER_ID: '123456789', VITE_FIREBASE_APP_ID: '1:123456789:web:inventory-merma-qa' },
})
let browser
let viteOutput = ''
vite.stdout.on('data', chunk => { viteOutput += chunk.toString() })
vite.stderr.on('data', chunk => { viteOutput += chunk.toString() })

async function waitForVite() {
  for (let attempt = 0; attempt < 60; attempt++) {
    if (vite.exitCode !== null) throw new Error('Vite QA server exited early: ' + viteOutput.slice(-3000))
    try { if ((await fetch('http://127.0.0.1:5175/scripts/processing-ui-harness.html')).ok) return } catch { /* startup */ }
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
  await root.collection('distProducts').doc('qa-merma-source').set({ id: 'qa-merma-source', restaurantId: 'sanjose', name: 'QA Chorizo a granel', category: 'Granel', unitType: 'kg', active: true, productionCost: 5 })
  await root.collection('distProducts').doc('qa-merma-finished').set({ id: 'qa-merma-finished', restaurantId: 'sanjose', name: 'QA Sachet Chorizo 1 kg', category: 'Sachet', unitType: 'package', active: true, documentedPackageWeightKg: 1, productionCost: 999 })
  const batchId = 'qa-inventory-merma-batch'
  await root.collection('distProcessingBatches').doc(batchId).set({
    id: batchId, operationId: batchId, restaurantId: 'sanjose', branchId: 'central', schemaVersion: 1,
    status: 'confirmed', processType: 'bagging', processingDate: dayKey, sourceProductId: 'qa-merma-source', sourceProductName: 'QA Chorizo a granel',
    sourceLocation: 'central', sourceAllocations: [{ lotId: 'qa-merma-origin-lot', lotCode: 'QA-ORIGEN-MERMA', sourceProductId: 'qa-merma-source', sourceUnitType: 'kg', quantityMilli: 41050, quantity: 41.05, measuredNetWeightG: 41050, historicalCostCents: 10250, productionCost: 2.5, expiresOn: '2999-12-31', originStatus: 'confirmed' }],
    inputWeightG: 41050,
    destinations: [
      { id: 'finished-merma', kind: 'finished', productId: 'qa-merma-finished', lotId: 'qa-derived-merma-lot', lotCode: 'QA-SACHET-MERMA', commercialUnit: 'package', commercialQuantity: 40, nominalWeightG: 1000, netWeightG: 40500, costCents: 10125, sourceAllocations: [] },
      { id: 'discard-merma', kind: 'discard', commercialQuantity: 0, netWeightG: 550, reason: 'Descarte sintético de prueba' },
    ],
    packagingMaterials: [], costComponents: [], responsibleUid: uid, responsibleName: 'Administración QA', createdAt: date, dayKey,
    auditEventIds: [], reversal: { status: 'blocked', dependencyIds: [], reason: 'fixture' }, sourceCostCents: 10250,
  })
  await root.collection('distStockMovements').doc('qa-inventory-merma-discard-ledger').set({
    id: 'qa-inventory-merma-discard-ledger', restaurantId: 'sanjose', productId: 'qa-merma-source', productName: 'QA Chorizo a granel', unitType: 'kg',
    type: 'processing_discard', quantity: 0.55, centralDelta: 0, routeDelta: 0, fromLocation: 'central', toLocation: 'central', batchId,
    physicalEffect: false, dayKey, createdAt: date, createdBy: uid, responsibleName: 'Administración QA', note: 'QA_DUPLICATE_DISCARD_LEDGER', schemaVersion: 1,
  })
  await root.collection('distStockMovements').doc('qa-inventory-other-shortage').set({
    id: 'qa-inventory-other-shortage', restaurantId: 'sanjose', productId: 'qa-merma-source', productName: 'QA Chorizo a granel', unitType: 'kg',
    type: 'shortage', quantity: 0.2, centralDelta: -0.2, routeDelta: 0, fromLocation: 'central', toLocation: '', dayKey,
    createdAt: date, createdBy: uid, responsibleName: 'Administración QA', note: 'QA_SHORTAGE_MERMA', schemaVersion: 1,
  })
  await waitForVite()
  browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('http://127.0.0.1:5175/scripts/processing-ui-harness.html?inventory=1&mermas=1')
  await page.getByRole('heading', { name: 'Inventario' }).waitFor({ timeout: 30000 })
  await page.getByRole('button', { name: 'Historial general de inventario' }).click()
  const history = page.getByRole('dialog', { name: 'Historial general de inventario' })
  await history.getByRole('button', { name: 'Mermas', exact: true }).click()
  await history.getByRole('button', { name: 'Sacheteado', exact: true }).click()
  await history.getByText('Merma por sobrepeso incluida dentro de los paquetes').waitFor({ timeout: 30000 })
  await history.getByText('0.500 kg · 500 g').waitFor()
  await history.getByText('0.550 kg · 550 g').waitFor()
  await history.getByText('1.050 kg · 1.050 g').waitFor()
  assert.equal(await history.getByText('QA_DUPLICATE_DISCARD_LEDGER').count(), 0, 'Sacheteado no presenta otra vez el movement que traza el descarte')
  for (const width of [320, 360, 375, 390, 414, 768, 1440]) {
    await page.setViewportSize({ width, height: width < 500 ? 820 : 900 })
    const sizes = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, document: document.documentElement.scrollWidth }))
    assert.ok(sizes.document <= sizes.viewport + 1, `merma responsive ${width}px: ${JSON.stringify(sizes)}`)
  }
  await history.getByRole('button', { name: 'Todas', exact: true }).click()
  await history.getByText('QA_SHORTAGE_MERMA').waitFor({ timeout: 10000 })
  assert.equal(await history.getByText('QA_DUPLICATE_DISCARD_LEDGER').count(), 0, 'Todas deduplica el ledger asociado al batch en la vista visible')
  const excelDownload = page.waitForEvent('download')
  await history.getByRole('button', { name: 'Descargar mermas Excel', exact: true }).click()
  assert.match((await excelDownload).suggestedFilename(), /SanJose-mermas\.xlsx$/, 'exporta el resumen consolidado en Excel')
  await history.getByRole('button', { name: 'Ver elaboración', exact: true }).click()
  await page.getByRole('heading', { name: 'Detalle de elaboración' }).waitFor({ timeout: 30000 })
  await page.getByText(batchId).waitFor()
  assert.deepEqual(errors, [], 'sin errores de render en el recorrido')
  await browser.close()
  browser = null
  console.log('PASS Inventory → Historial → Mermas: valores, filtros, deduplicación, responsive 320–1440 px y navegación al batch')
} finally {
  if (browser) await browser.close().catch(() => {})
  vite.kill('SIGTERM')
  await new Promise(resolve => vite.once('exit', resolve)).catch(() => {})
  await app.delete().catch(() => {})
}
