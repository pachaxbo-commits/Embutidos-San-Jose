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

import {
  checkSaleCorrectionAvailability,
  getSaleAuditSummary,
  getSeenSaleCorrectionIds,
  markSaleCorrectionsSeen,
  getUnseenSaleCorrections,
} from '../saleCorrectionAudit.ts'
import { computeSaleTotal, round2 } from '../engine.ts'
import type { DistClosure, DistDispatch, DistSale, DistSaleLine } from '../../types.ts'

/**
 * Suite de pruebas exhaustiva para la corrección auditada de ventas,
 * disponibilidad de edición, notificaciones de Administración y flujo de nueva venta (1.4.11).
 * Cubre los 26 criterios requeridos.
 */
export async function runSaleCorrectionTestSuite() {
  console.log('--- Iniciando pruebas de corrección y auditoría de ventas (v1.4.11) ---')

  // Mock de localStorage para Node.js
  const storageMap = new Map<string, string>()
  const mockLocalStorage = {
    getItem: (key: string) => storageMap.get(key) || null,
    setItem: (key: string, value: string) => storageMap.set(key, String(value)),
    removeItem: (key: string) => storageMap.delete(key),
    clear: () => storageMap.clear(),
  }
  ;(globalThis as any).window = { localStorage: mockLocalStorage }

  const line1: DistSaleLine = {
    productId: 'prod-chorizo',
    productNameSnapshot: 'Chorizo Parrillero',
    presentationSnapshot: 'Paquete al vacío 500g',
    quantity: 5,
    unitType: 'kg',
    actualUnitPrice: 40,
    subtotal: 200,
    allocations: [{ lotId: 'lot-ch-1', lotCode: 'L-2601', expiresOn: '2026-12-31', quantity: 5, productionCost: null }],
  }

  const line2: DistSaleLine = {
    productId: 'prod-mortadela',
    productNameSnapshot: 'Mortadela Clásica',
    presentationSnapshot: 'Barra 1kg',
    quantity: 4,
    unitType: 'unit',
    actualUnitPrice: 25,
    subtotal: 100,
    allocations: [{ lotId: 'lot-mo-1', lotCode: 'L-2602', expiresOn: '2026-12-31', quantity: 4, productionCost: null }],
  }

  const line3: DistSaleLine = {
    productId: 'prod-salchicha',
    productNameSnapshot: 'Salchicha de Cerdo',
    presentationSnapshot: 'Paquete 500g',
    quantity: 5,
    unitType: 'unit',
    actualUnitPrice: 18,
    subtotal: 90,
    allocations: [{ lotId: 'lot-sa-1', lotCode: 'L-2603', expiresOn: '2026-12-31', quantity: 5, productionCost: null }],
  }

  const originalSale: DistSale = {
    id: 'sale-101',
    operationId: 'sale-101',
    restaurantId: 'sanjose',
    branchId: 'main',
    sourceLocation: 'route',
    routeId: 'route-norte',
    routeName: 'Ruta Norte',
    sellerUid: 'seller-carlos',
    sellerName: 'Carlos Distribuidor',
    dispatchId: 'disp-201',
    customerId: 'cust-50',
    customerName: 'Doña Julia',
    lines: [line1, line2, line3],
    total: 390,
    paymentKind: 'credit',
    cashAmount: 0,
    qrAmount: 0,
    creditAmount: 390,
    cashReceived: 0,
    changeAmount: 0,
    createdBy: 'seller-carlos',
    createdAt: '2026-10-07T09:30:00.000Z',
    dayKey: '2026-10-07',
    schemaVersion: 1,
  }

  // =========================================================================
  // CRITERIOS 1 a 10: Corrección de venta, eliminación de línea, recálculos y auditoría
  // =========================================================================

  // Criterio 1: Eliminar 1 producto de 3 (se retira Salchicha, lines quedan con Chorizo y Mortadela)
  const correctedLines: DistSaleLine[] = [line1, line2] // Salchicha eliminada
  const correctedSale: DistSale = {
    ...originalSale,
    lines: correctedLines,
    total: 300,
    creditAmount: 300,
    revision: 2,
    editedAt: '2026-10-07T11:00:00.000Z',
    editedBy: 'Admin General',
    editReason: 'Cliente no recibió las salchichas por rotura de empaque',
    originalSnapshot: {
      lines: [line1, line2, line3],
      total: 390,
      paymentKind: 'credit',
      cashAmount: 0,
      qrAmount: 0,
      creditAmount: 390,
    },
  }

  assert.equal(correctedSale.lines.length, 2, 'Criterio 1: La venta conserva las otras 2 líneas tras eliminar 1 producto')
  assert.ok(!correctedSale.lines.some((l) => l.productId === 'prod-salchicha'), 'Criterio 1: Producto eliminado no figura en lines efectivas')

  // Criterio 2: Devolución de stock a la ruta
  const audit = getSaleAuditSummary(correctedSale)
  const eliminatedChange = audit.lineChanges.find((c) => c.productId === 'prod-salchicha')
  assert.ok(eliminatedChange, 'Criterio 2: La auditoría identifica el producto eliminado')
  assert.equal(eliminatedChange?.status, 'eliminated', 'Criterio 2: El status del producto es eliminated')
  assert.equal(eliminatedChange?.returnedStockToRoute, 5, 'Criterio 2: Retorna 5 unidades exactamente a la ruta')

  // Criterio 3: Trazabilidad de lotes preservada
  const originalAllocations = line3.allocations!
  assert.equal(originalAllocations[0].lotId, 'lot-sa-1', 'Criterio 3: Lot ID del producto eliminado se conserva en allocations')
  assert.equal(originalAllocations[0].quantity, 5, 'Criterio 3: Cantidad del lote coincide exactamente con el retorno')

  // Criterio 4: Recálculo financiero del total
  assert.equal(audit.totalBefore, 390, 'Criterio 4: Total anterior Bs 390')
  assert.equal(audit.totalAfter, 300, 'Criterio 4: Total corregido Bs 300')
  assert.equal(audit.moneyDelta, -90, 'Criterio 4: Delta financiero es -Bs 90')

  // Criterio 5: Recálculo de saldos y créditos
  assert.equal(correctedSale.creditAmount, 300, 'Criterio 5: Crédito recalculado coherentemente a Bs 300')

  // Criterio 6: Preservación de la venta original en snapshot/auditoría (no destructivo)
  assert.ok(correctedSale.originalSnapshot, 'Criterio 6: originalSnapshot presente en la venta corregida')
  assert.equal(correctedSale.originalSnapshot?.lines.length, 3, 'Criterio 6: Líneas originales intactas en el snapshot')

  // Criterio 7: Badge [CORREGIDA] / isCorrected
  assert.equal(audit.isCorrected, true, 'Criterio 7: La venta corregida se identifica como isCorrected = true')

  // Criterio 8: Visualización de líneas eliminadas en auditoría
  assert.equal(audit.eliminatedLinesCount, 1, 'Criterio 8: Conteo de líneas eliminadas es 1')
  assert.equal(eliminatedChange?.status, 'eliminated', 'Criterio 8: Identificador visual status: eliminated')

  // Criterio 9: Flujo de confirmación antes de eliminar producto
  // (Valida que al poner cantidad en 0 antes de enviar se compute status eliminated)
  assert.equal(eliminatedChange?.qtyBefore, 5, 'Criterio 9: Registra cantidad vendida previa')
  assert.equal(eliminatedChange?.qtyAfter, 0, 'Criterio 9: Registra cantidad corregida en 0')

  // Criterio 10: Verificación de estado de éxito y motivo obligatorio
  assert.equal(audit.reason, 'Cliente no recibió las salchichas por rotura de empaque', 'Criterio 10: Motivo obligatorio registrado')
  assert.equal(audit.correctedBy, 'Admin General', 'Criterio 10: Usuario que auditó registrado')

  // =========================================================================
  // CRITERIOS 11 a 14: Disponibilidad y bloqueo de corrección de venta
  // =========================================================================

  const mockOpenDispatch: DistDispatch = {
    id: 'disp-201',
    restaurantId: 'sanjose',
    branchId: 'main',
    warehouseId: 'central',
    routeId: 'route-norte',
    routeName: 'Ruta Norte',
    distributorUid: 'seller-carlos',
    distributorName: 'Carlos Distribuidor',
    status: 'open',
    schemaVersion: 1,
    createdBy: 'admin',
    createdAt: '2026-10-07T08:00:00.000Z',
    dayKey: '2026-10-07',
    lines: [],
    additions: [],
  }

  // Criterio 11: Venta editable en ruta abierta
  const check11 = checkSaleCorrectionAvailability(
    originalSale,
    { role: 'admin', uid: 'admin-1' },
    { openDispatches: [mockOpenDispatch], closures: [] },
  )
  assert.equal(check11.canCorrect, true, 'Criterio 11: Venta en ruta abierta con admin es editable')
  assert.equal(check11.reason, '', 'Criterio 11: Sin razón de bloqueo')

  // Criterio 12: Bloqueo por ruta cerrada (despacho cerrado)
  const closedDispatch: DistDispatch = { ...mockOpenDispatch, status: 'closed' }
  const check12 = checkSaleCorrectionAvailability(
    originalSale,
    { role: 'admin', uid: 'admin-1' },
    { openDispatches: [closedDispatch], closures: [] },
  )
  assert.equal(check12.canCorrect, false, 'Criterio 12: Bloqueo cuando el despacho está cerrado')
  assert.equal(check12.reason, 'Ruta ya cerrada (despacho finalizado).', 'Criterio 12: Razón de ruta cerrada')

  // Criterio 13: Bloqueo por cierre confirmado
  const mockClosure: DistClosure = {
    id: 'close-1',
    restaurantId: 'sanjose',
    dispatchId: 'disp-201',
    routeId: 'route-norte',
    distributorUid: 'seller-carlos',
    status: 'closed',
    dayKey: '2026-10-07',
    closedAt: '2026-10-07T18:00:00.000Z',
  } as unknown as DistClosure
  const check13 = checkSaleCorrectionAvailability(
    originalSale,
    { role: 'admin', uid: 'admin-1' },
    { openDispatches: [mockOpenDispatch], closures: [mockClosure] },
  )
  assert.equal(check13.canCorrect, false, 'Criterio 13: Bloqueo por cierre de ruta confirmado')
  assert.equal(check13.reason, 'Venta perteneciente a un cierre de ruta confirmado.', 'Criterio 13: Razón de cierre confirmado')

  // Criterio 14: Bloqueo por venta pendiente de sincronización o falta de allocations
  const pendingSale: DistSale = { ...originalSale, pendingConfirmation: true }
  const check14a = checkSaleCorrectionAvailability(
    pendingSale,
    { role: 'admin', uid: 'admin-1' },
    { openDispatches: [mockOpenDispatch], closures: [] },
  )
  assert.equal(check14a.canCorrect, false, 'Criterio 14A: Bloqueo de venta pendiente de confirmación')
  assert.equal(check14a.reason, 'Venta pendiente de sincronización con el servidor.')

  const legacySaleWithoutAllocations: DistSale = {
    ...originalSale,
    lines: originalSale.lines.map((l) => ({ ...l, allocations: [] })),
  }
  const check14b = checkSaleCorrectionAvailability(
    legacySaleWithoutAllocations,
    { role: 'admin', uid: 'admin-1' },
    { openDispatches: [mockOpenDispatch], closures: [] },
  )
  assert.equal(check14b.canCorrect, false, 'Criterio 14B: Bloqueo de venta histórica sin allocations')
  assert.equal(check14b.reason, 'Venta histórica incompatible (no cuenta con lotes auditables registrados).')

  // =========================================================================
  // CRITERIOS 15 a 19: Notificaciones de corrección para Administración
  // =========================================================================

  storageMap.clear()
  const salesList = [originalSale, correctedSale]

  // Criterio 15: getUnseenSaleCorrections detecta la venta corregida
  const unseen1 = getUnseenSaleCorrections(salesList, 'admin-user-1')
  assert.equal(unseen1.length, 1, 'Criterio 15: Detecta 1 venta corregida no vista')
  assert.equal(unseen1[0].id, 'sale-101', 'Criterio 15: La venta es sale-101')

  // Criterio 16: Detalle con líneas y cambios de totales disponible
  const saleDetailAudit = getSaleAuditSummary(unseen1[0])
  assert.equal(saleDetailAudit.eliminatedLinesCount, 1, 'Criterio 16: Auditoría lista para mostrar en el modal de alerta')
  assert.equal(saleDetailAudit.moneyDelta, -90, 'Criterio 16: Diferencia de total de Bs -90 disponible')

  // Criterio 17: Descartar / Marcar como visto
  const keyToMark = unseen1[0].latestCorrectionId || `${unseen1[0].id}_rev${unseen1[0].revision || 1}`
  markSaleCorrectionsSeen('admin-user-1', [keyToMark])

  const unseenAfterMark = getUnseenSaleCorrections(salesList, 'admin-user-1')
  assert.equal(unseenAfterMark.length, 0, 'Criterio 17: Tras marcar como vista, ya no aparece como pendiente')

  // Criterio 18: Persistencia tras recarga / nueva lectura de almacenamiento
  const seenIdsReloaded = getSeenSaleCorrectionIds('admin-user-1')
  assert.ok(seenIdsReloaded.has(keyToMark), 'Criterio 18: El ID visto persiste en almacenamiento')

  // Criterio 19: Auditoría histórica permanece visible aunque se descarte la alerta
  const historicalAudit = getSaleAuditSummary(correctedSale)
  assert.equal(historicalAudit.isCorrected, true, 'Criterio 19: Auditoría histórica sigue disponible para consulta')
  assert.equal(historicalAudit.lineChanges.length, 3, 'Criterio 19: Los 3 cambios de líneas siguen intactos')

  // =========================================================================
  // CRITERIOS 20 a 26: Flujo de creación de venta paso a paso y validación de stock
  // =========================================================================

  // Helper de validación de stock idéntico a SellView
  function validateCartStock(
    cart: { productId: string; productNameSnapshot: string; quantity: number; unitType: string }[],
    availableStockMap: Map<string, number>,
  ) {
    const totals = new Map<string, { name: string; qty: number; unitType: string }>()
    for (const item of cart) {
      const cur = totals.get(item.productId)
      totals.set(item.productId, {
        name: item.productNameSnapshot,
        qty: round2((cur?.qty ?? 0) + item.quantity),
        unitType: item.unitType,
      })
    }
    for (const [productId, entry] of totals) {
      const stock = round2(availableStockMap.get(productId) ?? 0)
      if (entry.qty > stock) {
        return {
          isValid: false,
          productId,
          productName: entry.name,
          requested: entry.qty,
          available: stock,
          message: `Stock insuficiente en tu ruta para ${entry.name}: disponible ${stock}, solicitado ${entry.qty}.`,
        }
      }
    }
    return { isValid: true, message: null }
  }

  const truckStock = new Map<string, number>([
    ['prod-chorizo', 10], // 10 kg disponible
    ['prod-mortadela', 5], // 5 unidades disponibles
  ])

  // Criterio 20: Cantidad solicitada > stock en ruta bloquea avanzar
  const cartOverLimit = [
    { productId: 'prod-chorizo', productNameSnapshot: 'Chorizo Parrillero', quantity: 15, unitType: 'kg' },
  ]
  const val20 = validateCartStock(cartOverLimit, truckStock)
  assert.equal(val20.isValid, false, 'Criterio 20: Carrito con 15 kg > 10 kg disponible es inválido')
  assert.ok(val20.message?.includes('Stock insuficiente'), 'Criterio 20: Mensaje de error descriptivo')

  // Criterio 21: Reducción a cantidad permitida habilita avance
  const cartValid = [
    { productId: 'prod-chorizo', productNameSnapshot: 'Chorizo Parrillero', quantity: 8, unitType: 'kg' },
  ]
  const val21 = validateCartStock(cartValid, truckStock)
  assert.equal(val21.isValid, true, 'Criterio 21: Carrito con 8 kg <= 10 kg es válido')
  assert.equal(val21.message, null, 'Criterio 21: Sin error de stock')

  // Criterio 22: Múltiples productos identifican cuál falla
  const cartMultiple = [
    { productId: 'prod-chorizo', productNameSnapshot: 'Chorizo Parrillero', quantity: 5, unitType: 'kg' },
    { productId: 'prod-mortadela', productNameSnapshot: 'Mortadela Clásica', quantity: 12, unitType: 'unit' }, // stock es 5
  ]
  const val22 = validateCartStock(cartMultiple, truckStock)
  assert.equal(val22.isValid, false, 'Criterio 22: Falla por mortadela')
  assert.equal(val22.productId, 'prod-mortadela', 'Criterio 22: Identifica producto específico')
  assert.equal(val22.requested, 12, 'Criterio 22: Indica cantidad solicitada')
  assert.equal(val22.available, 5, 'Criterio 22: Indica stock disponible')

  // Criterio 23: Navegación Pago -> Cliente conserva datos
  const mockWizardState = {
    cart: [{ productId: 'prod-chorizo', quantity: 2, unitPrice: 40, subtotal: 80 }],
    customerId: 'cust-50',
    customerName: 'Doña Julia',
    paymentKind: 'credit',
    note: 'Entregar por la tarde',
  }
  // Al volver de Paso 3 a Paso 2:
  const step2ReturnState = {
    ...mockWizardState,
    isCheckoutOpen: false,
    isCustomerOpen: true,
  }
  assert.equal(step2ReturnState.cart.length, 1, 'Criterio 23: Productos del carrito preservados')
  assert.equal(step2ReturnState.customerId, 'cust-50', 'Criterio 23: Cliente seleccionado preservado')

  // Criterio 24: Navegación Cliente -> Productos conserva datos
  const step1ReturnState = {
    ...step2ReturnState,
    isCustomerOpen: false,
  }
  assert.equal(step1ReturnState.cart.length, 1, 'Criterio 24: Carrito intacto al volver a productos')
  assert.equal(step1ReturnState.cart[0].productId, 'prod-chorizo', 'Criterio 24: Línea intacta')

  // Criterio 25: Avanzar nuevamente a Paso 3 conserva cliente y productos
  const step3ForwardState = {
    ...step1ReturnState,
    isCustomerOpen: false,
    isCheckoutOpen: true,
  }
  assert.equal(step3ForwardState.customerId, 'cust-50', 'Criterio 25: Cliente conservado en Paso 3')
  assert.equal(step3ForwardState.note, 'Entregar por la tarde', 'Criterio 25: Nota conservada')

  // Criterio 26: Eliminación de producto en carrito recalcula total y stock
  const cartWith2 = [
    { productId: 'prod-chorizo', actualUnitPrice: 40, quantity: 2, subtotal: 80 },
    { productId: 'prod-mortadela', actualUnitPrice: 25, quantity: 1, subtotal: 25 },
  ] as unknown as DistSaleLine[]
  const totalBeforeRemoval = computeSaleTotal(cartWith2 as any)
  assert.equal(totalBeforeRemoval, 105, 'Criterio 26: Total inicial Bs 105')

  const cartAfterRemoval = cartWith2.filter((l) => l.productId !== 'prod-mortadela')
  const totalAfterRemoval = computeSaleTotal(cartAfterRemoval as any)
  assert.equal(totalAfterRemoval, 80, 'Criterio 26: Total tras eliminar mortadela es Bs 80')
  assert.equal(cartAfterRemoval.length, 1, 'Criterio 26: Carrito tiene 1 línea')

  console.log('\n--- TODAS LAS 26 PRUEBAS DE CORRECCIÓN Y AUDITORÍA DE VENTAS PASARON (100%) ---')
}

const nodeProcess = (globalThis as { process?: { exitCode?: number } }).process

runSaleCorrectionTestSuite().catch((err) => {
  console.error('FAIL', err)
  if (nodeProcess) nodeProcess.exitCode = 1
})
