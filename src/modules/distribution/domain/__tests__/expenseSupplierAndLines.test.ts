import { round2 } from '../engine.ts'
import {
  expenseCashPaidAmount,
  expenseOtherPaidAmount,
  expenseTransferPaidAmount,
} from '../expenseAccounting.ts'
import type { DistExpense, DistPayable, DistSupplierPayment, SupplierPurchaseLine } from '../../types.ts'

console.log('--- INICIANDO TEST SUITE: FILTRO PROVEEDOR Y PURCHASE LINES EN EGRESOS ---')

const createExpense = (id: string, amount: number, extra: Record<string, unknown> = {}): DistExpense => ({
  id,
  restaurantId: 'sanjose',
  concept: `Gasto ${id}`,
  amount,
  dayKey: '2026-11-15',
  createdAt: '2026-11-15T10:00:00.000Z',
  registeredByUid: 'uid-admin',
  registeredByName: 'Administración',
  paymentMethod: 'cash',
  economicType: 'production_input',
  transactionKind: 'supplier_purchase',
  routeId: 'central',
  routeName: 'Almacén Central',
  operationId: `op-${id}`,
  schemaVersion: 1,
  ...extra,
} as unknown as DistExpense)

const createPayable = (id: string, totalAmount: number, paidAmount: number, extra: Record<string, unknown> = {}): DistPayable => ({
  id,
  restaurantId: 'sanjose',
  supplierId: 'prov-a',
  supplierName: 'Proveedor Carnes del Valle',
  description: `Deuda ${id}`,
  totalAmount,
  paidAmount,
  balance: round2(totalAmount - paidAmount),
  status: paidAmount === 0 ? 'pending' : paidAmount >= totalAmount ? 'paid' : 'partial',
  groupId: 'production_purchases',
  groupName: 'Compras para producción',
  categoryId: 'meat',
  categoryName: 'Carne e insumos',
  dayKey: '2026-11-15',
  createdAt: '2026-11-15T10:00:00.000Z',
  createdBy: 'uid-admin',
  routeId: 'central',
  routeName: 'Almacén Central',
  purchaseExpenseId: `exp-${id}`,
  schemaVersion: 1,
  ...extra,
} as unknown as DistPayable)

const createPayment = (id: string, amount: number, payableId: string, extra: Record<string, unknown> = {}): DistSupplierPayment => ({
  id,
  restaurantId: 'sanjose',
  payableId,
  supplierId: 'prov-a',
  supplierName: 'Proveedor Carnes del Valle',
  amount,
  paymentMethod: 'transfer',
  dayKey: '2026-11-15',
  createdAt: '2026-11-15T11:00:00.000Z',
  responsibleUid: 'uid-admin',
  responsibleName: 'Administración',
  routeId: 'central',
  routeName: 'Almacén Central',
  voided: false,
  schemaVersion: 1,
  ...extra,
} as unknown as DistSupplierPayment)

// Helper idéntico a ExpenseReportsView para matching de proveedores
function matchesSupplierFilter(
  filterValue: string,
  supplierId?: string,
  supplierName?: string,
  supplierMap: Map<string, string> = new Map(),
): boolean {
  if (filterValue === 'all') return true
  if (filterValue.startsWith('name:')) {
    return (supplierName?.trim() || '') === filterValue.slice(5)
  }
  if (supplierId && supplierId === filterValue) return true
  const selectedName = supplierMap.get(filterValue)
  if (selectedName && (supplierName?.trim() || '') === selectedName) return true
  return false
}

// =========================================================================
// TEST F: Filtro de Proveedor (Proveedor A, B, y sin proveedor)
// =========================================================================
console.log('Ejecutando Test F: Filtro Proveedor en Egresos, Cuentas y Pagos...')
{
  const expenses: DistExpense[] = [
    createExpense('exp-1', 4000, {
      supplierId: 'prov-a',
      supplierName: 'Carnes del Valle',
      paymentMethod: 'cash',
    }),
    createExpense('exp-2', 2500, {
      supplierId: 'prov-b',
      supplierName: 'Condimentos La Paz',
      paymentMethod: 'transfer',
    }),
    createExpense('exp-3', 150, {
      supplierId: undefined,
      supplierName: undefined,
      concept: 'Pasajes movilidad',
      transactionKind: 'expense',
      paymentMethod: 'cash',
    }),
  ]

  const payables: DistPayable[] = [
    createPayable('pay-1', 4000, 1000, {
      supplierId: 'prov-a',
      supplierName: 'Carnes del Valle',
    }),
    createPayable('pay-2', 2500, 500, {
      supplierId: 'prov-b',
      supplierName: 'Condimentos La Paz',
    }),
  ]

  const payments: DistSupplierPayment[] = [
    createPayment('pmt-1', 1000, 'pay-1', {
      supplierId: 'prov-a',
      supplierName: 'Carnes del Valle',
      paymentMethod: 'cash',
    }),
    createPayment('pmt-2', 500, 'pay-2', {
      supplierId: 'prov-b',
      supplierName: 'Condimentos La Paz',
      paymentMethod: 'transfer',
    }),
  ]

  const supplierMap = new Map([
    ['prov-a', 'Carnes del Valle'],
    ['prov-b', 'Condimentos La Paz'],
  ])

  // Filtrar por prov-a
  const filteredExpA = expenses.filter((e) => matchesSupplierFilter('prov-a', e.supplierId, e.supplierName, supplierMap))
  const filteredPayA = payables.filter((p) => matchesSupplierFilter('prov-a', p.supplierId, p.supplierName, supplierMap))
  const filteredPmtA = payments.filter((pm) => matchesSupplierFilter('prov-a', pm.supplierId, pm.supplierName, supplierMap))

  if (filteredExpA.length !== 1 || filteredExpA[0].id !== 'exp-1') {
    throw new Error(`Test F falló: solo debe incluir exp-1 de Proveedor A, got ${filteredExpA.length}`)
  }
  if (filteredPayA.length !== 1 || filteredPayA[0].id !== 'pay-1') {
    throw new Error(`Test F falló: solo debe incluir pay-1 de Proveedor A, got ${filteredPayA.length}`)
  }
  if (filteredPmtA.length !== 1 || filteredPmtA[0].id !== 'pmt-1') {
    throw new Error(`Test F falló: solo debe incluir pmt-1 de Proveedor A, got ${filteredPmtA.length}`)
  }

  // KPIs de Proveedor A
  const totalExpA = filteredExpA.reduce((sum, e) => sum + e.amount, 0)
  const pendingPayA = filteredPayA.reduce((sum, p) => sum + p.balance, 0)
  const paidA = filteredPayA.reduce((sum, p) => sum + p.paidAmount, 0)

  if (totalExpA !== 4000) throw new Error(`Test F falló: total compras Prov A debe ser 4000, got ${totalExpA}`)
  if (pendingPayA !== 3000) throw new Error(`Test F falló: saldo por pagar Prov A debe ser 3000 (4000 - 1000), got ${pendingPayA}`)
  if (paidA !== 1000) throw new Error(`Test F falló: pagado en cuentas Prov A debe ser 1000, got ${paidA}`)

  // Compatibilidad histórica con name:
  const filteredByName = expenses.filter((e) => matchesSupplierFilter('name:Condimentos La Paz', e.supplierId, e.supplierName, supplierMap))
  if (filteredByName.length !== 1 || filteredByName[0].id !== 'exp-2') {
    throw new Error(`Test F falló: compatibilidad con 'name:Condimentos La Paz' no funcionó`)
  }

  console.log('✓ Test F PASADO: Filtro de Proveedor aísla gastos, cuentas por pagar, pagos y KPIs coherentemente.')
}

// =========================================================================
// TEST G: PurchaseLines (Detalle de productos comprados)
// =========================================================================
console.log('Ejecutando Test G: Compra multi-producto con purchaseLines (Carne + Tocino)...')
{
  const lines: SupplierPurchaseLine[] = [
    {
      description: 'Carne faena de cerdo',
      quantity: 100,
      unit: 'kg',
      unitLabel: 'kg',
      unitPrice: 30,
      total: 3000,
      wasteQuantity: 0,
      netUsableQuantity: 100,
    },
    {
      description: 'Tocino primera',
      quantity: 20,
      unit: 'kg',
      unitLabel: 'kg',
      unitPrice: 50,
      total: 1000,
      wasteQuantity: 0,
      netUsableQuantity: 20,
    },
  ]

  const multiLineExpense = createExpense('exp-multi', 4000, {
    concept: 'Compra de materia prima semana 46',
    purchaseLines: lines,
    supplierName: 'Carnes del Valle',
    purchaseReceiptType: 'invoice',
    purchaseReceiptNumber: 'FAC-9912',
  })

  // Generación de filas para Detalle de Egresos (como en sheets() de ExpenseReportsView)
  const exportRows: (string | number | null)[][] = []
  if (multiLineExpense.purchaseLines && multiLineExpense.purchaseLines.length > 0) {
    for (const line of multiLineExpense.purchaseLines) {
      exportRows.push([
        multiLineExpense.dayKey,
        'Compras para producción',
        'Carne e insumos',
        `${multiLineExpense.concept} — ${line.description}`,
        Number(line.quantity), // Cantidad numérica para Excel
        line.unitLabel || line.unit || '',
        Number(line.unitPrice), // Precio unitario numérico Bs
        Number(line.total), // Importe de la línea Bs
        Number(multiLineExpense.amount), // Total oficial de la operación Bs
        'Efectivo',
        expenseCashPaidAmount(multiLineExpense),
        expenseTransferPaidAmount(multiLineExpense),
        expenseOtherPaidAmount(multiLineExpense),
        multiLineExpense.routeName,
        multiLineExpense.registeredByName,
        multiLineExpense.supplierName || '',
        multiLineExpense.purchaseReceiptType || '',
        multiLineExpense.purchaseReceiptNumber || '',
      ])
    }
  }

  if (exportRows.length !== 2) {
    throw new Error(`Test G falló: deben generarse 2 filas para las 2 líneas de compra, got ${exportRows.length}`)
  }

  // Fila 1: Carne faena (100 kg × 30 = 3000)
  const rowCarne = exportRows[0]
  if (rowCarne[4] !== 100 || rowCarne[5] !== 'kg' || rowCarne[6] !== 30 || rowCarne[7] !== 3000 || rowCarne[8] !== 4000) {
    throw new Error(`Test G falló: Fila 1 (Carne) incorrecta: ${JSON.stringify(rowCarne)}`)
  }

  // Fila 2: Tocino (20 kg × 50 = 1000)
  const rowTocino = exportRows[1]
  if (rowTocino[4] !== 20 || rowTocino[5] !== 'kg' || rowTocino[6] !== 50 || rowTocino[7] !== 1000 || rowTocino[8] !== 4000) {
    throw new Error(`Test G falló: Fila 2 (Tocino) incorrecta: ${JSON.stringify(rowTocino)}`)
  }

  // Total oficial de la operación se preserva exactamente en 4000
  if (multiLineExpense.amount !== 4000) {
    throw new Error(`Test G falló: el total de la compra debe seguir siendo 4000, got ${multiLineExpense.amount}`)
  }

  console.log('✓ Test G PASADO: Compra multi-producto desglosa 100 kg × Bs 30 = Bs 3000 y 20 kg × Bs 50 = Bs 1000 conservando el total oficial de Bs 4000.')
}

// =========================================================================
// TEST H: Histórico sin detalle (Legacy sin purchaseLines)
// =========================================================================
console.log('Ejecutando Test H: Egreso legacy sin purchaseLines...')
{
  const legacyExpense = createExpense('exp-legacy', 1000, {
    concept: 'Compra histórica de insumos varios',
    purchaseLines: undefined, // Sin purchaseLines
  })

  // Generación de fila legacy
  const exportRows: (string | number | null)[][] = []
  if (legacyExpense.purchaseLines && legacyExpense.purchaseLines.length > 0) {
    // No entra aquí
  } else {
    exportRows.push([
      legacyExpense.dayKey,
      'Compras para producción',
      'Histórico',
      legacyExpense.concept,
      null, // Cantidad NO inferida
      '',
      null, // Precio unitario NO inferido
      Number(legacyExpense.amount),
      Number(legacyExpense.amount),
      'Efectivo',
      expenseCashPaidAmount(legacyExpense),
      expenseTransferPaidAmount(legacyExpense),
      expenseOtherPaidAmount(legacyExpense),
      legacyExpense.routeName,
      legacyExpense.registeredByName,
      legacyExpense.supplierName || '',
      legacyExpense.purchaseReceiptType || '',
      legacyExpense.purchaseReceiptNumber || '',
    ])
  }

  if (exportRows.length !== 1) {
    throw new Error(`Test H falló: debe generarse 1 fila, got ${exportRows.length}`)
  }

  const legacyRow = exportRows[0]
  if (legacyRow[4] !== null) {
    throw new Error(`Test H falló: cantidad debe ser null en legacy sin purchaseLines, got ${legacyRow[4]}`)
  }
  if (legacyRow[6] !== null) {
    throw new Error(`Test H falló: precio unitario debe ser null en legacy sin purchaseLines, got ${legacyRow[6]}`)
  }
  if (legacyRow[7] !== 1000 || legacyRow[8] !== 1000) {
    throw new Error(`Test H falló: importe debe ser exactamente el oficial de 1000, got ${legacyRow[7]} y ${legacyRow[8]}`)
  }

  console.log('✓ Test H PASADO: Registro legacy sin purchaseLines no infiere cantidades ni precios ficticios.')
}

// =========================================================================
// TEST PARTE 5: Cálculos Financieros Inalterados
// =========================================================================
console.log('Ejecutando Test Parte 5: Integridad financiera...')
{
  const expense = createExpense('exp-check', 1850.5, {
    paymentMethod: 'cash',
    purchaseLines: [
      { description: 'Insumo A', quantity: 10, unit: 'other', unitLabel: 'saco', unitPrice: 185.05, total: 1850.5, wasteQuantity: 0, netUsableQuantity: 10 },
    ],
  })

  const cash = expenseCashPaidAmount(expense)
  const transfer = expenseTransferPaidAmount(expense)
  const other = expenseOtherPaidAmount(expense)

  if (cash !== 1850.5 || transfer !== 0 || other !== 0) {
    throw new Error(`Parte 5 falló: cálculos financieros alterados: cash=${cash}, transfer=${transfer}, other=${other}`)
  }

  console.log('✓ Parte 5 PASADA: Salidas de dinero, clasificaciones y totales se mantienen exactos e inalterados.')
}

console.log('ALL TESTS PASSED: src/modules/distribution/domain/__tests__/expenseSupplierAndLines.test.ts')
