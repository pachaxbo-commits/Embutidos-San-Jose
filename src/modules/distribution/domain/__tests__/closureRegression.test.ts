import { closuresInPeriod, pendingDifferenceClosures, normalizeClosure } from '../closurePeriod.ts'
import type { DistClosure } from '../../types.ts'

export async function runClosureRegressionTestSuite() {
  const results: string[] = []
  let passed = 0
  let failed = 0

  function assert(condition: boolean, message: string) {
    if (condition) {
      passed += 1
      results.push(`  ✓ ${message}`)
    } else {
      failed += 1
      results.push(`  ✗ ${message}`)
    }
  }

  // 1. Test normalizer on minimal draft document from declareRouteReturn()
  const rawDraftDoc = {
    id: 'closure_disp_123',
    restaurantId: 'sanjose',
    dispatchId: 'disp_123',
    routeId: 'route_norte',
    distributorUid: 'dist_hugo',
    distributorName: 'Hugo Herbas',
    declaredReturns: { 'prod_1': 2 },
    returnDeclaredBy: 'dist_hugo',
    returnDeclaredAt: '2026-08-14T17:30:00.000Z',
    dayKey: '2026-08-14',
  }

  const normalized = normalizeClosure(rawDraftDoc)

  assert(normalized.id === 'closure_disp_123', 'normalizer preserves document ID')
  assert(normalized.status === 'draft', 'normalizer assigns "draft" status to incomplete document')
  assert(Array.isArray(normalized.products) && normalized.products.length === 0, 'normalizer ensures products is an array')
  assert(normalized.createdAt === '2026-08-14T17:30:00.000Z', 'normalizer falls back createdAt to returnDeclaredAt')
  assert(normalized.branchId === 'main', 'normalizer provides default branchId')
  assert(normalized.expectedCash === 0 && normalized.cashDifference === 0, 'normalizer ensures financial fields are numeric')
  assert(normalized.routeName === 'Ruta no especificada', 'normalizer sets default routeName when missing')

  // 2. Test sorting behavior in ClosureView:
  // Pre-fix, sorting [closed, draft] executed `undefined.localeCompare(...)` causing TypeError.
  const historicalClosure: DistClosure = {
    id: 'closure_prev',
    restaurantId: 'sanjose',
    branchId: 'main',
    createdBy: 'hugo',
    createdAt: '2026-08-13T18:00:00.000Z',
    closedAt: '2026-08-13T19:00:00.000Z',
    dayKey: '2026-08-13',
    dispatchId: 'disp_prev',
    routeId: 'route_norte',
    routeName: 'Zona Norte',
    distributorUid: 'dist_hugo',
    distributorName: 'Hugo Herbas',
    status: 'closed',
    products: [],
    cashSales: 100,
    qrSales: 0,
    creditGenerated: 0,
    cashCollections: 0,
    qrCollections: 0,
    cashExpenses: 0,
    expectedCash: 100,
    physicalCashDeclared: 100,
    cashDifference: 0,
    schemaVersion: 1,
  }

  const getClosureSortTimestamp = (closure: DistClosure) =>
    closure.closedAt || closure.warehouseClosedAt || closure.returnDeclaredAt || closure.createdAt || ''

  const list = [historicalClosure, normalized]
  let sortCrashed = false
  try {
    list.sort((a, b) => getClosureSortTimestamp(b).localeCompare(getClosureSortTimestamp(a)))
  } catch (err) {
    sortCrashed = true
  }

  assert(!sortCrashed, 'safe comparator does not throw TypeError on draft closures')
  assert(list[0].id === 'closure_disp_123', 'more recent draft (14-Aug) sorts before previous closed (13-Aug)')

  // Test with closure completely lacking all date timestamps
  const datelessDraft = normalizeClosure({
    id: 'closure_nodate',
    restaurantId: 'sanjose',
    dispatchId: 'disp_nodate',
    routeId: 'route_norte',
    distributorUid: 'dist_hugo',
    distributorName: 'Hugo Herbas',
  })
  const datelessList = [historicalClosure, datelessDraft]
  let datelessSortCrashed = false
  try {
    datelessList.sort((a, b) => getClosureSortTimestamp(b).localeCompare(getClosureSortTimestamp(a)))
  } catch (err) {
    datelessSortCrashed = true
  }
  assert(!datelessSortCrashed, 'comparator handles completely dateless closures gracefully')

  // 3. Test closurePeriod helper resilience with draft closures
  let closuresInPeriodCrashed = false
  try {
    const periodResults = closuresInPeriod([historicalClosure, normalized], ['2026-08-14'])
    assert(periodResults.length === 1 && periodResults[0].id === 'closure_disp_123', 'closuresInPeriod correctly filters by dayKey')
  } catch (err) {
    closuresInPeriodCrashed = true
  }
  assert(!closuresInPeriodCrashed, 'closuresInPeriod handles draft closure without crashing')

  let pendingDiffCrashed = false
  try {
    const diffs = pendingDifferenceClosures([normalized, historicalClosure])
    assert(diffs.length === 0, 'pendingDifferenceClosures safely ignores draft without differences')
  } catch (err) {
    pendingDiffCrashed = true
  }
  assert(!pendingDiffCrashed, 'pendingDifferenceClosures runs safely on draft closures')

  return { passed, failed, results }
}

// Execution via command line
const nodeProcess = (globalThis as { process?: { argv?: string[]; exitCode?: number } }).process
const entryPoint = nodeProcess?.argv?.[1] ?? ''

if (entryPoint.replace(/\\/g, '/').includes('closureRegression.test')) {
  void runClosureRegressionTestSuite().then((report) => {
    report.results.forEach((line) => console.log(line))
    console.log(`\n${report.passed} passed / ${report.failed} failed`)
    if (report.failed > 0 && nodeProcess) nodeProcess.exitCode = 1
  })
}
