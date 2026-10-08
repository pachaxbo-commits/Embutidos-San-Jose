import type {
  DistClaim,
  DistExpense,
  DistSale,
  DistSaleLine,
  DistStockMovement,
  UnitType,
} from '../types.ts'
import { round2, toDayKey } from './engine.ts'

export interface ProductProfitLineDetail {
  saleId: string
  createdAt: string
  dayKey: string
  voucherCode: string
  customerName: string
  sellerName: string
  routeName: string
  productId: string
  productName: string
  presentation: string
  unitType: UnitType
  quantity: number
  actualUnitPrice: number
  saleBs: number
  costBs: number | null
  profitBs: number | null
  marginPct: number | null
  isCorrected: boolean
  isClaimRelated: boolean
  claimKind?: 'return' | 'exchange'
  claimReason?: string
}

export interface ProductProfitSummaryItem {
  productId: string
  productName: string
  presentation: string
  unitType: UnitType
  quantity: number
  salesBs: number
  costBs: number | null
  profitBs: number | null
  marginPct: number | null
  unitCostBs: number | null
  costKnown: boolean
  saleLinesCount: number
  claimsCount: number
  lineDetails: ProductProfitLineDetail[]
}

export interface ProductProfitDayGroup {
  dayKey: string
  dateLabel: string
  items: ProductProfitSummaryItem[]
  daySalesBs: number
  dayCostBs: number | null
  dayProfitBs: number | null
  dayMarginPct: number | null
  costKnown: boolean
}

export interface ProductProfitTotals {
  salesBs: number
  costBs: number | null
  profitBs: number | null
  marginPct: number | null
  costKnown: boolean
  hasHistoricalMissingCosts: boolean
  quantityTotal: number
}

export interface ProductProfitOperationalTotals {
  isAvailable: boolean
  spent: number
  lossCost: number
  operatingProfit: number | null
  reasonNotAvailable?: string
}

export interface ProductProfitReport {
  items: ProductProfitSummaryItem[]
  dayGroups: ProductProfitDayGroup[]
  allLineDetails: ProductProfitLineDetail[]
  totals: ProductProfitTotals
  operationalTotals: ProductProfitOperationalTotals
}

function formatDayLabel(dayKey: string): string {
  if (!dayKey) return ''
  const parts = dayKey.split('-').map(Number)
  if (parts.length === 3) {
    const d = new Date(parts[0], parts[1] - 1, parts[2], 12, 0, 0)
    return d.toLocaleDateString('es-BO', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    })
  }
  return dayKey
}

/**
 * Calcula de manera autoritativa la ganancia por producto y su reconciliación
 * exacta con el Margen Bruto del Resumen y la Ganancia Operativa Estimada.
 */
export function computeProductProfitReport(
  sales: DistSale[],
  claims: DistClaim[] = [],
  expenses: DistExpense[] = [],
  movements: DistStockMovement[] = [],
  dayKeys: string[] = [],
  routeFilter?: string,
  sellerFilter?: string,
): ProductProfitReport {
  const lineDetails: ProductProfitLineDetail[] = []

  // 1. Procesar líneas de ventas efectivas (respetando correcciones auditadas)
  for (const sale of sales) {
    const isCorrected = Boolean(
      sale.latestCorrectionId || sale.editedAt || (sale.revisions && sale.revisions.length > 0),
    )
    const effectiveLines: DistSaleLine[] = sale.lines || []

    for (const line of effectiveLines) {
      if (line.quantity <= 0) continue

      const saleBs = round2(line.subtotal)

      // Obtener costo histórico congelado:
      let costBs: number | null = null
      if (typeof line.costTotal === 'number') {
        costBs = round2(line.costTotal)
      } else if (
        Array.isArray(line.allocations) &&
        line.allocations.length > 0 &&
        line.allocations.every((a) => a.productionCost !== null)
      ) {
        costBs = round2(
          line.allocations.reduce((sum, a) => sum + a.quantity * (a.productionCost || 0), 0),
        )
      }

      let profitBs: number | null = null
      let marginPct: number | null = null
      if (costBs !== null) {
        profitBs = round2(saleBs - costBs)
        marginPct = saleBs > 0 ? round2((profitBs / saleBs) * 100) : 0
      }

      lineDetails.push({
        saleId: sale.id,
        createdAt: sale.createdAt,
        dayKey: sale.dayKey || toDayKey(sale.createdAt),
        voucherCode: sale.operationId || sale.id.slice(-6).toUpperCase(),
        customerName: sale.customerName || 'Contado',
        sellerName: sale.sellerName || '',
        routeName: sale.routeName || '',
        productId: line.productId,
        productName: line.productNameSnapshot,
        presentation: line.presentationSnapshot || line.descriptionSnapshot || '',
        unitType: line.unitType,
        quantity: round2(line.quantity),
        actualUnitPrice: line.actualUnitPrice,
        saleBs,
        costBs,
        profitBs,
        marginPct,
        isCorrected,
        isClaimRelated: false,
      })
    }
  }

  // 2. Procesar cambios y devoluciones (DistClaim)
  for (const claim of claims) {
    const dayKey = claim.dayKey || toDayKey(claim.createdAt)
    const voucher = `REC-${claim.id.slice(-5).toUpperCase()}`

    if (claim.kind === 'return') {
      // Devolución simple: disminuye ventas del producto devuelto
      const returnRevenueDelta = round2(claim.revenueDelta) // típicamente negativo
      const returnCost = typeof claim.additionalCost === 'number' ? round2(claim.additionalCost) : 0

      lineDetails.push({
        saleId: claim.saleId,
        createdAt: claim.createdAt,
        dayKey,
        voucherCode: voucher,
        customerName: claim.customerName,
        sellerName: claim.sellerName || '',
        routeName: claim.routeId || '',
        productId: claim.productId,
        productName: claim.productName,
        presentation: '',
        unitType: claim.unitType,
        quantity: round2(-claim.quantity),
        actualUnitPrice: 0,
        saleBs: returnRevenueDelta,
        costBs: returnCost,
        profitBs: round2(returnRevenueDelta - returnCost),
        marginPct: null,
        isCorrected: false,
        isClaimRelated: true,
        claimKind: 'return',
        claimReason: claim.reason,
      })
    } else if (claim.kind === 'exchange') {
      // Cambio con reemplazo:
      // a) Devolución del producto original
      const replacementTotal = claim.replacement ? round2(claim.replacement.total) : 0
      const returnedValue = round2(replacementTotal - claim.revenueDelta)

      lineDetails.push({
        saleId: claim.saleId,
        createdAt: claim.createdAt,
        dayKey,
        voucherCode: voucher,
        customerName: claim.customerName,
        sellerName: claim.sellerName || '',
        routeName: claim.routeId || '',
        productId: claim.productId,
        productName: claim.productName,
        presentation: '',
        unitType: claim.unitType,
        quantity: round2(-claim.quantity),
        actualUnitPrice: 0,
        saleBs: round2(-returnedValue),
        costBs: 0,
        profitBs: round2(-returnedValue),
        marginPct: null,
        isCorrected: false,
        isClaimRelated: true,
        claimKind: 'exchange',
        claimReason: `Devuelto por cambio: ${claim.reason}`,
      })

      // b) Salida del producto de reemplazo
      if (claim.replacement) {
        const repCost =
          typeof claim.additionalCost === 'number' ? round2(claim.additionalCost) : null
        const repProfit = repCost !== null ? round2(replacementTotal - repCost) : null
        const repMargin =
          repProfit !== null && replacementTotal > 0
            ? round2((repProfit / replacementTotal) * 100)
            : null

        lineDetails.push({
          saleId: claim.saleId,
          createdAt: claim.createdAt,
          dayKey,
          voucherCode: voucher,
          customerName: claim.customerName,
          sellerName: claim.sellerName || '',
          routeName: claim.routeId || '',
          productId: claim.replacement.productId,
          productName: claim.replacement.productName,
          presentation: '',
          unitType: claim.replacement.unitType,
          quantity: round2(claim.replacement.quantity),
          actualUnitPrice: round2(replacementTotal / (claim.replacement.quantity || 1)),
          saleBs: replacementTotal,
          costBs: repCost,
          profitBs: repProfit,
          marginPct: repMargin,
          isCorrected: false,
          isClaimRelated: true,
          claimKind: 'exchange',
          claimReason: `Entregado como reemplazo: ${claim.reason}`,
        })
      }
    }
  }

  // 3. Agrupación por producto
  const productMap = new Map<string, {
    productName: string
    presentation: string
    unitType: UnitType
    quantity: number
    salesBs: number
    costBsSum: number
    costKnown: boolean
    saleLinesCount: number
    claimsCount: number
    lineDetails: ProductProfitLineDetail[]
  }>()

  for (const detail of lineDetails) {
    let entry = productMap.get(detail.productId)
    if (!entry) {
      entry = {
        productName: detail.productName,
        presentation: detail.presentation,
        unitType: detail.unitType,
        quantity: 0,
        salesBs: 0,
        costBsSum: 0,
        costKnown: true,
        saleLinesCount: 0,
        claimsCount: 0,
        lineDetails: [],
      }
      productMap.set(detail.productId, entry)
    }

    entry.quantity = round2(entry.quantity + detail.quantity)
    entry.salesBs = round2(entry.salesBs + detail.saleBs)
    entry.lineDetails.push(detail)

    if (detail.isClaimRelated) {
      entry.claimsCount++
    } else {
      entry.saleLinesCount++
    }

    if (detail.presentation && !entry.presentation) {
      entry.presentation = detail.presentation
    }

    if (detail.costBs !== null) {
      entry.costBsSum = round2(entry.costBsSum + detail.costBs)
    } else {
      entry.costKnown = false
    }
  }

  const items: ProductProfitSummaryItem[] = []
  for (const [productId, p] of productMap) {
    const costBs = p.costKnown ? p.costBsSum : null
    let profitBs: number | null = null
    let marginPct: number | null = null
    let unitCostBs: number | null = null

    if (costBs !== null) {
      profitBs = round2(p.salesBs - costBs)
      marginPct = p.salesBs > 0 ? round2((profitBs / p.salesBs) * 100) : 0
      unitCostBs = p.quantity > 0 ? round2(costBs / p.quantity) : null
    }

    items.push({
      productId,
      productName: p.productName,
      presentation: p.presentation,
      unitType: p.unitType,
      quantity: p.quantity,
      salesBs: p.salesBs,
      costBs,
      profitBs,
      marginPct,
      unitCostBs,
      costKnown: p.costKnown,
      saleLinesCount: p.saleLinesCount,
      claimsCount: p.claimsCount,
      lineDetails: p.lineDetails.sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    })
  }

  // Ordenar productos por ganancia bruta descendente (o ventas si no hay costo)
  items.sort((a, b) => {
    if (a.profitBs !== null && b.profitBs !== null) {
      return b.profitBs - a.profitBs
    }
    return b.salesBs - a.salesBs
  })

  // 4. Totales del reporte
  const totalSalesBs = round2(items.reduce((s, i) => s + i.salesBs, 0))
  const allCostsKnown = items.length === 0 || items.every((i) => i.costKnown)
  const totalCostBs = allCostsKnown ? round2(items.reduce((s, i) => s + (i.costBs ?? 0), 0)) : null
  const totalProfitBs = totalCostBs !== null ? round2(totalSalesBs - totalCostBs) : null
  const totalMarginPct =
    totalProfitBs !== null && totalSalesBs > 0
      ? round2((totalProfitBs / totalSalesBs) * 100)
      : null
  const totalQuantity = round2(items.reduce((s, i) => s + i.quantity, 0))

  const totals: ProductProfitTotals = {
    salesBs: totalSalesBs,
    costBs: totalCostBs,
    profitBs: totalProfitBs,
    marginPct: totalMarginPct,
    costKnown: allCostsKnown,
    hasHistoricalMissingCosts: !allCostsKnown,
    quantityTotal: totalQuantity,
  }

  // 5. Agrupación por día (para PDF y visualización temporal)
  const dayMap = new Map<string, ProductProfitLineDetail[]>()
  for (const detail of lineDetails) {
    const list = dayMap.get(detail.dayKey) || []
    list.push(detail)
    dayMap.set(detail.dayKey, list)
  }

  const dayKeysSorted = Array.from(dayMap.keys()).sort()
  const dayGroups: ProductProfitDayGroup[] = []

  for (const dayKey of dayKeysSorted) {
    const dayLines = dayMap.get(dayKey) || []
    const dayProductMap = new Map<string, {
      productName: string
      presentation: string
      unitType: UnitType
      quantity: number
      salesBs: number
      costBsSum: number
      costKnown: boolean
      lineDetails: ProductProfitLineDetail[]
    }>()

    for (const dl of dayLines) {
      let dep = dayProductMap.get(dl.productId)
      if (!dep) {
        dep = {
          productName: dl.productName,
          presentation: dl.presentation,
          unitType: dl.unitType,
          quantity: 0,
          salesBs: 0,
          costBsSum: 0,
          costKnown: true,
          lineDetails: [],
        }
        dayProductMap.set(dl.productId, dep)
      }
      dep.quantity = round2(dep.quantity + dl.quantity)
      dep.salesBs = round2(dep.salesBs + dl.saleBs)
      dep.lineDetails.push(dl)
      if (dl.costBs !== null) {
        dep.costBsSum = round2(dep.costBsSum + dl.costBs)
      } else {
        dep.costKnown = false
      }
    }

    const dayItems: ProductProfitSummaryItem[] = []
    for (const [prodId, dp] of dayProductMap) {
      const dayProdCost = dp.costKnown ? dp.costBsSum : null
      const dayProdProfit = dayProdCost !== null ? round2(dp.salesBs - dayProdCost) : null
      const dayProdMargin =
        dayProdProfit !== null && dp.salesBs > 0
          ? round2((dayProdProfit / dp.salesBs) * 100)
          : null

      dayItems.push({
        productId: prodId,
        productName: dp.productName,
        presentation: dp.presentation,
        unitType: dp.unitType,
        quantity: dp.quantity,
        salesBs: dp.salesBs,
        costBs: dayProdCost,
        profitBs: dayProdProfit,
        marginPct: dayProdMargin,
        unitCostBs: dp.quantity > 0 && dayProdCost !== null ? round2(dayProdCost / dp.quantity) : null,
        costKnown: dp.costKnown,
        saleLinesCount: dp.lineDetails.filter((l) => !l.isClaimRelated).length,
        claimsCount: dp.lineDetails.filter((l) => l.isClaimRelated).length,
        lineDetails: dp.lineDetails,
      })
    }

    dayItems.sort((a, b) => (b.profitBs ?? b.salesBs) - (a.profitBs ?? a.salesBs))

    const daySalesBs = round2(dayItems.reduce((s, i) => s + i.salesBs, 0))
    const dayCostKnown = dayItems.every((i) => i.costKnown)
    const dayCostBs = dayCostKnown ? round2(dayItems.reduce((s, i) => s + (i.costBs ?? 0), 0)) : null
    const dayProfitBs = dayCostBs !== null ? round2(daySalesBs - dayCostBs) : null
    const dayMarginPct =
      dayProfitBs !== null && daySalesBs > 0 ? round2((dayProfitBs / daySalesBs) * 100) : null

    dayGroups.push({
      dayKey,
      dateLabel: formatDayLabel(dayKey),
      items: dayItems,
      daySalesBs,
      dayCostBs,
      dayProfitBs,
      dayMarginPct,
      costKnown: dayCostKnown,
    })
  }

  // 6. Resultado Operativo Estimado (compatibilidad idéntica a Resumen)
  const spent = round2(expenses.reduce((n, e) => n + e.amount, 0))
  const losses = movements
    .filter((m) => dayKeys.length === 0 || dayKeys.includes(m.dayKey || toDayKey(m.createdAt)))
    .filter((m) => !routeFilter || m.routeId === routeFilter)
    .filter((m) => m.type === 'shortage' || (m.type === 'adjustment' && m.centralDelta < 0))
  const lossCost = round2(losses.reduce((n, l) => n + (l.lossCost || 0), 0))

  let operationalTotals: ProductProfitOperationalTotals
  if (sellerFilter) {
    operationalTotals = {
      isAvailable: false,
      spent,
      lossCost: 0,
      operatingProfit: null,
      reasonNotAvailable:
        'Las pérdidas de inventario y gastos de ruta no se asignan por vendedor individual.',
    }
  } else if (!allCostsKnown) {
    operationalTotals = {
      isAvailable: false,
      spent,
      lossCost,
      operatingProfit: null,
      reasonNotAvailable:
        'Hay ventas históricas sin costo registrado; no se estima un resultado operativo falso.',
    }
  } else {
    const operatingProfit = round2((totalProfitBs ?? 0) - spent - lossCost)
    operationalTotals = {
      isAvailable: true,
      spent,
      lossCost,
      operatingProfit,
    }
  }

  return {
    items,
    dayGroups,
    allLineDetails: lineDetails.sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    totals,
    operationalTotals,
  }
}
