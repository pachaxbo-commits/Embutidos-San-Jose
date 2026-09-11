import { useState } from "react";
import { Field, TextInput, NumberInput } from "../../../components/ui/Form";
import { Modal } from "../../../components/ui/Modal";
import { PrimaryButton, SectionCard, formatQty } from "./shared";
import { submitOperation } from "../data/operationQueue";
import { newOperationId } from "../data/distributionRepository";
import { toDayKey } from "../domain/engine";
import type { DistributionViewProps } from "./DistributionApp";
import type { DistLot } from "../types";
import { visiblePersonName } from "./displayText";

const MOVEMENT_LABELS: Record<string, string> = {
  intake: "Ingreso de stock",
  transfer: "Transferencia entre almacenes",
  dispatch: "Despacho a ruta",
  dispatch_addition: "Aumento de despacho",
  sale: "Venta",
  return: "Retorno",
  adjustment: "Baja o ajuste",
  shortage: "Faltante",
  overage: "Sobrante",
  exchange: "Cambio de producto",
  customer_return: "Devolución de cliente",
};
export function StockAlerts({ data }: Pick<DistributionViewProps, "data">) {
  const today = toDayKey();
  const limit = new Date();
  const alertDays = data.supportSettings.expiryAlertDays;
  limit.setDate(limit.getDate() + alertDays);
  const last = toDayKey(limit);
  const lots = data.lots.filter(
    (l) =>
      l.expiresOn &&
      l.expiresOn <= last &&
      Object.values(l.quantities).some((q) => q > 0),
  );
  const low = data.balances.filter(
    (b) =>
      b.locationKind === "central" &&
      (b.availableQuantity ?? b.quantity) <=
        (data.products.find((p) => p.id === b.productId)?.minimumStock || 0),
  );
  const emptyProducts = data.products.filter(p => p.active && (p.minimumStock || 0) > 0 && !data.balances.some(b => b.productId === p.id && b.locationKind === 'central'))
  if (!lots.length && !low.length && !emptyProducts.length) return null;
  return (
    <SectionCard title="Avisos de inventario">
      <div className="grid gap-2 text-xs">
        {lots.map((l) => (
          <p
            key={l.id}
            className={
              l.expiresOn < today ? "font-bold text-rose-700" : "text-amber-800"
            }
          >
            {l.expiresOn < today ? "VENCIDO" : `Vence en los próximos ${alertDays} días`}:{" "}
            {l.productName} · lote {l.lotCode} · {l.expiresOn} ·{" "}
            {formatQty(
              Object.values(l.quantities).reduce((a, b) => a + b, 0),
              l.unitType,
            )}
          </p>
        ))}
        {emptyProducts.map(p => <p key={p.id} className="text-rose-700">Stock mínimo: {p.name} · sin existencias registradas · mínimo {formatQty(p.minimumStock || 0,p.unitType)}</p>)}
        {low.map((b) => (
          <p key={b.id} className="text-rose-700">
            Stock mínimo: {b.productName} ·{" "}
            {b.warehouseId === "central" || !b.warehouseId
              ? "Central"
              : data.warehouses.find((w) => w.id === b.warehouseId)?.name}{" "}
            · disponibles{" "}
            {formatQty(b.availableQuantity ?? b.quantity, b.unitType)}
          </p>
        ))}
      </div>
    </SectionCard>
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
