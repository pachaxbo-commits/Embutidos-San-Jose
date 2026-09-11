import type { DistClosure } from "../types.ts";
import { toDayKey } from "./engine.ts";

export function closureDayKey(closure: DistClosure): string {
  if (closure.dayKey) return closure.dayKey;
  const timestamp = closure.warehouseClosedAt || closure.closedAt || closure.createdAt;
  return timestamp ? toDayKey(new Date(timestamp)) : "";
}

export function closureHasProductDifference(closure: DistClosure): boolean {
  return closure.products.some(row => Math.abs(Number(row.variance) || 0) > 0.001);
}

export function closuresInPeriod(closures: DistClosure[], days: string[]): DistClosure[] {
  const selected = new Set(days);
  return closures.filter(closure => selected.has(closureDayKey(closure)));
}

export function pendingDifferenceClosures(closures: DistClosure[], routeId = ""): DistClosure[] {
  return closures
    .filter(closure => !routeId || closure.routeId === routeId)
    .filter(closure => ["warehouse_done", "closed"].includes(closure.status))
    .filter(closure => !closure.varianceReviewedAt && closureHasProductDifference(closure))
    .sort((a, b) =>
      (b.warehouseClosedAt || b.closedAt || b.createdAt).localeCompare(
        a.warehouseClosedAt || a.closedAt || a.createdAt,
      ),
    );
}
