// All writes are confined to the Firestore emulator.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8085'
const req = createRequire(new URL('../../functions/package.json', import.meta.url))
const { initializeApp } = req('firebase-admin/app')
const { getFirestore } = req('firebase-admin/firestore')
const { processCommand } = req('./operations.cjs')
const projectId = 'demo-pachax-audit'
const app = initializeApp({ projectId }, `expense-auto-${Date.now()}`)
const db = getFirestore(app)
const root = db.doc('restaurants/sanjose')
const prefix = `expense-auto-${Date.now().toString(36)}`
const admin = `${prefix}-admin`
const seller = `${prefix}-seller`
const route = `${prefix}-route`
let checks = 0
const ok = (value, message) => { assert(value, message); checks++; console.log('PASS', message) }

async function run(actor, type, payload, expectedStatus = 'confirmed') {
  const id = `${prefix}-${Math.random().toString(36).slice(2)}`
  const ref = root.collection('distOperations').doc(id)
  await ref.set({ id, restaurantId: 'sanjose', createdBy: actor, createdAt: new Date().toISOString(), type, payload, status: 'queued' })
  await processCommand(db, ref)
  const result = (await ref.get()).data()
  assert.equal(result.status, expectedStatus, result.error || `${type} no terminó en ${expectedStatus}`)
  return { id, ...result }
}

try {
  await root.collection('members').doc(admin).set({ role: 'admin', active: true, displayName: 'QA Administración' })
  await root.collection('members').doc(seller).set({ role: 'distributor', active: true, routeId: route, displayName: 'QA Distribuidor' })

  const automaticCases = [
    ['fuel', 'indirect', 'indirect-1', 'operating_expense'],
    ['toll_parking', 'indirect', 'indirect-7', 'operating_expense'],
    ['refreshments_travel', 'indirect', 'indirect-8', 'operating_expense'],
    ['maintenance_repair', 'indirect', 'indirect-9', 'operating_expense'],
    ['tools_equipment', 'equipment', 'equipment-6', 'operating_expense'],
    ['production_meat', 'production_input', 'production_input-1', 'production_input'],
    ['production_seasonings', 'production_input', 'production_input-2', 'production_input'],
    ['production_casings', 'production_input', 'production_input-3', 'production_input'],
    ['production_supplies', 'production_input', 'production_input-4', 'production_input'],
    ['production_other', 'production_input', 'production_input-5', 'production_input'],
  ]
  for (const [presetId, group, categoryId, economicType] of automaticCases) {
    const op = await run(seller, 'expense', { presetId, amount: 10, paymentMethod: 'cash', routeId: route, routeName: 'Ruta QA' })
    const expense = (await root.collection('distExpenses').doc(op.id).get()).data()
    ok(expense.group === group && expense.categoryId === categoryId && expense.economicType === economicType && expense.classificationStatus === 'classified' && expense.classificationSource === 'automatic', `${presetId} se resuelve con clasificación segura del servidor`)
    ok(expense.affectsOperatingResult === (economicType === 'operating_expense'), `${presetId} no permite doble conteo de materia prima`)
  }

  const badDetail = await run(seller, 'expense', { presetId: 'other_unsure', amount: 30, paymentMethod: 'cash', routeId: route, routeName: 'Ruta QA' }, 'rejected')
  ok(Boolean(badDetail.error), 'Otro sin detalle obligatorio se rechaza')
  const other = await run(seller, 'expense', { presetId: 'other_unsure', amount: 30, paymentMethod: 'cash', routeId: route, routeName: 'Ruta QA', note: 'Compra urgente de repuesto' })
  const otherExpense = (await root.collection('distExpenses').doc(other.id).get()).data()
  ok(otherExpense.classificationStatus === 'pending_review' && otherExpense.classificationSource === 'user_pending' && otherExpense.affectsOperatingResult === true, 'Otro queda pendiente y afecta caja/resultado provisionalmente')

  await run(seller, 'expense', { presetId: 'fuel', amount: 10, routeId: route, routeName: 'Ruta QA', economicType: 'production_input', affectsOperatingResult: false }, 'rejected')
  await run(seller, 'expense', { presetId: 'category:forged', amount: 10, routeId: route, routeName: 'Ruta QA' }, 'rejected')
  ok(true, 'el servidor rechaza clasificación económica falsificada y categorías no autorizadas')

  const customId = `${prefix}-custom`
  await run(admin, 'saveExpenseCategory', { categoryId: customId, group: 'production_input', name: 'Insumo QA', active: true, order: 999, autoClassifiable: true, distributorVisible: false })
  await run(seller, 'expense', { presetId: `category:${customId}`, amount: 9, routeId: route, routeName: 'Ruta QA' }, 'rejected')
  const adminOnly = await run(admin, 'expense', { presetId: `category:${customId}`, amount: 9, routeId: 'administracion', routeName: 'Administración' })
  ok((await root.collection('distExpenses').doc(adminOnly.id).get()).data().classificationSource === 'automatic', 'Administración puede usar una categoría automática aún no visible para distribuidores')
  await run(admin, 'saveExpenseCategory', { categoryId: customId, group: 'production_input', name: 'Insumo QA', active: true, order: 999, autoClassifiable: true, distributorVisible: true })
  const custom = await run(seller, 'expense', { presetId: `category:${customId}`, amount: 9, routeId: route, routeName: 'Ruta QA' })
  const customExpense = (await root.collection('distExpenses').doc(custom.id).get()).data()
  ok(customExpense.group === 'production_input' && customExpense.affectsOperatingResult === false && customExpense.classificationSource === 'automatic', 'categoría personalizada solo es distribuible con habilitación explícita')

  const legacy = await run(seller, 'expense', { concept: 'Combustible', amount: 11, group: 'indirect', categoryId: 'indirect-1', economicType: 'operating_expense', affectsOperatingResult: true, routeId: route, routeName: 'Ruta QA' })
  const legacyExpense = (await root.collection('distExpenses').doc(legacy.id).get()).data()
  ok(legacyExpense.group === 'other' && legacyExpense.categoryId === 'other-2' && legacyExpense.classificationStatus === 'pending_review' && legacyExpense.classificationSource === 'legacy', 'payloads de versiones anteriores no confían en categoría implícita y pasan a revisión')

  const corrected = await run(admin, 'classifyExpense', { expenseId: other.id, group: 'production_input', categoryId: 'production_input-1', economicType: 'production_input' })
  const correctedExpense = (await root.collection('distExpenses').doc(other.id).get()).data()
  ok(correctedExpense.classificationStatus === 'reviewed' && correctedExpense.classificationSource === 'admin_review' && correctedExpense.classificationHistory[0].previous.classificationStatus === 'pending_review' && correctedExpense.classificationHistory[0].next.classificationSource === 'admin_review', 'reclasificar un pendiente conserva el antes/después en auditoría')
  ok(corrected.result.classificationStatus === 'reviewed', 'la respuesta de revisión administrativa refleja estado revisado')

  console.log(`${checks} comprobaciones aprobadas`)
} finally {
  await app.delete()
}
