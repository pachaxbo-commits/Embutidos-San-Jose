import type { DistributionData } from "../state/useDistributionStore";
import type { DistCustomer } from "../types";
import { round2, toDayKey } from "../domain/engine";
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
type Cell = string | number | null;
export interface ReportSheet {
  name: string;
  headers: string[];
  rows: Cell[][];
}
export function reportSheets(
  data: DistributionData,
  days: string[],
  route = "",
  seller = "",
): ReportSheet[] {
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
        inScope(r) &&
        (!seller || r.registeredByUid === seller),
    );
  const claims = data.claims.filter(
    (c) =>
      inScope(c) &&
      (!seller ||
        data.sales.some((s) => s.id === c.saleId && s.sellerUid === seller)),
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
    losses.every((m) => typeof m.lossCost === "number");
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
  const locationName = (location?: string) => {
    if (!location) return "Sin ubicación indicada";
    if (location === "central") return "Almacén central";
    if (location.startsWith("warehouse__")) return warehouseName(location.slice(11));
    if (location.startsWith("route__")) {
      return reportRecordName(
        data.routes.find((item) => item.id === location.slice(7))?.name,
        "Ruta registrada",
      );
    }
    return "Ubicación registrada";
  };
  return [
    {
      name: "Resumen",
      headers: ["Concepto", "Importe (Bs)"],
      rows: [
        ["Ventas netas de cambios y devoluciones", revenue],
        ["Costo de lo vendido y reemplazos", costKnown ? cost : null],
        ["Margen bruto", costKnown ? round2(revenue - cost) : null],
        ["Gastos registrados", spent],
        ["Pérdidas de inventario", costKnown ? lossCost : null],
        [
          "Resultado operativo",
          costKnown ? round2(revenue - cost - spent - lossCost) : null,
        ],
        [
          "Estado de costos",
          costKnown
            ? "Costos completos"
            : "Hay ventas históricas sin costo; no se estima una ganancia falsa",
        ],
      ],
    },
    {
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
      rows: sales.map((s) => [
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
      ]),
    },
    {
      name: "Productos vendidos",
      headers: [
        "Fecha",
        "Comprobante",
        "Producto",
        "Cantidad",
        "Unidad",
        "Precio (Bs)",
        "Importe (Bs)",
        "Costo (Bs)",
        "Lotes",
      ],
      rows: lines.map((l) => [
        reportDate(l.sale.dayKey),
        reportReceiptNumber(l.sale.id),
        l.productNameSnapshot,
        l.quantity,
        reportUnitLabel(l.unitType),
        l.actualUnitPrice,
        l.subtotal,
        l.costTotal ?? null,
        l.allocations?.map((a) => `${a.lotCode}: ${a.quantity}`).join("; ") ||
          "Sin datos históricos",
      ]),
    },
    {
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
      rows: credits.map((r) => [
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
      ]),
    },
    {
      name: "Cobros",
      headers: [
        "Fecha",
        "Cliente",
        "CI",
        "Responsable",
        "Método",
        "Importe (Bs)",
      ],
      rows: collections.map((c) => [
        reportDateTime(c.createdAt),
        c.customerName,
        c.customerCode || "",
        reportPersonName(c.collectedByName),
        reportPaymentLabel(c.method),
        c.amount,
      ]),
    },
    {
      name: "Gastos",
      headers: ["Fecha", "Ruta", "Responsable", "Concepto", "Importe (Bs)"],
      rows: expenses.map((e) => [
        reportDateTime(e.createdAt),
        reportRecordName(e.routeName, "Ruta registrada"),
        reportPersonName(e.registeredByName),
        e.concept,
        e.amount,
      ]),
    },
    {
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
      rows: data.closures
        .filter(inScope)
        .filter((c) => !seller || c.distributorUid === seller)
        .map((c) => [
          reportDateTime(c.createdAt),
          reportPersonName(c.distributorName),
          reportRecordName(c.routeName, "Ruta registrada"),
          reportClosureLabel(c.status),
          c.expectedCash ?? null,
          c.physicalCashDeclared ?? null,
          c.cashDifference ?? null,
        ]),
    },
    {
      name: "Inventario por lote",
      headers: [
        "Producto",
        "Lote",
        "Elaboración",
        "Vencimiento",
        "Ubicación",
        "Cantidad",
        "Unidad",
        "Estado",
      ],
      rows: data.lots.flatMap((l) =>
        Object.entries(l.quantities)
          .filter(([, q]) => q > 0)
          .map(
            ([loc, q]) =>
              [
                l.productName,
                l.lotCode,
                l.manufacturedOn,
                l.expiresOn,
                locationName(loc),
                q,
                reportUnitLabel(l.unitType),
                l.quarantined
                  ? "Separado"
                  : l.expiresOn &&
                      l.expiresOn < new Date().toLocaleDateString("en-CA")
                    ? "Vencido"
                    : "Disponible",
              ] as Cell[],
          ),
      ),
    },
    {
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
      ],
      rows: claims.map((c) => [
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
      ]),
    },
  ];
}
export async function exportExcel(sheets: ReportSheet[], description: string) {
  const { Workbook } = await import("exceljs");
  const book = new Workbook();
  book.creator = "Embutidos San José";
  for (const sheet of sheets) {
    const ws = book.addWorksheet(sheet.name);
    ws.mergeCells(1, 1, 1, sheet.headers.length);
    ws.getCell(1, 1).value = `EMBUTIDOS SAN JOSÉ · ${sheet.name}`;
    ws.getCell(1, 1).font = { bold: true, size: 14 };
    ws.mergeCells(2, 1, 2, sheet.headers.length);
    ws.getCell(2, 1).value = description;
    ws.getCell(2, 1).alignment = { wrapText: true };
    ws.getRow(2).height = 30;
    ws.getRow(4).values = sheet.headers;
    ws.getRow(4).eachCell((c) => {
      c.font = { bold: true, color: { argb: "FFFFFFFF" } };
      c.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FF1F2937" },
      };
    });
    ws.addRows(sheet.rows);
    ws.columns.forEach((c, i) => {
      c.width =
        sheet.headers[i].includes("Producto") ||
        sheet.headers[i].includes("Motivo")
          ? 36
          : 23;
    });
    ws.views = [{ state: "frozen", ySplit: 4 }];
    ws.autoFilter = {
      from: { row: 4, column: 1 },
      to: { row: Math.max(4, ws.rowCount), column: sheet.headers.length },
    };
    for (let r = 5; r <= ws.rowCount; r++) {
      ws.getRow(r).alignment = { vertical: "top", wrapText: true };
      ws.getRow(r).eachCell((c, col) => {
        if (typeof c.value === "number")
          c.numFmt = sheet.headers[col - 1].includes("Bs")
            ? "#,##0.00"
            : "0.##";
      });
    }
  }
  const buffer = await book.xlsx.writeBuffer();
  await saveReport(
    new Uint8Array(buffer),
    "SanJose-reportes.xlsx",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  );
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
  const pdf = new jsPDF({ orientation: "landscape" });
  const header = () => {
    pdf.setTextColor(145, 20, 30);
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(15);
    pdf.text("EMBUTIDOS SAN JOSE", 14, 15);
    pdf.setTextColor(30, 40, 50);
    pdf.setFontSize(9);
    pdf.setFont("helvetica", "normal");
    pdf.text(description, 14, 22, { maxWidth: 268 });
  };
  sheets.forEach((s, i) => {
    if (i) pdf.addPage();
    header();
    pdf.setFontSize(11);
    pdf.text(s.name, 14, 35);
    autoTable(pdf, {
      head: [s.headers],
      body: s.rows.map((r) =>
        r.map((v, j) =>
          v === null
            ? s.headers[j].includes("Costo")
              ? "Sin costo registrado"
              : ""
            : String(v),
        ),
      ),
      startY: 40,
      margin: { top: 32, bottom: 16 },
      styles: { fontSize: 7, cellPadding: 2, overflow: "linebreak" },
      headStyles: { fillColor: [31, 41, 55] },
      didDrawPage: () => {
        header();
        pdf.setFontSize(8);
        pdf.text(`Página ${pdf.getNumberOfPages()}`, 270, 200);
      },
    });
  });
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
