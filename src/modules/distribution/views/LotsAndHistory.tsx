import { useState } from "react";
import { AlertTriangle, ChevronRight, Printer } from "lucide-react";
import { Field, TextInput, NumberInput } from "../../../components/ui/Form";
import { Modal } from "../../../components/ui/Modal";
import { PrimaryButton, SectionCard, formatQty } from "./shared";
import { submitOperation } from "../data/operationQueue";
import { newOperationId } from "../data/distributionRepository";
import { toDayKey } from "../domain/engine";
import { exportTodayIntakesPdf } from "../data/reportExports";
import { getTodayStockIntakes } from "../domain/todayIntakes";
import type { DistributionViewProps } from "./DistributionApp";
import type { DistLot } from "../types";
import { visiblePersonName } from "./displayText";

const MOVEMENT_LABELS: Record<string, string> = {
  intake: "Ingreso de stock",
  transfer: "Transferencia entre almacenes",
  dispatch: "Despacho a ruta",
  dispatch_addition: "Aumento de despacho",
  dispatch_correction: "Corrección de despacho",
  sale: "Venta",
  return: "Retorno",
  adjustment: "Baja o ajuste",
  shortage: "Faltante",
  overage: "Sobrante",
  exchange: "Cambio de producto",
  customer_return: "Devolución de cliente",
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
  const [search, setSearch] = useState(""),
    [month, setMonth] = useState(toDayKey().slice(0, 7));
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
          <Field label="Motivo de la corrección">
            <TextInput
              value={reason}
              onChange={(e) => setReason(e.target.value)}
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
