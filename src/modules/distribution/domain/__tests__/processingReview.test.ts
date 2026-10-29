import { validateRepackOperationContract, type RepackOperationInput } from '../processing.ts'

let checks = 0
function pass(condition: boolean, message: string) {
  if (!condition) throw new Error(message)
  checks++
  console.log(`PASS ${message}`)
}
function rejected(run: () => void, message: string) {
  try { run() } catch { checks++; console.log(`PASS ${message}`); return }
  throw new Error(message)
}

const contract: RepackOperationInput = {
  operationId: 'repack-op-1', reviewId: 'review-1', sourceLotId: 'quarantine-lot', reservationId: 'hold-1',
  location: 'central', expectedReviewRevision: 2, sourceExpiryCeiling: '2026-11-20', sourceUnitType: 'package', openedCommercialQuantity: 2,
  sourceSegments: [{ lotId: 'source-lot', batchId: 'batch-1', segmentId: 'segment-1', commercialQuantity: 2, historicalWeightG: 500, costCents: 250 }],
  openedPhysicalWeightG: 430, recoveredNetWeightG: 400, confirmedDiscardWeightG: 30,
  otherPhysicalDestinations: [],
  outputs: [{ productId: 'sku-new', commercialUnit: 'package', commercialQuantity: 2, measuredNetWeightG: 400, lotCode: 'REPACK-1', manufacturedOn: '2026-10-28', packagedOn: '2026-10-28', expiresOn: '2026-11-10' }],
  packagingMaterials: [{ materialId: 'bag-1', quantityMilli: 2000, damagedQuantityMilli: 0, costCents: 10 }],
  additionalCostComponents: [], authorizationReference: 'QA-AUTH-REF', evidenceRefs: ['photo-evidence-1'], reason: 'Prueba de contrato de reenvasado',
}
validateRepackOperationContract(contract)
pass(true, 'contrato acepta balance de masa medido sin convertir peso nominal en real')
validateRepackOperationContract({ ...contract, outputs: [{ ...contract.outputs[0]!, commercialUnit: 'kg', commercialQuantity: 0.4, measuredNetWeightG: 400 }] })
pass(true, 'contrato permite salida por kg con peso neto medido independiente de la cantidad comercial')
rejected(() => validateRepackOperationContract({ ...contract, recoveredNetWeightG: 430 }), 'contrato rechaza masa sin destino y no intenta completar la diferencia')
rejected(() => validateRepackOperationContract({ ...contract, outputs: [{ ...contract.outputs[0]!, measuredNetWeightG: 390 }] }), 'contrato exige que los nuevos envases concilien con los gramos recuperados')
rejected(() => validateRepackOperationContract({ ...contract, openedPhysicalWeightG: 500 }), 'contrato no sustituye peso histórico asignado por peso físico medido')
rejected(() => validateRepackOperationContract({ ...contract, authorizationReference: '', evidenceRefs: [] }), 'contrato exige autorización y evidencia para la operación futura')
rejected(() => validateRepackOperationContract({ ...contract, sourceSegments: [] }), 'contrato exige segmentos y lotes de origen verificables')
rejected(() => validateRepackOperationContract({ ...contract, openedPhysicalWeightG: 430.5 }), 'contrato rechaza gramos fraccionarios')
rejected(() => validateRepackOperationContract({ ...contract, outputs: [{ ...contract.outputs[0]!, commercialUnit: 'kg', commercialQuantity: 0.0001 }] }), 'contrato conserva precisión de kg a milésimas')
rejected(() => validateRepackOperationContract({ ...contract, outputs: [{ ...contract.outputs[0]!, expiresOn: '2026-12-01' }] }), 'contrato prohíbe extender el vencimiento del origen')
console.log(`processing review domain: ${checks} checks PASS`)
