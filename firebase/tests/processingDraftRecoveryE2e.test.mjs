// End-to-end UI against a disposable Firebase Emulator tenant and synthetic fixture.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import { execFileSync, spawn } from 'node:child_process'
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

async function waitForOperation(ref, expectedStatus = 'confirmed') {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const snapshot = await ref.get()
    const operation = snapshot.data()
    if (operation?.status === expectedStatus) return operation
    if (operation?.status === 'rejected') throw new Error(`La operación ${ref.id} fue rechazada: ${operation.error || 'sin detalle'}`)
    await delay(250)
  }
  throw new Error(`La operación ${ref.id} no llegó al estado ${expectedStatus} desde el trigger de Emulator.`)
}

const fixtures = []
function fixture(path, content) {
  writeFileSync(path, content, { flag: 'wx' })
  fixtures.push(path)
}

try {
  // Exercise the actual pre-1.4.98 component against the current emulator backend.
  const view = 'src/modules/distribution/views/SacheteadoView.tsx'
  const legacy = execFileSync('git', ['show', '8e9d74f:' + view])
  fixture('src/modules/distribution/views/LegacySacheteadoQa.tsx', legacy)
  const harness = readFileSync('scripts/processing-ui-harness.tsx', 'utf8')
    .replace("userName: 'Administración QA', role: 'admin', warehouseId: 'central', routeId: null,", "userName: qaUser.name, role, warehouseId: 'central', routeId: null,")
  const html = readFileSync('scripts/processing-ui-harness.html', 'utf8')
  for (const variant of ['old', 'current']) {
    fixture('scripts/recovery-' + variant + '.tsx', variant === 'old' ? harness.replace('views/SacheteadoView', 'views/LegacySacheteadoQa') : harness)
    fixture('scripts/recovery-' + variant + '.html', html.replace('processing-ui-harness.tsx', 'recovery-' + variant + '.tsx'))
  }
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
  await root.collection('distProducts').doc('qa-sachet-product').set({ id: 'qa-sachet-product', restaurantId: 'sanjose', name: 'QA Sachet 1 kg', unitType: 'package', active: true, productionCost: 999 })
  await root.collection('distProducts').doc('qa-assessment-product').set({ id: 'qa-assessment-product', restaurantId: 'sanjose', name: 'QA Paquete para evaluación', unitType: 'package', active: true, productionCost: null })
  await root.collection('distProducts').doc('qa-courtesy-product').set({ id: 'qa-courtesy-product', restaurantId: 'sanjose', name: 'QA Producto reservado para cortesía', unitType: 'kg', active: true, productionCost: 4 })
  await root.collection('distLots').doc('qa-courtesy-lot').set({ id: 'qa-courtesy-lot', restaurantId: 'sanjose', productId: 'qa-courtesy-product', productName: 'QA Producto reservado para cortesía', unitType: 'kg', lotCode: 'QA-CORTESIA-LOTE', manufacturedOn: sourceManufacturedOn, expiresOn: safeExpiry, productionCost: 4, quantities: { central: 10 }, processingUnavailable: { central: { courtesy: 3, repackPending: 0, reviewHold: 0 } } })
  await root.collection('distBalances').doc('central__qa-courtesy-product').set({ id: 'central__qa-courtesy-product', restaurantId: 'sanjose', locationKind: 'central', warehouseId: 'central', productId: 'qa-courtesy-product', unitType: 'kg', quantity: 10 })
  await root.collection('distStockReservations').doc('qa-courtesy-reservation').set({ id: 'qa-courtesy-reservation', restaurantId: 'sanjose', branchId: 'main', schemaVersion: 1, productId: 'qa-courtesy-product', productName: 'QA Producto reservado para cortesía', lotId: 'qa-courtesy-lot', lotCode: 'QA-CORTESIA-LOTE', unitType: 'kg', location: 'central', purpose: 'courtesy', originalQuantity: 3, remainingQuantity: 3, consumedQuantity: 0, physicalWeightG: 3000, remainingWeightG: 3000, remainingCostCents: 1200, status: 'active', source: 'qa', createdAt: date, createdBy: uid, createdByName: 'Administración QA', history: [{ id: 'qa-courtesy-created', action: 'created', quantity: 3, at: date, by: uid, byName: 'Administración QA', reason: 'Reserva sintética para probar administración' }] })
  await root.collection('distProducts').doc('qa-quantity-source').set({ id: 'qa-quantity-source', restaurantId: 'sanjose', name: 'QA Mortadela a granel', category: 'Granel', unitType: 'kg', active: true, productionCost: 5 })
  await root.collection('distProducts').doc('qa-quantity-target').set({ id: 'qa-quantity-target', restaurantId: 'sanjose', name: 'QA Mortadela jamonada porcionada 1 kg', category: 'Otros', presentation: 'Bolsa 1 kg', unitType: 'package', documentedPackageWeightKg: 1, active: true, productionCost: 999 })
  await root.collection('distLots').doc('qa-quantity-source-lot').set({ id: 'qa-quantity-source-lot', restaurantId: 'sanjose', productId: 'qa-quantity-source', productName: 'QA Mortadela a granel', unitType: 'kg', lotCode: 'ORIGEN-QA-CANTIDAD', manufacturedOn: sourceManufacturedOn, expiresOn: safeExpiry, productionCost: 5, quantities: { central: 99 } })
  await root.collection('distBalances').doc('central__qa-quantity-source').set({ id: 'central__qa-quantity-source', restaurantId: 'sanjose', locationKind: 'central', warehouseId: 'central', productId: 'qa-quantity-source', unitType: 'kg', quantity: 99 })
  await root.collection('distLots').doc('qa-source-lot').set({ id: 'qa-source-lot', restaurantId: 'sanjose', productId: 'qa-source-product', productName: 'QA Producto a granel', unitType: 'kg', lotCode: 'QA-ORIGEN-2KG', manufacturedOn: sourceManufacturedOn, expiresOn: safeExpiry, productionCost: 5, quantities: { central: 2 }, processingUnavailable: { central: { courtesy: 0, repackPending: 2, reviewHold: 0 } }, processingReview: { caseId: 'qa-processing-case', revision: 0, status: 'pending_review', updatedAt: date, updatedBy: uid } })
  await root.collection('distLots').doc('qa-other-lot').set({ id: 'qa-other-lot', restaurantId: 'sanjose', productId: 'qa-source-product', productName: 'QA Producto a granel', unitType: 'kg', lotCode: 'QA-OTRO-1KG', manufacturedOn: sourceManufacturedOn, expiresOn: safeExpiry, productionCost: 5, quantities: { central: 1 }, processingUnavailable: { central: { courtesy: 0, repackPending: 0, reviewHold: 1 } }, processingReview: { caseId: 'qa-other-case', revision: 0, status: 'authorized_for_repack', updatedAt: date, updatedBy: uid } })
  await root.collection('distLots').doc('qa-free-lot').set({ id: 'qa-free-lot', restaurantId: 'sanjose', productId: 'qa-source-product', productName: 'QA Producto a granel', unitType: 'kg', lotCode: 'QA-LIBRE-1KG', manufacturedOn: sourceManufacturedOn, expiresOn: safeExpiry, productionCost: 5, quantities: { central: 1 }, processingUnavailable: { central: { courtesy: 0, repackPending: 0, reviewHold: 0 } } })
  await root.collection('distBalances').doc('central__qa-source-product').set({ id: 'central__qa-source-product', restaurantId: 'sanjose', locationKind: 'central', warehouseId: 'central', productId: 'qa-source-product', unitType: 'kg', quantity: 4 })
  await root.collection('distStockReservations').doc('qa-source-reservation').set({ id: 'qa-source-reservation', restaurantId: 'sanjose', branchId: 'main', schemaVersion: 1, productId: 'qa-source-product', productName: 'QA Producto a granel', lotId: 'qa-source-lot', lotCode: 'QA-ORIGEN-2KG', unitType: 'kg', location: 'central', purpose: 'repack_pending', originalQuantity: 2, remainingQuantity: 2, consumedQuantity: 0, physicalWeightG: 2000, remainingWeightG: 2000, remainingCostCents: 1000, status: 'active', source: 'qa', createdAt: date, createdBy: uid, createdByName: 'Administración QA', history: [] })
  await root.collection('distStockReservations').doc('qa-other-reservation').set({ id: 'qa-other-reservation', restaurantId: 'sanjose', branchId: 'main', schemaVersion: 1, productId: 'qa-source-product', productName: 'QA Producto a granel', lotId: 'qa-other-lot', lotCode: 'QA-OTRO-1KG', unitType: 'kg', location: 'central', purpose: 'review_hold', originalQuantity: 1, remainingQuantity: 1, consumedQuantity: 0, physicalWeightG: null, remainingWeightG: null, remainingCostCents: 500, status: 'active', source: 'qa', createdAt: date, createdBy: uid, createdByName: 'Administración QA', history: [] })
  await waitForVite()
  browser = await chromium.launch()
  for (const role of ['admin','warehouse']) {
    const user = role === 'admin' ? uid : 'processing-ui-warehouse'
    await root.collection('members').doc(user).update({warehouseId:'central'})
    await root.collection('distBalances').doc('central__qa-quantity-target').set({id:'central__qa-quantity-target',restaurantId:'sanjose',locationKind:'central',warehouseId:'central',productId:'qa-quantity-target',unitType:'package',quantity:1})
    const occupied = '241126'
    const input = 'qa-quantity-source'
    const target = 'qa-quantity-target'
    await root.collection('distLots').doc('qa-existing-jamon').set({id:'qa-existing-jamon', restaurantId:'sanjose',productId:target,productName:'QA Jamón',lotCode:occupied,unitType:'package',quantities:{central:1},manufacturedOn:boliviaDayKey,expiresOn:safeExpiry})
    await root.collection('distLots').doc('qa-free-lot').update({'quantities.central':1});await root.collection('distBalances').doc('central__qa-source-product').update({quantity:4})
    const ctx=await browser.newContext()
    let page=await ctx.newPage()
    const key='sanjose_processing_draft_v1:'+user
    const url=v=>'http://127.0.0.1:5174/scripts/recovery-'+v+'.html?role='+role
    const open=async v=>{await page.goto(url(v));await page.getByRole('button',{name:'4. Confirmación'}).waitFor()}
    const read=()=>page.evaluate(k=>JSON.parse(localStorage.getItem(k)),key)
    const write=d=>page.evaluate(([k,v])=>localStorage.setItem(k,JSON.stringify(v)),[key,d])
    await open('old')
    const d=await read()
    Object.assign(d,{sourceProductId:input,sources:[{lotId:'qa-quantity-source-lot',quantityKg:'1'}]})
    Object.assign(d.destinations[0],{productId:target,lotCode:occupied,commercialQuantity:'1',netWeightG:'1000',nominalWeightG:'1000',manufacturedOn:boliviaDayKey,packagedOn:boliviaDayKey,expiresOn:safeExpiry})
    await write(d); await open('old')
    const send=async()=>{await page.getByRole('button',{name:'4. Confirmación'}).click();await page.getByRole('button',{name:'Confirmar elaboración',exact:true}).click()}
    await send()
    const rejected=await waitForOperation(root.collection('distOperations').doc(d.operationId),'rejected')
    console.log(role,rejected.error);assert.match(rejected.error,/existe|continuaci/i)
    await page.getByRole('alert').filter({hasText:/lote/i}).waitFor()
    await open('old')
    await page.locator('[data-processing-anchor="source-product"]').click()
    await page.getByRole('dialog').getByText('QA Producto a granel',{exact:true}).click()
    const changed=await read()
    assert.equal(changed.operationId,d.operationId)
    assert.equal(changed.destinations[0].productId,'')
    changed.sources=[{lotId:'qa-free-lot',quantityKg:'1'}]
    Object.assign(changed.destinations[0],d.destinations[0],{productId:'qa-sachet-product',lotCode:'QA-TOCINO-'+role})
    await write(changed)
    await page.close();page=await ctx.newPage();await open('current')
    await page.getByRole('button',{name:'Comprobar estado'}).click()
    await page.getByText(/El intento anterior fue rechazado/).waitFor()
    const recovered=await read();assert.notEqual(recovered.operationId,d.operationId);assert.equal(recovered.sourceProductId,changed.sourceProductId)
    assert.equal(await page.getByRole('alert').count(),0)
    await page.reload();await send()
    const accepted=await waitForOperation(root.collection('distOperations').doc(recovered.operationId))
    assert.equal(accepted.payload.sourceProductId,changed.sourceProductId)
    assert.deepEqual(accepted.payload.destinations.map(x=>x.productId),['qa-sachet-product'])
    assert.equal((await root.collection('distLots').doc('qa-free-lot').get()).data().quantities.central,0)
    assert.equal((await root.collection('distProcessingBatches').where('operationId','==',recovered.operationId).get()).size,1)
    console.log('PASS',role,'legacy rejection, old ID after product switch, reopen, recovery, confirmed payload and inventory')
    await ctx.close()
  }
} finally {await browser?.close();vite.kill();await app.delete();for (const path of fixtures) unlinkSync(path)}

