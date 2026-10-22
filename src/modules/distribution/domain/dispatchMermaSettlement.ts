import type { DistDispatch, DistSale } from '../types.ts'

export interface DispatchMermaSettlementPreview {
  dispatchMermaSent: number
  normalExpectedReturn: number
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
  const normalExpectedReturn = kg(normalLoaded - sold - courtesy)
  const validInputs = [actualNormalReturn, recoverableMermaReturn, unfitReturn].every(Number.isFinite)
  const fullyReturned = Boolean(dispatch && dispatchMermaSent > 0 && validInputs && unfitReturn === 0
    && normalExpectedReturn >= 0
    && Math.abs(kg(actualNormalReturn) - normalExpectedReturn) <= 0.001
    && Math.abs(kg(recoverableMermaReturn) - dispatchMermaSent) <= 0.001)
  const eligible = Boolean(dispatch && dispatchMermaSent > 0 && (sold > 0 || fullyReturned) && validInputs
    && normalExpectedReturn >= 0
    && Math.abs(kg(actualNormalReturn) - normalExpectedReturn) <= 0.001
    && recoverableMermaReturn >= 0 && unfitReturn >= 0
    && recoverableMermaReturn + unfitReturn <= dispatchMermaSent + 0.001)
  const includedInSales = eligible ? kg(Math.max(0, dispatchMermaSent - recoverableMermaReturn - unfitReturn)) : 0
  return {
    dispatchMermaSent,
    normalExpectedReturn,
    includedInSales,
    expectedPhysicalReturn: eligible
      ? kg(normalExpectedReturn + recoverableMermaReturn + unfitReturn)
      : kg(normalExpectedReturn + dispatchMermaSent),
    eligible,
    fullyReturned,
  }
}
