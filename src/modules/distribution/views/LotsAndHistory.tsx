import { useEffect, useState } from "react";
import { AlertTriangle, ChevronRight, Download, History, Printer } from "lucide-react";
import { Field, TextInput, NumberInput } from "../../../components/ui/Form";
import { Modal } from "../../../components/ui/Modal";
import { PrimaryButton, SectionCard, formatQty } from "./shared";
import { submitOperation } from "../data/operationQueue";
import { loadProductLocationBalance, loadProductMovementPage, newOperationId, type ProductMovementCursor } from "../data/distributionRepository";
import { toDayKey } from "../domain/engine";
import { exportExcel, exportPdf, exportTodayIntakesPdf, type ReportSheet } from "../data/reportExports";
import { getTodayStockIntakes } from "../domain/todayIntakes";
import type { DistributionViewProps } from "./DistributionApp";
import type { DistLot } from "../types";
import { visiblePersonName } from "./displayText";
import { lotUpdateReasonError } from "../domain/rejectedOperations";
import { filterProductMovementHistory, type ProductMovementFilter } from "../domain/productMovementHistory";
import { calculateProductKardex } from "../domain/productKardex";
import type { DistStockMovement } from "../types";

function shiftDayKey(dayKey: string, amount: number): string {
  const value = new Date(`${dayKey}T12:00:00Z`)
  value.setUTCDate(value.getUTCDate() + amount)
  return value.toISOString().slice(0, 10)
}

const MOVEMENT_LABELS: Record<string, string> = {
  intake: "Ingreso de stock",
  transfer: "Transferencia entre almacenes",
  dispatch: "Despacho a ruta",
  dispatch_addition: "Aumento de despacho",
  dispatch_correction: "Corrección de despacho",
  dispatch_waste: "Pérdida histórica en despacho",
  dispatch_merma: "Merma adicional de despacho",
  sale: "Venta",
  return: "Retorno",
  return_merma: "Merma recuperable de retorno",
  return_waste: "Producto no apto / pérdida",
  return_waste_unassigned: "Pérdida sin lote asignado",
  adjustment: "Baja o ajuste",
  shortage: "Faltante",
  overage: "Sobrante",
  exchange: "Cambio de producto",
  customer_return: "Devolución de cliente",
  quarantine_release: "Liberación auditada de cuarentena",
  quarantine_discard: "Descarte auditado de cuarentena",
};

export function StockAlerts({ data }: Pick<DistributionViewProps, "data">) {
  const [modalOpen, setModalOpen] = useState(false);
  const today = toDayKey();
  const limit = new Date();
  const alertDays = data.supportSettings.expiryAlertDays || 7;
  limit.setDate(limit.getDate() + alertDays);
  const last = toDayKey(limit);

  const lotsExpired: DistLot[] = [];
  const lotsExpiringSoon: DistLot[] = [];

  for (const l of data.lots) {
    if (!l.expiresOn) continue;
    const totalQty = Object.values(l.quantities || {}).reduce((a, b) => a + b, 0);
    if (totalQty <= 0) continue;

    if (l.expiresOn < today) {
      lotsExpired.push(l);
    } else if (l.expiresOn <= last) {
      lotsExpiringSoon.push(l);
    }
  }

  const emptyProducts = data.products.filter(
    (p) =>
      p.active &&
      (p.minimumStock || 0) > 0 &&
      !data.balances.some((b) => b.productId === p.id && b.locationKind === "central")
  );

  const lowBalances = data.balances.filter(
    (b) =>
      b.locationKind === "central" &&
      (b.availableQuantity ?? b.quantity) <=
        (data.products.find((p) => p.id === b.productId)?.minimumStock || 0)
  );

  const totalAlerts = lotsExpired.length + lotsExpiringSoon.length + emptyProducts.length + lowBalances.length;
  if (totalAlerts === 0) return null;

  const hasExpired = lotsExpired.length > 0;

  return (
    <>
      <button
        type="button"
        onClick={() => setModalOpen(true)}
        className={`w-full text-left rounded-xl border p-2.5 sm:p-3 transition shadow-xs flex items-center justify-between gap-3 ${
          hasExpired
            ? "border-rose-300 bg-rose-50/90 hover:bg-rose-100/90 text-rose-950"
            : "border-amber-300 bg-amber-50/90 hover:bg-amber-100/90 text-amber-950"
        }`}
      >
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="relative flex shrink-0 items-center justify-center">
            {hasExpired && (
              <span className="absolute -top-0.5 -right-0.5 flex h-2.5 w-2.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-rose-600"></span>
              </span>
            )}
            <div className={`p-1.5 rounded-lg ${hasExpired ? "bg-rose-200/80 text-rose-700" : "bg-amber-200/80 text-amber-700"}`}>
              <AlertTriangle size={18} />
            </div>
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-xs font-black uppercase tracking-wider">
                {totalAlerts} {totalAlerts === 1 ? "ALERTA DE INVENTARIO" : "ALERTAS DE INVENTARIO"}
              </span>
              {hasExpired && (
                <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-rose-600 text-white animate-pulse">
                  {lotsExpired.length} {lotsExpired.length === 1 ? "vencido" : "vencidos"}
                </span>
              )}
            </div>
            <p className="text-[11px] font-semibold text-slate-600 truncate mt-0.5">
              {[
                lotsExpired.length > 0 && `${lotsExpired.length} vencidos`,
                lotsExpiringSoon.length > 0 && `${lotsExpiringSoon.length} por vencer`,
                (lowBalances.length + emptyProducts.length) > 0 && `${lowBalances.length + emptyProducts.length} stock bajo`,
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
          </div>
        </div>

        <div className="shrink-0 flex items-center gap-1 text-xs font-black text-slate-700">
          <span>Ver alertas</span>
          <ChevronRight size={16} />
        </div>
      </button>

      <Modal isOpen={modalOpen} title="Alertas de inventario" onClose={() => setModalOpen(false)}>
          <div className="space-y-4 max-h-[75vh] overflow-y-auto pr-1">
            {lotsExpired.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <span className="px-2 py-0.5 rounded-md bg-rose-100 text-rose-800 text-[11px] font-black uppercase">
                    Vencidos ({lotsExpired.length})
                  </span>
                </div>
                <div className="grid gap-2">
                  {lotsExpired.map((l) => {
                    const totalQty = Object.values(l.quantities || {}).reduce((a, b) => a + b, 0);
                    return (
                      <div key={l.id} className="rounded-xl border border-rose-200 bg-rose-50/60 p-2.5 text-xs">
                        <div className="flex items-start justify-between gap-2">
                          <span className="font-black text-rose-950">{l.productName}</span>
                          <span className="font-black text-rose-700 shrink-0">
                            {formatQty(totalQty, l.unitType)}
                          </span>
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-rose-800">
                          <span>Lote: <strong>{l.lotCode}</strong></span>
                          <span>Venció el: <strong>{l.expiresOn}</strong></span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {lotsExpiringSoon.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <span className="px-2 py-0.5 rounded-md bg-amber-100 text-amber-900 text-[11px] font-black uppercase">
                    Próximos a vencer ({lotsExpiringSoon.length})
                  </span>
                </div>
                <div className="grid gap-2">
                  {lotsExpiringSoon.map((l) => {
                    const totalQty = Object.values(l.quantities || {}).reduce((a, b) => a + b, 0);
                    const diffMs = new Date(l.expiresOn).getTime() - new Date(today).getTime();
                    const diffDays = Math.max(0, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));
                    const remainingLabel = diffDays === 0 ? "Vence hoy" : `Vence en ${diffDays} ${diffDays === 1 ? "día" : "días"}`;
                    return (
                      <div key={l.id} className="rounded-xl border border-amber-200 bg-amber-50/60 p-2.5 text-xs">
                        <div className="flex items-start justify-between gap-2">
                          <span className="font-black text-amber-950">{l.productName}</span>
                          <span className="font-black text-amber-800 shrink-0">
                            {formatQty(totalQty, l.unitType)}
                          </span>
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-amber-800">
                          <span>Lote: <strong>{l.lotCode}</strong></span>
                          <span className="font-bold text-amber-900">
                            {remainingLabel} ({l.expiresOn})
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {(emptyProducts.length > 0 || lowBalances.length > 0) && (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <span className="px-2 py-0.5 rounded-md bg-yellow-100 text-yellow-900 text-[11px] font-black uppercase">
                    Stock bajo ({emptyProducts.length + lowBalances.length})
                  </span>
                </div>
                <div className="grid gap-2">
                  {emptyProducts.map((p) => (
                    <div key={p.id} className="rounded-xl border border-yellow-200 bg-yellow-50/60 p-2.5 text-xs">
                      <div className="flex items-start justify-between gap-2">
                        <span className="font-black text-yellow-950">{p.name}</span>
                        <span className="font-black text-rose-700 shrink-0">Sin existencias</span>
                      </div>
                      <div className="mt-1 text-[11px] text-yellow-900">
                        Almacén Central · Mínimo configurado: <strong>{formatQty(p.minimumStock || 0, p.unitType)}</strong>
                      </div>
                    </div>
                  ))}
                  {lowBalances.map((b) => {
                    const product = data.products.find((p) => p.id === b.productId);
                    const minStock = product?.minimumStock || 0;
                    const whName = b.warehouseId === "central" || !b.warehouseId
                      ? "Central"
                      : data.warehouses.find((w) => w.id === b.warehouseId)?.name || "Central";
                    return (
                      <div key={b.id} className="rounded-xl border border-yellow-200 bg-yellow-50/60 p-2.5 text-xs">
                        <div className="flex items-start justify-between gap-2">
                          <span className="font-black text-yellow-950">{b.productName}</span>
                          <span className="font-black text-amber-900 shrink-0">
                            {formatQty(b.availableQuantity ?? b.quantity, b.unitType)} disp.
                          </span>
                        </div>
                        <div className="mt-1 text-[11px] text-yellow-900">
                          {whName} · Mínimo configurado: <strong>{formatQty(minStock, b.unitType)}</strong>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </Modal>
    </>
  );
}
export function LotsAndHistory({ data, session }: DistributionViewProps) {
  const [search, setSearch] = useState(""), [month, setMonth] = useState(toDayKey().slice(0, 7));
  const [editing, setEditing] = useState<DistLot | null>(null);
  const [code, setCode] = useState(""),
    [made, setMade] = useState(""),
    [expiry, setExpiry] = useState(""),
    [cost, setCost] = useState(""),
    [reason, setReason] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const [exportingToday, setExportingToday] = useState(false);
  const [todayMsg, setTodayMsg] = useState<string | null>(null);
  const [kardexProductId, setKardexProductId] = useState("");
  const [kardexFilter, setKardexFilter] = useState<ProductMovementFilter>("all");
  const [openedKardexProductId, setOpenedKardexProductId] = useState("");
  const [kardexPeriod, setKardexPeriod] = useState<'today' | 'week' | 'month' | 'custom'>('month');
  const [kardexFrom, setKardexFrom] = useState(toDayKey().slice(0, 7) + '-01');
  const [kardexTo, setKardexTo] = useState(toDayKey());
  const [kardexLocation, setKardexLocation] = useState('central');
  const [kardexMovements, setKardexMovements] = useState<DistStockMovement[]>([]);
  const [kardexCursor, setKardexCursor] = useState<ProductMovementCursor | null>(null);
  const [kardexHasMore, setKardexHasMore] = useState(false);
  const [kardexLoading, setKardexLoading] = useState(false);
  const [kardexError, setKardexError] = useState('');
  const [kardexRawBalance, setKardexRawBalance] = useState<number | null>(null);
  const [kardexExporting, setKardexExporting] = useState(false);

  const handlePrintToday = async () => {
    if (exportingToday) return;
    const todayIntakes = getTodayStockIntakes(data, session.warehouseId || "central");
    if (todayIntakes.items.length === 0) {
      setTodayMsg("No hay ingresos de inventario registrados hoy.");
      return;
    }
    setExportingToday(true);
    setTodayMsg(null);
    try {
      await exportTodayIntakesPdf(data, session.warehouseId || "central");
    } catch (err) {
      setTodayMsg((err as Error).message || "No se pudo generar el reporte.");
    } finally {
      setExportingToday(false);
    }
  };
  const open = (l: DistLot) => {
    setEditing(l);
    setCode(l.lotCode);
    setMade(l.manufacturedOn);
    setExpiry(l.expiresOn);
    setCost(l.productionCost === null ? "" : String(l.productionCost));
    setReason("");
    setError("");
  };
  const term = search.toLowerCase();
  const lots = data.lots.filter((l) =>
    [l.productName, l.lotCode].join(" ").toLowerCase().includes(term),
  );
  const kardexProduct = data.products.find((product) => product.id === openedKardexProductId) || null;
  const today = toDayKey();
  const weekStart = shiftDayKey(today, -((new Date(`${today}T12:00:00Z`).getUTCDay() + 6) % 7));
  const kardexRange = kardexPeriod === 'today' ? [today, today] : kardexPeriod === 'week' ? [weekStart, today] : kardexPeriod === 'month' ? [`${today.slice(0, 7)}-01`, today] : [kardexFrom, kardexTo];
  const locationOptions = [
    { id: 'all', name: 'Todas las ubicaciones (total físico)' },
    { id: 'central', name: 'Almacén Central' },
    ...data.warehouses.filter((warehouse) => warehouse.id !== 'central' && warehouse.active !== false).map((warehouse) => ({ id: `warehouse__${warehouse.id}`, name: warehouse.name })),
    ...data.routes.filter((route) => route.active !== false).map((route) => ({ id: `route__${route.id}`, name: route.name })),
  ];

  useEffect(() => {
    if (!openedKardexProductId) return;
    let cancelled = false;
    const load = async () => {
      setKardexMovements([]); setKardexCursor(null); setKardexHasMore(false); setKardexError(''); setKardexLoading(true);
      try {
        const page = await loadProductMovementPage(openedKardexProductId, null);
        if (cancelled) return;
        setKardexMovements(page.movements); setKardexCursor(page.nextCursor); setKardexHasMore(page.hasMore);
      } catch (loadError) {
        if (!cancelled) setKardexError((loadError as Error).message || 'No se pudo consultar el Kardex.');
      } finally {
        if (!cancelled) setKardexLoading(false);
      }
    };
    void load();
    return () => { cancelled = true };
  }, [openedKardexProductId]);

  useEffect(() => {
    if (!openedKardexProductId || kardexLocation === 'all') return;
    let cancelled = false;
    void loadProductLocationBalance(openedKardexProductId, kardexLocation).then((balance) => { if (!cancelled) setKardexRawBalance(balance) }).catch(() => { if (!cancelled) setKardexRawBalance(null) });
    return () => { cancelled = true };
  }, [openedKardexProductId, kardexLocation]);

  const loadMoreKardex = async () => {
    if (!openedKardexProductId || !kardexHasMore || kardexLoading) return;
    setKardexLoading(true); setKardexError('');
    try {
      const page = await loadProductMovementPage(openedKardexProductId, kardexCursor);
      setKardexMovements((current) => [...current, ...page.movements]); setKardexCursor(page.nextCursor); setKardexHasMore(page.hasMore);
    } catch (loadError) { setKardexError((loadError as Error).message || 'No se pudieron cargar movimientos anteriores.') }
    finally { setKardexLoading(false) }
  };

  const allKardexRows = kardexProduct ? calculateProductKardex(kardexMovements, kardexProduct.id, kardexLocation) : [];
  const ledgerDelta = allKardexRows.at(-1)?.runningBalance || 0;
  const openingBaseline = kardexRawBalance === null ? null : kardexRawBalance - ledgerDelta;
  const openingIsVerifiable = !kardexHasMore && openingBaseline !== null && Math.abs(openingBaseline) < 0.0005;
  const kardexRows = kardexProduct ? calculateProductKardex(kardexMovements, kardexProduct.id, kardexLocation, openingIsVerifiable ? Number(openingBaseline) : 0) : [];
  const filteredKardex = (() => {
    const ids = new Set(filterProductMovementHistory(kardexMovements, openedKardexProductId, kardexFilter).map((movement) => movement.id));
    return kardexRows.filter((row) => {
      const day = row.movement.dayKey || toDayKey(new Date(row.movement.createdAt));
      return ids.has(row.movement.id) && day >= kardexRange[0] && day <= kardexRange[1];
    });
  })();
  const exportKardex = async (format: 'pdf' | 'excel') => {
    if (!kardexProduct || kardexHasMore || !filteredKardex.length || kardexExporting) return;
    setKardexExporting(true); setKardexError('');
    try {
      const locationName = locationOptions.find((item) => item.id === kardexLocation)?.name || kardexLocation;
      const description = `${kardexProduct.name} · ${locationName} · ${kardexRange[0]} a ${kardexRange[1]}`;
      const detailHeaders = ['Fecha y hora', 'Jornada', 'Movimiento', 'Lote', 'Ubicación origen', 'Ubicación destino', 'Entrada', 'Salida', 'Saldo acumulado', 'Responsable', 'Referencia', 'Observación'];
      const detailRows: ReportSheet['rows'] = filteredKardex.map(({ movement, entry, exit, runningBalance, excludedFromBalance }) => [new Date(movement.createdAt).toLocaleString('es-BO', { timeZone: 'America/La_Paz' }), movement.dayKey || 'No disponible', `${MOVEMENT_LABELS[movement.type] || movement.type}${excludedFromBalance ? ' · revertido/rectificado (excluido del saldo)' : ''}`, movement.lotCode || '', movement.fromLocation || '', movement.toLocation || '', entry, exit, runningBalance, visiblePersonName(movement.responsibleName || 'No disponible'), movement.refId || '', [movement.note, movement.rectificationReason, movement.reversalReason].filter(Boolean).join(' · ')]);
      const sheets: ReportSheet[] = [
        { name: 'Resumen de Kardex', headers: ['Concepto', 'Valor', 'Unidad', 'Nota'], rows: [
          ['Producto', kardexProduct.name, '', ''], ['Ubicación', locationName, '', ''], ['Periodo operativo', `${kardexRange[0]} a ${kardexRange[1]}`, '', 'Fecha dayKey del movimiento'],
          ['Saldo inicial de periodo', openingIsVerifiable ? (filteredKardex[0] ? filteredKardex[0].runningBalance - filteredKardex[0].delta : Number(openingBaseline)) : 'No verificable', kardexProduct.unitType, openingIsVerifiable ? 'Reconstruido con historial completo' : 'No se inventa saldo inicial'],
          ['Saldo final de periodo', openingIsVerifiable ? (filteredKardex.at(-1)?.runningBalance ?? 'Sin movimientos') : 'No verificable', kardexProduct.unitType, openingIsVerifiable ? 'Ledger completo conciliado con saldo Firestore' : 'No se inventa saldo de apertura'],
          ['Saldo actual Firestore', kardexRawBalance ?? 'No disponible', kardexProduct.unitType, kardexLocation === 'all' ? 'No existe un único documento agregado de saldo' : 'Lectura del saldo físico guardado'],
        ] },
        { name: 'Movimientos', headers: detailHeaders, rows: detailRows },
      ];
      const base = `kardex-${kardexProduct.id}-${kardexRange[0]}-${kardexRange[1]}`;
      if (format === 'pdf') await exportPdf(sheets, description, `${base}.pdf`);
      else await exportExcel(sheets, description, `${base}.xlsx`);
    } catch (exportError) { setKardexError((exportError as Error).message || 'No se pudo exportar el Kardex.') }
    finally { setKardexExporting(false) }
  };
  return (
    <div className="mt-4 grid gap-3">
      <StockAlerts data={data} />
      <SectionCard title="Existencias por lote">
        <TextInput
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Producto o lote"
        />
        <div className="mt-3 grid gap-2">
          {lots.map((l) => (
            <div key={l.id} className="rounded-xl border p-3 text-xs">
              <p className="font-bold">
                {l.productName} · {l.lotCode}
              </p>
              <p>
                Elaboración: {l.manufacturedOn || "Sin registrar"} · Vence:{" "}
                {l.expiresOn || "Sin registrar"}
              </p>
              {l.quarantined && (
                <p className="font-bold text-rose-700">
                  Separado: no disponible para venta
                </p>
              )}
              {Object.entries(l.quantities)
                .filter(([, q]) => q > 0)
                .map(([loc, q]) => (
                  <p key={loc}>
                    {loc === "central"
                      ? "Central"
                      : loc.startsWith("route__")
                        ? data.routes.find((r) => r.id === loc.slice(7))
                            ?.name || "Ruta de registro anterior"
                        : data.warehouses.find((w) => w.id === loc.slice(11))
                            ?.name || "Almacén de registro anterior"}
                    : {formatQty(q, l.unitType)}
                  </p>
                ))}
              {session.role === "admin" && (
                <button
                  className="mt-2 font-bold underline"
                  onClick={() => open(l)}
                >
                  Completar / corregir datos del lote
                </button>
              )}
            </div>
          ))}
          {!lots.length && (
            <p className="text-xs text-slate-500">
              El stock anterior se identificará como lote sin fechas al
              registrar su primer movimiento. No se inventan vencimientos.
            </p>
          )}
        </div>
      </SectionCard>
      <SectionCard title="Kardex completo por producto">
        <p className="text-xs text-slate-600">Consulta por fecha y ubicación el historial paginado del servidor: ingresos, despachos, ventas, retornos, mermas, faltantes, sobrantes, ajustes y rectificaciones.</p>
        <div className="mt-2 grid min-w-0 gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
          <Field label="Producto">
            <select className="min-h-11 w-full min-w-0 rounded-xl border border-slate-300 bg-white px-3 text-sm" value={kardexProductId} onChange={(event) => setKardexProductId(event.target.value)}>
              <option value="">Selecciona un producto</option>
              {data.products.slice().sort((a, b) => a.name.localeCompare(b.name)).map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}
            </select>
          </Field>
          <button type="button" disabled={!kardexProductId} onClick={() => setOpenedKardexProductId(kardexProductId)} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-3 text-xs font-extrabold text-slate-800 disabled:opacity-50"><History size={15}/> Consultar Kardex</button>
        </div>
        {kardexProduct && <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
          <div className="flex min-w-0 flex-wrap items-start justify-between gap-2"><div className="min-w-0"><h3 className="break-words text-sm font-black text-slate-900">Kardex · {kardexProduct.name}</h3><p className="text-xs text-slate-600">{kardexMovements.length} movimientos descargados de forma paginada</p></div><span className="rounded-full bg-white px-2 py-1 text-[10px] font-bold text-slate-600">{locationOptions.find((item) => item.id === kardexLocation)?.name}</span></div>
          <div className="mt-3 grid min-w-0 gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Periodo"><select className="min-h-11 w-full min-w-0 rounded-xl border border-slate-300 bg-white px-3 text-sm" value={kardexPeriod} onChange={(event) => setKardexPeriod(event.target.value as typeof kardexPeriod)}><option value="today">Hoy</option><option value="week">Semana</option><option value="month">Mes</option><option value="custom">Fechas</option></select></Field>
            {kardexPeriod === 'custom' && <><Field label="Desde"><TextInput type="date" value={kardexFrom} onChange={(event) => setKardexFrom(event.target.value)} /></Field><Field label="Hasta"><TextInput type="date" value={kardexTo} onChange={(event) => setKardexTo(event.target.value)} /></Field></>}
            <Field label="Ubicación"><select className="min-h-11 w-full min-w-0 rounded-xl border border-slate-300 bg-white px-3 text-sm" value={kardexLocation} onChange={(event) => setKardexLocation(event.target.value)}>{locationOptions.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field>
            <Field label="Tipo de movimiento"><select className="min-h-11 w-full min-w-0 rounded-xl border border-slate-300 bg-white px-3 text-sm" value={kardexFilter} onChange={(event) => setKardexFilter(event.target.value as ProductMovementFilter)}><option value="all">Todos</option><option value="losses">Mermas y pérdidas</option><option value="differences">Faltantes / sobrantes</option><option value="dispatchReturns">Despachos / retornos</option><option value="intakesAdjustments">Ingresos / ajustes</option></select></Field>
          </div>
          <div className="mt-3 grid gap-2 sm:grid-cols-3">
            <div className="rounded-xl bg-white p-2.5 text-xs"><span className="font-bold text-slate-600">Saldo inicial del periodo</span><p className="mt-1 font-black text-slate-900">{openingIsVerifiable ? formatQty(filteredKardex[0] ? filteredKardex[0].runningBalance - filteredKardex[0].delta : Number(openingBaseline), kardexProduct.unitType) : 'No verificable todavía'}</p></div>
            <div className="rounded-xl bg-white p-2.5 text-xs"><span className="font-bold text-slate-600">Saldo final del periodo</span><p className="mt-1 font-black text-slate-900">{!openingIsVerifiable ? 'No verificable' : filteredKardex.length ? formatQty(filteredKardex.at(-1)!.runningBalance, kardexProduct.unitType) : 'Sin movimientos para el filtro'}</p></div>
            <div className="rounded-xl bg-white p-2.5 text-xs"><span className="font-bold text-slate-600">Saldo actual en Firestore</span><p className="mt-1 font-black text-slate-900">{kardexLocation === 'all' || kardexRawBalance === null ? 'No disponible para total agregado' : formatQty(kardexRawBalance, kardexProduct.unitType)}</p></div>
          </div>
          {!openingIsVerifiable && <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 p-2 text-[11px] font-semibold text-amber-900">{kardexHasMore ? 'El historial está paginado. Carga movimientos anteriores para reconstruir saldos y habilitar una exportación completa.' : 'El historial disponible no contiene un saldo inicial verificable; no se inventa un saldo de apertura. El acumulado mostrado parte del primer movimiento recuperado.'}</p>}
          {!kardexHasMore && kardexLocation !== 'all' && kardexRawBalance !== null && allKardexRows.length > 0 && Math.abs(allKardexRows.at(-1)!.runningBalance - kardexRawBalance) > (kardexProduct.unitType === 'kg' ? 0.001 : 0.01) && <p className="mt-2 rounded-lg border border-rose-200 bg-rose-50 p-2 text-[11px] font-semibold text-rose-900">El Kardex completo no concilia automáticamente con el saldo físico de Firestore. Revisión requerida; no se aplica ningún ajuste.</p>}
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" disabled={kardexLoading || !kardexHasMore} onClick={() => void loadMoreKardex()} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-3 text-xs font-extrabold text-slate-800 disabled:opacity-50">{kardexLoading ? 'Cargando…' : 'Cargar movimientos anteriores'}</button>
            <button type="button" disabled={kardexHasMore || kardexLoading || kardexExporting || !filteredKardex.length} onClick={() => void exportKardex('pdf')} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-[var(--primary)] px-3 text-xs font-extrabold text-white disabled:opacity-50"><Download size={15}/>{kardexExporting ? 'Preparando…' : 'Descargar PDF'}</button>
            <button type="button" disabled={kardexHasMore || kardexLoading || kardexExporting || !filteredKardex.length} onClick={() => void exportKardex('excel')} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-3 text-xs font-extrabold text-slate-800 disabled:opacity-50"><Download size={15}/>{kardexExporting ? 'Preparando…' : 'Descargar Excel'}</button>
          </div>
          {kardexError && <p role="alert" className="mt-2 text-xs font-bold text-rose-700">{kardexError}</p>}
          <div className="mt-3 grid gap-2">
            {filteredKardex.slice().reverse().map(({ movement, entry, exit, runningBalance, excludedFromBalance }) => {
              const normal = Number(movement.normalQuantity || 0);
              const merma = Number(movement.dispatchMerma || 0);
              const charged = Number(movement.chargedQuantity ?? movement.quantity);
              const excess = Number(movement.excessWeightQuantity || 0);
              return <details key={movement.id} className={`min-w-0 rounded-xl border p-2.5 text-xs ${excludedFromBalance ? "border-slate-200 bg-slate-100" : "border-white bg-white"}`}>
                <summary className="flex cursor-pointer list-none min-w-0 flex-wrap items-start justify-between gap-2"><div className="min-w-0"><p className="break-words font-extrabold text-slate-900">{MOVEMENT_LABELS[movement.type] || movement.type.replaceAll("_", " ")}</p><p className="text-[11px] text-slate-600">{new Date(movement.createdAt).toLocaleString("es-BO", { timeZone: "America/La_Paz" })} · {visiblePersonName(movement.responsibleName || "Responsable no disponible")}</p></div><strong className="shrink-0 tabular-nums">+{formatQty(entry, movement.unitType)} / −{formatQty(exit, movement.unitType)} · saldo {openingIsVerifiable ? formatQty(runningBalance, movement.unitType) : 'No verificable'}</strong></summary>
                {(["dispatch", "dispatch_addition", "dispatch_correction"].includes(movement.type)) && (normal > 0 || merma > 0) && <p className="mt-1 font-semibold text-slate-700">Despacho normal {formatQty(normal || movement.quantity - merma, movement.unitType)} + merma adicional {formatQty(merma, movement.unitType)} = {formatQty(normal + merma || movement.quantity, movement.unitType)} físico.</p>}
                {movement.type === "sale" && excess > 0 && <p className="mt-1 font-semibold text-slate-700">Cobrado {formatQty(charged, movement.unitType)} · entregado {formatQty(charged + excess, movement.unitType)} · excedente sin cobro {formatQty(excess, movement.unitType)}.</p>}
                <p className="mt-1 break-words text-[11px] text-slate-600">Lote: {movement.lotCode || "No indicado"}{movement.routeId ? ` · ${data.routes.find((route) => route.id === movement.routeId)?.name || "Ruta"}` : ""}{movement.fromLocation ? ` · Desde ${movement.fromLocation}` : ""}{movement.toLocation ? ` · Hacia ${movement.toLocation}` : ""}</p>
                <p className="mt-1 text-[11px] text-slate-600">Responsable: {visiblePersonName(movement.responsibleName || 'No disponible')} · Referencia: {movement.refType || 'Movimiento'} {movement.refId || 'No disponible'}</p>
                {movement.note && <p className="mt-1 break-words text-[11px] text-slate-600">Observación: {movement.note}</p>}
                {movement.reversedAt && <p className="mt-1 font-bold text-amber-800">Revertido el {new Date(movement.reversedAt).toLocaleString("es-BO", { timeZone: "America/La_Paz" })}{movement.reversalReason ? ` · ${movement.reversalReason}` : ""} · excluido del saldo vigente.</p>}
                {movement.rectifiedAt && <p className="mt-1 font-bold text-amber-800">Rectificado el {new Date(movement.rectifiedAt).toLocaleString("es-BO", { timeZone: "America/La_Paz" })}{movement.rectificationReason ? ` · ${movement.rectificationReason}` : ""} · conserva el registro original, excluido del saldo.</p>}
              </details>
            })}
            {!filteredKardex.length && <p className="text-xs text-slate-500">No hay movimientos para este producto en el periodo y ubicación seleccionados.</p>}
          </div>
        </div>}
      </SectionCard>
      <SectionCard title="Historial de ingresos y movimientos">
        <Field label="Mes">
          <TextInput
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
          />
        </Field>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <button
            type="button"
            disabled={exportingToday}
            onClick={() => void handlePrintToday()}
            className="flex min-h-[38px] items-center justify-center gap-2 rounded-xl bg-emerald-700 px-3.5 text-xs font-extrabold text-white shadow-xs hover:bg-emerald-800 disabled:opacity-50"
          >
            <Printer size={15} />
            <span>{exportingToday ? "Generando…" : "Imprimir ingresos de hoy (PDF)"}</span>
          </button>
          {todayMsg && (
            <p className="text-xs font-bold text-rose-700">{todayMsg}</p>
          )}
        </div>
        <div className="mt-3 grid gap-2">
          {data.movements
            .filter(
              (m) =>
                (!month || m.createdAt.slice(0, 7) === month) &&
                m.productName.toLowerCase().includes(term),
            )
            .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
            .map((m) => (
              <p key={m.id} className="border-b py-2 text-xs">
                <strong>
                  {m.productName} · {formatQty(m.quantity, m.unitType)}
                </strong>
                <br />
                {MOVEMENT_LABELS[m.type] || "Movimiento de inventario"} · {new Date(m.createdAt).toLocaleString("es-BO")} ·{" "}
                {m.responsibleRole === "admin" ? "Administración" : m.responsibleRole === "warehouse" ? "Almacén" : "Usuario"} · {visiblePersonName(m.responsibleName)}
                <br />
                {m.note}
              </p>
            ))}
        </div>
      </SectionCard>
      <Modal
        isOpen={!!editing}
        onClose={() => setEditing(null)}
        title="Datos del lote"
        footer={
          <PrimaryButton
            disabled={busy}
            onClick={async () => {
              if (!editing) return;
              const reasonError = lotUpdateReasonError(reason);
              if (reasonError) {
                setError(reasonError);
                return;
              }
              setBusy(true);
              try {
                await submitOperation(
                  "updateLot",
                  {
                    lotId: editing.id,
                    lotCode: code,
                    manufacturedOn: made,
                    expiresOn: expiry,
                    productionCost: cost === "" ? null : Number(cost),
                    reason,
                  },
                  newOperationId("lot"),
                );
                setEditing(null);
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            Guardar datos
          </PrimaryButton>
        }
      >
        <div className="grid gap-3">
          <Field label="Código">
            <TextInput value={code} onChange={(e) => setCode(e.target.value)} />
          </Field>
          <Field label="Elaboración">
            <TextInput
              type="date"
              value={made}
              onChange={(e) => setMade(e.target.value)}
            />
          </Field>
          <Field label="Vencimiento">
            <TextInput
              type="date"
              value={expiry}
              onChange={(e) => setExpiry(e.target.value)}
            />
          </Field>
          <Field label="Costo por unidad de venta">
            <NumberInput
              min={0}
              value={cost}
              onChange={(e) => setCost(e.target.value)}
            />
          </Field>
          <Field label="Motivo de la actualización" required>
            <TextInput
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Indica por qué estás modificando este lote"
            />
          </Field>
          <p className="text-xs">
            No modifica los costos de ventas que ya fueron registradas.
          </p>
          {error && <p role="alert">{error}</p>}
        </div>
      </Modal>
    </div>
  );
}
