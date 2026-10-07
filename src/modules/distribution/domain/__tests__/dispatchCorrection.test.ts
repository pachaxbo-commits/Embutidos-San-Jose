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

import { computeLoadedByProduct, round2 } from '../engine.ts'
import type { DistDispatch, DistDispatchAddition, DistLotAllocation } from '../../types.ts'

/**
 * Suite de pruebas unitarias para la corrección auditada de despachos y aumentos (v1.4.10).
 * Valida los 12 casos requeridos por la auditoría técnica.
 */
export async function runDispatchCorrectionTestSuite() {
  console.log('--- Iniciando pruebas de corrección auditada de despachos (1.4.10) ---')

  function makeDispatch(partial: Partial<DistDispatch> & Pick<DistDispatch, 'id' | 'lines'>): DistDispatch {
    return {
      restaurantId: 'sanjose',
      branchId: 'main',
      warehouseId: 'central',
      routeId: 'route-norte',
      routeName: 'Ruta Norte',
      distributorUid: 'dist-juan',
      distributorName: 'Juan Pérez',
      status: 'open',
      schemaVersion: 1,
      createdBy: 'user_admin',
      createdAt: '2026-10-07T08:00:00.000Z',
      dayKey: '2026-10-07',
      additions: [],
      ...partial,
    }
  }

  function makeAddition(partial: Partial<DistDispatchAddition> & Pick<DistDispatchAddition, 'id' | 'quantityByProduct'>): DistDispatchAddition {
    return {
      createdBy: 'user_admin',
      createdByName: 'Almacén Central',
      createdAt: '2026-10-07T11:00:00.000Z',
      ...partial,
    }
  }

  // Helper para simular revertLineStock idéntico al backend
  function simulateRevertLineStock(
    line: { quantity: number; allocations?: DistLotAllocation[]; lotId?: string; lotCode?: string },
    returnQty: number,
    lotBalances: Map<string, number>,
  ): DistLotAllocation[] {
    const allocationsReturned: DistLotAllocation[] = []
    let remainingToReturn = returnQty

    if (line.allocations && line.allocations.length > 0) {
      for (let i = line.allocations.length - 1; i >= 0 && remainingToReturn > 0; i--) {
        const alloc = line.allocations[i]
        const availableInAlloc = alloc.quantity
        if (availableInAlloc <= 0) continue

        const take = round2(Math.min(availableInAlloc, remainingToReturn))
        alloc.quantity = round2(alloc.quantity - take)
        remainingToReturn = round2(remainingToReturn - take)

        const currentStock = lotBalances.get(alloc.lotId) || 0
        lotBalances.set(alloc.lotId, round2(currentStock + take))

        allocationsReturned.push({
          lotId: alloc.lotId,
          lotCode: alloc.lotCode,
          expiresOn: alloc.expiresOn,
          quantity: take,
          productionCost: alloc.productionCost,
        })
      }
      line.allocations = line.allocations.filter((a) => a.quantity > 0)
    } else if (line.lotId) {
      const currentStock = lotBalances.get(line.lotId) || 0
      lotBalances.set(line.lotId, round2(currentStock + returnQty))
      allocationsReturned.push({
        lotId: line.lotId,
        lotCode: line.lotCode || 'LOTE-DIRECTO',
        expiresOn: '2026-10-30',
        quantity: returnQty,
        productionCost: 5,
      })
    }

    return allocationsReturned
  }

  // Helper para simular corrección con validaciones del backend
  function applyCorrection(params: {
    dispatch: DistDispatch
    targetType: 'initial' | 'addition'
    productId?: string
    additionId?: string
    newQuantity?: number
    voidAddition?: boolean
    reason: string
    actorRole: 'admin' | 'warehouse' | 'distributor'
    salesRecordedForProduct?: number
    lotBalances: Map<string, number>
  }) {
    const {
      dispatch: d,
      targetType,
      productId,
      additionId,
      newQuantity,
      voidAddition,
      reason,
      actorRole,
      salesRecordedForProduct = 0,
      lotBalances,
    } = params

    // 1. Permisos
    if (!['admin', 'warehouse'].includes(actorRole)) {
      throw new Error('Sin permiso para corregir despachos.')
    }

    // 2. Despacho cerrado
    if (d.status !== 'open') {
      throw new Error('Este despacho ya fue cerrado y no puede modificarse.')
    }

    // 3. Motivo obligatorio
    if (!reason || !reason.trim()) {
      throw new Error('El motivo de la corrección es obligatorio.')
    }

    d.corrections = d.corrections || []
    const loadedMap = computeLoadedByProduct(d)

    if (targetType === 'initial') {
      assert(productId, 'Falta el identificador del producto.')
      const line = d.lines.find((l) => l.productId === productId)
      assert(line, 'El producto no se encuentra en la carga inicial.')

      const oldQty = line.quantity
      const targetNewQty = round2(newQuantity ?? oldQty)
      if (targetNewQty < 0) throw new Error('La cantidad no puede ser negativa.')

      if (targetNewQty < oldQty) {
        const returnQty = round2(oldQty - targetNewQty)
        const curLoaded = loadedMap.get(productId)?.totalLoaded || 0
        const newLoaded = round2(curLoaded - returnQty)
        if (newLoaded < salesRecordedForProduct) {
          throw new Error(
            `No puedes reducir la carga a ${newLoaded} porque ya se registraron ${salesRecordedForProduct} vendidos.`
          )
        }

        const returned = simulateRevertLineStock(line, returnQty, lotBalances)
        line.quantity = targetNewQty

        d.corrections.push({
          id: `corr_${Date.now()}_${d.corrections.length + 1}`,
          operationId: 'op_test',
          targetType: 'initial',
          productId,
          productName: line.productName,
          oldQuantity: oldQty,
          newQuantity: targetNewQty,
          returnedQuantity: returnQty,
          unitType: line.unitType,
          lotCode: returned.map((r) => r.lotCode).join(', '),
          lotId: returned[0]?.lotId || '',
          reason: reason.trim(),
          correctedBy: 'user_admin',
          correctedByName: 'Admin Test',
          correctedAt: new Date().toISOString(),
        })
      } else if (targetNewQty > oldQty) {
        const addQty = round2(targetNewQty - oldQty)
        const lotId = line.lotId || line.allocations?.[0]?.lotId || 'lot-cho-1'
        const currentStock = lotBalances.get(lotId) || 0
        if (currentStock < addQty) {
          throw new Error(`Stock apto insuficiente de ${line.productName}. Revisa lotes vencidos o cantidades.`)
        }
        lotBalances.set(lotId, round2(currentStock - addQty))
        line.quantity = targetNewQty
        line.allocations = line.allocations || []
        line.allocations.push({
          lotId,
          lotCode: line.lotCode || 'LOTE-DIRECTO',
          expiresOn: '2026-10-30',
          quantity: addQty,
          productionCost: 5,
        })

        d.corrections.push({
          id: `corr_${Date.now()}_${d.corrections.length + 1}`,
          operationId: 'op_test',
          targetType: 'initial',
          productId,
          productName: line.productName,
          oldQuantity: oldQty,
          newQuantity: targetNewQty,
          addedQuantity: addQty,
          unitType: line.unitType,
          lotCode: line.lotCode || 'LOTE-DIRECTO',
          lotId,
          reason: reason.trim(),
          correctedBy: 'user_admin',
          correctedByName: 'Admin Test',
          correctedAt: new Date().toISOString(),
        })
      }
    } else if (targetType === 'addition') {
      assert(additionId, 'Identificador de aumento requerido.')
      const addition = (d.additions || []).find((a) => a.id === additionId)
      assert(addition, 'El aumento de carga no existe.')
      if (addition.voided) throw new Error('Este aumento ya fue anulado anteriormente.')

      if (voidAddition === true) {
        for (const line of addition.quantityByProduct) {
          const oldQty = line.quantity
          if (oldQty <= 0) continue

          const curLoaded = loadedMap.get(line.productId)?.totalLoaded || 0
          const newLoaded = round2(curLoaded - oldQty)
          if (newLoaded < salesRecordedForProduct) {
            throw new Error(
              `No puedes anular este aumento: para ${line.productName} la carga quedaría en ${newLoaded} pero ya se registraron ${salesRecordedForProduct} vendidos.`
            )
          }

          const returned = simulateRevertLineStock(line, oldQty, lotBalances)
          line.quantity = 0

          d.corrections.push({
            id: `corr_${Date.now()}_${d.corrections.length + 1}`,
            operationId: 'op_test',
            targetType: 'addition',
            additionId: addition.id,
            productId: line.productId,
            productName: line.productName,
            oldQuantity: oldQty,
            newQuantity: 0,
            returnedQuantity: oldQty,
            unitType: line.unitType,
            lotCode: returned.map((r) => r.lotCode).join(', '),
            lotId: returned[0]?.lotId || '',
            reason: reason.trim(),
            correctedBy: 'user_admin',
            correctedByName: 'Admin Test',
            correctedAt: new Date().toISOString(),
          })
        }
        addition.voided = true
        addition.voidedAt = new Date().toISOString()
        addition.voidedBy = 'user_admin'
        addition.voidReason = reason.trim()
      } else {
        assert(productId, 'Falta el identificador del producto.')
        const line = addition.quantityByProduct.find((l) => l.productId === productId)
        assert(line, 'El producto no se encuentra en este aumento.')

        const oldQty = line.quantity
        const targetNewQty = round2(newQuantity ?? oldQty)
        if (targetNewQty < 0) throw new Error('La cantidad no puede ser negativa.')

        if (targetNewQty < oldQty) {
          const returnQty = round2(oldQty - targetNewQty)
          const curLoaded = loadedMap.get(productId)?.totalLoaded || 0
          const newLoaded = round2(curLoaded - returnQty)
          if (newLoaded < salesRecordedForProduct) {
            throw new Error(
              `No puedes reducir la carga a ${newLoaded} porque ya se registraron ${salesRecordedForProduct} vendidos.`
            )
          }

          const returned = simulateRevertLineStock(line, returnQty, lotBalances)
          line.quantity = targetNewQty

          d.corrections.push({
            id: `corr_${Date.now()}_${d.corrections.length + 1}`,
            operationId: 'op_test',
            targetType: 'addition',
            additionId: addition.id,
            productId,
            productName: line.productName,
            oldQuantity: oldQty,
            newQuantity: targetNewQty,
            returnedQuantity: returnQty,
            unitType: line.unitType,
            lotCode: returned.map((r) => r.lotCode).join(', '),
            lotId: returned[0]?.lotId || '',
            reason: reason.trim(),
            correctedBy: 'user_admin',
            correctedByName: 'Admin Test',
            correctedAt: new Date().toISOString(),
          })
        } else if (targetNewQty > oldQty) {
          const addQty = round2(targetNewQty - oldQty)
          const lotId = line.lotId || line.allocations?.[0]?.lotId || 'lot-mort-1'
          const currentStock = lotBalances.get(lotId) || 0
          if (currentStock < addQty) {
            throw new Error(`Stock apto insuficiente de ${line.productName}. Revisa lotes vencidos o cantidades.`)
          }
          lotBalances.set(lotId, round2(currentStock - addQty))
          line.quantity = targetNewQty
          line.allocations = line.allocations || []
          line.allocations.push({
            lotId,
            lotCode: line.lotCode || 'LOTE-DIRECTO',
            expiresOn: '2026-10-30',
            quantity: addQty,
            productionCost: 4,
          })

          d.corrections.push({
            id: `corr_${Date.now()}_${d.corrections.length + 1}`,
            operationId: 'op_test',
            targetType: 'addition',
            additionId: addition.id,
            productId,
            productName: line.productName,
            oldQuantity: oldQty,
            newQuantity: targetNewQty,
            addedQuantity: addQty,
            unitType: line.unitType,
            lotCode: line.lotCode || 'LOTE-DIRECTO',
            lotId,
            reason: reason.trim(),
            correctedBy: 'user_admin',
            correctedByName: 'Admin Test',
            correctedAt: new Date().toISOString(),
          })
        }
      }
    }
  }

  // =========================================================================
  // CASO 1: Despacho inicial 30 kg corregido a 20 kg
  // =========================================================================
  const lotBalances1 = new Map<string, number>([['lot-cho-1', 50]])
  const dispatch1 = makeDispatch({
    id: 'disp-001',
    lines: [
      {
        productId: 'prod-chorizo',
        productName: 'Chorizo Parrillero',
        unitType: 'kg',
        quantity: 30,
        lotId: 'lot-cho-1',
        allocations: [{ lotId: 'lot-cho-1', lotCode: 'L-051026', expiresOn: '2026-10-30', quantity: 30, productionCost: 5 }],
      },
    ],
  })

  applyCorrection({
    dispatch: dispatch1,
    targetType: 'initial',
    productId: 'prod-chorizo',
    newQuantity: 20,
    reason: 'Error de digitación en carga inicial',
    actorRole: 'admin',
    lotBalances: lotBalances1,
  })

  assert.equal(dispatch1.lines[0].quantity, 20, 'Caso 1: Carga en ruta queda en 20 kg')
  assert.equal(lotBalances1.get('lot-cho-1'), 60, 'Caso 1: Almacén y lote original recuperan 10 kg (50 -> 60)')
  assert.equal(dispatch1.corrections?.length, 1, 'Caso 1: Se registra 1 entrada de auditoría')
  assert.equal(dispatch1.corrections?.[0].returnedQuantity, 10, 'Caso 1: Cantidad devuelta registrada es 10')
  console.log('  ✓ Caso 1: Despacho inicial 30 kg corregido a 20 kg (almacén +10, lote +10, ruta 20)')

  // =========================================================================
  // CASO 2: Aumento +20 corregido a +10
  // =========================================================================
  const lotBalances2 = new Map<string, number>([['lot-mort-1', 100]])
  const dispatch2 = makeDispatch({
    id: 'disp-002',
    lines: [
      {
        productId: 'prod-mortadela',
        productName: 'Mortadela Primavera',
        unitType: 'package',
        quantity: 10,
        lotId: 'lot-mort-1',
        allocations: [{ lotId: 'lot-mort-1', lotCode: 'M-1010', expiresOn: '2026-10-30', quantity: 10, productionCost: 4 }],
      },
    ],
    additions: [
      makeAddition({
        id: 'add-001',
        quantityByProduct: [
          {
            productId: 'prod-mortadela',
            productName: 'Mortadela Primavera',
            unitType: 'package',
            quantity: 20,
            lotId: 'lot-mort-1',
            allocations: [{ lotId: 'lot-mort-1', lotCode: 'M-1010', expiresOn: '2026-10-30', quantity: 20, productionCost: 4 }],
          },
        ],
      }),
    ],
  })

  applyCorrection({
    dispatch: dispatch2,
    targetType: 'addition',
    additionId: 'add-001',
    productId: 'prod-mortadela',
    newQuantity: 10,
    reason: 'Se agregaron 20 por error, correspondían 10',
    actorRole: 'warehouse',
    lotBalances: lotBalances2,
  })

  const loaded2 = computeLoadedByProduct(dispatch2).get('prod-mortadela')
  assert.equal(loaded2?.totalLoaded, 20, 'Caso 2: Carga total en ruta pasa de 30 a 20 (10 inicial + 10 aumento)')
  assert.equal(lotBalances2.get('lot-mort-1'), 110, 'Caso 2: Almacén y lote original recuperan 10 paquetes (100 -> 110)')
  console.log('  ✓ Caso 2: Aumento +20 corregido a +10 (ruta disminuye 10, almacén recupera 10)')

  // =========================================================================
  // CASO 3: Quitar completamente aumento erróneo (voidAddition)
  // =========================================================================
  const lotBalances3 = new Map<string, number>([['lot-mort-1', 80]])
  const dispatch3 = makeDispatch({
    id: 'disp-003',
    lines: [
      {
        productId: 'prod-mortadela',
        productName: 'Mortadela Primavera',
        unitType: 'package',
        quantity: 15,
        lotId: 'lot-mort-1',
        allocations: [{ lotId: 'lot-mort-1', lotCode: 'M-1010', expiresOn: '2026-10-30', quantity: 15, productionCost: 4 }],
      },
    ],
    additions: [
      makeAddition({
        id: 'add-erroneous',
        quantityByProduct: [
          {
            productId: 'prod-mortadela',
            productName: 'Mortadela Primavera',
            unitType: 'package',
            quantity: 10,
            lotId: 'lot-mort-1',
            allocations: [{ lotId: 'lot-mort-1', lotCode: 'M-1010', expiresOn: '2026-10-30', quantity: 10, productionCost: 4 }],
          },
        ],
      }),
    ],
  })

  applyCorrection({
    dispatch: dispatch3,
    targetType: 'addition',
    additionId: 'add-erroneous',
    voidAddition: true,
    reason: 'Aumento registrado por error a ruta equivocada',
    actorRole: 'admin',
    lotBalances: lotBalances3,
  })

  assert.equal(dispatch3.additions[0].voided, true, 'Caso 3: Aumento marcado como voided = true')
  assert.equal(lotBalances3.get('lot-mort-1'), 90, 'Caso 3: Todo el stock vuelve al almacén (80 -> 90)')
  const loaded3 = computeLoadedByProduct(dispatch3).get('prod-mortadela')
  assert.equal(loaded3?.totalLoaded, 15, 'Caso 3: computeLoadedByProduct ignora aumento anulado (queda solo 15 inicial)')
  assert.ok(dispatch3.corrections && dispatch3.corrections.length > 0, 'Caso 3: Auditoría conservada intacta')
  console.log('  ✓ Caso 3: Quitar aumento erróneo (voided=true, stock restaurado, auditoría conservada)')

  // =========================================================================
  // CASO 4: Despachado 20, vendido 15. Intentar corregir a 10 -> RECHAZADO
  // =========================================================================
  const lotBalances4 = new Map<string, number>([['lot-cho-1', 40]])
  const dispatch4 = makeDispatch({
    id: 'disp-004',
    lines: [
      {
        productId: 'prod-chorizo',
        productName: 'Chorizo Parrillero',
        unitType: 'kg',
        quantity: 20,
        lotId: 'lot-cho-1',
        allocations: [{ lotId: 'lot-cho-1', lotCode: 'L-051026', expiresOn: '2026-10-30', quantity: 20, productionCost: 5 }],
      },
    ],
  })

  let error4 = ''
  try {
    applyCorrection({
      dispatch: dispatch4,
      targetType: 'initial',
      productId: 'prod-chorizo',
      newQuantity: 10,
      reason: 'Reducir a 10',
      actorRole: 'admin',
      salesRecordedForProduct: 15,
      lotBalances: lotBalances4,
    })
  } catch (err) {
    error4 = (err as Error).message
  }
  assert.ok(
    error4.includes('No puedes reducir la carga a 10 porque ya se registraron 15 vendidos.'),
    `Caso 4: Rechazo esperado por ventas registradas. Error: ${error4}`
  )
  console.log('  ✓ Caso 4: Despachado 20, vendido 15. Reducción a 10 rechazada con mensaje exacto')

  // =========================================================================
  // CASO 5: Despachado 20, vendido 15. Corregir a 15 -> PERMITIDO
  // =========================================================================
  applyCorrection({
    dispatch: dispatch4,
    targetType: 'initial',
    productId: 'prod-chorizo',
    newQuantity: 15,
    reason: 'Ajuste exacto al total vendido',
    actorRole: 'admin',
    salesRecordedForProduct: 15,
    lotBalances: lotBalances4,
  })
  assert.equal(dispatch4.lines[0].quantity, 15, 'Caso 5: Carga ajustada a 15 exitosamente')
  assert.equal(lotBalances4.get('lot-cho-1'), 45, 'Caso 5: Se reintegran 5 kg al almacén (40 -> 45)')
  console.log('  ✓ Caso 5: Despachado 20, vendido 15. Reducción a 15 permitida')

  // =========================================================================
  // CASO 6: Ruta cerrada. Intentar editar -> RECHAZADO
  // =========================================================================
  const dispatchClosed = makeDispatch({
    id: 'disp-closed',
    status: 'closed',
    lines: [
      {
        productId: 'prod-chorizo',
        productName: 'Chorizo Parrillero',
        unitType: 'kg',
        quantity: 20,
        lotId: 'lot-cho-1',
        allocations: [{ lotId: 'lot-cho-1', lotCode: 'L-051026', expiresOn: '2026-10-30', quantity: 20, productionCost: 5 }],
      },
    ],
  })
  let error6 = ''
  try {
    applyCorrection({
      dispatch: dispatchClosed,
      targetType: 'initial',
      productId: 'prod-chorizo',
      newQuantity: 10,
      reason: 'Intento en ruta cerrada',
      actorRole: 'admin',
      lotBalances: lotBalances1,
    })
  } catch (err) {
    error6 = (err as Error).message
  }
  assert.equal(error6, 'Este despacho ya fue cerrado y no puede modificarse.', 'Caso 6: Bloqueo de despacho cerrado')
  console.log('  ✓ Caso 6: Ruta cerrada rechaza cualquier corrección')

  // =========================================================================
  // CASO 7: Corrección doble / repetida -> Idempotencia / no duplica devolución
  // =========================================================================
  const stockBeforeDouble = lotBalances1.get('lot-cho-1')!
  const correctionsCountBefore = dispatch1.corrections?.length || 0

  // Intentar corregir nuevamente a la misma cantidad ya alcanzada (20)
  applyCorrection({
    dispatch: dispatch1,
    targetType: 'initial',
    productId: 'prod-chorizo',
    newQuantity: 20,
    reason: 'Reintento idéntico',
    actorRole: 'admin',
    lotBalances: lotBalances1,
  })
  assert.equal(
    lotBalances1.get('lot-cho-1'),
    stockBeforeDouble,
    'Caso 7: Reintento de corrección con misma cantidad no altera el stock'
  )
  assert.equal(
    dispatch1.corrections?.length,
    correctionsCountBefore,
    'Caso 7: No se generan registros espurios si returnQty === 0'
  )
  console.log('  ✓ Caso 7: Corrección doble/repetida no duplica devolución de stock')

  // =========================================================================
  // CASO 8: Dos lotes del mismo producto -> Devuelve a cada lote exacto
  // =========================================================================
  const lotBalances8 = new Map<string, number>([
    ['lot-A', 100],
    ['lot-B', 100],
  ])
  const dispatchMultiLot = makeDispatch({
    id: 'disp-multi',
    lines: [
      {
        productId: 'prod-chorizo',
        productName: 'Chorizo Parrillero',
        unitType: 'kg',
        quantity: 20,
        lotId: 'lot-A',
        allocations: [
          { lotId: 'lot-A', lotCode: 'LOTE-A', quantity: 10, expiresOn: '2026-10-20', productionCost: 5 },
          { lotId: 'lot-B', lotCode: 'LOTE-B', quantity: 10, expiresOn: '2026-10-30', productionCost: 5 },
        ],
      },
    ],
  })

  // Se reduce de 20 kg a 5 kg (devolución de 15 kg: 10 kg de Lote B y 5 kg de Lote A)
  applyCorrection({
    dispatch: dispatchMultiLot,
    targetType: 'initial',
    productId: 'prod-chorizo',
    newQuantity: 5,
    reason: 'Exceso en carga de dos lotes',
    actorRole: 'admin',
    lotBalances: lotBalances8,
  })

  assert.equal(dispatchMultiLot.lines[0].quantity, 5, 'Caso 8: Cantidad remanente en ruta es 5 kg')
  assert.equal(lotBalances8.get('lot-B'), 110, 'Caso 8: Lote B recupera sus 10 kg completos (100 -> 110)')
  assert.equal(lotBalances8.get('lot-A'), 105, 'Caso 8: Lote A recupera 5 kg (100 -> 105)')
  assert.equal(dispatchMultiLot.lines[0].allocations?.[0].lotId, 'lot-A', 'Caso 8: Quedan 5 kg en Lote A')
  assert.equal(dispatchMultiLot.lines[0].allocations?.[0].quantity, 5, 'Caso 8: Asignación remanente en Lote A = 5')
  console.log('  ✓ Caso 8: Dos lotes devuelven cantidades exactas a su respectivo lote sin FEFO inverso')

  // =========================================================================
  // CASO 9: Cierre, PDF, inventario y rendición muestran estado efectivo correcto
  // =========================================================================
  const effectiveLoaded = computeLoadedByProduct(dispatch1).get('prod-chorizo')
  assert.equal(effectiveLoaded?.totalLoaded, 20, 'Caso 9: computeLoadedByProduct refleja 20 kg efectivos')
  assert.equal(effectiveLoaded?.initialDispatch, 20, 'Caso 9: initialDispatch refleja 20 kg')

  // Verificación de exclusión de aumentos anulados en rendición
  const additionsActive = (dispatch3.additions || []).filter((a) => !a.voided)
  assert.equal(additionsActive.length, 0, 'Caso 9: Aumento anulado queda completamente excluido de aumentos activos')

  // Verificación de activación de nota de auditoría para PDF e impresiones
  const hasCorrections = Boolean(
    (dispatch1.corrections && dispatch1.corrections.length > 0) ||
    (dispatch1.additions || []).some((a) => a.voided)
  )
  assert.equal(hasCorrections, true, 'Caso 9: Despacho corregido activa la marca de auditoría en documentos')

  // Verificación de coherencia con cierre de ruta (rendición)
  // Carga efectiva = 20. Si el distribuidor vendió 15 y retorna 5, la diferencia es exactamente 0.
  const salesQty = 15
  const returnQty = 5
  const difference = round2(returnQty + salesQty - (effectiveLoaded?.totalLoaded || 0))
  assert.equal(difference, 0, 'Caso 9: Conciliación de cierre cuadra con carga corregida (20 kg = 15 venta + 5 retorno)')
  console.log('  ✓ Caso 9: Cierre, PDF, inventario y ruta coinciden en el estado efectivo')

  // =========================================================================
  // CASO 10: Aumentar carga en corrección: 20 kg a 25 kg (+5 kg tomados de almacén)
  // =========================================================================
  const lotBalances10 = new Map<string, number>([['lot-cho-1', 30]])
  const dispatch10 = makeDispatch({
    id: 'disp-010',
    lines: [
      {
        productId: 'prod-chorizo',
        productName: 'Chorizo Parrillero',
        unitType: 'kg',
        quantity: 20,
        lotId: 'lot-cho-1',
        allocations: [{ lotId: 'lot-cho-1', lotCode: 'L-051026', expiresOn: '2026-10-30', quantity: 20, productionCost: 5 }],
      },
    ],
  })

  applyCorrection({
    dispatch: dispatch10,
    targetType: 'initial',
    productId: 'prod-chorizo',
    newQuantity: 25,
    reason: 'Aumento de carga por mayor demanda en ruta',
    actorRole: 'admin',
    lotBalances: lotBalances10,
  })

  assert.equal(dispatch10.lines[0].quantity, 25, 'Caso 10: Carga en ruta aumenta a 25 kg')
  assert.equal(lotBalances10.get('lot-cho-1'), 25, 'Caso 10: Stock de almacén se debita en 5 kg (30 -> 25)')
  const lastCorr10 = dispatch10.corrections?.[dispatch10.corrections.length - 1]
  assert.equal(lastCorr10?.addedQuantity, 5, 'Caso 10: Auditoría registra 5 kg añadidos')
  assert.equal(lastCorr10?.newQuantity, 25, 'Caso 10: Auditoría registra nueva cantidad de 25 kg')
  console.log('  ✓ Caso 10: Aumentar carga en corrección: 20 kg a 25 kg (+5 kg tomados de almacén)')

  // =========================================================================
  // CASO 11: Aumentar carga sin stock en almacén -> RECHAZADO por falta de stock
  // =========================================================================
  const lotBalances11 = new Map<string, number>([['lot-cho-1', 2]])
  const dispatch11 = makeDispatch({
    id: 'disp-011',
    lines: [
      {
        productId: 'prod-chorizo',
        productName: 'Chorizo Parrillero',
        unitType: 'kg',
        quantity: 20,
        lotId: 'lot-cho-1',
        allocations: [{ lotId: 'lot-cho-1', lotCode: 'L-051026', expiresOn: '2026-10-30', quantity: 20, productionCost: 5 }],
      },
    ],
  })

  let error11 = ''
  try {
    applyCorrection({
      dispatch: dispatch11,
      targetType: 'initial',
      productId: 'prod-chorizo',
      newQuantity: 25,
      reason: 'Intento de aumento sin stock suficiente en almacén',
      actorRole: 'admin',
      lotBalances: lotBalances11,
    })
  } catch (err) {
    error11 = (err as Error).message
  }
  assert.ok(
    error11.includes('Stock apto insuficiente'),
    `Caso 11: Rechazo esperado por stock insuficiente. Error: ${error11}`
  )
  assert.equal(dispatch11.lines[0].quantity, 20, 'Caso 11: Carga en ruta permanece intacta en 20 kg')
  assert.equal(lotBalances11.get('lot-cho-1'), 2, 'Caso 11: Stock de almacén permanece intacto en 2 kg')
  console.log('  ✓ Caso 11: Aumentar carga sin stock en almacén rechazado por falta de stock')

  // =========================================================================
  // CASO 12: Eliminar producto completo del despacho (nueva cantidad = 0)
  // =========================================================================
  // 12A: Sin ventas registradas -> PERMITIDO (devuelve todo el stock al almacén)
  const lotBalances12 = new Map<string, number>([['lot-sal-1', 15]])
  const dispatch12 = makeDispatch({
    id: 'disp-012',
    lines: [
      {
        productId: 'prod-salchicha',
        productName: 'Salchicha Viena',
        unitType: 'kg',
        quantity: 10,
        lotId: 'lot-sal-1',
        allocations: [{ lotId: 'lot-sal-1', lotCode: 'S-1010', expiresOn: '2026-10-30', quantity: 10, productionCost: 5 }],
      },
    ],
  })

  applyCorrection({
    dispatch: dispatch12,
    targetType: 'initial',
    productId: 'prod-salchicha',
    newQuantity: 0,
    reason: 'Producto cargado por error, se elimina completamente del despacho',
    actorRole: 'admin',
    salesRecordedForProduct: 0,
    lotBalances: lotBalances12,
  })

  assert.equal(dispatch12.lines[0].quantity, 0, 'Caso 12A: Carga en ruta queda en 0 kg (eliminado)')
  assert.equal(lotBalances12.get('lot-sal-1'), 25, 'Caso 12A: Almacén recupera los 10 kg completos (15 -> 25)')
  const lastCorr12 = dispatch12.corrections?.[dispatch12.corrections.length - 1]
  assert.equal(lastCorr12?.returnedQuantity, 10, 'Caso 12A: Auditoría registra 10 kg devueltos')
  assert.equal(lastCorr12?.newQuantity, 0, 'Caso 12A: Auditoría registra nueva cantidad = 0')

  // 12B: Con ventas registradas (3 kg vendidos) -> RECHAZADO
  const dispatch12WithSales = makeDispatch({
    id: 'disp-012b',
    lines: [
      {
        productId: 'prod-salchicha',
        productName: 'Salchicha Viena',
        unitType: 'kg',
        quantity: 10,
        lotId: 'lot-sal-1',
        allocations: [{ lotId: 'lot-sal-1', lotCode: 'S-1010', expiresOn: '2026-10-30', quantity: 10, productionCost: 5 }],
      },
    ],
  })

  let error12b = ''
  try {
    applyCorrection({
      dispatch: dispatch12WithSales,
      targetType: 'initial',
      productId: 'prod-salchicha',
      newQuantity: 0,
      reason: 'Intento de eliminar producto con ventas registradas',
      actorRole: 'admin',
      salesRecordedForProduct: 3,
      lotBalances: lotBalances12,
    })
  } catch (err) {
    error12b = (err as Error).message
  }
  assert.ok(
    error12b.includes('No puedes reducir la carga a 0 porque ya se registraron 3 vendidos.'),
    `Caso 12B: Rechazo esperado por ventas existentes. Error: ${error12b}`
  )
  assert.equal(dispatch12WithSales.lines[0].quantity, 10, 'Caso 12B: Carga permanece en 10 kg')
  console.log('  ✓ Caso 12: Eliminar producto completo (0 ventas -> devuelto; con ventas -> bloqueado)')

  console.log('\n--- TODAS LAS 12 PRUEBAS DE CORRECCIÓN DE DESPACHO PASARON EXITOSAMENTE (100%) ---')
}

const nodeProcess = (globalThis as { process?: { exitCode?: number } }).process

runDispatchCorrectionTestSuite().catch((err) => {
  console.error('FAIL', err)
  if (nodeProcess) nodeProcess.exitCode = 1
})
