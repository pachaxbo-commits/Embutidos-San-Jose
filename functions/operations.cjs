const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const { createHash } = require('node:crypto');
const expensePresetRegistry = require("./expense-presets.json");
const origins = require('./origin-traceability.cjs');
const { activeQualityAuthorization, verifyProcessingEvidence, verifyProcessingEvidenceObject, isProcessingRepackEmulator } = require('./processing-security.cjs');
const expenseCategoryDefaults = expensePresetRegistry.defaults;
const retiredIndirectCommercializationCategoryIds = new Set(["indirect-7", "indirect-8", "indirect-9"]);
const expenseBuiltinGroups = {
  administration: { name: "Gastos de administración", economicType: "operating_expense" },
  indirect: { name: "Gastos indirectos", economicType: "operating_expense" },
  commercialization: { name: "Gastos de comercialización", economicType: "operating_expense" },
  equipment: { name: "Gastos de equipamiento", economicType: "operating_expense" },
  other: { name: "Otros egresos operativos", economicType: "operating_expense" },
  production_additional: { name: "Gasto de producción adicional", economicType: "operating_expense" },
  production_input: { name: "Compras para producción", economicType: "production_input" },
};

async function readExpenseGroupConfig(o, id) {
  const builtin = expenseBuiltinGroups[id];
  const saved = await o.read("distExpenseGroups", safeId(id));
  if (!builtin) return saved;
  if (!saved) return { ...builtin, id };
  check(saved.economicType === builtin.economicType, "La clasificación económica de un grupo inicial no se puede cambiar.");
  return { ...builtin, ...saved, id, economicType: builtin.economicType };
}
const round = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const roundAt = (n, precision = 2) => Math.round((Number(n) + Number.EPSILON) * (10 ** precision)) / (10 ** precision);
const isSettledCashMovement = (row) => row?.pendingConfirmation !== true && row?.cashRefundStatus !== "pending";
async function voidedSaleReceiptAmounts(o, sale) {
  if (!sale?.voidedAt || !sale?.derivedVoid) return { cash: 0, qr: 0 };
  let snapshot = sale.derivedVoid.cashReceiptSnapshot;
  if (!snapshot) {
    const correctionId = sale.derivedVoid.correctionId;
    check(typeof correctionId === 'string' && correctionId.length > 0,
      `Conciliacion pendiente: falta evidencia verificable del cobro original de la venta ${sale.id}.`);
    const correction = await o.read('distSaleCorrections', correctionId);
    check(correction?.saleId === sale.id && correction.original,
      `Conciliacion pendiente: falta evidencia verificable del cobro original de la venta ${sale.id}.`);
    snapshot = correction.original;
  }
  const cash = snapshot.cashAmount, qr = snapshot.qrAmount, credit = snapshot.creditAmount;
  const validTotal = snapshot.total === undefined || (typeof snapshot.total === 'number' && Number.isFinite(snapshot.total) && snapshot.total >= 0
    && (credit === undefined || (typeof credit === 'number' && Number.isFinite(credit) && credit >= 0))
    && Math.abs(round(cash + qr + (typeof credit === 'number' ? credit : 0)) - round(snapshot.total)) <= 0.01);
  check(typeof cash === 'number' && Number.isFinite(cash) && cash >= 0
    && typeof qr === 'number' && Number.isFinite(qr) && qr >= 0 && validTotal,
    `La venta anulada ${sale.id} no conserva el desglose verificable de su cobro original; requiere conciliacion antes del cierre.`);
  return { cash: round(cash), qr: round(qr) };
}
function settledClaimCash(claims) {
  return round(claims.filter(isSettledCashMovement).reduce((sum, row) => sum + (Number(row.cashIn) || 0) - (Number(row.cashOut) || 0), 0));
}
function settledClaimQr(claims) {
  return round(claims.filter(isSettledCashMovement).reduce((sum, row) => sum + (Number(row.qrIn) || 0) - (Number(row.qrOut) || 0), 0));
}
const quantityPrecision = (product) => product?.unitType === "kg" ? 3 : 2;
const canonicalJson = value => JSON.stringify(value, (_key, item) => {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return item;
  return Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]]));
});
const sha256 = value => createHash('sha256').update(canonicalJson(value)).digest('hex');
const processingDerivedSalesEmulatorOnly = () => process.env.SANJOSE_DERIVED_SALES_EMULATOR_TEST === 'true' && process.env.FUNCTIONS_EMULATOR === 'true' && /^(localhost|127\.0\.0\.1):\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST || '');
const processingRepackEmulatorOnly = () => process.env.SANJOSE_PROCESSING_REPACK_EMULATOR_TEST === 'true' && isProcessingRepackEmulator();
const processingRepackAvailable = () => processingRepackEmulatorOnly()
  || process.env.SANJOSE_PROCESSING_REPACK_ENABLED === 'true' && Boolean(process.env.SANJOSE_PROCESSING_EVIDENCE_BUCKET);
const integerShare = (total, offset, quantity, whole) => {
  if (total === null || total === undefined) return null;
  check(Number.isSafeInteger(total) && total >= 0 && Number.isSafeInteger(offset) && Number.isSafeInteger(quantity) && Number.isSafeInteger(whole) && whole > 0 && offset >= 0 && quantity >= 0 && offset + quantity <= whole, 'Asignación entera de peso o costo inválida.');
  return Number((BigInt(total) * BigInt(offset + quantity) / BigInt(whole)) - (BigInt(total) * BigInt(offset) / BigInt(whole)));
};
function kgToGrams(value, label = 'El peso') {
  const text = typeof value === 'number' ? String(value) : String(value ?? '');
  check(/^\d+(?:\.\d{1,3})?$/.test(text), `${label} debe expresarse en kg con hasta tres decimales.`);
  const [whole, fraction = ''] = text.split('.');
  const grams = BigInt(whole) * 1000n + BigInt((fraction + '000').slice(0, 3));
  check(grams > 0n && grams <= BigInt(Number.MAX_SAFE_INTEGER), `${label} excede el rango seguro.`);
  return Number(grams);
}
function allocateCentsByWeight(totalCents, weightsG) {
  check(Number.isSafeInteger(totalCents) && totalCents >= 0, 'El costo total en centavos no es válido.');
  const totalWeight = weightsG.reduce((sum, weight) => sum + weight, 0);
  check(Number.isSafeInteger(totalWeight) && totalWeight > 0 && weightsG.every(w => Number.isSafeInteger(w) && w >= 0), 'Los pesos para asignar costo no son válidos.');
  const total = BigInt(totalCents), denominator = BigInt(totalWeight);
  const cents = weightsG.map(weight => Number(total * BigInt(weight) / denominator));
  let remainder = totalCents - cents.reduce((sum, amount) => sum + amount, 0);
  for (let index = 0; remainder > 0; index = (index + 1) % cents.length) {
    if (weightsG[index] > 0) { cents[index]++; remainder--; }
  }
  return cents;
}
function allocateWeightMatrix(rowWeightsG, columnWeightsG) {
  check(rowWeightsG.every(Number.isSafeInteger) && columnWeightsG.every(Number.isSafeInteger), 'Las asignaciones por lote requieren gramos enteros.');
  check(rowWeightsG.reduce((sum, value) => sum + value, 0) === columnWeightsG.reduce((sum, value) => sum + value, 0), 'Las asignaciones por lote no conservan los gramos.');
  const remainingColumns = [...columnWeightsG];
  const matrix = rowWeightsG.map(() => columnWeightsG.map(() => 0));
  for (let rowIndex = 0; rowIndex < rowWeightsG.length; rowIndex++) {
    const rowWeight = rowWeightsG[rowIndex];
    const remainingTotal = remainingColumns.reduce((sum, value) => sum + value, 0);
    if (rowIndex === rowWeightsG.length - 1) {
      matrix[rowIndex] = [...remainingColumns];
    } else {
      const row = remainingColumns.map(column => remainingTotal > 0 ? Number(BigInt(rowWeight) * BigInt(column) / BigInt(remainingTotal)) : 0);
      let remainder = rowWeight - row.reduce((sum, value) => sum + value, 0);
      for (let columnIndex = 0; remainder > 0; columnIndex = (columnIndex + 1) % row.length) {
        if (row[columnIndex] < remainingColumns[columnIndex]) { row[columnIndex]++; remainder--; }
      }
      matrix[rowIndex] = row;
    }
    for (let columnIndex = 0; columnIndex < remainingColumns.length; columnIndex++) {
      remainingColumns[columnIndex] -= matrix[rowIndex][columnIndex];
      check(remainingColumns[columnIndex] >= 0, 'Una asignación contable superó los gramos del destino.');
    }
  }
  check(remainingColumns.every(value => value === 0), 'Las asignaciones contables no cubren los gramos de cada destino.');
  return matrix;
}
// Alias financiero de Administración. No incluye Impulsación ni rutas operativas.
const isAdministrationRouteId = (routeId) => routeId === "admin" || routeId === "administracion";
const isSaleForDispatch = (sale, routeId) =>
  (!sale.routeId || sale.routeId === routeId) && sale.sourceLocation !== "centralWarehouse";
const dispatchMayContainSaleAt = (dispatch, saleAt) => {
  const createdAt = Date.parse(dispatch.createdAt || "");
  if (Array.isArray(dispatch.operationalIntervals) && dispatch.operationalIntervals.length) {
    return dispatch.operationalIntervals.some((interval) => {
      const openedAt = Date.parse(interval.openedAt || "");
      const closedAt = Date.parse(interval.closedAt || "");
      return Number.isFinite(openedAt) && openedAt <= saleAt && (!interval.closedAt || !Number.isFinite(closedAt) || saleAt <= closedAt);
    }) || (dispatch.status === "open" && Number.isFinite(createdAt) && saleAt >= createdAt
      && saleAt >= Date.parse(dispatch.operationalIntervals.at(-1)?.openedAt || dispatch.createdAt));
  }
  const history = dispatch.reopenHistory || [];
  if (history.length) {
    if (!Number.isFinite(createdAt)) return true;
    const firstClose = Date.parse(history[0].previousClosedAt || "");
    if (!Number.isFinite(firstClose)) return saleAt >= createdAt;
    if (saleAt >= createdAt && saleAt <= firstClose) return true;
    for (let index = 0; index < history.length; index++) {
      const openedAt = Date.parse(history[index].reopenedAt || "");
      const nextClose = history[index + 1]?.previousClosedAt;
      const closedAt = nextClose ? Date.parse(nextClose) : dispatch.status === "closed" ? Date.parse(dispatch.closedAt || "") : Number.POSITIVE_INFINITY;
      if (Number.isFinite(openedAt) && openedAt <= saleAt && (!Number.isFinite(closedAt) || saleAt <= closedAt)) return true;
    }
    return false;
  }
  if (!Number.isFinite(createdAt)) return true;
  if (saleAt < createdAt) return false;
  if (dispatch.status === "open") return true;
  if (!dispatch.closedAt) return true;
  const closedAt = Date.parse(dispatch.closedAt);
  return !Number.isFinite(closedAt) || saleAt <= closedAt;
};
class BusinessError extends Error {}
const check = (condition, message) => {
  if (!condition) throw new BusinessError(message);
};
const dayKey = (date = new Date()) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/La_Paz",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
const safeId = (value) => {
  check(
    typeof value === "string" &&
      value.length > 0 &&
      value.length < 180 &&
      !value.includes("/"),
    "Identificador inválido.",
  );
  return value;
};
const validDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value+'T00:00:00Z')) && new Date(value+'T00:00:00Z').toISOString().slice(0,10) === value;
const location = (kind, id) =>
  kind === "route"
    ? `route__${safeId(id)}`
    : id && id !== "central"
      ? `warehouse__${safeId(id)}`
      : "central";
const balanceId = (loc, pid) => `${loc}__${pid}`;
class Operation {
  constructor(tx, root, command, member, id) {
    this.tx = tx;
    this.root = root;
    this.command = command;
    this.member = member;
    this.id = id;
    this.actor = command.createdBy;
    this.now = new Date().toISOString();
    this.today = dayKey();
    this.cache = new Map();
    this.writes = new Map();
    this.stock = new Map();
    this.stockSnapshots = new Map();
    this.reservationRows = new Map();
    this.reservationProductRows = new Map();
    this.sequence = 0;
  }
  ref(col, id) {
    return this.root.collection(col).doc(safeId(id));
  }
  async read(col, id) {
    const key = `${col}/${id}`;
    if (this.writes.has(key)) return this.writes.get(key).data;
    if (!this.cache.has(key)) {
      const snap = await this.tx.get(this.ref(col, id));
      this.cache.set(key, snap.exists ? { ...snap.data(), id: snap.id } : null);
    }
    return this.cache.get(key);
  }
  async query(col, field, value) {
    const snap = await this.tx.get(
      this.root.collection(col).where(field, "==", value),
    );
    return snap.docs.map((d) => ({ ...d.data(), id: d.id }));
  }
  async all(col) {
    const snap = await this.tx.get(this.root.collection(col));
    return snap.docs.map((d) => ({ ...d.data(), id: d.id }));
  }
  put(col, id, value) {
    const key = `${col}/${id}`;
    const data = JSON.parse(JSON.stringify(value));
    this.writes.set(key, {
      ref: this.ref(col, id),
      data,
    });
    this.cache.set(key, data);
    if (col === 'distStockReservations') {
      for (const [lotId, rows] of this.reservationRows.entries()) {
        const index = rows.findIndex(row => row.id === id);
        if (index >= 0) rows.splice(index, 1);
        if (data.lotId === lotId) rows.push(data);
      }
      for (const [productId, rows] of this.reservationProductRows.entries()) {
        const index = rows.findIndex(row => row.id === id);
        if (index >= 0) rows.splice(index, 1);
        if (data.productId === productId) rows.push(data);
      }
    }
  }
  remove(col, id) {
    this.writes.set(`${col}/${id}`, { ref: this.ref(col, id), delete: true });
  }
  base() {
    return {
      restaurantId: "sanjose",
      branchId: "main",
      createdAt: this.now,
      createdBy: this.actor,
      dayKey: this.today,
      schemaVersion: 2,
    };
  }
  admin() {
    check(
      this.member.role === "admin",
      "Solo Administración puede realizar esta operación.",
    );
  }
  responsibleName() {
    return this.member.role === "warehouse" && this.command.payload?.warehouseResponsibleName?.trim()
      ? this.command.payload.warehouseResponsibleName.trim()
      : this.member.displayName || this.actor;
  }
  owns(loc) {
    check(
      this.member.role === "admin" ||
        (this.member.role === "warehouse" &&
          loc === location("warehouse", this.member.warehouseId || "central")),
      "No tienes permiso para operar ese almacén.",
    );
  }
  async product(id) {
    const p = await this.read("distProducts", id);
    check(p && p.active !== false, "El producto no está activo.");
    return p;
  }
  amount(q, p, negative = false, precision = 2) {
    check(
      Number.isFinite(q) && (negative ? q !== 0 : q > 0),
      "Cantidad inválida.",
    );
    check(
      p.unitType === "kg" || Number.isInteger(q),
      "Paquetes y unidades requieren cantidades enteras.",
    );
    return roundAt(q, precision);
  }
  async loadStock(pid, loc) {
    const p = await this.read("distProducts", pid);
    check(p, "Producto inexistente.");
    if (!this.stock.has(pid)) {
      const lots = await this.query("distLots", "productId", pid);
      this.stock.set(pid, { p, lots, balances: new Map() });
      this.stockSnapshots.set(`lots:${pid}`, new Map(lots.map(l => [l.id, JSON.stringify(l)])));
    }
    const entry = this.stock.get(pid);
    if (!entry.balances.has(loc)) {
      const bal = await this.read("distBalances", balanceId(loc, pid));
      entry.balances.set(
        loc,
        bal
          ? { ...bal }
          : {
              id: balanceId(loc, pid),
              restaurantId: "sanjose",
              locationKind: loc.startsWith("route__") ? "route" : "central",
              ...(loc.startsWith("route__")
                ? { routeId: loc.slice(7) }
                : {
                    warehouseId: loc.startsWith("warehouse__")
                      ? loc.slice(11)
                      : "central",
                  }),
              productId: pid,
              productName: p.name,
              unitType: p.unitType,
              quantity: 0,
            },
      );
      const balanceSnapshots = this.stockSnapshots.get(`balances:${pid}`) || new Map();
      balanceSnapshots.set(loc, JSON.stringify(entry.balances.get(loc)));
      this.stockSnapshots.set(`balances:${pid}`, balanceSnapshots);
      const precision = quantityPrecision(p);
      const tracked = roundAt(
        entry.lots.reduce((n, l) => n + (l.quantities?.[loc] || 0), 0),
        precision,
      );
      const legacy = roundAt((bal?.quantity || 0) - tracked, precision);
      check(
        legacy >= -(0.5 / (10 ** precision)),
        "Los lotes no coinciden con el stock. Administración debe revisar el inventario.",
      );
      if (legacy > 0) {
        const id = `legacy_${balanceId(loc, pid)}`;
        check(
          !entry.lots.some((l) => l.id === id),
          "El stock anterior necesita conciliación antes de continuar.",
        );
        entry.lots.push({
          id,
          restaurantId: "sanjose",
          productId: pid,
          productName: p.name,
          unitType: p.unitType,
          lotCode: "ANTERIOR SIN FECHAS",
          manufacturedOn: "",
          expiresOn: "",
          productionCost: p.productionCost ?? null,
          legacy: true,
          quantities: { [loc]: legacy },
          createdAt: this.now,
          createdBy: this.actor,
        });
        this.stockSnapshots.get(`lots:${pid}`).set(id, null);
      }
    }
    return entry;
  }
  move(entry, loc, delta, precision) {
    const b = entry.balances.get(loc);
    b.quantity = roundAt(b.quantity + delta, precision ?? quantityPrecision(entry.p));
    check(b.quantity >= 0, "Stock insuficiente.");
    b.updatedAt = this.now;
  }
  processingLocationTotals(lot, loc) {
    const segments = lot.processingByLocation?.[loc]?.segments;
    check(Array.isArray(segments), `El lote derivado ${lot.lotCode || lot.id} no tiene asignación trazable para ${loc}.`);
    return segments.reduce((total, segment) => ({
      quantity: total.quantity + Number(segment.remainingQuantity || 0),
      weightG: total.weightG + Number(segment.remainingWeightG || 0),
      costCents: total.costCents === null || segment.remainingCostCents === null ? null : total.costCents + Number(segment.remainingCostCents || 0),
    }), { quantity: 0, weightG: 0, costCents: 0 });
  }
  assertProcessingLocation(lot, loc) {
    const totals = this.processingLocationTotals(lot, loc);
    check(Number.isSafeInteger(totals.quantity) && totals.quantity === Number(lot.quantities?.[loc] || 0), `Los paquetes del lote derivado ${lot.lotCode || lot.id} no concilian con ${loc}.`);
    check(Number.isSafeInteger(totals.weightG) && totals.weightG >= 0, 'Los gramos restantes del lote derivado no son válidos.');
    check(new Set(lot.processingByLocation?.[loc]?.segments.map(segment => segment.segmentId)).size === lot.processingByLocation[loc].segments.length, 'El lote derivado contiene segmentos duplicados en una ubicación.');
    const all = Object.entries(lot.processingByLocation || {}).reduce((total, [locationId, value]) => {
      const rows = Array.isArray(value?.segments) ? value.segments : [];
      return rows.reduce((sum, segment) => ({ quantity: sum.quantity + Number(segment.remainingQuantity || 0), weightG: sum.weightG + Number(segment.remainingWeightG || 0), costCents: sum.costCents === null || segment.remainingCostCents === null ? null : sum.costCents + Number(segment.remainingCostCents || 0) }), total);
    }, { quantity: 0, weightG: 0, costCents: 0 });
    const lotQuantity = Object.values(lot.quantities || {}).reduce((sum, value) => sum + Number(value || 0), 0);
    check(Number.isSafeInteger(all.quantity) && all.quantity === lotQuantity, 'La cantidad de paquetes por ubicación no concilia con el lote derivado.');
    check(Number.isSafeInteger(all.weightG) && all.weightG === Number(lot.processingPhysicalWeightGRemaining), 'La asignación por ubicación no concilia con el peso físico restante del lote derivado.');
    check(all.costCents === (lot.processingCostCentsRemaining ?? null), 'La asignación por ubicación no concilia con el costo restante del lote derivado.');
    return totals;
  }
  processingMovementAllowed(lot, loc, options) {
    if (!lot.processingCommercialBlocked) return true;
    // The option identifies the logistics action; only the trusted Emulator
    // switch authorizes moving protected derived stock out of its location.
    const authorizedMovement = (options.processingDispatch === true || options.processingTransfer === true || options.processingSale === true) && processingDerivedSalesEmulatorOnly()
      || options.processingReturn === true && loc.startsWith('route__')
      || options.processingRepack === true && processingRepackAvailable();
    if (!authorizedMovement || lot.processingDestinationKind !== 'finished') return false;
    if (origins.pending(lot, loc) > 0 || !lot.processingSourceAllocationBasis) return false;
    const unavailable = lot.processingUnavailable?.[loc] || {};
    if (Number(unavailable.courtesy || 0) + Number(unavailable.reviewHold || 0) > 0 || options.processingRepack !== true && Number(unavailable.repackPending || 0) > 0) return false;
    this.assertProcessingLocation(lot, loc);
    return true;
  }
  takeProcessingAllocation(lot, loc, quantity, allocationOperationId) {
    const totals = this.assertProcessingLocation(lot, loc);
    check(Number.isSafeInteger(quantity) && quantity > 0 && quantity <= totals.quantity, 'La cantidad comercial del lote derivado no está disponible.');
    const segments = lot.processingByLocation[loc].segments;
    let remaining = quantity;
    const allocations = [];
    for (const segment of segments) {
      if (!remaining) break;
      const available = Number(segment.remainingQuantity || 0);
      if (available <= 0) continue;
      const count = Math.min(remaining, available);
      const weightG = integerShare(segment.remainingWeightG, 0, count, available);
      const costCents = integerShare(segment.remainingCostCents, 0, count, available);
      const processingAllocation = {
        segmentId: segment.segmentId,
        batchId: segment.batchId,
        destinationId: segment.destinationId,
        sourceMovementId: segment.sourceMovementId,
        quantity: count,
        physicalWeightG: weightG,
        costCents,
        weightBasis: segment.weightBasis,
        allocationMethod: 'documented_average',
        physicalOriginConfirmed: false,
        sourceLocation: loc,
        allocationOperationId,
      };
      allocations.push(processingAllocation);
      segment.remainingQuantity -= count;
      segment.remainingWeightG -= weightG;
      if (segment.remainingCostCents !== null) segment.remainingCostCents -= costCents;
      remaining -= count;
    }
    check(remaining === 0, 'La asignación comercial del lote derivado quedó incompleta.');
    lot.processingByLocation[loc].segments = segments.filter(segment => segment.remainingQuantity > 0);
    lot.processingPhysicalWeightGRemaining -= allocations.reduce((sum, item) => sum + item.physicalWeightG, 0);
    if (lot.processingCostCentsRemaining !== null) lot.processingCostCentsRemaining -= allocations.reduce((sum, item) => sum + item.costCents, 0);
    const physicalWeightG = allocations.reduce((sum, item) => sum + item.physicalWeightG, 0);
    const costCents = allocations.some(item => item.costCents === null) ? null : allocations.reduce((sum, item) => sum + item.costCents, 0);
    check(Number.isSafeInteger(physicalWeightG) && physicalWeightG >= 0 && (costCents === null || Number.isSafeInteger(costCents) && costCents >= 0), 'El movimiento del lote derivado produjo una asignación de peso o costo inválida.');
    return allocations;
  }
  restoreProcessingAllocation(lot, loc, allocation) {
    const part = allocation.processingAllocation;
    if (!part) return;
    check(lot.processingCommercialBlocked && lot.processingDestinationKind === 'finished', 'No se puede restituir asignación de un destino de elaboración protegido.');
    check(Number.isSafeInteger(part.quantity) && part.quantity > 0 && Number.isSafeInteger(part.physicalWeightG) && part.physicalWeightG >= 0 && (part.costCents === null || Number.isSafeInteger(part.costCents) && part.costCents >= 0) && part.segmentId && part.batchId === lot.processingBatchId, 'La asignación restituida del lote derivado no es válida.');
    lot.processingByLocation ||= {};
    const bucket = lot.processingByLocation[loc] || (lot.processingByLocation[loc] = { segments: [] });
    const current = bucket.segments.find(segment => segment.segmentId === part.segmentId);
    if (current) {
      check(current.batchId === part.batchId && current.weightBasis === part.weightBasis && (current.remainingCostCents === null) === (part.costCents === null), 'La referencia de la asignación no coincide con el segmento existente.');
      current.remainingQuantity += part.quantity;
      current.remainingWeightG += part.physicalWeightG;
      if (current.remainingCostCents !== null) current.remainingCostCents += part.costCents;
    } else bucket.segments.push({ segmentId: part.segmentId, batchId: part.batchId, destinationId: part.destinationId, sourceMovementId: part.sourceMovementId, weightBasis: part.weightBasis, remainingQuantity: part.quantity, remainingWeightG: part.physicalWeightG, remainingCostCents: part.costCents });
    lot.processingPhysicalWeightGRemaining += part.physicalWeightG;
    if (lot.processingCostCentsRemaining !== null) lot.processingCostCentsRemaining += part.costCents;
    this.assertProcessingLocation(lot, loc);
  }
  removeProcessingAllocation(lot, loc, allocation) {
    const part = allocation.processingAllocation;
    if (!part) return;
    const totals = this.processingLocationTotals(lot, loc);
    check(Number.isSafeInteger(part.quantity) && part.quantity > 0 && totals.quantity === Number(lot.quantities?.[loc] || 0) + part.quantity, 'La corrección intenta recuperar más paquetes derivados de los que quedan en la ubicación.');
    const segments = lot.processingByLocation[loc].segments;
    const segment = segments.find(item => item.segmentId === part.segmentId);
    check(segment && segment.remainingQuantity >= part.quantity && segment.remainingWeightG >= part.physicalWeightG && (segment.remainingCostCents === null ? part.costCents === null : part.costCents !== null && segment.remainingCostCents >= part.costCents), 'La asignación original del lote derivado ya no está completa en la ruta; no se puede corregir el despacho.');
    segment.remainingQuantity -= part.quantity;
    segment.remainingWeightG -= part.physicalWeightG;
    if (segment.remainingCostCents !== null) segment.remainingCostCents -= part.costCents;
    lot.processingByLocation[loc].segments = segments.filter(item => item.remainingQuantity > 0);
    lot.processingPhysicalWeightGRemaining -= part.physicalWeightG;
    if (lot.processingCostCentsRemaining !== null) lot.processingCostCentsRemaining -= part.costCents;
    this.assertProcessingLocation(lot, loc);
  }
  async take(pid, loc, quantity, { allowExpired = false, allowPendingOrigin = loc.startsWith('route__'), lotId, allocationsRequested, precision: requestedPrecision, processingCourtesyReservation, processingPhysicalWeightG, processingCostCents, processingDispatch = false, processingTransfer = false, processingReturn = false, processingSale = false, processingRepack = false } = {}) {
    const e = await this.loadStock(pid, loc);
    const precision = requestedPrecision ?? quantityPrecision(e.p);
    const amountPrecision = requestedPrecision ?? quantityPrecision(e.p);
    quantity = this.amount(quantity, e.p, false, amountPrecision);
    const reservationRows = await this.processingReservationsForProduct(pid);
    for (const lot of e.lots.filter(l => !lotId || l.id === lotId)) this.assertReservationAggregate(lot, loc, reservationRows.filter(row => row.lotId === lot.id));
    const unavailable = lot => {
      const held = lot.processingUnavailable?.[loc] || {};
      return roundAt((Number(held.courtesy) || 0) + (Number(held.repackPending) || 0) + (Number(held.reviewHold) || 0), precision);
    };
    const usable = lot => roundAt((lot.quantities?.[loc] || 0) - unavailable(lot) - (allowPendingOrigin ? 0 : origins.pending(lot, loc)), precision);
    const processingCourtesyAllowed = lot => {
      if (!lot.processingCommercialBlocked) return true;
      const proof = processingCourtesyReservation;
      const courtesyAllowed = Boolean(proof && proof.purpose === 'courtesy' && proof.location === loc && proof.lotId === lot.id && proof.batchId && proof.batchId === lot.processingBatchId && lot.processingDestinationKind === 'courtesy');
      return courtesyAllowed || this.processingMovementAllowed(lot, loc, { processingDispatch, processingTransfer, processingReturn, processingSale, processingRepack });
    };
    if (Array.isArray(allocationsRequested)) {
      check(allocationsRequested.length > 0, "Distribuye la cantidad entre uno o más lotes.");
      const seen = new Set();
      const requested = allocationsRequested.map((part) => {
        check(part?.lotId && !seen.has(part.lotId), "No repitas el mismo lote en un producto.");
        seen.add(part.lotId);
        const requestedQuantity = this.amount(part.quantity, e.p, false, amountPrecision);
        check(requestedQuantity > 0, "La cantidad asignada a cada lote debe ser mayor a cero.");
        const lot = e.lots.find((row) => row.id === part.lotId);
        check(lot && lot.productId === pid, "El lote no pertenece al producto seleccionado.");
        check(processingCourtesyAllowed(lot), 'El lote derivado de elaboración sigue bloqueado para venta o despacho hasta integrar el seguimiento físico y de costo.');
        check(allowExpired || (!lot.quarantined && (!lot.expiresOn || lot.expiresOn >= this.today)), "El lote está vencido o en cuarentena.");
        check(usable(lot) >= requestedQuantity, `El lote ${lot.lotCode || lot.id} no tiene cantidad libre suficiente; revisa reservas, cuarentena y origen pendiente.`);
        return { lot, quantity: requestedQuantity };
      });
      check(Math.abs(roundAt(requested.reduce((sum, part) => sum + part.quantity, 0), precision) - quantity) < 1 / (10 ** precision), "La distribución por lotes debe coincidir con la cantidad total.");
      const allocations = requested.flatMap(({ lot, quantity: requestedQuantity }) => {
        if (lot.processingCommercialBlocked && !processingCourtesyReservation) {
          const processingAllocations = this.takeProcessingAllocation(lot, loc, requestedQuantity, this.id);
          const parts = origins.take(lot, loc, requestedQuantity, allowPendingOrigin);
          check(parts.length === 1 && !parts[0].originReferences, 'El despacho del lote derivado requiere asignación de origen completa.');
          let offset = 0;
          return processingAllocations.map(processingAllocation => {
            const allocation = origins.slice(parts[0], offset, processingAllocation.quantity);
            allocation.processingAllocation = processingAllocation;
            offset += processingAllocation.quantity;
            return allocation;
          });
        }
        return origins.take(lot, loc, requestedQuantity, allowPendingOrigin);
      });
      this.move(e, loc, -quantity, precision);
      return allocations;
    }
    const lots = e.lots
      .filter(
        (l) =>
          usable(l) > 0 &&
          (!lotId || l.id === lotId) &&
          processingCourtesyAllowed(l) &&
          (allowExpired ||
            (!l.quarantined && (!l.expiresOn || l.expiresOn >= this.today))),
      )
      .sort(
        (a, b) =>
          (a.expiresOn || "9999").localeCompare(b.expiresOn || "9999") ||
          a.id.localeCompare(b.id),
      );
    const ordinaryAvailable = roundAt(lots.reduce((sum, lot) => sum + usable(lot), 0), precision);
    if (processingSale && ordinaryAvailable < quantity && !processingDerivedSalesEmulatorOnly() && e.lots.some(lot => lot.processingCommercialBlocked && usable(lot) > 0))
      check(false, 'La venta comercial de sachets derivados todavía no está habilitada para usuarios reales; el stock permanece bloqueado hasta completar y auditar todo el ciclo comercial.');
    check(
      roundAt(lots.reduce((s, l) => s + usable(l), 0), precision) >= quantity,
      `Stock disponible insuficiente de ${e.p.name}. Revisa cantidades, vencimientos y reservas por origen pendiente; esas reservas no se pueden vender ni despachar.`,
    );
    let remaining = quantity;
    const allocations = [];
    for (const l of lots) {
      if (remaining <= 0) break;
      const q = roundAt(Math.min(remaining, usable(l)), precision);
      remaining = roundAt(remaining - q, precision);
      if (l.processingCommercialBlocked) {
        if (!processingCourtesyReservation) {
          if (!this.processingMovementAllowed(l, loc, { processingDispatch, processingTransfer, processingReturn, processingSale, processingRepack })) {
            const error = new Error('El lote derivado de elaboración sigue bloqueado para venta, cortesía o movimiento no autorizado.');
            if (processingDispatch || processingTransfer) error.code = 'processing/logistics-not-authorized';
            throw error;
          }
          const processingAllocations = this.takeProcessingAllocation(l, loc, q, this.id);
          const parts = origins.take(l, loc, q, allowPendingOrigin);
          check(parts.length === 1 && !parts[0].originReferences, 'El despacho del lote derivado requiere asignación de origen completa.');
          let offset = 0;
          for (const processingAllocation of processingAllocations) {
            const allocation = origins.slice(parts[0], offset, processingAllocation.quantity);
            allocation.processingAllocation = processingAllocation;
            allocations.push(allocation);
            offset += processingAllocation.quantity;
          }
          continue;
        }
      }
      const parts = origins.take(l, loc, q, allowPendingOrigin);
      if (l.processingCommercialBlocked) {
        check(Number.isSafeInteger(processingPhysicalWeightG) && processingPhysicalWeightG > 0 && processingPhysicalWeightG <= Number(l.processingPhysicalWeightGRemaining), 'El peso físico asignado a la cortesía no concilia con el lote derivado.');
        if (Number.isSafeInteger(l.processingCostCentsRemaining))
          check(Number.isSafeInteger(processingCostCents) && processingCostCents >= 0 && processingCostCents <= l.processingCostCentsRemaining, 'El costo asignado a la cortesía no concilia con el lote derivado.');
        l.processingPhysicalWeightGRemaining -= processingPhysicalWeightG;
        if (Number.isSafeInteger(l.processingCostCentsRemaining)) l.processingCostCentsRemaining -= processingCostCents;
        for (const part of parts) {
          part.physicalWeightG = processingPhysicalWeightG;
          if (Number.isSafeInteger(processingCostCents)) part.processingCostCents = processingCostCents;
        }
      }
      allocations.push(...parts);
    }
    this.move(e, loc, -quantity, precision);
    return allocations;
  }
  async processingReservations(lotId) {
    if (!this.reservationRows.has(lotId)) {
      const rows = await this.query('distStockReservations', 'lotId', lotId);
      for (const [key, write] of this.writes.entries()) {
        if (!key.startsWith('distStockReservations/')) continue;
        const row = write.data;
        if (row.id) {
          const index = rows.findIndex(item => item.id === row.id);
          if (index >= 0) rows.splice(index, 1);
        }
        if (row.lotId === lotId) rows.push(row);
      }
      this.reservationRows.set(lotId, rows);
    }
    return this.reservationRows.get(lotId);
  }
  async processingReservationsForProduct(productId) {
    if (!this.reservationProductRows.has(productId)) {
      const rows = await this.query('distStockReservations', 'productId', productId);
      for (const [key, write] of this.writes.entries()) {
        if (!key.startsWith('distStockReservations/')) continue;
        const row = write.data;
        if (row.id) {
          const index = rows.findIndex(item => item.id === row.id);
          if (index >= 0) rows.splice(index, 1);
        }
        if (row.productId === productId) rows.push(row);
      }
      this.reservationProductRows.set(productId, rows);
    }
    return this.reservationProductRows.get(productId);
  }
  reservationPrecision(lot) { return lot.unitType === 'kg' ? 3 : 0; }
  reservationTotals(rows, loc) {
    const active = rows.filter(r => r.location === loc && ['active','partially_consumed'].includes(r.status));
    return {
      courtesy: active.filter(r => r.purpose === 'courtesy').reduce((n,r) => n + Number(r.remainingQuantity || 0), 0),
      repackPending: active.filter(r => r.purpose === 'repack_pending').reduce((n,r) => n + Number(r.remainingQuantity || 0), 0),
      reviewHold: active.filter(r => r.purpose === 'review_hold').reduce((n,r) => n + Number(r.remainingQuantity || 0), 0),
    };
  }
  assertReservationAggregate(lot, loc, rows) {
    const expected = this.reservationTotals(rows, loc);
    const actual = lot.processingUnavailable?.[loc] || { courtesy: 0, repackPending: 0, reviewHold: 0 };
    const precision = this.reservationPrecision(lot);
    check(['courtesy','repackPending','reviewHold'].every(k => roundAt(Number(actual[k] || 0), precision) === roundAt(expected[k], precision)), `Las reservas del lote ${lot.lotCode || lot.id} no concilian con su agregado. Requiere revisión administrativa.`);
    return expected;
  }
  async assertNoActiveReservation(lot, loc, message) {
    const rows = await this.processingReservations(lot.id);
    this.assertReservationAggregate(lot, loc, rows);
    check(!rows.some(row => row.location === loc && ['active','partially_consumed'].includes(row.status) && Number(row.remainingQuantity) > 0), message);
  }
  async moveStock(pid, from, to, q, options = {}) {
    const e = await this.loadStock(pid, from);
    await this.loadStock(pid, to);
    const precision = quantityPrecision(e.p);
    const parts = await this.take(pid, from, q, options);
    for (const a of parts) {
      const l = e.lots.find((x) => x.id === a.lotId);
      origins.restore(l, to, a);
      this.restoreProcessingAllocation(l, to, a);
    }
    this.move(e, to, q, precision);
    return parts;
  }
  async restore(pid, loc, allocations) {
    const e = await this.loadStock(pid, loc);
    const precision = quantityPrecision(e.p);
    for (const part of allocations || []) {
      const lot = e.lots.find(item => item.id === part.lotId);
      check(lot, "No se encontró el lote original de la venta.");
      origins.restore(lot, loc, part);
      this.restoreProcessingAllocation(lot, loc, part);
      this.move(e, loc, part.quantity, precision);
    }
  }
  async withDocumentedOrigins(sale, previous) {
    const result = structuredClone(previous);
    const applied = new Set(previous.originDocumentationIds || []);
    const notices = await this.query('distLotHistory', 'subjectSaleId', sale.id);
    for (const notice of notices.filter(n => n.action === 'sale_origin_exception')) {
      if (applied.has(notice.id)) continue;
      let remaining = notice.allocation.quantity;
      for (const line of result.lines || []) for (const allocation of line.allocations || []) {
        if (allocation.lotId !== notice.allocation.lotId || remaining <= 0) continue;
        const amount = roundAt(Math.min(remaining, allocation.quantity - origins.refsQuantity(allocation)), 3);
        if (amount > 0) { allocation.originReferences = [...(allocation.originReferences || []), ...origins.slice(notice.allocation, 0, amount).originReferences]; remaining = roundAt(remaining - amount, 3); }
      }
      check(remaining === 0, 'La excepción documental de esta venta requiere revisión administrativa.');
      applied.add(notice.id);
    }
    result.originDocumentationIds = [...applied];
    return result;
  }
  ledger(pid, q, from, to, type, extra = {}, requestedPrecision) {
    const e = this.stock.get(pid);
    const precision = requestedPrecision ?? quantityPrecision(e.p);
    const id = `${this.id}__${this.sequence++}`;
    this.put("distStockMovements", id, {
      id,
      ...this.base(),
      type,
      productId: pid,
      productName: e.p.name,
      unitType: e.p.unitType,
      quantity: roundAt(Math.abs(q), precision),
      fromLocation: from || "",
      toLocation: to || "",
      centralDelta: roundAt(
        (to && !to.startsWith("route__") ? q : 0) -
          (from && !from.startsWith("route__") ? q : 0), precision,
      ),
      routeDelta: roundAt(
        (to?.startsWith("route__") ? q : 0) -
          (from?.startsWith("route__") ? q : 0), precision,
      ),
      routeId: (from?.startsWith("route__")
        ? from
        : to?.startsWith("route__")
          ? to
          : ""
      ).slice(7),
      refId: this.id,
      refType: "operation",
      responsibleName: this.responsibleName(),
      responsibleRole: this.member.role,
      ...extra,
      ...(Array.isArray(extra.allocations) && extra.allocations.some(allocation => allocation.processingAllocation) ? (() => {
        const parts = extra.allocations.filter(allocation => allocation.processingAllocation).map(allocation => ({ ...allocation.processingAllocation, ...(type === 'sale' ? { saleId: this.id, saleMovementId: id } : {}) }));
        const physicalWeightG = parts.reduce((sum, part) => sum + part.physicalWeightG, 0);
        const costCents = parts.some(part => part.costCents === null) ? null : parts.reduce((sum, part) => sum + part.costCents, 0);
        return { processingAllocations: parts, processingBatchIds: [...new Set(parts.map(part => part.batchId))], physicalWeightG, processingCostCents: costCents, ...(extra.costCents === undefined ? { costCents } : {}), processingWeightBasis: [...new Set(parts.map(part => part.weightBasis))], processingAllocationMethod: 'documented_average_not_individual_measurement' };
      })() : {}),
      ...(origins.references(extra.allocations).length ? { originReferences: origins.references(extra.allocations), traceabilityStatus: 'physical_origin_pending', note: `${extra.note || ''} ${origins.note}`.trim() } : {}),
    });
    return id;
  }
  flush() {
    for (const [pid, e] of this.stock.entries()) {
      const lotSnapshots = this.stockSnapshots.get(`lots:${pid}`) || new Map();
      for (const l of e.lots) if (lotSnapshots.get(l.id) !== JSON.stringify(l)) this.put("distLots", l.id, l);
      const balanceSnapshots = this.stockSnapshots.get(`balances:${pid}`) || new Map();
      for (const [loc, b] of e.balances.entries()) if (balanceSnapshots.get(loc) !== JSON.stringify(b)) this.put("distBalances", b.id, b);
    }
    for (const w of this.writes.values()) {
      if (w.delete) this.tx.delete(w.ref);
      else this.tx.set(w.ref, w.data);
    }
  }
}
async function intake(o, p) {
  o.owns("central");
  check(Array.isArray(p.lines) && p.lines.length, "Agrega productos.");
  for (const line of p.lines) {
    const e = await o.loadStock(line.productId, "central");
    const q = o.amount(line.quantity, e.p);
    check(line.lotCode?.trim(), "El lote es obligatorio.");
    check(
      validDate(line.manufacturedOn) &&
        validDate(line.expiresOn),
      "Indica fechas válidas de lote y vencimiento.",
    );
    check(
      line.manufacturedOn <= o.today && line.expiresOn >= line.manufacturedOn,
      "Revisa las fechas del lote.",
    );
    check(
      Number.isFinite(e.p.productionCost) && e.p.productionCost >= 0,
      "Configura el costo de producción antes de ingresar stock.",
    );
    const id = `${o.id}__${o.sequence++}`;
    e.lots.push({
      id,
      restaurantId: "sanjose",
      productId: e.p.id,
      productName: e.p.name,
      unitType: e.p.unitType,
      lotCode: line.lotCode.trim(),
      manufacturedOn: line.manufacturedOn,
      expiresOn: line.expiresOn,
      productionCost: e.p.productionCost,
      quantities: { central: q },
      createdAt: o.now,
      createdBy: o.actor,
    });
    o.move(e, "central", q);
    o.ledger(e.p.id, q, null, "central", "intake", {
      lotId: id,
      lotCode: line.lotCode,
      note: p.note || "",
    });
  }
  return { id: o.id };
}
async function transfer(o, p) {
  const from = location("warehouse", p.from),
    to = location("warehouse", p.to);
  o.owns(from);
  check(from !== to, "Selecciona otro destino.");
  if (p.to !== "central")
    check(
      (await o.read("distWarehouses", p.to))?.active,
      "Almacén destino no disponible.",
    );
  const parts = await o.moveStock(p.line.productId, from, to, p.line.quantity, { processingTransfer: true });
  const e = o.stock.get(p.line.productId);
  o.ledger(p.line.productId, p.line.quantity, from, to, "transfer", {
    allocations: parts,
    note: p.note || "",
  });
  const record = {
    id: o.id,
    ...o.base(),
    fromWarehouseId: p.from,
    toWarehouseId: p.to,
    line: { ...p.line, productName: e.p.name, unitType: e.p.unitType },
    allocations: parts,
    note: p.note || "",
    responsibleName: o.member.displayName || o.actor,
  };
  o.put("distTransfers", o.id, record);
  return record;
}
async function dispatch(o, p, addition = false) {
  const current = addition
    ? await o.read("distDispatches", p.dispatch.id)
    : null;
  check(
    !addition || current?.status === "open",
    "El despacho ya está cerrado.",
  );
  const wh = addition
    ? current.warehouseId || "central"
    : p.warehouseId || "central";
  const from = location("warehouse", wh);
  o.owns(from);
  const routeId = addition ? current.routeId : p.routeId;
  const to = location("route", routeId);
  if (!addition) {
    const seller = await o.read("members", p.distributorUid);
    check(
      seller?.active &&
        seller.role === "distributor" &&
        seller.routeId === routeId,
      "El distribuidor no corresponde a esta ruta.",
    );
    const existing = await o.query("distDispatches", "routeId", routeId);
    check(
      !existing.some((d) => d.status === "open"),
      "Esta ruta ya tiene un despacho abierto.",
    );
  }
  check(Array.isArray(p.lines) && p.lines.length, "Agrega productos.");
  // Compatibilidad temporal: 1.4.5 no envía este campo. La interfaz 1.4.6 lo
  // exige, pero el servidor conserva como responsable al usuario autenticado.
  const warehouseResponsibleName = p.warehouseResponsibleName?.trim() || o.member.displayName || o.actor;
  const linesByProduct = new Map();
  for (const l of p.lines) {
    // Legacy "waste" did not distinguish bag overweight from a physical loss.
    // Reject it before touching stock; ordinary legacy loads remain compatible.
    check(l.waste === undefined || Number(l.waste) === 0,
      "Actualiza la aplicación antes de despachar: la merma dentro de las bolsas debe registrarse como merma adicional enviada. No se guardó el despacho. Para una pérdida real de Almacén usa su confirmación específica.");
    const warehouseLoss = l.warehouseLoss;
    const waste = warehouseLoss ? round(Number(warehouseLoss.quantity)) : 0;
    const wasteReason = String(warehouseLoss?.reason || "").trim();
    if (warehouseLoss) {
      check(warehouseLoss.confirmation === "CONFIRMAR_PERDIDA_REAL" && wasteReason.length >= 3,
        "Confirma explícitamente la pérdida real de Almacén e indica el motivo. La merma enviada dentro de las bolsas no es pérdida.");
      check(Number.isFinite(waste) && waste > 0, "Indica una cantidad válida para la pérdida real de Almacén.");
    }
    // Versiones antiguas envían lotId o líneas repetidas; 1.4.13 envía una
    // línea por producto con allocationsRequested. El documento efectivo se
    // normaliza siempre a una sola línea por producto.
    const options = Array.isArray(l.allocationsRequested)
      ? { allocationsRequested: l.allocationsRequested }
      : l.lotId ? { lotId: l.lotId } : {};
    const product = (await o.loadStock(l.productId, from)).p;
    const hasDispatchMerma = Object.prototype.hasOwnProperty.call(l, "dispatchMerma");
    const physicalQuantity = round(Number(l.quantity));
    const dispatchMerma = hasDispatchMerma ? round(Number(l.dispatchMerma)) : 0;
    const normalQuantity = hasDispatchMerma ? round(Number(l.normalQuantity)) : physicalQuantity;
    if (hasDispatchMerma) {
      check(product.unitType === "kg" || dispatchMerma === 0, "La merma adicional solo aplica a productos por kg.");
      check(Number.isFinite(physicalQuantity) && physicalQuantity > 0 && Number.isFinite(dispatchMerma) && dispatchMerma >= 0 && Number.isFinite(normalQuantity) && normalQuantity >= 0,
        "Revisa la cantidad normal y la merma adicional del despacho.");
      check(round(normalQuantity + dispatchMerma) === physicalQuantity, "El total físico debe ser igual a la cantidad normal más la merma adicional.");
    }
    const allocations = await o.moveStock(l.productId, from, to, physicalQuantity, { ...options, processingDispatch: true });
    const effective = linesByProduct.get(l.productId) || { productId: l.productId, productName: product.name, unitType: product.unitType, quantity: 0, normalQuantity: 0, dispatchMerma: 0, allocations: [], dispatchMermaAllocations: [] };
    effective.quantity = round(effective.quantity + l.quantity);
    effective.normalQuantity = round((effective.normalQuantity || 0) + normalQuantity);
    effective.dispatchMerma = round((effective.dispatchMerma || 0) + dispatchMerma);
    for (const allocation of allocations) {
      if (allocation.processingAllocation) {
        effective.allocations.push({ ...allocation });
        continue;
      }
      const existing = effective.allocations.find((part) => part.lotId === allocation.lotId);
      if (existing) existing.quantity = round(existing.quantity + allocation.quantity);
      else effective.allocations.push({ ...allocation });
    }
    if (dispatchMerma > 0) {
      const [, mermaParts] = splitAllocationsByAmounts(allocations, [normalQuantity, dispatchMerma]);
      for (const allocation of mermaParts) {
        const existing = effective.dispatchMermaAllocations.find((part) => part.lotId === allocation.lotId);
        if (existing) existing.quantity = round(existing.quantity + allocation.quantity);
        else effective.dispatchMermaAllocations.push({ ...allocation });
      }
    }
    if (waste > 0) {
      check(product.unitType === "kg", "La pérdida de despacho solo aplica a productos por kg.");
      const wasteAllocations = await o.take(l.productId, from, waste);
      const wasteCost = wasteAllocations.every((a) => a.productionCost !== null)
        ? round(wasteAllocations.reduce((sum, a) => sum + a.quantity * a.productionCost, 0))
        : null;
      effective.waste = round((effective.waste || 0) + waste);
      effective.wasteCost = wasteCost;
      effective.wasteAllocations = wasteAllocations;
      effective.warehouseLoss = { quantity: waste, reason: wasteReason, confirmation: "CONFIRMAR_PERDIDA_REAL" };
      o.ledger(
        l.productId,
        waste,
        from,
        null,
        "dispatch_waste",
        { refId: current?.id || o.id, dispatchId: current?.id || o.id, allocations: wasteAllocations, lossCost: wasteCost,
          lossClassification: "confirmed_physical_loss", reason: wasteReason, note: "Pérdida física real de Almacén confirmada expresamente al despachar" },
      );
    }
    linesByProduct.set(l.productId, effective);
    o.ledger(
      l.productId,
      l.quantity,
      from,
      to,
      addition ? "dispatch_addition" : "dispatch",
        { refId: current?.id || o.id, allocations, normalQuantity, dispatchMerma, note: hasDispatchMerma ? `Traslado físico a ruta; ${normalQuantity} normal + ${dispatchMerma} merma adicional recuperable.` : "" },
    );
  }
  const lines = [...linesByProduct.values()];
  if (addition) {
    current.additions = [
      ...(current.additions || []),
      {
        id: o.id,
        quantityByProduct: lines,
        createdAt: o.now,
        createdBy: o.actor,
        createdByName: o.member.displayName || o.actor,
        note: p.note || "",
        warehouseResponsibleName,
      },
    ];
    o.put("distDispatches", current.id, current);
    return { id: current.id };
  }
  const d = {
    id: o.id,
    ...o.base(),
    routeId,
    routeName: p.routeName,
    distributorUid: p.distributorUid,
    distributorName: p.distributorName,
    warehouseId: wh,
    status: "open",
    lines,
    linesProductIds: [...new Set(lines.map(line => line.productId))],
    additions: [],
    observation: p.observation || "",
    warehouseResponsibleName,
  };
  o.put("distDispatches", o.id, d);
  return d;
}
function getDispatchLoadedMap(d) {
  const map = new Map();
  for (const line of d.lines || []) {
    map.set(line.productId, round((map.get(line.productId) || 0) + line.quantity));
  }
  for (const add of d.additions || []) {
    if (add.voided) continue;
    for (const line of add.quantityByProduct || []) {
      map.set(line.productId, round((map.get(line.productId) || 0) + line.quantity));
    }
  }
  return map;
}
function normalizeDispatchLines(lines = []) {
  const byProduct = new Map();
  for (const source of lines) {
    const hasNewMermaModel = Object.prototype.hasOwnProperty.call(source, "dispatchMerma") || Object.prototype.hasOwnProperty.call(source, "normalQuantity");
    const current = byProduct.get(source.productId) || { ...source, quantity: 0, allocations: [], ...(hasNewMermaModel ? { normalQuantity: 0, dispatchMerma: 0, dispatchMermaAllocations: [] } : {}) };
    current.quantity = round(current.quantity + (Number(source.quantity) || 0));
    if (hasNewMermaModel) {
      current.normalQuantity = round((current.normalQuantity || 0) + (Number(source.normalQuantity) || 0));
      current.dispatchMerma = round((current.dispatchMerma || 0) + (Number(source.dispatchMerma) || 0));
      current.dispatchMermaAllocations = [...(current.dispatchMermaAllocations || []), ...(source.dispatchMermaAllocations || [])];
    }
    const sourceAllocations = Array.isArray(source.allocations) && source.allocations.length
      ? source.allocations
      : source.lotId ? [{ lotId: source.lotId, lotCode: source.lotCode || "", expiresOn: source.expiresOn || "", quantity: source.quantity, productionCost: source.productionCost ?? null }] : [];
    for (const allocation of sourceAllocations) {
      const existing = current.allocations.find((part) => part.lotId === allocation.lotId);
      if (allocation.processingAllocation) current.allocations.push({ ...allocation });
      else if (existing) existing.quantity = round(existing.quantity + allocation.quantity);
      else current.allocations.push({ ...allocation });
    }
    byProduct.set(source.productId, current);
  }
  return [...byProduct.values()];
}
function setDispatchLineMerma(line, merma) {
  const value = round(merma);
  line.dispatchMerma = value;
  line.normalQuantity = round(line.quantity - value);
  const allocations = Array.isArray(line.allocations) ? line.allocations : [];
  line.dispatchMermaAllocations = value > 0
    ? splitAllocationsByAmounts(allocations, [line.normalQuantity, value])[1]
    : [];
}
function correctedDispatchMerma(line, change, newQuantity, product) {
  if (!Object.prototype.hasOwnProperty.call(line, "dispatchMerma") && change.newDispatchMerma === undefined) return undefined;
  const value = change.newDispatchMerma === undefined
    ? round(Math.min(Number(line.dispatchMerma) || 0, newQuantity))
    : dispatchCorrectionAmount(Number(change.newDispatchMerma), product);
  check(product.unitType === "kg" || value === 0, "La merma adicional solo aplica a productos por kg.");
  check(value <= newQuantity, "La merma adicional no puede superar el total físico cargado.");
  return value;
}
function dispatchCorrectionAmount(value, product) {
  check(Number.isFinite(value) && value >= 0, "La cantidad no puede ser negativa.");
  check(product.unitType === "kg" || Number.isInteger(value), "Paquetes y unidades requieren cantidades enteras.");
  return round(value);
}

function splitAllocationsByAmounts(allocations, amounts) {
  const groups = amounts.map(() => []);
  let groupIndex = 0;
  let remaining = roundAt(amounts[0] || 0, 3);
  for (const allocation of allocations) {
    let quantity = roundAt(allocation.quantity, 3);
    while (quantity > 0.0001) {
      while (groupIndex < amounts.length && remaining <= 0.0001) {
        groupIndex += 1;
        remaining = roundAt(amounts[groupIndex] || 0, 3);
      }
      check(groupIndex < amounts.length, "No se pudieron distribuir los lotes del retorno.");
      const part = roundAt(Math.min(quantity, remaining), 3);
      if (part > 0) groups[groupIndex].push(origins.slice(allocation, roundAt(allocation.quantity - quantity, 3), part));
      quantity = roundAt(quantity - part, 3);
      remaining = roundAt(remaining - part, 3);
    }
  }
  check(Math.abs(roundAt(allocations.reduce((sum, part) => sum + part.quantity, 0), 3) - roundAt(amounts.reduce((sum, value) => sum + value, 0), 3)) < 0.001,
    "Las asignaciones de lotes no coinciden con las cantidades recibidas.");
  return groups;
}
function historicalAllocationCostCents(allocations) {
  let derivedCents = 0;
  let ordinaryCost = 0;
  for (const allocation of allocations || []) {
    const derived = allocation.processingAllocation;
    if (derived) {
      if (!Number.isSafeInteger(derived.costCents)) return null;
      derivedCents += derived.costCents;
    } else {
      if (allocation.productionCost === null || allocation.productionCost === undefined || !Number.isFinite(Number(allocation.productionCost))) return null;
      ordinaryCost += Number(allocation.quantity) * Number(allocation.productionCost);
    }
  }
  const cents = derivedCents + Math.round((ordinaryCost + Number.EPSILON) * 100);
  return Number.isSafeInteger(cents) && cents >= 0 ? cents : null;
}
async function revertLineStock(o, d, line, returnQty, reason) {
  if (returnQty <= 0) return [];
  const wh = d.warehouseId || "central";
  const warehouse = location("warehouse", wh);
  const route = location("route", d.routeId);
  const pid = line.productId;
  const precision = quantityPrecision({ unitType: line.unitType });

  const e = await o.loadStock(pid, warehouse);
  await o.loadStock(pid, route);

  const allocationsReturned = [];
  let remainingReturn = returnQty;

  if (Array.isArray(line.allocations) && line.allocations.length > 0) {
    for (let i = line.allocations.length - 1; i >= 0 && remainingReturn > 0; i--) {
      const alloc = line.allocations[i];
      const takeBack = roundAt(Math.min(remainingReturn, alloc.quantity), precision);
      if (takeBack <= 0) continue;
      const returnedAllocation = origins.slice(alloc, roundAt(alloc.quantity - takeBack, precision), takeBack);
      const retainedAllocation = origins.slice(alloc, 0, roundAt(alloc.quantity - takeBack, precision));
      delete alloc.originReferences;
      Object.assign(alloc, retainedAllocation);
      remainingReturn = roundAt(remainingReturn - takeBack, precision);
      allocationsReturned.push(returnedAllocation);
    }
    line.allocations = line.allocations.filter((a) => a.quantity > 0.0001);
  } else {
    const lotId =
      line.lotId ||
      e.lots.find((l) => l.productId === pid && l.lotCode === line.lotCode)?.id;
    check(lotId, "No se encontró el lote de origen para retornar la mercadería.");
    allocationsReturned.push({
      lotId,
      lotCode: line.lotCode || "",
      quantity: returnQty,
    });
  }

  for (const part of allocationsReturned) {
    const lot = e.lots.find((x) => x.id === part.lotId);
    check(
      lot,
      `No se encontró el lote ${part.lotCode || part.lotId} en el inventario.`,
    );
    origins.remove(lot, route, part);
    o.removeProcessingAllocation(lot, route, part);
    origins.restore(lot, warehouse, part);
    o.restoreProcessingAllocation(lot, warehouse, part);
  }

  o.move(e, warehouse, returnQty);
  o.move(e, route, -returnQty);

  o.ledger(pid, returnQty, route, warehouse, "dispatch_correction", {
    note: reason.trim(),
    dispatchId: d.id,
    allocations: allocationsReturned,
    lotCode:
      allocationsReturned.map((a) => a.lotCode).filter(Boolean).join(", ") ||
      line.lotCode ||
      "",
  });

  return allocationsReturned;
}
async function correctDispatch(o, p) {
  check(
    ["admin", "warehouse"].includes(o.member.role),
    "Sin permiso para corregir despachos.",
  );
  check(p.dispatchId?.trim(), "Falta el identificador del despacho.");
  check(p.reason?.trim(), "El motivo de la corrección es obligatorio.");

  const d = await o.read("distDispatches", p.dispatchId);
  check(d, "Despacho inexistente.");
  check(
    d.status === "open",
    "Este despacho ya fue cerrado y no puede modificarse.",
  );
  // Compatibilidad sin migración masiva: si un despacho histórico guardó el
  // mismo producto en varias filas, se normaliza dentro de esta corrección y
  // se combinan sus asignaciones reales antes de calcular devoluciones.
  d.lines = normalizeDispatchLines(d.lines || []);
  d.additions = (d.additions || []).map((addition) => ({
    ...addition,
    quantityByProduct: normalizeDispatchLines(addition.quantityByProduct || []),
  }));

  const changes = Array.isArray(p.changes) && p.changes.length > 0 ? p.changes : [p];
  check(changes.length > 0, "No se enviaron cambios para corregir.");

  const wh = d.warehouseId || "central";
  const warehouse = location("warehouse", wh);
  const route = location("route", d.routeId);
  if (o.member.role === "warehouse") {
    o.owns(warehouse);
  }

  const sales = (await o.query("distSales", "dispatchId", d.id)).map((sale) =>
    sale.effectiveSnapshot ? { ...sale, ...sale.effectiveSnapshot } : sale,
  );

  const loadedMap = getDispatchLoadedMap(d);
  d.corrections = d.corrections || [];

  // Pre-validaciones y cálculo neto de variación por producto
  const netDeltaByProduct = new Map();
  for (const c of changes) {
    check(
      ["initial", "addition"].includes(c.targetType),
      "Tipo de corrección inválido.",
    );
    if (c.targetType === "initial") {
      check(c.productId?.trim(), "Falta el identificador del producto.");
      const line = (d.lines || []).find((l) => l.productId === c.productId);
      check(line, "El producto no se encuentra en la carga inicial.");
      const oldQty = line.quantity;
      const product = await o.product(c.productId);
      const newQty = dispatchCorrectionAmount(c.newQuantity, product);
      correctedDispatchMerma(line, c, newQty, product);
      const delta = round(newQty - oldQty);
      netDeltaByProduct.set(
        c.productId,
        round((netDeltaByProduct.get(c.productId) || 0) + delta),
      );
    } else if (c.targetType === "addition") {
      check(c.additionId?.trim(), "Identificador de aumento requerido.");
      const addition = (d.additions || []).find((a) => a.id === c.additionId);
      check(addition, "El aumento de carga no existe.");
      check(!addition.voided, "Este aumento ya fue anulado anteriormente.");

      if (c.voidAddition === true) {
        for (const line of addition.quantityByProduct || []) {
          const oldQty = line.quantity;
          if (oldQty <= 0) continue;
          const delta = -oldQty;
          netDeltaByProduct.set(
            line.productId,
            round((netDeltaByProduct.get(line.productId) || 0) + delta),
          );
        }
      } else {
        check(c.productId?.trim(), "Falta el identificador del producto.");
        const line = (addition.quantityByProduct || []).find(
          (l) => l.productId === c.productId,
        );
        check(line, "El producto no se encuentra en este aumento.");
        const oldQty = line.quantity;
        const product = await o.product(c.productId);
        const newQty = dispatchCorrectionAmount(c.newQuantity, product);
        correctedDispatchMerma(line, c, newQty, product);
        const delta = round(newQty - oldQty);
        netDeltaByProduct.set(
          c.productId,
          round((netDeltaByProduct.get(c.productId) || 0) + delta),
        );
      }
    }
  }

  // Comprobar que ninguna reducción viole las ventas ya registradas
  for (const [pid, delta] of netDeltaByProduct.entries()) {
    if (delta < 0) {
      const currentLoaded = loadedMap.get(pid) || 0;
      const newLoaded = round(currentLoaded + delta);
      const totalSold = round(
        sales.reduce(
          (sum, s) =>
            sum +
            (s.lines || [])
              .filter((l) => l.productId === pid)
              .reduce((n, l) => n + l.quantity, 0),
          0,
        ),
      );
      check(
        newLoaded >= totalSold,
        `No puedes reducir la carga a ${newLoaded} porque ya se registraron ${totalSold} vendidos.`,
      );
    }
  }

  // Aplicación secuencial de los cambios
  for (const c of changes) {
    if (c.targetType === "initial") {
      const line = (d.lines || []).find((l) => l.productId === c.productId);
      const oldQty = line.quantity;
      const oldMerma = round(Number(line.dispatchMerma) || 0);
      const product = await o.product(c.productId);
      const newQty = dispatchCorrectionAmount(c.newQuantity, product);
      const newMerma = correctedDispatchMerma(line, c, newQty, product);

      if (newQty < oldQty) {
        const returnQty = round(oldQty - newQty);
        const allocationsReturned = await revertLineStock(
          o,
          d,
          line,
          returnQty,
          p.reason,
        );
        line.quantity = newQty;
        if (newMerma !== undefined) setDispatchLineMerma(line, newMerma);

        d.corrections.push({
          id: `${o.id}__corr_${d.corrections.length + 1}`,
          operationId: o.id,
          targetType: "initial",
          productId: c.productId,
          productName: line.productName,
          oldQuantity: oldQty,
          newQuantity: newQty,
          ...(newMerma !== undefined ? { oldDispatchMerma: oldMerma, newDispatchMerma: newMerma } : {}),
          returnedQuantity: returnQty,
          unitType: line.unitType,
          lotCode:
            allocationsReturned.map((a) => a.lotCode).filter(Boolean).join(", ") ||
            line.lotCode ||
            "",
          lotId: allocationsReturned[0]?.lotId || line.lotId || "",
          reason: p.reason.trim(),
          correctedBy: o.actor,
          correctedByName: o.member.displayName || o.actor,
          correctedAt: o.now,
        });
      } else if (newQty > oldQty) {
        const addQty = round(newQty - oldQty);
        let allocationsAdded;
        try {
          if (c.lotId || line.lotId) {
            allocationsAdded = await o.moveStock(
              line.productId,
              warehouse,
              route,
              addQty,
              { lotId: c.lotId || line.lotId, processingDispatch: true },
            );
          } else {
            allocationsAdded = await o.moveStock(
              line.productId,
              warehouse,
              route,
              addQty,
              { processingDispatch: true },
            );
          }
        } catch (lotErr) {
          if (c.lotId || line.lotId) {
            if (lotErr?.code === 'processing/logistics-not-authorized') throw lotErr;
            allocationsAdded = await o.moveStock(
              line.productId,
              warehouse,
              route,
              addQty,
            );
          } else {
            throw lotErr;
          }
        }

        line.quantity = newQty;
        line.allocations = line.allocations || [];
        for (const addAlloc of allocationsAdded) {
          if (addAlloc.processingAllocation) {
            line.allocations.push({ ...addAlloc });
            continue;
          }
          const existing = line.allocations.find((a) => a.lotId === addAlloc.lotId);
          if (existing) {
            existing.quantity = round(existing.quantity + addAlloc.quantity);
          } else {
            line.allocations.push({ ...addAlloc });
          }
        }
        if (newMerma !== undefined) setDispatchLineMerma(line, newMerma);

        o.ledger(
          line.productId,
          addQty,
          warehouse,
          route,
          "dispatch_correction",
          {
            refId: d.id,
            note: p.reason.trim(),
            allocations: allocationsAdded,
            lotCode:
              allocationsAdded.map((a) => a.lotCode).filter(Boolean).join(", ") ||
              line.lotCode ||
              "",
          },
        );

        d.corrections.push({
          id: `${o.id}__corr_${d.corrections.length + 1}`,
          operationId: o.id,
          targetType: "initial",
          productId: c.productId,
          productName: line.productName,
          oldQuantity: oldQty,
          newQuantity: newQty,
          ...(newMerma !== undefined ? { oldDispatchMerma: oldMerma, newDispatchMerma: newMerma } : {}),
          addedQuantity: addQty,
          unitType: line.unitType,
          lotCode:
            allocationsAdded.map((a) => a.lotCode).filter(Boolean).join(", ") ||
            line.lotCode ||
            "",
          lotId: allocationsAdded[0]?.lotId || line.lotId || "",
          reason: p.reason.trim(),
          correctedBy: o.actor,
          correctedByName: o.member.displayName || o.actor,
          correctedAt: o.now,
        });
      } else if (newMerma !== undefined && newMerma !== oldMerma) {
        setDispatchLineMerma(line, newMerma);
        d.corrections.push({ id: `${o.id}__corr_${d.corrections.length + 1}`, operationId: o.id, targetType: "initial", productId: c.productId, productName: line.productName, oldQuantity: oldQty, newQuantity: newQty, oldDispatchMerma: oldMerma, newDispatchMerma: newMerma, unitType: line.unitType, reason: p.reason.trim(), correctedBy: o.actor, correctedByName: o.member.displayName || o.actor, correctedAt: o.now });
      }
    } else if (c.targetType === "addition") {
      const addition = (d.additions || []).find((a) => a.id === c.additionId);
      if (c.voidAddition === true) {
        for (const line of addition.quantityByProduct || []) {
          const oldQty = line.quantity;
          if (oldQty <= 0) continue;
          const allocationsReturned = await revertLineStock(
            o,
            d,
            line,
            oldQty,
            p.reason,
          );
          line.quantity = 0;

          d.corrections.push({
            id: `${o.id}__corr_${d.corrections.length + 1}`,
            operationId: o.id,
            targetType: "addition",
            additionId: addition.id,
            productId: line.productId,
            productName: line.productName,
            oldQuantity: oldQty,
            newQuantity: 0,
            returnedQuantity: oldQty,
            unitType: line.unitType,
            lotCode:
              allocationsReturned.map((a) => a.lotCode).filter(Boolean).join(", ") ||
              line.lotCode ||
              "",
            lotId: allocationsReturned[0]?.lotId || line.lotId || "",
            reason: p.reason.trim(),
            correctedBy: o.actor,
            correctedByName: o.member.displayName || o.actor,
            correctedAt: o.now,
          });
        }
        addition.voided = true;
        addition.voidedAt = o.now;
        addition.voidedBy = o.actor;
        addition.voidReason = p.reason.trim();
      } else {
        const line = (addition.quantityByProduct || []).find(
          (l) => l.productId === c.productId,
        );
        const oldQty = line.quantity;
        const oldMerma = round(Number(line.dispatchMerma) || 0);
        const product = await o.product(c.productId);
        const newQty = dispatchCorrectionAmount(c.newQuantity, product);
        const newMerma = correctedDispatchMerma(line, c, newQty, product);

        if (newQty < oldQty) {
          const returnQty = round(oldQty - newQty);
          const allocationsReturned = await revertLineStock(
            o,
            d,
            line,
            returnQty,
            p.reason,
          );
          line.quantity = newQty;
          if (newMerma !== undefined) setDispatchLineMerma(line, newMerma);

          d.corrections.push({
            id: `${o.id}__corr_${d.corrections.length + 1}`,
            operationId: o.id,
            targetType: "addition",
            additionId: addition.id,
            productId: c.productId,
            productName: line.productName,
            oldQuantity: oldQty,
            newQuantity: newQty,
            ...(newMerma !== undefined ? { oldDispatchMerma: oldMerma, newDispatchMerma: newMerma } : {}),
            returnedQuantity: returnQty,
            unitType: line.unitType,
            lotCode:
              allocationsReturned.map((a) => a.lotCode).filter(Boolean).join(", ") ||
              line.lotCode ||
              "",
            lotId: allocationsReturned[0]?.lotId || line.lotId || "",
            reason: p.reason.trim(),
            correctedBy: o.actor,
            correctedByName: o.member.displayName || o.actor,
            correctedAt: o.now,
          });
        } else if (newQty > oldQty) {
          const addQty = round(newQty - oldQty);
          let allocationsAdded;
          try {
            if (c.lotId || line.lotId) {
              allocationsAdded = await o.moveStock(
                line.productId,
                warehouse,
                route,
                addQty,
                { lotId: c.lotId || line.lotId, processingDispatch: true },
              );
            } else {
              allocationsAdded = await o.moveStock(
                line.productId,
                warehouse,
                route,
                addQty,
                { processingDispatch: true },
              );
            }
          } catch (lotErr) {
            if (lotErr?.code === 'processing/logistics-not-authorized') throw lotErr;
            if (c.lotId || line.lotId) {
              allocationsAdded = await o.moveStock(
                line.productId,
                warehouse,
                route,
                addQty,
              );
            } else {
              throw lotErr;
            }
          }

          line.quantity = newQty;
          line.allocations = line.allocations || [];
          for (const addAlloc of allocationsAdded) {
            if (addAlloc.processingAllocation) {
              line.allocations.push({ ...addAlloc });
              continue;
            }
            const existing = line.allocations.find((a) => a.lotId === addAlloc.lotId);
            if (existing) {
              existing.quantity = round(existing.quantity + addAlloc.quantity);
            } else {
              line.allocations.push({ ...addAlloc });
            }
          }
          if (newMerma !== undefined) setDispatchLineMerma(line, newMerma);

          o.ledger(
            line.productId,
            addQty,
            warehouse,
            route,
            "dispatch_correction",
            {
              refId: d.id,
              note: p.reason.trim(),
              allocations: allocationsAdded,
              lotCode:
                allocationsAdded.map((a) => a.lotCode).filter(Boolean).join(", ") ||
                line.lotCode ||
                "",
            },
          );

          d.corrections.push({
            id: `${o.id}__corr_${d.corrections.length + 1}`,
            operationId: o.id,
            targetType: "addition",
            additionId: addition.id,
            productId: c.productId,
            productName: line.productName,
            oldQuantity: oldQty,
            newQuantity: newQty,
            ...(newMerma !== undefined ? { oldDispatchMerma: oldMerma, newDispatchMerma: newMerma } : {}),
            addedQuantity: addQty,
            unitType: line.unitType,
            lotCode:
              allocationsAdded.map((a) => a.lotCode).filter(Boolean).join(", ") ||
              line.lotCode ||
              "",
            lotId: allocationsAdded[0]?.lotId || line.lotId || "",
            reason: p.reason.trim(),
            correctedBy: o.actor,
            correctedByName: o.member.displayName || o.actor,
            correctedAt: o.now,
          });
        } else if (newMerma !== undefined && newMerma !== oldMerma) {
          setDispatchLineMerma(line, newMerma);
          d.corrections.push({ id: `${o.id}__corr_${d.corrections.length + 1}`, operationId: o.id, targetType: "addition", additionId: addition.id, productId: c.productId, productName: line.productName, oldQuantity: oldQty, newQuantity: newQty, oldDispatchMerma: oldMerma, newDispatchMerma: newMerma, unitType: line.unitType, reason: p.reason.trim(), correctedBy: o.actor, correctedByName: o.member.displayName || o.actor, correctedAt: o.now });
        }
      }
    }
  }

  d.linesProductIds = [
    ...new Set(
      [
        ...(d.lines || []).filter((l) => l.quantity > 0),
        ...(d.additions || [])
          .filter((a) => !a.voided)
          .flatMap((a) => a.quantityByProduct || [])
          .filter((l) => l.quantity > 0),
      ].map((l) => l.productId),
    ),
  ];
  o.put("distDispatches", d.id, d);
  return { id: d.id, corrections: d.corrections };
}
async function sale(o, p) {
  const isCourtesy = p.saleKind === "courtesy";
  check(!isCourtesy || typeof p.courtesyReason === "string" && p.courtesyReason.trim(), "Indica el motivo de la cortesía.");
  check(
    ["admin", "distributor"].includes(o.member.role),
    "No puedes registrar ventas.",
  );
  check(
    p.sourceLocation ===
      (o.member.role === "distributor" ? "route" : "centralWarehouse"),
    "Origen de venta no autorizado.",
  );
  if (o.member.role === "admin") {
    p.routeId = "administracion";
    p.routeName = "Administración";
  } else {
    check(p.routeId === o.member.routeId, "La venta no corresponde a tu ruta.");
  }
  const loc =
    o.member.role === "distributor"
      ? location("route", o.member.routeId)
      : "central";
  if (o.member.role === "distributor") {
    const d = await o.read("distDispatches", p.dispatchId);
    check(
      d?.status === "open" &&
        !d.warehouseClosedBy &&
        d.distributorUid === o.actor &&
        d.routeId === o.member.routeId,
      "La ruta no está abierta.",
    );
    const c = await o.read("distClosures", `closure_${d.id}`);
    check(!c?.warehouseClosedBy, "Ya se recibió el retorno de la ruta.");
  }
  if (p.customerId) {
    const c = await o.read("distCustomers", p.customerId);
    check(c?.active, "El cliente está inactivo.");
    if (!isCourtesy) {
      check(c.identityNumber, "Completa el CI del cliente antes de vender.");
      const debts = await o.query("distReceivables", "customerId", p.customerId);
      const supportConfig = await o.read("supportConfig", "main");
      const creditBlockDays = Number.isInteger(supportConfig?.creditBlockDays)
        ? supportConfig.creditBlockDays
        : 7;
      const override = await o.read("distCreditOverrides", p.customerId);
      const overrideActive = override && !override.revokedAt && Date.parse(override.activeUntil) > Date.now();
      check(
        overrideActive || !debts.some(
          (d) =>
            d.balance > 0 &&
            new Date(d.createdAt).getTime() + creditBlockDays * 86400000 <= Date.now(),
        ),
        `Venta bloqueada: el cliente tiene créditos pendientes de ${creditBlockDays} días o más.`,
      );
    }
    p.customerName = c.name;
    p.customerCode = c.identityNumber || c.customerCode || "";
  }
  check(Array.isArray(p.lines) && p.lines.length, "Agrega productos.");
  const lines = [];
  for (const l of p.lines) {
    const product = await o.product(l.productId);
    const actualUnitPrice = isCourtesy ? round(product.referencePrice) : l.actualUnitPrice;
    const promotional = !isCourtesy && round(actualUnitPrice) !== round(product.referencePrice);
    check(
      o.member.role === "admin" || !promotional || l.isPromotional === true,
      "Marca la venta como promocional para modificar el precio.",
    );
    check(
      Number.isFinite(actualUnitPrice) && actualUnitPrice > 0,
      "Precio inválido.",
    );
    const chargedQuantity = o.amount(Number(l.quantity), product, false, quantityPrecision(product));
    const physicalQuantity = o.member.role === "admin" && product.unitType === "kg"
      ? o.amount(Number(l.physicalQuantity ?? chargedQuantity), product, false, quantityPrecision(product))
      : chargedQuantity;
    check(physicalQuantity >= chargedQuantity, "El peso entregado no puede ser menor que la cantidad cobrada.");
    check(o.member.role === "admin" || l.physicalQuantity == null || Number(l.physicalQuantity) === chargedQuantity, "Solo Administración puede registrar un peso entregado distinto.");
    check(product.unitType === "kg" || physicalQuantity === chargedQuantity, "El peso entregado adicional solo aplica a productos por kg.");
    check(product.unitType === "kg" || l.physicalQuantity == null || Number(l.physicalQuantity) === chargedQuantity, "El peso físico adicional solo aplica a productos por kg.");
    check(Number.isFinite(Number(l.quantity)) && Number(l.quantity) > 0, "La cantidad cobrada es inválida.");
    const excessWeightQuantity = roundAt(physicalQuantity - chargedQuantity, quantityPrecision(product));
    // This server-side opt-in is deliberately effective only while both Functions
    // and Firestore emulators are active. A client payload cannot enable it.
    const allocations = await o.take(l.productId, loc, physicalQuantity, { precision: quantityPrecision(product), processingSale: true });
    const known = allocations.every((allocation) => allocation.processingAllocation
      ? Number.isSafeInteger(allocation.processingAllocation.costCents)
      : allocation.productionCost !== null && allocation.productionCost !== undefined);
    const processingCostCents = allocations.filter(allocation => allocation.processingAllocation).reduce((sum, allocation) => sum + allocation.processingAllocation.costCents, 0);
    const ordinaryCost = allocations.filter(allocation => !allocation.processingAllocation).reduce((sum, allocation) => sum + Number(allocation.quantity) * Number(allocation.productionCost), 0);
    const costCents = known ? processingCostCents + Math.round((ordinaryCost + Number.EPSILON) * 100) : null;
    check(costCents === null || Number.isSafeInteger(costCents) && costCents >= 0, 'El costo histórico de la venta no tiene centavos válidos.');
    const line = {
      productId: l.productId,
      productNameSnapshot: product.name,
      presentationSnapshot: product.presentation || product.category || "",
      descriptionSnapshot: product.description || "",
      ...(product.unitType === "package" && Number(product.documentedPackageWeightKg) > 0 ? { documentedPackageWeightKgSnapshot: Number(product.documentedPackageWeightKg) } : {}),
      unitType: product.unitType,
      quantity: l.quantity,
      ...(physicalQuantity !== chargedQuantity ? { physicalQuantity, excessWeightQuantity } : {}),
      actualUnitPrice: round(actualUnitPrice),
      referenceUnitPrice: round(product.referencePrice),
      isPromotional: promotional,
      subtotal: isCourtesy ? 0 : round(l.quantity * actualUnitPrice),
      ...(isCourtesy ? { referenceSubtotal: round(l.quantity * product.referencePrice) } : {}),
      allocations,
      costCents,
      costTotal: costCents === null ? null : costCents / 100,
    };
    const movementId = o.ledger(l.productId, physicalQuantity, loc, null, isCourtesy ? "courtesy" : "sale", {
      allocations,
      costCents,
      costTotal: costCents === null ? null : costCents / 100,
      ...(excessWeightQuantity > 0 ? { chargedQuantity, excessWeightQuantity, note: `Excedente de peso entregado: ${excessWeightQuantity} kg` } : {}),
      ...(isCourtesy ? { courtesyReason: p.courtesyReason.trim(), lossCost: costCents === null ? null : costCents / 100 } : {}),
    });
    for (const allocation of allocations) if (allocation.processingAllocation) {
      allocation.processingAllocation.saleId = o.id;
      allocation.processingAllocation.saleMovementId = movementId;
      allocation.processingAllocation.location = loc;
    }
    lines.push(line);
  }
  const total = round(lines.reduce((n, l) => n + l.subtotal, 0));
  if (isCourtesy) {
    check([p.cashAmount, p.qrAmount, p.creditAmount].every((amount) => Number(amount) === 0), "Una cortesía no puede generar pagos ni crédito.");
    p.paymentKind = "cash";
    p.cashAmount = 0;
    p.qrAmount = 0;
    p.creditAmount = 0;
  }
  check(
    [p.cashAmount, p.qrAmount, p.creditAmount].every(
      (x) => Number.isFinite(x) && x >= 0,
    ) && Math.abs(total - p.cashAmount - p.qrAmount - p.creditAmount) < 0.01,
    "Los pagos no coinciden con el total.",
  );
  check(!p.creditAmount || p.customerId, "El crédito necesita un cliente.");
  const s = {
    id: o.id,
    ...o.base(),
    saleKind: isCourtesy ? "courtesy" : "sale",
    ...(isCourtesy ? {
      courtesyReason: p.courtesyReason.trim(),
      courtesyCost: lines.every((line) => line.costTotal !== null)
        ? round(lines.reduce((sum, line) => sum + line.costTotal, 0))
        : null,
    } : {}),
    operationId: o.id,
    sourceLocation: p.sourceLocation,
    routeId: p.routeId,
    routeName: p.routeName,
    sellerUid: o.actor,
    sellerName: o.member.displayName || o.actor,
    // El rol admin vende desde almacén central, no desde el despacho abierto
    // que el cliente pueda tener seleccionado por su estado de pantalla.
    dispatchId: o.member.role === "distributor" ? p.dispatchId || "" : "",
    customerId: p.customerId || "",
    customerName: p.customerName || "",
    customerCode: p.customerCode || "",
    lines,
    total,
    paymentKind: p.paymentKind,
    cashAmount: p.cashAmount,
    qrAmount: p.qrAmount,
    creditAmount: p.creditAmount,
    cashReceived: Number.isFinite(p.cashReceived) ? round(p.cashReceived) : p.cashAmount,
    changeAmount: Number.isFinite(p.changeAmount) ? round(p.changeAmount) : 0,
    note: p.note || "",
  };
  o.put("distSales", o.id, s);
  if (p.creditAmount > 0)
    o.put("distReceivables", o.id, {
      id: o.id,
      ...o.base(),
      saleId: o.id,
      saleLines: lines,
      customerId: p.customerId,
      customerName: p.customerName,
      customerCode: p.customerCode,
      routeId: p.routeId,
      distributorUid: o.actor,
      distributorName: s.sellerName,
      originalAmount: p.creditAmount,
      paidAmount: 0,
      balance: p.creditAmount,
      status: "OPEN",
    });
  return s;
}
async function collection(o, p) {
  check(
    o.member.role === "admin" ||
      o.member.role === "distributor",
    "No puedes cobrar esta deuda.",
  );
  // Compatibilidad con 1.4.5: enviaba únicamente el id de una cuenta.
  const legacyReceivable = p.receivable?.id ? await o.read("distReceivables", p.receivable.id) : null;
  const customerId = p.customerId || p.receivable?.customerId || legacyReceivable?.customerId;
  check(customerId, "Selecciona un cliente.");
  const debts = (await o.query("distReceivables", "customerId", customerId))
    .filter((row) => Number(row.balance) > 0)
    .sort((a, b) => (a.sourceDate || a.createdAt).localeCompare(b.sourceDate || b.createdAt) || a.id.localeCompare(b.id));
  const portfolioBalanceBefore = round(debts.reduce((sum, row) => sum + row.balance, 0));
  check(Number.isFinite(p.amount) && p.amount > 0 && p.amount <= portfolioBalanceBefore, "El cobro supera el saldo total pendiente.");
  check(["cash", "qr", "mixed"].includes(p.method), "Método de pago inválido.");
  const cashAmount = round(Number.isFinite(p.cashAmount) ? p.cashAmount : p.method === "cash" ? p.amount : 0);
  const qrAmount = round(Number.isFinite(p.qrAmount) ? p.qrAmount : p.method === "qr" ? p.amount : 0);
  check(
    [cashAmount, qrAmount].every((value) => Number.isFinite(value) && value >= 0) &&
      Math.abs(round(cashAmount + qrAmount) - round(p.amount)) < 0.01,
    "El desglose del cobro no coincide con el monto.",
  );
  check(
    (p.method === "cash" && cashAmount === round(p.amount) && qrAmount === 0) ||
      (p.method === "qr" && qrAmount === round(p.amount) && cashAmount === 0) ||
      (p.method === "mixed" && cashAmount > 0 && qrAmount > 0),
    "Revisa la forma y el desglose del cobro.",
  );
  let remaining = round(p.amount);
  const allocations = [];
  for (const r of debts) {
    if (remaining <= 0) break;
    const applied = round(Math.min(remaining, r.balance));
    r.paidAmount = round((r.paidAmount || 0) + applied);
    r.balance = round(r.balance - applied);
    r.status = r.balance === 0 ? "PAID" : "PARTIAL";
    o.put("distReceivables", r.id, r);
    allocations.push({ receivableId: r.id, amount: applied, sourceType: r.sourceType || "sale", saleId: r.saleId || "" });
    remaining = round(remaining - applied);
  }
  const firstDebt = debts[0];
  const collectionRouteId =
    o.member.role === "distributor" ? o.member.routeId : p.routeId || firstDebt?.routeId;
  check(collectionRouteId, "El cobrador no tiene una ruta asignada.");
  const c = {
    id: o.id,
    ...o.base(),
    operationId: o.id,
    receivableId: allocations[0]?.receivableId || "",
    allocations,
    portfolioBalanceBefore,
    portfolioBalanceAfter: round(portfolioBalanceBefore - p.amount),
    saleLines: firstDebt.saleLines || [],
    customerId: firstDebt.customerId,
    customerName: firstDebt.customerName,
    customerCode: firstDebt.customerCode || "",
    // El efectivo pertenece a la ruta del usuario que lo recibe. Se conserva
    // aparte la ruta donde nació la deuda para auditoría de la venta original.
    routeId: collectionRouteId,
    originRouteId: firstDebt.routeId,
    collectedByUid: o.actor,
    collectedByName: o.member.displayName || o.actor,
    amount: p.amount,
    method: p.method,
    cashAmount,
    qrAmount,
    note: p.note || "",
  };
  o.put("distCollections", o.id, c);
  return c;
}
async function openingBalance(o, p) {
  o.admin();
  const customer = await o.read("distCustomers", p.customerId);
  check(customer?.active, "Selecciona un cliente activo.");
  check(Number.isFinite(p.amount) && p.amount > 0, "Indica un saldo válido.");
  check(validDate(p.sourceDate), "Indica la fecha de la deuda anterior.");
  check(p.note?.trim(), "Describe el origen de la deuda anterior.");
  const row = { id: o.id, ...o.base(), sourceType: "opening_balance", sourceDate: p.sourceDate, saleId: "", customerId: customer.id, customerName: customer.name, customerCode: customer.identityNumber || "", routeId: p.routeId || customer.routeId || "administracion", distributorUid: o.actor, distributorName: o.member.displayName || o.actor, originalAmount: round(p.amount), paidAmount: 0, balance: round(p.amount), status: "OPEN", note: p.note.trim() };
  o.put("distReceivables", o.id, row);
  return row;
}
function receivableSnapshot(r) {
  return {
    originalAmount: round(Number(r.originalAmount) || 0),
    paidAmount: round(Number(r.paidAmount) || 0),
    balance: round(Number(r.balance) || 0),
    status: r.status || "OPEN",
    sourceDate: r.sourceDate || "",
    note: r.note || "",
    saleLines: r.saleLines || [],
    adjustedSaleLines: r.adjustedSaleLines || [],
    voided: r.voided === true,
    voidedAt: r.voidedAt || "",
    voidReason: r.voidReason || "",
  };
}
function allocateReceivableCredit(lines, amount) {
  if (!lines.length) return [];
  const targetCents = Math.round(round(amount) * 100);
  const weights = lines.map(line => Math.max(0, Math.round((Number(line.subtotal) || 0) * 100)));
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  if (targetCents <= 0 || totalWeight <= 0) return lines.map(line => ({
    productId: line.productId,
    productNameSnapshot: line.productNameSnapshot,
    presentationSnapshot: line.presentationSnapshot || '',
    quantity: line.quantity,
    unitType: line.unitType,
    creditAmount: 0,
  }));
  const exact = weights.map(weight => targetCents * weight / totalWeight);
  const cents = exact.map(Math.floor);
  const remainder = targetCents - cents.reduce((sum, value) => sum + value, 0);
  const order = exact.map((value, index) => ({ index, fraction: value - cents[index] }))
    .sort((a, b) => b.fraction - a.fraction || a.index - b.index);
  for (let index = 0; index < remainder; index += 1) cents[order[index].index] += 1;
  return lines.map((line, index) => ({
    productId: line.productId,
    productNameSnapshot: line.productNameSnapshot,
    presentationSnapshot: line.presentationSnapshot || '',
    quantity: line.quantity,
    unitType: line.unitType,
    creditAmount: cents[index] / 100,
  }));
}
async function editReceivable(o, p) {
  o.admin();
  const id = safeId(p.receivableId);
  const receivable = await o.read("distReceivables", id);
  check(receivable, "No existe la deuda indicada.");
  check(receivable.voided !== true, "Una deuda anulada no se puede editar.");
  check(p.reason?.trim(), "El motivo de edición es obligatorio.");
  const nextAmount = Number(p.originalAmount);
  check(Number.isFinite(nextAmount) && nextAmount > 0, "Indica un monto original mayor a cero.");
  const paidAmount = round(Number(receivable.paidAmount) || 0);
  check(nextAmount >= paidAmount, "El nuevo monto no puede ser menor que lo ya cobrado.");

  let saleLines = receivable.saleLines || [];
  if (receivable.sourceType !== "opening_balance" && saleLines.length === 0 && receivable.saleId) {
    const sale = await o.read("distSales", receivable.saleId);
    saleLines = sale?.effectiveSnapshot?.lines || sale?.lines || [];
  }
  let adjustedSaleLines = [];
  let sourceDate = receivable.sourceDate || "";
  let note = receivable.note || "";
  if (receivable.sourceType === "opening_balance") {
    check(!Array.isArray(p.adjustedSaleLines) || p.adjustedSaleLines.length === 0, "Un saldo anterior no puede incluir productos inventados.");
    check(validDate(p.sourceDate), "Indica una fecha válida para la deuda.");
    check(p.note?.trim(), "Describe el origen de la deuda.");
    sourceDate = p.sourceDate;
    note = p.note.trim();
  } else {
    check(Array.isArray(saleLines), "El detalle original de la venta no es válido.");
    if (saleLines.length > 0) {
      check(Array.isArray(p.adjustedSaleLines) && p.adjustedSaleLines.length === saleLines.length, "Indica el nuevo importe de cada producto.");
      adjustedSaleLines = p.adjustedSaleLines.map((line, index) => {
        const originalLine = saleLines[index];
        const creditAmount = Number(line?.creditAmount);
        check(line?.productId === originalLine.productId, "No se pueden cambiar ni reordenar los productos de la venta.");
        check(Number.isFinite(creditAmount) && creditAmount >= 0, "El importe de crédito por producto debe ser válido y no negativo.");
        return {
          productId: originalLine.productId,
          productNameSnapshot: originalLine.productNameSnapshot,
          presentationSnapshot: originalLine.presentationSnapshot || "",
          quantity: originalLine.quantity,
          unitType: originalLine.unitType,
          creditAmount: round(creditAmount),
        };
      });
      const sum = round(adjustedSaleLines.reduce((total, line) => total + line.creditAmount, 0));
      check(sum === round(nextAmount), "La suma de los importes por producto debe coincidir exactamente con la nueva deuda.");
    } else {
      check(!Array.isArray(p.adjustedSaleLines) || p.adjustedSaleLines.length === 0, "No se pueden inventar productos para esta deuda histórica.");
    }
  }

  const previousAdjustedSaleLines = receivable.sourceType === "opening_balance"
    ? []
    : receivable.adjustedSaleLines?.length
      ? receivable.adjustedSaleLines
      : allocateReceivableCredit(saleLines, receivable.originalAmount);
  const previous = receivableSnapshot({ ...receivable, saleLines, adjustedSaleLines: previousAdjustedSaleLines });
  const balance = round(nextAmount - paidAmount);
  const status = balance === 0 ? "PAID" : paidAmount > 0 ? "PARTIAL" : "OPEN";
  const next = {
    ...receivable,
    saleLines,
    ...(receivable.sourceType === "opening_balance" ? {} : { adjustedSaleLines }),
    originalAmount: round(nextAmount),
    paidAmount,
    balance,
    status,
    ...(receivable.sourceType === "opening_balance" ? { sourceDate, note } : {}),
    originalSnapshot: receivable.originalSnapshot || previous,
    lastAdjustmentId: o.id,
    lastAdjustedAt: o.now,
    lastAdjustedBy: o.actor,
    lastAdjustmentReason: p.reason.trim(),
  };
  o.put("distReceivables", id, next);
  o.put("distReceivableAdjustments", o.id, {
    id: o.id,
    ...o.base(),
    action: "edit",
    receivableId: id,
    customerId: receivable.customerId,
    customerName: receivable.customerName || "",
    actorName: o.member.displayName || o.actor,
    reason: p.reason.trim(),
    effectiveAt: o.now,
    effectiveDayKey: dayKey(new Date(o.now)),
    previous,
    next: receivableSnapshot(next),
  });
  return next;
}
async function voidReceivable(o, p) {
  o.admin();
  const id = safeId(p.receivableId);
  const receivable = await o.read("distReceivables", id);
  check(receivable, "No existe la deuda indicada.");
  check(receivable.voided !== true, "La deuda ya está anulada.");
  check(p.confirmationText === "ELIMINAR DEUDA", "La confirmación no coincide.");
  check(p.reason?.trim(), "El motivo de anulación es obligatorio.");
  check(round(Number(receivable.paidAmount) || 0) === 0, "Esta deuda ya tiene cobros registrados. No puede eliminarse sin revisar esos movimientos.");

  const customerCollections = await o.query("distCollections", "customerId", receivable.customerId);
  const hasAppliedCollection = customerCollections.some((collection) => {
    if (Array.isArray(collection.allocations))
      return collection.allocations.some((allocation) => allocation.receivableId === id && Number(allocation.amount) > 0);
    if (collection.receivableId === id) return Number(collection.amount) > 0;
    // Cobros antiguos sin detalle de asignación podrían haber amortizado esta deuda por FIFO.
    return !collection.receivableId && (!collection.createdAt || collection.createdAt >= receivable.createdAt);
  });
  check(!hasAppliedCollection, "Hay cobros que podrían corresponder a esta deuda. No puede anularse sin revisar esos movimientos.");

  const previous = receivableSnapshot(receivable);
  const next = {
    ...receivable,
    voided: true,
    voidedAt: o.now,
    voidedBy: o.actor,
    voidedByName: o.member.displayName || o.actor,
    voidReason: p.reason.trim(),
    voidedPreviousBalance: round(Number(receivable.balance) || 0),
    voidedSnapshot: previous,
    originalSnapshot: receivable.originalSnapshot || previous,
    balance: 0,
    status: "VOID",
    lastAdjustmentId: o.id,
    lastAdjustedAt: o.now,
    lastAdjustedBy: o.actor,
    lastAdjustmentReason: p.reason.trim(),
  };
  o.put("distReceivables", id, next);
  o.put("distReceivableAdjustments", o.id, {
    id: o.id,
    ...o.base(),
    action: "void",
    receivableId: id,
    customerId: receivable.customerId,
    customerName: receivable.customerName || "",
    actorName: o.member.displayName || o.actor,
    reason: p.reason.trim(),
    effectiveAt: o.now,
    effectiveDayKey: dayKey(new Date(o.now)),
    previous,
    next: receivableSnapshot(next),
  });
  return next;
}
async function creditOverride(o, p) {
  o.admin();
  const customer = await o.read("distCustomers", p.customerId);
  check(customer, "Cliente inexistente.");
  if (p.revoke === true) {
    const current = await o.read("distCreditOverrides", customer.id);
    check(current && !current.revokedAt, "No existe una autorización activa.");
    const revoked = { ...current, revokedAt: o.now, revokedBy: o.actor };
    o.put("distCreditOverrides", customer.id, revoked); return revoked;
  }
  check(Number.isInteger(p.days) && p.days >= 1 && p.days <= 90, "Duración inválida.");
  check(p.reason?.trim(), "Indica el motivo de la autorización.");
  const value = { id: customer.id, restaurantId: "sanjose", customerId: customer.id, activeUntil: new Date(Date.now() + p.days * 86400000).toISOString(), reason: p.reason.trim(), grantedAt: o.now, grantedBy: o.actor, grantedByName: o.member.displayName || o.actor };
  o.put("distCreditOverrides", customer.id, value); return value;
}
async function changeProductUnit(o, p) {
  o.admin();
  check(["kg", "unit", "package"].includes(p.unitType), "Unidad inválida.");
  const product = await o.read("distProducts", p.productId);
  check(product, "Producto inexistente.");
  if (product.unitType === p.unitType) return product;
  const balances = await o.query("distBalances", "productId", product.id);
  const movements = await o.query("distStockMovements", "productId", product.id);
  const sales = (await o.all("distSales")).filter(row => (row.lines || []).some(line => line.productId === product.id));
  check(!balances.some(row => Math.abs(Number(row.quantity) || 0) > 0.0001), "No se puede cambiar la unidad porque el producto tiene existencias.");
  check(movements.length === 0 && sales.length === 0, "No se puede cambiar la unidad porque existe historial. Crea otro producto.");
  const updated = { ...product, unitType: p.unitType, approximateWeightKg: p.unitType === "kg" ? null : product.approximateWeightKg ?? null, documentedPackageWeightKg: p.unitType === "kg" ? null : product.documentedPackageWeightKg ?? null, updatedAt: o.now, updatedBy: o.actor };
  o.put("distProducts", product.id, updated); return updated;
}
async function warehouseShift(o, p) {
  check(["admin", "warehouse"].includes(o.member.role), "Sin permiso para abrir turno de almacén.");
  const warehouseId = p.warehouseId || o.member.warehouseId || "central";
  o.owns(location("warehouse", warehouseId));
  check(p.responsibleName?.trim(), "Escribe el nombre del encargado.");
  const active = (await o.query("distWarehouseShifts", "warehouseId", warehouseId)).filter(row => row.active);
  for (const row of active) o.put("distWarehouseShifts", row.id, { ...row, active: false, closedAt: o.now, closedBy: o.actor });
  const value = { id: o.id, ...o.base(), warehouseId, responsibleName: p.responsibleName.trim(), openedAt: o.now, openedBy: o.actor, active: true };
  o.put("distWarehouseShifts", o.id, value); return value;
}
async function assertNotReservedCourtesy(o, sale) {
  if (sale.saleKind !== 'courtesy' && sale.effectiveSnapshot?.saleKind !== 'courtesy') return;
  if (sale.reservationId) check(false, 'Esta cortesía está vinculada a una reserva; requiere un procedimiento especializado para corregirla o anularla.');
  const movements = await o.query('distStockMovements', 'saleId', sale.id);
  if (movements.some(row => row.type === 'courtesy' && row.reservationId))
    check(false, 'Esta cortesía está vinculada a una reserva; requiere un procedimiento especializado para corregirla o anularla.');
  const operationId = sale.operationId || sale.id;
  const operation = await o.read('distOperations', operationId);
  if (operation?.payload?.reservationId || operation?.result?.reservationId)
    check(false, 'Esta cortesía está vinculada a una reserva; requiere un procedimiento especializado para corregirla o anularla.');
}
function saleContainsDerivedProcessingAllocation(sale) {
  const snapshots = [sale, sale?.effectiveSnapshot].filter(Boolean);
  return snapshots.some(snapshot => (snapshot.lines || []).some(line => (line.allocations || []).some(allocation => allocation.processingAllocation)));
}
function assertNoDerivedSaleMutation(sale, action) {
  check(!saleContainsDerivedProcessingAllocation(sale), `La venta de sachets derivados no admite ${action} por el flujo tradicional; requiere el procedimiento especializado y su auditoría.`);
}
async function voidDerivedSale(o, p, sale) {
  const claims = await o.query('distClaims', 'saleId', sale.id);
  if (claims.length) {
    const returned = claims.reduce((sum, claim) => sum + Number(claim.quantity || 0), 0);
    check(false, `La venta derivada ya tiene ${claims.length} devolución(es) o cambio(s) registrado(s) (${returned} unidades). El reclamo ya conserva la recepción física, la cuarentena y el ajuste de dinero/crédito; no se aplica una anulación separada ni un segundo reembolso.`);
  }
  check(!sale.voidedAt && !sale.pendingConfirmation, 'La venta derivada ya está anulada o pendiente de confirmación.');
  check(o.member.role === 'admin', 'Solo Administración puede anular una venta derivada tras verificar la custodia física.');
  check(p.voidScenario === 'recorded_in_error_never_delivered',
    'Solo puede anularse por esta vía una venta registrada por error y nunca entregada. Si el producto se entregó y volvió, registra el reclamo/devolución física; no se procesa como error de registro.');
  check(p.physicalCustodyConfirmed === true && String(p.physicalCustodyNote || '').trim().length >= 10,
    'Confirma quién verificó la custodia física y registra una observación concreta antes de anular.');
  const loc = sale.sourceLocation === 'route' ? location('route', sale.routeId) : 'central';
  check(p.custodyLocation === loc, 'La ubicación de la mercadería bajo custodia no coincide con el origen de la venta.');
  if (sale.dispatchId) {
    const dispatch = await o.read('distDispatches', sale.dispatchId);
    check(dispatch?.status === 'open', 'La ruta ya no está abierta; la anulación requiere revisión posterior al cierre.');
    const closures = await o.query('distClosures', 'dispatchId', sale.dispatchId);
    check(!closures.some(row => row.warehouseClosedBy || row.status === 'closed'), 'La ruta ya tiene recepción o cierre confirmado.');
  } else if (isAdministrationRouteId(sale.routeId) || (!sale.routeId && sale.sourceLocation === 'centralWarehouse')) {
    const closures = await o.query('distClosures', 'dayKey', sale.dayKey || dayKey(new Date(sale.createdAt || o.now)));
    check(!closures.some(row => (row.closureType === 'admin' || isAdministrationRouteId(row.routeId)) && row.status === 'closed'),
      'La caja de Administración ya fue cerrada para la jornada de esta venta. Requiere una rectificación administrativa posterior al cierre.');
  }
  // Derived-sale refunds are paid from Administration's cashbox on the day
  // the void is executed, which can differ from the sale's original day.
  // Read this inside the same transaction as closure() so a concurrent close
  // and refund serialize instead of writing incompatible cash snapshots.
  const refundDay = o.today;
  const refundClosures = await o.query('distClosures', 'dayKey', refundDay);
  check(!refundClosures.some(row => (row.closureType === 'admin' || isAdministrationRouteId(row.routeId)) && row.status === 'closed'),
    'La caja de Administración ya está cerrada para hoy. No se puede registrar el reembolso; requiere el procedimiento autorizado de rectificación de caja.');
  const saleSnapshot = sale.effectiveSnapshot && typeof sale.effectiveSnapshot === 'object' ? sale.effectiveSnapshot : sale;
  const rawQrAmount = saleSnapshot.qrAmount;
  const qrRefundAmount = round(typeof rawQrAmount === 'number' && Number.isFinite(rawQrAmount) ? rawQrAmount : Number(sale.qrAmount || 0));
  const qrVerifications = await o.query('distQrVerifications', 'sourceId', sale.id);
  if (qrRefundAmount > 0) {
    const revision = Number.isSafeInteger(sale.revision) && sale.revision >= 0 ? sale.revision : 0;
    const expectedVerificationId = revision > 0 ? `sale_${sale.id}_r${revision}` : `sale_${sale.id}`;
    check(qrVerifications.some(row => row.id === expectedVerificationId && row.sourceType === 'sale' && row.sourceId === sale.id
      && Number(row.sourceRevision || 0) === revision && round(Number(row.amount) || 0) === qrRefundAmount
      && row.routeId === sale.routeId && String(row.reference || '').trim().length > 0
      && String(row.verifiedBy || '').trim().length > 0 && Boolean(row.verifiedAt)),
    'El pago QR original no tiene verificación bancaria vigente y coincidente; no se puede registrar una devolución QR segura.');
  } else check(qrVerifications.every(row => row.sourceType !== 'sale'), 'La verificación QR no coincide con el pago actual de esta venta.');
  const declaredQrRefund = round(Number(p.qrRefundAmount || 0));
  check(declaredQrRefund === qrRefundAmount && (qrRefundAmount === 0 || p.qrRefundConfirmed === true
    && String(p.qrRefundReference || '').trim().length >= 8),
  qrRefundAmount > 0 ? 'Confirma la devolución bancaria exacta y registra su referencia antes de anular la venta.' : 'El monto QR a devolver no coincide con el pago original.');
  const snapshot = await o.withDocumentedOrigins(sale, sale.effectiveSnapshot || sale);
  check(Array.isArray(snapshot.lines) && snapshot.lines.length > 0
    && snapshot.lines.every(line => Array.isArray(line.allocations) && line.allocations.length > 0
      && line.allocations.every(allocation => allocation.processingAllocation
        && allocation.processingAllocation.saleId === sale.id
        && allocation.processingAllocation.saleMovementId)),
  'La venta no conserva segmentos derivados completos para restituir paquetes, gramos y costo sin inventar existencias.');
  const receipt = await o.read('distReceivables', sale.id);
  check(!receipt || Number(receipt.paidAmount || 0) === 0,
    'El crédito ya tiene abonos. No se puede anular ni revertir esos pagos mediante el flujo de anulación.');
  const cashAmount = round(Number(saleSnapshot.cashAmount ?? sale.cashAmount) || 0);
  const qrAmount = round(Number(saleSnapshot.qrAmount ?? sale.qrAmount) || 0);
  const creditAmount = round(Number(saleSnapshot.creditAmount ?? sale.creditAmount) || 0);
  const saleTotal = round(Number(saleSnapshot.total ?? sale.total) || 0);
  const cashRefundAmount = round(Number(p.cashRefundAmount || 0));
  check(cashRefundAmount === cashAmount,
    cashAmount > 0
      ? `Confirma el reembolso físico exacto de Bs ${cashAmount.toFixed(2)} para anular esta venta.`
      : 'El monto de reembolso declarado no coincide con el pago original.');
  const expectedPackages = snapshot.lines.flatMap(line => line.allocations.map(allocation => ({ productId: line.productId, allocation })))
  check(expectedPackages.length > 0, 'La venta no contiene segmentos recuperables.');
  for (const { productId, allocation } of expectedPackages) {
    const part = allocation.processingAllocation;
    const movement = await o.read('distStockMovements', part.saleMovementId);
    check(movement?.type === 'sale' && movement.productId === productId
      && (movement.processingAllocations || []).some(saved => saved.saleId === sale.id && saved.segmentId === part.segmentId && saved.batchId === part.batchId
        && saved.quantity === part.quantity && saved.physicalWeightG === part.physicalWeightG && saved.costCents === part.costCents),
    'Un segmento no coincide con el movimiento original de la venta. No se modificó inventario.');
  }
  const returnedByProduct = new Map();
  for (const line of snapshot.lines) {
    await o.restore(line.productId, loc, line.allocations);
    const current = returnedByProduct.get(line.productId) || { quantity: 0, allocations: [] };
    current.quantity += line.allocations.reduce((sum, allocation) => sum + Number(allocation.quantity || 0), 0);
    current.allocations.push(...line.allocations);
    returnedByProduct.set(line.productId, current);
  }
  for (const [productId, restored] of returnedByProduct) {
    o.ledger(productId, restored.quantity, null, loc, 'sale_void', {
      saleId: sale.id, allocations: restored.allocations, costCents: restored.allocations.every(a => Number.isSafeInteger(a.processingAllocation.costCents))
        ? restored.allocations.reduce((sum, a) => sum + a.processingAllocation.costCents, 0) : null,
      physicalCustodyConfirmed: true, physicalCustodyNote: String(p.physicalCustodyNote).trim(),
      responsibleName: o.member.displayName || o.actor,
      note: String(p.reason || '').trim(),
    });
  }
  const reason = String(p.reason || '').trim();
  check(reason.length >= 3 && reason.length <= 500, 'La razón de la anulación debe tener entre 3 y 500 caracteres.');
  if (receipt) o.put('distReceivables', receipt.id, { ...receipt, originalAmount: 0, balance: 0, status: 'VOID', saleLines: [], voidedAt: o.now, voidedBy: o.actor, voidReason: reason });
  const correction = { id: o.id, ...o.base(), kind: 'derived_void', saleId: sale.id, sellerUid: sale.sellerUid,
    revision: Number(sale.revision || 0) + 1, reason, original: snapshot,
    voidScenario: p.voidScenario,
    corrected: { lines: [], total: 0, paymentKind: saleSnapshot.paymentKind || sale.paymentKind, cashAmount: 0, qrAmount: 0, creditAmount: 0, saleKind: sale.saleKind || 'sale' },
    stockDeltas: [...returnedByProduct].map(([productId, row]) => ({ productId, quantity: -row.quantity, allocations: row.allocations })),
    moneyDelta: -saleTotal, creditDelta: -creditAmount,
    physicalCustodyConfirmed: true, custodyLocation: loc, custodyNote: String(p.physicalCustodyNote).trim(), cashRefundAmount,
    cashReceiptSnapshot: { cashAmount, qrAmount, paymentKind: saleSnapshot.paymentKind || sale.paymentKind || '', saleDayKey: sale.dayKey || '', saleCreatedAt: sale.createdAt || '', sellerUid: sale.sellerUid || '', sellerName: sale.sellerName || '', sourceRevision: Number(sale.revision || 0) },
    correctedByName: o.member.displayName || o.actor };
  o.put('distSaleCorrections', o.id, correction);
  o.put('distSales', sale.id, { ...sale, effectiveSnapshot: correction.corrected, latestCorrectionId: o.id,
    editedAt: o.now, editedBy: o.actor, editReason: reason, voidedAt: o.now, voidedBy: o.actor,
    voidedByName: o.member.displayName || o.actor, voidReason: reason, revision: correction.revision,
    derivedVoid: { correctionId: o.id, voidScenario: p.voidScenario, custodyLocation: loc, custodyConfirmedBy: o.actor, custodyConfirmedByName: o.member.displayName || o.actor,
      custodyConfirmedAt: o.now, custodyNote: correction.custodyNote, cashRefundAmount, cashReceiptSnapshot: correction.cashReceiptSnapshot } });
  // Dedicated cash-out record for closure cash reconciliation. It is deliberately
  // excluded from sales adjustments/profit: the sale itself is voided above.
  if (cashRefundAmount > 0 || qrRefundAmount > 0) o.put('distClaims', o.id, { id: o.id, ...o.base(), kind: 'return', isDerivedSaleVoid: true,
    saleId: sale.id, sellerUid: o.actor, sellerName: o.member.displayName || o.actor, saleSellerUid: sale.sellerUid || '', saleSellerName: sale.sellerName || '', customerId: sale.customerId || '',
    customerName: sale.customerName || '', routeId: 'administracion', originRouteId: sale.routeId || '', productId: snapshot.lines[0].productId,
    productName: snapshot.lines[0].productNameSnapshot, unitType: snapshot.lines[0].unitType,
    quantity: 0, reason, revenueDelta: 0, cashIn: 0, cashOut: cashRefundAmount, qrIn: 0, qrOut: qrRefundAmount,
    cashRefundStatus: 'executed', cashRefundedAt: cashRefundAmount > 0 ? o.now : '', cashRefundedBy: cashRefundAmount > 0 ? o.actor : '',
    cashRefundedByName: cashRefundAmount > 0 ? o.member.displayName || o.actor : '', cashMovementResponsibleUid: o.actor,
    cashMovementResponsibleName: o.member.displayName || o.actor, cashMovementRouteId: 'administracion',
    method: cashRefundAmount > 0 && qrRefundAmount > 0 ? 'mixed' : qrRefundAmount > 0 ? 'qr' : 'cash',
    qrRefundReference: qrRefundAmount > 0 ? String(p.qrRefundReference).trim() : '',
    qrRefundConfirmed: qrRefundAmount > 0, qrRefundedBy: qrRefundAmount > 0 ? o.actor : '', qrRefundedAt: qrRefundAmount > 0 ? o.now : '',
    physicalReceiptConfirmed: true, inventoryRestoredByVoid: true, correctionId: o.id,
    receivedAt: o.now, receivedBy: o.actor, receivedByName: o.member.displayName || o.actor });
  return correction;
}
async function editDerivedSaleEconomicsOnly(o, p, sale) {
  check(o.member.role === 'admin' || sale.sellerUid === o.actor, 'Solo puedes corregir tus propias ventas.');
  check(!sale.voidedAt && !sale.pendingConfirmation, 'La venta no está vigente para corregir.');
  check(sale.saleKind !== 'courtesy' && sale.effectiveSnapshot?.saleKind !== 'courtesy', 'La cortesía no puede corregirse como venta comercial.');
  const qrVerifications = await o.query('distQrVerifications', 'sourceId', sale.id);
  check(!qrVerifications.some(row => row.sourceType === 'sale'), 'La venta tiene una verificación bancaria QR. Requiere revisión administrativa antes de corregirla.');
  const dispatch = sale.dispatchId ? await o.read('distDispatches', sale.dispatchId) : null;
  check(!dispatch || dispatch.status === 'open', 'La ruta ya está cerrada. Usa un flujo administrativo posterior al cierre.');
  check((await o.query('distClaims', 'saleId', sale.id)).length === 0, 'La venta tiene cambios o devoluciones; requiere revisión especializada antes de corregirla.');
  const previous = await o.withDocumentedOrigins(sale, sale.effectiveSnapshot || sale);
  check(Array.isArray(previous.lines) && previous.lines.length > 0 && previous.lines.every(line => Array.isArray(line.allocations) && line.allocations.length > 0), 'La venta derivada no conserva asignaciones completas; no puede corregirse.');
  check(Array.isArray(p.lines) && p.lines.length === previous.lines.length, 'La corrección económica debe conservar todos los productos vendidos.');
  const requested = new Map();
  for (const input of p.lines) {
    check(input?.productId && !requested.has(input.productId), 'No repitas productos en la corrección.');
    requested.set(input.productId, input);
  }
  const lines = [];
  for (const previousLine of previous.lines) {
    const input = requested.get(previousLine.productId);
    check(input, 'La corrección económica no puede quitar ni agregar productos.');
    const product = await o.product(previousLine.productId);
    const precision = quantityPrecision(product);
    check(Number(input.quantity) === Number(previousLine.quantity), 'La corrección de sachets no puede cambiar paquetes ni cantidades físicas; registra una devolución física con el flujo especializado.');
    check(Number(input.physicalQuantity ?? previousLine.physicalQuantity ?? previousLine.quantity) === Number(previousLine.physicalQuantity ?? previousLine.quantity), 'La corrección de sachets no puede cambiar peso físico ni cantidades entregadas.');
    check(Number.isFinite(input.actualUnitPrice) && input.actualUnitPrice > 0, 'Precio inválido.');
    const actualUnitPrice = round(input.actualUnitPrice);
    const referenceUnitPrice = round(previousLine.referenceUnitPrice ?? product.referencePrice);
    const promotional = actualUnitPrice !== referenceUnitPrice;
    check(o.member.role === 'admin' || !promotional || input.isPromotional === true, 'Marca la venta como promocional para modificar el precio.');
    lines.push({ ...previousLine, quantity: o.amount(Number(previousLine.quantity), product, false, precision), actualUnitPrice, referenceUnitPrice, isPromotional: promotional, subtotal: round(Number(previousLine.quantity) * actualUnitPrice), allocations: structuredClone(previousLine.allocations) });
    requested.delete(previousLine.productId);
  }
  check(requested.size === 0, 'La corrección económica no puede agregar productos.');
  const total = round(lines.reduce((sum, line) => sum + line.subtotal, 0));
  const cashAmount = round(Number(p.cashAmount) || 0), qrAmount = round(Number(p.qrAmount) || 0), creditAmount = round(Number(p.creditAmount) || 0);
  check(['cash','qr','credit','mixed'].includes(p.paymentKind), 'Forma de pago inválida.');
  check(Math.abs(total - cashAmount - qrAmount - creditAmount) < 0.01 && [cashAmount,qrAmount,creditAmount].every(value => value >= 0), 'Los pagos corregidos no coinciden con el total.');
  check(!creditAmount || sale.customerId, 'El crédito necesita un cliente.');
  const receivable = await o.read('distReceivables', sale.id);
  const alreadyPaid = round(Number(receivable?.paidAmount) || 0);
  check(creditAmount >= alreadyPaid, 'El crédito corregido no puede ser menor a lo ya cobrado.');
  if (creditAmount > 0) o.put('distReceivables', sale.id, { ...(receivable || { id: sale.id, ...o.base(), saleId: sale.id, sourceType: 'sale', customerId: sale.customerId, customerName: sale.customerName, customerCode: sale.customerCode, routeId: sale.routeId, distributorUid: sale.sellerUid, distributorName: sale.sellerName, paidAmount: 0 }), saleLines: lines, originalAmount: creditAmount, balance: round(creditAmount - alreadyPaid), status: creditAmount === alreadyPaid ? 'PAID' : alreadyPaid > 0 ? 'PARTIAL' : 'OPEN' });
  else if (receivable) o.put('distReceivables', sale.id, { ...receivable, originalAmount: 0, balance: 0, status: 'PAID', saleLines: lines });
  const revision = Number(sale.revision || 0) + 1;
  const corrected = { lines, total, paymentKind: p.paymentKind, cashAmount, qrAmount, creditAmount, saleKind: 'sale', originDocumentationIds: previous.originDocumentationIds || [] };
  const correction = { id: o.id, ...o.base(), saleId: sale.id, sellerUid: sale.sellerUid, revision, reason: p.reason.trim(), original: previous, corrected, stockDeltas: [], moneyDelta: round(total - previous.total), creditDelta: round(creditAmount - previous.creditAmount), correctedByName: o.member.displayName || o.actor, physicalEffect: false };
  o.put('distSaleCorrections', o.id, correction);
  o.put('distSales', sale.id, { ...sale, effectiveSnapshot: corrected, latestCorrectionId: o.id, editedAt: o.now, editedBy: o.actor, editReason: p.reason.trim(), revision });
  return correction;
}
async function editSale(o, p) {
  check(["admin", "distributor"].includes(o.member.role), "Sin permiso para corregir ventas.");
  check(p.reason?.trim(), "La razón de la edición es obligatoria.");
  const sale = await o.read("distSales", p.saleId);
  check(sale, "Venta inexistente.");
  if (saleContainsDerivedProcessingAllocation(sale)) return editDerivedSaleEconomicsOnly(o, p, sale);
  await assertNotReservedCourtesy(o, sale);
  check(o.member.role === "admin" || sale.sellerUid === o.actor, "Solo puedes corregir tus propias ventas.");
  const qrVerifications = await o.query("distQrVerifications", "sourceId", sale.id);
  check(!qrVerifications.some(row => row.sourceType === "sale"), "La venta tiene una verificación bancaria QR. Requiere revisión administrativa antes de corregirla.");
  const dispatch = sale.dispatchId ? await o.read("distDispatches", sale.dispatchId) : null;
  check(!dispatch || dispatch.status === "open", "La ruta ya está cerrada. Usa un flujo administrativo posterior al cierre.");
  const isCourtesy = sale.saleKind === "courtesy" || sale.effectiveSnapshot?.saleKind === "courtesy";
  const previous = await o.withDocumentedOrigins(sale, sale.effectiveSnapshot || { lines: sale.lines, total: sale.total, paymentKind: sale.paymentKind, cashAmount: sale.cashAmount, qrAmount: sale.qrAmount, creditAmount: sale.creditAmount, saleKind: sale.saleKind || "sale" });
  const claims = await o.query("distClaims", "saleId", sale.id);
  check(claims.length === 0, "La venta tiene cambios o devoluciones y requiere revisión administrativa especializada.");
  check(Array.isArray(p.lines) && p.lines.length, "La venta debe conservar al menos un producto.");
  check(previous.lines.every(line => Array.isArray(line.allocations)), "Esta venta histórica no tiene lotes auditables y requiere revisión administrativa.");
  const loc = sale.sourceLocation === "route" ? location("route", sale.routeId) : "central";
  const requestedProductIds = new Set();
  for (const input of p.lines) {
    check(!requestedProductIds.has(input.productId), "No repitas el mismo producto en la corrección.");
    requestedProductIds.add(input.productId);
  }
  const previousByProduct = new Map();
  for (const line of previous.lines) {
    const existing = previousByProduct.get(line.productId);
    if (!existing) {
      previousByProduct.set(line.productId, { ...line, allocations: [...line.allocations] });
      continue;
    }
    const precision = line.unitType === "kg" ? 3 : 2;
    const quantity = roundAt(existing.quantity + line.quantity, precision);
    const existingPhysical = Number(existing.physicalQuantity ?? (existing.allocations.length ? existing.allocations.reduce((sum, row) => sum + Number(row.quantity || 0), 0) : existing.quantity));
    const linePhysical = Number(line.physicalQuantity ?? (line.allocations.length ? line.allocations.reduce((sum, row) => sum + Number(row.quantity || 0), 0) : line.quantity));
    const physicalQuantity = roundAt(existingPhysical + linePhysical, precision);
    const subtotal = round(existing.subtotal + line.subtotal);
    previousByProduct.set(line.productId, {
      ...existing,
      quantity,
      physicalQuantity,
      subtotal,
      actualUnitPrice: round(subtotal / quantity || existing.actualUnitPrice),
      allocations: [...existing.allocations, ...line.allocations],
      costTotal: existing.costTotal == null || line.costTotal == null ? null : round(existing.costTotal + line.costTotal),
    });
  }
  const restoredByProduct = new Map();
  const lines = [];
  for (const input of p.lines) {
    const product = await o.product(input.productId);
    const precision = quantityPrecision(product);
    const requestedQuantity = Number(input.quantity);
    check(Number.isFinite(requestedQuantity) && Math.abs(requestedQuantity - roundAt(requestedQuantity, precision)) < 1e-9, `La cantidad de ${product.name} supera la precisión permitida.`);
    const quantity = o.amount(requestedQuantity, product, false, precision);
    const previousLine = previousByProduct.get(product.id);
    const previousPhysical = previousLine
      ? Number(previousLine.physicalQuantity ?? (previousLine.allocations?.length ? previousLine.allocations.reduce((sum, row) => sum + Number(row.quantity || 0), 0) : previousLine.quantity))
      : quantity;
    const previousCharged = previousLine ? Number(previousLine.quantity) : quantity;
    const previousHadExcess = previousPhysical > previousCharged + 1e-9;
    const chargedQuantityChanged = Math.abs(quantity - previousCharged) > 1e-9;
    const hasExplicitPhysicalQuantity = input.physicalQuantity !== undefined && input.physicalQuantity !== null;
    if (o.member.role === "admin" && product.unitType === "kg" && previousHadExcess && chargedQuantityChanged && !hasExplicitPhysicalQuantity) {
      check(false, `La venta de ${product.name} tenía un excedente físico. Indica expresamente el nuevo peso físico para corregirla.`);
    }
    const requestedPhysicalQuantity = o.member.role === "admin" && product.unitType === "kg"
      ? hasExplicitPhysicalQuantity
        ? Number(input.physicalQuantity)
        : previousLine && !chargedQuantityChanged
          ? previousPhysical
          : quantity
      : quantity;
    check(Number.isFinite(requestedPhysicalQuantity) && Math.abs(requestedPhysicalQuantity - roundAt(requestedPhysicalQuantity, precision)) < 1e-9, `El peso físico de ${product.name} supera la precisión permitida.`);
    const physicalQuantity = o.amount(requestedPhysicalQuantity, product, false, precision);
    check(physicalQuantity >= quantity, "El peso entregado no puede ser menor que la cantidad cobrada.");
    check(o.member.role === "admin" || input.physicalQuantity == null || Number(input.physicalQuantity) === quantity, "Solo Administración puede registrar un peso entregado distinto.");
    check(product.unitType === "kg" || !hasExplicitPhysicalQuantity || Number(input.physicalQuantity) === quantity, "El peso físico distinto solo aplica a productos por kg.");
    check(product.unitType === "kg" || physicalQuantity === quantity, "El peso entregado adicional solo aplica a productos por kg.");
    check(Number.isFinite(input.actualUnitPrice) && input.actualUnitPrice > 0, "Precio inválido.");
    let allocations = [];
    if (previousLine) {
      let retained = physicalQuantity;
      const returned = [];
      for (const allocation of previousLine.allocations) {
        const keptQuantity = roundAt(Math.min(retained, allocation.quantity), precision);
        if (keptQuantity > 0) allocations.push(origins.slice(allocation, 0, keptQuantity));
        const returnedQuantity = roundAt(allocation.quantity - keptQuantity, precision);
        if (returnedQuantity > 0) returned.push(origins.slice(allocation, keptQuantity, returnedQuantity));
        retained = roundAt(retained - keptQuantity, precision);
      }
      if (returned.length) {
        await o.restore(product.id, loc, returned);
        restoredByProduct.set(product.id, returned);
      }
      if (retained > 0) allocations.push(...await o.take(product.id, loc, retained, { precision }));
    } else {
      allocations = await o.take(product.id, loc, physicalQuantity, { precision: quantityPrecision(product) });
    }
    const referenceUnitPrice = round(previousLine?.referenceUnitPrice ?? product.referencePrice);
    const promotional = round(input.actualUnitPrice) !== referenceUnitPrice;
    check(o.member.role === "admin" || !promotional || input.isPromotional === true, "Marca la venta como promocional para modificar el precio.");
    const lineSubtotal = isCourtesy ? 0 : round(quantity * input.actualUnitPrice);
    lines.push({ productId: product.id, productNameSnapshot: product.name, presentationSnapshot: product.presentation || product.category || "", descriptionSnapshot: product.description || "", ...(product.unitType === "package" && Number(previousLine?.documentedPackageWeightKgSnapshot) > 0 ? { documentedPackageWeightKgSnapshot: Number(previousLine.documentedPackageWeightKgSnapshot) } : {}), quantity, ...(physicalQuantity !== quantity ? { physicalQuantity, excessWeightQuantity: roundAt(physicalQuantity - quantity, quantityPrecision(product)) } : {}), unitType: product.unitType, actualUnitPrice: round(input.actualUnitPrice), referenceUnitPrice, isPromotional: isCourtesy ? false : promotional, subtotal: lineSubtotal, ...(isCourtesy ? { referenceSubtotal: round(quantity * referenceUnitPrice) } : {}), allocations, costTotal: allocations.every(a => a.productionCost !== null) ? round(allocations.reduce((sum, a) => sum + a.quantity * a.productionCost, 0)) : null });
  }
  for (const previousLine of previousByProduct.values()) {
    if (!requestedProductIds.has(previousLine.productId)) {
      await o.restore(previousLine.productId, loc, previousLine.allocations);
      restoredByProduct.set(previousLine.productId, previousLine.allocations);
    }
  }
  const productIds = [...new Set([...previous.lines, ...lines].map(line => line.productId))];
  const physicalOf = line => Number(line.physicalQuantity ?? (line.allocations?.length ? line.allocations.reduce((sum, row) => sum + Number(row.quantity || 0), 0) : line.quantity));
  const stockDeltas = productIds.map(productId => {
    const unitType = lines.find(line => line.productId === productId)?.unitType || previous.lines.find(line => line.productId === productId)?.unitType;
    const precision = unitType === "kg" ? 3 : 2;
    return { productId, quantity: roundAt(lines.filter(line => line.productId === productId).reduce((sum, line) => sum + physicalOf(line), 0) - previous.lines.filter(line => line.productId === productId).reduce((sum, line) => sum + physicalOf(line), 0), precision), ...(restoredByProduct.has(productId) ? { allocations: restoredByProduct.get(productId) } : {}) };
  });
  for (const delta of stockDeltas) {
    if (delta.quantity > 0) o.ledger(delta.productId, delta.quantity, loc, null, "sale_correction", { note: p.reason.trim(), saleId: sale.id });
    if (delta.quantity < 0) o.ledger(delta.productId, -delta.quantity, null, loc, "sale_correction", { note: p.reason.trim(), saleId: sale.id });
  }
  const total = isCourtesy ? 0 : round(lines.reduce((sum, line) => sum + line.subtotal, 0));
  const hasLineChange = lines.length !== previousByProduct.size || lines.some(line => {
    const before = previousByProduct.get(line.productId);
    const precision = line.unitType === "kg" ? 3 : 2;
    return !before || roundAt(before.quantity, precision) !== line.quantity || roundAt(physicalOf(before), precision) !== physicalOf(line) || round(before.actualUnitPrice) !== line.actualUnitPrice;
  });
  const cashAmount = round(Number(p.cashAmount) || 0), qrAmount = round(Number(p.qrAmount) || 0), creditAmount = round(Number(p.creditAmount) || 0);
  if (isCourtesy) {
    check(cashAmount === 0 && qrAmount === 0 && creditAmount === 0, "Una cortesía no puede generar pagos ni crédito.");
    check(p.paymentKind === "cash" || p.paymentKind === previous.paymentKind, "La cortesía no se puede convertir en una venta mediante la corrección.");
  }
  const prevCash = round(Number(previous.cashAmount) || 0);
  const prevQr = round(Number(previous.qrAmount) || 0);
  const prevCredit = round(Number(previous.creditAmount) || 0);
  const hasPaymentChange = p.paymentKind !== previous.paymentKind ||
    cashAmount !== prevCash ||
    qrAmount !== prevQr ||
    creditAmount !== prevCredit;
  check(hasLineChange || hasPaymentChange, "Realiza al menos un cambio de cantidad, precio o forma de pago antes de confirmar.");
  check(["cash", "qr", "credit", "mixed"].includes(p.paymentKind), "Forma de pago inválida.");
  check(Math.abs(total - cashAmount - qrAmount - creditAmount) < 0.01 && [cashAmount, qrAmount, creditAmount].every(value => value >= 0), "Los pagos corregidos no coinciden con el total.");
  check(!creditAmount || sale.customerId, "El crédito necesita un cliente.");
  const receivable = await o.read("distReceivables", sale.id);
  const alreadyPaid = receivable?.paidAmount || 0;
  check(creditAmount >= alreadyPaid, "El crédito corregido no puede ser menor a lo ya cobrado.");
  if (creditAmount > 0) o.put("distReceivables", sale.id, { ...(receivable || { id: sale.id, ...o.base(), saleId: sale.id, sourceType: "sale", customerId: sale.customerId, customerName: sale.customerName, customerCode: sale.customerCode, routeId: sale.routeId, distributorUid: sale.sellerUid, distributorName: sale.sellerName, paidAmount: 0 }), saleLines: lines, originalAmount: creditAmount, balance: round(creditAmount - alreadyPaid), status: creditAmount === alreadyPaid ? "PAID" : alreadyPaid > 0 ? "PARTIAL" : "OPEN" });
  else if (receivable) o.put("distReceivables", sale.id, { ...receivable, originalAmount: 0, balance: 0, status: "PAID", saleLines: lines });
  const revision = Number(sale.revision || 0) + 1;
  const corrected = { lines, total, paymentKind: isCourtesy ? "cash" : p.paymentKind, cashAmount, qrAmount, creditAmount, saleKind: isCourtesy ? "courtesy" : "sale", originDocumentationIds: previous.originDocumentationIds || [] };
  const correction = { id: o.id, ...o.base(), saleId: sale.id, sellerUid: sale.sellerUid, revision, reason: p.reason.trim(), original: previous, corrected, stockDeltas, moneyDelta: round(total - previous.total), creditDelta: round(creditAmount - previous.creditAmount), correctedByName: o.member.displayName || o.actor };
  o.put("distSaleCorrections", o.id, correction);
  o.put("distSales", sale.id, { ...sale, effectiveSnapshot: corrected, latestCorrectionId: o.id, editedAt: o.now, editedBy: o.actor, editReason: p.reason.trim(), revision });
  return correction;
}
async function voidSale(o, p) {
  check(["admin", "distributor"].includes(o.member.role), "Sin permiso para anular ventas.");
  check(p.reason?.trim(), "La razón de la anulación es obligatoria.");
  const sale = await o.read("distSales", p.saleId);
  check(sale, "Venta inexistente.");
  if (saleContainsDerivedProcessingAllocation(sale)) return voidDerivedSale(o, p, sale);
  assertNoDerivedSaleMutation(sale, 'anulaciones');
  await assertNotReservedCourtesy(o, sale);
  check(!sale.voidedAt, "La venta ya fue anulada.");
  check(o.member.role === "admin" || sale.sellerUid === o.actor, "Solo puedes anular tus propias ventas.");
  const qrVerifications = await o.query("distQrVerifications", "sourceId", sale.id);
  check(!qrVerifications.some(row => row.sourceType === "sale"), "La venta tiene una verificación bancaria QR. Requiere revisión administrativa antes de anularla.");
  const dispatch = sale.dispatchId ? await o.read("distDispatches", sale.dispatchId) : null;
  check(!dispatch || dispatch.status === "open", "La ruta ya está cerrada. La venta no puede anularse desde el flujo diario.");
  if (sale.dispatchId) {
    const closures = await o.query("distClosures", "dispatchId", sale.dispatchId);
    check(!closures.some(row => row.status === "closed" || row.warehouseClosedBy), "La ruta ya tiene un cierre confirmado. La venta no puede anularse.");
  }
  const claims = await o.query("distClaims", "saleId", sale.id);
  check(claims.length === 0, "La venta tiene cambios o devoluciones y requiere revisión administrativa especializada.");
  const previous = await o.withDocumentedOrigins(sale, sale.effectiveSnapshot || { lines: sale.lines, total: sale.total, paymentKind: sale.paymentKind, cashAmount: sale.cashAmount, qrAmount: sale.qrAmount, creditAmount: sale.creditAmount, saleKind: sale.saleKind || "sale" });
  check(Array.isArray(previous.lines) && previous.lines.length > 0, "La venta no tiene productos activos para anular.");
  check(previous.lines.every(line => Array.isArray(line.allocations) && line.allocations.length > 0), "Esta venta histórica no tiene lotes auditables y requiere revisión administrativa.");
  const receivable = await o.read("distReceivables", sale.id);
  const alreadyPaid = round(Number(receivable?.paidAmount) || 0);
  check(alreadyPaid === 0, "La venta tiene cobros aplicados. No puede anularse sin revisar primero esos cobros.");
  const loc = sale.sourceLocation === "route" ? location("route", sale.routeId) : "central";
  const returnedByProduct = new Map();
  for (const line of previous.lines) {
    await o.restore(line.productId, loc, line.allocations);
    const current = returnedByProduct.get(line.productId) || { quantity: 0, allocations: [] };
    current.quantity = round(current.quantity + line.allocations.reduce((sum, allocation) => sum + Number(allocation.quantity || 0), 0));
    current.allocations.push(...line.allocations);
    returnedByProduct.set(line.productId, current);
  }
  const stockDeltas = [...returnedByProduct.entries()].map(([productId, returned]) => ({
    productId,
    quantity: round(-returned.quantity),
    allocations: returned.allocations,
  }));
  for (const delta of stockDeltas) {
    o.ledger(delta.productId, -delta.quantity, null, loc, "sale_void", { note: p.reason.trim(), saleId: sale.id, allocations: delta.allocations });
  }
  if (receivable) {
    o.put("distReceivables", sale.id, { ...receivable, originalAmount: 0, balance: 0, status: "PAID", saleLines: [], voidedAt: o.now, voidedBy: o.actor, voidReason: p.reason.trim() });
  }
  const revision = Number(sale.revision || 0) + 1;
  const corrected = { lines: [], total: 0, paymentKind: previous.paymentKind, cashAmount: 0, qrAmount: 0, creditAmount: 0, saleKind: sale.saleKind || previous.saleKind || "sale" };
  const correction = { id: o.id, ...o.base(), kind: "void", saleId: sale.id, sellerUid: sale.sellerUid, revision, reason: p.reason.trim(), original: previous, corrected, stockDeltas, moneyDelta: round(-previous.total), creditDelta: round(-(Number(previous.creditAmount) || 0)), correctedByName: o.member.displayName || o.actor };
  o.put("distSaleCorrections", o.id, correction);
  o.put("distSales", sale.id, { ...sale, effectiveSnapshot: corrected, latestCorrectionId: o.id, editedAt: o.now, editedBy: o.actor, editReason: p.reason.trim(), voidedAt: o.now, voidedBy: o.actor, voidedByName: o.member.displayName || o.actor, voidReason: p.reason.trim(), revision });
  return correction;
}
const handlers = {
  intake,
  transfer,
  dispatch,
  addition: (o, p) => dispatch(o, p, true),
  sale,
  collection,
  openingBalance,
  editReceivable,
  voidReceivable,
  creditOverride,
  changeProductUnit,
  warehouseShift,
  editSale,
  voidSale,
  correctDispatch,
};

function quoteStatus(quote, now = new Date()) {
  if (quote.cancelledAt || quote.status === "cancelada") return "cancelada";
  return quote.validUntil < dayKey(now) ? "vencida" : "vigente";
}
function quoteFields(p) {
  check(Array.isArray(p.lines) && p.lines.length > 0 && p.lines.length <= 50, "Agrega al menos un producto a la cotización.");
  const lines = p.lines.map((line) => {
    check(Number.isFinite(line.quantity) && line.quantity > 0 && Number.isFinite(line.unitPrice) && line.unitPrice >= 0, "Revisa cantidades y precios de la cotización.");
    check(line.unitType === "kg" || Number.isInteger(line.quantity), "Paquetes y unidades requieren cantidades enteras.");
    const subtotal = round(line.quantity * line.unitPrice);
    return { productId: safeId(line.productId), productNameSnapshot: String(line.productNameSnapshot || "").trim(), unitType: line.unitType, quantity: round(line.quantity), unitPrice: round(line.unitPrice), subtotal };
  });
  return { lines, total: round(lines.reduce((sum, line) => sum + line.subtotal, 0)) };
}
handlers.quoteCreate = async (o, p) => {
  check(["admin", "distributor"].includes(o.member.role), "No tienes permiso para crear cotizaciones.");
  check(validDate(p.validUntil) && p.validUntil >= o.today, "La fecha de vigencia no puede estar en el pasado.");
  const routeId = o.member.role === "admin" ? "administracion" : String(o.member.routeId || "");
  check(routeId && (o.member.role !== "distributor" || !p.routeId || p.routeId === routeId), "No tienes permiso para cotizar en esa ruta.");
  const { lines, total } = quoteFields(p);
  for (const line of lines) {
    const product = await o.product(line.productId);
    check(product.unitType === line.unitType, "La unidad del producto cambió. Actualiza la cotización.");
    line.productNameSnapshot = product.name;
  }
  const route = routeId === "administracion" ? { name: "Administración" } : await o.read("distRoutes", routeId);
  check(route, "La ruta de la cotización ya no está disponible.");
  const customer = p.customerId ? await o.read("distCustomers", safeId(p.customerId)) : null;
  check(!p.customerId || customer?.active !== false && customer, "El cliente seleccionado no está disponible.");
  const now = o.now;
  const quote = {
    id: o.id, ...o.base(), quoteNumber: `COT-${o.today.replaceAll("-", "")}-${o.id.slice(-5).toUpperCase()}`,
    status: "vigente", validUntil: p.validUntil, sellerUid: o.actor, sellerName: o.member.displayName || o.actor,
    routeId, routeName: route.name, ...(customer ? { customerId: customer.id, customerName: customer.name, customerPhone: customer.phone || "" } : { customerName: String(p.customerName || "Cliente potencial").trim() || "Cliente potencial", customerPhone: String(p.customerPhone || "").trim() }),
    lines, total, note: String(p.note || "").trim(), revision: 1, history: [],
  };
  o.put("distQuotes", quote.id, quote);
  return quote;
};
handlers.quoteUpdate = async (o, p) => {
  const quote = await o.read("distQuotes", safeId(p.quoteId));
  check(quote && quote.deleted !== true && (o.member.role === "admin" || quote.sellerUid === o.actor), "No tienes permiso para modificar esta cotización.");
  check(quoteStatus(quote) === "vigente", "Solo se pueden modificar cotizaciones vigentes.");
  check(validDate(p.validUntil) && p.validUntil >= o.today, "La fecha de vigencia no puede estar en el pasado.");
  const { lines, total } = quoteFields(p);
  for (const line of lines) {
    const product = await o.product(line.productId);
    check(product.unitType === line.unitType, "La unidad del producto cambió. Actualiza la cotización.");
    line.productNameSnapshot = product.name;
  }
  const customer = p.customerId ? await o.read("distCustomers", safeId(p.customerId)) : null;
  check(!p.customerId || customer?.active !== false && customer, "El cliente seleccionado no está disponible.");
  const nextCustomer = customer
    ? { customerId: customer.id, customerName: customer.name, customerPhone: customer.phone || "" }
    : { customerId: "", customerName: String(p.customerName || "Cliente potencial").trim() || "Cliente potencial", customerPhone: String(p.customerPhone || "").trim() };
  const revision = (quote.revision || 1) + 1;
  const updated = { ...quote, ...nextCustomer, lines, total, validUntil: p.validUntil, note: String(p.note || "").trim(), updatedAt: o.now, updatedBy: o.actor, revision, history: [...(quote.history || []).slice(-9), { at: o.now, by: o.actor, revision, previous: { total: quote.total, validUntil: quote.validUntil, customerId: quote.customerId || "", customerName: quote.customerName, lines: quote.lines, note: quote.note || "" }, next: { total, validUntil: p.validUntil, ...nextCustomer, lines, note: String(p.note || "").trim() } }] };
  o.put("distQuotes", quote.id, updated);
  return updated;
};
handlers.quoteCancel = async (o, p) => {
  const quote = await o.read("distQuotes", safeId(p.quoteId));
  check(quote && (o.member.role === "admin" || quote.sellerUid === o.actor), "No tienes permiso para cancelar esta cotización.");
  check(quoteStatus(quote) === "vigente", "Solo se pueden cancelar cotizaciones vigentes.");
  check(String(p.reason || "").trim(), "Indica el motivo de cancelación.");
  const cancelReason = String(p.reason).trim();
  const cancelled = { ...quote, status: "cancelada", cancelledAt: o.now, cancelledBy: o.actor, cancelledByName: o.member.displayName || o.actor, cancelReason, history: [...(quote.history || []).slice(-9), { at: o.now, by: o.actor, action: "cancelada", reason: cancelReason }] };
  o.put("distQuotes", quote.id, cancelled);
  return cancelled;
};
handlers.quoteDelete = async (o, p) => {
  const quote = await o.read("distQuotes", safeId(p.quoteId));
  check(quote && quote.deleted !== true, "La cotización ya fue eliminada o no existe.");
  check(o.member.role === "admin" || (o.member.role === "distributor" && quote.sellerUid === o.actor), "No tienes permiso para eliminar esta cotización.");
  const deleted = {
    ...quote,
    deleted: true,
    deletedAt: o.now,
    deletedBy: o.actor,
    deletedByName: o.member.displayName || o.actor,
    history: [...(quote.history || []).slice(-9), { at: o.now, by: o.actor, action: "eliminada", quoteNumber: quote.quoteNumber, customerName: quote.customerName, total: quote.total }],
  };
  o.put("distQuotes", quote.id, deleted);
  return deleted;
};
async function processCommand(db, ref) {
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists || snap.data().status !== "queued") return;
    const command = snap.data();
    const root = ref.parent.parent;
    const membership = await tx.get(
      root.collection("members").doc(command.createdBy),
    );
    try {
      check(
        root.id === "sanjose" &&
          membership.exists &&
          membership.data().active === true,
        "Acceso no autorizado.",
      );
      check(handlers[command.type], "Operación no reconocida.");
      const o = new Operation(tx, root, command, membership.data(), ref.id);
      const result = await handlers[command.type](o, command.payload);
      o.flush();
      tx.update(ref, {
        status: "confirmed",
        result,
        processedAt: new Date().toISOString(),
      });
    } catch (error) {
      if (
        !(error instanceof BusinessError) &&
        !(error instanceof TypeError) &&
        !(error instanceof RangeError)
      )
        throw error;
      tx.update(ref, {
        status: "rejected",
        error:
          error instanceof BusinessError
            ? error.message
            : "Datos incompletos o inválidos en la operación.",
        processedAt: new Date().toISOString(),
      });
    }
  });
}
module.exports = {
  processCommand,
  Operation,
  BusinessError,
  check,
  dayKey,
  round,
  handlers,
  isAdministrationRouteId,
  isSaleForDispatch,
};
async function adjustment(o, p) {
  o.admin();
  const loc = location("warehouse", p.warehouseId || "central");
  check(p.note?.trim(), "El motivo del ajuste es obligatorio.");
  const e = await o.loadStock(p.line.productId, loc);
  const q = o.amount(p.line.quantity, e.p, true);
  check(
    q < 0,
    "Los aumentos deben registrarse como ingreso con lote y fechas.",
  );
  const parts = await o.take(p.line.productId, loc, -q, {
    allowExpired: true,
    lotId: p.line.lotId,
  });
  o.ledger(p.line.productId, -q, loc, null, "adjustment", {
    allocations: parts,
    note: p.note,
    lossCost: parts.every((a) => a.productionCost !== null)
      ? round(parts.reduce((s, a) => s + a.quantity * a.productionCost, 0))
      : null,
  });
  return { id: o.id };
}
async function adjustmentRequest(o, p) {
  check(o.member.role === "warehouse", "Solo Almacén puede solicitar esta baja.");
  check(p.note?.trim(), "El motivo de la baja es obligatorio.");
  const warehouseId = p.warehouseId || o.member.warehouseId || "central";
  o.owns(location("warehouse", warehouseId));
  const product = await o.product(p.line.productId);
  const quantity = o.amount(p.line.quantity, product, true);
  check(quantity < 0, "La solicitud debe descontar una cantidad mayor a cero.");
  const request = {
    id: o.id,
    ...o.base(),
    productId: product.id,
    productName: product.name,
    unitType: product.unitType,
    quantity,
    warehouseId,
    lotId: p.line.lotId || "",
    note: p.note.trim(),
    requestedByUid: o.actor,
    requestedByName: o.member.displayName || o.actor,
    status: "pending",
  };
  o.put("distAdjustmentRequests", o.id, request);
  return request;
}
async function reviewAdjustmentRequest(o, p) {
  o.admin();
  const request = await o.read("distAdjustmentRequests", p.requestId);
  check(request?.status === "pending", "Esta solicitud ya fue revisada.");
  if (p.approve === true) {
    await adjustment(o, {
      warehouseId: request.warehouseId,
      note: `${request.note} (solicitado por ${request.requestedByName})`,
      line: { productId: request.productId, quantity: request.quantity, lotId: request.lotId || undefined },
    });
    request.status = "approved";
  } else {
    request.status = "rejected";
  }
  request.reviewedBy = o.actor;
  request.reviewedAt = o.now;
  o.put("distAdjustmentRequests", request.id, request);
  return request;
}
async function expense(o, p) {
  check(
    o.member.role === "admin" ||
      (o.member.role === "distributor" && p.routeId === o.member.routeId),
    "No puedes registrar gastos en esta ruta.",
  );
  const groups = Object.keys(expenseBuiltinGroups);
  const paymentMethods = ["cash", "transfer", "other"];
  check(Number.isFinite(p.amount) && p.amount > 0, "Revisa el monto.");
  check(!p.paymentMethod || paymentMethods.includes(p.paymentMethod), "La forma de pago no es válida.");
  check(!p.dayKey || validDate(p.dayKey), "La fecha del egreso no es válida.");
  let group;
  let categoryId;
  let category;
  let economicType;
  let classificationStatus;
  let classificationSource;
  let concept;
  if (typeof p.presetId === "string" && p.presetId.startsWith("group-category:")) {
    o.admin();
    categoryId = safeId(p.presetId.slice("group-category:".length));
    const selectedGroup = safeId(p.groupId);
    const groupConfig = await readExpenseGroupConfig(o, selectedGroup);
    check(groupConfig && groupConfig.active !== false, "El grupo ya no está activo. Actualiza la selección.");
    const saved = await o.read("distExpenseCategories", categoryId);
    const defaultIndex = Number(String(categoryId).split("-").at(-1)) - 1;
    const defaultName = String(categoryId).startsWith(`${selectedGroup}-`) ? expenseCategoryDefaults[selectedGroup]?.[defaultIndex] : undefined;
    check(saved ? saved.active === true && saved.group === selectedGroup && !(selectedGroup === "indirect" && retiredIndirectCommercializationCategoryIds.has(categoryId)) : Boolean(defaultName), "La categoría ya no está activa. Actualiza la selección.");
    check(!saved || saved.group === selectedGroup, "La categoría no pertenece al grupo seleccionado.");
    category = saved?.name || defaultName;
    check(category && groupConfig.economicType, "La configuración económica del grupo está incompleta.");
    check(groupConfig.economicType === "production_input" ? selectedGroup === "production_input" || selectedGroup.startsWith("custom-") : selectedGroup !== "production_input", "El grupo y su clasificación económica no coinciden.");
    p.groupName = groupConfig.name || groupConfig.label;
    group = selectedGroup;
    economicType = groupConfig.economicType;
    classificationStatus = "reviewed";
    classificationSource = "admin_review";
    concept = category;
  } else if (typeof p.presetId === "string" && p.presetId.startsWith("admin-category:")) {
    o.admin();
    const id = safeId(p.presetId.slice("admin-category:".length));
    const saved = await o.read("distExpenseCategories", id);
    const defaultIndex = Number(String(id).split("-").at(-1)) - 1;
    const defaultGroup = groups.find((candidate) => id.startsWith(`${candidate}-`));
    const defaultName = defaultGroup && expenseCategoryDefaults[defaultGroup]?.[defaultIndex];
    check(saved ? saved.active === true && !(saved.group === "indirect" && retiredIndirectCommercializationCategoryIds.has(id)) : Boolean(defaultName), "La categoría ya no está activa. Actualiza la selección.");
    group = saved?.group || defaultGroup;
    categoryId = id;
    category = saved?.name || defaultName;
    check(group && category, "La categoría seleccionada no es válida.");
    const groupConfig = await readExpenseGroupConfig(o, group);
    check(groupConfig && groupConfig.active !== false, "El grupo de esta categoría está inactivo.");
    economicType = groupConfig.economicType;
    p.groupName = groupConfig.name || groupConfig.label;
    classificationStatus = "reviewed";
    classificationSource = "admin_review";
    concept = category;
  } else if (typeof p.presetId === "string" && p.presetId.startsWith("category:")) {
    const id = safeId(p.presetId.slice("category:".length));
    const saved = await o.read("distExpenseCategories", id);
    check(saved?.active && saved.autoClassifiable === true && (o.member.role === "admin" || saved.distributorVisible === true), "Esta categoría no está habilitada para el registro automático.");
    const groupConfig = await readExpenseGroupConfig(o, saved.group);
    check(groupConfig && groupConfig.active !== false, "El grupo de la categoría no es válido.");
    group = saved.group;
    p.groupName = groupConfig.name || groupConfig.label;
    categoryId = id;
    category = saved.name;
    economicType = groupConfig.economicType;
    classificationStatus = "classified";
    classificationSource = "automatic";
    concept = category;
    if (o.member.role === "distributor") {
      check(p.group === undefined && p.categoryId === undefined && p.economicType === undefined && p.affectsOperatingResult === undefined, "La clasificación se determina desde la opción habilitada; no envíes una clasificación manual.");
    }
  } else if (typeof p.presetId === "string") {
    const preset = [...expensePresetRegistry.choices, ...expensePresetRegistry.production].find((item) => item.id === p.presetId);
    check(preset, "La opción de egreso no es válida. Actualiza la aplicación e inténtalo nuevamente.");
    if (o.member.role === "distributor") {
      check(p.group === undefined && p.categoryId === undefined && p.economicType === undefined && p.affectsOperatingResult === undefined, "La clasificación se determina desde la opción seleccionada; no envíes una clasificación manual.");
    }
    group = preset.group;
    const groupConfig = await readExpenseGroupConfig(o, group);
    check(groupConfig && groupConfig.active !== false, "El grupo de esta opción está inactivo.");
    categoryId = preset.categoryId;
    const saved = await o.read("distExpenseCategories", categoryId);
    check(!saved || (saved.active && saved.group === group), "La categoría ya no está activa. Actualiza la selección.");
    category = saved?.name || preset.categoryName;
    economicType = groupConfig.economicType;
    p.groupName = groupConfig.name || groupConfig.label;
    classificationStatus = preset.classificationStatus;
    classificationSource = preset.classificationSource;
    concept = preset.id === "other_unsure" ? "Otro" : preset.categoryName;
  } else if (o.member.role === "distributor") {
    // Accept already queued operations from older app versions without trusting their
    // implicit/default group. Keep the amount and payment, but send the entry to review.
    check(!["production_input"].includes(p.group) && [undefined, "operating_expense"].includes(p.economicType) && [undefined, true].includes(p.affectsOperatingResult), "El distribuidor no puede decidir manualmente el tratamiento económico del egreso.");
    group = "other";
    categoryId = "other-2";
    category = expenseCategoryDefaults.other[1];
    economicType = "operating_expense";
    classificationStatus = "pending_review";
    classificationSource = "legacy";
    concept = p.concept?.trim() || "Otro";
  } else {
    // Backward compatibility for older Administration clients. New UI always uses a preset.
    group = p.group || "other";
    const groupConfig = await readExpenseGroupConfig(o, group);
    check(groupConfig && groupConfig.active !== false, "El grupo del egreso no es válido.");
    economicType = p.economicType || (p.affectsOperatingResult === false ? "production_input" : "operating_expense");
    check(["operating_expense", "production_input"].includes(economicType), "El tipo de salida no es válido.");
    check(p.affectsOperatingResult === undefined || p.affectsOperatingResult === (economicType === "operating_expense"), "El tipo de salida y su tratamiento económico no coinciden.");
    check(groupConfig.economicType === economicType, "La clasificación económica no coincide con la configuración del grupo.");
    p.groupName = groupConfig.name || groupConfig.label;
    categoryId = p.categoryId ? safeId(p.categoryId) : "other-2";
    const saved = p.categoryId ? await o.read("distExpenseCategories", categoryId) : null;
    const defaultIndex = Number(String(categoryId).split("-").at(-1)) - 1;
    const defaultName = String(categoryId).startsWith(`${group}-`) ? expenseCategoryDefaults[group]?.[defaultIndex] : undefined;
    check(saved ? saved.group === group && saved.active : Boolean(defaultName), "La categoría ya no está activa. Actualiza la selección.");
    category = saved?.name || defaultName || expenseCategoryDefaults.other[1];
    classificationStatus = "reviewed";
    classificationSource = "admin_review";
    concept = p.concept?.trim();
  }
  check(concept && concept.length <= 120, "Revisa el detalle del egreso.");
  check(category.length <= 80, "La categoría es demasiado larga.");
  if (p.presetId === "other_unsure") check(String(p.note || "").trim().length > 0, "Explica qué se compró o pagó para que Administración pueda revisarlo.");
  const e = {
    id: o.id,
    ...o.base(),
    ...(p.dayKey ? { dayKey: p.dayKey } : {}),
    operationId: o.id,
    group,
    groupName: p.groupName || expenseBuiltinGroups[group]?.name || group,
    categoryId,
    categoryName: category,
    paymentMethod: p.paymentMethod || "cash",
    economicType,
    affectsOperatingResult: economicType === "operating_expense",
    classificationStatus,
    classificationSource,
    concept,
    amount: round(p.amount),
    routeId: p.routeId,
    routeName: p.routeName,
    registeredByUid: o.actor,
    registeredByName: o.member.displayName || o.actor,
    note: p.note || "",
    transactionKind: "expense",
    cashPaidAmount: (p.paymentMethod || "cash") === "cash" ? round(p.amount) : 0,
    transferPaidAmount: p.paymentMethod === "transfer" ? round(p.amount) : 0,
    otherPaidAmount: p.paymentMethod === "other" ? round(p.amount) : 0,
  };
  o.put("distExpenses", o.id, e);
  return e;
}

async function deleteExpense(o, p) {
  o.admin();
  check(String(p.reason || "").trim(), "Indica el motivo de anulación del egreso.");
  const expense = await o.read("distExpenses", p.expenseId);
  check(expense && !expense.voided, "El gasto ya no está activo.");
  check((expense.transactionKind || "expense") === "expense", "Las compras a proveedor y sus pagos requieren una corrección auditada de cuentas por pagar; no se anulan como un egreso común.");
  o.put("distExpenses", expense.id, {
    ...expense,
    voided: true,
    voidedAt: o.now,
    voidedBy: o.actor,
    voidedByName: o.member.displayName || o.actor,
    voidReason: String(p.reason || "Anulación administrativa").trim(),
  });
  return { id: expense.id, voided: true };
}

async function saveExpenseCategory(o, p) {
  o.admin();
  const id = safeId(p.categoryId);
  const name = String(p.name || "").trim();
  const groupConfig = await readExpenseGroupConfig(o, p.group);
  check(groupConfig && groupConfig.active !== false, "El grupo de la categoría no es válido o está inactivo.");
  check(name.length > 0 && name.length <= 60, "Escribe una categoría de hasta 60 caracteres.");
  const previous = await o.read("distExpenseCategories", id);
  if (previous && previous.group !== p.group) {
    const sourceGroup = await readExpenseGroupConfig(o, previous.group);
    check(sourceGroup?.economicType === groupConfig.economicType,
      "Mueve la categoría a un grupo con el mismo tratamiento económico. Los egresos históricos conservan su clasificación.");
  }
  const duplicate = await o.all("distExpenseCategories");
  const defaultNames = expenseCategoryDefaults[p.group] || [];
  const duplicateDefault = defaultNames.some((defaultName, index) => `${p.group}-${index + 1}` !== id && defaultName.trim().toLocaleLowerCase("es") === name.toLocaleLowerCase("es"));
  check(!duplicateDefault && !duplicate.some((row) => row.id !== id && row.group === p.group && row.name?.trim().toLocaleLowerCase("es") === name.toLocaleLowerCase("es")), "Ya existe una categoría con ese nombre en el grupo.");
  const category = {
    id, ...o.base(), group: p.group, name,
    active: p.active !== false,
    order: Number.isFinite(p.order) ? Math.max(0, Math.round(p.order)) : 999,
    autoClassifiable: p.autoClassifiable === true,
    distributorVisible: p.autoClassifiable === true && p.distributorVisible === true,
    ...(previous ? { createdAt: previous.createdAt, createdBy: previous.createdBy } : {}),
    updatedAt: o.now, updatedBy: o.actor,
  };
  o.put("distExpenseCategories", id, category);
  return category;
}

async function deleteExpenseCategory(o, p) {
  o.admin();
  const id = safeId(p.categoryId);
  const category = await o.read("distExpenseCategories", id);
  check(category, "La categoría no existe o ya fue eliminada.");
  const isBuiltIn = Object.entries(expenseCategoryDefaults).some(([group, names]) =>
    names.some((_, index) => `${group}-${index + 1}` === id));
  check(!isBuiltIn, "Las categorías iniciales se pueden desactivar, pero no borrar para conservar compatibilidad histórica.");
  const [expenses, payables] = await Promise.all([
    o.query("distExpenses", "categoryId", id),
    o.query("distPayables", "categoryId", id),
  ]);
  check(expenses.length === 0 && payables.length === 0,
    "La categoría tiene egresos o compras asociados. Desactívala o muévela para conservar el historial.");
  o.remove("distExpenseCategories", id);
  return { id, deleted: true };
}

async function saveExpenseGroup(o, p) {
  o.admin();
  const id = safeId(p.groupId);
  const name = String(p.name || "").trim();
  check(name.length > 0 && name.length <= 60, "Escribe un nombre de grupo de hasta 60 caracteres.");
  check(["operating_expense", "production_input"].includes(p.economicType), "Selecciona la clasificación económica del grupo.");
  const builtin = expenseBuiltinGroups[id];
  check(!builtin || p.economicType === builtin.economicType, "La clasificación de un grupo inicial no se puede cambiar.");
  const previous = await o.read("distExpenseGroups", id);
  const otherGroups = await o.all("distExpenseGroups");
  const configuredNames = Object.entries(expenseBuiltinGroups).map(([builtinId, config]) => ({
    id: builtinId,
    name: otherGroups.find((row) => row.id === builtinId)?.name || config.name,
  }));
  const duplicateBuiltin = configuredNames.some((row) => row.id !== id && row.name.trim().toLocaleLowerCase("es") === name.toLocaleLowerCase("es"));
  check(!duplicateBuiltin && !otherGroups.some((row) => row.id !== id && !Object.hasOwn(expenseBuiltinGroups, row.id) && row.name?.trim().toLocaleLowerCase("es") === name.toLocaleLowerCase("es")), "Ya existe un grupo con ese nombre.");
  if (previous && previous.economicType !== p.economicType) {
    const [expenses, categories] = await Promise.all([o.query("distExpenses", "group", id), o.query("distExpenseCategories", "group", id)]);
    check(expenses.length === 0 && categories.length === 0, "No se puede cambiar la clasificación económica de un grupo que ya tiene historial.");
  }
  const group = {
    id, ...o.base(), name, economicType: builtin?.economicType || p.economicType,
    active: p.active !== false,
    order: Number.isFinite(p.order) ? Math.max(0, Math.round(p.order)) : 999,
    ...(previous ? { createdAt: previous.createdAt, createdBy: previous.createdBy } : {}),
    updatedAt: o.now, updatedBy: o.actor,
  };
  o.put("distExpenseGroups", id, group);
  return group;
}

async function deleteExpenseGroup(o, p) {
  o.admin();
  const id = safeId(p.groupId);
  check(!Object.hasOwn(expenseBuiltinGroups, id),
    "Los grupos iniciales se pueden desactivar, pero no borrar para conservar compatibilidad histórica.");
  const group = await o.read("distExpenseGroups", id);
  check(group, "El grupo no existe o ya fue eliminado.");
  const [expenses, payables, categories] = await Promise.all([
    o.query("distExpenses", "group", id),
    o.query("distPayables", "groupId", id),
    o.query("distExpenseCategories", "group", id),
  ]);
  check(expenses.length === 0 && payables.length === 0 && categories.length === 0,
    "El grupo aún tiene categorías o historial. Desactívalo o traslada sus categorías antes de eliminarlo.");
  o.remove("distExpenseGroups", id);
  return { id, deleted: true };
}

async function saveExpenseSupplier(o, p) {
  o.admin();
  const id = safeId(p.supplierId);
  const name = String(p.name || "").trim();
  check(name.length > 0 && name.length <= 100, "Escribe el nombre del proveedor.");
  const previous = await o.read("distSuppliers", id);
  const all = await o.all("distSuppliers");
  check(!all.some((item) => item.id !== id && item.name?.trim().toLocaleLowerCase("es") === name.toLocaleLowerCase("es")), "Ya existe un proveedor con ese nombre.");
  const supplier = { id, ...o.base(), name, active: p.active !== false, contactName: String(p.contactName || "").trim(), phone: String(p.phone || "").trim(), note: String(p.note || "").trim(), ...(previous ? { createdAt: previous.createdAt, createdBy: previous.createdBy } : {}), updatedAt: o.now, updatedBy: o.actor };
  o.put("distSuppliers", id, supplier);
  return supplier;
}

async function registerSupplierPurchase(o, p) {
  o.admin();
  const supplier = await o.read("distSuppliers", safeId(p.supplierId));
  check(supplier?.active === true, "Selecciona un proveedor activo.");
  const total = round(p.amount);
  const paid = round(p.initialPayment || 0);
  check(Number.isFinite(total) && total > 0, "Revisa el monto de compra.");
  let purchaseLines;
  if (p.purchaseLines !== undefined) {
    const allowedUnits = ["kg", "g", "unit", "box", "sack", "liter", "other"];
    check(Array.isArray(p.purchaseLines) && p.purchaseLines.length > 0 && p.purchaseLines.length <= 50,
      "Agrega entre 1 y 50 artículos a la compra.");
    purchaseLines = p.purchaseLines.map((line) => {
      const description = String(line?.description || "").trim();
      const quantity = Number(line?.quantity);
      const unitPrice = round(line?.unitPrice);
      const wasteQuantity = Number(line?.wasteQuantity || 0);
      check(description.length > 0 && description.length <= 120, "Cada artículo necesita una descripción.");
      check(allowedUnits.includes(line?.unit), "Selecciona una unidad válida para cada artículo.");
      check(Number.isFinite(quantity) && quantity > 0 && Number.isFinite(unitPrice) && unitPrice >= 0,
        "La cantidad y el precio unitario deben ser válidos.");
      check(Number.isFinite(wasteQuantity) && wasteQuantity >= 0 && wasteQuantity <= quantity,
        "La merma física debe estar entre cero y la cantidad comprada.");
      const unitLabel = String(line?.unitLabel || "").trim();
      check(line.unit !== "other" || unitLabel.length > 0, "Describe la unidad de medida seleccionada como otra.");
      const lineTotal = round(quantity * unitPrice);
      check(Number.isFinite(Number(line?.total)) && round(line.total) === lineTotal,
        "El total de una línea no coincide con cantidad por precio unitario.");
      check(Number.isFinite(Number(line?.netUsableQuantity)) && roundAt(line.netUsableQuantity, 3) === roundAt(quantity - wasteQuantity, 3),
        "La cantidad neta debe ser igual a la cantidad comprada menos la merma.");
      return {
        description, quantity: roundAt(quantity, 3), unit: line.unit,
        ...(line.unit === "other" ? { unitLabel } : {}), unitPrice, total: lineTotal,
        wasteQuantity: roundAt(wasteQuantity, 3), netUsableQuantity: roundAt(quantity - wasteQuantity, 3),
        ...(String(line.note || "").trim() ? { note: String(line.note).trim().slice(0, 300) } : {}),
      };
    });
    check(round(purchaseLines.reduce((sum, line) => sum + line.total, 0)) === total,
      "El monto de compra debe coincidir con la suma de los artículos.");
  }
  check(Number.isFinite(paid) && paid >= 0 && paid <= total, "El adelanto debe estar entre cero y el total de compra.");
  check(validDate(p.dayKey), "La fecha de compra no es válida.");
  check(!p.dueDayKey || (validDate(p.dueDayKey) && p.dueDayKey >= p.dayKey), "La fecha de vencimiento no es válida.");
  const groupId = safeId(p.groupId), categoryId = safeId(p.categoryId);
  const group = await readExpenseGroupConfig(o, groupId);
  check(group && group.active !== false && group.economicType === "production_input", "Las cuentas por pagar solo se registran en grupos clasificados como compras para producción.");
  const category = await o.read("distExpenseCategories", categoryId);
  const index = Number(String(categoryId).split("-").at(-1)) - 1;
  const defaultName = String(categoryId).startsWith(`${groupId}-`) ? expenseCategoryDefaults[groupId]?.[index] : undefined;
  check(category ? category.active === true && category.group === groupId : Boolean(defaultName), "Selecciona una categoría activa del grupo.");
  const detail = String(p.description || purchaseLines?.map((line) => line.description).join(", ") || "").trim();
  check(detail.length > 0 && detail.length <= 200, "Describe brevemente la materia prima comprada.");
  const method = paid === 0 ? "credit" : paid === total ? p.paymentMethod : "mixed";
  check(paid === 0 || ["cash", "transfer", "other"].includes(p.paymentMethod), "Selecciona la forma de pago del adelanto.");
  const categoryName = category?.name || defaultName;
  const expense = {
    id: o.id, ...o.base(), dayKey: p.dayKey, operationId: o.id, transactionKind: "supplier_purchase",
    group: groupId, groupName: group.name || group.label || groupId, categoryId, categoryName,
    economicType: "production_input", affectsOperatingResult: false, classificationStatus: "reviewed", classificationSource: "admin_review",
    concept: detail, amount: total, paymentMethod: method,
    cashPaidAmount: p.paymentMethod === "cash" ? paid : 0, transferPaidAmount: p.paymentMethod === "transfer" ? paid : 0, otherPaidAmount: p.paymentMethod === "other" ? paid : 0, initialPaymentMethod: p.paymentMethod,
    routeId: "administracion", routeName: "Administración", registeredByUid: o.actor, registeredByName: o.member.displayName || o.actor,
    supplierId: supplier.id, supplierName: supplier.name, note: String(p.note || "").trim(),
    ...(purchaseLines ? { purchaseLines } : {}),
  };
  const balance = round(total - paid);
  const payable = {
    id: o.id, ...o.base(), supplierId: supplier.id, supplierName: supplier.name, purchaseExpenseId: o.id,
    dayKey: p.dayKey, description: detail, groupId, groupName: expense.groupName, categoryId, categoryName,
    totalAmount: total, paidAmount: paid, balance, status: balance === 0 ? "paid" : paid > 0 ? "partial" : "pending",
    ...(p.dueDayKey ? { dueDayKey: p.dueDayKey } : {}), note: String(p.note || "").trim(), ...(purchaseLines ? { purchaseLines } : {}), routeId: "administracion", routeName: "Administración",
  };
  o.put("distExpenses", expense.id, expense);
  o.put("distPayables", payable.id, payable);
  if (paid > 0) o.put("distSupplierPayments", `${o.id}__initial`, {
    id: `${o.id}__initial`, ...o.base(), payableId: o.id, supplierId: supplier.id, supplierName: supplier.name, amount: paid,
    paymentMethod: p.paymentMethod, dayKey: p.dayKey, routeId: "administracion", routeName: "Administración",
    responsibleUid: o.actor, responsibleName: o.member.displayName || o.actor, note: "Pago inicial de la compra",
  });
  return { expense, payable };
}

async function paySupplierPayable(o, p) {
  o.admin();
  const payable = await o.read("distPayables", safeId(p.payableId));
  check(payable && payable.status !== "voided", "La cuenta por pagar no está disponible.");
  const amount = round(p.amount);
  check(Number.isFinite(amount) && amount > 0, "Ingresa un abono mayor que cero.");
  check(["cash", "transfer", "other"].includes(p.paymentMethod), "Selecciona la forma de pago.");
  check(validDate(p.dayKey), "La fecha del pago no es válida.");
  check(amount <= payable.balance, "El pago supera el saldo pendiente.");
  const nextBalance = round(payable.balance - amount);
  const nextPaid = round(payable.paidAmount + amount);
  const paymentId = `${o.id}__payment`;
  const payment = {
    id: paymentId, ...o.base(), payableId: payable.id, supplierId: payable.supplierId, supplierName: payable.supplierName,
    amount, paymentMethod: p.paymentMethod, dayKey: p.dayKey, routeId: "administracion", routeName: "Administración",
    responsibleUid: o.actor, responsibleName: o.member.displayName || o.actor, note: String(p.note || "").trim(),
  };
  const expense = {
    id: paymentId, ...o.base(), dayKey: p.dayKey, operationId: o.id, transactionKind: "supplier_payment",
    group: payable.groupId, groupName: payable.groupName, categoryId: payable.categoryId, categoryName: payable.categoryName,
    economicType: "production_input", affectsOperatingResult: false, classificationStatus: "reviewed", classificationSource: "admin_review",
    concept: `Pago a proveedor: ${payable.supplierName}`, amount, paymentMethod: p.paymentMethod,
    cashPaidAmount: p.paymentMethod === "cash" ? amount : 0, transferPaidAmount: p.paymentMethod === "transfer" ? amount : 0, otherPaidAmount: p.paymentMethod === "other" ? amount : 0,
    payableId: payable.id, supplierId: payable.supplierId, supplierName: payable.supplierName,
    routeId: "administracion", routeName: "Administración", registeredByUid: o.actor, registeredByName: o.member.displayName || o.actor, note: String(p.note || "").trim(),
  };
  const updatedPayable = { ...payable, paidAmount: nextPaid, balance: nextBalance, status: nextBalance === 0 ? "paid" : "partial", updatedAt: o.now, updatedBy: o.actor };
  o.put("distSupplierPayments", paymentId, payment);
  o.put("distExpenses", paymentId, expense);
  o.put("distPayables", payable.id, updatedPayable);
  return { payment, payable: updatedPayable };
}

async function voidSupplierPayment(o, p) {
  o.admin();
  const reason = String(p.reason || "").trim();
  check(reason.length > 0 && reason.length <= 300, "Indica el motivo de la corrección del pago.");
  const payment = await o.read("distSupplierPayments", safeId(p.paymentId));
  check(payment && !payment.voided, "El pago ya fue corregido o anulado.");
  const payable = await o.read("distPayables", safeId(payment.payableId));
  check(payable && payable.status !== "voided", "La cuenta por pagar no está disponible.");
  const amount = round(payment.amount);
  check(amount > 0 && amount <= payable.paidAmount, "El pago no coincide con el saldo contabilizado de la cuenta.");
  const paidAmount = round(payable.paidAmount - amount);
  const balance = round(payable.totalAmount - paidAmount);
  const status = paidAmount === 0 ? "pending" : balance === 0 ? "paid" : "partial";
  const correctedPayment = { ...payment, voided: true, voidedAt: o.now, voidedBy: o.actor, voidedByName: o.member.displayName || o.actor, voidReason: reason };
  o.put("distSupplierPayments", payment.id, correctedPayment);

  let affectedExpenseId = payment.id;
  if (payment.id.endsWith("__initial")) {
    affectedExpenseId = payable.purchaseExpenseId;
    const purchase = await o.read("distExpenses", affectedExpenseId);
    check(purchase?.transactionKind === "supplier_purchase" && !purchase.voided, "No se puede corregir el adelanto porque su compra original no está disponible.");
    const cashPaidAmount = round(Math.max(0, Number(purchase.cashPaidAmount || 0) - (payment.paymentMethod === "cash" ? amount : 0)));
    const transferPaidAmount = round(Math.max(0, Number(purchase.transferPaidAmount || 0) - (payment.paymentMethod === "transfer" ? amount : 0)));
    const otherPaidAmount = round(Math.max(0, Number(purchase.otherPaidAmount || 0) - (payment.paymentMethod === "other" ? amount : 0)));
    const paidByMethod = [cashPaidAmount, transferPaidAmount, otherPaidAmount].filter(value => value > 0).length;
    const initialPaymentMethod = paidByMethod > 1 ? "mixed" : cashPaidAmount > 0 ? "cash" : transferPaidAmount > 0 ? "transfer" : otherPaidAmount > 0 ? "other" : "credit";
    o.put("distExpenses", purchase.id, { ...purchase, cashPaidAmount, transferPaidAmount, otherPaidAmount, initialPaymentMethod, paymentMethod: initialPaymentMethod, updatedAt: o.now, updatedBy: o.actor });
  } else {
    const expense = await o.read("distExpenses", payment.id);
    check(expense?.transactionKind === "supplier_payment" && !expense.voided, "No se puede corregir el pago porque su movimiento financiero no está disponible.");
    o.put("distExpenses", expense.id, { ...expense, voided: true, voidedAt: o.now, voidedBy: o.actor, voidedByName: o.member.displayName || o.actor, voidReason: reason, updatedAt: o.now, updatedBy: o.actor });
  }
  const updatedPayable = { ...payable, paidAmount, balance, status, updatedAt: o.now, updatedBy: o.actor, history: [...(payable.history || []), { action: "payment_voided", paymentId: payment.id, amount, paymentMethod: payment.paymentMethod, reason, at: o.now, by: o.actor, byName: o.member.displayName || o.actor, affectedExpenseId }].slice(-100) };
  o.put("distPayables", payable.id, updatedPayable);
  return { payment: correctedPayment, payable: updatedPayable };
}

async function voidSupplierPurchase(o, p) {
  o.admin();
  const reason = String(p.reason || "").trim();
  check(reason.length > 0 && reason.length <= 300, "Indica el motivo de anulación de la compra.");
  const payable = await o.read("distPayables", safeId(p.payableId));
  check(payable && payable.status !== "voided", "La cuenta por pagar ya fue anulada o no existe.");
  check(payable.paidAmount === 0, "Anula primero los pagos con una corrección auditada antes de anular la compra.");
  const payments = await o.query("distSupplierPayments", "payableId", payable.id);
  check(payments.every(payment => payment.voided === true), "La compra conserva pagos sin corregir.");
  const expense = await o.read("distExpenses", payable.purchaseExpenseId);
  check(expense?.transactionKind === "supplier_purchase" && !expense.voided, "La compra original ya no está activa.");
  o.put("distExpenses", expense.id, { ...expense, voided: true, voidedAt: o.now, voidedBy: o.actor, voidedByName: o.member.displayName || o.actor, voidReason: reason, updatedAt: o.now, updatedBy: o.actor });
  const updatedPayable = { ...payable, status: "voided", paidAmount: 0, balance: 0, voidedAt: o.now, voidedBy: o.actor, voidedByName: o.member.displayName || o.actor, voidReason: reason, updatedAt: o.now, updatedBy: o.actor, history: [...(payable.history || []), { action: "purchase_voided", reason, at: o.now, by: o.actor, byName: o.member.displayName || o.actor }].slice(-100) };
  o.put("distPayables", payable.id, updatedPayable);
  return updatedPayable;
}

async function classifyExpense(o, p) {
  o.admin();
  const expense = await o.read("distExpenses", safeId(p.expenseId));
  check(expense && !expense.voided, "El egreso ya no está activo.");
  check((expense.transactionKind || "expense") === "expense", "Las compras a proveedor y sus pagos conservan la clasificación de su cuenta por pagar.");
  const groupConfig = await readExpenseGroupConfig(o, p.group);
  check(groupConfig && groupConfig.active !== false, "El grupo del egreso no es válido.");
  const categoryId = safeId(p.categoryId);
  const category = await o.read("distExpenseCategories", categoryId);
  const index = Number(String(categoryId).split("-").at(-1)) - 1;
  const defaultName = String(categoryId).startsWith(`${p.group}-`) ? expenseCategoryDefaults[p.group]?.[index] : undefined;
  check(category ? category.active && category.group === p.group : Boolean(defaultName), "La categoría ya no está activa.");
  const economicType = p.economicType || (p.affectsOperatingResult === false ? "production_input" : p.affectsOperatingResult === true ? "operating_expense" : undefined);
  check(["operating_expense", "production_input"].includes(economicType), "Selecciona el tipo de salida.");
  check(p.affectsOperatingResult === undefined || typeof p.affectsOperatingResult === "boolean", "La decisión económica del egreso no es válida.");
  check(p.affectsOperatingResult === undefined || p.affectsOperatingResult === (economicType === "operating_expense"), "El tipo de salida y su tratamiento económico no coinciden.");
  check(economicType === groupConfig.economicType, "La clasificación económica no coincide con la configuración del grupo.");
  const affectsOperatingResult = economicType === "operating_expense";
  const previous = {
    group: expense.group || "other",
    categoryId: expense.categoryId || "",
    categoryName: expense.categoryName || "Por clasificar",
    // Older expenses predate these fields. Firestore rejects `undefined` even
    // when it appears inside the operation result, so record absence explicitly.
    economicType: expense.economicType ?? null,
    affectsOperatingResult: expense.affectsOperatingResult ?? null,
    classificationStatus: expense.classificationStatus ?? null,
    classificationSource: expense.classificationSource ?? null,
  };
  const next = { group: p.group, groupName: groupConfig.name || groupConfig.label || p.group, categoryId, categoryName: category?.name || defaultName, economicType, affectsOperatingResult, classificationStatus: "reviewed", classificationSource: "admin_review" };
  const history = [...(expense.classificationHistory || []), { at: o.now, by: o.actor, byName: o.member.displayName || o.actor, previous, next }].slice(-20);
  const updated = { ...expense, ...next, classificationHistory: history, updatedAt: o.now, updatedBy: o.actor };
  o.put("distExpenses", expense.id, updated);
  return updated;
}

async function deleteProduct(o, p) {
  o.admin();
  const product = await o.read("distProducts", p.productId);
  check(product && !product.deleted, "El producto ya no está disponible.");
  const balances = await o.query("distBalances", "productId", product.id);
  check(
    !balances.some((balance) => Number(balance.quantity || 0) > 0),
    "El producto todavía tiene existencias. Déjalo en cero antes de eliminarlo.",
  );
  const dispatches = await o.query("distDispatches", "status", "open");
  check(
    !dispatches.some((dispatch) =>
      [...(dispatch.lines || []), ...(dispatch.additions || []).flatMap((addition) => addition.quantityByProduct || [])]
        .some((line) => line.productId === product.id),
    ),
    "El producto forma parte de un despacho abierto. Cierra la ruta antes de eliminarlo.",
  );
  o.put("distProducts", product.id, {
    ...product,
    active: false,
    deleted: true,
    deletedAt: o.now,
    deletedBy: o.actor,
    deletedByName: o.member.displayName || o.actor,
  });
  return { id: product.id, deleted: true };
}
async function closure(o, p) {
  if (p.mode === "declaration") {
    const d = await o.read("distDispatches", p.dispatchId);
    check(d?.status === "open", "La ruta ya no está abierta para declarar el retorno.");
    check(o.member.role === "distributor" && d.distributorUid === o.actor,
      "Solo el distribuidor asignado puede declarar el retorno de esta ruta.");
    check(Object.keys(p).every((key) => ["mode", "dispatchId", "declaredReturns", "declaredReturnMermas", "physicalCashDeclared"].includes(key)),
      "La declaración solo admite cantidades normales y efectivo; almacén registra la merma.");
    const id = `closure_${d.id}`;
    const previous = (await o.read("distClosures", id)) || {};
    check(!previous.returnDeclaredAt && !previous.warehouseClosedBy,
      "La devolución ya fue declarada o confirmada por almacén.");
    const declaredReturns = p.declaredReturns;
    const declaredReturnMermas = p.declaredReturnMermas || {};
    check(declaredReturns && typeof declaredReturns === "object" && !Array.isArray(declaredReturns),
      "Falta la declaración del retorno normal.");
    check(declaredReturnMermas && typeof declaredReturnMermas === "object" && !Array.isArray(declaredReturnMermas)
      && Object.keys(declaredReturnMermas).length === 0,
      "El distribuidor declara solo el retorno normal; almacén registra la merma.");
    const loaded = getDispatchLoadedMap(d);
    const zeroDeclaredReturnMermas = Object.fromEntries([...loaded.keys()].map((pid) => [pid, 0]));
    check(Object.keys(declaredReturns).length === loaded.size && [...loaded.keys()].every((pid) => Object.prototype.hasOwnProperty.call(declaredReturns, pid)),
      "Declara el retorno de todos los productos de la ruta.");
    for (const [pid, quantity] of Object.entries(declaredReturns)) {
      const product = await o.product(pid);
      check(Number.isFinite(quantity) && quantity >= 0, "El retorno normal debe ser una cantidad válida y no negativa.");
      check(product.unitType === "kg" || Number.isInteger(quantity), "Paquetes y unidades requieren cantidades enteras.");
    }
    for (const [pid, quantity] of Object.entries(declaredReturnMermas)) {
      const product = await o.product(pid);
      check(Number.isFinite(quantity) && quantity >= 0, "La merma de retorno debe ser una cantidad válida y no negativa.");
      check(product.unitType === "kg" || quantity === 0, "La merma de retorno solo aplica a productos por kg.");
    }
    if (p.physicalCashDeclared !== undefined) check(Number.isFinite(p.physicalCashDeclared) && p.physicalCashDeclared >= 0,
      "El efectivo físico declarado debe ser mayor o igual a cero.");
    const now = o.now;
    const c = {
      ...previous,
      id,
      ...o.base(),
      dispatchId: d.id,
      routeId: d.routeId,
      distributorUid: d.distributorUid,
      distributorName: d.distributorName,
      declaredReturns,
      declaredReturnMermas: zeroDeclaredReturnMermas,
      returnDeclarationMode: "normal_only",
      returnDeclaredBy: o.actor,
      returnDeclaredAt: now,
      dayKey: d.dayKey,
      ...(p.physicalCashDeclared !== undefined ? { physicalCashDeclared: round(p.physicalCashDeclared), cashDeclaredBy: o.actor, cashDeclaredAt: now } : {}),
    };
    o.put("distClosures", id, c);
    return c;
  }
  const requested = p.closure;
  if (requested.closureType === "admin") {
    o.admin();
    check(
      Number.isFinite(requested.physicalCashDeclared) &&
        requested.physicalCashDeclared >= 0,
      "Efectivo declarado inválido.",
    );
    const dayKey = requested.dayKey || o.today;
    const id = requested.id || `closure_admin_${dayKey}_${o.id}`;

    const rawSales = (await o.query("distSales", "dayKey", dayKey))
      .filter((s) => isAdministrationRouteId(s.routeId) || (!s.routeId && s.sourceLocation === "centralWarehouse"))
    const sales = rawSales.map((sale) => (sale.effectiveSnapshot ? { ...sale, ...sale.effectiveSnapshot } : sale));

    const collections = (await o.query("distCollections", "dayKey", dayKey))
      .filter((x) => isAdministrationRouteId(x.routeId) || x.collectedByUid === o.actor);

    const expenses = (await o.query("distExpenses", "dayKey", dayKey))
      .filter((x) => (isAdministrationRouteId(x.routeId) || !x.routeId) && !x.voided);

    const claims = (await o.query("distClaims", "dayKey", dayKey))
      .filter((x) => isAdministrationRouteId(x.routeId) || x.isDerivedSaleVoid === true);

    const sum = (list, key) => round(list.reduce((n, r) => n + (r[key] || 0), 0));
    const commercialSales = sales.filter((s) => s.saleKind !== "courtesy");
    const voidedReceipts = await Promise.all(rawSales.filter((sale) => sale.voidedAt && sale.derivedVoid && sale.saleKind !== "courtesy")
      .map((sale) => voidedSaleReceiptAmounts(o, sale)));
    const voidedCashReceipts = round(voidedReceipts.reduce((total, row) => total + row.cash, 0));
    const voidedQrReceipts = round(voidedReceipts.reduce((total, row) => total + row.qr, 0));
    const cashSales = sum(commercialSales, "cashAmount"),
      cashCollections = round(collections.reduce((n, x) => n + (Number.isFinite(x.cashAmount) ? x.cashAmount : x.method === "cash" ? x.amount : 0), 0)),
      cashExpenses = round(expenses.filter((expense) => !expense.voided).reduce((total, expense) => total + (Number.isFinite(expense.cashPaidAmount) ? Math.max(0, expense.cashPaidAmount) : (expense.paymentMethod || "cash") === "cash" ? (expense.amount || 0) : 0), 0)),
      claimCash = settledClaimCash(claims),
      claimQr = settledClaimQr(claims),
      expectedCash = round(
        cashSales + voidedCashReceipts + cashCollections - cashExpenses + claimCash,
      );

    const c = {
      id,
      ...o.base(),
      dayKey,
      closureType: "admin",
      dispatchId: requested.dispatchId || `admin_${dayKey}`,
      routeId: "admin",
      routeName: "Administración",
      distributorUid: o.actor,
      distributorName: o.member.displayName || "Administración",
      status: "closed",
      products: [],
      cashSales,
      qrSales: sum(commercialSales, "qrAmount"),
      creditGenerated: sum(commercialSales, "creditAmount"),
      cashCollections,
      qrCollections: round(collections.reduce((n, x) => n + (Number.isFinite(x.qrAmount) ? x.qrAmount : x.method === "qr" ? x.amount : 0), 0)),
      cashExpenses,
      voidedCashReceipts,
      voidedQrReceipts,
      claimCash,
      claimQr,
      expectedCash,
      physicalCashDeclared: round(requested.physicalCashDeclared),
      cashDifference: round(requested.physicalCashDeclared - expectedCash),
      closedBy: o.actor,
      closedByName: o.member.displayName || o.actor,
      closedAt: o.now,
      note: requested.note || "",
    };
    o.put("distClosures", id, c);
    return c;
  }

  const d = await o.read("distDispatches", requested.dispatchId);
  check(d?.status === "open", "La ruta ya está cerrada.");
  const id = `closure_${d.id}`,
    previous = (await o.read("distClosures", id)) || {};
  const route = location("route", d.routeId),
    warehouse = location("warehouse", d.warehouseId || "central");
  const [dispatchSales, routeSales] = await Promise.all([
    o.query("distSales", "dispatchId", d.id),
    o.query("distSales", "routeId", d.routeId),
  ]);
  const [routeDispatchRows, routeClosures] = await Promise.all([
    o.query("distDispatches", "routeId", d.routeId),
    o.query("distClosures", "routeId", d.routeId),
  ]);
  const closureByDispatchId = new Map(routeClosures.filter((row) => row.dispatchId).map((row) => [row.dispatchId, row]));
  const routeDispatches = routeDispatchRows.map((dispatch) => {
    const closure = closureByDispatchId.get(dispatch.id);
    return { ...dispatch, reopenHistory: dispatch.reopenHistory || closure?.reopenHistory || [] };
  });
  const eligibleSales = [];
  const settlementSales = [];
  const ambiguousLegacySales = [];
  for (const sale of [...new Map([...dispatchSales, ...routeSales].map((row) => [row.id, row])).values()]) {
    if (!isSaleForDispatch(sale, d.routeId)) continue;
    const effective = !sale.voidedAt && !sale.pendingConfirmation;
    if (sale.dispatchId === d.id) {
      settlementSales.push(sale);
      if (effective) eligibleSales.push(sale);
      continue;
    }
    if (sale.dispatchId || sale.routeId !== d.routeId) continue;
    if (o.member.role === "distributor" && sale.sellerUid !== d.distributorUid) continue;
    // Anulado o pendiente no afecta las cantidades efectivas ni bloquea el
    // cierre por una atribución histórica ambigua. Sus documentos quedan para
    // auditoría; los reembolsos vinculados se incluyen solo si el despacho se
    // puede atribuir sin ambigüedad.
    if (!effective && !sale.createdAt) continue;
    if (!sale.createdAt || !Number.isFinite(Date.parse(sale.createdAt))) {
      if (effective) ambiguousLegacySales.push(sale);
      continue;
    }
    const saleAt = Date.parse(sale.createdAt);
    const possibleDispatches = routeDispatches.filter((dispatch) =>
      (o.member.role !== "distributor" || dispatch.distributorUid === d.distributorUid)
      && dispatchMayContainSaleAt(dispatch, saleAt));
    if (possibleDispatches.length === 1 && possibleDispatches[0].id === d.id) {
      settlementSales.push(sale);
      if (effective) eligibleSales.push(sale);
    } else if (effective && possibleDispatches.length > 1 && possibleDispatches.some((dispatch) => dispatch.id === d.id)) {
      ambiguousLegacySales.push(sale);
    }
  }
  check(ambiguousLegacySales.length === 0,
    `Hay ventas históricas de esta ruta sin despacho vinculado que no se pueden atribuir con seguridad a un solo despacho (${ambiguousLegacySales.map(sale => sale.id).join(", ")}). Deben conciliarse antes de confirmar el cierre.`);
  const sales = eligibleSales.map((sale) => sale.effectiveSnapshot ? { ...sale, ...sale.effectiveSnapshot } : sale);
  const dispatchSaleIds = new Set(settlementSales.map(sale => sale.id));
  const routeClaims = p.mode === 'warehouse'
    ? (await o.query('distClaims', 'routeId', d.routeId)).filter(claim => dispatchSaleIds.has(claim.saleId))
    : [];
  const derivedClaimQuarantineReceipts = [];
  if (p.mode === "warehouse") {
    o.owns(warehouse);
    check(!previous.warehouseClosedBy, "El retorno ya se confirmó.");
    const activeDispatchLines = [
      ...d.lines,
      ...(d.additions || []).filter((addition) => !addition.voided && !addition.voidedAt)
        .flatMap((addition) => addition.quantityByProduct || []),
    ];
    const activeSales = sales.filter((sale) => !sale.voidedAt && !sale.pendingConfirmation);
    const ids = [
      ...new Set(
        activeDispatchLines.map((line) => line.productId),
      ),
    ];
    const rows = [];
    for (const pid of ids) {
      const e = await o.loadStock(pid, route);
      await o.loadStock(pid, warehouse);
      for (const claim of routeClaims.filter(row => row.productId === pid && Array.isArray(row.returnedProcessingAllocations))) {
        const receivedLocation = claim.receivedLocation || (claim.warehouseId === '' ? route : location('warehouse', claim.warehouseId || 'central'));
        if (receivedLocation !== route) continue;
        check(claim.physicalReceiptConfirmed === true && claim.kind === 'return' || claim.physicalReceiptConfirmed === true && claim.kind === 'exchange',
          `El reclamo ${claim.id} no conserva una recepción física verificable; no se cerró la ruta.`);
        const groups = claim.returnedProcessingAllocations;
        check(groups.length > 0 && groups.every(group => group.lotId && group.reservationId && Number.isSafeInteger(group.quantity) && group.quantity > 0 && Array.isArray(group.allocations) && group.allocations.length > 0),
          `El reclamo ${claim.id} no conserva lotes, reservas y asignaciones completos; no se cerró la ruta.`);
        check(groups.reduce((sum, group) => sum + group.quantity, 0) === claim.quantity,
          `Las asignaciones en cuarentena del reclamo ${claim.id} no concilian con su cantidad.`);
        const receiptRows = [];
        for (const group of groups) {
          receiptRows.push(await moveDerivedReturnQuarantine(o, e, {
            lotId: group.lotId, reservationId: group.reservationId, claimId: claim.id,
            quantity: group.quantity, allocations: group.allocations, from: route, to: warehouse,
            dispatchId: d.id, sourceSaleId: claim.saleId,
          }));
        }
        const movementIds = receiptRows.map(row => row.movementId);
        o.put('distClaims', claim.id, { ...claim, quarantineTransferredAt: o.now, quarantineTransferredBy: o.actor,
          quarantineTransferredByName: o.member.displayName || o.actor, quarantineTransferredTo: warehouse,
          quarantineTransferMovementIds: movementIds });
        derivedClaimQuarantineReceipts.push(...receiptRows);
      }
      const expected = e.balances.get(route).quantity;
      const returnRow = requested.products?.find((r) => r.productId === pid);
      const previousProduct = previous.products?.find((row) => row.productId === pid);
      const actualRaw = Number(returnRow?.actualReturn);
      const wasteRaw = Number(returnRow?.returnWaste || 0);
      const damagedPackageRaw = Number(returnRow?.damagedPackageQuantity || 0);
      const hasRecoverableMerma = Object.prototype.hasOwnProperty.call(returnRow || {}, "returnMerma");
      const precision = hasRecoverableMerma && e.p.unitType === "kg" ? 3 : 2;
      const quantityRound = (value) => roundAt(value, precision);
      const actual = Number.isFinite(actualRaw) ? quantityRound(actualRaw) : Number.NaN;
      const waste = Number.isFinite(wasteRaw) ? quantityRound(wasteRaw) : Number.NaN;
      const recoverableMerma = hasRecoverableMerma && Number.isFinite(Number(returnRow?.returnMerma))
        ? quantityRound(Number(returnRow.returnMerma))
        : hasRecoverableMerma ? Number.NaN : 0;
      const damagedPackageQuantity = Number.isFinite(damagedPackageRaw) ? quantityRound(damagedPackageRaw) : Number.NaN;
      const wasteReason = String(returnRow?.returnWasteReason || "").trim();
      // Operaciones nuevas envían tres componentes independientes. En las
      // antiguas returnWaste sigue significando pérdida/no vendible.
      const received = hasRecoverableMerma
        ? quantityRound(actual + recoverableMerma + (Number.isFinite(waste) ? waste : 0) + damagedPackageQuantity)
        : Number.isFinite(Number(returnRow?.physicalReturn))
          ? round(Number(returnRow.physicalReturn))
          : round(actual + (Number.isFinite(waste) ? waste : 0) + damagedPackageQuantity);
      check(
        Number.isFinite(actual) && actual >= 0 && Number.isFinite(received) && received >= 0,
        "Completa las cantidades recibidas físicamente.",
      );
      check(Number.isFinite(waste) && waste >= 0 && Number.isFinite(recoverableMerma) && recoverableMerma >= 0 && Number.isFinite(damagedPackageQuantity) && damagedPackageQuantity >= 0,
        "Las cantidades de merma deben ser válidas y no negativas.");
      check(e.p.unitType === "kg" || [actual, recoverableMerma, waste, received, damagedPackageQuantity].every(Number.isInteger),
        "Paquetes y unidades requieren cantidades enteras.");
      check(waste === 0 || wasteReason.length > 0, "Indica por qué el producto no puede volver al stock vendible.");
      if (hasRecoverableMerma && Number.isFinite(Number(returnRow?.physicalReturn))) {
        check(quantityRound(Number(returnRow.physicalReturn)) === received,
          "El total recibido no coincide con el retorno normal, la merma y el producto no apto.");
      }
      const legacySemantics = !hasRecoverableMerma;
      const recognizedReceived = quantityRound(Math.min(received, expected));
      if (legacySemantics) {
        check(waste <= recognizedReceived + 0.001,
          "La merma no puede superar lo recibido ni lo que debía retornar.");
      }
      const normalApt = legacySemantics
        ? quantityRound(Math.max(0, recognizedReceived - waste))
        : quantityRound(Math.min(actual, expected));
      const recoverableFromRoute = legacySemantics
        ? 0
        : quantityRound(Math.min(recoverableMerma, Math.max(0, expected - normalApt)));
      const wasteFromRoute = quantityRound(Math.min(waste, Math.max(0, expected - normalApt - recoverableFromRoute)));
      const productDispatchLines = activeDispatchLines.filter((line) => line.productId === pid);
      const hasDerivedPackages = productDispatchLines.some((line) => (line.allocations || []).some(allocation => allocation.processingAllocation));
      const derivedDamageCondition = String(returnRow?.damagedPackageCondition || '').trim();
      const derivedDamageReason = String(returnRow?.damagedPackageReason || '').trim();
      const derivedDamageWeightG = returnRow?.damagedMeasuredWeightG === null || returnRow?.damagedMeasuredWeightG === undefined || returnRow?.damagedMeasuredWeightG === ''
        ? null : Number(returnRow.damagedMeasuredWeightG);
      if (hasDerivedPackages) {
        check(e.p.unitType === 'package' || e.p.unitType === 'unit', `El retorno de sachets derivados de ${e.p.name || pid} requiere una presentación de paquetes o unidades.`);
        check(waste === 0 && recoverableMerma === 0, `Los sachets derivados de ${e.p.name || pid} no usan la merma por kg. Registra paquetes recibidos; no se aceptan mermas de granel para sachets.`);
        check(damagedPackageQuantity === 0 || hasRecoverableMerma, `La recepción de sachets dañados de ${e.p.name || pid} requiere el formulario actualizado de Almacén.`);
        check(damagedPackageQuantity === 0 || ['package_damaged_content_intact','package_damaged_partial','aptitude_uncertain','confirmed_unfit'].includes(derivedDamageCondition), `Selecciona la condición de los sachets dañados de ${e.p.name || pid}.`);
        check(damagedPackageQuantity === 0 || derivedDamageReason.length >= 3, `Describe el daño observado en ${e.p.name || pid}.`);
        check(derivedDamageCondition !== 'confirmed_unfit' || o.member.role === 'admin', `Solo Administración puede declarar producto no apto; ${e.p.name || pid} seguirá inmovilizado.`);
        check(derivedDamageWeightG === null || Number.isSafeInteger(derivedDamageWeightG) && derivedDamageWeightG >= 0, `El peso medido de ${e.p.name || pid} debe indicarse en gramos enteros o dejarse desconocido.`);
        check(damagedPackageQuantity <= expected, `Los paquetes dañados recibidos de ${e.p.name || pid} superan el saldo físico esperado de ruta.`);
      }
      const normalLoaded = quantityRound(productDispatchLines.reduce((sum, line) => {
        const merma = Number(line.dispatchMerma) || 0;
        return sum + (Number.isFinite(Number(line.normalQuantity))
          ? Number(line.normalQuantity)
          : Math.max(0, (Number(line.quantity) || 0) - merma));
      }, 0));
      const dispatchMermaSent = quantityRound(productDispatchLines.reduce((sum, line) => sum + (Number(line.dispatchMerma) || 0), 0));
      const productSales = activeSales.flatMap((sale) => (sale.lines || []).map((line) => ({ ...line, saleKind: sale.saleKind })));
      const nominalSold = quantityRound(productSales.filter((line) => line.saleKind !== "courtesy" && line.productId === pid)
        .reduce((sum, line) => sum + (Number(line.quantity) || 0), 0));
      const courtesySold = quantityRound(productSales.filter((line) => line.saleKind === "courtesy" && line.productId === pid)
        .reduce((sum, line) => sum + (Number(line.quantity) || 0), 0));
      const signedNormalExpectedReturn = quantityRound(normalLoaded - nominalSold - courtesySold);
      const expectedNormalReturn = Math.max(0, signedNormalExpectedReturn);
      // Si las ventas nominales superan la carga normal, esa parte ya fue
      // descontada por los movimientos de venta. No volver a descontarla como
      // dispatch_merma_sale ni permitir un retorno normal negativo.
      const nominalDispatchMermaInSales = quantityRound(Math.min(dispatchMermaSent, Math.max(0, nominalSold - normalLoaded)));
      const dispatchMermaRemainingAfterNominalSales = quantityRound(Math.max(0, dispatchMermaSent - nominalDispatchMermaInSales));
      const expectedPhysicalRouteBalance = quantityRound(Math.max(0, signedNormalExpectedReturn + dispatchMermaSent));
      const precisionTolerance = precision === 3 ? 0.001 : 0.01;
      const unreturnedDispatchMerma = quantityRound(Math.max(
        0,
        dispatchMermaSent - nominalDispatchMermaInSales - recoverableMerma - waste,
      ));
      const embeddedMermaInSalesConfirmed = returnRow?.dispatchMermaEmbeddedInSalesConfirmed === true;
      // Merma adicional solo se concilia con ventas cuando el saldo transaccional
      // de ruta, las ventas efectivas y el retorno normal coinciden exactamente.
      // El producto no apto se descuenta explícitamente del componente adicional;
      // cualquier diferencia no demostrada queda pendiente y no se imputa a ventas.
      const canSettleStandardDispatchMerma = !legacySemantics && e.p.unitType === "kg"
        && dispatchMermaSent > 0 && nominalSold > 0
        && signedNormalExpectedReturn >= 0
        && Math.abs(expected - (expectedNormalReturn + dispatchMermaSent)) <= precisionTolerance
        && Math.abs(actual - expectedNormalReturn) <= precisionTolerance
        && recoverableMerma + waste <= dispatchMermaSent + precisionTolerance
        && (unreturnedDispatchMerma <= precisionTolerance || embeddedMermaInSalesConfirmed);
      const canSettleAboveNormalSales = !legacySemantics && e.p.unitType === "kg"
        && dispatchMermaSent > 0 && nominalSold > normalLoaded
        && courtesySold === 0 && signedNormalExpectedReturn < 0
        && -signedNormalExpectedReturn <= dispatchMermaSent + precisionTolerance
        && nominalDispatchMermaInSales <= dispatchMermaSent + precisionTolerance
        && Math.abs(expected - expectedPhysicalRouteBalance) <= precisionTolerance
        && Math.abs(actual) <= precisionTolerance
        && recoverableMerma + waste <= dispatchMermaRemainingAfterNominalSales + precisionTolerance;
      const dispatchMermaEmbeddedInSalesReason = String(returnRow?.dispatchMermaEmbeddedInSalesReason || "").trim();
      if (embeddedMermaInSalesConfirmed && (unreturnedDispatchMerma > precisionTolerance || canSettleAboveNormalSales)) {
        check(canSettleAboveNormalSales || canSettleStandardDispatchMerma,
          `No se puede confirmar peso adicional dentro de ventas para ${e.p.name || pid}: el despacho, las ventas y el saldo físico de ruta no concilian.`);
        check(dispatchMermaEmbeddedInSalesReason.length >= 8,
          `Describe qué comprobó Almacén sobre ${e.p.name || pid} antes de confirmar el peso adicional dentro de ventas.`);
      }
      const allDispatchMermaReturned = !legacySemantics && e.p.unitType === "kg"
        && dispatchMermaSent > 0 && waste === 0
        && signedNormalExpectedReturn >= 0
        && Math.abs(expected - (expectedNormalReturn + dispatchMermaSent)) <= precisionTolerance
        && Math.abs(actual - expectedNormalReturn) <= precisionTolerance
        && Math.abs(recoverableMerma - dispatchMermaSent) <= precisionTolerance;
      const canSettleDispatchMerma = canSettleStandardDispatchMerma || canSettleAboveNormalSales;
      const additionalEmbeddedMerma = canSettleAboveNormalSales && embeddedMermaInSalesConfirmed
        ? quantityRound(Math.min(
          Math.max(0, expected - received),
          Math.max(0, dispatchMermaRemainingAfterNominalSales - recoverableMerma - waste),
        ))
        : 0;
      const dispatchMermaIncludedInSales = canSettleStandardDispatchMerma
        ? quantityRound(nominalDispatchMermaInSales + (embeddedMermaInSalesConfirmed ? unreturnedDispatchMerma : 0))
        : quantityRound(nominalDispatchMermaInSales + additionalEmbeddedMerma);
      const confirmedEmbeddedMermaQuantity = embeddedMermaInSalesConfirmed
        ? quantityRound(canSettleAboveNormalSales ? additionalEmbeddedMerma : canSettleStandardDispatchMerma ? unreturnedDispatchMerma : 0)
        : 0;
      // Para ventas por encima de la carga normal, la cantidad nominal ya
      // redujo el saldo de ruta. Solo se resta aquí el sobrepeso adicional
      // que Almacén confirma expresamente como incluido en bolsas vendidas.
      const adjustedExpected = quantityRound(expected - (canSettleAboveNormalSales ? additionalEmbeddedMerma : dispatchMermaIncludedInSales));
      const overage = quantityRound(Math.max(0, received - adjustedExpected));
      const shortage = quantityRound(Math.max(0, adjustedExpected - received));
      check(!(dispatchMermaSent > 0 && !canSettleDispatchMerma && !allDispatchMermaReturned
        && (shortage > precisionTolerance || overage > precisionTolerance)),
      `No se puede confirmar la recepción de ${e.p.name || pid}: ${quantityRound(Math.max(shortage, overage))} ${e.p.unitType === "kg" ? "kg" : "unidades"} de merma adicional siguen sin conciliar con el retorno físico y las ventas. Confirma únicamente si Almacén verificó que salieron dentro de las bolsas vendidas; si no, la diferencia debe revisarse como faltante.`);
      // Solo se mueven desde ruta cantidades con saldo y lote comprobables.
      // En el modelo nuevo, normal y merma recuperable se conservan como stock;
      // lo no apto se descuenta como pérdida, nunca vuelve al almacén vendible.
      const accountedRouteQuantity = legacySemantics
        ? quantityRound(normalApt + waste)
        : quantityRound(normalApt + recoverableFromRoute + wasteFromRoute + (hasDerivedPackages ? Math.min(damagedPackageQuantity, Math.max(0, expected - normalApt)) : 0));
      const damagedFromRoute = hasDerivedPackages ? quantityRound(Math.min(damagedPackageQuantity, Math.max(0, expected - normalApt))) : 0;
      let receivedParts = [];
      let returnParts = [], recoverableMermaParts = [], wasteParts = [], damagedParts = [];
      if (damagedFromRoute > 0) {
        // A single SKU can have traditional and derived lots. Damaged package
        // receipts must be sourced only from derived allocations; do not let
        // FEFO accidentally reinterpret a traditional lot as a sachet return.
        let remainingDamaged = damagedFromRoute;
        const damageRequests = [];
        for (const lot of e.lots) {
          if (!lot.processingCommercialBlocked || lot.processingDestinationKind !== 'finished' || lot.quarantined) continue;
          const held = lot.processingUnavailable?.[route] || {};
          const unavailableQuantity = quantityRound((Number(held.courtesy) || 0) + (Number(held.repackPending) || 0) + (Number(held.reviewHold) || 0));
          const availableQuantity = Math.max(0, quantityRound((Number(lot.quantities?.[route]) || 0) - unavailableQuantity));
          const quantity = Math.min(remainingDamaged, availableQuantity);
          if (quantity > 0) damageRequests.push({ lotId: lot.id, quantity });
          remainingDamaged = quantityRound(remainingDamaged - quantity);
          if (remainingDamaged <= 0) break;
        }
        check(remainingDamaged <= 0, `No hay suficientes paquetes derivados con asignación íntegra para recibir los dañados de ${e.p.name || pid}. Revisa el lote y la trazabilidad.`);
        damagedParts = await o.take(pid, route, damagedFromRoute, { allowExpired: true, precision, processingReturn: true, allocationsRequested: damageRequests });
        const otherReturnQuantity = quantityRound(accountedRouteQuantity - damagedFromRoute);
        const otherParts = otherReturnQuantity > 0
          ? await o.take(pid, route, otherReturnQuantity, { allowExpired: true, precision, processingReturn: hasDerivedPackages })
          : [];
        [returnParts, recoverableMermaParts, wasteParts] = splitAllocationsByAmounts(
          otherParts,
          [normalApt, recoverableFromRoute, wasteFromRoute],
        );
        receivedParts = [...otherParts, ...damagedParts];
      } else {
        receivedParts = accountedRouteQuantity > 0
          ? await o.take(pid, route, accountedRouteQuantity, { allowExpired: true, precision, processingReturn: hasDerivedPackages })
          : [];
        [returnParts, recoverableMermaParts, wasteParts] = splitAllocationsByAmounts(
          receivedParts,
          [normalApt, recoverableFromRoute, wasteFromRoute],
        );
      }
      for (const a of [...returnParts, ...recoverableMermaParts]) {
        const lot = e.lots.find((x) => x.id === a.lotId);
        check(lot, "No se encontró el lote del producto retornado.");
        origins.restore(lot, warehouse, a);
        o.restoreProcessingAllocation(lot, warehouse, a);
      }
      if (normalApt > 0) {
        o.move(e, warehouse, normalApt, precision);
        o.ledger(pid, normalApt, route, warehouse, "return", { allocations: returnParts, dispatchId: d.id }, precision);
      }
      if (recoverableFromRoute > 0) {
        o.move(e, warehouse, recoverableFromRoute, precision);
        o.ledger(pid, recoverableFromRoute, route, warehouse, "return_merma", {
          allocations: recoverableMermaParts,
          dispatchId: d.id,
          note: "Merma operativa recibida; solo queda disponible la cantidad con origen identificado.",
        }, precision);
      }
      let derivedDamageReceipts = [];
      if (damagedFromRoute > 0) {
        const sourceBatches = new Set(damagedParts.map(allocation => allocation.processingAllocation?.batchId).filter(Boolean));
        derivedDamageReceipts = putDerivedReturnQuarantine(o, e, damagedParts, {
          location: warehouse,
          sourceSaleId: '',
          claimId: `${o.id}__${pid}`,
          condition: derivedDamageCondition,
          reason: derivedDamageReason,
          measuredWeightG: derivedDamageWeightG,
          measurementScope: sourceBatches.size === 1 ? 'claim_total' : 'multi_batch_unallocated',
          fromLocation: route,
          movementType: 'derived_damaged_return',
          dispatchId: d.id,
        });
        if (sourceBatches.size > 1 && derivedDamageWeightG !== null) {
          for (const row of derivedDamageReceipts) {
            const lot = await o.read('distLots', row.lotId);
            lot.derivedReturn.measurementScope = 'multi_batch_unallocated';
            o.put('distLots', lot.id, lot);
          }
        }
      }
      let dispatchMermaSaleMovementId;
      let dispatchMermaSaleCost = null;
      const dispatchMermaSaleMovementQuantity = canSettleAboveNormalSales
        ? additionalEmbeddedMerma
        : dispatchMermaIncludedInSales;
      if (dispatchMermaSaleMovementQuantity > 0) {
        const soldMermaParts = await o.take(pid, route, dispatchMermaSaleMovementQuantity, { allowExpired: true, precision });
        const costKnown = soldMermaParts.length > 0 && soldMermaParts.every((allocation) => allocation.productionCost !== null);
        dispatchMermaSaleCost = costKnown
          ? round(soldMermaParts.reduce((sum, allocation) => sum + allocation.quantity * allocation.productionCost, 0))
          : null;
        dispatchMermaSaleMovementId = o.ledger(pid, dispatchMermaSaleMovementQuantity, route, null, "dispatch_merma_sale", {
          allocations: soldMermaParts,
          dispatchId: d.id,
          costOfSales: dispatchMermaSaleCost,
          dispatchMermaSent,
          recoverableMermaReturned: recoverableMerma,
          note: embeddedMermaInSalesConfirmed
            ? `Sobrepeso físico adicional confirmado por Almacén como incluido en bolsas ya vendidas; no se cobró como kilos nominales adicionales. Comprobación: ${dispatchMermaEmbeddedInSalesReason}. Costo incluido una sola vez en costo físico de venta, no es pérdida.`
            : "Parte de la merma adicional enviada ya cobrada nominalmente dentro de ventas superiores a la carga normal; costo incluido una sola vez en costo de venta, no es pérdida.",
        }, precision);
      }
      if (waste > 0) {
        const knownCost = wasteFromRoute === waste && wasteParts.every((a) => a.productionCost !== null);
        const lossCost = knownCost
          ? round(wasteParts.reduce((sum, a) => sum + a.quantity * a.productionCost, 0))
          : null;
        if (wasteFromRoute > 0) {
          o.ledger(pid, wasteFromRoute, route, null, "return_waste", {
            allocations: wasteParts,
            lotCodes: [...new Set(wasteParts.map((a) => a.lotCode).filter(Boolean))],
            lossCost: knownCost ? lossCost : null,
            reason: wasteReason,
            dispatchId: d.id,
          }, precision);
        }
        if (wasteFromRoute < waste) {
          o.ledger(pid, quantityRound(waste - wasteFromRoute), null, null, "return_waste_unassigned", {
            allocations: [],
            lossCost: null,
            reason: wasteReason,
            dispatchId: d.id,
            note: "Producto no apto recibido por encima del saldo trazable en la ruta; costo y origen requieren revisión.",
          }, precision);
        }
      }
      let shortageMovementId;
      if (shortage > 0) {
        const loss = await o.take(pid, route, shortage, { allowExpired: true, precision, processingReturn: hasDerivedPackages });
        const lossCostCents = historicalAllocationCostCents(loss);
        const lossCost = lossCostCents === null ? null : lossCostCents / 100;
        shortageMovementId = o.ledger(pid, shortage, route, null, "shortage", {
          allocations: loss,
          lossCost,
          ...(loss.some(allocation => allocation.processingAllocation) ? { lossCostCents } : {}),
          dispatchId: d.id,
        }, precision);
      }
      const sellableOverage = legacySemantics ? overage : quantityRound(Math.max(0, actual + recoverableMerma - adjustedExpected));
      if (sellableOverage > 0) {
        const lotId = `${o.id}__surplus_${pid}`;
        e.lots.push({
          id: lotId,
          restaurantId: "sanjose",
          productId: pid,
          productName: e.p.name,
          unitType: e.p.unitType,
          lotCode: "SOBRANTE POR REVISAR",
          manufacturedOn: "",
          expiresOn: "",
          productionCost: null,
          quarantined: true,
          quantities: { [warehouse]: sellableOverage },
          createdAt: o.now,
          createdBy: o.actor,
        });
        o.move(e, warehouse, sellableOverage, precision);
        // El sobrante no procede de stock asignado a la ruta: es una
        // recepción física sin origen verificable y queda en cuarentena.
        o.ledger(pid, sellableOverage, null, warehouse, "overage", {
          lotId,
          allocations: [],
          dispatchId: d.id,
          note: "Sobrante físico sin asignación de lote verificable; separado en cuarentena hasta revisar su origen.",
        }, precision);
      }
      const initial = d.lines
          .filter((l) => l.productId === pid)
          .reduce((s, l) => s + l.quantity, 0),
        additions = (d.additions || []).filter((addition) => !addition.voided && !addition.voidedAt)
          .flatMap((a) => a.quantityByProduct)
          .filter((l) => l.productId === pid)
          .reduce((s, l) => s + l.quantity, 0);
      rows.push({
        productId: pid,
        productName: e.p.name,
        unitType: e.p.unitType,
        initialDispatch: initial,
        additions,
        totalLoaded: round(initial + additions),
        sold: round(
          activeSales
            .filter((s) => s.saleKind !== "courtesy")
            .flatMap((s) => s.lines)
            .filter((l) => l.productId === pid)
            .reduce((s, l) => s + l.quantity, 0),
        ),
        courtesy: round(activeSales
          .filter((s) => s.saleKind === "courtesy")
          .flatMap((s) => s.lines)
          .filter((l) => l.productId === pid)
          .reduce((sum, line) => sum + line.quantity, 0)),
        expectedReturn: adjustedExpected,
        ...(dispatchMermaSent > 0 ? {
          normalExpectedReturn: expectedNormalReturn,
          dispatchMermaSent,
          dispatchMermaIncludedInSales,
          dispatchMermaNominallySold: nominalDispatchMermaInSales,
          dispatchMermaEmbeddedInSalesConfirmed: embeddedMermaInSalesConfirmed && confirmedEmbeddedMermaQuantity > 0,
          dispatchMermaEmbeddedInSalesQuantity: confirmedEmbeddedMermaQuantity,
          ...(embeddedMermaInSalesConfirmed && confirmedEmbeddedMermaQuantity > 0 ? {
            dispatchMermaEmbeddedInSalesConfirmedBy: o.actor,
            dispatchMermaEmbeddedInSalesConfirmedAt: o.now,
            dispatchMermaEmbeddedInSalesReason,
          } : {}),
          dispatchMermaReconciliationStatus: dispatchMermaIncludedInSales > 0 ? "included_in_sales" : allDispatchMermaReturned ? "returned" : canSettleDispatchMerma ? "reconciled_with_unfit" : "pending_review",
          ...(dispatchMermaSaleCost !== null ? { dispatchMermaSaleCost } : {}),
          ...(dispatchMermaSaleMovementId ? { dispatchMermaSaleMovementId } : {}),
        } : {}),
        ...(Number.isFinite(Number(previous.declaredReturns?.[pid] ?? previousProduct?.declaredReturnNormal ?? previousProduct?.declaredReturn)) ? { declaredReturn: round((previous.declaredReturns?.[pid] ?? previousProduct?.declaredReturnNormal ?? previousProduct?.declaredReturn) + (previous.declaredReturnMermas?.[pid] ?? previousProduct?.declaredReturnMerma ?? 0)), declaredReturnNormal: round(previous.declaredReturns?.[pid] ?? previousProduct?.declaredReturnNormal ?? previousProduct?.declaredReturn), declaredReturnMerma: round(previous.declaredReturnMermas?.[pid] ?? previousProduct?.declaredReturnMerma ?? 0) } : {}),
        physicalReturn: received,
        originReferences: origins.references(receivedParts),
        originPendingReceived: quantityRound(origins.references(receivedParts).reduce((sum, part) => sum + part.quantity, 0)),
        actualReturn: legacySemantics ? normalApt : actual,
        ...(hasRecoverableMerma ? { returnMerma: recoverableMerma } : {}),
        returnWaste: waste,
        returnWasteReason: wasteReason,
        shortage,
        overage,
        ...(shortageMovementId ? { shortageMovementId } : {}),
        ...(hasDerivedPackages && damagedFromRoute > 0 ? {
          damagedPackageQuantity: damagedFromRoute,
          damagedPackageCondition: derivedDamageCondition,
          damagedPackageReason: derivedDamageReason,
          damagedMeasuredWeightG: derivedDamageWeightG,
          damagedHistoricalAssignedWeightG: damagedParts.reduce((sum, allocation) => sum + Number(allocation.processingAllocation?.physicalWeightG || 0), 0),
          damagedWeightMeasurementScope: derivedDamageReceipts.length > 1 ? 'aggregate_not_allocated_between_source_batches' : 'single_batch_or_unknown',
          damagedQuarantineLots: derivedDamageReceipts.map(row => ({ lotId: row.lotId, reservationId: row.reservationId, movementId: row.movementId, quantity: row.quantity, batchId: row.batchId, costCents: row.costCents })),
        } : {}),
        lossCost: wasteFromRoute === waste && wasteParts.every((a) => a.productionCost !== null)
          ? round(wasteParts.reduce((sum, a) => sum + a.quantity * a.productionCost, 0))
          : null,
        variance: round(overage - shortage),
      });
    }
    const c = {
      ...previous,
      id,
      ...o.base(),
      dayKey: d.dayKey || previous.dayKey || o.today,
      createdAt: previous.createdAt || d.createdAt || o.now,
      dispatchId: d.id,
      warehouseId: d.warehouseId || "central",
      routeId: d.routeId,
      routeName: d.routeName,
      distributorUid: d.distributorUid,
      distributorName: d.distributorName,
      status: "warehouse_done",
      products: rows,
      warehouseClosedBy: o.actor,
      warehouseClosedAt: o.now,
      warehouseResponsibleName: p.warehouseResponsibleName?.trim() || o.responsibleName(),
      derivedClaimQuarantineReceipts,
    };
    o.put("distClosures", id, c);
    return c;
  }
  check(
    o.member.role === "admin" ||
      (o.member.role === "distributor" && d.distributorUid === o.actor),
    "No puedes cerrar esta ruta.",
  );
  check(
    previous.warehouseClosedBy,
    "Almacén debe confirmar el retorno antes del cierre.",
  );
  const from = d.createdAt;
  const collections = (
    await o.query("distCollections", "routeId", d.routeId)
  ).filter((x) => x.createdAt >= from);
  const expenses = (await o.query("distExpenses", "routeId", d.routeId)).filter(
    (x) => x.createdAt >= from && !x.voided,
  );
  const claims = (await o.query("distClaims", "routeId", d.routeId)).filter(
    (x) => x.createdAt >= from,
  );
  const sum = (list, key) => round(list.reduce((n, r) => n + (r[key] || 0), 0));
  const commercialSales = sales.filter((s) => s.saleKind !== "courtesy");
  const voidedReceipts = await Promise.all(settlementSales.filter((sale) => sale.voidedAt && sale.derivedVoid && sale.saleKind !== "courtesy")
    .map((sale) => voidedSaleReceiptAmounts(o, sale)));
  const voidedCashReceipts = round(voidedReceipts.reduce((total, row) => total + row.cash, 0));
  const voidedQrReceipts = round(voidedReceipts.reduce((total, row) => total + row.qr, 0));
  const cashSales = sum(commercialSales, "cashAmount"),
    cashCollections = round(collections.reduce((n, x) => n + (Number.isFinite(x.cashAmount) ? x.cashAmount : x.method === "cash" ? x.amount : 0), 0)),
    cashExpenses = round(expenses.filter((expense) => !expense.voided).reduce((total, expense) => total + (Number.isFinite(expense.cashPaidAmount) ? Math.max(0, expense.cashPaidAmount) : (expense.paymentMethod || "cash") === "cash" ? (expense.amount || 0) : 0), 0)),
    // A derived-sale void is executed by Administration. Legacy rows kept the
    // sale route, so do not debit that cash from the distributor's route box.
    claimCash = settledClaimCash(claims.filter((claim) => !claim.isDerivedSaleVoid)),
    claimQr = settledClaimQr(claims.filter((claim) => !claim.isDerivedSaleVoid)),
    expectedCash = round(
      cashSales + voidedCashReceipts + cashCollections - cashExpenses + claimCash,
    );
  check(
    Number.isFinite(requested.physicalCashDeclared) &&
      requested.physicalCashDeclared >= 0,
    "Efectivo declarado inválido.",
  );
  // Una reapertura puede ser exclusivamente para corregir inventario físico.
  // En ese caso, la caja cerrada es un snapshot histórico: no debe cambiar si
  // ventas, cobros o gastos fueron ajustados con posterioridad.
  const preserveHistoricalMoney = previous.preserveFinancialSnapshot === true &&
    ["reopened", "warehouse_done"].includes(previous.status) &&
    Number.isFinite(Number(previous.physicalCashDeclared));
  const moneySnapshot = preserveHistoricalMoney
    ? Object.fromEntries(Object.entries({
        cashSales: previous.cashSales,
        qrSales: previous.qrSales,
        creditGenerated: previous.creditGenerated,
        cashCollections: previous.cashCollections,
        qrCollections: previous.qrCollections,
        cashExpenses: previous.cashExpenses,
        voidedCashReceipts: previous.voidedCashReceipts,
        voidedQrReceipts: previous.voidedQrReceipts,
        claimCash: previous.claimCash,
        claimQr: previous.claimQr,
        expectedCash: previous.expectedCash,
        physicalCashDeclared: previous.physicalCashDeclared,
        cashDifference: previous.cashDifference,
      }).filter(([, value]) => value !== undefined))
    : {
        cashSales,
        qrSales: sum(commercialSales, "qrAmount"),
        creditGenerated: sum(commercialSales, "creditAmount"),
        cashCollections,
        qrCollections: round(collections.reduce((n, x) => n + (Number.isFinite(x.qrAmount) ? x.qrAmount : x.method === "qr" ? x.amount : 0), 0)),
        cashExpenses,
        voidedCashReceipts,
        voidedQrReceipts,
        claimCash,
        claimQr,
        expectedCash,
        physicalCashDeclared: requested.physicalCashDeclared,
        cashDifference: round(requested.physicalCashDeclared - expectedCash),
      };
  const c = {
    ...previous,
    status: "closed",
    ...moneySnapshot,
    closedBy: o.actor,
    closedByName: o.member.displayName || o.actor,
    closedAt: o.now,
  };
  o.put("distClosures", id, c);
  o.put("distDispatches", d.id, {
    ...d,
    status: "closed",
    closedAt: o.now,
    closureId: id,
  });
  return c;
}
function processingClaimSlices(lines, returnedBefore, quantity) {
  const allocations = (lines || []).flatMap(line => line.allocations || []);
  check(allocations.length > 0 && allocations.every(allocation => allocation.processingAllocation),
    'La línea combina lotes tradicionales y derivados; requiere separar las asignaciones antes de devolverla.');
  check(allocations.every(allocation => Number.isSafeInteger(allocation.quantity) && allocation.quantity > 0 && Number.isSafeInteger(allocation.processingAllocation.quantity) && allocation.processingAllocation.quantity === allocation.quantity),
    'La venta no conserva una asignación comercial completa por paquete.');
  let offset = returnedBefore, remaining = quantity;
  const slices = [];
  for (const allocation of allocations) {
    const count = Math.min(remaining, Math.max(0, allocation.quantity - offset));
    if (count > 0) slices.push(origins.slice(allocation, offset, count));
    remaining -= count;
    offset = Math.max(0, offset - allocation.quantity);
    if (remaining === 0) break;
  }
  check(remaining === 0, 'No se encontraron paquetes derivados todavía disponibles para devolver.');
  return slices;
}

function putDerivedReturnQuarantine(o, entry, sourceAllocations, { location: loc, sourceSaleId, claimId, condition, reason, measuredWeightG, measurementScope = 'claim_total', fromLocation = null, movementType = 'customer_return', dispatchId = '' }) {
  const groups = new Map();
  for (const allocation of sourceAllocations) {
    const part = allocation.processingAllocation;
    check(part && part.batchId && part.segmentId, 'La devolución no conserva batch y segmento de sacheteado.');
    const key = `${allocation.lotId}__${part.batchId}`;
    const group = groups.get(key) || { sourceLotId: allocation.lotId, batchId: part.batchId, allocations: [], quantity: 0, weightG: 0, weightKnown: true, costCents: 0, costKnown: true };
    group.allocations.push(allocation);
    group.quantity += allocation.quantity;
    if (!Number.isSafeInteger(part.physicalWeightG) || part.physicalWeightG < 0) group.weightKnown = false;
    else group.weightG += part.physicalWeightG;
    if (part.costCents === null || part.costCents === undefined) group.costKnown = false;
    else group.costCents += part.costCents;
    groups.set(key, group);
  }
  const result = [];
  let groupIndex = 0;
  for (const group of groups.values()) {
    const sourceLot = entry.lots.find(lot => lot.id === group.sourceLotId);
    check(sourceLot && sourceLot.processingBatchId === group.batchId, 'No se encontró el lote derivado de origen de la devolución.');
    const lotId = `${claimId}__quarantine_${groupIndex++}`;
    check(!entry.lots.some(lot => lot.id === lotId), 'La cuarentena de esta devolución ya existe.');
    const costCents = group.costKnown ? group.costCents : null;
    const returnedSegments = new Map();
    for (const allocation of group.allocations) {
      const part = allocation.processingAllocation;
      const segment = returnedSegments.get(part.segmentId) || { sourceSegmentId: part.segmentId, batchId: part.batchId, destinationId: part.destinationId, sourceMovementId: part.sourceMovementId, weightBasis: part.weightBasis, quantity: 0, weightG: 0, weightKnown: true, costCents: 0, costKnown: true };
      segment.quantity += part.quantity;
      if (!Number.isSafeInteger(part.physicalWeightG) || part.physicalWeightG < 0) segment.weightKnown = false;
      else segment.weightG += part.physicalWeightG;
      if (part.costCents === null || part.costCents === undefined) segment.costKnown = false;
      else segment.costCents += part.costCents;
      returnedSegments.set(part.segmentId, segment);
    }
    const segmentRows = [...returnedSegments.values()].map(segment => ({
      segmentId: `${segment.sourceSegmentId}:returned:${claimId}`,
      sourceSegmentId: segment.sourceSegmentId,
      batchId: segment.batchId,
      destinationId: segment.destinationId,
      sourceMovementId: segment.sourceMovementId,
      weightBasis: segment.weightBasis,
      remainingQuantity: segment.quantity,
      remainingWeightG: segment.weightKnown ? segment.weightG : null,
      remainingCostCents: segment.costKnown ? segment.costCents : null,
    }));
    const assignedWeightG = group.weightKnown ? group.weightG : null;
    const groupMeasuredWeightG = measurementScope === 'claim_total' && groups.size === 1 ? measuredWeightG : null;
    const lot = {
      id: lotId, restaurantId: 'sanjose', branchId: 'main', productId: entry.p.id,
      productName: entry.p.name, unitType: entry.p.unitType,
      lotCode: `DEVOLUCIÓN · ${sourceLot.lotCode || sourceLot.id}`,
      manufacturedOn: sourceLot.manufacturedOn || '', expiresOn: sourceLot.expiresOn || '',
      productionCost: null, quantities: { [loc]: group.quantity }, quarantined: true,
      processingCommercialBlocked: true, processingDestinationKind: 'review_hold',
      processingBatchId: group.batchId, processingDestinationId: sourceLot.processingDestinationId || '',
      processingSourceLotIds: [group.sourceLotId], processingSourceAllocationBasis: sourceLot.processingSourceAllocationBasis,
      processingPhysicalWeightGRemaining: assignedWeightG, processingMeasuredWeightGRemaining: groupMeasuredWeightG,
      processingCostCentsRemaining: costCents,
      processingByLocation: { [loc]: { segments: segmentRows } },
      processingUnavailable: { [loc]: { courtesy: 0, repackPending: 0, reviewHold: group.quantity } },
      derivedReturn: { claimId, sourceSaleId, sourceLotId: group.sourceLotId, batchId: group.batchId, condition, reason,
        assignedWeightG, measuredWeightG: groupMeasuredWeightG,
        weightDifferenceG: groupMeasuredWeightG === null || assignedWeightG === null ? null : assignedWeightG - groupMeasuredWeightG,
        weightBasis: 'historical_segment_assignment', physicalOriginConfirmed: false },
      createdAt: o.now, createdBy: o.actor, createdByName: o.member.displayName || o.actor,
    };
    const reservationId = `${claimId}__review_hold_${groupIndex - 1}`;
    const reservation = {
      id: reservationId, restaurantId: 'sanjose', branchId: 'main', schemaVersion: 1,
      productId: entry.p.id, productName: entry.p.name, lotId, lotCode: lot.lotCode, unitType: entry.p.unitType,
      location: loc, purpose: 'review_hold', originalQuantity: group.quantity, remainingQuantity: group.quantity,
      consumedQuantity: 0, physicalWeightG: assignedWeightG, remainingWeightG: assignedWeightG,
      remainingCostCents: costCents, batchId: group.batchId, source: 'derived_customer_return', status: 'active',
      createdAt: o.now, createdBy: o.actor, createdByName: o.member.displayName || o.actor,
      history: [{ id: `${o.id}__hold_created_${groupIndex}`, action: 'created', quantity: group.quantity, at: o.now,
        by: o.actor, byName: o.member.displayName || o.actor, reason: `Retorno derivado; revisión sanitaria pendiente. ${reason}` }],
    };
    const movementAllocations = group.allocations.map(allocation => ({
      ...allocation, lotId, lotCode: lot.lotCode, expiresOn: lot.expiresOn, productionCost: null,
      processingAllocation: { ...allocation.processingAllocation, returnedFromLotId: group.sourceLotId, returnedToLocation: loc, physicalOriginConfirmed: false },
    }));
    entry.lots.push(lot);
    o.put('distLots', lotId, lot);
    o.put('distStockReservations', reservationId, reservation);
    o.move(entry, loc, group.quantity, quantityPrecision(entry.p));
    const movementId = o.ledger(entry.p.id, group.quantity, fromLocation, loc, movementType, {
      lotId, allocations: movementAllocations, sourceSaleId, claimId, batchId: group.batchId,
      dispatchId,
      quarantineReservationId: reservationId, quarantined: true,
      historicalAssignedWeightG: assignedWeightG, measuredPhysicalWeightG: groupMeasuredWeightG,
      physicalWeightDifferenceG: groupMeasuredWeightG === null || assignedWeightG === null ? null : assignedWeightG - groupMeasuredWeightG,
      costCents, costAccountingStatus: 'pending_quarantine_disposition',
      traceabilityStatus: 'accounting_lot_reference_physical_origin_unconfirmed',
      note: `Sachet devuelto y recibido físicamente; inmovilizado para revisión, no disponible para venta. ${reason}`,
    }, quantityPrecision(entry.p));
    lot.derivedReturn.movementId = movementId;
    lot.derivedReturn.reservationId = reservationId;
    o.put('distLots', lotId, lot);
    result.push({ lotId, reservationId, movementId, sourceLotId: group.sourceLotId, batchId: group.batchId,
      quantity: group.quantity, assignedWeightG, costCents, measuredWeightG: groupMeasuredWeightG,
      allocations: movementAllocations });
  }
  return result;
}

async function moveDerivedReturnQuarantine(o, entry, { lotId, reservationId, claimId, quantity, allocations, from, to, dispatchId, sourceSaleId }) {
  const lot = entry.lots.find(row => row.id === lotId);
  check(lot && lot.quarantined === true && lot.processingCommercialBlocked === true
    && lot.processingDestinationKind === 'review_hold' && lot.derivedReturn?.claimId === claimId
    && lot.derivedReturn?.reservationId === reservationId,
  'La devolución en cuarentena no coincide con su reclamo; no se movió inventario.');
  const reservation = o.writes.get(`distStockReservations/${reservationId}`)?.data
    || o.reservationRows.get(lot.id)?.find(row => row.id === reservationId)
    || await o.read('distStockReservations', reservationId);
  check(reservation && reservation.lotId === lot.id && reservation.productId === entry.p.id
    && reservation.purpose === 'review_hold' && ['active','partially_consumed'].includes(reservation.status)
    && reservation.location === from && reservation.remainingQuantity === quantity,
  'La reserva de revisión de la devolución cambió; no se movió inventario.');
  check(Number(lot.quantities?.[from] || 0) === quantity && Number(lot.quantities?.[to] || 0) === 0,
    'La cantidad física de la cuarentena no coincide con el reclamo o ya existe en destino.');
  const sourceSegments = lot.processingByLocation?.[from]?.segments;
  check(Array.isArray(sourceSegments) && sourceSegments.length > 0 && !lot.processingByLocation?.[to]?.segments?.length,
    'Los segmentos de la devolución no están disponibles exclusivamente en la ubicación esperada.');
  const quantityTotal = sourceSegments.reduce((sum, segment) => sum + Number(segment.remainingQuantity || 0), 0);
  const weightTotal = sourceSegments.some(segment => !Number.isSafeInteger(segment.remainingWeightG)) ? null
    : sourceSegments.reduce((sum, segment) => sum + segment.remainingWeightG, 0);
  const costTotal = sourceSegments.some(segment => segment.remainingCostCents === null || segment.remainingCostCents === undefined) ? null
    : sourceSegments.reduce((sum, segment) => sum + segment.remainingCostCents, 0);
  check(quantityTotal === quantity && (weightTotal === null || weightTotal === lot.processingPhysicalWeightGRemaining)
    && costTotal === (lot.processingCostCentsRemaining ?? null),
  'Los segmentos de la devolución no concilian con los paquetes, gramos o costo del lote.');
  const reservations = await o.processingReservations(lot.id);
  o.assertReservationAggregate(lot, from, reservations);
  check(reservations.filter(row => row.location === from && ['active','partially_consumed'].includes(row.status))
    .every(row => row.id === reservationId), 'La cuarentena tiene otras reservas activas en origen; requiere revisión.');
  check(!reservations.some(row => row.location === to && ['active','partially_consumed'].includes(row.status)),
    'Ya existe una reserva activa de esta cuarentena en destino.');
  const destinationHeld = lot.processingUnavailable?.[to] || {};
  check(['courtesy','repackPending','reviewHold'].every(key => Number(destinationHeld[key] || 0) === 0),
    'El destino ya tiene cantidades inmovilizadas para este lote; requiere revisión.');

  lot.quantities = { ...(lot.quantities || {}), [from]: 0, [to]: quantity };
  lot.processingByLocation = { ...(lot.processingByLocation || {}) };
  delete lot.processingByLocation[from];
  lot.processingByLocation[to] = { segments: structuredClone(sourceSegments) };
  lot.processingUnavailable = { ...(lot.processingUnavailable || {}) };
  const held = lot.processingUnavailable[from] || {};
  lot.processingUnavailable[from] = { ...held, reviewHold: 0 };
  lot.processingUnavailable[to] = { ...(lot.processingUnavailable[to] || {}), courtesy: 0, repackPending: 0, reviewHold: quantity };
  const updatedReservation = { ...reservation, location: to, updatedAt: o.now, updatedBy: o.actor,
    history: [...(reservation.history || []), { id: `${o.id}__quarantine_transfer_${claimId}`, action: 'location_transferred', quantity,
      from, to, at: o.now, by: o.actor, byName: o.member.displayName || o.actor,
      reason: 'Traslado de cuarentena física de reclamo durante recepción/cierre de ruta.' }] };
  o.put('distStockReservations', reservationId, updatedReservation);
  const cachedReservations = o.reservationRows.get(lot.id);
  if (cachedReservations) o.reservationRows.set(lot.id, cachedReservations.map(row => row.id === reservationId ? updatedReservation : row));
  o.move(entry, from, -quantity, quantityPrecision(entry.p));
  o.move(entry, to, quantity, quantityPrecision(entry.p));
  const movedReservations = o.reservationRows.get(lot.id) || reservations.map(row => row.id === reservationId ? updatedReservation : row);
  o.assertReservationAggregate(lot, from, movedReservations);
  o.assertReservationAggregate(lot, to, movedReservations);
  o.assertProcessingLocation(lot, to);
  o.put('distLots', lot.id, lot);
  const movementId = o.ledger(entry.p.id, quantity, from, to, 'derived_claim_quarantine_transfer', {
    lotId, quarantineReservationId: reservationId, claimId, sourceSaleId, dispatchId,
    allocations, batchId: lot.processingBatchId,
    historicalAssignedWeightG: weightTotal, measuredPhysicalWeightG: lot.processingMeasuredWeightGRemaining ?? null,
    costCents: costTotal, quarantined: true, physicalEffect: true,
    traceabilityStatus: 'accounting_lot_reference_physical_origin_unconfirmed',
    note: 'Traslado de la misma devolución en cuarentena desde ruta a Almacén; sin liberar ni duplicar paquetes, gramos o costo.',
  }, quantityPrecision(entry.p));
  return { lotId, reservationId, claimId, quantity, assignedWeightG: weightTotal, costCents: costTotal, movementId };
}

async function claimDerivedSale(o, p, sale) {
  check(p.kind === 'return' || p.kind === 'exchange', 'Tipo de reclamo inválido.');
  check(p.physicalReceiptConfirmed === true, 'Confirma que recibiste físicamente los sachets antes de registrar la devolución.');
  const effectiveSale = { ...sale, ...await o.withDocumentedOrigins(sale, sale.effectiveSnapshot || sale) };
  const lines = (effectiveSale.lines || []).filter(line => line.productId === p.productId);
  check(lines.length > 0 && lines.some(line => (line.allocations || []).some(allocation => allocation.processingAllocation)), 'El producto no corresponde a un sachet derivado de esta venta.');
  const product = await o.product(safeId(p.productId));
  check(product.unitType === 'package' || product.unitType === 'unit', 'La devolución derivada solo admite paquetes o unidades completas.');
  const quantity = o.amount(Number(p.quantity), product, false, 0);
  check(Number.isSafeInteger(quantity) && quantity > 0, 'Devuelve una cantidad entera de paquetes o unidades.');
  const prior = await o.query('distClaims', 'saleId', sale.id);
  const priorForLine = prior.filter(row => row.productId === product.id);
  check(priorForLine.every(row => Array.isArray(row.returnedProcessingAllocations) && row.returnedProcessingAllocations.length > 0), 'Hay devoluciones anteriores sin asignación derivada verificable; requiere conciliación administrativa.');
  const returnedBefore = priorForLine.reduce((sum, row) => sum + Number(row.quantity || 0), 0);
  check(Number.isSafeInteger(p.expectedReturnedQuantity) && p.expectedReturnedQuantity === returnedBefore,
    'El saldo de devoluciones cambió en otra sesión. Actualiza la venta y vuelve a revisar los paquetes recibidos.');
  const soldQuantity = lines.reduce((sum, line) => sum + Number(line.quantity || 0), 0);
  check(returnedBefore + quantity <= soldQuantity, 'La cantidad supera los paquetes vendidos o ya devueltos.');
  const sourceAllocations = processingClaimSlices(lines, returnedBefore, quantity);
  const originalPrices = [...new Set(lines.map(line => Number(line.actualUnitPrice)))];
  check(originalPrices.length === 1 && Number.isFinite(originalPrices[0]), 'La venta tiene precios distintos para el mismo producto; requiere revisión administrativa.');
  const condition = String(p.derivedReturnCondition || 'aptitude_uncertain');
  check(['sealed_intact','package_damaged_content_intact','package_damaged_partial','aptitude_uncertain','confirmed_unfit'].includes(condition), 'Selecciona el estado físico del producto devuelto.');
  check(condition !== 'confirmed_unfit' || o.member.role === 'admin', 'Solo Administración puede registrar una declaración de producto no apto; seguirá en cuarentena.');
  const reason = String(p.reason || '').trim();
  check(reason.length >= 3 && reason.length <= 500, 'Describe el motivo de la devolución.');
  const measuredWeightG = p.measuredPhysicalWeightG === null || p.measuredPhysicalWeightG === undefined || p.measuredPhysicalWeightG === ''
    ? null : Number(p.measuredPhysicalWeightG);
  check(measuredWeightG === null || Number.isSafeInteger(measuredWeightG) && measuredWeightG >= 0, 'El peso físico medido debe indicarse en gramos enteros o dejarse desconocido.');
  const assignedWeightKnown = sourceAllocations.every(allocation => Number.isSafeInteger(allocation.processingAllocation.physicalWeightG) && allocation.processingAllocation.physicalWeightG >= 0);
  const assignedWeightG = assignedWeightKnown
    ? sourceAllocations.reduce((sum, allocation) => sum + allocation.processingAllocation.physicalWeightG, 0)
    : null;
  const costValues = sourceAllocations.map(allocation => allocation.processingAllocation.costCents);
  const returnedCostCents = costValues.some(value => value === null || value === undefined) ? null : costValues.reduce((sum, value) => sum + value, 0);
  const isDistributor = o.member.role === 'distributor';
  if (isDistributor) {
    check(sale.sellerUid === o.actor, 'Solo puedes devolver productos de tus propias ventas.');
    check(sale.routeId && sale.routeId === o.member.routeId, 'La venta ya no corresponde a tu ruta asignada; Administración debe recibir la devolución.');
  }
  else check(o.member.role === 'admin' || o.member.role === 'warehouse', 'Sin permiso para recibir devoluciones.');
  const dispatch = sale.dispatchId ? await o.read('distDispatches', sale.dispatchId) : null;
  if (isDistributor) check(!dispatch || dispatch.status === 'open', 'La ruta está cerrada; Administración debe recibir la devolución.');
  const locationId = isDistributor ? location('route', sale.routeId) : location('warehouse', p.warehouseId || 'central');
  if (!isDistributor) o.owns(locationId);
  if (!isDistributor && locationId !== 'central') {
    const warehouse = await o.read('distWarehouses', safeId(p.warehouseId));
    check(warehouse && warehouse.active !== false, 'Almacén no disponible.');
  }
  const entry = await o.loadStock(product.id, locationId);
  const returnedProcessingAllocations = putDerivedReturnQuarantine(o, entry, sourceAllocations, {
    location: locationId, sourceSaleId: sale.id, claimId: o.id, condition, reason, measuredWeightG,
  });
  const returnedValue = round(quantity * originalPrices[0]);
  const replacementProduct = p.kind === 'exchange' ? await o.product(safeId(p.replacementProductId)) : null;
  let replacement = null, replacementValue = 0, additionalCostCents = 0;
  if (p.kind === 'exchange') {
    const replacementQuantity = o.amount(Number(p.replacementQuantity), replacementProduct, false, quantityPrecision(replacementProduct));
    check(replacementQuantity > 0, 'Indica una cantidad válida para el reemplazo.');
    const allocations = await o.take(replacementProduct.id, locationId, replacementQuantity, { processingSale: true });
    replacementValue = round(replacementQuantity * replacementProduct.referencePrice);
    additionalCostCents = historicalAllocationCostCents(allocations);
    replacement = { productId: replacementProduct.id, productName: replacementProduct.name, quantity: replacementQuantity,
      unitType: replacementProduct.unitType, unitPrice: replacementProduct.referencePrice, total: replacementValue, allocations,
      costCents: additionalCostCents, costTotal: additionalCostCents === null ? null : additionalCostCents / 100 };
    o.ledger(replacementProduct.id, replacementQuantity, locationId, null, 'exchange', { allocations, claimId: o.id, saleId: sale.id });
  }
  const revenueDelta = round(replacementValue - returnedValue);
  const debt = await o.read('distReceivables', sale.id);
  const debtReduction = round(Math.min(debt?.balance || 0, Math.max(0, -revenueDelta)));
  if (debtReduction > 0) {
    const balance = round(debt.balance - debtReduction);
    o.put('distReceivables', debt.id, { ...debt, creditedAmount: round((debt.creditedAmount || 0) + debtReduction), balance,
      status: balance <= 0 ? 'PAID' : debt.paidAmount > 0 ? 'PARTIAL' : 'OPEN', returnedAmount: round((debt.returnedAmount || 0) + debtReduction) });
  }
  const refund = round(Math.max(0, -revenueDelta) - debtReduction);
  check((revenueDelta === 0 && ['none','cash','qr'].includes(p.method)) || (revenueDelta !== 0 && ['cash','qr'].includes(p.method)), 'Elige efectivo o QR para cobrar o devolver la diferencia.');
  const updatedSale = { ...sale, derivedReturnRevision: Number(sale.derivedReturnRevision || 0) + 1,
    derivedReturnedQuantityByProduct: { ...(sale.derivedReturnedQuantityByProduct || {}), [product.id]: returnedBefore + quantity },
    lastDerivedReturnClaimId: o.id, lastDerivedReturnAt: o.now };
  o.put('distSales', sale.id, updatedSale);
  const claim = { id: o.id, ...o.base(), kind: p.kind, saleId: sale.id, sellerUid: sale.sellerUid, sellerName: sale.sellerName,
    customerId: sale.customerId || '', customerName: sale.customerName || '', routeId: sale.routeId, productId: product.id,
    productName: product.name, unitType: product.unitType, quantity, reason, warehouseId: isDistributor ? '' : p.warehouseId || 'central',
    dispatchId: sale.dispatchId || '', receivedLocation: locationId,
    returnedValue, replacement, revenueDelta, additionalCost: additionalCostCents === null ? null : additionalCostCents / 100,
    additionalCostCents, debtReduction, cashIn: p.method === 'cash' ? Math.max(0, revenueDelta) : 0,
    cashOut: p.method === 'cash' ? refund : 0, qrIn: p.method === 'qr' ? Math.max(0, revenueDelta) : 0,
    qrOut: p.method === 'qr' ? refund : 0, method: p.method, responsibleName: o.member.displayName || o.actor,
    physicalReceiptConfirmed: true, receivedAt: o.now, receivedBy: o.actor, receivedByName: o.member.displayName || o.actor,
    derivedReturnCondition: condition, measuredPhysicalWeightG: measuredWeightG, historicalAssignedWeightG: assignedWeightG,
    unresolvedWeightDifferenceG: measuredWeightG === null || assignedWeightG === null ? null : assignedWeightG - measuredWeightG,
    returnedCostCents, costAccountingStatus: 'pending_quarantine_disposition', returnedProcessingAllocations,
    inventoryStatus: 'quarantined_review_hold', traceabilityStatus: 'accounting_lot_reference_physical_origin_unconfirmed' };
  o.put('distClaims', o.id, claim);
  return claim;
}

async function claim(o, p) {
  check(["admin", "distributor"].includes(o.member.role), "Sin permiso para registrar cambios o devoluciones.");
  check(p.reason?.trim(), "Indica el motivo del cambio o devolución.");
  check(["exchange", "return"].includes(p.kind), "Tipo de reclamo inválido.");
  const s = await o.read("distSales", p.saleId);
  check(s, "No existe la venta original.");
  check(!s.voidedAt && !s.pendingConfirmation, "La venta no está vigente para una devolución.");
  const sourceSnapshot = s.effectiveSnapshot || s;
  const targetLines = (sourceSnapshot.lines || []).filter(line => line.productId === p.productId);
  if (targetLines.some(line => (line.allocations || []).some(allocation => allocation.processingAllocation)))
    return claimDerivedSale(o, p, s);
  check(s.saleKind !== "courtesy" && s.effectiveSnapshot?.saleKind !== "courtesy", "Las cortesías no generan cambios ni devoluciones con movimientos de dinero.");
  const isDistributor = o.member.role === "distributor";
  if (isDistributor) {
    check(s.sellerUid === o.actor, "Solo puedes registrar cambios o devoluciones de tus propias ventas.");
    check(s.routeId && s.routeId === o.member.routeId, "La venta ya no corresponde a tu ruta asignada. Requiere revisión de administración.");
    const dispatch = s.dispatchId ? await o.read("distDispatches", s.dispatchId) : null;
    check(!dispatch || dispatch.status === "open", "La ruta ya está cerrada. Requiere revisión de administración.");
  }
  const effectiveSale = { ...s, ...await o.withDocumentedOrigins(s, s.effectiveSnapshot || s) };
  const orig = effectiveSale.lines.filter((l) => l.productId === p.productId);
  const sourceOriginReferences = orig.flatMap(l => origins.references(l.allocations));
  check(orig.length, "El producto no pertenece a esta venta.");
  const product = await o.read("distProducts", p.productId);
  check(product, "Producto inexistente.");
  const q = o.amount(p.quantity, product, false, quantityPrecision(product));
  const past = await o.query("distClaims", "saleId", s.id);
  check(
    roundAt(
      q +
        past
          .filter((c) => c.productId === p.productId)
          .reduce((n, c) => n + c.quantity, 0), quantityPrecision(product),
    ) <= roundAt(orig.reduce((n, l) => n + l.quantity, 0), quantityPrecision(product)),
    "La cantidad supera lo vendido o ya fue devuelta.",
  );
  const originalUnit = orig[0].actualUnitPrice;
  check(
    orig.every((l) => l.actualUnitPrice === originalUnit),
    "Esta venta tiene precios distintos para el mismo producto; revisa el comprobante con Administración.",
  );
  const loc = isDistributor ? location("route", s.routeId) : location("warehouse", p.warehouseId || "central");
  if (!isDistributor && p.warehouseId && p.warehouseId !== "central")
    check(
      (await o.read("distWarehouses", p.warehouseId))?.active,
      "Almacén no disponible.",
    );
  const e = await o.loadStock(p.productId, loc);
  const returnedValue = round(q * originalUnit);
  let replacement = null,
    replacementValue = 0,
    additionalCost = 0;
  if (p.kind === "exchange") {
    const rp = await o.product(p.replacementProductId);
    const rq = o.amount(p.replacementQuantity, rp);
    const parts = await o.take(rp.id, loc, rq);
    replacementValue = round(rq * rp.referencePrice);
    additionalCost = parts.every((a) => a.productionCost !== null)
      ? round(parts.reduce((n, a) => n + a.quantity * a.productionCost, 0))
      : null;
    replacement = {
      productId: rp.id,
      productName: rp.name,
      quantity: rq,
      unitType: rp.unitType,
      unitPrice: rp.referencePrice,
      total: replacementValue,
      allocations: parts,
      ...(rp.unitType === "package" && Number(rp.documentedPackageWeightKg) > 0 ? { documentedPackageWeightKgSnapshot: Number(rp.documentedPackageWeightKg) } : {}),
      presentationSnapshot: rp.presentation || rp.category || "",
      descriptionSnapshot: rp.description || "",
    };
    o.ledger(rp.id, rq, loc, null, "exchange", { allocations: parts });
  }
  const delta = round(replacementValue - returnedValue);
  const debt = await o.read("distReceivables", s.id);
  const debtReduction = Math.min(debt?.balance || 0, Math.max(0, -delta));
  if (debtReduction > 0) {
    const balance = round(debt.balance - debtReduction);
    o.put("distReceivables", debt.id, {
      ...debt,
      creditedAmount: round((debt.creditedAmount || 0) + debtReduction),
      balance,
      status: balance <= 0 ? "PAID" : debt.paidAmount > 0 ? "PARTIAL" : "OPEN",
      returnedAmount: round((debt.returnedAmount || 0) + debtReduction),
    });
  }
  const refund = round(Math.max(0, -delta) - debtReduction);
  check(
    (delta === 0 && ["none", "cash", "qr"].includes(p.method)) ||
      (delta !== 0 && ["cash", "qr"].includes(p.method)),
    "Elige efectivo o QR para cobrar o devolver la diferencia.",
  );
  const lotId = `${o.id}__damaged`;
  e.lots.push({
    id: lotId,
    restaurantId: "sanjose",
    productId: product.id,
    productName: product.name,
    unitType: product.unitType,
    lotCode: p.originalLotCode || "DEVOLUCIÓN DE CLIENTE",
    ...(sourceOriginReferences.length ? { sourceOriginReferences, sourceSaleId: s.id } : {}),
    manufacturedOn: "",
    expiresOn: "",
    productionCost: null,
    quarantined: true,
    quantities: { [loc]: q },
    createdAt: o.now,
    createdBy: o.actor,
    reason: p.reason,
  });
  o.move(e, loc, q);
  o.ledger(product.id, q, null, loc, "customer_return", {
    lotId,
    quarantined: true,
    note: p.reason + (sourceOriginReferences.length ? ' Venta con referencia contable de origen pendiente; la devolución queda en cuarentena sin atribuirle lote físico.' : ''),
    ...(sourceOriginReferences.length ? { sourceOriginReferences, traceabilityStatus: 'physical_origin_pending', sourceSaleId: s.id } : {}),
  });
  const c = {
    id: o.id,
    ...o.base(),
    kind: p.kind,
    saleId: s.id,
    sellerUid: s.sellerUid,
    sellerName: s.sellerName,
    customerId: s.customerId || "",
    customerName: s.customerName || "",
    routeId: s.routeId,
    productId: p.productId,
    productName: product.name,
    unitType: product.unitType,
    ...(product.unitType === "package" && orig.length && orig.every(line => Number.isFinite(line.documentedPackageWeightKgSnapshot) && line.documentedPackageWeightKgSnapshot === orig[0].documentedPackageWeightKgSnapshot)
      ? { documentedPackageWeightKgSnapshot: orig[0].documentedPackageWeightKgSnapshot }
      : {}),
    ...(orig[0]?.presentationSnapshot ? { presentationSnapshot: orig[0].presentationSnapshot } : {}),
    ...(orig[0]?.descriptionSnapshot ? { descriptionSnapshot: orig[0].descriptionSnapshot } : {}),
    quantity: q,
    reason: p.reason,
    warehouseId: p.warehouseId || "central",
    returnedValue,
    replacement,
    revenueDelta: delta,
    additionalCost,
    debtReduction,
    cashIn: p.method === "cash" ? Math.max(0, delta) : 0,
    cashOut: p.method === "cash" ? refund : 0,
    qrIn: p.method === "qr" ? Math.max(0, delta) : 0,
    qrOut: p.method === "qr" ? refund : 0,
    method: p.method,
    responsibleName: o.member.displayName || o.actor,
  };
  o.put("distClaims", o.id, c);
  return c;
}
Object.assign(handlers, { adjustment, adjustmentRequest, reviewAdjustmentRequest, expense, deleteExpense, saveExpenseCategory, deleteExpenseCategory, saveExpenseGroup, deleteExpenseGroup, saveExpenseSupplier, registerSupplierPurchase, paySupplierPayable, voidSupplierPayment, voidSupplierPurchase, classifyExpense, deleteProduct, closure, claim });

function reservationEvent(o, reservation, action, quantity, reason = '') {
  const history = [...(reservation.history || []), { id: `${o.id}__event`, action, quantity, at: o.now, by: o.actor, byName: o.member.displayName || o.actor, reason }];
  return { ...reservation, history, updatedAt: o.now, updatedBy: o.actor };
}

async function reservationContext(o, p, { allowProcessingOutput = false, allowProcessingRepack = false } = {}) {
  const product = await o.product(safeId(p.productId));
  const loc = String(p.location || '');
  check(loc === 'central' || loc.startsWith('warehouse__'), 'La reserva debe pertenecer a un almacén autorizado.');
  o.owns(loc);
  if (loc !== 'central') {
    const warehouse = await o.read('distWarehouses', safeId(loc.slice('warehouse__'.length)));
    check(warehouse && warehouse.active !== false, 'El almacén seleccionado no está disponible.');
  }
  const e = await o.loadStock(product.id, loc);
  const lot = e.lots.find(row => row.id === safeId(p.lotId));
  check(lot && lot.productId === product.id, 'El lote no corresponde al producto.');
  const repackableDerived = allowProcessingRepack && p.purpose === 'repack_pending' && lot.processingCommercialBlocked === true && lot.processingDestinationKind === 'finished' && Array.isArray(lot.processingByLocation?.[loc]?.segments) && !lot.derivedReturn;
  check(!lot.processingCommercialBlocked || allowProcessingOutput && lot.processingDestinationKind === 'courtesy' || repackableDerived, 'El lote derivado de elaboración sigue bloqueado para nuevas reservas comerciales.');
  if (repackableDerived) o.assertProcessingLocation(lot, loc);
  check(!lot.legacy && !/^legacy_|ANTERIOR SIN FECHAS/i.test(`${lot.id} ${lot.lotCode || ''}`), 'No se puede reservar un lote sintético o anterior sin fechas.');
  check(!lot.quarantined && (!lot.expiresOn || lot.expiresOn >= o.today), 'El lote está vencido o en cuarentena.');
  check(!origins.pending(lot, loc) && !Object.keys(lot.pendingOrigins || {}).some(key => origins.pending(lot, key) > 0), 'El lote tiene origen físico pendiente.');
  const rows = await o.processingReservations(lot.id);
  o.assertReservationAggregate(lot, loc, rows);
  return { product, loc, e, lot, rows };
}

handlers.reserveProcessingStock = async (o, p) => {
  check(['admin','warehouse'].includes(o.member.role), 'Solo Almacén o Administración pueden reservar producto.');
  const { product, loc, lot, rows } = await reservationContext(o, p, { allowProcessingRepack: p.purpose === 'repack_pending' });
  const purpose = p.purpose;
  check(['courtesy','repack_pending','review_hold'].includes(purpose), 'La finalidad de la reserva no es válida.');
  const quantity = o.amount(Number(p.quantity), product, false, quantityPrecision(product));
  check(purpose !== 'review_hold' || o.member.role === 'admin', 'Solo Administración puede inmovilizar producto para revisión.');
  check(purpose !== 'repack_pending' || o.member.role === 'admin' || o.member.role === 'warehouse', 'No tienes permiso para inmovilizar producto.');
  const held = lot.processingUnavailable?.[loc] || { courtesy: 0, repackPending: 0, reviewHold: 0 };
  const free = roundAt(Number(lot.quantities?.[loc] || 0) - origins.pending(lot, loc) - held.courtesy - held.repackPending - held.reviewHold, quantityPrecision(product));
  check(free >= quantity, `Stock libre insuficiente; disponible ${free}.`);
  const reservationId = safeId(p.reservationId || `${o.id}__reservation`);
  check(!rows.some(r => r.id === reservationId) && !await o.read('distStockReservations', reservationId), 'La reserva ya existe.');
  let processingSegments;
  let physicalWeightG = product.unitType === 'kg'
    ? Math.round(quantity * 1000)
    : Number.isSafeInteger(p.physicalWeightG) && p.physicalWeightG > 0 ? p.physicalWeightG : null;
  let remainingCostCents = null;
  if (purpose === 'repack_pending') {
    check(!rows.some(row => row.lotId === lot.id && row.location === loc && row.purpose === 'repack_pending' && ['active','partially_consumed'].includes(row.status) && Number(row.remainingQuantity) > 0),
      'Completa o procesa la reserva de reenvasado activa de este lote antes de crear otra.');
    if (!lot.processingCommercialBlocked && typeof lot.productionCost === 'number' && Number.isFinite(lot.productionCost) && lot.productionCost >= 0) {
      const costCents = Math.round((Number(quantity) * lot.productionCost + Number.EPSILON) * 100);
      remainingCostCents = Number.isSafeInteger(costCents) && costCents >= 0 ? costCents : null;
    }
  }
  if (lot.processingCommercialBlocked && purpose === 'repack_pending') {
    let quantityLeft = quantity;
    let costKnown = true;
    let costTotal = 0;
    processingSegments = [];
    for (const segment of lot.processingByLocation[loc].segments) {
      if (quantityLeft <= 0) break;
      const segmentQuantity = Number(segment.remainingQuantity || 0);
      const selectedQuantity = Math.min(quantityLeft, segmentQuantity);
      if (selectedQuantity <= 0) continue;
      const selectedWeightG = integerShare(segment.remainingWeightG, 0, selectedQuantity, segmentQuantity);
      const selectedCostCents = integerShare(segment.remainingCostCents, 0, selectedQuantity, segmentQuantity);
      processingSegments.push({ batchId: segment.batchId, segmentId: segment.segmentId, quantity: selectedQuantity, remainingWeightG: selectedWeightG, remainingCostCents: selectedCostCents });
      if (selectedCostCents === null) costKnown = false; else costTotal += selectedCostCents;
      quantityLeft = roundAt(quantityLeft - selectedQuantity, 0);
    }
    check(quantityLeft === 0 && processingSegments.length > 0, 'No se pudo reservar una asignación completa de segmentos derivados.');
    const segmentWeight = processingSegments.reduce((sum, segment) => sum + segment.remainingWeightG, 0);
    check(Number.isSafeInteger(segmentWeight) && segmentWeight > 0, 'Los segmentos reservados no conservan gramos físicos medidos.');
    physicalWeightG = segmentWeight;
    remainingCostCents = costKnown ? costTotal : null;
  }
  check(product.unitType === 'kg' || physicalWeightG !== null || p.physicalWeightG == null, 'El peso físico informado no es válido.');
  const reservation = {
    id: reservationId, restaurantId: 'sanjose', branchId: 'main', schemaVersion: 1,
    productId: product.id, productName: product.name, lotId: lot.id, lotCode: lot.lotCode,
    unitType: product.unitType, location: loc, purpose, originalQuantity: quantity,
    remainingQuantity: quantity, consumedQuantity: 0, physicalWeightG,
    remainingWeightG: physicalWeightG, ...(purpose === 'repack_pending' || lot.processingCommercialBlocked ? { remainingCostCents } : {}), ...(processingSegments ? { processingSegments } : {}), status: 'active', source: String(p.source || 'manual').slice(0,80),
    ...(p.batchId ? { batchId: safeId(p.batchId) } : {}),
    createdAt: o.now, createdBy: o.actor, createdByName: o.member.displayName || o.actor,
    history: [{ id: `${o.id}__created`, action: 'created', quantity, at: o.now, by: o.actor, byName: o.member.displayName || o.actor, reason: String(p.reason || '').trim() }],
  };
  const totals = { ...held, [purpose === 'repack_pending' ? 'repackPending' : purpose === 'review_hold' ? 'reviewHold' : 'courtesy']: roundAt(Number(held[purpose === 'repack_pending' ? 'repackPending' : purpose === 'review_hold' ? 'reviewHold' : 'courtesy'] || 0) + quantity, quantityPrecision(product)) };
  lot.processingUnavailable = { ...(lot.processingUnavailable || {}), [loc]: totals };
  o.put('distStockReservations', reservation.id, reservation);
  const movementId = o.ledger(product.id, quantity, loc, loc, 'reservation_created', { lotId: lot.id, reservationId: reservation.id, reservationPurpose: purpose, physicalEffect: false, note: String(p.reason || '').trim() }, quantityPrecision(product));
  reservation.movementId = movementId;
  o.put('distStockReservations', reservation.id, reservation);
  return { reservationId, quantity, physicalQuantity: Number(lot.quantities?.[loc] || 0), availableQuantity: roundAt(free - quantity, quantityPrecision(product)) };
};

handlers.recordProcessingReview = async (o, p) => {
  check(['admin','warehouse'].includes(o.member.role), 'Solo Administración o Almacén pueden registrar una revisión física.');
  const lotId = safeId(p.lotId), reservationId = safeId(p.reservationId);
  const loc = p.location;
  check(loc === 'central' || typeof loc === 'string' && loc.startsWith('warehouse__'), 'La ubicación de revisión no es válida.');
  o.owns(loc);
  const lot = await o.read('distLots', lotId);
  check(lot, 'No existe el lote inmovilizado indicado.');
  const product = await o.read('distProducts', lot.productId);
  check(product && product.active !== false, 'El producto de la revisión no está disponible.');
  const reservation = await o.read('distStockReservations', reservationId);
  check(reservation && reservation.lotId === lot.id && reservation.productId === product.id && reservation.location === loc,
    'La reserva no corresponde al lote, producto y ubicación seleccionados.');
  check(['active','partially_consumed'].includes(reservation.status) && ['repack_pending','review_hold'].includes(reservation.purpose) && Number(reservation.remainingQuantity) > 0,
    'La reserva no tiene producto inmovilizado pendiente de revisión.');
  check(Number(lot.quantities?.[loc] || 0) >= Number(reservation.remainingQuantity), 'La cantidad física del lote no cubre la reserva; requiere conciliación antes de revisarlo.');
  if (lot.derivedReturn) check(lot.derivedReturn.reservationId === reservation.id && reservation.purpose === 'review_hold',
    'La devolución derivada no coincide con su reserva de revisión.');
  const reservations = await o.processingReservations(lot.id);
  o.assertReservationAggregate(lot, loc, reservations);
  const balance = await o.read('distBalances', balanceId(loc, product.id));
  const productLots = await o.query('distLots', 'productId', product.id);
  const physicalTotal = roundAt(Number(balance?.quantity || 0), quantityPrecision(product));
  const lotTotal = roundAt(productLots.reduce((sum, item) => sum + Number(item.quantities?.[loc] || 0), 0), quantityPrecision(product));
  check(Math.abs(physicalTotal - lotTotal) < 0.5 / (10 ** quantityPrecision(product)), 'El balance físico y sus lotes no concilian. No se guardó la revisión.');
  check(Number.isSafeInteger(p.expectedRevision) && p.expectedRevision === Number(lot.processingReview?.revision || 0),
    'La revisión cambió en otra sesión. Actualiza el lote antes de guardar.');
  const actions = ['record_observation','start_review','request_information','authorize_repack','declare_unrecoverable','mark_pending_economic_disposition','record_disposition_assessment'];
  check(actions.includes(p.action), 'La acción de revisión no es válida.');
  const packageConditions = ['sealed_intact','package_damaged_content_intact','package_damaged_partial','no_package','unknown'];
  const observationsAllowed = ['apparently_apt','uncertain','confirmed_unfit','not_assessed'];
  check(packageConditions.includes(p.packageCondition) && observationsAllowed.includes(p.productObservation), 'Describe la condición observada del envase y del producto.');
  const observations = String(p.observations || '').trim(), reason = String(p.reason || '').trim();
  check(observations.length >= 3 && observations.length <= 2000 && reason.length >= 3 && reason.length <= 500, 'Registra observaciones y motivo (3 a 500 caracteres; observación hasta 2.000).');
  check(Array.isArray(p.evidenceRefs) && p.evidenceRefs.length <= 10 && p.evidenceRefs.every(ref => typeof ref === 'string' && ref.trim().length > 0 && ref.length <= 240), 'Las referencias de evidencia no son válidas.');
  const physicalWeightG = p.physicalWeightG;
  check(physicalWeightG === null || Number.isSafeInteger(physicalWeightG) && physicalWeightG >= 0, 'El peso físico debe ser un entero de gramos medidos o null si no se midió.');
  const caseId = lot.processingReview?.caseId || o.id;
  const qualityAction = ['authorize_repack','declare_unrecoverable','record_disposition_assessment'].includes(p.action);
  const qualityAuthorization = qualityAction ? await activeQualityAuthorization(o, String(p.qualityAuthorizationRef || '').trim()) : null;
  if (qualityAction) check(o.member.role === 'admin' && qualityAuthorization, 'La decisión requiere una autorización de calidad vigente concedida por el mecanismo privilegiado.');
  if (p.evidenceRefs.length) check(await verifyProcessingEvidence(o, p.evidenceRefs, { lotId, reservationId, reviewCaseId: caseId, reviewRevision: p.expectedRevision, location: loc }),
    'La evidencia no existe, no está verificada o no corresponde a este lote, revisión, reserva y ubicación.');
  let status = lot.processingReview?.status || 'pending_review';
  let qualityDecision;
  let economicDispositionStatus = lot.processingReview?.economicDispositionStatus;
  let dispositionAssessment;
  const currentStatus = status;
  if (p.action === 'start_review') {
    check(['pending_review','in_review','pending_information'].includes(currentStatus), 'Una decisión ya registrada no se puede reabrir desde la revisión genérica.');
    status = 'in_review';
  }
  if (p.action === 'request_information') {
    check(['pending_review','in_review','pending_information'].includes(currentStatus), 'La revisión ya tiene una decisión; no se puede cambiar mediante una solicitud genérica.');
    status = 'pending_information';
  }
  if (p.action === 'mark_pending_economic_disposition') {
    check(o.member.role === 'admin', 'Solo Administración puede marcar pendiente la disposición económica.');
    check(['in_review','pending_information','not_recoverable','pending_economic_disposition'].includes(currentStatus), 'Primero debe existir una revisión que requiera decisión económica.');
    status = 'pending_economic_disposition';
    economicDispositionStatus = 'pending_quarantine_disposition';
  }
  if (p.action === 'record_disposition_assessment') {
    check(o.member.role === 'admin' && qualityAuthorization, 'La evaluación de destino requiere una autorización de calidad vigente concedida por el mecanismo privilegiado.');
    check(['in_review','pending_information','not_recoverable','pending_economic_disposition'].includes(currentStatus), 'Primero debe existir una revisión física documentada.');
    check(p.evidenceRefs.length > 0, 'Una evaluación de destino requiere evidencia persistida y verificada.');
    const outcome = String(p.dispositionOutcome || '');
    check(['recoverable','partially_recoverable','discard_pending','undetermined'].includes(outcome), 'Selecciona el resultado de evaluación permitido.');
    const recoverableWeightG = p.recoverableWeightG;
    const discardWeightG = p.discardWeightG;
    if (outcome === 'undetermined') {
      check(recoverableWeightG == null && discardWeightG == null, 'Una evaluación indeterminada no puede asignar gramos a recuperación o descarte.');
    } else {
      check(physicalWeightG !== null && Number.isSafeInteger(recoverableWeightG) && recoverableWeightG >= 0
        && Number.isSafeInteger(discardWeightG) && discardWeightG >= 0
        && recoverableWeightG + discardWeightG === physicalWeightG,
      'Los gramos medidos deben distribuirse exactamente entre la evaluación recuperable y el descarte pendiente.');
      if (outcome === 'recoverable') check(recoverableWeightG === physicalWeightG && discardWeightG === 0, 'La evaluación recuperable debe asignar todo el peso medido a recuperación.');
      if (outcome === 'partially_recoverable') check(recoverableWeightG > 0 && discardWeightG > 0, 'La evaluación parcial requiere gramos positivos en ambos destinos propuestos.');
      if (outcome === 'discard_pending') check(recoverableWeightG === 0 && discardWeightG === physicalWeightG, 'El descarte pendiente debe corresponder al peso medido completo.');
    }
    const assessedAt = o.now;
    dispositionAssessment = { outcome, measuredWeightG: physicalWeightG, recoverableWeightG: recoverableWeightG ?? null,
      discardWeightG: discardWeightG ?? null, status: 'pending_owner_policy', recordedAt: assessedAt,
      recordedBy: o.actor, recordedByName: o.member.displayName || o.actor, qualityAuthorizationRef: qualityAuthorization.id,
      evidenceRefs: p.evidenceRefs.map(ref => ref.trim()) };
    status = 'pending_economic_disposition';
    economicDispositionStatus = 'pending_quarantine_disposition';
  }
  if (p.action === 'authorize_repack' || p.action === 'declare_unrecoverable') {
    check(o.member.role === 'admin' && qualityAuthorization, 'La decisión requiere una autorización de calidad vigente concedida por el mecanismo privilegiado.');
    check(Array.isArray(p.evidenceRefs) && p.evidenceRefs.length > 0, 'Una decisión de calidad requiere evidencia persistida y verificada.');
    check(currentStatus === 'in_review', 'Primero inicia y documenta la revisión física antes de decidir el destino.');
    if (p.action === 'authorize_repack') {
      check(p.productObservation === 'apparently_apt' && p.packageCondition !== 'unknown' && physicalWeightG !== null,
        'Para autorizar el procedimiento de reenvasado se requiere condición observada, peso neto medido y evidencia; esto no libera producto para venta.');
      check(!lot.expiresOn || lot.expiresOn >= o.today, 'El lote está vencido; no se puede autorizar reenvasado para uso comercial.');
      status = 'authorized_for_repack';
      qualityDecision = 'authorized_for_repack';
    } else {
      check(p.productObservation === 'confirmed_unfit', 'Confirma la no aptitud observada antes de solicitar disposición.');
      status = 'not_recoverable';
      economicDispositionStatus = 'pending_quarantine_disposition';
      qualityDecision = 'not_recoverable';
    }
  }
  if (p.productObservation === 'confirmed_unfit') check(['declare_unrecoverable','record_disposition_assessment'].includes(p.action),
    'La observación de no aptitud requiere una decisión de calidad autorizada; no se cambió el estado económico ni físico.');
  const revision = Number(lot.processingReview?.revision || 0) + 1;
  const historicalAssignedWeightG = Number.isSafeInteger(reservation.remainingWeightG)
    ? reservation.remainingWeightG
    : Number.isSafeInteger(lot.derivedReturn?.assignedWeightG) ? lot.derivedReturn.assignedWeightG : null;
  const weightDifferenceG = historicalAssignedWeightG === null || physicalWeightG === null ? null : historicalAssignedWeightG - physicalWeightG;
  let costCents = reservation.remainingCostCents;
  if (costCents === undefined) {
    const historicalUnitCost = lot.productionCost;
    costCents = typeof historicalUnitCost === 'number' && Number.isFinite(historicalUnitCost) && historicalUnitCost >= 0
      ? Math.round(Number(reservation.remainingQuantity) * historicalUnitCost * 100)
      : null;
  }
  check(costCents === null || Number.isSafeInteger(costCents) && costCents >= 0, 'El costo histórico de la reserva no se puede verificar.');
  const revisionId = o.id;
  check(!await o.read('distProcessingReviews', revisionId), 'La revisión ya existe.');
  const review = {
    id: revisionId, caseId, operationId: o.id, ...o.base(), lotId, productId: product.id, productName: product.name,
    ...(product.sku || product.code ? { sku: product.sku || product.code } : {}), lotCode: lot.lotCode || lot.id,
    ...(reservation.batchId || lot.processingBatchId ? { batchId: reservation.batchId || lot.processingBatchId } : {}),
    ...(lot.derivedReturn?.sourceSaleId ? { sourceSaleId: lot.derivedReturn.sourceSaleId } : {}),
    sourceLotIds: lot.derivedReturn?.sourceLotId ? [lot.derivedReturn.sourceLotId] : lot.processingSourceLotIds || [],
    reservationId, reservationPurpose: reservation.purpose, location: loc,
    commercialQuantity: Number(reservation.remainingQuantity), commercialUnit: product.unitType,
    historicalAssignedWeightG, physicalWeightG, weightDifferenceG, costCents,
    packageCondition: p.packageCondition, productObservation: p.productObservation,
    status, action: p.action, observations, reason, evidenceRefs: p.evidenceRefs.map(ref => ref.trim()), revision,
    ...(qualityDecision ? { qualityDecision, qualityAuthorizationRef: qualityAuthorization.id } : {}),
    ...(dispositionAssessment ? { dispositionAssessment } : {}),
    ...(p.evidenceRefs.length ? { evidenceRevision: p.expectedRevision } : {}),
    ...(economicDispositionStatus ? { economicDispositionStatus } : {}),
    previousStatus: currentStatus, reviewedAt: o.now, reviewedBy: o.actor, reviewedByName: o.member.displayName || o.actor,
  };
  const updatedLot = { ...lot, processingReview: { caseId, latestReviewId: revisionId, revision, status, updatedAt: o.now, updatedBy: o.actor, ...(economicDispositionStatus ? { economicDispositionStatus } : {}) } };
  o.put('distProcessingReviews', revisionId, review);
  o.put('distLots', lot.id, updatedLot);
  return { reviewId: revisionId, revision, status, commercialQuantity: review.commercialQuantity, historicalAssignedWeightG, physicalWeightG, weightDifferenceG, costCents, stockChanged: false, reservationChanged: false, movementCreated: false };
};

handlers.recordProcessingEvidence = async (o, p) => {
  check(['admin','warehouse'].includes(o.member.role), 'Solo Administración o Almacén pueden adjuntar evidencia de calidad.');
  const lotId = safeId(p.lotId), reservationId = safeId(p.reservationId), evidenceId = safeId(p.evidenceId);
  const locationId = String(p.location || ''), caseId = safeId(p.reviewCaseId);
  check(locationId === 'central' || /^warehouse__[^/]+$/.test(locationId), 'La ubicación de la evidencia no es válida.');
  o.owns(locationId);
  check(Number.isSafeInteger(p.reviewRevision) && p.reviewRevision >= 1, 'La evidencia debe vincularse a una revisión existente.');
  check(['photo','measurement_record','signed_quality_record'].includes(p.evidenceType), 'El tipo de evidencia no es válido.');
  const lot = await o.read('distLots', lotId);
  const reservation = await o.read('distStockReservations', reservationId);
  const review = lot?.processingReview?.latestReviewId ? await o.read('distProcessingReviews', lot.processingReview.latestReviewId) : null;
  check(lot && reservation && review && reservation.lotId === lotId && reservation.location === locationId
    && ['active','partially_consumed'].includes(reservation.status) && ['repack_pending','review_hold'].includes(reservation.purpose)
    && lot.processingReview.caseId === caseId && review.caseId === caseId && review.reservationId === reservationId
    && review.location === locationId && review.revision === p.reviewRevision && lot.processingReview.revision === p.reviewRevision,
  'La evidencia no corresponde a la revisión vigente de esta reserva y ubicación.');
  const bucket = process.env.SANJOSE_PROCESSING_EVIDENCE_BUCKET;
  check(bucket, 'Falta configurar el bucket oficial de evidencias; no se registró la referencia.');
  const objectPath = `processing-evidence/sanjose/${locationId}/${reservationId}/${caseId}/${p.reviewRevision}/${o.actor}/${evidenceId}`;
  const verified = await verifyProcessingEvidenceObject(bucket, objectPath,
    { lotId, reservationId, reviewCaseId: caseId, reviewRevision: p.reviewRevision, location: locationId, evidenceType: p.evidenceType }, o.actor);
  check(verified, 'El archivo no existe, excede el límite, tiene metadatos incompatibles o su SHA-256 no coincide.');
  check(!await o.read('distProcessingEvidence', evidenceId), 'El identificador de evidencia ya está registrado.');
  const record = { id: evidenceId, ...o.base(), restaurantId: 'sanjose', status: 'verified', evidenceType: p.evidenceType,
    lotId, reservationId, reviewCaseId: caseId, reviewRevision: p.reviewRevision, location: locationId,
    uploadedBy: o.actor, recordedAt: o.now, ...verified, viewers: [o.actor], verificationMethod: 'server_sha256_generation' };
  o.put('distProcessingEvidence', evidenceId, record);
  return { evidenceId, status: 'verified', objectGeneration: verified.objectGeneration, sha256: verified.sha256 };
};

handlers.confirmProcessingRepack = async (o, p) => {
  check(processingRepackAvailable(), 'El reenvasado requiere la configuración server-side de su bucket y activación; en producción permanece bloqueado hasta que ambas estén validadas.');
  check(['admin','warehouse'].includes(o.member.role), 'Solo Administración o Almacén pueden confirmar un reenvasado autorizado.');
  const repackId = safeId(p.repackId), operationId = o.id;
  check(typeof p.reason === 'string' && p.reason.trim().length >= 3 && p.reason.trim().length <= 500,
    'El motivo del reenvasado debe tener entre 3 y 500 caracteres.');
  const repackRef = o.ref('distProcessingRepackings', repackId);
  const prior = await o.tx.get(repackRef);
  const payloadHash = sha256({ ...p, operationId: undefined });
  if (prior.exists) {
    const saved = prior.data();
    check(saved.payloadHash === payloadHash, 'El repackId ya fue utilizado con datos diferentes.');
    return { ...saved.result, duplicate: true };
  }
  const existingBatch = await o.tx.get(o.ref('distProcessingBatches', repackId));
  check(!existingBatch.exists, 'El repackId ya existe como otra elaboración.');
  const lotId = safeId(p.sourceLotId), reservationId = safeId(p.reservationId), reviewId = safeId(p.reviewId), loc = String(p.location || '');
  check(loc === 'central' || /^warehouse__[^/]+$/.test(loc), 'La ubicación del reenvasado no es válida.');
  o.owns(loc);
  if (loc !== 'central') {
    const warehouse = await o.read('distWarehouses', safeId(loc.slice('warehouse__'.length)));
    check(warehouse && warehouse.active !== false, 'El almacén de origen no está disponible.');
  }
  const lot = await o.read('distLots', lotId);
  check(lot && !lot.legacy && !lot.synthetic && !/^legacy_|ANTERIOR SIN FECHAS/i.test(`${lot.id} ${lot.lotCode || ''}`), 'El lote de origen no es verificable o requiere conciliación.');
  check(!lot.quarantined && !lot.derivedReturn && !lot.pendingEconomicDisposition && !lot.processingReview?.economicDispositionStatus,
    'La devolución o cuarentena tiene una disposición económica pendiente y no puede reenvasarse.');
  check(validDate(lot.manufacturedOn) && validDate(lot.expiresOn) && lot.expiresOn >= o.today && lot.expiresOn >= lot.manufacturedOn,
    'El lote está vencido o carece de fechas verificables.');
  check(!origins.pending(lot, loc), 'El lote tiene procedencia física pendiente.');
  const product = await o.product(lot.productId);
  check(product.unitType === p.sourceUnitType, 'La unidad de origen cambió; actualiza la solicitud.');
  const reservation = await o.read('distStockReservations', reservationId);
  check(reservation && reservation.id === reservationId && reservation.lotId === lotId && reservation.productId === product.id && reservation.location === loc
    && reservation.purpose === 'repack_pending' && ['active','partially_consumed'].includes(reservation.status),
  'El producto no tiene una reserva activa de reenvasado en esa ubicación.');
  check(Number.isFinite(p.expectedReservationQuantity) && reservation.remainingQuantity === p.expectedReservationQuantity,
    'La reserva cambió desde que se preparó el reenvasado. Actualiza sus cantidades.');
  const review = await o.read('distProcessingReviews', reviewId);
  check(review && review.id === reviewId && review.lotId === lotId && review.reservationId === reservationId && review.location === loc
    && review.caseId === lot.processingReview?.caseId && lot.processingReview?.latestReviewId === reviewId
    && review.status === 'authorized_for_repack' && review.qualityDecision === 'authorized_for_repack'
    && review.revision === p.expectedReviewRevision && lot.processingReview?.revision === p.expectedReviewRevision,
  'La revisión no está autorizada o cambió desde su aprobación.');
  check(Number.isSafeInteger(review.physicalWeightG) && review.physicalWeightG >= p.openedPhysicalWeightG,
    'La revisión no contiene una medición física suficiente para esta porción.');
  const authorization = await activeQualityAuthorization(o, p.authorizationReference, review.reviewedBy);
  check(authorization && authorization.id === review.qualityAuthorizationRef, 'La autorización de calidad de la revisión fue revocada, venció o ya no corresponde.');
  check(await verifyProcessingEvidence(o, p.evidenceRefs, { lotId, reservationId, reviewCaseId: review.caseId, reviewRevision: review.evidenceRevision, location: loc }),
    'La evidencia del reenvasado no existe, no está verificada o no corresponde a este caso y ubicación.');
  const reservations = await o.processingReservations(lotId);
  o.assertReservationAggregate(lot, loc, reservations);
  const expectedReservationQuantity = o.amount(Number(p.expectedReservationQuantity), product, false, quantityPrecision(product));
  check(expectedReservationQuantity <= reservation.remainingQuantity, 'La cantidad solicitada excede la reserva activa.');
  const quantityPrecisionForSource = quantityPrecision(product);
  const openedQuantity = o.amount(Number(p.openedCommercialQuantity), product, false, quantityPrecisionForSource);
  check(openedQuantity <= reservation.remainingQuantity, 'La cantidad comercial abierta supera la reserva.');
  const physicalWeightG = Number(p.openedPhysicalWeightG);
  check(Number.isSafeInteger(physicalWeightG) && physicalWeightG > 0, 'Registra el peso neto realmente medido al abrir el producto, en gramos enteros.');
  if (product.unitType === 'kg') check(physicalWeightG === Math.round(openedQuantity * 1000), 'Para producto a granel, el peso medido debe coincidir con la cantidad en kg abierta.');
  check(reservation.remainingWeightG !== null && Number.isSafeInteger(reservation.remainingWeightG), 'La reserva no tiene peso físico verificable; no se pueden inventar gramos para reenvasar.');
  check(physicalWeightG <= reservation.remainingWeightG, 'El peso medido supera el peso histórico asignado a la reserva; hay una diferencia de procedencia pendiente.');

  const derivedSource = lot.processingCommercialBlocked === true;
  check((p.sourceKind === 'derived_lot') === derivedSource, 'El tipo de origen no coincide con el lote guardado en el servidor.');
  const e = await o.loadStock(product.id, loc);
  const sourceLot = e.lots.find(row => row.id === lotId);
  check(sourceLot && Number(sourceLot.quantities?.[loc] || 0) >= openedQuantity, 'El lote no conserva cantidad física suficiente.');
  const currentUnavailable = sourceLot.processingUnavailable?.[loc] || { courtesy: 0, repackPending: 0, reviewHold: 0 };
  const repackHeld = roundAt(Number(currentUnavailable.repackPending || 0) - openedQuantity, quantityPrecisionForSource);
  check(repackHeld >= 0, 'El agregado de producto reservado no cubre el reenvasado.');

  let expectedWeightG;
  let expectedCostCents = null;
  let selectedProcessingSegments = [];
  if (derivedSource) {
    check(sourceLot.processingDestinationKind === 'finished' && sourceLot.processingSourceAllocationBasis
      && !sourceLot.derivedReturn && Array.isArray(p.sourceSegments) && p.sourceSegments.length > 0 && p.sourceSegments.length <= 100,
    'Solo se puede reenvasar inventario derivado no vendido con segmentos verificables; devoluciones comerciales requieren política económica aprobada.');
    o.assertProcessingLocation(sourceLot, loc);
    const remainingSegments = sourceLot.processingByLocation?.[loc]?.segments || [];
    check(Array.isArray(reservation.processingSegments) && reservation.processingSegments.length > 0, 'La reserva derivada no conserva sus segmentos de origen. Libérala solo mediante revisión autorizada.');
    check(reservation.processingSegments.reduce((sum, segment) => sum + Number(segment.quantity || 0), 0) === reservation.remainingQuantity
      && reservation.processingSegments.reduce((sum, segment) => sum + Number(segment.remainingWeightG || 0), 0) === reservation.remainingWeightG,
    'La asignación de segmentos de la reserva no concilia con su cantidad o peso.');
    const reservedCostCents = reservation.processingSegments.some(segment => segment.remainingCostCents === null || segment.remainingCostCents === undefined)
      ? null : reservation.processingSegments.reduce((sum, segment) => sum + segment.remainingCostCents, 0);
    if (reservation.remainingCostCents !== undefined) check(reservedCostCents === reservation.remainingCostCents,
      'El costo de los segmentos reservados no concilia con el costo agregado de la reserva.');
    const seen = new Set();
    let remainingCommercial = openedQuantity;
    let selectedWeightG = 0;
    let selectedCostCents = 0;
    let selectedCostKnown = true;
    const expectedRefs = [];
    for (const reservedSegment of reservation.processingSegments) {
      if (remainingCommercial <= 0) break;
      const segment = remainingSegments.find(item => item.segmentId === reservedSegment.segmentId && item.batchId === reservedSegment.batchId);
      check(segment, 'Un segmento reservado ya no existe en el lote.');
      const count = Math.min(remainingCommercial, Number(reservedSegment.quantity || 0));
      if (count <= 0) continue;
      const refKey = `${segment.batchId}:${segment.segmentId}`;
      check(!seen.has(refKey), 'El lote contiene segmentos duplicados.'); seen.add(refKey);
      const weight = integerShare(segment.remainingWeightG, 0, count, segment.remainingQuantity);
      const cost = integerShare(segment.remainingCostCents, 0, count, segment.remainingQuantity);
      if (count === reservedSegment.quantity) check(weight === reservedSegment.remainingWeightG && cost === reservedSegment.remainingCostCents, 'Los segmentos de la reserva no coinciden con las asignaciones vigentes del lote.');
      selectedProcessingSegments.push({ batchId: segment.batchId, segmentId: segment.segmentId, quantity: count, weightG: weight, costCents: cost });
      selectedWeightG += weight;
      if (cost === null) selectedCostKnown = false; else selectedCostCents += cost;
      expectedRefs.push({ batchId: segment.batchId, segmentId: segment.segmentId });
      remainingCommercial = roundAt(remainingCommercial - count, 0);
    }
    check(remainingCommercial === 0 && JSON.stringify(expectedRefs) === JSON.stringify(p.sourceSegments), 'Las referencias de segmentos no coinciden en orden y cantidad con el origen vigente.');
    expectedWeightG = selectedWeightG;
    expectedCostCents = selectedCostKnown ? selectedCostCents : null;
    if (reservation.remainingCostCents !== undefined && openedQuantity === reservation.remainingQuantity) check(reservation.remainingCostCents === expectedCostCents,
      'El costo completo retenido en la reserva no concilia con los segmentos seleccionados.');
  } else {
    check(!sourceLot.processingByLocation && !sourceLot.processingBatchId && !sourceLot.derivedReturn, 'El lote tradicional contiene rastros de una elaboración y requiere revisión especializada.');
    if (product.unitType === 'kg') expectedWeightG = Math.round(openedQuantity * 1000);
    else {
      check(openedQuantity === reservation.remainingQuantity, 'Para reenvasar parcialmente un lote tradicional por paquetes se requiere una asignación de peso verificada por paquete.');
      expectedWeightG = reservation.remainingWeightG;
    }
    if (typeof sourceLot.productionCost === 'number' && Number.isFinite(sourceLot.productionCost) && sourceLot.productionCost >= 0) {
      const wholeCost = Number.isSafeInteger(reservation.remainingCostCents) ? reservation.remainingCostCents
        : Math.round(Number(reservation.remainingQuantity) * sourceLot.productionCost * 100);
      const quantityScale = product.unitType === 'kg' ? 1000 : 1;
      const wholeQuantityTicks = Math.round(Number(reservation.remainingQuantity) * quantityScale);
      const openedQuantityTicks = Math.round(openedQuantity * quantityScale);
      expectedCostCents = integerShare(wholeCost, 0, openedQuantityTicks, wholeQuantityTicks);
      check(Number.isSafeInteger(expectedCostCents) && expectedCostCents >= 0, 'El costo histórico del lote no se pudo asignar exactamente.');
    }
  }
  check(expectedWeightG === physicalWeightG, `El peso medido (${physicalWeightG} g) no coincide con los ${expectedWeightG} g asignados al origen. La diferencia debe permanecer pendiente; no se creó stock.`);
  check(review.physicalWeightG === reservation.remainingWeightG, 'La medición de la revisión no coincide con el saldo físico reservado. Registra una revisión actualizada.');

  const outputs = p.outputs;
  check(Array.isArray(outputs) && outputs.length > 0 && outputs.length <= 30, 'Agrega entre 1 y 30 presentaciones de salida.');
  const seenOutputIds = new Set();
  const seenOutputLotKeys = new Set();
  const targetEntries = new Map();
  let outputWeightG = 0;
  for (const output of outputs) {
    const outputId = safeId(output.id), productId = safeId(output.productId);
    check(!seenOutputIds.has(outputId), 'No repitas destinos de reenvasado.'); seenOutputIds.add(outputId);
    const target = await o.product(productId);
    check(target.unitType === output.commercialUnit, `La unidad de ${target.name} cambió; actualiza la presentación.`);
    const outQty = o.amount(Number(output.commercialQuantity), target, false, quantityPrecision(target));
    check(Number.isSafeInteger(output.measuredNetWeightG) && output.measuredNetWeightG > 0, `Indica el peso neto medido de ${target.name}.`);
    if (target.unitType === 'kg') check(Math.round(outQty * 1000) === output.measuredNetWeightG, `El peso de ${target.name} no coincide con su cantidad en kg.`);
    check(validDate(output.manufacturedOn) && validDate(output.packagedOn) && validDate(output.expiresOn)
      && output.manufacturedOn <= output.packagedOn && output.packagedOn <= o.today && output.packagedOn <= output.expiresOn
      && output.expiresOn <= sourceLot.expiresOn, `Revisa las fechas del lote ${output.lotCode}; no puede superar el vencimiento del origen.`);
    check(output.manufacturedOn === sourceLot.manufacturedOn,
      `La fecha de elaboración de ${target.name} debe conservar la fecha original del lote ${sourceLot.lotCode || sourceLot.id}.`);
    const lotCode = String(output.lotCode || '').trim();
    check(lotCode.length > 0 && lotCode.length <= 80, 'Cada lote de salida requiere un código válido.');
    const outputLotKey = `${productId}:${lotCode}:${output.manufacturedOn}`;
    check(!seenOutputLotKeys.has(outputLotKey), 'No repitas el código y la fecha de elaboración de un lote entre las salidas.');
    seenOutputLotKeys.add(outputLotKey);
    const targetEntry = await o.loadStock(productId, loc);
    check(!targetEntry.lots.some(item => item.lotCode === lotCode && item.manufacturedOn === output.manufacturedOn), `Ya existe el lote ${lotCode} para ${target.name}.`);
    check(!targetEntry.lots.some(item => item.legacy || item.synthetic || /^legacy_|ANTERIOR SIN FECHAS/i.test(`${item.id} ${item.lotCode || ''}`)), `El SKU ${target.name} tiene saldo histórico sin conciliar.`);
    outputWeightG += output.measuredNetWeightG;
    check(Number.isSafeInteger(outputWeightG), 'El peso de salida supera el rango seguro.');
    targetEntries.set(outputId, { target, targetEntry, outQty, output, lotCode });
  }
  check(outputWeightG === physicalWeightG, 'La masa medida no concilia exactamente. En esta fase no se autorizan descartes ni otros destinos sin aprobación económica y física.');
  check(p.packagingMaterials.length <= 100 && p.packagingMaterials.every(item => typeof item.materialId === 'string' && item.materialId.trim().length > 0 && item.materialId.length <= 120 && Number.isSafeInteger(item.quantityMilli) && item.quantityMilli >= 0 && Number.isSafeInteger(item.damagedQuantityMilli) && item.damagedQuantityMilli >= 0 && item.damagedQuantityMilli <= item.quantityMilli && (item.costCents === null || Number.isSafeInteger(item.costCents) && item.costCents >= 0)), 'Las cantidades o costos informativos de empaque no son válidos.');
  check(p.additionalCostComponents.length === 0, 'Los costos adicionales y su capitalización están pendientes de política; esta fase conserva solo el costo histórico del inventario.');

  const currentBalance = await o.read('distBalances', balanceId(loc, product.id));
  const balanceBefore = Number(currentBalance?.quantity || 0);
  const held = { ...currentUnavailable, repackPending: repackHeld };
  sourceLot.processingUnavailable = { ...(sourceLot.processingUnavailable || {}), [loc]: held };
  const remainingQuantity = roundAt(reservation.remainingQuantity - openedQuantity, quantityPrecisionForSource);
  const consumedWeightG = physicalWeightG;
  const remainingWeightG = reservation.remainingWeightG - consumedWeightG;
  const nextReservation = reservationEvent(o, { ...reservation, remainingQuantity, consumedQuantity: roundAt(Number(reservation.consumedQuantity || 0) + openedQuantity, quantityPrecisionForSource), remainingWeightG,
    ...(Number.isSafeInteger(reservation.remainingCostCents) || !derivedSource ? { remainingCostCents: expectedCostCents === null ? null : Math.max(0, (Number(reservation.remainingCostCents ?? review.costCents ?? expectedCostCents) - expectedCostCents)) } : {}),
    status: remainingQuantity === 0 ? 'consumed' : 'partially_consumed' }, 'repack_consumed', openedQuantity, String(p.reason).trim());
  if (derivedSource) {
    let quantityToRemove = openedQuantity;
    nextReservation.processingSegments = (reservation.processingSegments || []).flatMap(segment => {
      if (quantityToRemove <= 0) return [segment];
      const matching = selectedProcessingSegments.find(item => item.batchId === segment.batchId && item.segmentId === segment.segmentId);
      if (!matching) return [segment];
      const removed = Math.min(quantityToRemove, matching.quantity);
      const nextQuantity = segment.quantity - removed;
      const weightRemoved = integerShare(segment.remainingWeightG, 0, removed, segment.quantity);
      const costRemoved = integerShare(segment.remainingCostCents, 0, removed, segment.quantity);
      quantityToRemove = roundAt(quantityToRemove - removed, 0);
      return nextQuantity > 0 ? [{ ...segment, quantity: nextQuantity, remainingWeightG: segment.remainingWeightG - weightRemoved, remainingCostCents: segment.remainingCostCents === null ? null : segment.remainingCostCents - costRemoved }] : [];
    });
    check(quantityToRemove === 0, 'No se pudo actualizar la asignación de la reserva derivada.');
  }
  nextReservation.history[nextReservation.history.length - 1] = { ...nextReservation.history.at(-1), repackId, openedPhysicalWeightG: physicalWeightG, costCents: expectedCostCents };
  o.put('distStockReservations', reservationId, nextReservation);
  const consumedAllocations = await o.take(product.id, loc, openedQuantity, { lotId, precision: quantityPrecisionForSource, allowExpired: false, allowPendingOrigin: false, processingRepack: true });
  check(consumedAllocations.length > 0 && consumedAllocations.every(allocation => allocation.lotId === lotId), 'El consumo intentó usar otro lote; no se creó el reenvasado.');
  const derivedConsumedWeight = consumedAllocations.reduce((sum, allocation) => sum + Number(allocation.processingAllocation?.physicalWeightG || 0), 0);
  const derivedCosts = consumedAllocations.map(allocation => allocation.processingAllocation?.costCents);
  const actualWeightG = derivedSource ? derivedConsumedWeight : physicalWeightG;
  const actualCostCents = derivedSource
    ? (derivedCosts.some(value => value === null || value === undefined) ? null : derivedCosts.reduce((sum, value) => sum + value, 0))
    : expectedCostCents;
  check(actualWeightG === physicalWeightG && actualCostCents === expectedCostCents, 'Las asignaciones del origen cambiaron durante la transacción; no se aplicó el reenvasado.');
  const inputMovementId = o.ledger(product.id, openedQuantity, loc, null, 'processing_repack_input', { repackId, reviewId, reservationId, allocations: consumedAllocations, physicalWeightG, costCents: actualCostCents, costTotal: actualCostCents === null ? null : actualCostCents / 100, note: String(p.reason).trim() }, quantityPrecisionForSource);
  const outputCosts = actualCostCents === null ? outputs.map(() => null) : allocateCentsByWeight(actualCostCents, outputs.map(output => output.measuredNetWeightG));
  const outputRows = [];
  const movementIds = [inputMovementId];
  for (let index = 0; index < outputs.length; index++) {
    const output = outputs[index], { target, targetEntry, outQty, lotCode } = targetEntries.get(output.id);
    const outputId = safeId(output.id), lotOutputId = `processing_${sha256(`${repackId}:${outputId}`).slice(0, 40)}`;
    check(!await o.read('distLots', lotOutputId), 'El identificador estable del lote de salida ya existe.');
    const costCents = outputCosts[index];
    const sourceAllocations = [{ sourceLotId: lotId, sourceLotCode: sourceLot.lotCode || sourceLot.id, sourceProductId: product.id,
      quantityMilli: output.measuredNetWeightG, weightG: output.measuredNetWeightG, costCents, originStatus: 'accounting_allocation_not_physical_identification' }];
    const outLot = { id: lotOutputId, restaurantId: 'sanjose', productId: target.id, productName: target.name, unitType: target.unitType,
      lotCode, manufacturedOn: output.manufacturedOn, packagedOn: output.packagedOn, expiresOn: output.expiresOn,
      productionCost: costCents === null ? null : roundAt((costCents / 100) / outQty, 6), quantities: { [loc]: outQty }, quarantined: false, legacy: false,
      processingCommercialBlocked: true, processingBatchId: repackId, processingDestinationId: outputId, processingDestinationKind: 'finished',
      processingPhysicalWeightGRemaining: output.measuredNetWeightG, processingCostCentsRemaining: costCents, processingCostTotalCents: costCents,
      processingSourceLotIds: [lotId], processingSourceAllocations: sourceAllocations, processingSourceAllocationBasis: 'repack_origin_reference',
      ...(target.unitType === 'kg' ? {} : { processingPackageWeightLedger: { packageCount: outQty, measuredNetWeightG: output.measuredNetWeightG, consumedCount: 0, consumedWeightG: 0, nextPackageIndex: 0, weightBasis: 'documented_average' } }),
      ...(target.unitType === 'kg' ? {} : { processingByLocation: { [loc]: { segments: [{ segmentId: `${repackId}:${outputId}`, batchId: repackId, destinationId: outputId, sourceMovementId: '', weightBasis: 'documented_average', remainingQuantity: outQty, remainingWeightG: output.measuredNetWeightG, remainingCostCents: costCents }] } } }),
      processingRepackId: repackId, processingReviewId: reviewId, processingSourceReservationId: reservationId, createdAt: o.now, createdBy: o.actor, branchId: 'main', dayKey: o.today, schemaVersion: 1 };
    targetEntry.lots.push(outLot);
    o.stockSnapshots.get(`lots:${target.id}`).set(lotOutputId, null);
    o.move(targetEntry, loc, outQty, quantityPrecision(target));
    o.put('distLots', lotOutputId, outLot);
    const movementId = o.ledger(target.id, outQty, null, loc, 'processing_repack_output', { repackId, reviewId, sourceLotId: lotId, lotId: lotOutputId, lotCode, destinationId: outputId, physicalWeightG: output.measuredNetWeightG, commercialQuantity: outQty, costCents, costTotal: costCents === null ? null : costCents / 100, processingCommercialBlocked: true, sourceAllocations, sourceAllocationBasis: 'repack_origin_reference', note: String(p.reason).trim() }, quantityPrecision(target));
    if (outLot.processingByLocation?.[loc]?.segments?.length) { outLot.processingByLocation[loc].segments[0].sourceMovementId = movementId; o.put('distLots', lotOutputId, outLot); }
    movementIds.push(movementId);
    outputRows.push({ id: outputId, lotId: lotOutputId, productId: target.id, productName: target.name, lotCode, commercialQuantity: outQty, commercialUnit: target.unitType, netWeightG: output.measuredNetWeightG, costCents, movementId, sourceAllocations });
  }
  const reviewEventId = `${repackId}__review_transition`;
  const finalReviewStatus = remainingQuantity === 0 ? 'resolved_specialized' : 'pending_review';
  const transition = { ...review, id: reviewEventId, operationId, action: 'repack_consumed', previousStatus: 'authorized_for_repack', status: finalReviewStatus, reviewedAt: o.now, reviewedBy: o.actor, reviewedByName: o.member.displayName || o.actor, reason: String(p.reason).trim(), repackId, consumedQuantity: openedQuantity, consumedWeightG: physicalWeightG, costCents: actualCostCents };
  check(!await o.read('distProcessingReviews', reviewEventId), 'El evento de cierre de revisión ya existe.');
  o.put('distProcessingReviews', reviewEventId, transition);
  sourceLot.processingReview = { ...sourceLot.processingReview, latestReviewId: reviewEventId, revision: Number(sourceLot.processingReview.revision || 0) + 1, status: finalReviewStatus, updatedAt: o.now, updatedBy: o.actor };
  o.put('distLots', lotId, sourceLot);
  // take() updates the in-memory stock entry; balance writes are buffered until flush().
  const balanceAfter = Number(e.balances.get(loc)?.quantity || 0);
  const result = { repackId, reviewId, sourceLotId: lotId, reservationId, openedQuantity, openedPhysicalWeightG: physicalWeightG, costCents: actualCostCents, remainingReservationQuantity: remainingQuantity, sourceBalanceBefore: balanceBefore, sourceBalanceAfter: balanceAfter, outputLots: outputRows, movementIds, commercialBlocked: true, duplicate: false };
  const repackRecord = { id: repackId, operationId, ...o.base(), payloadHash, status: 'confirmed', sourceLotId: lotId, sourceProductId: product.id, sourceProductName: product.name, sourceUnitType: product.unitType, location: loc, reservationId, reviewId, reviewCaseId: review.caseId, authorizationId: authorization.id, evidenceRefs: p.evidenceRefs, openedCommercialQuantity: openedQuantity, openedPhysicalWeightG: physicalWeightG, sourceCostCents: actualCostCents, outputLots: outputRows, packagingMaterials: p.packagingMaterials.map(item => ({ ...item, costTreatment: 'informational_only_no_additional_result_charge' })), additionalCostComponents: [], inputMovementId, movementIds, responsibleUid: o.actor, responsibleName: o.member.displayName || o.actor, confirmedAt: o.now, confirmedBy: o.actor, result, reversal: { status: 'blocked', dependencyIds: outputRows.map(row => row.lotId), reason: 'El reenvasado requiere reversión especializada; no se permite restauración genérica.' } };
  o.put('distProcessingRepackings', repackId, repackRecord);
  const batch = { id: repackId, operationId, restaurantId: 'sanjose', branchId: 'main', schemaVersion: 1, payloadHash, status: 'confirmed', processType: 'repackaging', repackId,
    sourceProductId: product.id, sourceProductName: product.name, sourceUnitType: product.unitType, sourceLocation: loc, sourceAllocations: consumedAllocations,
    inputWeightG: physicalWeightG, outputWeightG, sourceCostCents: actualCostCents, destinations: outputRows, packagingMaterials: repackRecord.packagingMaterials,
    costComponents: [], auxiliaryCostsCapitalized: false, costPolicy: 'Costo histórico transferido una sola vez; materiales y egresos asociados son informativos y no se capitalizan.',
    responsibleUid: o.actor, responsibleName: o.member.displayName || o.actor, createdAt: o.now, dayKey: o.today, confirmedAt: o.now, confirmedBy: o.actor,
    movementIds, auditEventIds: [], reversal: repackRecord.reversal, result };
  o.put('distProcessingBatches', repackId, batch);
  const auditId = `processing_audit_${sha256(`${repackId}:repacked`).slice(0, 40)}`;
  o.put('distProcessingBatchAudit', auditId, { id: auditId, ...o.base(), batchId: repackId, repackId, operationId, location: loc, sourceLocation: loc, event: 'repacked', inputWeightG: physicalWeightG, outputWeightG, sourceCostCents: actualCostCents, reservationId, reviewId, movementIds, createdAt: o.now, createdBy: o.actor });
  batch.auditEventIds.push(auditId); o.put('distProcessingBatches', repackId, batch);
  return result;
};

handlers.releaseProcessingReservation = async (o, p) => {
  o.admin();
  const id = safeId(p.reservationId), reservation = await o.read('distStockReservations', id);
  check(reservation && ['active','partially_consumed'].includes(reservation.status), 'La reserva ya no tiene cantidad pendiente.');
  check(reservation.purpose !== 'review_hold', 'La inmovilización de revisión requiere un flujo de aprobación sanitaria.');
  check(reservation.purpose !== 'repack_pending', 'El producto pendiente de reenvasado solo puede liberarse mediante el procedimiento autorizado de reenvasado.');
  check(String(p.reason || '').trim(), 'Indica el motivo de liberación.');
  check(p.commercialQualityConfirmed === true, 'Confirma que el producto mantiene calidad comercial para el nuevo destino.');
  const { product, loc, lot, rows } = await reservationContext(o, { productId: reservation.productId, lotId: reservation.lotId, location: reservation.location });
  const current = rows.find(r => r.id === id);
  check(current && current.remainingQuantity === reservation.remainingQuantity, 'La reserva cambió; vuelve a consultar antes de liberar.');
  const amount = reservation.remainingQuantity;
  const key = reservation.purpose === 'repack_pending' ? 'repackPending' : 'courtesy';
  const held = { ...(lot.processingUnavailable[loc] || {}) };
  check(Number(held[key] || 0) >= amount, 'El agregado de reserva no tiene saldo suficiente.');
  held[key] = roundAt(Number(held[key] || 0) - amount, quantityPrecision(product));
  lot.processingUnavailable = { ...lot.processingUnavailable, [loc]: held };
  const updated = reservationEvent(o, { ...reservation, remainingQuantity: 0, remainingWeightG: 0, status: 'released', releaseReason: String(p.reason).trim() }, 'released', amount, String(p.reason).trim());
  o.put('distStockReservations', id, updated);
  o.ledger(product.id, amount, loc, loc, 'reservation_released', { lotId: lot.id, reservationId: id, reservationPurpose: reservation.purpose, physicalEffect: false, note: String(p.reason).trim() }, quantityPrecision(product));
  return { reservationId: id, releasedQuantity: amount, remainingQuantity: 0 };
};

handlers.deliverReservedCourtesy = async (o, p) => {
  o.admin();
  const id = safeId(p.reservationId), reservation = await o.read('distStockReservations', id);
  const deliveryId = safeId(p.deliveryId);
  check(reservation, 'No existe la reserva indicada.');
  const product = await o.product(reservation.productId);
  const quantity = o.amount(Number(p.quantity), product, false, quantityPrecision(product));
  const recipient = String(p.recipient || '').trim(), reason = String(p.reason || '').trim();
  check(quantity > 0, 'La cantidad debe ser mayor a cero.');
  check(recipient && reason, 'Indica destinatario y motivo de la cortesía.');
  const deliveryPayload = { deliveryId, reservationId: id, quantity, recipient, reason, deliveredWeightG: p.deliveredWeightG ?? null };
  const payloadHash = createHash('sha256').update(JSON.stringify(deliveryPayload)).digest('hex');
  const deliveryRef = o.ref('distCourtesyDeliveries', deliveryId);
  const priorDelivery = await o.tx.get(deliveryRef);
  if (priorDelivery.exists) {
    const prior = priorDelivery.data();
    check(prior.payloadHash === payloadHash, 'El deliveryId ya fue utilizado con datos diferentes.');
    return { ...prior.result, duplicate: true };
  }
  check(reservation.purpose === 'courtesy' && ['active','partially_consumed'].includes(reservation.status), 'No existe una reserva activa para cortesías.');
  check(quantity <= reservation.remainingQuantity, 'La cantidad supera lo reservado para cortesías.');
  const { product: currentProduct, loc, lot, rows } = await reservationContext(o, { productId: reservation.productId, lotId: reservation.lotId, location: reservation.location }, { allowProcessingOutput: Boolean(reservation.batchId && reservation.purpose === 'courtesy') });
  check(currentProduct.id === product.id, 'El producto reservado cambió; vuelve a consultar.');
  check(reservation.remainingQuantity === rows.find(r => r.id === id)?.remainingQuantity, 'La reserva cambió; vuelve a consultar.');
  const precision = quantityPrecision(product), held = { ...(lot.processingUnavailable[loc] || {}) };
  check(Number(held.courtesy || 0) >= quantity, 'La disponibilidad reservada no concilia.');
  held.courtesy = roundAt(Number(held.courtesy || 0) - quantity, precision);
  lot.processingUnavailable = { ...lot.processingUnavailable, [loc]: held };
  let weightG = null;
  if (reservation.remainingWeightG !== null && reservation.remainingWeightG !== undefined) {
    if (quantity === reservation.remainingQuantity) weightG = reservation.remainingWeightG;
    else {
      weightG = Number(p.deliveredWeightG);
      check(Number.isSafeInteger(weightG) && weightG > 0 && weightG <= reservation.remainingWeightG,
        'Indica el peso medido de esta entrega en gramos; no se puede estimar desde la cantidad de paquetes.');
    }
  } else {
    check(p.deliveredWeightG === undefined || p.deliveredWeightG === null,
      'La reserva no tiene peso físico verificado; no registres gramos estimados.');
  }
  let processingCostCents = null;
  if (lot.processingCommercialBlocked) {
    check(reservation.batchId === lot.processingBatchId && lot.processingDestinationKind === 'courtesy', 'La reserva no autoriza consumir este lote derivado.');
    check(Number.isSafeInteger(reservation.remainingWeightG) && Number.isSafeInteger(lot.processingPhysicalWeightGRemaining) && reservation.remainingWeightG === lot.processingPhysicalWeightGRemaining, 'El peso restante de la reserva no concilia con el lote derivado.');
    if (Number.isSafeInteger(reservation.remainingCostCents)) {
      processingCostCents = quantity === reservation.remainingQuantity
        ? reservation.remainingCostCents
        : Number(BigInt(reservation.remainingCostCents) * BigInt(weightG) / BigInt(reservation.remainingWeightG));
      check(Number.isSafeInteger(lot.processingCostCentsRemaining) && lot.processingCostCentsRemaining === reservation.remainingCostCents, 'El costo restante de la reserva no concilia con el lote derivado.');
    } else check(lot.processingCostCentsRemaining === null, 'El costo restante del lote derivado no concilia con la reserva.');
  }
  const nextRemaining = roundAt(reservation.remainingQuantity - quantity, precision);
  const nextWeight = reservation.remainingWeightG == null ? null : reservation.remainingWeightG - weightG;
  const nextCostCents = Number.isSafeInteger(reservation.remainingCostCents) ? reservation.remainingCostCents - processingCostCents : reservation.remainingCostCents ?? null;
  const updated = reservationEvent(o, { ...reservation, remainingQuantity: nextRemaining, consumedQuantity: roundAt((reservation.consumedQuantity || 0) + quantity, precision), remainingWeightG: nextWeight, ...(reservation.batchId ? { remainingCostCents: nextCostCents } : {}), status: nextRemaining === 0 ? 'consumed' : 'partially_consumed' }, 'courtesy_delivered', quantity, String(p.reason).trim());
  updated.history[updated.history.length - 1] = { ...updated.history.at(-1), deliveryId, saleId: o.id, remainingQuantity: nextRemaining, costTotal: null };
  o.put('distStockReservations', id, updated);
  const allocations = await o.take(product.id, loc, quantity, { lotId: lot.id, allowExpired: false, precision, ...(lot.processingCommercialBlocked ? { processingCourtesyReservation: reservation, processingPhysicalWeightG: weightG, processingCostCents } : {}) });
  const costKnown = allocations.length > 0 && allocations.every(a => a.productionCost !== null);
  const costTotal = lot.processingCommercialBlocked
    ? (Number.isSafeInteger(processingCostCents) ? processingCostCents / 100 : null)
    : costKnown ? round(allocations.reduce((sum,a) => sum + a.quantity * a.productionCost, 0)) : null;
  updated.history[updated.history.length - 1].costTotal = costTotal;
  o.put('distStockReservations', id, updated);
  const saleId = o.id;
  o.ledger(product.id, quantity, loc, null, 'courtesy', { allocations, saleId, reservationId: id, deliveryId, ...(weightG == null ? {} : { physicalWeightG: weightG }), courtesyReason: reason, recipient, lossCost: costTotal }, precision);
  const line = { productId: product.id, productNameSnapshot: product.name, presentationSnapshot: product.presentation || product.category || '', descriptionSnapshot: product.description || '', unitType: product.unitType, quantity, actualUnitPrice: round(product.referencePrice), referenceUnitPrice: round(product.referencePrice), isPromotional: false, subtotal: 0, referenceSubtotal: round(quantity * product.referencePrice), allocations, costTotal };
  o.put('distSales', saleId, { id: saleId, ...o.base(), saleKind: 'courtesy', reservationId: id, deliveryId, ...(weightG == null ? {} : { physicalWeightG: weightG }), courtesyReason: reason, courtesyRecipient: recipient, courtesyCost: costTotal, operationId: o.id, sourceLocation: loc === 'central' ? 'centralWarehouse' : loc, routeId: 'administracion', routeName: 'Administración', sellerUid: o.actor, sellerName: o.member.displayName || o.actor, dispatchId: '', customerId: '', customerName: recipient, customerCode: '', lines: [line], total: 0, paymentKind: 'cash', cashAmount: 0, qrAmount: 0, creditAmount: 0, cashReceived: 0, changeAmount: 0, note: `Reserva ${id}` });
  const result = { saleId, reservationId: id, deliveryId, deliveredQuantity: quantity, remainingQuantity: nextRemaining, costTotal };
  o.put('distCourtesyDeliveries', deliveryId, { id: deliveryId, ...o.base(), schemaVersion: 1, payloadHash, payload: deliveryPayload, reservationId: id, saleId, result, status: 'confirmed', createdAt: o.now, createdBy: o.actor });
  return result;
};

handlers.confirmProcessingBatch = async (o, p) => {
  check(['admin', 'warehouse'].includes(o.member.role), 'Solo Almacén o Administración pueden confirmar una elaboración.');
  const batchId = safeId(p.batchId);
  const loc = String(p.location || '');
  check(loc === 'central' || /^warehouse__[^/]+$/.test(loc), 'La elaboración debe indicar un almacén válido.');
  o.owns(loc);
  if (loc !== 'central') {
    const warehouse = await o.read('distWarehouses', safeId(loc.slice('warehouse__'.length)));
    check(warehouse && warehouse.active !== false, 'El almacén de la elaboración no está disponible.');
  }
  const payloadHash = sha256(p);
  const batchRef = o.ref('distProcessingBatches', batchId);
  const prior = await o.tx.get(batchRef);
  if (prior.exists) {
    const saved = prior.data();
    check(saved.payloadHash === payloadHash, 'El batchId ya fue utilizado con datos diferentes.');
    return { ...saved.result, duplicate: true };
  }

  check(['portioning', 'bagging', 'repackaging'].includes(p.processType), 'El tipo de elaboración no está permitido.');
  check(validDate(p.processingDate) && p.processingDate <= o.today, 'La fecha de elaboración debe ser válida y no futura.');
  const sourceProduct = await o.product(safeId(p.sourceProductId));
  check(sourceProduct.unitType === 'kg', 'Esta fase solo consume producto de origen medido en kg; paquetes y unidades requieren integración de peso por unidad.');
  const inputWeightG = Number(p.inputWeightG);
  check(Number.isSafeInteger(inputWeightG) && inputWeightG > 0, 'El peso de entrada debe ser un entero positivo de gramos.');
  check(Array.isArray(p.sourceAllocations) && p.sourceAllocations.length > 0 && p.sourceAllocations.length <= 30, 'Indica entre 1 y 30 asignaciones comprobadas de lote de origen.');
  const sourceEntry = await o.loadStock(sourceProduct.id, loc);
  const seenSourceLots = new Set();
  let sourceGrams = 0;
  const requestedSourceAllocations = p.sourceAllocations.map((source, index) => {
    const lotId = safeId(source.lotId);
    check(!seenSourceLots.has(lotId), 'No repitas lotes de origen.');
    seenSourceLots.add(lotId);
    const measuredNetWeightG = Number(source.measuredNetWeightG);
    const quantityG = kgToGrams(source.quantity, `Cantidad del lote ${lotId}`);
    check(Number.isSafeInteger(measuredNetWeightG) && measuredNetWeightG === quantityG, `El peso medido del lote ${lotId} no corresponde exactamente a su cantidad en kg.`);
    const lot = sourceEntry.lots.find(item => item.id === lotId);
    check(lot && lot.productId === sourceProduct.id, `El lote ${lotId} no pertenece al SKU de origen.`);
    check(!lot.legacy && !lot.synthetic && !/^legacy_|ANTERIOR SIN FECHAS/i.test(`${lot.id} ${lot.lotCode || ''}`), `El lote ${lot.lotCode || lot.id} es sintético o requiere conciliación.`);
    check(!lot.quarantined && validDate(lot.manufacturedOn) && validDate(lot.expiresOn) && lot.expiresOn >= o.today && lot.expiresOn >= lot.manufacturedOn, `El lote ${lot.lotCode || lot.id} está vencido, en cuarentena o carece de fechas verificables.`);
    check(origins.pending(lot, loc) === 0, `El lote ${lot.lotCode || lot.id} tiene origen físico pendiente en este almacén.`);
    check(!lot.processingCommercialBlocked, `El lote ${lot.lotCode || lot.id} proviene de una elaboración cuyo consumo comercial sigue bloqueado.`);
    sourceGrams += measuredNetWeightG;
    check(Number.isSafeInteger(sourceGrams), 'El peso total de origen excede el rango seguro.');
    return { lotId, quantity: measuredNetWeightG / 1000, measuredNetWeightG, sourceIndex: index };
  });
  check(sourceGrams === inputWeightG, 'La suma de las asignaciones de origen debe coincidir exactamente con el peso de entrada.');

  check(Array.isArray(p.destinations) && p.destinations.length > 0 && p.destinations.length <= 30, 'Agrega entre 1 y 30 destinos físicos.');
  const seenDestinations = new Set();
  const destinations = [];
  const targetProducts = new Map();
  let outputWeightG = 0;
  for (const raw of p.destinations) {
    const id = safeId(raw.id);
    check(!seenDestinations.has(id), 'Cada destino debe tener identificador único.');
    seenDestinations.add(id);
    const kind = raw.kind;
    check(['finished', 'courtesy', 'repack_pending', 'review_hold', 'discard'].includes(kind), 'Este destino todavía no está implementado; no se registró como producto vendible.');
    const netWeightG = Number(raw.netWeightG);
    check(Number.isSafeInteger(netWeightG) && netWeightG > 0, `El destino ${id} requiere peso neto físico medido en gramos.`);
    if (raw.nominalWeightG !== undefined) check(Number.isSafeInteger(Number(raw.nominalWeightG)) && Number(raw.nominalWeightG) > 0, `El peso nominal del destino ${id} debe ser un entero positivo y solo informativo.`);
    outputWeightG += netWeightG;
    check(Number.isSafeInteger(outputWeightG), 'El peso de salida excede el rango seguro.');
    if (kind === 'discard') {
      check(o.member.role === 'admin', 'El descarte real requiere aprobación directa de Administración.');
      check(String(raw.reason || '').trim().length >= 3, `Indica el motivo del descarte ${id}.`);
      check(!raw.productId && (!raw.commercialQuantity || Number(raw.commercialQuantity) === 0), 'El descarte no puede crear un SKU ni cantidad comercial.');
      destinations.push({ id, kind, productId: sourceProduct.id, commercialUnit: 'kg', commercialQuantity: 0, netWeightG, reason: String(raw.reason).trim(), approvalStatus: 'approved', approvedBy: o.actor, approvedByName: o.member.displayName || o.actor });
      continue;
    }
    const productId = safeId(raw.productId);
    check(productId !== sourceProduct.id, 'El producto terminado debe ser un SKU previamente configurado y distinto del SKU a granel de origen.');
    const target = await o.product(productId);
    check(!raw.commercialUnit || raw.commercialUnit === target.unitType, `La unidad comercial de ${target.name} cambió; actualiza la elaboración.`);
    const commercialQuantity = Number(raw.commercialQuantity);
    check(Number.isFinite(commercialQuantity) && commercialQuantity > 0 && (target.unitType === 'kg' ? Number.isSafeInteger(netWeightG) && Math.abs(commercialQuantity * 1000 - netWeightG) < 0.000001 : Number.isSafeInteger(commercialQuantity)), `La cantidad comercial de ${target.name} no corresponde a su presentación.`);
    if (target.unitType === 'kg') check(Math.abs(commercialQuantity * 1000 - netWeightG) < 0.000001, `El peso neto y los kg comerciales de ${target.name} deben coincidir.`);
    else check(['measured_total', 'documented_average'].includes(raw.weightBasis), `Registra el peso neto total medido de ${target.name}; el peso aproximado del catálogo no sirve para conciliar.`);
    if (kind === 'courtesy') {
      check(o.member.role === 'admin' && raw.qualityConfirmed === true && String(raw.qualityReason || '').trim(), 'Producto para cortesía requiere confirmación explícita de aptitud por Administración.');
    } else if (kind === 'repack_pending' || kind === 'review_hold') {
      check(String(raw.reason || '').trim().length >= 3, `Indica por qué ${target.name} queda inmovilizado.`);
      if (kind === 'review_hold') check(o.member.role === 'admin' || o.member.role === 'warehouse', 'No tienes permiso para inmovilizar producto para revisión.');
    }
    check(validDate(raw.manufacturedOn) && validDate(raw.packagedOn) && raw.manufacturedOn <= o.today && raw.packagedOn <= o.today && raw.manufacturedOn <= raw.packagedOn, `El destino ${id} requiere fecha de elaboración y envasado válidas y diferenciadas.`);
    const sourceExpiry = Math.min(...requestedSourceAllocations.map(source => sourceEntry.lots.find(lot => lot.id === source.lotId).expiresOn).map(date => Date.parse(`${date}T00:00:00Z`)));
    check(validDate(raw.expiresOn) && raw.expiresOn >= raw.packagedOn && Date.parse(`${raw.expiresOn}T00:00:00Z`) <= sourceExpiry, `El vencimiento de ${target.name} no puede superar el vencimiento más conservador de sus lotes de origen.`);
    const lotCode = String(raw.lotCode || '').trim();
    check(lotCode.length > 0 && lotCode.length <= 80, `Indica el código de lote derivado para ${target.name}.`);
    const destination = { id, kind, productId, commercialUnit: target.unitType, commercialQuantity: roundAt(commercialQuantity, quantityPrecision(target)), netWeightG, ...(raw.nominalWeightG === undefined ? {} : { nominalWeightG: Number(raw.nominalWeightG) }), weightBasis: raw.weightBasis || (target.unitType === 'kg' ? 'measured_total' : 'documented_average'), lotCode, manufacturedOn: raw.manufacturedOn, packagedOn: raw.packagedOn, expiresOn: raw.expiresOn, ...(raw.reason ? { reason: String(raw.reason).trim() } : {}), ...(kind === 'courtesy' ? { qualityConfirmedBy: o.actor, qualityConfirmedAt: o.now, qualityReason: String(raw.qualityReason).trim() } : {}), approvalStatus: kind === 'finished' ? 'not_required' : kind === 'courtesy' ? 'approved' : 'pending' };
    destinations.push(destination);
    targetProducts.set(productId, target);
  }
  check(outputWeightG === inputWeightG, `La elaboración no conserva la masa: entrada ${inputWeightG} g, destinos ${outputWeightG} g, diferencia ${inputWeightG - outputWeightG} g.`);
  check(!p.otherDestinationsG || Number(p.otherDestinationsG) === 0, 'Los destinos adicionales todavía no están implementados; asígnalos explícitamente antes de confirmar.');

  const packagingMaterials = Array.isArray(p.packagingMaterials) ? p.packagingMaterials : [];
  check(packagingMaterials.length <= 100, 'Hay demasiados materiales de empaque en una sola elaboración.');
  const materialIds = new Set();
  const materialRows = [];
  for (const material of packagingMaterials) {
    const id = safeId(material.id);
    check(!materialIds.has(id), 'No repitas materiales de empaque.'); materialIds.add(id);
    const quantityMilli = Number(material.quantityMilli), damagedQuantityMilli = Number(material.damagedQuantityMilli || 0);
    check(Number.isSafeInteger(quantityMilli) && quantityMilli > 0 && Number.isSafeInteger(damagedQuantityMilli) && damagedQuantityMilli >= 0 && damagedQuantityMilli <= quantityMilli, 'La cantidad de material o bolsas dañadas no es válida.');
    const costCents = material.costCents == null ? null : Number(material.costCents);
    check(costCents === null || Number.isSafeInteger(costCents) && costCents >= 0, 'El costo del material debe expresarse en centavos o quedar desconocido.');
    let expenseReference = null;
    if (material.expenseId) {
      expenseReference = safeId(material.expenseId);
      const expense = await o.read('distExpenses', expenseReference);
      check(expense && !expense.voided, `No se encontró el egreso vigente ${expenseReference}.`);
    }
    materialRows.push({ id, description: String(material.description || '').trim().slice(0, 120), quantityMilli, damagedQuantityMilli, costCents, ...(expenseReference ? { expenseId: expenseReference } : {}), costTreatment: 'informational_only_no_additional_result_charge' });
  }
  const costComponents = Array.isArray(p.costComponents) ? p.costComponents : [];
  check(costComponents.length <= 50, 'Hay demasiados componentes de costo en una sola elaboración.');
  const componentIds = new Set();
  const componentRows = [];
  for (const component of costComponents) {
    const id = safeId(component.id);
    check(!componentIds.has(id), 'No repitas componentes de costo.'); componentIds.add(id);
    const amountCents = component.amountCents == null ? null : Number(component.amountCents);
    check(amountCents === null || Number.isSafeInteger(amountCents) && amountCents >= 0, 'El componente de costo debe expresarse en centavos o quedar desconocido.');
    check(component.capitalizable !== true, 'La capitalización de costos adicionales requiere asignación contable transaccional, aún no disponible; se rechazó sin cambiar inventario.');
    let expenseId = null;
    if (component.expenseId) {
      expenseId = safeId(component.expenseId);
      const expense = await o.read('distExpenses', expenseId);
      check(expense && !expense.voided, `No se encontró el egreso vigente ${expenseId}.`);
    }
    if (component.alreadyRecognizedAsOperatingExpense) check(expenseId, 'Un costo ya registrado como egreso requiere su referencia existente.');
    componentRows.push({ id, kind: component.kind || 'other', amountCents, ...(expenseId ? { expenseId } : {}), alreadyRecognizedAsOperatingExpense: component.alreadyRecognizedAsOperatingExpense === true, capitalizable: false, sourceReference: String(component.sourceReference || '').trim(), costTreatment: 'informational_only_no_additional_result_charge' });
  }

  const sourceCostRows = requestedSourceAllocations.map(source => {
    const lot = sourceEntry.lots.find(item => item.id === source.lotId);
    const historicalCostCents = Number.isFinite(lot.productionCost) && lot.productionCost >= 0 ? Math.round(source.quantity * lot.productionCost * 100) : null;
    return { sourceLotId: lot.id, sourceLotCode: lot.lotCode, sourceProductId: sourceProduct.id, sourceUnitType: sourceProduct.unitType, originStatus: 'confirmed', quantity: source.quantity, quantityMilli: source.measuredNetWeightG, measuredNetWeightG: source.measuredNetWeightG, expiresOn: lot.expiresOn, productionCost: lot.productionCost ?? null, historicalCostCents };
  });
  const sourceCostKnown = sourceCostRows.every(row => row.historicalCostCents !== null);
  const sourceCostCents = sourceCostKnown ? sourceCostRows.reduce((sum, row) => sum + row.historicalCostCents, 0) : null;
  if (sourceCostCents !== null) check(Number.isSafeInteger(sourceCostCents), 'El costo histórico total excede el rango seguro.');
  const sourceDestinationWeights = allocateWeightMatrix(sourceCostRows.map(row => row.measuredNetWeightG), destinations.map(item => item.netWeightG));
  const destinationSourceAllocations = destinations.map(() => []);
  if (sourceCostKnown) {
    for (let sourceIndex = 0; sourceIndex < sourceCostRows.length; sourceIndex++) {
      const sourceRow = sourceCostRows[sourceIndex];
      const costShares = allocateCentsByWeight(sourceRow.historicalCostCents, sourceDestinationWeights[sourceIndex]);
      for (let destinationIndex = 0; destinationIndex < destinations.length; destinationIndex++) {
        const weightG = sourceDestinationWeights[sourceIndex][destinationIndex];
        if (weightG > 0) destinationSourceAllocations[destinationIndex].push({ sourceLotId: sourceRow.sourceLotId, sourceLotCode: sourceRow.sourceLotCode, sourceProductId: sourceRow.sourceProductId, quantityMilli: weightG, weightG, costCents: costShares[destinationIndex], originStatus: 'accounting_allocation_not_physical_identification' });
      }
    }
  } else {
    for (let sourceIndex = 0; sourceIndex < sourceCostRows.length; sourceIndex++) {
      const sourceRow = sourceCostRows[sourceIndex];
      for (let destinationIndex = 0; destinationIndex < destinations.length; destinationIndex++) {
        const weightG = sourceDestinationWeights[sourceIndex][destinationIndex];
        if (weightG > 0) destinationSourceAllocations[destinationIndex].push({ sourceLotId: sourceRow.sourceLotId, sourceLotCode: sourceRow.sourceLotCode, sourceProductId: sourceRow.sourceProductId, quantityMilli: weightG, weightG, costCents: null, originStatus: 'accounting_allocation_not_physical_identification' });
      }
    }
  }
  const destinationCosts = sourceCostKnown
    ? destinations.map((_, destinationIndex) => destinationSourceAllocations[destinationIndex].reduce((sum, allocation) => sum + allocation.costCents, 0))
    : destinations.map(() => null);
  const derivedLots = [];
  const movementIds = [];
  const reservationIds = [];
  const auditEventIds = [];
  const sourceBeforeQuantity = Number(sourceEntry.balances.get(loc)?.quantity || 0);
  const sourceAllocations = await o.take(sourceProduct.id, loc, inputWeightG / 1000, { allocationsRequested: requestedSourceAllocations.map(({ lotId, quantity }) => ({ lotId, quantity })), allowExpired: false, allowPendingOrigin: false, precision: 3 });
  const actualSourceCostCents = sourceAllocations.every(allocation => allocation.productionCost !== null)
    ? sourceAllocations.reduce((sum, allocation) => sum + Math.round(allocation.quantity * allocation.productionCost * 100), 0)
    : null;
  check(actualSourceCostCents === sourceCostCents, 'El costo histórico de los lotes cambió durante la elaboración; no se aplicaron cambios.');
  const consumptionMovementId = o.ledger(sourceProduct.id, inputWeightG / 1000, loc, null, 'processing_consumption', { batchId, lotIds: sourceAllocations.map(a => a.lotId), allocations: sourceAllocations, physicalWeightG: inputWeightG, costCents: sourceCostCents, costTotal: sourceCostCents === null ? null : sourceCostCents / 100 }, 3);
  movementIds.push(consumptionMovementId);
  const destinationWeightById = new Map(destinations.map((destination, index) => [destination.id, { ...destination, costCents: destinationCosts[index] }]));
  for (let index = 0; index < destinations.length; index++) {
    const destination = destinationWeightById.get(destinations[index].id);
    const costCents = destination.costCents;
    if (destination.kind === 'discard') {
      const discardKg = destination.netWeightG / 1000;
      const movementId = o.ledger(sourceProduct.id, discardKg, loc, loc, 'processing_discard', { batchId, destinationId: destination.id, sourceAllocations: destinationSourceAllocations[index], sourceAllocationBasis: 'batch_blend_accounting_allocation', physicalEffect: false, physicalWeightG: destination.netWeightG, lossCost: costCents === null ? null : costCents / 100, lossCostCents: costCents, lossClassification: 'confirmed_physical_loss', note: destination.reason }, 3);
      movementIds.push(movementId);
      continue;
    }
    const target = targetProducts.get(destination.productId);
    const targetEntry = await o.loadStock(target.id, loc);
    check(!targetEntry.lots.some(lot => lot.legacy || lot.synthetic || /^legacy_|ANTERIOR SIN FECHAS/i.test(`${lot.id} ${lot.lotCode || ''}`)), `El SKU ${target.name} tiene saldo histórico sin lotes conciliados; no se creó inventario derivado.`);
    const lotId = `processing_${sha256(`${batchId}:${destination.id}`).slice(0, 40)}`;
    check(!targetEntry.lots.some(lot => lot.lotCode === destination.lotCode && lot.manufacturedOn === destination.manufacturedOn), `Ya existe el lote ${destination.lotCode} para ${target.name}.`);
    check(!await o.read('distLots', lotId), `El identificador de lote derivado ${lotId} ya existe.`);
    const unitCost = costCents === null ? null : roundAt((costCents / 100) / destination.commercialQuantity, 6);
    const heldKey = destination.kind === 'courtesy' ? 'courtesy' : destination.kind === 'repack_pending' ? 'repackPending' : destination.kind === 'review_hold' ? 'reviewHold' : null;
    const lot = {
      id: lotId, restaurantId: 'sanjose', productId: target.id, productName: target.name, unitType: target.unitType,
      lotCode: destination.lotCode, manufacturedOn: destination.manufacturedOn, packagedOn: destination.packagedOn, expiresOn: destination.expiresOn,
      productionCost: unitCost, quantities: { [loc]: destination.commercialQuantity }, quarantined: false, legacy: false,
      processingCommercialBlocked: true, processingBatchId: batchId, processingDestinationId: destination.id, processingDestinationKind: destination.kind,
      processingPhysicalWeightGRemaining: destination.netWeightG, processingCostCentsRemaining: costCents,
      processingSourceLotIds: destinationSourceAllocations[index].map(row => row.sourceLotId), processingSourceAllocations: destinationSourceAllocations[index], processingSourceAllocationBasis: 'batch_blend_accounting_allocation', processingCostTotalCents: costCents,
      ...(target.unitType === 'kg' ? {} : { processingPackageWeightLedger: { packageCount: destination.commercialQuantity, measuredNetWeightG: destination.netWeightG, consumedCount: 0, consumedWeightG: 0, nextPackageIndex: 0, weightBasis: destination.weightBasis } }),
      ...(destination.kind === 'finished' && target.unitType !== 'kg' ? {
        processingByLocation: {
          [loc]: {
            segments: [{
              segmentId: `${batchId}:${destination.id}`,
              batchId,
              destinationId: destination.id,
              sourceMovementId: '',
              weightBasis: destination.weightBasis,
              remainingQuantity: destination.commercialQuantity,
              remainingWeightG: destination.netWeightG,
              remainingCostCents: costCents,
            }],
          },
        },
      } : {}),
      ...(heldKey ? { processingUnavailable: { [loc]: { courtesy: heldKey === 'courtesy' ? destination.commercialQuantity : 0, repackPending: heldKey === 'repackPending' ? destination.commercialQuantity : 0, reviewHold: heldKey === 'reviewHold' ? destination.commercialQuantity : 0 } } } : {}),
      createdAt: o.now, createdBy: o.actor, branchId: 'main', dayKey: o.today, schemaVersion: 1,
    };
    lot.quantities[loc] = roundAt(destination.commercialQuantity, quantityPrecision(target));
    if (heldKey && destination.netWeightG > 0) {
      const reservationId = `${lotId}__reservation`;
      const reservation = {
        id: reservationId, restaurantId: 'sanjose', branchId: 'main', schemaVersion: 1, productId: target.id, productName: target.name,
        lotId, lotCode: lot.lotCode, unitType: target.unitType, location: loc,
        purpose: heldKey === 'courtesy' ? 'courtesy' : heldKey === 'repackPending' ? 'repack_pending' : 'review_hold',
        originalQuantity: lot.quantities[loc], remainingQuantity: lot.quantities[loc], consumedQuantity: 0,
        physicalWeightG: destination.netWeightG, remainingWeightG: destination.netWeightG,
        remainingCostCents: costCents, status: 'active', source: `processing_batch:${batchId}`, batchId,
        createdAt: o.now, createdBy: o.actor, createdByName: o.member.displayName || o.actor,
        history: [{ id: `${reservationId}__created`, action: 'created', quantity: lot.quantities[loc], at: o.now, by: o.actor, byName: o.member.displayName || o.actor, reason: destination.reason || destination.qualityReason || `Destino ${destination.kind} de elaboración ${batchId}`, batchId }],
      };
      o.put('distStockReservations', reservationId, reservation);
      reservationIds.push(reservationId);
      const reservationMovementId = o.ledger(target.id, lot.quantities[loc], loc, loc, 'reservation_created', { batchId, lotId, reservationId, reservationPurpose: reservation.purpose, physicalEffect: false, note: `Reserva creada por elaboración ${batchId}` }, quantityPrecision(target));
      reservation.movementId = reservationMovementId;
      o.put('distStockReservations', reservationId, reservation);
      movementIds.push(reservationMovementId);
    }
    targetEntry.lots.push(lot);
    o.stockSnapshots.get(`lots:${target.id}`).set(lotId, null);
    o.move(targetEntry, loc, lot.quantities[loc], quantityPrecision(target));
    o.put('distLots', lotId, lot);
    const movementId = o.ledger(target.id, lot.quantities[loc], null, loc, 'processing_output', { batchId, lotId, lotCode: lot.lotCode, destinationId: destination.id, destinationKind: destination.kind, physicalWeightG: destination.netWeightG, commercialQuantity: lot.quantities[loc], costCents, costTotal: costCents === null ? null : costCents / 100, processingCommercialBlocked: true, sourceLotIds: lot.processingSourceLotIds, sourceAllocations: destinationSourceAllocations[index], sourceAllocationBasis: lot.processingSourceAllocationBasis, note: destination.reason || '' }, quantityPrecision(target));
    if (lot.processingByLocation?.[loc]?.segments?.length) {
      lot.processingByLocation[loc].segments[0].sourceMovementId = movementId;
      o.put('distLots', lotId, lot);
    }
    movementIds.push(movementId);
    derivedLots.push({ lotId, productId: target.id, productName: target.name, destinationId: destination.id, destinationKind: destination.kind, lotCode: lot.lotCode, commercialQuantity: lot.quantities[loc], unitType: target.unitType, netWeightG: destination.netWeightG, costCents, sourceAllocations: destinationSourceAllocations[index], sourceAllocationBasis: 'batch_blend_accounting_allocation', reservationId: reservationIds.find(id => id === `${lotId}__reservation`) || null, processingCommercialBlocked: true });
    const auditId = `processing_audit_${sha256(`${batchId}:${destination.id}`).slice(0, 40)}`;
    o.put('distProcessingBatchAudit', auditId, { id: auditId, ...o.base(), batchId, operationId: o.id, location: loc, sourceLocation: loc, event: heldKey ? 'destination_reserved' : 'destination_created', destinationId: destination.id, productId: target.id, lotId, reservationId: reservationIds.find(id => id === `${lotId}__reservation`) || null, physicalWeightG: destination.netWeightG, costCents, createdAt: o.now, createdBy: o.actor });
    auditEventIds.push(auditId);
  }
  const sourceAfterQuantity = Number(sourceEntry.balances.get(loc)?.quantity || 0);
  const result = { batchId, duplicate: false, inputWeightG, outputWeightG, sourceProductId: sourceProduct.id, sourceLocation: loc, sourceBeforeQuantity, sourceAfterQuantity, sourceCostCents, derivedLots, reservationIds, movementIds, discardedWeightG: destinations.filter(item => item.kind === 'discard').reduce((sum, item) => sum + item.netWeightG, 0) };
  const batch = {
    id: batchId, operationId: o.id, restaurantId: 'sanjose', branchId: 'main', schemaVersion: 1, payloadHash, status: 'confirmed',
    processType: p.processType, processingDate: p.processingDate, note: String(p.note || '').trim().slice(0, 500), sourceProductId: sourceProduct.id, sourceProductName: sourceProduct.name, sourceUnitType: sourceProduct.unitType, sourceLocation: loc,
    sourceAllocations: sourceCostRows, inputWeightG, destinations: destinations.map((item, index) => ({ ...item, costCents: destinationCosts[index], sourceLotIds: [...new Set(destinationSourceAllocations[index].map(row => row.sourceLotId))], sourceAllocations: destinationSourceAllocations[index], sourceAllocationBasis: 'batch_blend_accounting_allocation' })),
    packagingMaterials: materialRows, costComponents: componentRows, sourceCostCents,
    auxiliaryCostsCapitalized: false, costPolicy: 'Solo se redistribuyó el costo histórico conocido del inventario de origen; empaques y egresos asociados son informativos y no se capitalizan.',
    responsibleUid: o.actor, responsibleName: o.member.displayName || o.actor, createdAt: o.now, dayKey: o.today, confirmedAt: o.now, confirmedBy: o.actor,
    auditEventIds, movementIds, reservationIds, reversal: { status: 'clear', dependencyIds: [] }, result,
  };
  o.put('distProcessingBatches', batchId, batch);
  const confirmedAuditId = `processing_audit_${sha256(`${batchId}:confirmed`).slice(0, 40)}`;
  o.put('distProcessingBatchAudit', confirmedAuditId, { id: confirmedAuditId, ...o.base(), batchId, operationId: o.id, location: loc, sourceLocation: loc, event: 'confirmed', inputWeightG, outputWeightG, sourceCostCents, createdAt: o.now, createdBy: o.actor, movementIds });
  batch.auditEventIds.push(confirmedAuditId);
  o.put('distProcessingBatches', batchId, batch);
  return result;
};
async function updateLot(o, p) {
  o.admin();
  const lot = await o.read("distLots", p.lotId);
  check(lot, "No existe el lote.");
  check(!Object.keys(lot.pendingOrigins || {}).some(loc => origins.pending(lot, loc) > 0), 'Este lote contiene cantidades con origen pendiente; no se puede cambiar su identidad ni costo sin conciliar la excepción.');
  const reservations = await o.processingReservations(lot.id);
  const reservationLocations = new Set(['central', ...Object.keys(lot.processingUnavailable || {}), ...reservations.map(row => row.location)]);
  for (const loc of reservationLocations) o.assertReservationAggregate(lot, loc, reservations);
  check(!reservations.some(row => ['active','partially_consumed'].includes(row.status) && Number(row.remainingQuantity) > 0), 'Este lote tiene producto reservado; libera o consume la reserva antes de cambiar su trazabilidad.');
  check(
    p.lotCode?.trim() &&
      validDate(p.manufacturedOn) &&
      validDate(p.expiresOn) &&
      p.manufacturedOn <= p.expiresOn &&
      p.manufacturedOn <= o.today,
    "Revisa las fechas y el código del lote.",
  );
  check(
    Number.isFinite(p.productionCost) && p.productionCost >= 0,
    "Costo inválido.",
  );
  check(p.reason?.trim(), "Indica el motivo de la actualización.");
  const updated = {
    ...lot,
    lotCode: p.lotCode.trim(),
    manufacturedOn: p.manufacturedOn,
    expiresOn: p.expiresOn,
    productionCost: p.productionCost,
    legacy: false,
    updatedAt: o.now,
    updatedBy: o.actor,
  };
  o.put("distLots", lot.id, updated);
  o.put("distLotHistory", o.id, {
    id: o.id,
    ...o.base(),
    lotId: lot.id,
    previous: {
      lotCode: lot.lotCode,
      manufacturedOn: lot.manufacturedOn,
      expiresOn: lot.expiresOn,
      productionCost: lot.productionCost,
    },
    next: {
      lotCode: updated.lotCode,
      manufacturedOn: updated.manufacturedOn,
      expiresOn: updated.expiresOn,
      productionCost: updated.productionCost,
    },
    reason: p.reason,
  });
  return updated;
}
handlers.updateLot = updateLot;
handlers.resolveQuarantine = async (o, p) => {
  o.admin();
  const lotId = safeId(p.lotId);
  const lot = await o.read("distLots", lotId);
  check(lot && lot.quarantined === true && !lot.quarantineResolvedAt, "Este lote ya no está pendiente de revisión.");
  check(!lot.processingCommercialBlocked && !lot.processingBatchId && !lot.derivedReturn && !lot.processingByLocation,
    "Esta cuarentena tiene trazabilidad de sacheteado o devolución derivada. Requiere un procedimiento especializado; no se liberó ni descartó producto.");
  const product = await o.product(lot.productId);
  check(p.location === "central" || (typeof p.location === "string" && p.location.startsWith("warehouse__")), "El almacén seleccionado no es válido.");
  const warehouseId = p.location === "central" ? "central" : safeId(p.location.slice("warehouse__".length));
  const loc = warehouseId === "central" ? "central" : `warehouse__${warehouseId}`;
  if (warehouseId !== "central") {
    const warehouse = await o.read("distWarehouses", warehouseId);
    check(warehouse && warehouse.active !== false, "El almacén seleccionado ya no está disponible.");
  }
  const allLots = await o.query("distLots", "productId", product.id);
  const balance = await o.read("distBalances", balanceId(loc, product.id));
  const physicalQuantity = roundAt(Number(balance?.quantity || 0), quantityPrecision(product));
  const lotQuantity = roundAt(allLots.reduce((sum, item) => sum + Number(item.quantities?.[loc] || 0), 0), quantityPrecision(product));
  check(Math.abs(physicalQuantity - lotQuantity) < 0.5 / (10 ** quantityPrecision(product)), "El balance y los lotes no coinciden. Administración debe conciliar el inventario antes de resolver esta cuarentena.");
  const e = await o.loadStock(product.id, loc);
  const quantity = roundAt(Number(lot.quantities?.[loc] || 0), quantityPrecision(product));
  await o.assertNoActiveReservation(lot, loc, 'El lote tiene producto reservado y no se puede resolver la cuarentena hasta revisar esa reserva.');
  check(quantity > 0, "La cuarentena ya no tiene existencia en este almacén.");
  check(Object.entries(lot.quantities || {}).every(([key, value]) => key === loc || roundAt(Number(value || 0), quantityPrecision(product)) === 0), "La cuarentena está distribuida en más de un almacén y requiere revisión administrativa.");
  const resolution = p.resolution;
  const reason = String(p.reason || "").trim();
  check(reason.length > 0 && reason.length <= 500, "Describe el motivo o evidencia de la revisión.");
  let updatedLot = { ...lot, quantities: { ...(lot.quantities || {}) } };
  let destinationLot = null;
  let movementId;
  if (resolution === "released_existing_lot") {
    check(typeof p.destinationLotId === "string" && p.destinationLotId.length > 0, "Selecciona un lote destino trazable.");
    const targetId = safeId(p.destinationLotId);
    destinationLot = e.lots.find((item) => item.id === targetId);
    check(destinationLot && destinationLot.id !== lot.id && destinationLot.productId === product.id, "El lote destino no corresponde al mismo producto.");
    check(!destinationLot.quarantined && (!destinationLot.expiresOn || destinationLot.expiresOn >= o.today) && destinationLot.lotCode?.trim() && validDate(destinationLot.manufacturedOn) && validDate(destinationLot.expiresOn) && Number.isFinite(destinationLot.productionCost) && destinationLot.productionCost >= 0, "El lote destino debe estar vigente y tener código, fechas y costo válidos.");
    destinationLot.quantities = { ...(destinationLot.quantities || {}), [loc]: roundAt(Number(destinationLot.quantities?.[loc] || 0) + quantity, quantityPrecision(product)) };
    updatedLot.quantities[loc] = 0;
    updatedLot.quarantineResolution = "released_existing_lot";
    updatedLot.quarantineDestinationLotId = destinationLot.id;
    updatedLot.quarantineDestinationLotCode = destinationLot.lotCode;
    movementId = o.ledger(product.id, quantity, loc, loc, "quarantine_release", { lotId: lot.id, destinationLotId: destinationLot.id, quarantineSourceLotId: lot.id, note: reason });
  } else if (resolution === "released_new_lot") {
    const lotCode = String(p.newLotCode || "").trim();
    const manufacturedOn = p.manufacturedOn;
    const expiresOn = p.expiresOn;
    const productionCost = p.productionCost;
    check(lotCode.length > 0 && lotCode.length <= 80 && validDate(manufacturedOn) && validDate(expiresOn) && manufacturedOn <= o.today && expiresOn >= manufacturedOn && Number.isFinite(productionCost) && productionCost >= 0, "Completa un código, fechas válidas y costo de producción para identificar el nuevo lote.");
    check(!e.lots.some((item) => item.id !== lot.id && item.productId === product.id && item.lotCode === lotCode && item.manufacturedOn === manufacturedOn), "Ya existe un lote con ese código y fecha de elaboración.");
    updatedLot = { ...updatedLot, lotCode, manufacturedOn, expiresOn, productionCost: round(productionCost), quarantined: false, legacy: false };
    updatedLot.quarantineResolution = "released_new_lot";
    updatedLot.quarantineDestinationLotId = lot.id;
    updatedLot.quarantineDestinationLotCode = lotCode;
    movementId = o.ledger(product.id, quantity, loc, loc, "quarantine_release", { lotId: lot.id, destinationLotId: lot.id, quarantineSourceLotId: lot.id, note: reason });
  } else if (resolution === "discarded") {
    updatedLot.quantities[loc] = 0;
    updatedLot.quarantineResolution = "discarded";
    updatedLot.quarantineLossCost = Number.isFinite(lot.productionCost) ? round(quantity * lot.productionCost) : null;
    o.move(e, loc, -quantity, quantityPrecision(product));
    movementId = o.ledger(product.id, quantity, loc, null, "quarantine_discard", { lotId: lot.id, quarantineSourceLotId: lot.id, lossCost: updatedLot.quarantineLossCost, note: reason });
  } else {
    check(false, "Selecciona una resolución válida.");
  }
  updatedLot.quarantineResolvedAt = o.now;
  updatedLot.quarantineResolvedBy = o.actor;
  updatedLot.quarantineResolvedByName = o.member.displayName || o.actor;
  updatedLot.quarantineResolutionReason = reason;
  updatedLot.quarantineResolvedQuantity = quantity;
  updatedLot.quarantineResolvedLocation = loc;
  updatedLot.quarantineOriginalLotCode = lot.quarantineOriginalLotCode || lot.lotCode || "";
  const cachedLot = e.lots.find((item) => item.id === lot.id);
  if (cachedLot) Object.assign(cachedLot, updatedLot);
  o.put("distLots", lot.id, updatedLot);
  o.put("distLotHistory", `${o.id}__history`, {
    id: `${o.id}__history`, ...o.base(), lotId: lot.id, productId: product.id, operationId: o.id,
    action: "quarantine_resolution", resolution, reason, quantity, location: loc, movementId,
    previous: { lotCode: lot.lotCode, manufacturedOn: lot.manufacturedOn, expiresOn: lot.expiresOn, productionCost: lot.productionCost, quarantined: lot.quarantined, quantity },
    next: { lotCode: updatedLot.lotCode, manufacturedOn: updatedLot.manufacturedOn, expiresOn: updatedLot.expiresOn, productionCost: updatedLot.productionCost, quarantined: updatedLot.quarantined, quantity: updatedLot.quantities[loc] },
    destinationLotId: destinationLot?.id || (resolution === "released_new_lot" ? lot.id : ""),
    destinationLotCode: destinationLot?.lotCode || (resolution === "released_new_lot" ? updatedLot.lotCode : ""),
    actor: o.actor, actorName: o.member.displayName || o.actor,
  });
  return { lotId, resolution, quantity, location: loc, destinationLotId: destinationLot?.id || (resolution === "released_new_lot" ? lot.id : ""), movementId };
};

// Audited correction for the confirmed 15 kg vs 1.5 kg entry error on
// Luciano's 2026-10-17 Mortadela jamonada Granel closure. This is not a loss.
handlers.rectifyQuarantineInputError = async (o, p) => {
  o.admin();
  const lotId = safeId(p.lotId), movementId = safeId(p.movementId);
  const dispatchId = safeId(p.dispatchId), closureId = safeId(p.closureId);
  const productId = safeId(p.productId), amount = 13.5;
  const reason = "Rectificación aprobada: error de digitación en el retorno de Luciano del 17/10/2026. Se registraron 15 kg en lugar de 1,5 kg; 13,5 kg no existieron físicamente.";
  check(p.confirmation === "RECTIFICAR-13.5-KG-FICTICIOS", "Confirma explícitamente la rectificación del registro incorrecto.");

  const [lot, product, dispatch, closure, movement] = await Promise.all([
    o.read("distLots", lotId), o.read("distProducts", productId),
    o.read("distDispatches", dispatchId), o.read("distClosures", closureId),
    o.read("distStockMovements", movementId),
  ]);
  check(lot && product && dispatch && closure && movement, "No se encontró toda la trazabilidad. No se modificó el inventario.");
  check(product.unitType === "kg" && /mortadela\s+jamonada\s+granel/i.test(product.name), "El producto no corresponde al incidente autorizado.");
  check(dispatch.dayKey === "2026-10-17" && dispatch.routeId === "route-sacaba" && /luciano/i.test(String(dispatch.distributorName || "")) && dispatch.status === "closed", "El despacho no corresponde a la jornada y ruta autorizadas.");
  check(closure.id === closureId && closure.dispatchId === dispatchId && closure.dayKey === "2026-10-17" && /luciano/i.test(String(closure.distributorName || "")) && closure.status === "closed", "El cierre no corresponde al despacho y jornada autorizados.");
  check(!closure.rectification && !closure.rectificationId, "El cierre ya tiene una rectificación anterior.");
  const row = (closure.products || []).find((item) => item.productId === productId);
  check(row && Number(row.totalLoaded) === 5 && Number(row.sold) === 3.5 && Number(row.expectedReturn) === 1.5 && Number(row.physicalReturn) === 15 && Number(row.actualReturn) === 15 && Number(row.overage) === amount, "Las cantidades efectivas ya no prueban el error exacto 15 kg frente a 1,5 kg.");
  check(lot.productId === productId && lot.lotCode === "SOBRANTE POR REVISAR" && lot.quarantined === true && !lot.quarantineResolvedAt && !lot.quarantineResolution && Number(lot.quantities?.central) === amount && Object.entries(lot.quantities || {}).every(([loc, value]) => loc === "central" || Number(value || 0) === 0), "La cuarentena ya cambió o fue resuelta.");
  check(movement.type === "overage" && movement.lotId === lotId && movement.dispatchId === dispatchId && !movement.reversedAt && Number(movement.quantity) === amount && Number(movement.centralDelta) === amount && movement.toLocation === "central", "El movimiento de sobrante ya cambió.");
  const sourceOperation = movement.refId ? await o.read("distOperations", movement.refId) : null;
  check(sourceOperation?.type === "closure" && sourceOperation.status === "confirmed" && sourceOperation.payload?.mode === "warehouse" && sourceOperation.payload?.closure?.dispatchId === dispatchId, "No se verificó la operación confirmada que originó el sobrante.");

  const lotMovements = await o.query("distStockMovements", "lotId", lotId);
  check(lotMovements.filter((item) => !item.reversedAt).length === 1 && lotMovements.some((item) => item.id === movementId && !item.reversedAt), "El lote tiene movimientos posteriores; requiere revisión administrativa.");
  const allLots = await o.query("distLots", "productId", productId);
  const balance = await o.read("distBalances", balanceId("central", productId));
  const precision = quantityPrecision(product);
  const lotTotal = roundAt(allLots.reduce((sum, item) => sum + Number(item.quantities?.central || 0), 0), precision);
  const balanceTotal = roundAt(Number(balance?.quantity || 0), precision);
  check(balance && Math.abs(balanceTotal - lotTotal) < 0.5 / (10 ** precision), "El balance central y los lotes no concilian; no se modificó el inventario.");
  check(lotTotal >= amount && balanceTotal >= amount, "El stock central no contiene íntegramente la cantidad ficticia.");

  const entry = await o.loadStock(productId, "central");
  const sourceLot = entry.lots.find((item) => item.id === lotId);
  check(sourceLot && entry.balances.get("central") && roundAt(Number(sourceLot.quantities?.central || 0), precision) === amount, "La cuarentena cambió durante la transacción.");
  await o.assertNoActiveReservation(sourceLot, 'central', 'La cuarentena tiene producto reservado y requiere revisión antes de rectificarla.');
  sourceLot.quantities = { ...(sourceLot.quantities || {}), central: 0 };
  o.move(entry, "central", -amount, precision);
  sourceLot.quarantined = true;
  sourceLot.quarantineResolvedAt = o.now;
  sourceLot.quarantineResolvedBy = o.actor;
  sourceLot.quarantineResolvedByName = o.member.displayName || o.actor;
  sourceLot.quarantineResolution = "rectified_input_error";
  sourceLot.quarantineResolutionReason = reason;
  sourceLot.quarantineResolvedQuantity = amount;
  sourceLot.quarantineResolvedLocation = "central";
  sourceLot.quarantineOriginalLotCode = sourceLot.quarantineOriginalLotCode || sourceLot.lotCode;
  sourceLot.quarantineRectificationOriginalQuantity = 15;
  sourceLot.quarantineRectificationPhysicalQuantity = 1.5;
  const correctionMovementId = o.ledger(productId, amount, "central", null, "quarantine_rectification", {
    lotId, quarantineSourceLotId: lotId, dispatchId, refType: "closure", refId: closureId,
    sourceMovementId: movementId, sourceOperationId: sourceOperation.id, reason,
    recordedQuantity: 15, physicalQuantity: 1.5, fictitiousQuantity: amount,
    lossCost: null, note: reason,
  }, precision);
  // Keep original quantity/delta intact and add a two-way audit link.
  o.put("distStockMovements", movementId, {
    ...movement, rectifiedAt: o.now, rectifiedByOperationId: o.id,
    rectifiedByMovementId: correctionMovementId, rectificationReason: reason,
  });
  o.put("distLotHistory", `${o.id}__history`, {
    id: `${o.id}__history`, ...o.base(), lotId, productId, operationId: o.id,
    action: "quarantine_input_error_rectification", resolution: "rectified_input_error",
    quantity: amount, location: "central", reason, actor: o.actor,
    actorName: o.member.displayName || o.actor, dispatchId, closureId,
    sourceMovementId: movementId, sourceOperationId: sourceOperation.id,
    correctionMovementId,
    previous: { lotCode: lot.lotCode, quarantined: true, quantity: amount },
    next: { lotCode: lot.lotCode, quarantined: true, quantity: 0, resolution: "rectified_input_error" },
    recordedQuantity: 15, physicalQuantity: 1.5, fictitiousQuantity: amount,
  });
  return { lotId, dispatchId, closureId, productId, sourceMovementId: movementId, correctionMovementId, quantity: amount, resolution: "rectified_input_error" };
};
async function refreshCreditStatus(db, root, customerId) {
  await db.runTransaction(async (tx) => {
    const rows = await tx.get(
      root.collection("distReceivables").where("customerId", "==", customerId),
    );
    const dates = rows.docs
      .map((d) => d.data())
      .filter((r) => r.balance > 0)
      .map((r) => r.createdAt)
      .sort();
    tx.set(root.collection("distCreditStatus").doc(customerId), {
      id: customerId,
      restaurantId: root.id,
      oldestPendingAt: dates[0] || null,
      checkedAt: new Date().toISOString(),
    });
  });
}
module.exports.refreshCreditStatus = refreshCreditStatus;

handlers.reopen = async (o, p) => {
  o.admin();
  check(p.reason?.trim(), "La razón de la reapertura es obligatoria.");
  const c = await o.read("distClosures", p.closureId);
  check(!c?.rectification, "Este cierre tiene una rectificación auditada y requiere revisión administrativa especializada antes de reabrirlo.");
  check(c?.status === "closed", "Solo se puede reabrir un cierre finalizado.");
  const d = c.dispatchId ? await o.read("distDispatches", c.dispatchId) : null;
  let reversedMovementIds = [];
  if (d) {
    check(d.status === "closed", "El despacho no está cerrado.");
    const others = await o.query("distDispatches", "routeId", c.routeId);
    check(
      !others.some((x) => x.id !== d.id && x.status === "open"),
      "La ruta tiene otro despacho abierto.",
    );
    const route = location("route", d.routeId);
    const warehouse = location("warehouse", d.warehouseId || "central");
    const reversed = new Set(c.reversedStockMovementIds || []);
    const closureOperations = (await o.query("distOperations", "payload.closure.dispatchId", d.id))
      .filter((operation) => operation.type === "closure" && operation.payload?.mode === "warehouse" && operation.status === "confirmed");
    const movementsById = new Map();
    for (const operation of closureOperations) {
      for (const movement of await o.query("distStockMovements", "refId", operation.id)) {
        if (["return", "return_merma", "return_waste", "return_waste_unassigned", "shortage", "overage", "dispatch_merma_sale", "derived_claim_quarantine_transfer"].includes(movement.type)) movementsById.set(movement.id, movement);
      }
    }
    const movements = [...movementsById.values()].filter((movement) => !reversed.has(movement.id) && !movement.reversedAt);
    for (const movement of movements) {
      if (movement.type !== "overage" || !movement.lotId) continue;
      const overageLot = await o.read("distLots", movement.lotId);
      check(!overageLot?.quarantineResolvedAt, "Este cierre tiene un sobrante que ya fue revisado, liberado o descartado. Requiere revisión administrativa antes de reabrirlo.");
    }
    // Reapertura revierte exactamente la recepción anterior por sus lotes
    // originales. Si el producto ya no está disponible en almacén/cuarentena,
    // la transacción falla y no permite una segunda aplicación duplicada.
    for (const movement of [...movements].reverse()) {
      const e = await o.loadStock(movement.productId, route);
      await o.loadStock(movement.productId, warehouse);
      if (movement.type === 'derived_claim_quarantine_transfer') {
        const moved = await moveDerivedReturnQuarantine(o, e, {
          lotId: movement.lotId, reservationId: movement.quarantineReservationId, claimId: movement.claimId,
          quantity: movement.quantity, allocations: movement.allocations || [], from: warehouse, to: route,
          dispatchId: d.id, sourceSaleId: movement.sourceSaleId,
        });
        const claim = await o.read('distClaims', movement.claimId);
        check(claim && claim.saleId === movement.sourceSaleId && claim.quarantineTransferMovementIds?.includes(movement.id),
          'No se puede reabrir: el traslado de cuarentena ya no corresponde al reclamo original.');
        o.put('distClaims', claim.id, { ...claim, quarantineTransferredAt: '', quarantineTransferredBy: '', quarantineTransferredTo: route,
          quarantineTransferMovementIds: (claim.quarantineTransferMovementIds || []).filter(id => id !== movement.id),
          quarantineTransferReversalMovementIds: [...(claim.quarantineTransferReversalMovementIds || []), moved.movementId] });
      } else if (movement.type === "return" || movement.type === "return_merma") {
        const allocations = movement.allocations || [];
        check(allocations.length > 0, "No se puede reabrir: faltan lotes del retorno confirmado.");
        for (const part of allocations) {
          const lot = e.lots.find((item) => item.id === part.lotId);
          check(lot, "No se puede reabrir: falta el lote retornado.");
          await o.assertNoActiveReservation(lot, warehouse, "No se puede reabrir: el lote recibido tiene una reserva activa; revisar antes de revertir físicamente la recepción.");
          origins.remove(lot, warehouse, part);
          o.removeProcessingAllocation(lot, warehouse, part);
          origins.restore(lot, route, part);
          o.restoreProcessingAllocation(lot, route, part);
        }
        o.move(e, warehouse, -movement.quantity);
        o.move(e, route, movement.quantity);
      } else if (movement.type === "return_waste_unassigned") {
        // Pérdida recibida sin lote/saldo de origen trazable: se revierte su
        // registro de auditoría, pero no se inventa stock de ruta al reabrir.
      } else if (movement.type === "return_waste" || movement.type === "shortage") {
        const allocations = movement.allocations || [];
        check(allocations.length > 0, "No se puede reabrir: faltan asignaciones de lote para la merma o faltante.");
        for (const part of allocations) {
          const lot = e.lots.find((item) => item.id === part.lotId);
          check(lot, "No se puede reabrir: falta un lote original de la ruta.");
          origins.restore(lot, route, part);
          o.restoreProcessingAllocation(lot, route, part);
        }
        o.move(e, route, movement.quantity);
      } else if (movement.type === "dispatch_merma_sale") {
        const allocations = movement.allocations || [];
        check(allocations.length > 0, "No se puede reabrir: faltan lotes de la merma adicional conciliada con ventas.");
        for (const part of allocations) {
          const lot = e.lots.find((item) => item.id === part.lotId);
          check(lot, "No se puede reabrir: falta un lote de la merma adicional conciliada.");
          origins.restore(lot, route, part);
        }
        o.move(e, route, movement.quantity);
      } else {
        const lot = e.lots.find((item) => item.id === movement.lotId && item.quarantined);
        check(lot && round(lot.quantities?.[warehouse] || 0) >= movement.quantity, "No se puede reabrir: el sobrante en cuarentena ya no está disponible.");
        lot.quantities[warehouse] = round(lot.quantities[warehouse] - movement.quantity);
        o.move(e, warehouse, -movement.quantity);
      }
      o.put("distStockMovements", movement.id, {
        ...movement,
        reversedAt: o.now,
        reversedBy: o.actor,
        reversalOperationId: o.id,
        reversalReason: p.reason.trim(),
      });
      reversed.add(movement.id);
    }
    reversedMovementIds = movements.map((movement) => movement.id);
  }
  const reopenHistory = [...(c.reopenHistory || [])];
  const preserveFinancialSnapshot = p.preserveFinancialSnapshot === true;
  if (c.warehouseClosedBy) {
    const previousClosedAt = c.closedAt || c.warehouseClosedAt || "";
    const previousClosedBy = c.closedBy || c.warehouseClosedBy || "";
    const previousClosedByName = c.closedByName || "";
    reopenHistory.push({
      reopenedAt: o.now,
      reason: p.reason.trim(),
      preserveFinancialSnapshot,
      warehouseClosedBy: c.warehouseClosedBy,
      warehouseClosedAt: c.warehouseClosedAt || "",
      products: c.products || [],
      reopenedBy: o.actor,
      reopenedByName: o.member.displayName || o.actor,
      ...(previousClosedAt ? { previousClosedAt } : {}),
      ...(previousClosedBy ? { previousClosedBy } : {}),
      ...(previousClosedByName ? { previousClosedByName } : {}),
    });
  }
  o.put("distClosures", c.id, {
    ...c,
    status: "reopened",
    warehouseClosedBy: "",
    warehouseReopenedAt: o.now,
    reopenHistory,
    reversedStockMovementIds: [...new Set([...(c.reversedStockMovementIds || []), ...reversedMovementIds])],
    reopenedBy: o.actor,
    reopenedByName: o.member.displayName || o.actor,
    reopenedAt: o.now,
    reopenReason: p.reason.trim(),
    preserveFinancialSnapshot,
  });
  if (d) {
    o.put("distDispatches", d.id, {
      ...d,
      status: "open",
      closedAt: "",
      closureId: "",
    });
  }
  return { id: c.id };
};

handlers.rectifyClosureAttribution = async (o, p) => {
  o.admin();
  check(typeof p.reason === 'string' && p.reason.trim().length >= 10, 'Escribe el motivo de la rectificación.');
  const original = await o.read('distClosures', p.closureId);
  check(original && !original.rectification, 'El cierre no existe o ya fue rectificado.');
  const dispatch = await o.read('distDispatches', original.dispatchId);
  const sources = {
    sales: await o.query('distSales', 'dispatchId', original.dispatchId),
    collections: await o.query('distCollections', 'routeId', original.routeId),
    expenses: await o.query('distExpenses', 'routeId', original.routeId),
    claims: await o.query('distClaims', 'routeId', original.routeId),
  };
  let plan;
  try { plan = require('./closure-rectification.cjs').planClosureRectification(original, dispatch, sources); }
  catch(error) { check(false, error.message); }
  check(plan.originalHash === p.expectedOriginalHash && plan.sourceHash === p.expectedSourceHash,
    'El cierre o sus fuentes cambiaron desde la revisión. No se aplicó ninguna rectificación.');
  const id = `${original.id}__rectification_v1`;
  check(!await o.read('distClosureRectifications', id), 'La rectificación ya existe.');
  const record = { id, restaurantId:'sanjose', version:1, closureId:original.id, dispatchId:original.dispatchId,
    routeId:original.routeId, distributorUid:original.distributorUid, dayKey:original.dayKey,
    createdAt:o.now, createdBy:o.actor, createdByName:o.member.displayName || o.actor,
    reason:p.reason.trim(), operationId:o.id, ...plan };
  // Original business fields remain untouched. Both audit record and projection
  // pointer are written in the same transaction, without loading/moving stock.
  o.put('distClosureRectifications', id, record);
  o.put('distClosures', original.id, {...original,rectificationId:id,rectification:record});
  return {id,closureId:original.id,version:1,originalHash:plan.originalHash,sourceHash:plan.sourceHash};
};

handlers.reviewVariance = async (o, p) => {
  o.admin();
  const c = await o.read("distClosures", p.closureId);
  check(c, "No existe el cierre indicado.");
  check(
    ["warehouse_done", "closed"].includes(c.status),
    "La conciliación todavía no está finalizada.",
  );
  check(
    Array.isArray(c.products) &&
      c.products.some((row) => Math.abs(Number(row.variance) || 0) > 0.001),
    "Este cierre no tiene diferencias de producto.",
  );
  check(typeof p.reviewed === "boolean", "Estado de revisión inválido.");
  o.put("distClosures", c.id, {
    ...c,
    varianceReviewedBy: p.reviewed ? o.actor : "",
    varianceReviewedAt: p.reviewed ? o.now : "",
  });
  return { id: c.id, reviewed: p.reviewed };
};

handlers.creditStatus = async (o, p) => {
  check(["admin", "distributor"].includes(o.member.role), "Sin permiso.");
  const c = await o.read("distCustomers", p.customerId);
  check(c, "Cliente inexistente.");
  const rows = await o.query("distReceivables", "customerId", c.id);
  const dates = rows
    .filter((r) => r.balance > 0)
    .map((r) => r.createdAt)
    .sort();
  const status = {
    id: c.id,
    restaurantId: "sanjose",
    oldestPendingAt: dates[0] || null,
    checkedAt: o.now,
  };
  o.put("distCreditStatus", c.id, status);
  return status;
};
