// Emulator-only regression for distributor fuel expenses after a category is moved.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import { randomUUID } from 'node:crypto'
import { initializeTestEnvironment } from '@firebase/rules-unit-testing'
import { collection, disableNetwork, doc, enableNetwork, getDoc, getDocs, onSnapshot, query, setDoc, where } from 'firebase/firestore'

process.env.FIRESTORE_EMULATOR_HOST ||= '127.0.0.1:8085'
const [host, port] = process.env.FIRESTORE_EMULATOR_HOST.split(':')
const require = createRequire(new URL('../../functions/package.json', import.meta.url))
const { initializeApp } = require('firebase-admin/app')
const { getFirestore } = require('firebase-admin/firestore')
const { processCommand } = require('./operations.cjs')
const { pendingExpensesFromOperations } = await import('../../src/modules/distribution/domain/offlineProjections.ts')
const { rejectedOperationStatusMessage } = await import('../../src/modules/distribution/domain/rejectedOperations.ts')
const projectId = 'demo-pachax-audit'
const env = await initializeTestEnvironment({
  projectId,
  firestore: { host, port: Number(port), rules: fs.readFileSync('firebase/firestore.rules', 'utf8') },
})
const adminApp = initializeApp({ projectId }, `fuel-expense-${Date.now()}`)
const adminDb = getFirestore(adminApp)
const root = adminDb.doc('restaurants/sanjose')
const uid = `daniel-qa-${randomUUID()}`
const routeId = `route-daniel-qa-${randomUUID()}`
const id = `fuel-23-${randomUUID()}`
const member = { role: 'distributor', active: true, routeId, displayName: 'Daniel QA' }
const payload = {
  presetId: 'fuel', amount: 23, paymentMethod: 'cash', routeId,
  routeName: 'Domingos QA', dayKey: '2026-10-30', note: 'GNV QA',
}
let passed = 0
const check = (value, label) => { assert(value, label); passed++; console.log(`PASS ${label}`) }
const operationRef = (firestore, operationId) => doc(firestore, 'restaurants', 'sanjose', 'distOperations', operationId)

try {
  await root.collection('members').doc(uid).set(member)
  await root.collection('distRoutes').doc(routeId).set({ id: routeId, name: 'Domingos QA', active: true })
  await root.collection('distExpenseGroups').doc('commercialization').set({ id: 'commercialization', name: 'Gastos de Comercialización', economicType: 'operating_expense', active: true })
  await root.collection('distExpenseCategories').doc('indirect-1').set({
    id: 'indirect-1', group: 'commercialization', name: 'Combustible', active: true,
    autoClassifiable: true, distributorVisible: true,
  })

  const authenticated = env.authenticatedContext(uid).firestore()
  const ref = operationRef(authenticated, id)
  let stop = () => {}
  const localQueued = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('No apareció la operación local pendiente')), 5000)
    stop = onSnapshot(ref, { includeMetadataChanges: true }, snapshot => {
      if (!snapshot.exists() || !snapshot.metadata.hasPendingWrites) return
      clearTimeout(timeout)
      resolve(snapshot.data())
    }, reject)
  })
  await disableNetwork(authenticated)
  const sync = setDoc(ref, { id, restaurantId: 'sanjose', createdBy: uid, createdAt: '2026-10-30T19:56:06.834Z', type: 'expense', payload, status: 'queued' })
  const localOperation = await localQueued
  check(localOperation.status === 'queued' && pendingExpensesFromOperations([
    { ...localOperation, id, type: 'expense', createdBy: uid, status: 'queued', payload }], []).length === 1,
  'desconectado, el egreso aparece explícitamente como pendiente local')
  await enableNetwork(authenticated)
  await sync
  stop()

  const serverOperation = root.collection('distOperations').doc(id)
  const synced = (await serverOperation.get()).data()
  check(synced?.status === 'queued' && synced.createdBy === uid, 'al reconectar se sincroniza una sola operación con el mismo ID')
  await processCommand(adminDb, serverOperation)
  const confirmedOperation = (await serverOperation.get()).data()
  const expense = (await root.collection('distExpenses').doc(id).get()).data()
  check(confirmedOperation.status === 'confirmed' && expense?.amount === 23 && expense?.paymentMethod === 'cash', 'el servidor confirma Bs 23 en efectivo y crea el egreso una sola vez')
  check(expense?.routeId === routeId && expense?.registeredByUid === uid && expense?.categoryId === 'indirect-1' && expense?.group === 'commercialization', 'el egreso conserva ruta, responsable y categoría/grupo vigentes')

  await processCommand(adminDb, serverOperation)
  check((await root.collection('distExpenses').where('operationId', '==', id).get()).size === 1, 'reprocesar la operación confirmada no duplica egresos ni movimientos de caja')

  const reauthenticated = env.authenticatedContext(uid).firestore()
  const visibleAfterLogin = await getDoc(doc(reauthenticated, 'restaurants', 'sanjose', 'distExpenses', id))
  check(visibleAfterLogin.exists() && visibleAfterLogin.data().amount === 23, 'el egreso permanece visible tras recargar y crear una sesión nueva')
  const routeAndDay = await getDocs(query(collection(reauthenticated, 'restaurants', 'sanjose', 'distExpenses'), where('registeredByUid', '==', uid), where('routeId', '==', routeId), where('dayKey', '==', '2026-10-30')))
  check(routeAndDay.docs.some(row => row.id === id), 'filtros de distribuidor, ruta y fecha incluyen el egreso registrado')
  const wrongRoute = await getDocs(query(collection(reauthenticated, 'restaurants', 'sanjose', 'distExpenses'), where('registeredByUid', '==', uid), where('routeId', '==', 'another-route'), where('dayKey', '==', '2026-10-30')))
  check(!wrongRoute.docs.some(row => row.id === id) && expense.group === 'commercialization' && expense.categoryName === 'Combustible', 'otra ruta no muestra el egreso y la categoría vigente sí corresponde al filtro')

  await root.collection('distExpenseCategories').doc('indirect-1').update({ active: false })
  const rejectedId = `${id}-rejected`
  const rejectedRef = operationRef(authenticated, rejectedId)
  await setDoc(rejectedRef, {
    id: rejectedId, restaurantId: 'sanjose', createdBy: uid, createdAt: '2026-10-30T20:02:29.233Z',
    type: 'expense', payload, status: 'queued',
  })
  const rejectedServerRef = root.collection('distOperations').doc(rejectedId)
  await processCommand(adminDb, rejectedServerRef)
  const rejected = (await rejectedServerRef.get()).data()
  check(rejected.status === 'rejected' && rejected.error.includes('ya no está activa') && !(await root.collection('distExpenses').doc(rejectedId).get()).exists,
    'una categoría realmente inactiva se rechaza con motivo y no genera un egreso')
  check(pendingExpensesFromOperations([{ ...rejected, id: rejectedId, type: 'expense', createdBy: uid, status: 'rejected', payload }], []).length === 0
    && rejectedOperationStatusMessage().includes('no quedó registrada'), 'un rechazo deja de proyectarse como pendiente y el aviso aclara que no se registró')

  console.log(`OK: ${passed} comprobaciones del egreso de combustible en Emulator`)
} finally {
  await env.cleanup()
  await adminApp.delete()
}
