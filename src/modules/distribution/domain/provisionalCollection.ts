import { round2 } from './engine.ts'
import type { DistCollection, DistReceivable } from '../types.ts'

export type ProvisionalCollectionSnapshot = Pick<DistCollection,
  'customerCode' | 'portfolioBalanceBefore' | 'portfolioBalanceAfter' | 'allocations' | 'saleLines' | 'receivableId'
>

/** Mirrors the server's FIFO order so a locally accepted receipt is useful before sync. */
export function buildProvisionalCollectionSnapshot(
  receivables: DistReceivable[],
  amount: number,
  customerCode?: string,
): ProvisionalCollectionSnapshot {
  const debts = receivables
    .filter(receivable => receivable.balance > 0)
    .sort((a, b) => (a.sourceDate || a.createdAt).localeCompare(b.sourceDate || b.createdAt) || a.id.localeCompare(b.id))
  const portfolioBalanceBefore = round2(debts.reduce((sum, receivable) => sum + receivable.balance, 0))
  let remaining = round2(amount)
  const allocations: NonNullable<DistCollection['allocations']> = []
  for (const receivable of debts) {
    if (remaining <= 0) break
    const applied = round2(Math.min(remaining, receivable.balance))
    if (applied <= 0) continue
    allocations.push({
      receivableId: receivable.id,
      amount: applied,
      sourceType: receivable.sourceType || 'sale',
      saleId: receivable.saleId || '',
    })
    remaining = round2(remaining - applied)
  }
  if (remaining > 0.009) throw new Error('El saldo disponible no alcanza para distribuir este cobro.')
  const firstDebt = debts[0]
  return {
    customerCode: customerCode || firstDebt?.customerCode || '',
    portfolioBalanceBefore,
    portfolioBalanceAfter: round2(portfolioBalanceBefore - amount),
    allocations,
    receivableId: allocations[0]?.receivableId || '',
    saleLines: firstDebt?.saleLines || [],
  }
}
