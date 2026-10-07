import type { jsPDF } from "jspdf";
import type { CellHookData } from "jspdf-autotable";
import type { DistributionData } from "../state/useDistributionStore";
import type { DistCustomer, DistSale, DistSaleLine } from "../types";
import { round2, toDayKey } from "../domain/engine";
import {
  aggregateCustomerPurchases,
  type CustomerPurchasesAggregation,
  type CustomerPurchaseSummary,
  type CustomerPurchasedProduct,
} from "../domain/customerPurchases";
import {
  reportClosureLabel,
  reportDate,
  reportDateTime,
  reportMovementLabel,
  reportPaymentLabel,
  reportPersonName,
  reportQuantity,
  reportReceiptNumber,
  reportRecordName,
  reportUnitLabel,
} from "../domain/reportLabels";
import { saveReport } from "./reportFiles";
import {
  generateTodayIntakesPdfBytes,
  getTodayStockIntakes,
} from "../domain/todayIntakes";
import {
  type ReportSheetId,
  type ReportOption,
  REPORT_OPTIONS,
  ALL_REPORT_IDS,
  SHEET_NAME_TO_ID,
  ID_TO_SHEET_NAME,
  defaultSheetIdForTab,
  filterReportSheets,
} from "../domain/reportSelection";
export {
  type ReportSheetId,
  type ReportOption,
  REPORT_OPTIONS,
  ALL_REPORT_IDS,
  SHEET_NAME_TO_ID,
  ID_TO_SHEET_NAME,
  defaultSheetIdForTab,
  filterReportSheets,
};
type Cell = string | number | null;

export type ReportSaleLine = DistSaleLine & { sale?: DistSale };

export interface ReportSheetMeta {
  agg?: CustomerPurchasesAggregation;
  lines?: ReportSaleLine[];
  stockSheet?: ReportSheet;
  lotSheet?: ReportSheet;
  grossSales?: number;
  returnsDelta?: number;
  revenue?: number;
  cost?: number;
  grossMargin?: number;
  spent?: number;
  lossCost?: number;
  operatingProfit?: number;
  costKnown?: boolean;
  seller?: string;
  netFlow?: number;
  [key: string]: unknown;
}

export interface ReportSheet {
  id?: ReportSheetId;
  name: string;
  headers: string[];
  rows: Cell[][];
  meta?: ReportSheetMeta;
}

interface AutoTableJsPDF extends jsPDF {
  lastAutoTable: { finalY: number };
}

/** Historial del almacén elegido con la variación que ese movimiento produjo allí. */
export function inventoryHistorySheet(
  data: DistributionData,
  days: string[],
  warehouseId = "central",
): ReportSheet {
  const location = warehouseId === "central" ? "central" : `warehouse__${warehouseId}`;
  const warehouseName = (id?: string) => {
    if (!id || id === "central") return "Almacén central";
    return reportRecordName(data.warehouses.find(item => item.id === id)?.name, "Almacén interno");
  };
  const locationName = (value?: string) => {
    if (!value) return "Salida de inventario";
    if (value === "central") return "Almacén central";
    if (value.startsWith("warehouse__")) return warehouseName(value.slice(11));
    if (value.startsWith("route__")) {
      return reportRecordName(data.routes.find(item => item.id === value.slice(7))?.name, "Ruta registrada");
    }
    return "Ubicación registrada";
  };
  const rows = data.movements
    .filter(movement => days.includes(movement.dayKey || toDayKey(movement.createdAt)))
    .map(movement => {
      const from = movement.fromLocation || "";
      const to = movement.toLocation || "";
      const delta = to === location
        ? movement.quantity
        : from === location
          ? -movement.quantity
          : location === "central"
            ? movement.centralDelta
            : 0;
      const visibleName = reportPersonName(movement.responsibleName || movement.createdBy);
      const role = movement.responsibleRole === "admin"
        ? "Administración"
        : movement.responsibleRole === "warehouse"
          ? "Almacén"
          : "Usuario";
      return { movement, delta, responsible: visibleName === "Usuario de registro anterior" ? visibleName : `${role} · ${visibleName}` };
    })
    .filter(item => Math.abs(item.delta) > 0.0001)
    .sort((a, b) => b.movement.createdAt.localeCompare(a.movement.createdAt));

  return {
    name: "Historial de inventario",
    headers: ["Fecha y hora", "Producto", "Movimiento", "Variación", "Unidad", "Origen", "Destino", "Responsable", "Observación"],
    rows: rows.map(({ movement, delta, responsible }) => [
      reportDateTime(movement.createdAt),
      reportRecordName(movement.productName, "Producto de registro anterior"),
      reportMovementLabel(movement.type),
      round2(delta),
      reportUnitLabel(movement.unitType),
      locationName(movement.fromLocation),
      locationName(movement.toLocation),
      responsible,
      movement.note || "",
    ]),
  };
}

/**
 * Existencias actuales y desglose por lotes por almacén.
 * Función unificada utilizada por Reportes e Inventario.
 */
export function currentStockSheets(
  data: DistributionData,
  warehouseId?: string,
): ReportSheet[] {
  const warehouses = [
    { id: "central", name: "Almacén central" },
    ...data.warehouses
      .filter((warehouse) => warehouse.active)
      .map((warehouse) => ({
        id: warehouse.id,
        name: reportRecordName(warehouse.name, "Almacén registrado"),
      })),
  ].filter(
    (warehouse) => !warehouseId || warehouseId === "all" || warehouse.id === warehouseId,
  );

  const productName = (id: string, fallback?: string) =>
    reportRecordName(
      data.products.find((product) => product.id === id)?.name || fallback,
      "Producto de registro anterior",
    );
  const products = data.products.filter((product) => product.active !== false);
  const today = toDayKey(new Date());
  const alertDays = data.supportSettings?.expiryAlertDays ?? 7;

  const stockRows: Cell[][] = warehouses.flatMap((warehouse) =>
    products.map((product) => {
      const balance = data.balances.find(
        (item) =>
          item.locationKind === "central" &&
          (item.warehouseId || "central") === warehouse.id &&
          item.productId === product.id,
      );
      const physical = round2(Number(balance?.quantity) || 0);
      const available = round2(
        Number(balance?.availableQuantity ?? balance?.quantity) || 0,
      );
      const unavailable = round2(Math.max(0, physical - available));
      const minStock = product.minimumStock || 0;
      const status =
        available <= 0
          ? "Sin existencia"
          : minStock > 0 && available <= minStock
            ? "Stock bajo"
            : "Disponible";

      return [
        warehouse.name,
        reportRecordName(product.name, "Producto registrado"),
        product.presentation || product.description || "",
        physical,
        available,
        unavailable,
        reportUnitLabel(product.unitType),
        status,
      ] as Cell[];
    }),
  );

  const lotRows: Cell[][] = data.lots.flatMap((lot) =>
    warehouses.flatMap((warehouse) => {
      const location =
        warehouse.id === "central" ? "central" : `warehouse__${warehouse.id}`;
      const quantity = round2(Number(lot.quantities?.[location]) || 0);
      if (quantity <= 0) return [];
      const expired = Boolean(lot.expiresOn && lot.expiresOn < today);
      const daysRemaining = lot.expiresOn
        ? Math.ceil(
            (new Date(lot.expiresOn).getTime() - new Date(today).getTime()) /
              (1000 * 3600 * 24),
          )
        : null;
      const status = lot.quarantined
        ? "En cuarentena"
        : expired
          ? "Vencido"
          : daysRemaining !== null && daysRemaining <= alertDays
            ? daysRemaining === 0
              ? "Vence hoy"
              : daysRemaining === 1
                ? "Vence mañana"
                : `Por vencer (${daysRemaining} días)`
            : "Disponible";

      const product = data.products.find((p) => p.id === lot.productId);

      return [
        [
          warehouse.name,
          productName(lot.productId, lot.productName),
          product?.presentation || product?.description || "",
          reportRecordName(lot.lotCode, "Lote registrado"),
          reportDate(lot.manufacturedOn),
          reportDate(lot.expiresOn),
          daysRemaining !== null ? daysRemaining : "-",
          quantity,
          reportUnitLabel(lot.unitType),
          status,
        ] as Cell[],
      ];
    }),
  );

  return [
    {
      id: "inventory",
      name: "Existencias actuales",
      headers: [
        "Almacén",
        "Producto",
        "Presentación",
        "Existencia física",
        "Disponible",
        "No disponible",
        "Unidad",
        "Estado",
      ],
      rows: stockRows.length > 0 ? stockRows : [["No hay existencias registradas.", "", "", 0, 0, 0, "", ""]],
    },
    {
      name: "Lotes por almacén",
      headers: [
        "Almacén",
        "Producto",
        "Presentación",
        "Lote",
        "Elaboración",
        "Vencimiento",
        "Días restantes",
        "Cantidad",
        "Unidad",
        "Estado",
      ],
      rows: lotRows.length > 0 ? lotRows : [["No hay lotes con existencia.", "", "", "", "", "", "", 0, "", ""]],
    },
  ];
}

/** Existencias actuales y transferencias del periodo, sin identificadores internos. */
export function warehouseReportSheets(
  data: DistributionData,
  days: string[],
  warehouseId?: string,
): ReportSheet[] {
  const currentSheets = currentStockSheets(data, warehouseId);
  const warehouses = [
    { id: "central", name: "Almacén central" },
    ...data.warehouses
      .filter((warehouse) => warehouse.active)
      .map((warehouse) => ({
        id: warehouse.id,
        name: reportRecordName(warehouse.name, "Almacén registrado"),
      })),
  ];
  const warehouseName = (id?: string) =>
    warehouses.find((warehouse) => warehouse.id === (id || "central"))?.name ||
    "Almacén registrado";
  const productName = (id: string, fallback?: string) =>
    reportRecordName(
      data.products.find((product) => product.id === id)?.name || fallback,
      "Producto de registro anterior",
    );

  const transferSheet: ReportSheet = {
    name: "Transferencias",
    headers: [
      "Fecha y hora",
      "Origen",
      "Destino",
      "Producto",
      "Cantidad",
      "Unidad",
      "Responsable",
      "Observación",
    ],
    rows: data.transfers
      .filter((transfer) => days.includes(toDayKey(transfer.createdAt)))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((transfer) => [
        reportDateTime(transfer.createdAt),
        warehouseName(transfer.fromWarehouseId),
        warehouseName(transfer.toWarehouseId),
        productName(transfer.line.productId, transfer.line.productName),
        transfer.line.quantity,
        reportUnitLabel(transfer.line.unitType),
        reportPersonName(transfer.responsibleName || transfer.createdBy),
        transfer.note || "",
      ]),
  };

  return [
    ...currentSheets,
    transferSheet.rows.length > 0
      ? transferSheet
      : {
          ...transferSheet,
          rows: [
            [
              "No hay transferencias en el período seleccionado.",
              ...Array.from({ length: transferSheet.headers.length - 1 }, () => ""),
            ],
          ],
        },
  ];
}
export function reportAttributionError(data: DistributionData, days: string[], route = "", seller = ""): string | null {
  if (!seller) return null;
  const unresolved = data.claims.some(c =>
    days.includes(c.dayKey || toDayKey(c.createdAt)) &&
    (!route || c.routeId === route) &&
    !c.sellerUid &&
    !data.sales.some(s => s.id === c.saleId && s.sellerUid),
  );
  return unresolved ? "No se pudo identificar al vendedor de una devolución histórica. No se muestran cifras parciales." : null;
}

export function reportSheets(
  data: DistributionData,
  days: string[],
  route = "",
  seller = "",
): ReportSheet[] {
  const attributionError = reportAttributionError(data, days, route, seller);
  if (attributionError) throw new Error(attributionError);
  const inScope = (r: {
    dayKey?: string;
    createdAt: string;
    routeId?: string;
  }) =>
    days.includes(r.dayKey || toDayKey(r.createdAt)) &&
    (!route || r.routeId === route);
  const sales = data.sales.filter(
      (s) =>
        inScope(s) &&
        !s.pendingConfirmation &&
        (!seller || s.sellerUid === seller),
    ),
    credits = data.receivables.filter(
      (r) => inScope(r) && (!seller || r.distributorUid === seller),
    ),
    collections = data.collections.filter(
      (r) =>
        !r.pendingConfirmation &&
        inScope(r) &&
        (!seller || r.collectedByUid === seller),
    ),
    expenses = data.expenses.filter(
      (r) =>
        !r.pendingConfirmation &&
        !r.voided &&
        inScope(r) &&
        (!seller || r.registeredByUid === seller),
    );
  const claims = data.claims.filter(
    (c) =>
      inScope(c) &&
      (!seller ||
        c.sellerUid === seller ||
        (!c.sellerUid && data.sales.some((s) => s.id === c.saleId && s.sellerUid === seller))),
  );
  const lines = sales.flatMap((s) => s.lines.map((l) => ({ ...l, sale: s })));
  const losses = data.movements
    .filter(inScope)
    .filter(
      (m) =>
        m.type === "shortage" ||
        (m.type === "adjustment" && m.centralDelta < 0),
    );
  const lossCost = round2(losses.reduce((n, l) => n + (l.lossCost || 0), 0));
  const costKnown =
    lines.every((l) => typeof l.costTotal === "number") &&
    claims.every((c) => typeof c.additionalCost === "number") &&
    Boolean(seller || losses.every((m) => typeof m.lossCost === "number"));
  const revenue = round2(
      sales.reduce((n, s) => n + s.total, 0) +
        claims.reduce((n, c) => n + c.revenueDelta, 0),
    ),
    cost = round2(
      lines.reduce((n, l) => n + (l.costTotal || 0), 0) +
        claims.reduce((n, c) => n + (c.additionalCost || 0), 0),
    ),
    spent = round2(expenses.reduce((n, e) => n + e.amount, 0));
  const warehouseName = (id?: string) => {
    if (!id || id === "central") return "Almacén central";
    return reportRecordName(
      data.warehouses.find((warehouse) => warehouse.id === id)?.name,
      "Almacén registrado",
    );
  };
  return [
    {
      id: 'summary',
      name: "Resumen",
      headers: ["Concepto", "Importe (Bs)"],
      rows: [
        ["Ventas netas de cambios y devoluciones", revenue],
        ["Costo de producción registrado de lo vendido y reemplazos", costKnown ? cost : null],
        ["Margen bruto", costKnown ? round2(revenue - cost) : null],
        ["Gastos de ruta registrados", spent],
        ["Pérdidas y mermas de inventario", seller ? null : costKnown ? lossCost : null],
        [
          "Resultado operativo estimado / Ganancia operativa estimada",
          seller ? null : costKnown ? round2(revenue - cost - spent - lossCost) : null,
        ],
        [
          "Estado de costos",
          costKnown
            ? seller ? "Las pérdidas de inventario y el resultado operativo no se asignan por vendedor" : "Costos completos"
            : "Hay ventas históricas sin costo; no se estima una ganancia falsa",
        ],
      ],
      meta: {
        grossSales: round2(sales.reduce((n, s) => n + s.total, 0)),
        returnsDelta: round2(claims.reduce((n, c) => n + c.revenueDelta, 0)),
        revenue,
        cost: costKnown ? cost : 0,
        grossMargin: costKnown ? round2(revenue - cost) : 0,
        spent,
        lossCost: seller ? 0 : (costKnown ? lossCost : 0),
        operatingProfit: seller ? 0 : (costKnown ? round2(revenue - cost - spent - lossCost) : 0),
        costKnown,
        seller,
      },
    },
    {
      id: 'sales',
      name: "Ventas",
      headers: [
        "Fecha y hora",
        "Comprobante",
        "Vendedor",
        "Ruta",
        "Cliente",
        "CI",
        "Efectivo (Bs)",
        "QR (Bs)",
        "Crédito (Bs)",
        "Total (Bs)",
      ],
      rows: [
        ...sales.map((s) => [
        reportDateTime(s.createdAt),
        reportReceiptNumber(s.id),
        reportPersonName(s.sellerName),
        reportRecordName(s.routeName, "Ruta registrada"),
        s.customerName || "Contado",
        s.customerCode || "",
        s.cashAmount,
        s.qrAmount,
        s.creditAmount,
        s.total,
        ] as Cell[]),
        ["TOTAL", "", "", "", "", "", round2(sales.reduce((n, s) => n + s.cashAmount, 0)), round2(sales.reduce((n, s) => n + s.qrAmount, 0)), round2(sales.reduce((n, s) => n + s.creditAmount, 0)), round2(sales.reduce((n, s) => n + s.total, 0))],
      ],
    },
    {
      id: 'products',
      name: "Productos vendidos",
      headers: [
        "Fecha",
        "Comprobante",
        "Producto",
        "Cantidad",
        "Unidad",
        "Precio (Bs)",
        "Precio oficial (Bs)",
        "Tipo de precio",
        "Importe (Bs)",
        "Costo (Bs)",
        "Lotes",
      ],
      rows: [
        ...lines.map((l) => [
        reportDate(l.sale.dayKey),
        reportReceiptNumber(l.sale.id),
        l.productNameSnapshot,
        l.quantity,
        reportUnitLabel(l.unitType),
        l.actualUnitPrice,
        l.referenceUnitPrice ?? l.actualUnitPrice,
        l.isPromotional ? "Promocional" : "Oficial",
        l.subtotal,
        l.costTotal ?? null,
        l.allocations?.map((a) => `${a.lotCode}: ${a.quantity}`).join("; ") ||
          "Sin datos históricos",
        ] as Cell[]),
        ["TOTAL", "", "", "", "", "", "", "", round2(lines.reduce((n, l) => n + l.subtotal, 0)), lines.every(l => typeof l.costTotal === "number") ? round2(lines.reduce((n, l) => n + (l.costTotal || 0), 0)) : null, ""],
      ],
    },
    {
      id: 'salesKardex',
      name: "Kardex de ventas",
      headers: ["Fecha y hora", "Producto", "Presentación", "Cliente", "Vendedor", "Ruta", "Cantidad", "Unidad", "Precio (Bs)", "Importe (Bs)", "Comprobante"],
      rows: [
        ...lines.slice().sort((a, b) => a.productNameSnapshot.localeCompare(b.productNameSnapshot) || a.sale.createdAt.localeCompare(b.sale.createdAt)).map(l => [
          reportDateTime(l.sale.createdAt), l.productNameSnapshot, l.presentationSnapshot || "", l.sale.customerName || "Contado", reportPersonName(l.sale.sellerName), reportRecordName(l.sale.routeName, "Ruta registrada"), l.quantity, reportUnitLabel(l.unitType), l.actualUnitPrice, l.subtotal, reportReceiptNumber(l.sale.id),
        ] as Cell[]),
        ["TOTAL", "", "", "", "", "", "", "", "", round2(lines.reduce((sum, line) => sum + line.subtotal, 0)), ""],
      ],
      meta: { lines },
    },
    (() => {
      const agg = aggregateCustomerPurchases(data, days, route, seller);
      const rows: Cell[][] = [];
      for (const client of agg.clients) {
        for (const prod of client.products) {
          rows.push([
            client.customerName,
            client.customerCode || "",
            prod.productName,
            prod.presentation,
            prod.quantity,
            reportUnitLabel(prod.unitType),
            prod.exactKg > 0 ? prod.exactKg : "-",
            prod.estimatedKg > 0 ? prod.estimatedKg : "-",
            prod.totalEquivalentKg > 0 ? prod.totalEquivalentKg : "-",
            prod.totalBs,
          ]);
        }
      }
      return {
        id: 'customerPurchases',
        name: "Compras por cliente",
        headers: ["Cliente", "CI / Código", "Producto", "Presentación", "Cantidad", "Unidad", "Kg exactos", "Kg estimados", "Kg equivalentes", "Importe (Bs)"],
        rows: [
          ...rows,
          [
            "TOTAL",
            "",
            "",
            "",
            "",
            "",
            agg.grandTotalExactKg > 0 ? agg.grandTotalExactKg : "-",
            agg.grandTotalEstimatedKg > 0 ? agg.grandTotalEstimatedKg : "-",
            agg.grandTotalEquivalentKg > 0 ? agg.grandTotalEquivalentKg : "-",
            agg.grandTotalBs,
          ],
        ],
        meta: { agg },
      };
    })(),
    {
      id: 'cashFlow',
      name: "Movimiento de efectivo",
      headers: ["Concepto", "Efectivo (Bs)", "QR (Bs)", "Total (Bs)"],
      rows: [
        ["Cobros de ventas", round2(sales.reduce((n, s) => n + s.cashAmount, 0)), round2(sales.reduce((n, s) => n + s.qrAmount, 0)), round2(sales.reduce((n, s) => n + s.cashAmount + s.qrAmount, 0))],
        ["Cobros de cartera", round2(collections.reduce((n, c) => n + (c.cashAmount ?? (c.method === "cash" ? c.amount : 0)), 0)), round2(collections.reduce((n, c) => n + (c.qrAmount ?? (c.method === "qr" ? c.amount : 0)), 0)), round2(collections.reduce((n, c) => n + c.amount, 0))],
        ["Cambios y devoluciones", round2(claims.reduce((n, c) => n + c.cashIn - c.cashOut, 0)), round2(claims.reduce((n, c) => n + c.qrIn - c.qrOut, 0)), round2(claims.reduce((n, c) => n + c.cashIn - c.cashOut + c.qrIn - c.qrOut, 0))],
        ["Gastos", -spent, 0, -spent],
        ["FLUJO NETO", "", "", round2(sales.reduce((n, s) => n + s.cashAmount + s.qrAmount, 0) + collections.reduce((n, c) => n + c.amount, 0) + claims.reduce((n, c) => n + c.cashIn - c.cashOut + c.qrIn - c.qrOut, 0) - spent)],
      ],
      meta: {
        netFlow: round2(sales.reduce((n, s) => n + s.cashAmount + s.qrAmount, 0) + collections.reduce((n, c) => n + c.amount, 0) + claims.reduce((n, c) => n + c.cashIn - c.cashOut + c.qrIn - c.qrOut, 0) - spent),
      },
    },
    {
      id: 'credits',
      name: "Créditos",
      headers: [
        "Fecha",
        "Cliente",
        "CI",
        "Productos",
        "Original (Bs)",
        "Pagado (Bs)",
        "Compensado por devolución (Bs)",
        "Saldo (Bs)",
        "Estado",
      ],
      rows: [
        ...credits.map((r) => [
        reportDateTime(r.createdAt),
        r.customerName,
        r.customerCode || "",
        r.saleLines
          ?.map((l) => `${l.productNameSnapshot} (${reportQuantity(l.quantity, l.unitType)})`)
          .join("; ") || "",
        r.originalAmount,
        r.paidAmount,
        r.creditedAmount || 0,
        r.balance,
        r.balance <= 0 ? "Pagado" : r.paidAmount > 0 ? "Parcial" : "Pendiente",
        ] as Cell[]),
        ["TOTAL", "", "", "", round2(credits.reduce((n, r) => n + r.originalAmount, 0)), round2(credits.reduce((n, r) => n + r.paidAmount, 0)), round2(credits.reduce((n, r) => n + (r.creditedAmount || 0), 0)), round2(credits.reduce((n, r) => n + r.balance, 0)), ""],
      ],
      meta: {
        totalOutstanding: round2(credits.reduce((n, r) => n + r.balance, 0)),
      },
    },
    {
      id: 'collections',
      name: "Cobros",
      headers: [
        "Fecha",
        "Cliente",
        "CI",
        "Responsable",
        "Método",
        "Efectivo (Bs)",
        "QR (Bs)",
        "Importe (Bs)",
      ],
      rows: [
        ...collections.map((c) => [
        reportDateTime(c.createdAt),
        c.customerName,
        c.customerCode || "",
        reportPersonName(c.collectedByName),
        reportPaymentLabel(c.method),
        c.cashAmount ?? (c.method === "cash" ? c.amount : 0),
        c.qrAmount ?? (c.method === "qr" ? c.amount : 0),
        c.amount,
        ] as Cell[]),
        ["TOTAL", "", "", "", "", round2(collections.reduce((n, c) => n + (c.cashAmount ?? (c.method === "cash" ? c.amount : 0)), 0)), round2(collections.reduce((n, c) => n + (c.qrAmount ?? (c.method === "qr" ? c.amount : 0)), 0)), round2(collections.reduce((n, c) => n + c.amount, 0))],
      ],
    },
    {
      id: 'expenses',
      name: "Gastos",
      headers: ["Fecha", "Ruta", "Responsable", "Concepto", "Importe (Bs)"],
      rows: [
        ...expenses.map((e) => [
        reportDateTime(e.createdAt),
        reportRecordName(e.routeName, "Ruta registrada"),
        reportPersonName(e.registeredByName),
        e.concept,
        e.amount,
        ] as Cell[]),
        ["TOTAL", "", "", "", round2(expenses.reduce((n, e) => n + e.amount, 0))],
      ],
    },
    {
      id: 'closures',
      name: "Arqueos",
      headers: [
        "Fecha",
        "Distribuidor",
        "Ruta",
        "Estado",
        "Esperado (Bs)",
        "Declarado (Bs)",
        "Diferencia (Bs)",
      ],
      rows: (() => {
        const closures = data.closures.filter(inScope).filter((c) => !seller || c.distributorUid === seller)
        return [
          ...closures.map((c) => [
          reportDateTime(c.createdAt),
          reportPersonName(c.distributorName),
          reportRecordName(c.routeName, "Ruta registrada"),
          reportClosureLabel(c.status),
          c.expectedCash ?? null,
          c.physicalCashDeclared ?? null,
          c.cashDifference ?? null,
          ] as Cell[]),
          ["TOTAL", "", "", "", round2(closures.reduce((n, c) => n + (c.expectedCash || 0), 0)), round2(closures.reduce((n, c) => n + (c.physicalCashDeclared || 0), 0)), round2(closures.reduce((n, c) => n + (c.cashDifference || 0), 0))],
        ]
      })(),
    },
    (() => {
      const stockSheets = currentStockSheets(data);
      return {
        ...stockSheets[0],
        meta: {
          stockSheet: stockSheets[0],
          lotSheet: stockSheets[1],
        },
      };
    })(),
    {
      id: 'movements',
      name: "Movimientos",
      headers: [
        "Fecha",
        "Producto",
        "Tipo",
        "Cantidad",
        "Unidad",
        "Responsable",
        "Motivo",
      ],
      rows: data.movements
        .filter(inScope)
        .map((m) => [
          reportDateTime(m.createdAt),
          m.productName,
          reportMovementLabel(m.type),
          m.quantity,
          reportUnitLabel(m.unitType),
          reportPersonName(m.responsibleName || m.createdBy),
          m.note || "",
        ]),
    },
    {
      id: 'transfers',
      name: "Transferencias",
      headers: [
        "Fecha",
        "Origen",
        "Destino",
        "Producto",
        "Cantidad",
        "Unidad",
        "Responsable",
      ],
      rows: data.transfers
        .filter((t) => days.includes(toDayKey(t.createdAt)))
        .map((t) => [
          reportDateTime(t.createdAt),
          warehouseName(t.fromWarehouseId),
          warehouseName(t.toWarehouseId),
          t.line.productName,
          t.line.quantity,
          reportUnitLabel(t.line.unitType),
          reportPersonName(t.responsibleName || t.createdBy),
        ]),
    },
    {
      id: 'claims',
      name: "Cambios y devoluciones",
      headers: [
        "Fecha",
        "Cliente",
        "Producto",
        "Cantidad",
        "Unidad",
        "Motivo",
        "Reemplazo",
        "Ajuste de venta (Bs)",
        "Costo adicional (Bs)",
        "Deuda compensada (Bs)",
        "Efectivo recibido (Bs)",
        "Efectivo devuelto (Bs)",
        "QR recibido (Bs)",
        "QR devuelto (Bs)",
      ],
      rows: [
        ...claims.map((c) => [
        reportDateTime(c.createdAt),
        c.customerName,
        c.productName,
        c.quantity,
        reportUnitLabel(c.unitType),
        c.reason,
        c.replacement?.productName || "",
        c.revenueDelta,
        c.additionalCost,
        c.debtReduction,
        c.cashIn,
        c.cashOut,
        c.qrIn,
        c.qrOut,
        ] as Cell[]),
        ["TOTAL", "", "", "", "", "", "", round2(claims.reduce((n, c) => n + c.revenueDelta, 0)), round2(claims.reduce((n, c) => n + (c.additionalCost || 0), 0)), round2(claims.reduce((n, c) => n + c.debtReduction, 0)), round2(claims.reduce((n, c) => n + c.cashIn, 0)), round2(claims.reduce((n, c) => n + c.cashOut, 0)), round2(claims.reduce((n, c) => n + c.qrIn, 0)), round2(claims.reduce((n, c) => n + c.qrOut, 0))],
      ],
    },
  ];
}
export async function exportExcel(
  sheets: ReportSheet[],
  description: string,
  filename = "SanJose-reportes.xlsx",
) {
  const { Workbook } = await import("exceljs");
  const book = new Workbook();
  book.creator = "Embutidos San José";

  const addStyledWorksheet = (name: string, headers: string[], rows: Cell[][], subDesc = description) => {
    const ws = book.addWorksheet(name.slice(0, 31));
    ws.mergeCells(1, 1, 1, Math.max(1, headers.length));
    ws.getCell(1, 1).value = `EMBUTIDOS SAN JOSÉ · ${name.toUpperCase()}`;
    ws.getCell(1, 1).font = { bold: true, size: 13, color: { argb: "FF991B1B" } };

    ws.mergeCells(2, 1, 2, Math.max(1, headers.length));
    ws.getCell(2, 1).value = subDesc;
    ws.getCell(2, 1).alignment = { wrapText: true };
    ws.getCell(2, 1).font = { size: 9, italic: true, color: { argb: "FF475569" } };
    ws.getRow(2).height = 24;

    ws.getRow(4).values = headers;
    ws.getRow(4).eachCell((c) => {
      c.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 9 };
      c.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FF1F2937" },
      };
      c.alignment = { vertical: "middle", horizontal: "center" };
    });
    ws.getRow(4).height = 24;

    rows.forEach((row) => {
      ws.addRow(
        row.map((cell) => {
          if (cell === null || cell === undefined) return "";
          if (typeof cell === "number") return cell;
          const str = String(cell).trim();
          if (/^-?\d+(\.\d+)?$/.test(str) && !str.startsWith("0") && str.length < 12) {
            return Number(str);
          }
          return str;
        }),
      );
    });

    ws.columns.forEach((c, i) => {
      const header = headers[i] || "";
      let maxLen = header.length;
      for (let r = 4; r <= ws.rowCount; r++) {
        const val = ws.getCell(r, i + 1).value;
        if (val) maxLen = Math.max(maxLen, String(val).length);
      }
      c.width = Math.min(50, Math.max(13, maxLen + 3));
    });

    ws.views = [{ state: "frozen", ySplit: 4 }];
    ws.autoFilter = {
      from: { row: 4, column: 1 },
      to: { row: Math.max(4, ws.rowCount), column: headers.length },
    };

    for (let r = 5; r <= ws.rowCount; r++) {
      const row = ws.getRow(r);
      row.alignment = { vertical: "middle" };
      const isTotalRow = String(ws.getCell(r, 1).value).toUpperCase().includes("TOTAL");
      if (isTotalRow) {
        row.font = { bold: true };
        row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFDECEE" } };
      }
      row.eachCell((c, col) => {
        if (typeof c.value === "number") {
          const header = headers[col - 1] || "";
          c.numFmt = header.includes("Bs") || header.includes("Importe") || header.includes("Precio")
            ? "#,##0.00"
            : header.includes("Kg") || header.includes("Cantidad") || header.includes("Físico") || header.includes("Disponible")
              ? "#,##0.00"
              : "0.##";
        }
      });
    }
  };

  for (const sheet of sheets) {
    if (sheet.id === "customerPurchases" && sheet.meta?.agg) {
      const agg = sheet.meta.agg as CustomerPurchasesAggregation;
      const summaryHeaders = ["Cliente", "CI / Código", "Ruta", "Pedidos", "Total (Bs)", "Kg exactos", "Kg estimados", "Kg equivalentes", "Paquetes"];
      const summaryRows: Cell[][] = [
        ...agg.clients.map((c: CustomerPurchaseSummary) => [
          c.customerName,
          c.customerCode || "",
          c.routeNames?.[0] || "",
          c.purchasesCount,
          c.totalBs,
          c.exactKg > 0 ? c.exactKg : 0,
          c.estimatedKg > 0 ? c.estimatedKg : 0,
          c.totalEquivalentKg > 0 ? c.totalEquivalentKg : 0,
          c.totalPackages,
        ] as Cell[]),
        [
          "TOTAL",
          "",
          "",
          agg.clients.reduce((sum: number, c: CustomerPurchaseSummary) => sum + (c.purchasesCount || 0), 0),
          agg.grandTotalBs,
          agg.grandTotalExactKg,
          agg.grandTotalEstimatedKg,
          agg.grandTotalEquivalentKg,
          agg.grandTotalPackages,
        ],
      ];
      addStyledWorksheet("Compras - Resumen", summaryHeaders, summaryRows, `${description} · Resumen por cliente`);

      const detailHeaders = ["Cliente", "CI / Código", "Producto", "Presentación", "Cantidad", "Unidad", "Kg exactos", "Kg estimados", "Kg equivalentes", "Precio unitario (Bs)", "Subtotal (Bs)"];
      const detailRows: Cell[][] = [
        ...agg.clients.flatMap((c: CustomerPurchaseSummary) =>
          c.products.map((p: CustomerPurchasedProduct) => [
            c.customerName,
            c.customerCode || "",
            p.productName,
            p.presentation || "",
            p.quantity,
            reportUnitLabel(p.unitType),
            p.exactKg > 0 ? p.exactKg : 0,
            p.estimatedKg > 0 ? p.estimatedKg : 0,
            p.totalEquivalentKg > 0 ? p.totalEquivalentKg : 0,
            p.totalBs / (p.quantity || 1),
            p.totalBs,
          ] as Cell[]),
        ),
        [
          "TOTAL",
          "",
          "",
          "",
          "",
          "",
          agg.grandTotalExactKg,
          agg.grandTotalEstimatedKg,
          agg.grandTotalEquivalentKg,
          "",
          agg.grandTotalBs,
        ],
      ];
      addStyledWorksheet("Compras - Detalle", detailHeaders, detailRows, `${description} · Detalle producto por cliente`);
    } else if (sheet.id === "inventory" && sheet.meta?.stockSheet && sheet.meta?.lotSheet) {
      addStyledWorksheet("Existencias actuales", sheet.meta.stockSheet.headers, sheet.meta.stockSheet.rows, `${description} · Existencias físicas y disponibles`);
      addStyledWorksheet("Lotes por almacén", sheet.meta.lotSheet.headers, sheet.meta.lotSheet.rows, `${description} · Detalle de lotes y vencimientos`);
    } else {
      addStyledWorksheet(sheet.name, sheet.headers, sheet.rows);
    }
  }

  const buffer = await book.xlsx.writeBuffer();
  await saveReport(
    new Uint8Array(buffer),
    filename,
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  );
}

function formatBsCurrency(val: number | null | undefined): string {
  if (val === null || val === undefined) return "Bs 0,00";
  return `Bs ${round2(val).toLocaleString("es-BO", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function drawBrandedPdfHeader(pdf: jsPDF, title: string, subtitle?: string) {
  const pageWidth = pdf.internal.pageSize.getWidth();
  pdf.setFillColor(200, 16, 46);
  pdf.rect(0, 0, pageWidth, 5.5, "F");

  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(15);
  pdf.setTextColor(200, 16, 46);
  pdf.text("EMBUTIDOS SAN JOSÉ", 14, 15);

  pdf.setFontSize(11);
  pdf.setTextColor(30, 41, 59);
  pdf.text(title, 14, 22);

  if (subtitle) {
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(8);
    pdf.setTextColor(100, 116, 139);
    pdf.text(subtitle, 14, 28, { maxWidth: pageWidth - 28 });
  }
}

export async function exportPdf(
  sheets: ReportSheet[],
  description: string,
  filename = "SanJose-reportes.pdf",
) {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([
    import("jspdf"),
    import("jspdf-autotable"),
  ]);

  const pdf = new jsPDF({ orientation: "portrait", format: "letter" });

  const renderSummarySheet = (sheet: ReportSheet) => {
    drawBrandedPdfHeader(
      pdf,
      "RESULTADO DEL PERIODO",
      `Periodo evaluado: ${description}  ·  Moneda: Bolivianos (Bs)`,
    );

    const meta = sheet.meta || {};
    const revenue = meta.revenue ?? Number(sheet.rows[0]?.[1] || 0);
    const cost = meta.cost ?? Number(sheet.rows[1]?.[1] || 0);
    const grossMargin = meta.grossMargin ?? Number(sheet.rows[2]?.[1] || 0);
    const spent = meta.spent ?? Number(sheet.rows[3]?.[1] || 0);
    const lossCost = meta.lossCost ?? Number(sheet.rows[4]?.[1] || 0);
    const operatingProfit = meta.operatingProfit ?? Number(sheet.rows[5]?.[1] || 0);
    const grossSales = meta.grossSales ?? revenue;
    const returnsDelta = meta.returnsDelta ?? 0;

    const pageWidth = pdf.internal.pageSize.getWidth();
    pdf.setFillColor(248, 250, 252);
    pdf.setDrawColor(200, 16, 46);
    pdf.setLineWidth(1);
    pdf.roundedRect(14, 33, pageWidth - 28, 29, 3, 3, "FD");

    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(8.5);
    pdf.setTextColor(148, 163, 184);
    pdf.text("RESULTADO OPERATIVO ESTIMADO / GANANCIA OPERATIVA ESTIMADA", 20, 41);

    pdf.setFontSize(18);
    pdf.setTextColor(200, 16, 46);
    pdf.text(formatBsCurrency(operatingProfit), 20, 50);

    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(7.5);
    pdf.setTextColor(71, 85, 105);
    pdf.text(
      `Ventas netas (${formatBsCurrency(revenue)})  -  Costo de lo vendido (${formatBsCurrency(cost)})  -  Gastos (${formatBsCurrency(spent)})  -  Pérdidas (${formatBsCurrency(lossCost)})`,
      20,
      57,
    );

    autoTable(pdf, {
      startY: 66,
      head: [["Paso", "Concepto operativo", "Descripción del cálculo", "Importe (Bs)"]],
      body: [
        ["1", "Ventas brutas antes de devoluciones", "Total de ventas iniciales entregadas en el periodo", formatBsCurrency(grossSales)],
        ["2", "(-) Ajustes por cambios y devoluciones", "Devoluciones y productos compensados en ruta", `- ${formatBsCurrency(Math.abs(returnsDelta))}`],
        ["3", "(=) VENTAS NETAS", "Ingreso comercial neto tras devoluciones", formatBsCurrency(revenue)],
        ["4", "(-) Costo de producción de productos vendidos y reemplazos", "Costo de producción registrado de los productos comercializados", `- ${formatBsCurrency(cost)}`],
        ["5", "(=) MARGEN BRUTO", "Diferencia directa entre ventas netas y costo de producción", formatBsCurrency(grossMargin)],
        ["6", "(-) Gastos registrados de ruta", "Combustible, viáticos y gastos validados", `- ${formatBsCurrency(spent)}`],
        ["7", "(-) Pérdidas y mermas registradas", "Faltantes en conciliaciones y mermas de almacén", `- ${formatBsCurrency(lossCost)}`],
        ["8", "(=) RESULTADO OPERATIVO ESTIMADO / GANANCIA OPERATIVA", "Ganancia operativa estimada del negocio en este periodo", formatBsCurrency(operatingProfit)],
      ],
      theme: "grid",
      headStyles: { fillColor: [30, 41, 59], textColor: [255, 255, 255], fontStyle: "bold", fontSize: 8 },
      bodyStyles: { fontSize: 7.5, cellPadding: 2.4 },
      alternateRowStyles: { fillColor: [248, 250, 252] },
      columnStyles: {
        0: { cellWidth: 12, halign: "center" },
        1: { cellWidth: 84, fontStyle: "bold" },
        2: { cellWidth: 60, textColor: [100, 116, 139] },
        3: { cellWidth: 32, halign: "right", fontStyle: "bold" },
      },
      didParseCell: (hook: CellHookData) => {
        if (hook.row.index === 2 || hook.row.index === 4) {
          hook.cell.styles.fillColor = [254, 243, 199];
        }
        if (hook.row.index === 7) {
          hook.cell.styles.fillColor = [254, 226, 226];
          hook.cell.styles.textColor = [185, 28, 28];
          hook.cell.styles.fontSize = 8;
        }
      },
      margin: { left: 14, right: 14 },
    });

    const finalY = (pdf as unknown as AutoTableJsPDF).lastAutoTable.finalY + 6;
    if (finalY < 235) {
      pdf.setFillColor(241, 245, 249);
      pdf.roundedRect(14, finalY, pageWidth - 28, 42, 3, 3, "F");

      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(8);
      pdf.setTextColor(30, 41, 59);
      pdf.text("GUÍA EXPLICATIVA PARA ADMINISTRACIÓN (CÓMO ENTENDER CADA NÚMERO):", 18, finalY + 6);

      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(7);
      pdf.setTextColor(51, 65, 85);
      const guideLines = [
        "• Ventas netas: Total vendido antes de ajustes menos devoluciones. Incluye ventas al contado y a crédito del periodo.",
        "• Costo de lo vendido: Costo de producción registrado de los productos efectivamente vendidos y reemplazos.",
        "• Margen bruto: Ganancia directa entre el valor vendido y el costo de producción asociado.",
        "• Cobros de cartera: Dinero recuperado de ventas a crédito pasadas; entra a caja pero NO es una nueva venta.",
        "• Ventas a crédito: Forman parte de las ventas netas de hoy; su cobro posterior NO vuelve a contarse como venta.",
        "• Resultado operativo / Ganancia operativa estimada: Margen bruto menos gastos de ruta y pérdidas registradas.",
      ];
      let textY = finalY + 11.5;
      guideLines.forEach((line) => {
        pdf.text(line, 18, textY);
        textY += 4.8;
      });
    }
  };

  const renderCustomerPurchasesSheet = (sheet: ReportSheet) => {
    drawBrandedPdfHeader(
      pdf,
      "COMPRAS POR CLIENTE (DESGLOSE AGRUPADO)",
      `Periodo: ${description}  ·  Ordenado por mayor compra total  ·  Kilos exactos y estimados`,
    );

    const agg = sheet.meta?.agg;
    const pageWidth = pdf.internal.pageSize.getWidth();
    let startY = 33;

    if (agg && agg.clients && agg.clients.length > 0) {
      const topClient = agg.clients[0];
      pdf.setFillColor(254, 242, 242);
      pdf.setDrawColor(252, 165, 165);
      pdf.roundedRect(14, startY, pageWidth - 28, 16, 2, 2, "FD");

      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(7.5);
      pdf.setTextColor(185, 28, 28);
      pdf.text("CLIENTE QUE MÁS COMPRÓ EN EL PERIODO:", 18, startY + 5.5);

      pdf.setFontSize(9);
      pdf.setTextColor(153, 27, 27);
      pdf.text(`${topClient.customerName} (CI: ${topClient.customerCode || "Sin CI"})`, 18, startY + 11.5);

      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(7.5);
      pdf.setTextColor(185, 28, 28);
      pdf.text(`Total: ${formatBsCurrency(topClient.totalBs)}  ·  ${topClient.kgBreakdown}  ·  ${topClient.totalPackages} paq`, 95, startY + 11.5);

      startY += 20;

      agg.clients.forEach((client: CustomerPurchaseSummary, idx: number) => {
        if (startY > 235) {
          pdf.addPage("letter", "portrait");
          drawBrandedPdfHeader(pdf, "COMPRAS POR CLIENTE (CONTINUACIÓN)", `Periodo: ${description}`);
          startY = 33;
        }

        pdf.setFillColor(241, 245, 249);
        pdf.rect(14, startY, pageWidth - 28, 7.5, "F");

        pdf.setFont("helvetica", "bold");
        pdf.setFontSize(8.5);
        pdf.setTextColor(30, 41, 59);
        pdf.text(`#${idx + 1}  ${client.customerName.toUpperCase()}`, 18, startY + 5);

        pdf.setFont("helvetica", "normal");
        pdf.setFontSize(7);
        pdf.setTextColor(100, 116, 139);
        pdf.text(`CI: ${client.customerCode || "Sin CI"}  ·  Ruta: ${client.routeNames?.[0] || "Ruta"}  ·  ${client.purchasesCount} pedidos`, 80, startY + 5);

        pdf.setFont("helvetica", "bold");
        pdf.setTextColor(200, 16, 46);
        pdf.text(`Subtotal: ${formatBsCurrency(client.totalBs)}`, pageWidth - 42, startY + 5);

        autoTable(pdf, {
          startY: startY + 8.5,
          head: [["Producto", "Detalle de presentación", "Cantidad", "Unidad", "Kg calculados", "Precio (Bs)", "Subtotal (Bs)"]],
          body: client.products.map((p: CustomerPurchasedProduct) => [
            p.productName,
            p.presentation || "",
            round2(p.quantity),
            reportUnitLabel(p.unitType),
            p.unitType === "kg" ? `${round2(p.exactKg)} kg (exacto)` : `${round2(p.estimatedKg)} kg (estimado)`,
            formatBsCurrency(p.totalBs / (p.quantity || 1)),
            formatBsCurrency(p.totalBs),
          ]),
          theme: "plain",
          headStyles: { fillColor: [51, 65, 85], textColor: [255, 255, 255], fontStyle: "bold", fontSize: 7, cellPadding: 2 },
          bodyStyles: { fontSize: 7, cellPadding: 2, textColor: [30, 41, 59] },
          columnStyles: {
            0: { cellWidth: 50, fontStyle: "bold" },
            1: { cellWidth: 42, textColor: [71, 85, 105] },
            2: { cellWidth: 16, halign: "right" },
            3: { cellWidth: 14, halign: "center" },
            4: { cellWidth: 28, halign: "right" },
            5: { cellWidth: 18, halign: "right" },
            6: { cellWidth: 20, halign: "right", fontStyle: "bold" },
          },
          margin: { left: 14, right: 14 },
        });

        const subY = (pdf as unknown as AutoTableJsPDF).lastAutoTable.finalY;
        pdf.setFillColor(248, 250, 252);
        pdf.rect(14, subY, pageWidth - 28, 5, "F");
        pdf.setFont("helvetica", "bold");
        pdf.setFontSize(7);
        pdf.setTextColor(71, 85, 105);
        pdf.text(`Resumen cliente: ${client.kgBreakdown}  ·  ${client.totalPackages} paquetes cerrados`, 18, subY + 3.5);

        startY = subY + 7;
      });

      if (startY > 245) {
        pdf.addPage("letter", "portrait");
        drawBrandedPdfHeader(pdf, "COMPRAS POR CLIENTE (TOTALES)", `Periodo: ${description}`);
        startY = 33;
      }
      pdf.setFillColor(30, 41, 59);
      pdf.rect(14, startY, pageWidth - 28, 9, "F");
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(8);
      pdf.setTextColor(255, 255, 255);
      pdf.text("TOTAL GENERAL DE TODOS LOS CLIENTES", 18, startY + 6);
      pdf.setFontSize(7.5);
      pdf.text(
        `${round2(agg.grandTotalEquivalentKg)} kg equiv. (${round2(agg.grandTotalExactKg)} kg exactos + ${round2(agg.grandTotalEstimatedKg)} est.)`,
        90,
        startY + 6,
      );
      pdf.setFontSize(8.5);
      pdf.text(formatBsCurrency(agg.grandTotalBs), pageWidth - 42, startY + 6);
    } else {
      renderGenericTable(sheet);
    }
  };

  const renderSalesKardexSheet = (sheet: ReportSheet) => {
    drawBrandedPdfHeader(
      pdf,
      "KARDEX DETALLADO DE VENTAS POR PRODUCTO",
      `Periodo: ${description}  ·  Agrupado por producto con presentación comercial`,
    );

    const lines = sheet.meta?.lines || [];
    if (lines.length > 0) {
      const byProduct = new Map<string, ReportSaleLine[]>();
      for (const line of lines) {
        const prodKey = line.productNameSnapshot || "Producto";
        const group = byProduct.get(prodKey) || [];
        group.push(line);
        byProduct.set(prodKey, group);
      }

      let startY = 33;
      const pageWidth = pdf.internal.pageSize.getWidth();

      for (const [prodName, prodLines] of byProduct.entries()) {
        if (startY > 235) {
          pdf.addPage("letter", "portrait");
          drawBrandedPdfHeader(pdf, "KARDEX DETALLADO DE VENTAS (CONTINUACIÓN)", `Periodo: ${description}`);
          startY = 33;
        }

        const totalQty = round2(prodLines.reduce((s, l) => s + (l.quantity || 0), 0));
        const totalBs = round2(prodLines.reduce((s, l) => s + (l.subtotal || 0), 0));
        const unit = reportUnitLabel(prodLines[0]?.unitType);
        const pres = prodLines[0]?.presentationSnapshot || "";

        pdf.setFillColor(241, 245, 249);
        pdf.rect(14, startY, pageWidth - 28, 8, "F");

        pdf.setFont("helvetica", "bold");
        pdf.setFontSize(8.5);
        pdf.setTextColor(30, 41, 59);
        pdf.text(prodName.toUpperCase(), 18, startY + 5.5);

        if (pres) {
          pdf.setFont("helvetica", "normal");
          pdf.setFontSize(7.5);
          pdf.setTextColor(100, 116, 139);
          pdf.text(`Presentación: ${pres}`, 85, startY + 5.5);
        }

        pdf.setFont("helvetica", "bold");
        pdf.setTextColor(200, 16, 46);
        pdf.text(`${totalQty} ${unit}  ·  ${formatBsCurrency(totalBs)}`, pageWidth - 42, startY + 5.5);

        autoTable(pdf, {
          startY: startY + 9,
          head: [["Fecha y hora", "N° Recibo", "Cliente", "Vendedor", "Ruta", "Cantidad", "Precio", "Total (Bs)"]],
          body: prodLines.map((l) => [
            reportDateTime(l.sale?.createdAt || ""),
            reportReceiptNumber(l.sale?.id || ""),
            l.sale?.customerName || "Contado",
            reportPersonName(l.sale?.sellerName),
            reportRecordName(l.sale?.routeName, "Ruta registrada"),
            `${round2(l.quantity)} ${unit}`,
            formatBsCurrency(l.actualUnitPrice),
            formatBsCurrency(l.subtotal),
          ]),
          theme: "plain",
          headStyles: { fillColor: [71, 85, 105], textColor: [255, 255, 255], fontStyle: "bold", fontSize: 7, cellPadding: 2 },
          bodyStyles: { fontSize: 7, cellPadding: 2 },
          columnStyles: {
            0: { cellWidth: 26 },
            1: { cellWidth: 20, fontStyle: "bold" },
            2: { cellWidth: 44 },
            3: { cellWidth: 24 },
            4: { cellWidth: 20 },
            5: { cellWidth: 16, halign: "right" },
            6: { cellWidth: 16, halign: "right" },
            7: { cellWidth: 22, halign: "right", fontStyle: "bold" },
          },
          margin: { left: 14, right: 14 },
        });

        startY = (pdf as unknown as AutoTableJsPDF).lastAutoTable.finalY + 6;
      }
    } else {
      renderGenericTable(sheet);
    }
  };

  const renderInventorySheet = (sheet: ReportSheet) => {
    drawBrandedPdfHeader(
      pdf,
      "EXISTENCIAS ACTUALES DE INVENTARIO Y LOTES",
      `Emitido: ${new Date().toLocaleString("es-BO")}  ·  ${description}`,
    );

    const stockSheet = sheet.meta?.stockSheet as ReportSheet | undefined;
    const lotSheet = sheet.meta?.lotSheet as ReportSheet | undefined;

    if (stockSheet && lotSheet) {
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(9);
      pdf.setTextColor(30, 41, 59);
      pdf.text("1. Resumen de Existencias Físicas y Disponibles", 14, 34);

      autoTable(pdf, {
        startY: 37,
        head: [stockSheet.headers],
        body: stockSheet.rows.map((r: Cell[]) => r.map((c) => (c === null || c === undefined ? "" : String(c)))),
        theme: "grid",
        headStyles: { fillColor: [30, 41, 59], textColor: [255, 255, 255], fontStyle: "bold", fontSize: 7.5 },
        bodyStyles: { fontSize: 7, cellPadding: 2 },
        alternateRowStyles: { fillColor: [248, 250, 252] },
        margin: { left: 14, right: 14 },
      });

      const nextY = (pdf as unknown as AutoTableJsPDF).lastAutoTable.finalY + 8;
      let lotStartY = nextY;
      if (lotStartY > 220) {
        pdf.addPage("letter", "portrait");
        drawBrandedPdfHeader(pdf, "DETALLE DE LOTES Y VENCIMIENTOS", `Emitido: ${new Date().toLocaleString("es-BO")}`);
        lotStartY = 33;
      }

      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(9);
      pdf.setTextColor(30, 41, 59);
      pdf.text("2. Desglose de Lotes Registrados y Estado de Vencimiento", 14, lotStartY);

      autoTable(pdf, {
        startY: lotStartY + 4,
        head: [lotSheet.headers],
        body: lotSheet.rows.map((r: Cell[]) => r.map((c) => (c === null || c === undefined ? "" : String(c)))),
        theme: "grid",
        headStyles: { fillColor: [71, 85, 105], textColor: [255, 255, 255], fontStyle: "bold", fontSize: 7.5 },
        bodyStyles: { fontSize: 7, cellPadding: 2 },
        alternateRowStyles: { fillColor: [248, 250, 252] },
        didParseCell: (hook: CellHookData) => {
          if (hook.section === "body" && hook.column.index === 9) {
            const val = String(hook.cell.raw);
            if (val.includes("Vencido")) {
              hook.cell.styles.textColor = [185, 28, 28];
              hook.cell.styles.fontStyle = "bold";
            } else if (val.includes("vencer")) {
              hook.cell.styles.textColor = [180, 83, 9];
              hook.cell.styles.fontStyle = "bold";
            } else if (val.includes("Disponible")) {
              hook.cell.styles.textColor = [21, 128, 61];
            }
          }
        },
        margin: { left: 14, right: 14 },
      });
    } else {
      renderGenericTable(sheet);
    }
  };

  const renderCashFlowSheet = (sheet: ReportSheet) => {
    drawBrandedPdfHeader(
      pdf,
      "MOVIMIENTO DE EFECTIVO Y FLUJO DE CAJA",
      `Periodo: ${description}`,
    );

    const netFlow = Number(sheet.meta?.netFlow ?? (sheet.rows[sheet.rows.length - 1]?.[3] || 0));
    const pageWidth = pdf.internal.pageSize.getWidth();

    pdf.setFillColor(248, 250, 252);
    pdf.setDrawColor(30, 41, 59);
    pdf.setLineWidth(1);
    pdf.roundedRect(14, 33, pageWidth - 28, 22, 2, 2, "FD");

    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(8.5);
    pdf.setTextColor(100, 116, 139);
    pdf.text("FLUJO NETO DE CAJA DEL PERIODO", 20, 41);

    pdf.setFontSize(16);
    pdf.setTextColor(netFlow >= 0 ? 21 : 185, netFlow >= 0 ? 128 : 28, netFlow >= 0 ? 61 : 28);
    pdf.text(formatBsCurrency(netFlow), 20, 50);

    autoTable(pdf, {
      startY: 59,
      head: [sheet.headers],
      body: sheet.rows.map((r) => r.map((c) => (c === null || c === undefined ? "" : typeof c === "number" ? formatBsCurrency(c) : String(c)))),
      theme: "grid",
      headStyles: { fillColor: [30, 41, 59], textColor: [255, 255, 255], fontStyle: "bold", fontSize: 8 },
      bodyStyles: { fontSize: 8, cellPadding: 2.8 },
      alternateRowStyles: { fillColor: [248, 250, 252] },
      columnStyles: {
        0: { fontStyle: "bold" },
        1: { halign: "right" },
        2: { halign: "right" },
        3: { halign: "right", fontStyle: "bold" },
      },
      didParseCell: (hook: CellHookData) => {
        if (hook.row.index === sheet.rows.length - 1) {
          hook.cell.styles.fillColor = [254, 243, 199];
          hook.cell.styles.fontStyle = "bold";
        }
      },
      margin: { left: 14, right: 14 },
    });
  };

  const renderCreditsSheet = (sheet: ReportSheet) => {
    drawBrandedPdfHeader(
      pdf,
      "CARTERA DE CRÉDITOS Y COBRANZAS",
      `Periodo: ${description}`,
    );

    autoTable(pdf, {
      startY: 33,
      head: [sheet.headers],
      body: sheet.rows.map((r) => r.map((c) => (c === null || c === undefined ? "" : typeof c === "number" ? formatBsCurrency(c) : String(c)))),
      theme: "grid",
      headStyles: { fillColor: [30, 41, 59], textColor: [255, 255, 255], fontStyle: "bold", fontSize: 7.5 },
      bodyStyles: { fontSize: 7, cellPadding: 2 },
      alternateRowStyles: { fillColor: [248, 250, 252] },
      didParseCell: (hook: CellHookData) => {
        if (hook.section === "body" && Array.isArray(hook.row.raw) && String(hook.row.raw[0]).toUpperCase().includes("TOTAL")) {
          hook.cell.styles.fontStyle = "bold";
          hook.cell.styles.fillColor = [253, 236, 238];
        }
      },
      margin: { left: 14, right: 14 },
    });
  };

  const renderGenericTable = (sheet: ReportSheet) => {
    drawBrandedPdfHeader(
      pdf,
      sheet.name.toUpperCase(),
      description,
    );

    autoTable(pdf, {
      startY: 33,
      head: [sheet.headers],
      body: sheet.rows.map((r) =>
        r.map((v, j) =>
          v === null
            ? sheet.headers[j].includes("Costo")
              ? "Sin costo registrado"
              : ""
            : typeof v === "number" && (sheet.headers[j].includes("Bs") || sheet.headers[j].includes("Precio"))
              ? formatBsCurrency(v)
              : String(v),
        ),
      ),
      theme: "grid",
      headStyles: { fillColor: [30, 41, 59], textColor: [255, 255, 255], fontStyle: "bold", fontSize: 7.5 },
      bodyStyles: { fontSize: 7, cellPadding: 2, overflow: "linebreak" },
      alternateRowStyles: { fillColor: [248, 250, 252] },
      didParseCell: (hook: CellHookData) => {
        if (hook.section === "body" && Array.isArray(hook.row.raw) && String(hook.row.raw[0]).toUpperCase().includes("TOTAL")) {
          hook.cell.styles.fontStyle = "bold";
          hook.cell.styles.fillColor = [253, 236, 238];
        }
      },
      margin: { left: 14, right: 14 },
    });
  };

  sheets.forEach((sheet, i) => {
    if (i > 0) {
      const isWide = sheet.headers.length > 8 || sheet.id === "credits" || sheet.id === "sales" || sheet.id === "claims";
      pdf.addPage("letter", isWide ? "landscape" : "portrait");
    }

    const sheetId = sheet.id || SHEET_NAME_TO_ID[sheet.name];
    if (sheetId === "summary") {
      renderSummarySheet(sheet);
    } else if (sheetId === "customerPurchases") {
      renderCustomerPurchasesSheet(sheet);
    } else if (sheetId === "salesKardex") {
      renderSalesKardexSheet(sheet);
    } else if (sheetId === "inventory") {
      renderInventorySheet(sheet);
    } else if (sheetId === "cashFlow") {
      renderCashFlowSheet(sheet);
    } else if (sheetId === "credits") {
      renderCreditsSheet(sheet);
    } else {
      renderGenericTable(sheet);
    }
  });

  const totalPages = pdf.getNumberOfPages();
  const nowStr = new Date().toLocaleString("es-BO");
  for (let p = 1; p <= totalPages; p++) {
    pdf.setPage(p);
    const pWidth = pdf.internal.pageSize.getWidth();
    const pHeight = pdf.internal.pageSize.getHeight();
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(7.5);
    pdf.setTextColor(148, 163, 184);
    pdf.text(`Generado el: ${nowStr} · Embutidos San José`, 14, pHeight - 7);
    pdf.text(`Página ${p} de ${totalPages}`, pWidth - 28, pHeight - 7);
  }

  await saveReport(
    new Uint8Array(pdf.output("arraybuffer")),
    filename,
    "application/pdf",
  );
}
export async function exportCustomerStatement(
  data: DistributionData,
  customer: DistCustomer,
) {
  if (data.receivables.some(r => r.customerId === customer.id && r.pendingConfirmation)) throw new Error('Espera la confirmación del cobro pendiente antes de imprimir el estado de cuenta.')
  const debts = data.receivables.filter((r) => r.customerId === customer.id);
  await exportPdf(
    [
      {
        name: "Estado de cuenta",
        headers: [
          "Fecha",
          "Venta",
          "Productos",
          "Original (Bs)",
          "Abonos (Bs)",
          "Compensación (Bs)",
          "Saldo (Bs)",
        ],
        rows: [
          ...debts.map(
            (r) =>
              [
                reportDate(r.dayKey),
                reportReceiptNumber(r.saleId),
                r.saleLines
                  ?.map(
                    (l) =>
                      `${l.productNameSnapshot}: ${reportQuantity(l.quantity, l.unitType)}`,
                  )
                  .join("; ") || "Consultar venta original",
                r.originalAmount,
                r.paidAmount,
                r.creditedAmount || 0,
                r.balance,
              ] as Cell[],
          ),
          [
            "TOTAL PENDIENTE",
            "",
            "",
            null,
            null,
            null,
            round2(debts.reduce((n, r) => n + r.balance, 0)),
          ],
        ],
      },
    ],
    `${customer.name} · CI ${customer.identityNumber || "pendiente"} · ${customer.phone || ""} · ${customer.address || ""} · emitido ${new Date().toLocaleDateString("es-BO")}`,
    "SanJose-estado-cuenta.pdf",
  );
}

export { generateTodayIntakesPdfBytes, getTodayStockIntakes };

export async function exportTodayIntakesPdf(
  data: Pick<DistributionData, "movements" | "products" | "lots" | "warehouses">,
  warehouseId = "central",
  targetDayKey?: string,
  filename = "SanJose-ingresos-hoy.pdf",
): Promise<void> {
  const bytes = await generateTodayIntakesPdfBytes(data, warehouseId, targetDayKey);
  await saveReport(bytes, filename, "application/pdf");
}

