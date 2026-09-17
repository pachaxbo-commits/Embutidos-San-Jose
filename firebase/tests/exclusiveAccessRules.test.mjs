import fs from 'node:fs'
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing'
import { collection, deleteField, doc, getDoc, getDocs, query, setDoc, where, writeBatch } from 'firebase/firestore'

const COMPANY = 'sanjose'
const OTHER_COMPANY = 'otra-empresa'
const env = await initializeTestEnvironment({
  projectId: 'demo-sanjose-access',
  firestore: { host: '127.0.0.1', port: 8085, rules: fs.readFileSync('firebase/firestore.rules', 'utf8') },
})

let passed = 0
async function check(name, expectation) {
  await expectation
  passed++
  console.log(`PASS: ${name}`)
}

const companyPath = (collectionName, id) => `restaurants/${COMPANY}/${collectionName}/${id}`
const operation = (id, uid, type, payload = {}) => ({
  id, restaurantId: COMPANY, createdBy: uid, createdAt: new Date().toISOString(), type, payload, status: 'queued',
})

try {
  await env.clearFirestore()
  await env.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore()
    const members = {
      admin: { role: 'admin', routeId: '', warehouseId: 'central' },
      almacen: { role: 'warehouse', routeId: '', warehouseId: 'central' },
      vendedor: { role: 'distributor', routeId: 'norte', warehouseId: 'central' },
      vendedor2: { role: 'distributor', routeId: 'sur', warehouseId: 'central' },
      soporte: { role: 'support', routeId: '', warehouseId: 'central' },
    }
    await setDoc(doc(db, `restaurants/${COMPANY}`), { id: COMPANY, name: 'Embutidos San José', ownerUid: 'admin' })
    for (const [uid, member] of Object.entries(members)) {
      await setDoc(doc(db, companyPath('members', uid)), { uid, email: `${uid}@sanjose.test`, displayName: uid, active: true, ...member })
    }
    await setDoc(doc(db, companyPath('distProducts', 'producto')), { id: 'producto', name: 'Chorizo', unitType: 'kg', referencePrice: 50, active: true, restaurantId: COMPANY })
    await setDoc(doc(db, companyPath('distSales', 'norte')), { id: 'norte', restaurantId: COMPANY, routeId: 'norte', sellerUid: 'vendedor' })
    await setDoc(doc(db, companyPath('distSales', 'sur')), { id: 'sur', restaurantId: COMPANY, routeId: 'sur', sellerUid: 'vendedor2' })
    await setDoc(doc(db, companyPath('distReceivables', 'deuda-sur')), { id: 'deuda-sur', restaurantId: COMPANY, routeId: 'sur', balance: 25 })
    await setDoc(doc(db, `restaurants/${OTHER_COMPANY}/members/ajeno`), { uid: 'ajeno', role: 'admin', active: true })
    await setDoc(doc(db, `restaurants/${OTHER_COMPANY}/distProducts/ajeno`), { restaurantId: OTHER_COMPANY })
  })

  const admin = env.authenticatedContext('admin').firestore()
  const warehouse = env.authenticatedContext('almacen').firestore()
  const seller = env.authenticatedContext('vendedor').firestore()
  const support = env.authenticatedContext('soporte').firestore()
  const outsider = env.authenticatedContext('ajeno').firestore()

  await check('Administración lee productos', assertSucceeds(getDocs(collection(admin, `restaurants/${COMPANY}/distProducts`))))
  const granelRef = doc(admin, companyPath('distProducts', 'granel-sin-peso'))
  await check('Administración registra peso informativo opcional', assertSucceeds(setDoc(granelRef, { id: 'granel-sin-peso', name: 'Chorizo a granel', unitType: 'kg', referencePrice: 53, productionCost: 20, minimumStock: 0, active: true, restaurantId: COMPANY, approximateWeightKg: 1 })))
  const granelBatch = writeBatch(admin)
  granelBatch.set(granelRef, { id: 'granel-sin-peso', name: 'Chorizo a granel', unitType: 'kg', referencePrice: 53, productionCost: 20, minimumStock: 0, active: true, restaurantId: COMPANY, approximateWeightKg: deleteField() }, { merge: true })
  await check('Administración guarda producto por kilos sin peso aproximado', assertSucceeds(granelBatch.commit()))
  await check('Producto por kilos no conserva peso aproximado', getDoc(granelRef).then(snapshot => { if (snapshot.data()?.approximateWeightKg !== undefined) throw new Error('El peso aproximado no se eliminó') }))
  await check('Almacén lee inventario', assertSucceeds(getDocs(collection(warehouse, `restaurants/${COMPANY}/distProducts`))))
  await check('Distribuidor lee productos', assertSucceeds(getDocs(collection(seller, `restaurants/${COMPANY}/distProducts`))))
  await check('Distribuidor consulta únicamente sus ventas', assertSucceeds(getDocs(query(collection(seller, `restaurants/${COMPANY}/distSales`), where('sellerUid', '==', 'vendedor')))))
  await check('Distribuidor no lee la venta de otro', assertFails(getDoc(doc(seller, companyPath('distSales', 'sur')))))
  await check('Distribuidor consulta la cartera global', assertSucceeds(getDocs(collection(seller, `restaurants/${COMPANY}/distReceivables`))))
  await check('Almacén lista usuarios para despachar', assertSucceeds(getDocs(collection(warehouse, `restaurants/${COMPANY}/members`))))
  await check('Distribuidor no lista usuarios', assertFails(getDocs(collection(seller, `restaurants/${COMPANY}/members`))))
  await check('Soporte no accede a ventas', assertFails(getDocs(collection(support, `restaurants/${COMPANY}/distSales`))))
  await check('Soporte no accede a clientes', assertFails(getDocs(collection(support, `restaurants/${COMPANY}/distCustomers`))))
  await check('Administrador encola operaciones administrativas', assertSucceeds(setDoc(doc(admin, companyPath('distOperations', 'ajuste')), operation('ajuste', 'admin', 'adjustment', { productId: 'producto' }))))
  await check('Distribuidor encola ventas propias', assertSucceeds(setDoc(doc(seller, companyPath('distOperations', 'venta')), operation('venta', 'vendedor', 'sale', { routeId: 'norte' }))))
  await check('Distribuidor no suplanta al creador', assertFails(setDoc(doc(seller, companyPath('distOperations', 'suplantada')), operation('suplantada', 'admin', 'sale'))))
  await check('Clientes no escriben ventas directamente', assertFails(setDoc(doc(admin, companyPath('distSales', 'directa')), { restaurantId: COMPANY })))
  await check('Un usuario ajeno no lee San José', assertFails(getDocs(collection(outsider, `restaurants/${COMPANY}/distProducts`))))
  await check('San José no lee datos de otra empresa', assertFails(getDocs(collection(admin, `restaurants/${OTHER_COMPANY}/distProducts`))))
  await check('No se puede crear otra empresa', assertFails(setDoc(doc(admin, `restaurants/nueva-empresa`), { ownerUid: 'admin' })))
  await check('Administración solo asigna usuarios a San José', assertFails(setDoc(doc(admin, 'users/usuario-ajeno'), { uid: 'usuario-ajeno', defaultRestaurantId: OTHER_COMPANY })))

  console.log(`${passed} comprobaciones de acceso aprobadas`)
} finally {
  await env.cleanup()
}
