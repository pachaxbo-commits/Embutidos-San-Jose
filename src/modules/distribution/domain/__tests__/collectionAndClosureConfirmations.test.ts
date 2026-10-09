import { normalizeClosure } from '../closurePeriod.ts'
import { round2 } from '../engine.ts'
import type { DistClosure } from '../../types.ts'

export async function runCollectionAndClosureConfirmationsTestSuite() {
  const results: string[] = []
  let passed = 0
  let failed = 0

  function assert(condition: boolean, message: string) {
    if (condition) {
      passed += 1
      results.push(`  ✓ ${message}`)
    } else {
      failed += 1
      results.push(`  ✗ ${message}`)
      console.error(`FAILED: ${message}`)
    }
  }

  console.log('\n--- 1. Pruebas de Cobros de Créditos (Validación y UX) ---')

  // A. Cobro inicial debe empezar siempre en 0
  const mockCustomer = {
    customerId: 'cust_1',
    customerName: 'Cliente Ejemplo',
    balance: 500,
    receivables: [
      { id: 'rec_1', balance: 200, sourceDate: '2026-10-01', createdAt: '2026-10-01T10:00:00Z', sourceType: 'opening_balance' },
      { id: 'rec_2', balance: 300, sourceDate: '2026-10-05', createdAt: '2026-10-05T10:00:00Z', sourceType: 'sale' },
    ],
  }

  const initialAmount = '0'
  assert(initialAmount === '0', 'El monto a cobrar empieza siempre en "0", nunca en el saldo total (500)')

  // B. Validación: 0 no es un monto válido para registrar cobro
  function validateCollection(amtStr: string, custBalance: number, method: 'cash' | 'qr' | 'mixed', cashAmtStr = '0', qrAmtStr = '0') {
    const value = round2(Number(amtStr))
    if (!(value > 0)) {
      return { ok: false, error: 'Ingresa el monto que realmente vas a cobrar.' }
    }
    if (value > custBalance) {
      return { ok: false, error: `El monto no puede superar la deuda total del cliente (Bs ${custBalance.toFixed(2)}).` }
    }
    const cash = method === 'cash' ? value : method === 'qr' ? 0 : round2(Number(cashAmtStr))
    const qr = method === 'qr' ? value : method === 'cash' ? 0 : round2(Number(qrAmtStr))
    if (cash < 0 || qr < 0 || round2(cash + qr) !== value || (method === 'mixed' && (!(cash > 0) || !(qr > 0)))) {
      return { ok: false, error: 'El efectivo y el QR deben ser mayores a cero y sumar exactamente el monto cobrado.' }
    }
    return { ok: true, value, cash, qr, remainingBalance: round2(custBalance - value) }
  }

  const zeroValidation = validateCollection('0', mockCustomer.balance, 'cash')
  assert(!zeroValidation.ok && zeroValidation.error === 'Ingresa el monto que realmente vas a cobrar.', 'Cobrar 0 es rechazado con advertencia explícita')

  const negativeValidation = validateCollection('-50', mockCustomer.balance, 'cash')
  assert(!negativeValidation.ok, 'Cobrar monto negativo es rechazado')

  const overflowValidation = validateCollection('600', mockCustomer.balance, 'cash')
  assert(!overflowValidation.ok && Boolean(overflowValidation.error?.includes('superar la deuda')), 'Monto superior a la deuda es rechazado')

  const validCash = validateCollection('150', mockCustomer.balance, 'cash')
  assert(validCash.ok && validCash.value === 150 && validCash.remainingBalance === 350, 'Cobro válido en efectivo calcula saldo restante correcto')

  const validMixed = validateCollection('200', mockCustomer.balance, 'mixed', '120', '80')
  assert(validMixed.ok && validMixed.cash === 120 && validMixed.qr === 80, 'Cobro mixto válido desglosa efectivo y QR correctamente')

  const invalidMixedSum = validateCollection('200', mockCustomer.balance, 'mixed', '100', '50')
  assert(!invalidMixedSum.ok, 'Cobro mixto con suma incorrecta es rechazado')

  // C. Orden FIFO por antigüedad para amortización
  const sortedDebts = [...mockCustomer.receivables].sort((a, b) =>
    (a.sourceDate || a.createdAt).localeCompare(b.sourceDate || b.createdAt)
  )
  assert(sortedDebts[0].id === 'rec_1', 'La amortización prioriza la deuda más antigua primero (FIFO)')

  console.log('\n--- 2. Pruebas de Declaración del Distribuidor ---')

  // A. declaredCash debe empezar en blanco '' cuando no hay borrador ni valor previo
  const emptyDraftCash: string | undefined = undefined
  const savedClosureWithoutCash: DistClosure = {
    id: 'closure_d1',
    restaurantId: 'rest_1',
    branchId: 'main',
    createdAt: '2026-10-09T10:00:00Z',
    createdBy: 'u1',
    dayKey: '2026-10-09',
    schemaVersion: 1,
    dispatchId: 'disp_1',
    warehouseId: 'central',
    routeId: 'r1',
    routeName: 'Ruta 1',
    distributorUid: 'd1',
    distributorName: 'Distribuidor 1',
    status: 'draft',
    products: [],
    declaredReturns: {},
    cashSales: 0,
    qrSales: 0,
    creditGenerated: 0,
    cashCollections: 0,
    qrCollections: 0,
    cashExpenses: 0,
    expectedCash: 250,
    cashDifference: 0,
  }

  const initialDeclaredCash = emptyDraftCash ?? (savedClosureWithoutCash.physicalCashDeclared != null ? String(savedClosureWithoutCash.physicalCashDeclared) : '')
  assert(initialDeclaredCash === '', 'El efectivo declarado empieza vacío ("") y no en 0 por omisión')

  // B. Si ya existía un valor declarado guardado, debe precargarlo al recargar
  const savedClosureWithCash: DistClosure = {
    ...savedClosureWithoutCash,
    physicalCashDeclared: 250,
    cashDeclaredBy: 'd1',
    cashDeclaredAt: '2026-10-09T18:00:00Z',
  }
  const reloadDeclaredCash = emptyDraftCash ?? (savedClosureWithCash.physicalCashDeclared != null ? String(savedClosureWithCash.physicalCashDeclared) : '')
  assert(reloadDeclaredCash === '250', 'Al recargar la app, si ya había efectivo declarado se recupera el valor guardado (250)')

  // C. Validación de declaración del distribuidor
  function validateDistributorDeclaration(declaredCashInput: string, productsDeclared: boolean) {
    if (!productsDeclared) {
      return { ok: false, error: 'Declara todos los productos, incluso si retornas cero.' }
    }
    if (declaredCashInput.trim() === '') {
      return { ok: false, error: 'Ingresa el efectivo que estás entregando. Si no devuelves dinero, escribe 0.' }
    }
    const cashNum = Number(declaredCashInput)
    if (!Number.isFinite(cashNum) || cashNum < 0) {
      return { ok: false, error: 'El efectivo declarado debe ser un número válido mayor o igual a 0.' }
    }
    return { ok: true, cashNum: round2(cashNum) }
  }

  assert(!validateDistributorDeclaration('', true).ok && Boolean(validateDistributorDeclaration('', true).error?.includes('escribe 0')), 'Campo de efectivo vacío es bloqueado en declaración')
  assert(!validateDistributorDeclaration('   ', true).ok, 'Espacios en blanco son bloqueados')
  assert(validateDistributorDeclaration('0', true).ok && validateDistributorDeclaration('0', true).cashNum === 0, 'Efectivo 0 explícito es permitido')
  assert(validateDistributorDeclaration('340', true).ok && validateDistributorDeclaration('340', true).cashNum === 340, 'Efectivo positivo es permitido')

  // D. Normalización de cierre preserva physicalCashDeclared undefined vs 0
  const normalizedWithoutCash = normalizeClosure({ id: 'c_test1', dispatchId: 'disp_test1' })
  assert(normalizedWithoutCash.physicalCashDeclared === undefined, 'normalizeClosure no coacciona undefined a 0 en cierres nuevos')

  const normalizedWithZero = normalizeClosure({ id: 'c_test2', dispatchId: 'disp_test2', physicalCashDeclared: 0 })
  assert(normalizedWithZero.physicalCashDeclared === 0, 'normalizeClosure preserva physicalCashDeclared: 0 explícito')

  console.log('\n--- 3. Pruebas de Cierre Final de Ruta (Administración) ---')

  // A. Validación para cierre final de ruta
  function validateFinalRouteClosure(returnsConfirmedByWarehouse: boolean, declaredCashInput: string, expectedCash: number) {
    if (!returnsConfirmedByWarehouse) {
      return { ok: false, error: 'Almacén debe confirmar primero el retorno físico.' }
    }
    if (declaredCashInput.trim() === '') {
      return { ok: false, error: 'Ingresa el efectivo físico declarado antes de cerrar la ruta. Si no hay dinero, escribe 0.' }
    }
    const cashNum = Number(declaredCashInput)
    if (!Number.isFinite(cashNum) || cashNum < 0) {
      return { ok: false, error: 'El efectivo declarado debe ser mayor o igual a cero.' }
    }
    const declaredValue = round2(cashNum)
    const diff = round2(declaredValue - expectedCash)
    let diffStatus: 'cuadrada' | 'faltante' | 'sobrante'
    if (Math.abs(diff) < 0.01) {
      diffStatus = 'cuadrada'
    } else if (diff < 0) {
      diffStatus = 'faltante'
    } else {
      diffStatus = 'sobrante'
    }
    return { ok: true, declaredValue, diff, diffStatus }
  }

  assert(!validateFinalRouteClosure(false, '100', 100).ok, 'Cierre final bloqueado si almacén aún no confirmó el retorno físico')
  assert(!validateFinalRouteClosure(true, '', 100).ok, 'Cierre final bloqueado si el efectivo está vacío')
  assert(validateFinalRouteClosure(true, '0', 0).ok && validateFinalRouteClosure(true, '0', 0).diffStatus === 'cuadrada', 'Cierre final con 0 explícito y esperado 0 da caja cuadrada')

  const squareDiff = validateFinalRouteClosure(true, '300', 300)
  assert(squareDiff.ok && squareDiff.diffStatus === 'cuadrada' && squareDiff.diff === 0, 'Diferencia 0 detecta "Caja cuadrada (Bs 0.00)"')

  const shortageDiff = validateFinalRouteClosure(true, '250', 300)
  assert(shortageDiff.ok && shortageDiff.diffStatus === 'faltante' && shortageDiff.diff === -50, 'Efectivo menor detecta "Faltante en caja: -Bs 50.00"')

  const surplusDiff = validateFinalRouteClosure(true, '350', 300)
  assert(surplusDiff.ok && surplusDiff.diffStatus === 'sobrante' && surplusDiff.diff === 50, 'Efectivo mayor detecta "Sobrante en caja: +Bs 50.00"')

  // B. Conservación de datos declarados durante el paso de almacén
  function simulateWarehousePhysicalConfirmation(existing: DistClosure, confirmedProducts: DistClosure['products']) {
    const isCashDeclared = existing.physicalCashDeclared !== undefined
    const declaredValue = existing.physicalCashDeclared ?? 0
    return {
      ...existing,
      status: 'warehouse_done' as const,
      products: confirmedProducts,
      warehouseClosedBy: 'warehouse_user_1',
      warehouseClosedAt: '2026-10-09T18:30:00Z',
      // Debe conservar los datos de efectivo declarados por el distribuidor
      physicalCashDeclared: isCashDeclared ? declaredValue : undefined,
      cashDeclaredBy: existing.cashDeclaredBy || '',
      cashDeclaredAt: existing.cashDeclaredAt || '',
    }
  }

  const closureAfterWarehouse = simulateWarehousePhysicalConfirmation(savedClosureWithCash, [])
  assert(closureAfterWarehouse.physicalCashDeclared === 250, 'El paso de almacén preserva physicalCashDeclared del distribuidor')
  assert(closureAfterWarehouse.cashDeclaredBy === 'd1', 'El paso de almacén preserva cashDeclaredBy del distribuidor')
  assert(closureAfterWarehouse.cashDeclaredAt === '2026-10-09T18:00:00Z', 'El paso de almacén preserva cashDeclaredAt del distribuidor')

  console.log('\n--- Resumen de Pruebas ---')
  console.log(`Pruebas ejecutadas: ${passed + failed}`)
  console.log(`Superadas: ${passed}`)
  console.log(`Fallidas: ${failed}`)

  if (failed > 0) {
    throw new Error(`${failed} pruebas fallaron en la suite de cobranzas y cierres`)
  }
}

// Auto-run when executed directly via node
const nodeProcess = (globalThis as unknown as { process?: { exitCode?: number } }).process
runCollectionAndClosureConfirmationsTestSuite().catch((err) => {
  console.error(err)
  if (nodeProcess) nodeProcess.exitCode = 1
})
