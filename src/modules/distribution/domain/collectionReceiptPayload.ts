import type { PrintJobPayload } from '../../../types/printing'
import type { DistCollection } from '../types'

export interface CollectionReceiptContext {
  companyName: string
  receiptHeader?: string
  receiptFooter?: string
  taxId?: string
  address?: string
  phone?: string
}

const money = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100

export function collectionMethodLabel(collection: DistCollection): string {
  return collection.method === 'cash' ? 'EFECTIVO' : collection.method === 'qr' ? 'QR' : 'MIXTO'
}

export function collectionAllocationLabel(allocation: NonNullable<DistCollection['allocations']>[number]): string {
  if (allocation.sourceType === 'opening_balance') return 'Deuda anterior / saldo inicial'
  const number = (allocation.saleId || allocation.receivableId || '').slice(-6).toUpperCase()
  return number ? `Crédito de venta N.º ${number}` : 'Crédito de venta'
}

export function buildCollectionReceiptPayload(collection: DistCollection, context: CollectionReceiptContext): PrintJobPayload {
  const balanceDetails = collection.portfolioBalanceBefore === undefined || collection.portfolioBalanceAfter === undefined
    ? ['SALDO HISTÓRICO NO DISPONIBLE']
    : [`SALDO ANTES: ${money(collection.portfolioBalanceBefore).toFixed(2)} Bs`, `COBRADO: ${money(collection.amount).toFixed(2)} Bs`, `SALDO RESTANTE: ${money(collection.portfolioBalanceAfter).toFixed(2)} Bs`]
  const split = [(collection.cashAmount || 0) > 0 ? `EFECTIVO: ${money(collection.cashAmount || 0).toFixed(2)} Bs` : '', (collection.qrAmount || 0) > 0 ? `QR: ${money(collection.qrAmount || 0).toFixed(2)} Bs` : ''].filter(Boolean)
  const allocations: NonNullable<DistCollection['allocations']> = collection.allocations?.length ? collection.allocations : [{ receivableId: collection.receivableId || '', amount: collection.amount }]
  return {
    payloadSchemaVersion: 1, templateVersion: 'v1.0-collection-receipt', restaurantName: (context.receiptHeader || context.companyName).toUpperCase(), branchName: '',
    headerDetails: [context.taxId ? `NIT: ${context.taxId}` : '', context.address || '', context.phone ? `TEL: ${context.phone}` : ''].filter(Boolean),
    documentTitle: 'COMPROBANTE DE COBRO', itemsHeaderLabel: 'APLICACIÓN DEL PAGO', amountHeaderLabel: 'MONTO', totalLabel: 'COBRADO', hideSubtotal: true,
    orderId: collection.id, displayNumber: `COB-${collection.id.slice(-6).toUpperCase()}`, customerName: collection.customerName || 'Cliente', customerPhone: collection.customerCode ? `CI/CÓDIGO: ${collection.customerCode}` : undefined,
    items: allocations.map(allocation => ({ name: collectionAllocationLabel(allocation), basePrice: allocation.amount, quantity: 1, lineTotal: allocation.amount })),
    subtotal: collection.amount, discountTotal: 0, taxTotal: 0, deliveryFee: 0, grandTotal: collection.amount,
    paymentMethod: collectionMethodLabel(collection), paymentDetails: [...split, ...balanceDetails, `COBRADO POR: ${collection.collectedByName || 'Personal autorizado'}`],
    footerMessage: context.receiptFooter, isCopy: false, copies: 1, createdIso: collection.createdAt,
  }
}
