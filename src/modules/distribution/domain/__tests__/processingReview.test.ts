import { validateRepackOperationContract, type RepackOperationInput } from '../processing.ts'

let checks = 0
function pass(condition: boolean, message: string) { if (!condition) throw new Error(message); checks++; console.log(`PASS ${message}`) }
function rejected(run: () => void, message: string) { try { run() } catch { checks++; console.log(`PASS ${message}`); return } throw new Error(message) }

const base: RepackOperationInput = {
  operationId: 'repack-op-1', repackId: 'repack-1', reviewId: 'review-1', sourceLotId: 'source-kg', reservationId: 'hold-1',
  location: 'central', expectedReviewRevision: 2, expectedReservationQuantity: 2, sourceKind: 'traditional_lot', sourceUnitType: 'kg', openedCommercialQuantity: 2,
  sourceSegments: [], openedPhysicalWeightG: 2000,
  outputs: [{ id: 'dest-1', productId: 'sku-new', commercialUnit: 'package', commercialQuantity: 8, measuredNetWeightG: 2000, lotCode: 'REPACK-1', manufacturedOn: '2026-10-28', packagedOn: '2026-10-28', expiresOn: '2026-11-10' }],
  packagingMaterials: [{ materialId: 'bag-1', quantityMilli: 8000, damagedQuantityMilli: 0, costCents: 10 }],
  additionalCostComponents: [], authorizationReference: 'QA-AUTH-REF', evidenceRefs: ['photo-evidence-1'], reason: 'Prueba de contrato de reenvasado',
}
validateRepackOperationContract(base)
pass(true, 'contrato acepta 2 kg con ocho paquetes y conserva la masa medida')
validateRepackOperationContract({ ...base, outputs: [{ ...base.outputs[0]!, commercialUnit: 'kg', commercialQuantity: 2, measuredNetWeightG: 2000 }] })
pass(true, 'contrato separa cantidad comercial y gramos medidos en salidas por kg')
rejected(() => validateRepackOperationContract({ ...base, outputs: [{ ...base.outputs[0]!, measuredNetWeightG: 1999 }] }), 'contrato rechaza masa sin destino y no completa la diferencia')
rejected(() => validateRepackOperationContract({ ...base, openedPhysicalWeightG: -1 }), 'contrato rechaza peso negativo')
rejected(() => validateRepackOperationContract({ ...base, authorizationReference: '', evidenceRefs: [] }), 'contrato exige autorización y evidencia persistida referenciada')
validateRepackOperationContract({ ...base, sourceKind: 'traditional_lot', sourceSegments: [] })
pass(true, 'lote tradicional no necesita batchId ni segmento inventado')
rejected(() => validateRepackOperationContract({ ...base, sourceKind: 'derived_lot', sourceSegments: [] }), 'lote derivado exige referencias de segmentos existentes')
const derived = { ...base, sourceKind: 'derived_lot' as const, sourceUnitType: 'package' as const, openedCommercialQuantity: 2, expectedReservationQuantity: 2, sourceSegments: [{ batchId: 'batch-1', segmentId: 'segment-1' }] }
validateRepackOperationContract(derived)
pass(true, 'lote derivado acepta selectores de segmentos sin confiar en cantidades/costos del cliente')
rejected(() => validateRepackOperationContract({ ...derived, sourceSegments: [{ batchId: 'b', segmentId: 's' }, { batchId: 'b', segmentId: 's' }] }), 'contrato rechaza segmentos duplicados')
rejected(() => validateRepackOperationContract({ ...base, openedPhysicalWeightG: 2000.5 }), 'contrato rechaza gramos fraccionarios')
rejected(() => validateRepackOperationContract({ ...base, expectedReservationQuantity: 1 }), 'contrato impide abrir más cantidad de la reserva esperada')
rejected(() => validateRepackOperationContract({ ...base, outputs: [{ ...base.outputs[0]!, commercialQuantity: 8.5 }] }), 'contrato exige cantidades comerciales enteras para paquetes')
rejected(() => validateRepackOperationContract({ ...base, outputs: [{ ...base.outputs[0]!, expiresOn: '2026-02-30' }] }), 'contrato rechaza fechas de vencimiento inválidas')
rejected(() => validateRepackOperationContract({ ...base, outputs: [base.outputs[0]!, { ...base.outputs[0]! }] }), 'contrato rechaza destinos de salida repetidos')
console.log(`processing review domain: ${checks} checks PASS`)
