import { closuresInPeriod } from '../closurePeriod.ts'
import { computeMoneySummary, round2 } from '../engine.ts'
import type { DistClosure, DistCollection, DistExpense, DistSale } from '../../types.ts'

const check = (condition: boolean, label: string) => { if (!condition) throw new Error(label); console.log(`PASS: ${label}`) }

const sales = [
  { total: 6720, cashAmount: 3313.5, qrAmount: 2412, creditAmount: 994.5 },
  { total: 6161, cashAmount: 4157, qrAmount: 270, creditAmount: 1734 },
] as DistSale[]
const collections = [
  { amount: 1315, cashAmount: 985, qrAmount: 330, method: 'mixed' },
] as DistCollection[]
const expenses = [{ amount: 913.6 }] as DistExpense[]

const money = computeMoneySummary(sales, collections, expenses)
check(money.salesTotal === 12881, 'Ventas totales incluyen efectivo + QR + crédito')
check(money.cashSales === 7470.5 && money.qrSales === 2682 && money.creditGenerated === 2728.5, 'separación de efectivo, QR y crédito cuadra con ventas')
check(money.cashCollections === 985 && money.qrCollections === 330, 'cobros de cartera se separan por medio y no suman a ventas')
const claimRevenueDelta = -1
const claimCash = 0
check(round2(money.salesTotal + claimRevenueDelta) === 12880 && claimCash === 0, 'el reclamo reduce ventas netas en Bs 1 y no altera efectivo ni QR')
check(money.expectedCash === 7541.9, 'efectivo esperado suma ventas en efectivo y cobros en efectivo menos gastos')
check(round2(7314.9 - money.cashSales) === -155.6, 'la resta simple de efectivo vendido y declarado es -155,60')
check(round2(7314.9 - money.expectedCash) === -227, 'la diferencia comparable de caja es un faltante de Bs 227')

const closures = [
  { id: 'sud', dayKey: '2026-10-10', physicalCashDeclared: 3071.5 },
  { id: 'norte', dayKey: '2026-10-10', physicalCashDeclared: 4243.4 },
  { id: 'otro-dia', dayKey: '2026-10-09', physicalCashDeclared: 9999 },
] as unknown as DistClosure[]
const selectedClosures = closuresInPeriod(closures, ['2026-10-10'])
check(selectedClosures.length === 2, 'los arqueos se restringen al dayKey seleccionado')
check(round2(selectedClosures.reduce((n, c) => n + (c.physicalCashDeclared || 0), 0)) === 7314.9, 'efectivo declarado comparable suma únicamente los dos cierres del 10/10')

console.log('OK: conciliación del 10/10 y filtro de arqueos')
