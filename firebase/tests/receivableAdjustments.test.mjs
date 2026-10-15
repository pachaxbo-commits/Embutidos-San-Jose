// Pruebas focalizadas de ajustes auditados de cartera; solo usa Firestore Emulator.
import fs from 'node:fs'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { initializeTestEnvironment } from '@firebase/rules-unit-testing'
import { doc, getDoc, setDoc } from 'firebase/firestore'
import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing'

const require = createRequire(new URL('../../functions/package.json', import.meta.url))
process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8085'
process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9095'
const { initializeApp } = require('firebase-admin/app')
const { getFirestore } = require('firebase-admin/firestore')
const { processCommand } = require('./operations.cjs')
const projectId = 'demo-pachax-audit'
const app = initializeApp({ projectId }, `qa-receivable-adjustment-${Date.now()}`)
const db = getFirestore(app)
const root = db.doc('restaurants/sanjose')
const env = await initializeTestEnvironment({ projectId, firestore: { host: '127.0.0.1', port: 8085, rules: fs.readFileSync('firebase/firestore.rules', 'utf8') } })
const prefix = `ra${Date.now().toString(36)}`
const admin = `${prefix}-admin`, seller = `${prefix}-seller`, customer = `${prefix}-customer`
let passed = 0
const pass = (condition, label) => { assert(condition, label); passed++; console.log(`PASS: ${label}`) }
const read = async (collection, id) => (await root.collection(collection).doc(id).get()).data()
async function command(actor, type, payload, expected = 'confirmed') {
  const id = `${prefix}-${type}-${Math.random().toString(36).slice(2)}`
  await setDoc(doc(env.authenticatedContext(actor).firestore(), 'restaurants', 'sanjose', 'distOperations', id), { id, restaurantId: 'sanjose', createdBy: actor, createdAt: new Date().toISOString(), type, payload, status: 'queued' })
  await processCommand(db, root.collection('distOperations').doc(id))
  const result = await read('distOperations', id)
  assert.equal(result?.status, expected, `${type}: ${result?.error || 'sin procesar'}`)
  return { ...result, id }
}
const receivable = (id, overrides = {}) => ({
  id, restaurantId: 'sanjose', createdAt: '2026-10-15T10:00:00.000Z', createdBy: seller,
  customerId: customer, customerName: 'Cliente QA', routeId: 'route-qa', distributorUid: seller,
  distributorName: 'Vendedor QA', originalAmount: 200, paidAmount: 0, balance: 200, status: 'OPEN',
  sourceType: 'opening_balance', sourceDate: '2026-10-10', note: 'Deuda inicial', ...overrides,
})

try {
  await root.collection('members').doc(admin).set({ role: 'admin', active: true, displayName: 'Administración QA' })
  await root.collection('members').doc(seller).set({ role: 'distributor', active: true, routeId: 'route-qa', displayName: 'Vendedor QA' })
  await root.collection('distCustomers').doc(customer).set({ id: customer, restaurantId: 'sanjose', name: 'Cliente QA', active: true })

  const openId = `${prefix}-opening`
  await root.collection('distReceivables').doc(openId).set(receivable(openId))
  await command(admin, 'editReceivable', { receivableId: openId, originalAmount: 150, sourceDate: '2026-10-11', note: 'Saldo revisado', reason: 'Ajuste verificado', adjustedSaleLines: [] })
  const editedOpening = await read('distReceivables', openId)
  pass(editedOpening.originalAmount === 150 && editedOpening.balance === 150 && editedOpening.sourceDate === '2026-10-11', 'A: edita saldo anterior, fecha y descripción')
  const openingAudit = await root.collection('distReceivableAdjustments').where('receivableId', '==', openId).get()
  pass(openingAudit.size === 1 && openingAudit.docs[0].data().previous.originalAmount === 200 && openingAudit.docs[0].data().next.originalAmount === 150, 'auditoría conserva valores anteriores y nuevos')
  await assertSucceeds(getDoc(doc(env.authenticatedContext(admin).firestore(), 'restaurants', 'sanjose', 'distReceivableAdjustments', openingAudit.docs[0].id)))
  await assertFails(getDoc(doc(env.authenticatedContext(seller).firestore(), 'restaurants', 'sanjose', 'distReceivableAdjustments', openingAudit.docs[0].id)))
  pass(true, 'solo Administración puede consultar la auditoría de ajustes')
  await assertFails(setDoc(doc(env.authenticatedContext(seller).firestore(), 'restaurants', 'sanjose', 'distOperations', `${prefix}-seller-edit`), { id: `${prefix}-seller-edit`, restaurantId: 'sanjose', createdBy: seller, createdAt: new Date().toISOString(), type: 'editReceivable', payload: { receivableId: openId, originalAmount: 100, reason: 'No autorizado' }, status: 'queued' }))
  pass(true, 'Rules impiden al distribuidor siquiera encolar una edición de deuda')

  const saleId = `${prefix}-sale`, saleDebtId = `${prefix}-sale-debt`
  const saleLines = [
    { productId: 'a', productNameSnapshot: 'Producto A', quantity: 2, unitType: 'kg', actualUnitPrice: 50, subtotal: 100 },
    { productId: 'b', productNameSnapshot: 'Producto B', quantity: 1, unitType: 'kg', actualUnitPrice: 100, subtotal: 100 },
  ]
  await root.collection('distSales').doc(saleId).set({ id: saleId, restaurantId: 'sanjose', lines: saleLines, total: 200, creditAmount: 150 })
  await root.collection('distReceivables').doc(saleDebtId).set(receivable(saleDebtId, { sourceType: 'sale', saleId, originalAmount: 150, balance: 150, saleLines, note: '' }))
  await command(admin, 'editReceivable', { receivableId: saleDebtId, originalAmount: 150, reason: 'Reparto del crédito', adjustedSaleLines: [{ productId: 'a', creditAmount: 75 }, { productId: 'b', creditAmount: 75 }] })
  const saleDebt = await read('distReceivables', saleDebtId)
  pass(saleDebt.adjustedSaleLines.length === 2 && saleDebt.adjustedSaleLines.reduce((sum, line) => sum + line.creditAmount, 0) === saleDebt.originalAmount, 'B: venta conserva productos y registra reparto de crédito exacto')
  const saleAudit = await root.collection('distReceivableAdjustments').where('receivableId', '==', saleDebtId).get()
  pass(saleAudit.docs[0].data().previous.adjustedSaleLines.reduce((sum, line) => sum + line.creditAmount, 0) === 150, 'auditoría conserva también el reparto proporcional anterior')
  const mismatch = await command(admin, 'editReceivable', { receivableId: saleDebtId, originalAmount: 151, reason: 'Monto no cuadra', adjustedSaleLines: [{ productId: 'a', creditAmount: 75 }, { productId: 'b', creditAmount: 75 }] }, 'rejected')
  pass(/coincidir exactamente/i.test(mismatch.error), 'C: rechaza distribución de productos que no suma la deuda')

  const paidId = `${prefix}-paid`
  await root.collection('distReceivables').doc(paidId).set(receivable(paidId, { originalAmount: 200, paidAmount: 50, balance: 150, status: 'PARTIAL' }))
  await command(admin, 'editReceivable', { receivableId: paidId, originalAmount: 150, sourceDate: '2026-10-10', note: 'Deuda revisada', reason: 'Corrección de monto', adjustedSaleLines: [] })
  const paidEdited = await read('distReceivables', paidId)
  pass(paidEdited.paidAmount === 50 && paidEdited.balance === 100 && paidEdited.status === 'PARTIAL', 'D: reajusta saldo conservando lo ya cobrado')
  const underpaid = await command(admin, 'editReceivable', { receivableId: paidId, originalAmount: 40, sourceDate: '2026-10-10', note: 'Inválido', reason: 'No puede reducir', adjustedSaleLines: [] }, 'rejected')
  pass(/menor que lo ya cobrado/i.test(underpaid.error), 'E: rechaza reducir la deuda por debajo de lo cobrado')

  const voidId = `${prefix}-void`
  const untouchedSale = { id: `${prefix}-untouched-sale`, restaurantId: 'sanjose', total: 70, lines: [{ productId: 'a', quantity: 1 }] }
  await root.collection('distSales').doc(untouchedSale.id).set(untouchedSale)
  await root.collection('distBalances').doc(`route__route-qa__a`).set({ id: 'route__route-qa__a', restaurantId: 'sanjose', productId: 'a', locationId: 'route-qa', quantity: 7 })
  await root.collection('distReceivables').doc(voidId).set(receivable(voidId, { sourceType: 'sale', saleId: untouchedSale.id, saleLines, note: '' }))
  await command(admin, 'voidReceivable', { receivableId: voidId, reason: 'Registro duplicado', confirmationText: 'ELIMINAR DEUDA' })
  const voided = await read('distReceivables', voidId)
  pass(voided.voided === true && voided.balance === 0 && voided.status === 'VOID' && voided.voidReason === 'Registro duplicado', 'F: anula de forma blanda y audita el motivo')
  pass((await read('distSales', untouchedSale.id)).total === 70, 'H: anular deuda no modifica la venta relacionada')
  pass((await read('distBalances', 'route__route-qa__a')).quantity === 7, 'H: anular deuda no mueve ni devuelve stock')
  const badPhrase = await command(admin, 'voidReceivable', { receivableId: saleDebtId, reason: 'No debe borrar', confirmationText: 'eliminar deuda' }, 'rejected')
  pass(/confirmación no coincide/i.test(badPhrase.error), 'J: exige frase de confirmación exacta')
  const missingReason = await command(admin, 'voidReceivable', { receivableId: saleDebtId, reason: '  ', confirmationText: 'ELIMINAR DEUDA' }, 'rejected')
  pass(/motivo de anulación/i.test(missingReason.error), 'J: exige motivo obligatorio')
  const alreadyPaid = `${prefix}-void-paid`
  await root.collection('distReceivables').doc(alreadyPaid).set(receivable(alreadyPaid, { paidAmount: 10, balance: 190, status: 'PARTIAL' }))
  const blockedVoid = await command(admin, 'voidReceivable', { receivableId: alreadyPaid, reason: 'No procede', confirmationText: 'ELIMINAR DEUDA' }, 'rejected')
  pass(/ya tiene cobros/i.test(blockedVoid.error), 'G: bloquea anulación si hay pagos aplicados')
  const deniedId = `${prefix}-unauthorized-edit`
  const deniedRef = root.collection('distOperations').doc(deniedId)
  await deniedRef.set({ id: deniedId, restaurantId: 'sanjose', createdBy: seller, createdAt: new Date().toISOString(), type: 'editReceivable', payload: { receivableId: saleDebtId, originalAmount: 120, reason: 'Intento no autorizado', adjustedSaleLines: [{ productId: 'a', creditAmount: 60 }, { productId: 'b', creditAmount: 60 }] }, status: 'queued' })
  await processCommand(db, deniedRef)
  const denied = await read('distOperations', deniedId)
  pass(/Administración/i.test(denied.error), 'K: distribuidor no puede editar deudas')
  console.log(`${passed} comprobaciones de ajustes de cartera aprobadas`)
} finally {
  await env.cleanup()
  await app.delete()
}
