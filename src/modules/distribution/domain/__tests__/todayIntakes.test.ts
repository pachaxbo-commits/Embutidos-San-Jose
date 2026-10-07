function assert(condition: unknown, message = 'Assertion failed'): asserts condition {
  if (!condition) throw new Error(message)
}
assert.equal = function (actual: unknown, expected: unknown, message?: string) {
  if (actual !== expected) {
    throw new Error(`${message ? message + ': ' : ''}Expected ${String(expected)}, got ${String(actual)}`)
  }
}
assert.ok = function (val: unknown, message?: string) {
  if (!val) throw new Error(message || 'Expected truthy value')
}
assert.rejects = async function (block: () => Promise<unknown>, expected?: RegExp | string) {
  try {
    await block()
  } catch (err) {
    if (expected) {
      const msg = (err as Error).message || String(err)
      if (typeof expected === 'string' && !msg.includes(expected)) {
        throw new Error(`Expected error message to include "${expected}", got "${msg}"`, { cause: err })
      }
      if (expected instanceof RegExp && !expected.test(msg)) {
        throw new Error(`Expected error message to match ${expected}, got "${msg}"`, { cause: err })
      }
    }
    return
  }
  throw new Error('Expected promise to reject, but it resolved')
}
import { generateTodayIntakesPdfBytes, getTodayStockIntakes } from '../todayIntakes.ts'
import type { DistLot, DistProduct, DistStockMovement, DistWarehouse } from '../../types.ts'

const today = '2026-10-07'
const yesterday = '2026-10-06'

const sampleProducts: DistProduct[] = [
  {
    id: 'prod-chorizo',
    name: 'Chorizo Parrillero',
    presentation: 'Paquete al vacío 500g',
    category: 'Embutidos',
    unitType: 'kg',
    referencePrice: 35,
    active: true,
    sortOrder: 1,
    restaurantId: 'sanjose',
    createdAt: '2026-01-01T08:00:00.000Z',
  },
  {
    id: 'prod-mortadela',
    name: 'Mortadela Primavera',
    presentation: 'Pieza sellada',
    category: 'Fiambres',
    unitType: 'package',
    referencePrice: 20,
    active: true,
    sortOrder: 2,
    restaurantId: 'sanjose',
    createdAt: '2026-01-01T08:00:00.000Z',
  },
  {
    id: 'prod-salchicha',
    name: 'Salchicha Viena',
    presentation: 'Granel',
    category: 'Embutidos',
    unitType: 'unit',
    referencePrice: 2,
    active: true,
    sortOrder: 3,
    restaurantId: 'sanjose',
    createdAt: '2026-01-01T08:00:00.000Z',
  },
]

const sampleWarehouses: DistWarehouse[] = [
  { id: 'central', name: 'Almacén central', active: true, restaurantId: 'sanjose' },
  { id: 'almacen-norte', name: 'Almacén Norte', active: true, restaurantId: 'sanjose' },
]

const sampleLots: DistLot[] = [
  {
    id: 'lot-1',
    restaurantId: 'sanjose',
    productId: 'prod-chorizo',
    productName: 'Chorizo Parrillero',
    unitType: 'kg',
    lotCode: 'L-CH-01',
    manufacturedOn: '2026-10-07',
    expiresOn: '2026-11-07',
    productionCost: 22,
    quantities: { central: 50 },
    createdAt: '2026-10-07T09:00:00.000Z',
    createdBy: 'user-admin',
  },
  {
    id: 'lot-2',
    restaurantId: 'sanjose',
    productId: 'prod-chorizo',
    productName: 'Chorizo Parrillero',
    unitType: 'kg',
    lotCode: 'L-CH-02',
    manufacturedOn: '2026-10-07',
    expiresOn: '2026-11-15',
    productionCost: 22,
    quantities: { central: 30 },
    createdAt: '2026-10-07T11:00:00.000Z',
    createdBy: 'user-admin',
  },
  {
    id: 'lot-3',
    restaurantId: 'sanjose',
    productId: 'prod-mortadela',
    productName: 'Mortadela Primavera',
    unitType: 'package',
    lotCode: 'L-MO-01',
    manufacturedOn: '2026-10-07',
    expiresOn: '2026-12-01',
    productionCost: 14,
    quantities: { central: 40 },
    createdAt: '2026-10-07T10:00:00.000Z',
    createdBy: 'user-admin',
  },
]

const sampleMovements: DistStockMovement[] = [
  // 1. Intake hoy Chorizo lote 1
  {
    id: 'mov-intake-1',
    restaurantId: 'sanjose',
    branchId: 'main',
    schemaVersion: 1,
    createdAt: `${today}T09:15:00.000Z`,
    createdBy: 'admin-1',
    dayKey: today,
    type: 'intake',
    productId: 'prod-chorizo',
    productName: 'Chorizo Parrillero',
    unitType: 'kg',
    quantity: 50,
    centralDelta: 50,
    routeDelta: 0,
    toLocation: 'central',
    lotCode: 'L-CH-01',
    responsibleName: 'Don Mario',
    responsibleRole: 'admin',
    note: 'Producción de la mañana',
  },
  // 2. Intake hoy Mortadela
  {
    id: 'mov-intake-2',
    restaurantId: 'sanjose',
    branchId: 'main',
    schemaVersion: 1,
    createdAt: `${today}T10:30:00.000Z`,
    createdBy: 'almacen-1',
    dayKey: today,
    type: 'intake',
    productId: 'prod-mortadela',
    productName: 'Mortadela Primavera',
    unitType: 'package',
    quantity: 40,
    centralDelta: 40,
    routeDelta: 0,
    toLocation: 'central',
    lotCode: 'L-MO-01',
    responsibleName: 'Carlos Almacén',
    responsibleRole: 'warehouse',
    note: 'Ingreso lote nuevo',
  },
  // 3. Intake hoy Chorizo lote 2 (mismo producto, diferente lote)
  {
    id: 'mov-intake-3',
    restaurantId: 'sanjose',
    branchId: 'main',
    schemaVersion: 1,
    createdAt: `${today}T11:45:00.000Z`,
    createdBy: 'almacen-1',
    dayKey: today,
    type: 'intake',
    productId: 'prod-chorizo',
    productName: 'Chorizo Parrillero',
    unitType: 'kg',
    quantity: 30,
    centralDelta: 30,
    routeDelta: 0,
    toLocation: 'central',
    lotCode: 'L-CH-02',
    responsibleName: 'Carlos Almacén',
    responsibleRole: 'warehouse',
    note: 'Segunda tanda',
  },
  // 4. Intake de AYER (debe excluirse)
  {
    id: 'mov-intake-ayer',
    restaurantId: 'sanjose',
    branchId: 'main',
    schemaVersion: 1,
    createdAt: `${yesterday}T16:00:00.000Z`,
    createdBy: 'admin-1',
    dayKey: yesterday,
    type: 'intake',
    productId: 'prod-chorizo',
    productName: 'Chorizo Parrillero',
    unitType: 'kg',
    quantity: 100,
    centralDelta: 100,
    routeDelta: 0,
    toLocation: 'central',
    lotCode: 'L-OLD',
    responsibleName: 'Don Mario',
    responsibleRole: 'admin',
  },
  // 5. Otros movimientos de HOY que NO son intake (deben excluirse)
  {
    id: 'mov-dispatch',
    restaurantId: 'sanjose',
    branchId: 'main',
    schemaVersion: 1,
    createdAt: `${today}T08:00:00.000Z`,
    createdBy: 'admin-1',
    dayKey: today,
    type: 'dispatch',
    productId: 'prod-chorizo',
    productName: 'Chorizo Parrillero',
    unitType: 'kg',
    quantity: 25,
    centralDelta: -25,
    routeDelta: 25,
    fromLocation: 'central',
    toLocation: 'route__r1',
  },
  {
    id: 'mov-sale',
    restaurantId: 'sanjose',
    branchId: 'main',
    schemaVersion: 1,
    createdAt: `${today}T12:00:00.000Z`,
    createdBy: 'seller-1',
    dayKey: today,
    type: 'sale',
    productId: 'prod-chorizo',
    productName: 'Chorizo Parrillero',
    unitType: 'kg',
    quantity: 10,
    centralDelta: 0,
    routeDelta: -10,
    fromLocation: 'route__r1',
  },
  {
    id: 'mov-adjust',
    restaurantId: 'sanjose',
    branchId: 'main',
    schemaVersion: 1,
    createdAt: `${today}T13:00:00.000Z`,
    createdBy: 'admin-1',
    dayKey: today,
    type: 'adjustment',
    productId: 'prod-mortadela',
    productName: 'Mortadela Primavera',
    unitType: 'package',
    quantity: 2,
    centralDelta: -2,
    routeDelta: 0,
    fromLocation: 'central',
  },
  {
    id: 'mov-return',
    restaurantId: 'sanjose',
    branchId: 'main',
    schemaVersion: 1,
    createdAt: `${today}T17:00:00.000Z`,
    createdBy: 'seller-1',
    dayKey: today,
    type: 'return',
    productId: 'prod-chorizo',
    productName: 'Chorizo Parrillero',
    unitType: 'kg',
    quantity: 5,
    centralDelta: 5,
    routeDelta: -5,
    fromLocation: 'route__r1',
    toLocation: 'central',
  },
  // 6. Intake a OTRO almacén (Almacén Norte)
  {
    id: 'mov-intake-norte',
    restaurantId: 'sanjose',
    branchId: 'main',
    schemaVersion: 1,
    createdAt: `${today}T14:00:00.000Z`,
    createdBy: 'admin-1',
    dayKey: today,
    type: 'intake',
    productId: 'prod-salchicha',
    productName: 'Salchicha Viena',
    unitType: 'unit',
    quantity: 200,
    centralDelta: 0,
    routeDelta: 0,
    toLocation: 'warehouse__almacen-norte',
    lotCode: 'L-SV-01',
    responsibleName: 'Don Mario',
    responsibleRole: 'admin',
  },
]

async function runTests() {
  const testData = {
    products: sampleProducts,
    warehouses: sampleWarehouses,
    lots: sampleLots,
    movements: sampleMovements,
  }

  // Caso 1: Hoy existen 3 movimientos intake en central -> documento contiene exactamente 3
  const centralResult = getTodayStockIntakes(testData, 'central', today)
  assert.equal(centralResult.items.length, 3, 'Central debe tener exactamente 3 movimientos de hoy')
  assert.equal(centralResult.totalMovements, 3, 'totalMovements debe ser exactamente 3')

  // Caso 2: Movimientos de ayer NO aparecen
  const yesterdayMovementInCentral = centralResult.items.some((i) => i.movementId === 'mov-intake-ayer')
  assert.equal(yesterdayMovementInCentral, false, 'Movimiento de ayer no debe aparecer')

  // Caso 3: Hoy existen venta, despacho, ajuste y retorno -> NO aparecen
  const nonIntakesPresent = centralResult.items.some((i) =>
    ['mov-dispatch', 'mov-sale', 'mov-adjust', 'mov-return'].includes(i.movementId),
  )
  assert.equal(nonIntakesPresent, false, 'Ventas, despachos, ajustes y retornos no deben aparecer')

  // Caso 4: Dos almacenes -> respeta alcance/filtro
  const norteResult = getTodayStockIntakes(testData, 'almacen-norte', today)
  assert.equal(norteResult.items.length, 1, 'Almacén Norte debe tener exactamente 1 movimiento')
  assert.equal(norteResult.items[0]?.movementId, 'mov-intake-norte', 'Debe ser el movimiento de Almacén Norte')
  assert.equal(norteResult.warehouseName, 'Almacén Norte')

  // Caso 5: Sin ingresos hoy -> no genera documento vacío y maneja sin PDF vacío
  const noIntakesDayResult = getTodayStockIntakes(testData, 'central', '2026-01-01')
  assert.equal(noIntakesDayResult.items.length, 0, 'Día sin ingresos retorna 0 items')
  assert.equal(noIntakesDayResult.totalMovements, 0)
  assert.rejects(
    async () => {
      await generateTodayIntakesPdfBytes(testData, 'central', '2026-01-01')
    },
    /No hay ingresos de inventario registrados hoy/,
  )

  // Caso 6: Producto kg -> conserva kg
  const chorizoItem = centralResult.items.find((i) => i.productId === 'prod-chorizo')
  assert.equal(chorizoItem?.unitType, 'kg', 'Conserva unidad kg')

  // Caso 7: Producto paquete -> conserva paquetes
  const mortadelaItem = centralResult.items.find((i) => i.productId === 'prod-mortadela')
  assert.equal(mortadelaItem?.unitType, 'package', 'Conserva unidad package')

  // Caso 8: Lotes distintos del mismo producto -> aparecen individualmente en el detalle
  const chorizoItems = centralResult.items.filter((i) => i.productId === 'prod-chorizo')
  assert.equal(chorizoItems.length, 2, 'Los dos lotes de chorizo aparecen individualmente en el detalle')
  assert.equal(chorizoItems[0]?.lotCode, 'L-CH-01')
  assert.equal(chorizoItems[1]?.lotCode, 'L-CH-02')
  assert.equal(chorizoItems[0]?.quantity, 50)
  assert.equal(chorizoItems[1]?.quantity, 30)

  // Resumen agrupa por producto y suma cantidades sin mezclar unidades
  assert.equal(centralResult.summary.length, 2, 'Resumen tiene 2 productos (Chorizo y Mortadela)')
  const chorizoSummary = centralResult.summary.find((s) => s.productId === 'prod-chorizo')
  assert.equal(chorizoSummary?.totalQuantity, 80, '50 + 30 = 80 kg en resumen')
  assert.equal(chorizoSummary?.unitType, 'kg')
  assert.equal(chorizoSummary?.movementCount, 2)

  // Caso 9: Contador mostrado = movimientos en PDF
  assert.equal(centralResult.totalMovements, centralResult.items.length)

  // Caso 10: Generación real de bytes de PDF
  const pdfBytes = await generateTodayIntakesPdfBytes(testData, 'central', today)
  assert.ok(pdfBytes instanceof Uint8Array, 'Retorna Uint8Array')
  assert.ok(pdfBytes.length > 1000, 'El PDF generado tiene contenido válido')
  // Comprobar cabecera mágica de PDF (%PDF-)
  const magic = String.fromCharCode(...pdfBytes.subarray(0, 5))
  assert.equal(magic, '%PDF-', 'Comienza con la firma mágica %PDF-')

  console.log('PASS pruebas de ingresos de inventario del día (todayIntakes.test.ts)')
}

const nodeProcess = (globalThis as { process?: { exitCode?: number } }).process

runTests().catch((err) => {
  console.error('FAIL', err)
  if (nodeProcess) nodeProcess.exitCode = 1
})
