import type { DistDispatch, DistSale } from '../types.ts'

export interface DispatchMermaSettlementPreview {
  normalLoaded: number
  physicalLoaded: number
  dispatchMermaSent: number
  normalExpectedReturn: number
  /** Cantidad de merma ya descontada por las ventas nominales sobre la carga normal. */
  nominalMermaIncludedInSales: number
  /** Peso adicional no cobrado que almacén confirma que salió dentro de bolsas vendidas. */
  additionalMermaIncludedInSales: number
  /** Cantidad que aún requiere retorno, no apto o una confirmación física explícita. */
  pendingPhysicalMerma: number
  includedInSales: number
  expectedPhysicalReturn: number
  eligible: boolean
  fullyReturned: boolean
}

const kg = (value: number) => Math.round((Number(value) || 0) * 1000) / 1000

/**
 * Conservative UI preview. The server repeats the reconciliation against the
 * transactionally loaded route balance before moving any stock.
 */
export function previewDispatchMermaSettlement(
  dispatch: DistDispatch | null,
  sales: DistSale[],
  productId: string,
  actualNormalReturn: number,
  recoverableMermaReturn: number,
  unfitReturn: number,
  embeddedMermaInSalesConfirmed = false,
): DispatchMermaSettlementPreview {
  const lines = dispatch
    ? [
        ...(dispatch.lines || []),
        ...(dispatch.additions || []).filter((addition) => !addition.voided && !addition.voidedAt)
          .flatMap((addition) => addition.quantityByProduct || []),
      ].filter((line) => line.productId === productId)
    : []
  const dispatchMermaSent = kg(lines.reduce((sum, line) => sum + (Number(line.dispatchMerma) || 0), 0))
  const normalLoaded = kg(lines.reduce((sum, line) => {
    const merma = Number(line.dispatchMerma) || 0
    return sum + (Number.isFinite(Number(line.normalQuantity))
      ? Number(line.normalQuantity)
      : Math.max(0, (Number(line.quantity) || 0) - merma))
  }, 0))
  const effectiveSales = sales.filter((sale) => !sale.voidedAt && !sale.pendingConfirmation)
  let sold = 0
  let courtesy = 0
  for (const sale of effectiveSales) {
    const effective = sale.effectiveSnapshot ? { ...sale, ...sale.effectiveSnapshot } : sale
    for (const line of effective.lines || []) {
      if (line.productId !== productId) continue
      if (effective.saleKind === 'courtesy') courtesy += Number(line.quantity) || 0
      else sold += Number(line.quantity) || 0
    }
  }
  const signedNormalExpectedReturn = kg(normalLoaded - sold - courtesy)
  const normalExpectedReturn = Math.max(0, signedNormalExpectedReturn)
  const nominalMermaIncludedInSales = kg(Math.min(dispatchMermaSent, Math.max(0, sold - normalLoaded)))
  const remainingMermaAfterNominalSales = kg(Math.max(0, dispatchMermaSent - nominalMermaIncludedInSales))
  const physicalExpectedReturn = kg(Math.max(0, signedNormalExpectedReturn + dispatchMermaSent))
  const validInputs = [actualNormalReturn, recoverableMermaReturn, unfitReturn].every(Number.isFinite)
  const aboveNormalCase = signedNormalExpectedReturn < 0
  const eligibleAboveNormal = Boolean(dispatch && dispatchMermaSent > 0 && aboveNormalCase && sold > normalLoaded && courtesy === 0 && validInputs
    && -signedNormalExpectedReturn <= dispatchMermaSent + 0.001
    && Math.abs(kg(actualNormalReturn)) <= 0.001
    && recoverableMermaReturn >= 0 && unfitReturn >= 0
    && recoverableMermaReturn + unfitReturn <= remainingMermaAfterNominalSales + 0.001)
  const fullyReturned = Boolean(dispatch && dispatchMermaSent > 0 && validInputs && unfitReturn === 0
    && !aboveNormalCase
    && Math.abs(kg(actualNormalReturn) - normalExpectedReturn) <= 0.001
    && Math.abs(kg(recoverableMermaReturn) - dispatchMermaSent) <= 0.001)
  const eligibleStandard = Boolean(dispatch && dispatchMermaSent > 0 && (sold > 0 || fullyReturned) && validInputs
    && !aboveNormalCase
    && Math.abs(kg(actualNormalReturn) - normalExpectedReturn) <= 0.001
    && recoverableMermaReturn >= 0 && unfitReturn >= 0
    && recoverableMermaReturn + unfitReturn <= dispatchMermaSent + 0.001)
  const eligible = eligibleStandard || eligibleAboveNormal
  const additionalMermaIncludedInSales = eligibleAboveNormal && embeddedMermaInSalesConfirmed
    ? kg(Math.max(0, physicalExpectedReturn - actualNormalReturn - recoverableMermaReturn - unfitReturn))
    : 0
  const pendingPhysicalMerma = eligibleAboveNormal
    ? kg(Math.max(0, physicalExpectedReturn - actualNormalReturn - recoverableMermaReturn - unfitReturn - additionalMermaIncludedInSales))
    : 0
  const includedInSales = eligibleStandard
    ? kg(Math.max(0, dispatchMermaSent - recoverableMermaReturn - unfitReturn))
    : kg(nominalMermaIncludedInSales + additionalMermaIncludedInSales)
  return {
    normalLoaded,
    physicalLoaded: kg(normalLoaded + dispatchMermaSent),
    dispatchMermaSent,
    normalExpectedReturn,
    nominalMermaIncludedInSales,
    additionalMermaIncludedInSales,
    pendingPhysicalMerma,
    includedInSales,
    expectedPhysicalReturn: eligibleStandard
      ? kg(normalExpectedReturn + recoverableMermaReturn + unfitReturn)
      : kg(physicalExpectedReturn - additionalMermaIncludedInSales),
    eligible,
    fullyReturned,
  }
}
