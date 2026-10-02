import fs from 'node:fs'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
const req = createRequire(new URL('../functions/package.json', import.meta.url))
const { initializeApp, deleteApp } = req('firebase-admin/app')
const { getFirestore } = req('firebase-admin/firestore')
const { getAuth } = req('firebase-admin/auth')

process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8085'
process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9095'

const projectId = 'demo-pachax-audit'
const app = initializeApp({ projectId }, `test-${Date.now()}`)
const db = getFirestore(app)
const auth = getAuth(app)
const root = db.doc('restaurants/sanjose')

console.log('=== INICIANDO REPRODUCCIÓN TÉCNICA ===')

async function runTests() {
  const prefix = `test_${Date.now().toString(36)}`
  const sellerUid = `user_dist_${prefix}`
  const warehouseUid = `user_wh_${prefix}`
  const adminUid = `user_adm_${prefix}`
  const routeId = `route_${prefix}`
  const warehouseId = `wh_${prefix}`
  const productId = `prod_${prefix}`

  // 1. Setup users and test data
  console.log('1. Creando usuarios, ruta, almacén y producto...')
  await auth.createUser({ uid: adminUid, email: `${adminUid}@example.test`, password: 'password123' })
  await auth.createUser({ uid: warehouseUid, email: `${warehouseUid}@example.test`, password: 'password123' })
  await auth.createUser({ uid: sellerUid, email: `${sellerUid}@example.test`, password: 'password123' })

  await root.collection('members').doc(adminUid).set({ role: 'admin', active: true, displayName: 'Admin QA' })
  await root.collection('members').doc(warehouseUid).set({ role: 'warehouse', active: true, warehouseId, displayName: 'Almacén QA' })
  await root.collection('members').doc(sellerUid).set({ role: 'distributor', active: true, routeId, displayName: 'Distribuidor QA' })

  await root.collection('distWarehouses').doc(warehouseId).set({ id: warehouseId, restaurantId: 'sanjose', name: 'Almacén QA', active: true })
  await root.collection('distRoutes').doc(routeId).set({ id: routeId, restaurantId: 'sanjose', name: 'Ruta QA', active: true })
  await root.collection('distProducts').doc(productId).set({
    id: productId, restaurantId: 'sanjose', name: 'Salchicha Viena QA', unitType: 'kg', active: true, referencePrice: 40, productionCost: 25,
  })

  // Helper for queueing and awaiting operations via Cloud Functions
  async function execOp(actorUid, type, payload) {
    const opId = `op_${type}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
    const opRef = root.collection('distOperations').doc(opId)
    const t0 = performance.now()
    await opRef.set({
      id: opId,
      restaurantId: 'sanjose',
      createdBy: actorUid,
      createdAt: new Date().toISOString(),
      type,
      payload,
      status: 'queued',
    })

    const timeout = Date.now() + 15000
    while (Date.now() < timeout) {
      const snap = await opRef.get()
      const data = snap.data()
      if (data && data.status !== 'queued') {
        const duration = Math.round(performance.now() - t0)
        return { ...data, duration }
      }
      await new Promise(r => setTimeout(r, 100))
    }
    throw new Error(`Timeout esperando operación ${type}`)
  }

  // Stock inicial
  const dateStr = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10)
  await execOp(adminUid, 'intake', {
    lines: [{ productId, quantity: 50, lotCode: 'LOTE-QA', manufacturedOn: '2026-09-01', expiresOn: dateStr }],
    note: 'Ingreso inicial QA',
  })
  // Transfer to test warehouse
  await execOp(adminUid, 'transfer', {
    from: 'central',
    to: warehouseId,
    line: { productId, quantity: 30 },
    note: 'Transferencia a almacén QA',
  })

  // 2. Despacho
  console.log('2. Despachando ruta...')
  const dispatchRes = await execOp(warehouseUid, 'dispatch', {
    warehouseId,
    routeId,
    routeName: 'Ruta QA',
    distributorUid: sellerUid,
    distributorName: 'Distribuidor QA',
    lines: [{ productId, quantity: 20 }],
  })
  const dispatchId = dispatchRes.id
  console.log(`   Despacho creado: ${dispatchId} en ${dispatchRes.duration}ms`)

  // 3. Venta y Cobro
  console.log('3. Registrando venta...')
  const saleRes = await execOp(sellerUid, 'sale', {
    sourceLocation: 'route',
    routeId,
    routeName: 'Ruta QA',
    dispatchId,
    lines: [{ productId, quantity: 5, actualUnitPrice: 40 }],
    total: 200,
    cashAmount: 150,
    qrAmount: 50,
    creditAmount: 0,
    paymentKind: 'mixed',
  })
  console.log(`   Venta registrada en ${saleRes.duration}ms`)

  // 4. Declaración de retorno por el distribuidor (documento parcial)
  console.log('4. Distribuidor declara retorno...')
  const closureId = `closure_${dispatchId}`
  const tDeclStart = performance.now()
  const declaredReturns = { [productId]: 15 }
  const returnDeclaredAt = new Date().toISOString()
  
  // Simulando lo que hace declareRouteReturn en Firestore:
  await root.collection('distClosures').doc(closureId).set({
    id: closureId,
    restaurantId: 'sanjose',
    dispatchId,
    routeId,
    distributorUid: sellerUid,
    distributorName: 'Distribuidor QA',
    declaredReturns,
    returnDeclaredBy: sellerUid,
    returnDeclaredAt,
    dayKey: new Date().toISOString().slice(0, 10),
  }, { merge: true })
  const tDeclDuration = Math.round(performance.now() - tDeclStart)
  console.log(`   Declaración guardada en Firestore en ${tDeclDuration}ms`)

  // 5. Verificar campos del documento parcial
  const partialDocSnap = await root.collection('distClosures').doc(closureId).get()
  const partialDoc = partialDocSnap.data()
  console.log('\n--- DOCUMENTO PARCIAL EN FIRESTORE ---')
  console.log('Campos presentes:', Object.keys(partialDoc))
  const missingKeys = ['createdAt', 'createdBy', 'branchId', 'schemaVersion', 'status', 'products', 'cashSales', 'expectedCash', 'closedAt', 'warehouseClosedAt']
    .filter(k => partialDoc[k] === undefined)
  console.log('Campos requeridos por DistClosure AUSENTES:', missingKeys)

  // 6. Demostración técnica del fallo en historicalClosures.sort
  console.log('\n--- REPRODUCCIÓN DEL ERROR EN HISTORIAL ---')
  const historicalClosure1 = {
    id: 'closure_old_1',
    closedAt: '2026-09-30T18:00:00.000Z',
    routeName: 'Ruta Antigua',
    distributorName: 'Distribuidor Antiguo',
  }
  const currentClosureFromFirestore = { ...partialDoc }

  // Caso A: Solo 1 cierre en la app (el parcial)
  let singleSortFailed = false
  try {
    const list = [currentClosureFromFirestore]
    list.sort((a, b) => (b.closedAt || b.warehouseClosedAt || b.createdAt).localeCompare(a.closedAt || a.warehouseClosedAt || a.createdAt))
  } catch (err) {
    singleSortFailed = true
  }
  console.log('Caso A (1 solo cierre en lista): Falló sort?:', singleSortFailed ? 'SÍ' : 'NO (V8 no ejecuta comparador con length <= 1)')

  // Caso B: Existe un cierre histórico previo + el nuevo parcial
  let multiSortError = null
  try {
    const list = [historicalClosure1, currentClosureFromFirestore]
    list.sort((a, b) => (b.closedAt || b.warehouseClosedAt || b.createdAt).localeCompare(a.closedAt || a.warehouseClosedAt || a.createdAt))
  } catch (err) {
    multiSortError = err
  }
  console.log('Caso B (Cierre histórico + nuevo parcial):')
  if (multiSortError) {
    console.log('  ¡CRASH REPRODUCIDO!')
    console.log('  Tipo de error:', multiSortError.name)
    console.log('  Mensaje:', multiSortError.message)
    console.log('  Stack:', multiSortError.stack?.split('\n').slice(0, 3).join('\n  '))
  } else {
    console.log('  No falló (inesperado)')
  }

  // 7. Almacén confirma retorno
  console.log('\n--- CONFIRMACIÓN DE ALMACÉN ---')
  const whClosureRes = await execOp(warehouseUid, 'closure', {
    closure: {
      dispatchId,
      products: [{ productId, actualReturn: 15 }],
    },
    mode: 'warehouse',
  })
  console.log(`   Almacén confirmó en ${whClosureRes.duration}ms. Status:`, whClosureRes.status)

  // Verificar documento después de confirmación de almacén
  const afterWhSnap = await root.collection('distClosures').doc(closureId).get()
  const afterWhDoc = afterWhSnap.data()
  console.log('   Status cierre:', afterWhDoc.status)
  console.log('   warehouseClosedBy:', afterWhDoc.warehouseClosedBy)
  console.log('   Productos conciliados:', afterWhDoc.products?.length)

  // 8. Cierre financiero final
  console.log('\n--- CIERRE FINANCIERO ---')
  const moneyClosureRes = await execOp(sellerUid, 'closure', {
    closure: {
      dispatchId,
      physicalCashDeclared: 150,
    },
    mode: 'money',
  })
  console.log(`   Cierre final completado en ${moneyClosureRes.duration}ms. Status:`, moneyClosureRes.status)

  const finalSnap = await root.collection('distClosures').doc(closureId).get()
  const finalDoc = finalSnap.data()
  console.log('   Status cierre final:', finalDoc.status)
  console.log('   Efectivo esperado:', finalDoc.expectedCash)
  console.log('   Efectivo declarado:', finalDoc.physicalCashDeclared)
  console.log('   Diferencia de caja:', finalDoc.cashDifference)

  const finalDispatchSnap = await root.collection('distDispatches').doc(dispatchId).get()
  console.log('   Status despacho final:', finalDispatchSnap.data()?.status)

  // 9. Verificar reintento / doble click
  console.log('\n--- VERIFICAR DOBLE CIERRE ---')
  const secondClosureRes = await execOp(sellerUid, 'closure', {
    closure: {
      dispatchId,
      physicalCashDeclared: 150,
    },
    mode: 'money',
  })
  console.log('   Resultado del segundo cierre (doble tap):', secondClosureRes.status, `(Error: ${secondClosureRes.error})`)

  console.log('\n=== REPRODUCCIÓN FINALIZADA CON ÉXITO ===')
  await deleteApp(app)
}

runTests().catch(err => {
  console.error('Error en prueba:', err)
  process.exit(1)
})
