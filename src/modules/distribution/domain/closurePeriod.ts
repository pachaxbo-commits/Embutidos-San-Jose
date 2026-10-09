import type { DistClosure, ClosureStatus } from "../types.ts";
import { toDayKey } from "./engine.ts";

/**
 * Normaliza cualquier documento de cierre (incluyendo borradores parciales creados por el distribuidor)
 * garantizando que todos los campos requeridos por DistClosure estén presentes de forma segura.
 */
export function normalizeClosure(raw: Partial<DistClosure> & { id: string }): DistClosure {
  const createdAt = raw.createdAt || raw.returnDeclaredAt || raw.warehouseClosedAt || raw.closedAt || ''
  const status: ClosureStatus = raw.status || (raw.warehouseClosedBy ? 'warehouse_done' : 'draft')
  return {
    id: raw.id,
    restaurantId: raw.restaurantId || 'sanjose',
    branchId: raw.branchId || 'main',
    createdAt,
    createdBy: raw.createdBy || raw.returnDeclaredBy || '',
    dayKey: raw.dayKey || (createdAt ? toDayKey(new Date(createdAt)) : ''),
    schemaVersion: raw.schemaVersion ?? 1,
    dispatchId: raw.dispatchId || '',
    warehouseId: raw.warehouseId || 'central',
    routeId: raw.routeId || '',
    routeName: raw.routeName || 'Ruta no especificada',
    distributorUid: raw.distributorUid || '',
    distributorName: raw.distributorName || 'Distribuidor',
    status,
    products: Array.isArray(raw.products) ? raw.products : [],
    declaredReturns: raw.declaredReturns || {},
    returnDeclaredBy: raw.returnDeclaredBy || '',
    returnDeclaredAt: raw.returnDeclaredAt || '',
    cashSales: Number(raw.cashSales) || 0,
    qrSales: Number(raw.qrSales) || 0,
    creditGenerated: Number(raw.creditGenerated) || 0,
    cashCollections: Number(raw.cashCollections) || 0,
    qrCollections: Number(raw.qrCollections) || 0,
    cashExpenses: Number(raw.cashExpenses) || 0,
    expectedCash: Number(raw.expectedCash) || 0,
    physicalCashDeclared: raw.physicalCashDeclared != null && Number.isFinite(Number(raw.physicalCashDeclared))
      ? Number(raw.physicalCashDeclared)
      : raw.status === 'closed'
        ? 0
        : undefined,
    cashDeclaredBy: raw.cashDeclaredBy || '',
    cashDeclaredAt: raw.cashDeclaredAt || '',
    cashDifference: Number(raw.cashDifference) || 0,
    warehouseClosedBy: raw.warehouseClosedBy || '',
    warehouseClosedAt: raw.warehouseClosedAt || '',
    closedBy: raw.closedBy || '',
    closedAt: raw.closedAt || '',
    varianceReviewedAt: raw.varianceReviewedAt || '',
    varianceReviewedBy: raw.varianceReviewedBy || '',
    reopenedAt: raw.reopenedAt || '',
    reopenedBy: raw.reopenedBy || '',
  }
}

export function closureDayKey(closure: DistClosure): string {
  if (closure.dayKey) return closure.dayKey;
  const timestamp = closure.warehouseClosedAt || closure.closedAt || closure.returnDeclaredAt || closure.createdAt;
  return timestamp ? toDayKey(new Date(timestamp)) : "";
}

export function closureHasProductDifference(closure: DistClosure): boolean {
  return (closure.products || []).some(row => Math.abs(Number(row.variance) || 0) > 0.001);
}

export function closuresInPeriod(closures: DistClosure[], days: string[]): DistClosure[] {
  const selected = new Set(days);
  return closures.filter(closure => selected.has(closureDayKey(closure)));
}

export function pendingDifferenceClosures(closures: DistClosure[], routeId = ""): DistClosure[] {
  const getTimestamp = (c: DistClosure) => c.warehouseClosedAt || c.closedAt || c.returnDeclaredAt || c.createdAt || "";
  return closures
    .filter(closure => !routeId || closure.routeId === routeId)
    .filter(closure => ["warehouse_done", "closed"].includes(closure.status))
    .filter(closure => !closure.varianceReviewedAt && closureHasProductDifference(closure))
    .sort((a, b) => getTimestamp(b).localeCompare(getTimestamp(a)));
}
