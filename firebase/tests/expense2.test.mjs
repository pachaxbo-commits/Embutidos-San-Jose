// All writes are confined to the Firestore emulator. Never point this suite at production.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing'
import { doc, getDoc, setDoc } from 'firebase/firestore'

process.env.FIRESTORE_EMULATOR_HOST ||= '127.0.0.1:8085'
const [emulatorHost, emulatorPort] = process.env.FIRESTORE_EMULATOR_HOST.split(':')
const req = createRequire(new URL('../../functions/package.json', import.meta.url))
const { initializeApp } = req('firebase-admin/app')
const { getFirestore } = req('firebase-admin/firestore')
const { processCommand } = req('./operations.cjs')
const projectId = 'demo-pachax-audit'
const env = await initializeTestEnvironment({ projectId, firestore: { host: emulatorHost, port: Number(emulatorPort), rules: fs.readFileSync('firebase/firestore.rules', 'utf8') } })
const adminApp = initializeApp({ projectId }, `expense2-${Date.now()}`)
const db = getFirestore(adminApp)
const root = db.doc('restaurants/sanjose')
const prefix = `expense2-${Date.now().toString(36)}`
const admin = `${prefix}-admin`, distributor = `${prefix}-seller`, warehouse = `${prefix}-warehouse`, outsider = `${prefix}-outsider`, routeId = `${prefix}-route`
let checks = 0
const ok = (condition, message) => { assert(condition, message); checks++; console.log(`PASS ${message}`) }
const read = async (collection, id) => (await root.collection(collection).doc(id).get()).data()
async function command(actor, type, payload, expected = 'confirmed', fixedId) {
  const id = fixedId || `${prefix}-${type}-${Math.random().toString(36).slice(2)}`
  const ref = root.collection('distOperations').doc(id)
  await ref.set({ id, restaurantId: 'sanjose', createdBy: actor, createdAt: new Date().toISOString(), type, payload, status: 'queued' })
  console.log(`RUN ${type}`)
  await processCommand(db, ref)
  const result = (await ref.get()).data()
  assert.equal(result.status, expected, result.error || `${type}: estado inesperado`)
  return { id, ...result }
}
async function enqueueCommand(actor, type, payload, fixedId) {
  const id = fixedId || `${prefix}-${type}-${Math.random().toString(36).slice(2)}`
  const ref = root.collection('distOperations').doc(id)
  await ref.set({ id, restaurantId: 'sanjose', createdBy: actor, createdAt: new Date().toISOString(), type, payload, status: 'queued' })
  return { id, ref }
}
async function queuedFrom(uid, type, payload) {
  const id = `${prefix}-rules-${type}-${Math.random().toString(36).slice(2)}`
  const ref = doc(env.authenticatedContext(uid).firestore(), 'restaurants', 'sanjose', 'distOperations', id)
  return setDoc(ref, { id, restaurantId: 'sanjose', createdBy: uid, createdAt: new Date().toISOString(), type, payload, status: 'queued' })
}

try {
  await root.collection('members').doc(admin).set({ role: 'admin', active: true, displayName: 'QA Admin' })
  await root.collection('members').doc(distributor).set({ role: 'distributor', active: true, routeId, displayName: 'QA Distribuidor' })
  await root.collection('members').doc(warehouse).set({ role: 'warehouse', active: true, warehouseId: `${prefix}-wh` })
  await root.collection('distRoutes').doc(routeId).set({ id: routeId, name: 'Ruta QA', active: true })

  // Security Rules are tested with authenticated client SDKs, not the Admin SDK.
  for (const type of ['saveExpenseGroup', 'deleteExpenseGroup', 'saveExpenseCategory', 'deleteExpenseCategory', 'saveExpenseSupplier', 'paySupplierPayable', 'voidSupplierPayment', 'voidSupplierPurchase']) {
    await assertSucceeds(queuedFrom(admin, type, { sample: true })); checks++
    await assertFails(queuedFrom(warehouse, type, { sample: true })); checks++
    await assertFails(queuedFrom(distributor, type, { sample: true })); checks++
    await assertFails(queuedFrom(outsider, type, { sample: true })); checks++
  }
  await assertSucceeds(queuedFrom(admin, 'registerSupplierPurchase', { sample: true })); checks++
  await assertFails(queuedFrom(warehouse, 'registerSupplierPurchase', { sample: true })); checks++
  await assertSucceeds(queuedFrom(distributor, 'registerSupplierPurchase', { sample: true })); checks++
  const adminDb = env.authenticatedContext(admin).firestore()
  for (const collection of ['distExpenseGroups', 'distSuppliers', 'distPayables', 'distSupplierPayments']) {
    await assertFails(setDoc(doc(adminDb, 'restaurants', 'sanjose', collection, `${prefix}-direct`), { id: `${prefix}-direct` })); checks++
  }
  ok(true, 'solo Administración puede encolar operaciones de Egresos 2.0; escrituras directas permanecen bloqueadas')

  const groupId = `custom-${prefix}-ingredients`
  const group = await command(admin, 'saveExpenseGroup', { groupId, name: `Materias de prueba ${prefix}`, economicType: 'production_input', active: true, order: 100 })
  ok(group.result.id === groupId && group.result.economicType === 'production_input', 'grupo personalizado conserva ID estable y clasificación económica explícita')
  const renamedGroupName = `Insumos QA ${prefix}`
  const renamed = await command(admin, 'saveExpenseGroup', { groupId, name: renamedGroupName, economicType: 'production_input', active: true, order: 2 })
  ok(renamed.result.id === groupId && (await read('distExpenseGroups', groupId)).name === renamedGroupName, 'renombrar no rompe el identificador del grupo')
  await command(admin, 'saveExpenseGroup', { groupId: `custom-${prefix}-duplicate`, name: renamedGroupName, economicType: 'operating_expense', active: true, order: 3 }, 'rejected')
  ok(true, 'el servidor impide grupos activos duplicados por nombre')
  const categoryId = `${prefix}-flour`
  await command(admin, 'saveExpenseCategory', { categoryId, group: groupId, name: 'Harina QA', active: true, order: 1 })
  const supplierId = `${prefix}-supplier`
  const supplierName = `Proveedor QA ${prefix}`
  const supplier = await command(admin, 'saveExpenseSupplier', { supplierId, name: supplierName, legalName: `Razón social ${prefix}`, nit: '00123-0000456', address: 'Av. QA 123', contactName: 'Contacto QA', phone: '+591 70000000', email: 'proveedor@example.test', note: 'Registro sintético', active: true })
  ok(supplier.result.legalName === `Razón social ${prefix}` && supplier.result.nit === '00123-0000456' && (await read('distSuppliers', supplierId)).address === 'Av. QA 123', 'proveedor persiste razón social, NIT textual con cero inicial y dirección')
  await command(admin, 'saveExpenseSupplier', { supplierId, name: supplierName, phone: '+591 71111111', active: true })
  const updatedSupplier = await read('distSuppliers', supplierId)
  ok(updatedSupplier.nit === '00123-0000456' && updatedSupplier.legalName === `Razón social ${prefix}` && updatedSupplier.phone === '+591 71111111' && updatedSupplier.updatedBy === admin, 'editar proveedor conserva campos omitidos y audita responsable/fecha')
  await command(admin, 'saveExpenseSupplier', { supplierId: `${prefix}-invalid-supplier`, name: 'Proveedor QA inválido', nit: 'NIT ? inv@lido', email: 'correo-invalido', active: true }, 'rejected')

  const directAdminExpense = await command(admin, 'expense', { presetId: `group-category:${categoryId}`, groupId, amount: 50, paymentMethod: 'cash', routeId: 'administracion', routeName: 'Administración', concept: 'Harina para lote QA' })
  ok(directAdminExpense.result.group === groupId && directAdminExpense.result.categoryId === categoryId && directAdminExpense.result.economicType === 'production_input' && directAdminExpense.result.classificationStatus === 'reviewed' && directAdminExpense.result.classificationSource === 'admin_review', 'categoría administrativa personalizada se registra directamente con clasificación revisada')
  const defaultAdminExpense = await command(admin, 'expense', { presetId: 'admin-category:administration-5', amount: 12, routeId: 'administracion', routeName: 'Administración', concept: 'Limpieza del local' })
  ok(defaultAdminExpense.result.categoryId === 'administration-5' && defaultAdminExpense.result.economicType === 'operating_expense' && defaultAdminExpense.result.classificationStatus === 'reviewed', 'Administración puede elegir una categoría inicial sin documento de override')
  const maintenanceCreditId = `${prefix}-maintenance-credit`
  const maintenanceCredit = await command(admin, 'expense', { presetId: 'admin-category:administration-4', amount: 100, paymentMethod: 'credit', supplierId, dayKey: '2026-10-30', dueDayKey: '2026-11-15', purchaseReceiptType: 'receipt', purchaseReceiptNumber: 'MANT-0007', routeId: 'administracion', routeName: 'Administración', note: 'Mantenimiento eléctrico de ventana' }, 'confirmed', maintenanceCreditId)
  const maintenancePayable = await read('distPayables', maintenanceCreditId)
  const maintenanceExpense = await read('distExpenses', maintenanceCreditId)
  ok(maintenanceCredit.result.paymentMethod === 'credit' && maintenanceExpense.amount === 100 && maintenanceExpense.cashPaidAmount === 0 && maintenanceExpense.transferPaidAmount === 0 && maintenanceExpense.payableId === maintenanceCreditId, 'egreso operativo a crédito registra Bs 100 y no descuenta efectivo ni QR')
  ok(maintenancePayable.sourceKind === 'operating_expense' && maintenancePayable.economicType === 'operating_expense' && maintenancePayable.balance === 100 && maintenancePayable.status === 'pending' && maintenancePayable.dueDayKey === '2026-11-15' && maintenancePayable.purchaseReceiptNumber === 'MANT-0007', 'la deuda operativa queda en Cuentas por pagar con proveedor, vencimiento y comprobante')
  const adminReader = env.authenticatedContext(admin).firestore()
  ok((await getDoc(doc(adminReader, 'restaurants', 'sanjose', 'distPayables', maintenanceCreditId))).exists(), 'Administración puede volver a consultar la obligación confirmada')
  await command(admin, 'deleteExpense', { expenseId: maintenanceCreditId, reason: 'No debe anularse fuera de Cuentas por pagar' }, 'rejected')
  const maintenancePaymentId = `${prefix}-maintenance-payment`
  const maintenancePayment = await command(admin, 'paySupplierPayable', { payableId: maintenanceCreditId, amount: 40, paymentMethod: 'cash', dayKey: '2026-10-31', note: 'Abono de mantenimiento QA' }, 'confirmed', maintenancePaymentId)
  const maintenancePaymentExpense = await read('distExpenses', maintenancePayment.result.payment.id)
  ok(maintenancePayment.result.payable.paidAmount === 40 && maintenancePayment.result.payable.balance === 60 && maintenancePaymentExpense.cashPaidAmount === 40 && maintenanceExpense.amount === 100, 'abonar Bs 40 deja Bs 60 y registra solo la salida real, sin repetir el gasto original')
  await processCommand(db, root.collection('distOperations').doc(maintenancePaymentId))
  ok((await root.collection('distSupplierPayments').where('payableId', '==', maintenanceCreditId).get()).size === 1 && (await read('distPayables', maintenanceCreditId)).balance === 60, 'reintentar el mismo abono no crea duplicados ni modifica de nuevo el saldo')
  const maintenanceFinalPayment = await command(admin, 'paySupplierPayable', { payableId: maintenanceCreditId, amount: 60, paymentMethod: 'transfer', dayKey: '2026-11-02' }, 'confirmed', `${prefix}-maintenance-payment-final`)
  ok(maintenanceFinalPayment.result.payable.status === 'paid' && maintenanceFinalPayment.result.payable.balance === 0 && (await read('distExpenses', maintenanceCreditId)).amount === 100, 'pagar el saldo restante cierra la cuenta y conserva un único egreso de Bs 100')

  const voidableOperatingExpenseId = `${prefix}-maintenance-credit-voidable`
  await command(admin, 'expense', { presetId: 'admin-category:administration-4', amount: 75, paymentMethod: 'credit', supplierId, dayKey: '2026-10-30', routeId: 'administracion', routeName: 'Administración', note: 'Mantenimiento QA anulable' }, 'confirmed', voidableOperatingExpenseId)
  const voidableOperatingPayment = await command(admin, 'paySupplierPayable', { payableId: voidableOperatingExpenseId, amount: 25, paymentMethod: 'transfer', dayKey: '2026-10-31', note: 'Abono QA anulable' }, 'confirmed', `${prefix}-maintenance-credit-payment`)
  await command(admin, 'voidSupplierPurchase', { payableId: voidableOperatingExpenseId, reason: 'Primero debe corregirse el abono' }, 'rejected')
  const voidedOperatingPayment = await command(admin, 'voidSupplierPayment', { paymentId: voidableOperatingPayment.result.payment.id, reason: 'Corrección de abono operativo QA' }, 'confirmed', `${prefix}-maintenance-credit-payment-void`)
  const restoredOperatingPayable = await read('distPayables', voidableOperatingExpenseId)
  const restoredOperatingExpense = await read('distExpenses', voidableOperatingExpenseId)
  ok(voidedOperatingPayment.result.payable.balance === 75 && restoredOperatingPayable.paidAmount === 0 && restoredOperatingExpense.voided !== true && (await read('distSupplierPayments', voidableOperatingPayment.result.payment.id)).voided === true, 'corregir un abono de egreso operativo restaura la deuda y conserva el gasto hasta su anulación explícita')
  const voidedOperatingExpense = await command(admin, 'voidSupplierPurchase', { payableId: voidableOperatingExpenseId, reason: 'Mantenimiento cancelado en QA' }, 'confirmed', `${prefix}-maintenance-credit-void`)
  ok(voidedOperatingExpense.result.status === 'voided' && (await read('distPayables', voidableOperatingExpenseId)).status === 'voided' && (await read('distExpenses', voidableOperatingExpenseId)).voided === true, 'tras corregir sus pagos se puede anular la cuenta por pagar operativa con historial')

  await command(distributor, 'expense', { presetId: 'fuel', amount: 100, paymentMethod: 'credit', supplierId, routeId, routeName: 'Ruta QA' }, 'rejected')
  await command(admin, 'expense', { presetId: 'admin-category:administration-4', amount: 100, paymentMethod: 'credit', supplierId: `${prefix}-missing-supplier`, routeId: 'administracion', routeName: 'Administración' }, 'rejected')
  await command(admin, 'expense', { presetId: `group-category:${categoryId}`, groupId, amount: 350, paymentMethod: 'credit', supplierId, routeId: 'administracion', routeName: 'Administración', concept: 'Compra de producción sin detalle' }, 'rejected')
  ok(true, 'el crédito operativo requiere Administración y un proveedor activo; Distribuidores no pueden crear deudas')
  await command(distributor, 'expense', { presetId: `group-category:${categoryId}`, groupId, amount: 50, routeId, routeName: 'Ruta QA', concept: 'Payload manipulado' }, 'rejected')
  await command(admin, 'saveExpenseCategory', { categoryId, group: groupId, name: 'Harina QA', active: false, order: 1 })
  await command(admin, 'expense', { presetId: `group-category:${categoryId}`, groupId, amount: 50, routeId: 'administracion', routeName: 'Administración', concept: 'Categoría inactiva' }, 'rejected')
  ok(true, 'categoría administrativa requiere grupo activo; distribuidores no pueden enviar clasificación manual')
  await command(admin, 'saveExpenseCategory', { categoryId, group: groupId, name: 'Harina QA', active: true, order: 1 })

  const purchaseId = `${prefix}-purchase-credit`
  const purchaseLines = [{ description: 'Carne QA', quantity: 100, unit: 'kg', unitPrice: 20, total: 2_000, wasteQuantity: 3, netUsableQuantity: 97 }]
  const creditPurchase = await command(admin, 'registerSupplierPurchase', { supplierId, groupId, categoryId, description: 'Materia prima a crédito', amount: 2_000, initialPayment: 0, paymentMethod: 'cash', dayKey: '2026-10-20', purchaseReceiptType: 'invoice', purchaseReceiptNumber: '000-001-0000789', purchaseLines }, 'confirmed', purchaseId)
  const payableId = creditPurchase.result.payable.id
  ok((await read('distPayables', payableId)).balance === 2_000 && (await read('distExpenses', purchaseId)).cashPaidAmount === 0, 'compra de Bs 2.000 a crédito crea cuenta por pagar sin salida de caja')
  ok((await read('distExpenses', purchaseId)).amount === 2_000 && (await read('distExpenses', purchaseId)).purchaseLines[0].wasteQuantity === 3 && (await read('distExpenses', purchaseId)).purchaseLines[0].netUsableQuantity === 97 && (await read('distPayables', payableId)).purchaseLines[0].total === 2_000, 'detalle conserva cantidad, unidad, precio, merma y neto sin reducir total ni duplicar inventario')
  ok((await read('distExpenses', purchaseId)).purchaseReceiptNumber === '000-001-0000789' && (await read('distPayables', payableId)).purchaseReceiptType === 'invoice', 'factura y serie con ceros iniciales quedan vinculadas a la compra y su cuenta por pagar')
  await command(admin, 'registerSupplierPurchase', { supplierId, groupId, categoryId, description: 'Comprobante mal tipado', amount: 10, initialPayment: 0, paymentMethod: 'cash', dayKey: '2026-10-20', purchaseReceiptType: 'tax', purchaseReceiptNumber: '10' }, 'rejected')
  await command(admin, 'registerSupplierPurchase', { supplierId, groupId, categoryId, description: 'Número sin tipo', amount: 10, initialPayment: 0, paymentMethod: 'cash', dayKey: '2026-10-20', purchaseReceiptNumber: '10' }, 'rejected')
  await command(admin, 'registerSupplierPurchase', { supplierId, groupId, categoryId, description: 'Línea inconsistente QA', amount: 2_000, initialPayment: 0, paymentMethod: 'cash', dayKey: '2026-10-20', purchaseLines: [{ ...purchaseLines[0], wasteQuantity: 101, netUsableQuantity: -1 }] }, 'rejected')
  await command(admin, 'registerSupplierPurchase', { supplierId, groupId, categoryId, description: 'Total inconsistente QA', amount: 1_999, initialPayment: 0, paymentMethod: 'cash', dayKey: '2026-10-20', purchaseLines }, 'rejected')
  const purchaseDocs = await root.collection('distExpenses').where('supplierId', '==', supplierId).get()
  const balanceDocs = await root.collection('distBalances').where('productId', '==', `${prefix}-product`).get()
  ok(purchaseDocs.docs.filter(row => row.data().transactionKind === 'supplier_purchase').length === 1 && balanceDocs.empty, 'compra financiera no crea inventario ni duplica la compra económica')

  const partialId = `${prefix}-purchase-partial`
  const partial = await command(admin, 'registerSupplierPurchase', { supplierId, groupId, categoryId, description: 'Compra parcial', amount: 500, initialPayment: 200, paymentMethod: 'transfer', dayKey: '2026-10-21' }, 'confirmed', partialId)
  ok(partial.result.payable.balance === 300 && partial.result.payable.paidAmount === 200 && (await read('distExpenses', partialId)).transferPaidAmount === 200, 'adelanto QR/transferencia reduce deuda sin descontar efectivo')
  ok(!(await read('distPayables', partialId)).purchaseReceiptNumber, 'compra histórica/sin comprobante continúa válida y sin número inventado')

  const cashPurchaseId = `${prefix}-purchase-cash`
  const cashPurchase = await command(admin, 'registerSupplierPurchase', { supplierId, groupId, categoryId, description: 'Compra pagada en efectivo', amount: 1_000, initialPayment: 1_000, paymentMethod: 'cash', dayKey: '2026-10-21' }, 'confirmed', cashPurchaseId)
  ok(cashPurchase.result.payable.balance === 0 && (await read('distExpenses', cashPurchaseId)).cashPaidAmount === 1_000, 'compra de Bs 1.000 pagada en efectivo registra el costo una vez y la salida efectiva sin dejar deuda')
  const qrPurchaseId = `${prefix}-purchase-qr`
  const qrPurchase = await command(admin, 'registerSupplierPurchase', { supplierId, groupId, categoryId, description: 'Compra pagada por transferencia', amount: 250, initialPayment: 250, paymentMethod: 'transfer', dayKey: '2026-10-21' }, 'confirmed', qrPurchaseId)
  ok(qrPurchase.result.payable.balance === 0 && (await read('distExpenses', qrPurchaseId)).transferPaidAmount === 250 && (await read('distExpenses', qrPurchaseId)).cashPaidAmount === 0, 'compra pagada por QR/transferencia no se confunde con efectivo')
  const supplierTwoId = `${prefix}-supplier-two`
  await command(admin, 'saveExpenseSupplier', { supplierId: supplierTwoId, name: `Carnicería QA ${prefix}`, active: true })
  const porkLine = [{ description: 'Carne de cerdo', quantity: 10, unit: 'kg', unitPrice: 35, total: 350, wasteQuantity: 0, netUsableQuantity: 10 }]
  const porkCashId = `${prefix}-pork-cash`
  const porkCash = await command(admin, 'registerSupplierPurchase', { supplierId, groupId, categoryId, description: 'Carne de cerdo', amount: 350, initialPayment: 350, paymentMethod: 'cash', dayKey: '2026-10-30', purchaseLines: porkLine }, 'confirmed', porkCashId)
  ok(porkCash.result.payable.status === 'paid' && porkCash.result.payable.balance === 0 && (await read('distExpenses', porkCashId)).purchaseLines[0].quantity === 10 && (await read('distExpenses', porkCashId)).purchaseLines[0].unitPrice === 35 && (await read('distExpenses', porkCashId)).cashPaidAmount === 350, 'compra al contado de 10 kg × Bs 35 registra Bs 350 pagados y conserva precio/unidad')
  const porkCreditId = `${prefix}-pork-credit`
  const porkCredit = await command(admin, 'registerSupplierPurchase', { supplierId: supplierTwoId, groupId, categoryId, description: 'Carne de cerdo a crédito', amount: 350, initialPayment: 0, paymentMethod: 'credit', dayKey: '2026-10-30', dueDayKey: '2026-11-10', purchaseLines: porkLine }, 'confirmed', porkCreditId)
  ok(porkCredit.result.payable.balance === 350 && porkCredit.result.payable.paidAmount === 0 && porkCredit.result.payable.supplierId === supplierTwoId && (await read('distExpenses', porkCreditId)).cashPaidAmount === 0, 'compra de carne a crédito conserva proveedor distinto y no sale dinero al registrarse')
  const porkPartialId = `${prefix}-pork-partial`
  const porkPartial = await command(admin, 'registerSupplierPurchase', { supplierId: supplierTwoId, groupId, categoryId, description: 'Carne de cerdo con pago parcial', amount: 350, initialPayment: 100, paymentMethod: 'cash', dayKey: '2026-10-30', purchaseLines: porkLine }, 'confirmed', porkPartialId)
  ok(porkPartial.result.payable.totalAmount === 350 && porkPartial.result.payable.paidAmount === 100 && porkPartial.result.payable.balance === 250 && (await read('distExpenses', porkPartialId)).cashPaidAmount === 100, 'compra parcial de Bs 350 registra Bs 100 pagados y Bs 250 pendientes')
  const porkPartialPay = await command(admin, 'paySupplierPayable', { payableId: porkPartialId, amount: 40, paymentMethod: 'cash', dayKey: '2026-11-01' })
  ok(porkPartialPay.result.payable.balance === 210 && (await read('distExpenses', porkPartialPay.result.payment.id)).cashPaidAmount === 40, 'abono posterior a compra parcial descuenta caja una sola vez y conserva el saldo')
  const noStock = await root.collection('distBalances').where('productId', '==', 'Carne de cerdo').get()
  ok(noStock.empty, 'ninguna modalidad de compra crea existencias o modifica Kardex automáticamente')

  const paymentOperationId = `${prefix}-pay-800`
  const payment = await command(admin, 'paySupplierPayable', { payableId, amount: 800, paymentMethod: 'cash', dayKey: '2026-10-27', note: 'Abono QA' }, 'confirmed', paymentOperationId)
  ok(payment.result.payable.balance === 1_200 && payment.result.payable.paidAmount === 800, 'abono posterior actualiza saldo de cuenta por pagar')
  await processCommand(db, root.collection('distOperations').doc(paymentOperationId))
  const supplierPayments = await root.collection('distSupplierPayments').where('payableId', '==', payableId).get()
  const supplierPaymentExpenses = await root.collection('distExpenses').where('payableId', '==', payableId).get()
  ok(supplierPayments.size === 1 && supplierPaymentExpenses.size === 1 && (await read('distPayables', payableId)).balance === 1_200, 'reintentar la misma operación de pago no duplica movimiento ni vuelve a aplicar el saldo')
  ok((await read('distPayables', payableId)).purchaseReceiptNumber === '000-001-0000789' && (await read('distExpenses', purchaseId)).purchaseReceiptNumber === '000-001-0000789', 'abonar la deuda no altera el comprobante documental de la compra original')
  await command(admin, 'paySupplierPayable', { payableId, amount: 1_201, paymentMethod: 'cash', dayKey: '2026-10-27' }, 'rejected')
  const paymentExpense = supplierPaymentExpenses.docs[0].data()
  const paymentId = payment.result.payment.id
  ok(paymentExpense.transactionKind === 'supplier_payment' && paymentExpense.economicType === 'production_input' && paymentExpense.cashPaidAmount === 800, 'pago posterior solo representa salida de efectivo, no segundo costo de producción')
  await command(admin, 'deleteExpense', { expenseId: purchaseId, reason: 'Intento de usar anulación genérica' }, 'rejected')
  await command(admin, 'classifyExpense', { expenseId: purchaseId, group: 'administration', categoryId: 'administration-1', economicType: 'operating_expense' }, 'rejected')
  await command(admin, 'deleteExpense', { expenseId: paymentId, reason: 'Intento de borrar pago' }, 'rejected')
  ok(true, 'compras y pagos de proveedor no se pueden reclasificar ni anular mediante herramientas de egreso genéricas')

  await command(admin, 'deleteExpenseCategory', { categoryId }, 'rejected')
  const emptyCategoryId = `${prefix}-unused-category`
  await command(admin, 'saveExpenseCategory', { categoryId: emptyCategoryId, group: groupId, name: 'Categoría sin historial QA', active: true, order: 20 })
  await command(admin, 'deleteExpenseCategory', { categoryId: emptyCategoryId })
  const unusedGroupId = `custom-${prefix}-unused`
  await command(admin, 'saveExpenseGroup', { groupId: unusedGroupId, name: `Grupo sin historial ${prefix}`, economicType: 'operating_expense', active: true, order: 80 })
  await command(admin, 'deleteExpenseGroup', { groupId: unusedGroupId })
  await command(admin, 'deleteExpenseGroup', { groupId }, 'rejected')
  ok(true, 'se permite el borrado definitivo solo de categorías y grupos personalizados sin referencias; el historial bloquea el borrado')

  const movedCategoryId = `${prefix}-commercial-category`
  await command(admin, 'saveExpenseCategory', { categoryId: movedCategoryId, group: 'indirect', name: 'Peaje histórico QA', active: true, order: 99 })
  const historicalExpense = await command(admin, 'expense', { presetId: `group-category:${movedCategoryId}`, groupId: 'indirect', amount: 25, paymentMethod: 'cash', routeId: 'administracion', routeName: 'Administración', concept: 'Peaje histórico QA' })
  await command(admin, 'saveExpenseCategory', { categoryId: movedCategoryId, group: 'commercialization', name: 'Peaje histórico QA', active: true, order: 1 })
  const storedHistoricalExpense = await read('distExpenses', historicalExpense.id)
  ok(storedHistoricalExpense.group === 'indirect' && (await read('distExpenseCategories', movedCategoryId)).group === 'commercialization', 'mover categoría cambia su grupo para nuevos egresos y conserva los registros históricos')
  await command(admin, 'saveExpenseCategory', { categoryId: 'indirect-7', group: 'indirect', name: 'Peaje legado QA', active: true, order: 99 })
  await command(admin, 'expense', { presetId: 'group-category:indirect-7', groupId: 'indirect', amount: 25, paymentMethod: 'cash', routeId: 'administracion', routeName: 'Administración' }, 'rejected')
  await command(admin, 'saveExpenseCategory', { categoryId: 'indirect-7', group: 'commercialization', name: 'Peaje legado QA', active: true, order: 1 })
  const movedLegacyExpense = await command(admin, 'expense', { presetId: 'group-category:indirect-7', groupId: 'commercialization', amount: 25, paymentMethod: 'cash', routeId: 'administracion', routeName: 'Administración' })
  ok((await read('distExpenses', movedLegacyExpense.id)).group === 'commercialization', 'los IDs antiguos de peaje, viáticos y reparación no se pueden seguir usando en Gastos indirectos')

  const exactPartialId = `${prefix}-purchase-2000-partial`
  const exactPartial = await command(admin, 'registerSupplierPurchase', { supplierId, groupId, categoryId, description: 'Compra parcial exacta QA', amount: 2_000, initialPayment: 500, paymentMethod: 'cash', dayKey: '2026-10-22' }, 'confirmed', exactPartialId)
  ok(exactPartial.result.payable.balance === 1_500 && exactPartial.result.payable.paidAmount === 500 && (await read('distExpenses', exactPartialId)).cashPaidAmount === 500, 'compra de Bs 2.000 con adelanto de Bs 500 deja Bs 1.500 por pagar y solo Bs 500 salen de caja')
  const exactPayment = await command(admin, 'paySupplierPayable', { payableId: exactPartial.result.payable.id, amount: 800, paymentMethod: 'cash', dayKey: '2026-10-27' }, 'confirmed', `${prefix}-pay-exact-800`)
  ok(exactPayment.result.payable.balance === 700 && exactPayment.result.payable.paidAmount === 1_300, 'abono posterior de Bs 800 deja Bs 700 pendientes sin duplicar el valor de compra')
  await command(admin, 'voidSupplierPayment', { paymentId: exactPayment.result.payment.id, reason: 'Anulación QA del abono exacto' }, 'confirmed', `${prefix}-void-exact-800`)
  ok((await read('distPayables', exactPartial.result.payable.id)).balance === 1_500 && (await read('distExpenses', exactPayment.result.payment.id)).voided === true, 'anular el abono exacto revierte una sola vez caja y saldo y conserva auditoría')

  const concurrentId = `${prefix}-purchase-concurrent`
  const concurrentPurchase = await command(admin, 'registerSupplierPurchase', { supplierId, groupId, categoryId, description: 'Cuenta QA para pagos simultáneos', amount: 700, initialPayment: 0, paymentMethod: 'cash', dayKey: '2026-10-22' }, 'confirmed', concurrentId)
  const concurrentPayload = { payableId: concurrentPurchase.result.payable.id, amount: 500, paymentMethod: 'cash', dayKey: '2026-10-27' }
  const queuedPayments = await Promise.all([
    enqueueCommand(admin, 'paySupplierPayable', concurrentPayload, `${prefix}-concurrent-payment-a`),
    enqueueCommand(admin, 'paySupplierPayable', concurrentPayload, `${prefix}-concurrent-payment-b`),
  ])
  await Promise.all(queuedPayments.map(item => processCommand(db, item.ref)))
  const simultaneousStatuses = await Promise.all(queuedPayments.map(async item => (await item.ref.get()).data().status))
  const concurrentBalance = (await read('distPayables', concurrentPurchase.result.payable.id)).balance
  ok(simultaneousStatuses.filter(status => status === 'confirmed').length === 1 && simultaneousStatuses.filter(status => status === 'rejected').length === 1 && concurrentBalance === 200, 'pagos simultáneos se serializan: solo se aplica un abono de Bs 500 y no excede el saldo')

  const voidPaymentOperation = `${prefix}-void-payment`
  const voidedPayment = await command(admin, 'voidSupplierPayment', { paymentId, reason: 'Corrección QA de referencia' }, 'confirmed', voidPaymentOperation)
  await processCommand(db, root.collection('distOperations').doc(voidPaymentOperation))
  ok(voidedPayment.result.payable.balance === 2_000 && (await read('distSupplierPayments', paymentId)).voided === true && (await read('distExpenses', paymentId)).voided === true, 'corregir un abono conserva auditoría y restaura deuda/caja una sola vez')
  const voidInitialId = `${prefix}-void-initial`
  const voidInitialPurchase = await command(admin, 'registerSupplierPurchase', { supplierId, groupId, categoryId, description: 'Compra con adelanto corregible', amount: 500, initialPayment: 200, paymentMethod: 'transfer', dayKey: '2026-10-22' }, 'confirmed', voidInitialId)
  const initialPaymentId = `${voidInitialId}__initial`
  const initialCorrection = await command(admin, 'voidSupplierPayment', { paymentId: initialPaymentId, reason: 'Corrección QA del adelanto' })
  ok(initialCorrection.result.payable.balance === 500 && (await read('distExpenses', voidInitialId)).transferPaidAmount === 0 && (await read('distSupplierPayments', initialPaymentId)).voided === true, 'corregir adelanto inicial actualiza medio de pago y saldo sin anular la compra económica')
  const voidPurchase = await command(admin, 'voidSupplierPurchase', { payableId: voidInitialPurchase.result.payable.id, reason: 'Compra QA duplicada' })
  ok(voidPurchase.result.status === 'voided' && (await read('distExpenses', voidInitialId)).voided === true, 'anulación de compra sin pagos vigentes conserva ambos documentos y motivo')
  await command(admin, 'voidSupplierPurchase', { payableId: partial.result.payable.id, reason: 'No se puede anular con adelanto vigente' }, 'rejected')
  ok(true, 'el servidor impide anular una compra que conserva pagos vigentes')

  const inactiveSupplierId = `${prefix}-inactive-supplier`
  await command(admin, 'saveExpenseSupplier', { supplierId: inactiveSupplierId, name: `Proveedor inactivo ${prefix}`, active: false })
  await command(admin, 'registerSupplierPurchase', { supplierId: inactiveSupplierId, groupId, categoryId, description: 'No autorizado', amount: 1, initialPayment: 0, paymentMethod: 'cash', dayKey: '2026-10-22' }, 'rejected')
  await command(admin, 'saveExpenseSupplier', { supplierId, name: supplierName, active: false })
  await command(admin, 'registerSupplierPurchase', { supplierId, groupId, categoryId, description: 'Proveedor inactivo', amount: 1, initialPayment: 0, paymentMethod: 'cash', dayKey: '2026-10-22' }, 'rejected')
  ok((await read('distExpenses', purchaseId)).purchaseReceiptNumber === '000-001-0000789' && (await read('distPayables', payableId)).balance === 2_000, 'desactivar proveedor no modifica compras ni saldos históricos y bloquea compras nuevas')
  await command(admin, 'saveExpenseSupplier', { supplierId, name: supplierName, active: true })
  ok((await read('distSuppliers', supplierId)).active === true, 'Administración puede reactivar al mismo proveedor sin recrear su historial')
  const safeDistributorExpense = await command(distributor, 'expense', { presetId: 'fuel', amount: 25, paymentMethod: 'cash', routeId, routeName: 'Ruta QA' })
  ok(safeDistributorExpense.result.classificationSource === 'automatic' && safeDistributorExpense.result.routeId === routeId, 'distribuidor conserva acceso al preset seguro autorizado')
  ok(true, 'Egresos 2.0: pruebas de backend y reglas completadas')
  console.log(`${checks} comprobaciones aprobadas`)
} finally {
  await env.cleanup()
  await adminApp.delete()
}
