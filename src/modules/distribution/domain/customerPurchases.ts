import { round2, toDayKey } from './engine.ts'
import type { DistSale, DistProduct, UnitType, DistCustomer } from '../types.ts'
import { getLinePresentation } from './productPresentation.ts'

export interface CustomerPurchasesData {
  sales: DistSale[]
  products: DistProduct[]
  customers: DistCustomer[]
}

export interface CustomerPurchasedProduct {
  productId: string
  productName: string
  presentation: string
  unitType: UnitType
  quantity: number
  exactKg: number
  estimatedKg: number
  totalEquivalentKg: number
  totalBs: number
  purchasesCount: number
}

export interface CustomerPurchaseSummary {
  customerId: string
  customerName: string
  customerCode: string
  routeNames: string[]
  purchasesCount: number
  totalBs: number
  exactKg: number
  estimatedKg: number
  totalEquivalentKg: number
  totalPackages: number
  kgBreakdown: string
  products: CustomerPurchasedProduct[]
}

export interface CustomerPurchasesAggregation {
  clients: CustomerPurchaseSummary[]
  topClient: CustomerPurchaseSummary | null
  grandTotalBs: number
  grandTotalExactKg: number
  grandTotalEstimatedKg: number
  grandTotalEquivalentKg: number
  grandTotalPackages: number
  grandTotalPurchasesCount: number
}

export function formatKgBreakdown(exactKg: number, estimatedKg: number): string {
  const total = round2(exactKg + estimatedKg)
  const exactFmt = exactKg.toLocaleString('es-BO', { minimumFractionDigits: 1, maximumFractionDigits: 2 })
  const estFmt = estimatedKg.toLocaleString('es-BO', { minimumFractionDigits: 1, maximumFractionDigits: 2 })
  const totalFmt = total.toLocaleString('es-BO', { minimumFractionDigits: 1, maximumFractionDigits: 2 })

  if (estimatedKg > 0 && exactKg > 0) {
    return `${totalFmt} kg equiv. (${exactFmt} kg exactos + ${estFmt} est.)`
  }
  if (estimatedKg > 0) {
    return `${totalFmt} kg estimados`
  }
  return `${exactFmt} kg exactos`
}

/**
 * Función única de agregación para compras por cliente.
 *
 * Utilizada por:
 * - Vista Web interactiva (ReportsView)
 * - Reporte PDF agrupado (reportExports / exportPdf)
 * - Reporte Excel (hoja resumen y hoja detalle)
 */
export function aggregateCustomerPurchases(
  data: CustomerPurchasesData,
  dayKeys: string[],
  routeFilter = '',
  sellerFilter = '',
): CustomerPurchasesAggregation {
  const inScope = (sale: DistSale) =>
    dayKeys.includes(sale.dayKey || toDayKey(sale.createdAt)) &&
    (!routeFilter || sale.routeId === routeFilter) &&
    (!sellerFilter || sale.sellerUid === sellerFilter) &&
    !sale.pendingConfirmation

  const sales = data.sales.filter(inScope)
  const productsMap = new Map<string, DistProduct>(data.products.map((p: DistProduct) => [p.id, p]))
  const customersMap = new Map<string, DistCustomer>(data.customers.map((c: DistCustomer) => [c.id, c]))

  const clientsMap = new Map<string, {
    customerId: string
    customerName: string
    customerCode: string
    routeSet: Set<string>
    purchasesCount: number
    totalBs: number
    exactKg: number
    estimatedKg: number
    totalPackages: number
    productsMap: Map<string, CustomerPurchasedProduct>
  }>()

  for (const sale of sales) {
    const rawCustomerId = sale.customerId || ''
    const customerObj = rawCustomerId ? customersMap.get(rawCustomerId) : null
    const key = rawCustomerId || `anon-${sale.customerName || 'Contado'}`
    const customerName = sale.customerName || customerObj?.name || 'Cliente ocasional'
    const customerCode = sale.customerCode || customerObj?.customerCode || customerObj?.identityNumber || ''

    let clientEntry = clientsMap.get(key)
    if (!clientEntry) {
      clientEntry = {
        customerId: rawCustomerId || key,
        customerName,
        customerCode,
        routeSet: new Set(),
        purchasesCount: 0,
        totalBs: 0,
        exactKg: 0,
        estimatedKg: 0,
        totalPackages: 0,
        productsMap: new Map(),
      }
      clientsMap.set(key, clientEntry)
    }

    clientEntry.purchasesCount += 1
    if (sale.routeName) clientEntry.routeSet.add(sale.routeName)

    for (const line of sale.lines) {
      const product = productsMap.get(line.productId)
      const subtotal = round2(line.subtotal)
      clientEntry.totalBs = round2(clientEntry.totalBs + subtotal)

      let lineExactKg = 0
      let lineEstimatedKg = 0

      if (line.unitType === 'kg') {
        lineExactKg = round2(line.quantity)
        clientEntry.exactKg = round2(clientEntry.exactKg + lineExactKg)
      } else {
        clientEntry.totalPackages += line.quantity
        const approx = product?.approximateWeightKg || 0
        lineEstimatedKg = round2(line.quantity * approx)
        clientEntry.estimatedKg = round2(clientEntry.estimatedKg + lineEstimatedKg)
      }

      const prodKey = line.productId
      let prodEntry = clientEntry.productsMap.get(prodKey)
      if (!prodEntry) {
        prodEntry = {
          productId: line.productId,
          productName: line.productNameSnapshot || product?.name || 'Producto',
          presentation: getLinePresentation(line, product),
          unitType: line.unitType,
          quantity: 0,
          exactKg: 0,
          estimatedKg: 0,
          totalEquivalentKg: 0,
          totalBs: 0,
          purchasesCount: 0,
        }
        clientEntry.productsMap.set(prodKey, prodEntry)
      }

      prodEntry.quantity = round2(prodEntry.quantity + line.quantity)
      prodEntry.exactKg = round2(prodEntry.exactKg + lineExactKg)
      prodEntry.estimatedKg = round2(prodEntry.estimatedKg + lineEstimatedKg)
      prodEntry.totalEquivalentKg = round2(prodEntry.exactKg + prodEntry.estimatedKg)
      prodEntry.totalBs = round2(prodEntry.totalBs + subtotal)
      prodEntry.purchasesCount += 1
    }
  }

  const clients: CustomerPurchaseSummary[] = [...clientsMap.values()]
    .map((entry) => {
      const totalEquivalentKg = round2(entry.exactKg + entry.estimatedKg)
      const products = [...entry.productsMap.values()].sort((a, b) => b.totalBs - a.totalBs)
      return {
        customerId: entry.customerId,
        customerName: entry.customerName,
        customerCode: entry.customerCode,
        routeNames: [...entry.routeSet],
        purchasesCount: entry.purchasesCount,
        totalBs: entry.totalBs,
        exactKg: entry.exactKg,
        estimatedKg: entry.estimatedKg,
        totalEquivalentKg,
        totalPackages: entry.totalPackages,
        kgBreakdown: formatKgBreakdown(entry.exactKg, entry.estimatedKg),
        products,
      }
    })
    .sort((a, b) => b.totalBs - a.totalBs)

  const grandTotalBs = round2(clients.reduce((s, c) => s + c.totalBs, 0))
  const grandTotalExactKg = round2(clients.reduce((s, c) => s + c.exactKg, 0))
  const grandTotalEstimatedKg = round2(clients.reduce((s, c) => s + c.estimatedKg, 0))
  const grandTotalEquivalentKg = round2(grandTotalExactKg + grandTotalEstimatedKg)
  const grandTotalPackages = clients.reduce((s, c) => s + c.totalPackages, 0)
  const grandTotalPurchasesCount = clients.reduce((s, c) => s + c.purchasesCount, 0)

  return {
    clients,
    topClient: clients.length > 0 ? clients[0] : null,
    grandTotalBs,
    grandTotalExactKg,
    grandTotalEstimatedKg,
    grandTotalEquivalentKg,
    grandTotalPackages,
    grandTotalPurchasesCount,
  }
}
