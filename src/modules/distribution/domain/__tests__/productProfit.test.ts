import { computeProductProfitReport } from '../productProfit.ts'
import { round2 } from '../engine.ts'
import type { DistClaim, DistExpense, DistSale, DistSaleLine, DistStockMovement } from '../../types.ts'

let passed = 0
let failed = 0

function ok(condition: boolean, msg: string) {
  if (condition) {
    passed++
    console.log(`PASS: ${msg}`)
  } else {
    failed++
    console.error(`FAIL: ${msg}`)
  }
}

function makeSale(partial: Partial<DistSale> & { id: string; total: number; lines: DistSaleLine[] }): DistSale {
  return {
    operationId: 'VTA-' + partial.id,
    restaurantId: 'sanjose',
    branchId: 'central',
    schemaVersion: 1,
    sourceLocation: 'route',
    routeId: 'route-1',
    routeName: 'Ruta Norte',
    sellerUid: 'seller-1',
    sellerName: 'Juan Pérez',
    dayKey: '2026-10-07',
    paymentKind: 'cash',
    cashAmount: partial.total,
    qrAmount: 0,
    creditAmount: 0,
    createdAt: '2026-10-07T10:00:00Z',
    createdBy: 'seller-1',
    ...partial,
  }
}

function makeExpense(partial: Partial<DistExpense> & { id: string; amount: number }): DistExpense {
  return {
    operationId: 'GAS-' + partial.id,
    restaurantId: 'sanjose',
    branchId: 'central',
    schemaVersion: 1,
    routeId: 'route-1',
    routeName: 'Ruta Norte',
    concept: 'Gasto general',
    dayKey: '2026-10-07',
    createdAt: '2026-10-07T10:00:00Z',
    registeredByUid: 'seller-1',
    registeredByName: 'Juan Pérez',
    createdBy: 'seller-1',
    ...partial,
  }
}

console.log('=== Iniciando pruebas unitarias: Reporte de Ganancias por Producto ===')

// -------------------------------------------------------------
// CASO 1: Venta regular con costos históricos completos
// -------------------------------------------------------------
{
  const sales: DistSale[] = [
    makeSale({
      id: 'sale-1',
      total: 100,
      lines: [
        {
          productId: 'prod-chorizo',
          productNameSnapshot: 'Chorizo Parrillero',
          presentationSnapshot: 'Paquete 1 kg',
          unitType: 'package',
          quantity: 2,
          actualUnitPrice: 50,
          subtotal: 100,
          costTotal: 60, // 30 Bs/u de costo histórico
        },
      ],
    }),
  ]

  const report = computeProductProfitReport(sales)
  const item = report.items.find((i) => i.productId === 'prod-chorizo')

  ok(Boolean(item), 'Caso 1: Producto encontrado en items')
  ok(item?.salesBs === 100, 'Caso 1: Ventas Bs = 100')
  ok(item?.costBs === 60, 'Caso 1: Costo Bs = 60')
  ok(item?.profitBs === 40, 'Caso 1: Ganancia Bruta = 40 (100 - 60)')
  ok(item?.marginPct === 40, 'Caso 1: Margen Pct = 40% (40 / 100)')
  ok(item?.costKnown === true, 'Caso 1: Costo conocido es true')
  ok(report.totals.profitBs === 40, 'Caso 1: Total ganancia del reporte = 40')
}

// -------------------------------------------------------------
// CASO 2: Venta histórica con costo faltante (no inventar ganancia falsa)
// -------------------------------------------------------------
{
  const sales: DistSale[] = [
    makeSale({
      id: 'sale-hist-1',
      dayKey: '2026-10-05',
      total: 80,
      lines: [
        {
          productId: 'prod-viena',
          productNameSnapshot: 'Salchicha Viena',
          unitType: 'package',
          quantity: 4,
          actualUnitPrice: 20,
          subtotal: 80,
          // costTotal no está presente
        },
      ],
    }),
  ]

  const report = computeProductProfitReport(sales)
  const item = report.items.find((i) => i.productId === 'prod-viena')

  ok(item?.costKnown === false, 'Caso 2: costKnown debe ser false')
  ok(item?.costBs === null, 'Caso 2: costBs debe ser null')
  ok(item?.profitBs === null, 'Caso 2: profitBs debe ser null (no inventa ganancia)')
  ok(item?.marginPct === null, 'Caso 2: marginPct debe ser null')
  ok(report.totals.costKnown === false, 'Caso 2: Reporte totals.costKnown debe ser false')
  ok(report.totals.profitBs === null, 'Caso 2: Reporte totals.profitBs debe ser null')
  ok(report.totals.hasHistoricalMissingCosts === true, 'Caso 2: hasHistoricalMissingCosts es true')
}

// -------------------------------------------------------------
// CASO 3: Costo congelado en allocations (respeta lotes asignados)
// -------------------------------------------------------------
{
  const sales: DistSale[] = [
    makeSale({
      id: 'sale-alloc-1',
      total: 120,
      lines: [
        {
          productId: 'prod-jamon',
          productNameSnapshot: 'Jamón Especial',
          unitType: 'kg',
          quantity: 3,
          actualUnitPrice: 40,
          subtotal: 120,
          allocations: [
            { lotId: 'lot-1', lotCode: 'L-001', expiresOn: '2026-12-31', quantity: 2, productionCost: 25 },
            { lotId: 'lot-2', lotCode: 'L-002', expiresOn: '2026-12-31', quantity: 1, productionCost: 28 },
          ], // Costo total calculado: (2*25) + (1*28) = 78
        },
      ],
    }),
  ]

  const report = computeProductProfitReport(sales)
  const item = report.items.find((i) => i.productId === 'prod-jamon')

  ok(item?.costBs === 78, 'Caso 3: Costo desde allocations debe ser 78')
  ok(item?.profitBs === 42, 'Caso 3: Ganancia = 120 - 78 = 42')
  ok(item?.marginPct === 35, 'Caso 3: Margen = (42 / 120) * 100 = 35%')
}

// -------------------------------------------------------------
// CASO 4: Venta corregida con reducción de cantidad (effectiveSnapshot)
// -------------------------------------------------------------
{
  const sales: DistSale[] = [
    makeSale({
      id: 'sale-corr-1',
      total: 300,
      latestCorrectionId: 'corr-01',
      editedAt: '2026-10-07T14:00:00Z',
      editedBy: 'admin',
      editReason: 'Cliente solo se quedó con 6 kg de los 10 kg',
      // Líneas efectivas vigentes tras la corrección:
      lines: [
        {
          productId: 'prod-chorizo',
          productNameSnapshot: 'Chorizo Parrillero',
          unitType: 'kg',
          quantity: 6, // Reducido de 10 a 6
          actualUnitPrice: 30,
          subtotal: 180,
          costTotal: 120, // 20 Bs/kg * 6 kg
        },
      ],
    }),
  ]

  const report = computeProductProfitReport(sales)
  const item = report.items.find((i) => i.productId === 'prod-chorizo')

  ok(item?.quantity === 6, 'Caso 4: Cantidad efectiva es 6')
  ok(item?.salesBs === 180, 'Caso 4: Venta efectiva es 180 Bs')
  ok(item?.costBs === 120, 'Caso 4: Costo efectivo es 120 Bs')
  ok(item?.profitBs === 60, 'Caso 4: Ganancia efectiva es 60 Bs')
  ok(item?.lineDetails[0].isCorrected === true, 'Caso 4: Marca de corregida en detalle')
}

// -------------------------------------------------------------
// CASO 5: Venta corregida con eliminación de producto erróneo
// -------------------------------------------------------------
{
  const sales: DistSale[] = [
    makeSale({
      id: 'sale-corr-del',
      total: 50,
      latestCorrectionId: 'corr-del-1',
      lines: [
        // Mortadela fue eliminada completamente en la corrección, solo queda Salame
        {
          productId: 'prod-salame',
          productNameSnapshot: 'Salame Milano',
          unitType: 'package',
          quantity: 1,
          actualUnitPrice: 50,
          subtotal: 50,
          costTotal: 30,
        },
      ],
    }),
  ]

  const report = computeProductProfitReport(sales)
  const mortadela = report.items.find((i) => i.productId === 'prod-mortadela')
  const salame = report.items.find((i) => i.productId === 'prod-salame')

  ok(mortadela === undefined, 'Caso 5: Producto eliminado no aparece en reporte de ganancias')
  ok(salame?.profitBs === 20, 'Caso 5: Solo aparece el producto que permaneció')
}

// -------------------------------------------------------------
// CASO 6: Venta corregida con línea agregada
// -------------------------------------------------------------
{
  const sales: DistSale[] = [
    makeSale({
      id: 'sale-corr-add',
      total: 100,
      latestCorrectionId: 'corr-add-1',
      lines: [
        {
          productId: 'prod-chorizo',
          productNameSnapshot: 'Chorizo Parrillero',
          unitType: 'kg',
          quantity: 2,
          actualUnitPrice: 30,
          subtotal: 60,
          costTotal: 40,
        },
        {
          productId: 'prod-tocino',
          productNameSnapshot: 'Tocino Ahumado',
          unitType: 'package',
          quantity: 1,
          actualUnitPrice: 40,
          subtotal: 40,
          costTotal: 25,
        },
      ],
    }),
  ]

  const report = computeProductProfitReport(sales)
  ok(report.items.length === 2, 'Caso 6: Hay 2 productos tras la corrección')
  ok(report.totals.salesBs === 100, 'Caso 6: Total ventas = 100 Bs')
  ok(report.totals.costBs === 65, 'Caso 6: Total costo = 65 Bs')
  ok(report.totals.profitBs === 35, 'Caso 6: Total ganancia = 35 Bs')
}

// -------------------------------------------------------------
// CASO 7: Reclamo por Devolución (kind: return)
// -------------------------------------------------------------
{
  const sales: DistSale[] = [
    makeSale({
      id: 'sale-ret-1',
      total: 200,
      lines: [
        {
          productId: 'prod-chorizo',
          productNameSnapshot: 'Chorizo Parrillero',
          unitType: 'kg',
          quantity: 10,
          actualUnitPrice: 20,
          subtotal: 200,
          costTotal: 140, // 14 Bs/kg
        },
      ],
    }),
  ]

  const claims: DistClaim[] = [
    {
      id: 'claim-ret-1',
      kind: 'return',
      saleId: 'sale-ret-1',
      customerId: 'cust-1',
      customerName: 'Tienda Central',
      productId: 'prod-chorizo',
      productName: 'Chorizo Parrillero',
      quantity: 2,
      unitType: 'kg',
      reason: 'Empaque defectuoso',
      routeId: 'route-1',
      createdAt: '2026-10-07T11:00:00Z',
      dayKey: '2026-10-07',
      revenueDelta: -40, // 2 kg * 20 Bs
      additionalCost: -28, // Costo de los 2 kg que regresan al almacén
      debtReduction: 0,
      cashIn: 0,
      cashOut: 40,
      qrIn: 0,
      qrOut: 0,
      replacement: null,
    },
  ]

  const report = computeProductProfitReport(sales, claims)
  const item = report.items.find((i) => i.productId === 'prod-chorizo')

  ok(item?.quantity === 8, 'Caso 7: Cantidad neta = 10 - 2 = 8 kg')
  ok(item?.salesBs === 160, 'Caso 7: Ventas netas = 200 - 40 = 160 Bs')
  ok(item?.costBs === 112, 'Caso 7: Costo neto = 140 - 28 = 112 Bs')
  ok(item?.profitBs === 48, 'Caso 7: Ganancia neta = 160 - 112 = 48 Bs')
}

// -------------------------------------------------------------
// CASO 8: Reclamo por Cambio (kind: exchange)
// -------------------------------------------------------------
{
  const sales: DistSale[] = [
    makeSale({
      id: 'sale-ex-1',
      total: 50,
      lines: [
        {
          productId: 'prod-mortadela',
          productNameSnapshot: 'Mortadela Clásica',
          unitType: 'package',
          quantity: 2,
          actualUnitPrice: 25,
          subtotal: 50,
          costTotal: 30, // 15 Bs/u
        },
      ],
    }),
  ]

  // Se cambia 1 mortadela (25 Bs) por 1 salame (30 Bs) cobrando +5 Bs
  const claims: DistClaim[] = [
    {
      id: 'claim-ex-1',
      kind: 'exchange',
      saleId: 'sale-ex-1',
      customerId: 'cust-1',
      customerName: 'Don Luis',
      productId: 'prod-mortadela',
      productName: 'Mortadela Clásica',
      quantity: 1,
      unitType: 'package',
      reason: 'Cliente prefirió salame',
      routeId: 'route-1',
      createdAt: '2026-10-07T12:00:00Z',
      dayKey: '2026-10-07',
      revenueDelta: 5, // Diferencia de precio cobrada al cliente
      additionalCost: 18, // Costo de producción del producto nuevo entregado
      debtReduction: 0,
      cashIn: 5,
      cashOut: 0,
      qrIn: 0,
      qrOut: 0,
      replacement: {
        productId: 'prod-salame',
        productName: 'Salame Milano',
        quantity: 1,
        unitType: 'package',
        total: 30,
      },
    },
  ]

  const report = computeProductProfitReport(sales, claims)
  const mortadela = report.items.find((i) => i.productId === 'prod-mortadela')
  const salame = report.items.find((i) => i.productId === 'prod-salame')

  // Mortadela: vendió 2 por 50, se devolvió 1 valorada en 25 -> neto venta: 25 Bs
  ok(mortadela?.quantity === 1, 'Caso 8: Mortadela cantidad neta = 1')
  ok(mortadela?.salesBs === 25, 'Caso 8: Mortadela venta neta = 25 Bs')

  // Salame: entregado 1 por 30 Bs con costo 18 Bs
  ok(salame?.quantity === 1, 'Caso 8: Salame cantidad = 1')
  ok(salame?.salesBs === 30, 'Caso 8: Salame venta = 30 Bs')
  ok(salame?.costBs === 18, 'Caso 8: Salame costo = 18 Bs')
  ok(salame?.profitBs === 12, 'Caso 8: Salame ganancia = 12 Bs')

  // Total ingresos del reporte = 25 + 30 = 55 Bs (coincide con sale.total 50 + claim.revenueDelta 5)
  ok(report.totals.salesBs === 55, 'Caso 8: Total ventas = 55 Bs')
  // Total costos = 30 (mortadela original) + 18 (salame) = 48 Bs
  ok(report.totals.costBs === 48, 'Caso 8: Total costo = 48 Bs')
  ok(report.totals.profitBs === 7, 'Caso 8: Total ganancia = 55 - 48 = 7 Bs')
}

// -------------------------------------------------------------
// CASO 9: Gastos de ruta y mermas (Ganancia Operativa Estimada)
// -------------------------------------------------------------
{
  const sales: DistSale[] = [
    makeSale({
      id: 'sale-op-1',
      total: 500,
      lines: [
        {
          productId: 'prod-chorizo',
          productNameSnapshot: 'Chorizo Parrillero',
          unitType: 'kg',
          quantity: 10,
          actualUnitPrice: 50,
          subtotal: 500,
          costTotal: 300, // Ganancia bruta de productos = 200 Bs
        },
      ],
    }),
  ]

  const expenses: DistExpense[] = [
    makeExpense({
      id: 'exp-1',
      amount: 40,
      concept: 'Gasolina',
    }),
  ]

  const movements: DistStockMovement[] = [
    {
      id: 'mov-loss-1',
      type: 'shortage',
      productId: 'prod-chorizo',
      productName: 'Chorizo Parrillero',
      unitType: 'kg',
      quantity: 1,
      centralDelta: 0,
      routeDelta: -1,
      branchId: 'central',
      createdBy: 'admin',
      schemaVersion: 1,
      lossCost: 30, // Merma de 30 Bs
      dayKey: '2026-10-07',
      createdAt: '2026-10-07T18:00:00Z',
      routeId: 'route-1',
      restaurantId: 'sanjose',
    },
  ]

  const report = computeProductProfitReport(sales, [], expenses, movements, ['2026-10-07'])

  ok(report.totals.profitBs === 200, 'Caso 9: Ganancia bruta de productos = 200 Bs')
  ok(report.operationalTotals.spent === 40, 'Caso 9: Gastos de ruta = 40 Bs')
  ok(report.operationalTotals.lossCost === 30, 'Caso 9: Mermas = 30 Bs')
  // Ganancia operativa = 200 - 40 - 30 = 130 Bs
  ok(report.operationalTotals.operatingProfit === 130, 'Caso 9: Ganancia Operativa = 130 Bs')
}

// -------------------------------------------------------------
// CASO 10: Agrupación por días
// -------------------------------------------------------------
{
  const sales: DistSale[] = [
    makeSale({
      id: 'sale-day-1',
      dayKey: '2026-10-06',
      total: 100,
      lines: [
        {
          productId: 'prod-chorizo',
          productNameSnapshot: 'Chorizo Parrillero',
          unitType: 'kg',
          quantity: 2,
          actualUnitPrice: 50,
          subtotal: 100,
          costTotal: 60,
        },
      ],
    }),
    makeSale({
      id: 'sale-day-2',
      dayKey: '2026-10-07',
      total: 200,
      lines: [
        {
          productId: 'prod-chorizo',
          productNameSnapshot: 'Chorizo Parrillero',
          unitType: 'kg',
          quantity: 4,
          actualUnitPrice: 50,
          subtotal: 200,
          costTotal: 120,
        },
      ],
    }),
  ]

  const report = computeProductProfitReport(sales)

  ok(report.dayGroups.length === 2, 'Caso 10: Existen 2 grupos de días')
  const g1 = report.dayGroups.find((g) => g.dayKey === '2026-10-06')
  const g2 = report.dayGroups.find((g) => g.dayKey === '2026-10-07')

  ok(g1?.daySalesBs === 100, 'Caso 10: Día 1 ventas = 100')
  ok(g1?.dayCostBs === 60, 'Caso 10: Día 1 costo = 60')
  ok(g1?.dayProfitBs === 40, 'Caso 10: Día 1 ganancia = 40')

  ok(g2?.daySalesBs === 200, 'Caso 10: Día 2 ventas = 200')
  ok(g2?.dayCostBs === 120, 'Caso 10: Día 2 costo = 120')
  ok(g2?.dayProfitBs === 80, 'Caso 10: Día 2 ganancia = 80')

  ok(
    round2((g1?.dayProfitBs || 0) + (g2?.dayProfitBs || 0)) === report.totals.profitBs,
    'Caso 10: Suma de subtotales por día iguala al total del periodo (120 Bs)',
  )
}

// -------------------------------------------------------------
// CASO 11: RECONCILIACIÓN OBLIGATORIA CON RESUMEN (engine.ts / Margen Bruto)
// -------------------------------------------------------------
{
  const sales: DistSale[] = [
    makeSale({
      id: 'rec-sale-1',
      total: 350,
      lines: [
        {
          productId: 'p-viena',
          productNameSnapshot: 'Salchicha Viena',
          unitType: 'package',
          quantity: 10,
          actualUnitPrice: 20,
          subtotal: 200,
          costTotal: 130,
        },
        {
          productId: 'p-chorizo',
          productNameSnapshot: 'Chorizo Parrillero',
          unitType: 'kg',
          quantity: 5,
          actualUnitPrice: 30,
          subtotal: 150,
          costTotal: 95,
        },
      ],
    }),
    makeSale({
      id: 'rec-sale-2',
      routeId: 'route-2',
      routeName: 'Ruta 2',
      sellerUid: 's-2',
      sellerName: 'Vendedor 2',
      total: 280,
      paymentKind: 'credit',
      cashAmount: 0,
      creditAmount: 280,
      lines: [
        {
          productId: 'p-mortadela',
          productNameSnapshot: 'Mortadela Familiar',
          unitType: 'package',
          quantity: 7,
          actualUnitPrice: 40,
          subtotal: 280,
          costTotal: 175,
        },
      ],
    }),
  ]

  const claims: DistClaim[] = [
    // 1 Devolución de 2 paquetes de viena (-40 Bs en ventas, -26 Bs en costo)
    {
      id: 'rec-claim-1',
      kind: 'return',
      saleId: 'rec-sale-1',
      customerId: 'c-1',
      customerName: 'Cliente 1',
      productId: 'p-viena',
      productName: 'Salchicha Viena',
      quantity: 2,
      unitType: 'package',
      reason: 'Vencimiento próximo',
      routeId: 'route-1',
      createdAt: '2026-10-07T14:00:00Z',
      dayKey: '2026-10-07',
      revenueDelta: -40,
      additionalCost: -26,
      debtReduction: 0,
      cashIn: 0,
      cashOut: 40,
      qrIn: 0,
      qrOut: 0,
      replacement: null,
    },
    // 1 Cambio: 1 mortadela (40 Bs) por 2 kg de chorizo (60 Bs). revenueDelta = +20 Bs, additionalCost = +38 Bs
    {
      id: 'rec-claim-2',
      kind: 'exchange',
      saleId: 'rec-sale-2',
      customerId: 'c-2',
      customerName: 'Cliente 2',
      productId: 'p-mortadela',
      productName: 'Mortadela Familiar',
      quantity: 1,
      unitType: 'package',
      reason: 'Cambio de producto solicitado por cliente',
      routeId: 'route-2',
      createdAt: '2026-10-07T15:00:00Z',
      dayKey: '2026-10-07',
      revenueDelta: 20,
      additionalCost: 38,
      debtReduction: 0,
      cashIn: 20,
      cashOut: 0,
      qrIn: 0,
      qrOut: 0,
      replacement: {
        productId: 'p-chorizo',
        productName: 'Chorizo Parrillero',
        quantity: 2,
        unitType: 'kg',
        total: 60,
      },
    },
  ]

  const expenses: DistExpense[] = [
    makeExpense({
      id: 'rec-exp-1',
      amount: 45,
      concept: 'Almuerzos',
    }),
  ]

  const movements: DistStockMovement[] = [
    {
      id: 'rec-mov-1',
      type: 'shortage',
      productId: 'p-chorizo',
      productName: 'Chorizo Parrillero',
      unitType: 'kg',
      quantity: 1,
      centralDelta: 0,
      routeDelta: -1,
      branchId: 'central',
      createdBy: 'admin',
      schemaVersion: 1,
      lossCost: 19,
      dayKey: '2026-10-07',
      createdAt: '2026-10-07T17:00:00Z',
      routeId: 'route-1',
      restaurantId: 'sanjose',
    },
  ]

  // Cálculo canónico del Resumen (tal como lo hace reportExports.ts y engine.ts):
  const lines = sales.flatMap((s) => s.lines)
  const resumenRevenue = round2(
    sales.reduce((n, s) => n + s.total, 0) + claims.reduce((n, c) => n + c.revenueDelta, 0),
  )
  const resumenCost = round2(
    lines.reduce((n, l) => n + (l.costTotal || 0), 0) +
      claims.reduce((n, c) => n + (c.additionalCost || 0), 0),
  )
  const resumenGrossProfit = round2(resumenRevenue - resumenCost)
  const resumenSpent = round2(expenses.reduce((n, e) => n + e.amount, 0))
  const resumenLossCost = round2(movements.reduce((n, m) => n + (m.lossCost || 0), 0))
  const resumenOperatingProfit = round2(resumenGrossProfit - resumenSpent - resumenLossCost)

  // Cálculo con computeProductProfitReport:
  const profitReport = computeProductProfitReport(
    sales,
    claims,
    expenses,
    movements,
    ['2026-10-07'],
  )

  // Reconciliación:
  const deltaRevenue = Math.abs(profitReport.totals.salesBs - resumenRevenue)
  const deltaCost = Math.abs((profitReport.totals.costBs ?? 0) - resumenCost)
  const deltaGrossProfit = Math.abs((profitReport.totals.profitBs ?? 0) - resumenGrossProfit)
  const deltaOperatingProfit = Math.abs(
    (profitReport.operationalTotals.operatingProfit ?? 0) - resumenOperatingProfit,
  )

  ok(
    deltaRevenue < 0.001,
    `Caso 11: Reconciliación Ventas Netas exactas ($0.00 diff): ProfitReport=${profitReport.totals.salesBs} vs Resumen=${resumenRevenue}`,
  )
  ok(
    deltaCost < 0.001,
    `Caso 11: Reconciliación Costos exactos ($0.00 diff): ProfitReport=${profitReport.totals.costBs} vs Resumen=${resumenCost}`,
  )
  ok(
    deltaGrossProfit < 0.001,
    `Caso 11: Reconciliación Margen Bruto exacto ($0.00 diff): ProfitReport=${profitReport.totals.profitBs} vs Resumen=${resumenGrossProfit}`,
  )
  ok(
    deltaOperatingProfit < 0.001,
    `Caso 11: Reconciliación Ganancia Operativa exacta ($0.00 diff): ProfitReport=${profitReport.operationalTotals.operatingProfit} vs Resumen=${resumenOperatingProfit}`,
  )
}

console.log(`\n========================================`)
console.log(`Resultado final: ${passed} pasadas, ${failed} fallidas.`)
console.log(`========================================\n`)

if (failed > 0) {
  throw new Error(`Fallaron ${failed} pruebas unitarias en productProfit.test.ts`)
}
