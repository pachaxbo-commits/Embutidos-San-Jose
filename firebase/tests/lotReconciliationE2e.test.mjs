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

let stopOperations
try {
  await auth.createUser({ uid, email, password }).catch(async error => { if (!['auth/uid-already-exists','auth/email-already-exists'].includes(error.code)) throw error })
  await root.collection('members').doc(uid).set({ uid, role:'admin', active:true, displayName:'Origin QA Admin' })
  const pid='qa-origin-product', lid='qa-origin-lot', exceptionId='qa-origin-exception'
  await root.collection('distProducts').doc(pid).set({ id:pid, restaurantId:'sanjose', name:'QA Origen conciliable', unitType:'kg', category:'Granel', active:true, productionCost:10, referencePrice:20 })
  await root.collection('distBalances').doc(`central__${pid}`).set({ id:`central__${pid}`, productId:pid, locationId:'central', quantity:1.740 })
  await root.collection('distLots').doc(lid).set({ id:lid, restaurantId:'sanjose', productId:pid, productName:'QA Origen conciliable', unitType:'kg', lotCode:'201026', manufacturedOn:'2026-10-20', expiresOn:'2026-10-30', productionCost:10, quantities:{central:1.740}, pendingOrigins:{central:[{exceptionId,accountingLotId:lid,sourceMovementId:'qa-source-movement',physicalOriginConfirmed:false,basis:'original_accounting_debit_only',historicalUnitCost:10,quantity:1.740}]} })
  await root.collection('distLotHistory').doc(exceptionId).set({ id:exceptionId, action:'physical_origin_pending', productId:pid, createdAt:date, createdBy:uid, reason:'Historical synthetic accounting origin', sourceMovementId:'qa-source-movement' })
  const { processCommand } = req('./operations.cjs')
  const inFlight=new Set()
  stopOperations=root.collection('distOperations').where('status','==','queued').onSnapshot(snapshot=>{ for(const row of snapshot.docs) if(!inFlight.has(row.id)){inFlight.add(row.id);void processCommand(db,row.ref).finally(()=>inFlight.delete(row.id))} })
  await waitForVite()
  browser=await chromium.launch({headless:true})
  const page=await browser.newPage({viewport:{width:390,height:844}})
  await page.goto('http://127.0.0.1:5175/scripts/processing-ui-harness.html?inventory=1&mermas=1')
  await page.getByRole('button',{name:'Ver lotes de QA Origen conciliable',exact:true}).click({timeout:30000})
  const dialog=page.getByRole('dialog',{name:'Lotes del producto'})
  await dialog.getByRole('button',{name:'Conciliar origen',exact:true}).click()
  const confirm=dialog.getByRole('button',{name:'Confirmar conciliación',exact:true})
  assert.equal(await confirm.isDisabled(),true)
  for(const width of [320,360,375,390,414,768,1440]) {
    await page.setViewportSize({width,height:900})
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`responsive origin ${width}`)
  }
  await dialog.getByLabel('Motivo (mínimo 12 caracteres)').fill('Producto verificado físicamente en QA')
  await dialog.getByLabel('Evidencia revisada / nota documental (mínimo 12 caracteres)').fill('Etiqueta sintética y pesaje de QA revisados')
  await dialog.getByRole('checkbox').check()
  await confirm.click()
  await dialog.getByText('Operación confirmada por el servidor.',{exact:false}).waitFor({timeout:60000})
  assert.equal((await root.collection('distLots').doc(lid).get()).data().pendingOrigins.central.length,0)
  assert.equal((await root.collection('distLots').doc(lid).get()).data().expiresOn,'2026-10-30')
  await dialog.getByRole('button',{name:'Rectificar datos del lote',exact:true}).click()
  await dialog.getByLabel('Código correcto').fill('CORRECT-QA-LABEL')
  await dialog.getByLabel('Vencimiento real').fill('2099-11-10')
  await dialog.getByRole('checkbox').check()
  await dialog.getByRole('button',{name:'Confirmar rectificación',exact:true}).click()
  await page.waitForFunction(()=>document.body.textContent.includes('Lote CORRECT-QA-LABEL'),{},{timeout:60000})
  const final=(await root.collection('distLots').doc(lid).get()).data()
  assert.equal(final.quantities.central,1.740);assert.equal(final.productionCost,10)
  await page.reload()
  await page.getByRole('button',{name:'Ver lotes de QA Origen conciliable',exact:true}).click({timeout:30000})
  await page.getByText('Lote CORRECT-QA-LABEL',{exact:true}).waitFor()
  console.log('PASS responsive origin → confirmed server operation → identity correction → reload; physical stock and cost unchanged')
} finally { stopOperations?.(); await browser?.close();vite.kill();await Promise.race([new Promise(resolve=>vite.once('exit',resolve)),delay(3000)]);await db.terminate() }
