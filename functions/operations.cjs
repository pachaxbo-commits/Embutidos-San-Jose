const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const expensePresetRegistry = require("./expense-presets.json");
const origins = require('./origin-traceability.cjs');
const expenseCategoryDefaults = expensePresetRegistry.defaults;
const round = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const roundAt = (n, precision = 2) => Math.round((Number(n) + Number.EPSILON) * (10 ** precision)) / (10 ** precision);
const quantityPrecision = (product) => product?.unitType === "kg" ? 3 : 2;
// Alias financiero de Administración. No incluye Impulsación ni rutas operativas.
const isAdministrationRouteId = (routeId) => routeId === "admin" || routeId === "administracion";
const isSaleForDispatch = (sale, routeId) =>
  (!sale.routeId || sale.routeId === routeId) && sale.sourceLocation !== "centralWarehouse";
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
    this.sequence = 0;
  }
  ref(col, id) {
    return this.root.collection(col).doc(safeId(id));
  }
  async read(col, id) {
    const key = `${col}/${id}`;
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
    this.writes.set(`${col}/${id}`, {
      ref: this.ref(col, id),
      data: JSON.parse(JSON.stringify(value)),
    });
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
  async take(pid, loc, quantity, { allowExpired = false, lotId, allocationsRequested, precision: requestedPrecision } = {}) {
    const e = await this.loadStock(pid, loc);
    const precision = requestedPrecision ?? quantityPrecision(e.p);
    const amountPrecision = requestedPrecision ?? quantityPrecision(e.p);
    quantity = this.amount(quantity, e.p, false, amountPrecision);
    const allowPendingOrigin = loc.startsWith('route__');
    const usable = lot => roundAt((lot.quantities?.[loc] || 0) - (allowPendingOrigin ? 0 : origins.pending(lot, loc)), precision);
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
        check(allowExpired || (!lot.quarantined && (!lot.expiresOn || lot.expiresOn >= this.today)), "El lote está vencido o en cuarentena.");
        check(usable(lot) >= requestedQuantity, `El lote ${lot.lotCode || lot.id} no tiene cantidad identificada suficiente; revisa reservas de origen.`);
        return { lot, quantity: requestedQuantity };
      });
      check(Math.abs(roundAt(requested.reduce((sum, part) => sum + part.quantity, 0), precision) - quantity) < 1 / (10 ** precision), "La distribución por lotes debe coincidir con la cantidad total.");
      const allocations = requested.flatMap(({ lot, quantity: requestedQuantity }) => origins.take(lot, loc, requestedQuantity, allowPendingOrigin));
      this.move(e, loc, -quantity, precision);
      return allocations;
    }
    const lots = e.lots
      .filter(
        (l) =>
          usable(l) > 0 &&
          (!lotId || l.id === lotId) &&
          (allowExpired ||
            (!l.quarantined && (!l.expiresOn || l.expiresOn >= this.today))),
      )
      .sort(
        (a, b) =>
          (a.expiresOn || "9999").localeCompare(b.expiresOn || "9999") ||
          a.id.localeCompare(b.id),
      );
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
      allocations.push(...origins.take(l, loc, q, allowPendingOrigin));
    }
    this.move(e, loc, -quantity, precision);
    return allocations;
  }
  async moveStock(pid, from, to, q, options = {}) {
    const e = await this.loadStock(pid, from);
    await this.loadStock(pid, to);
    const precision = quantityPrecision(e.p);
    const parts = await this.take(pid, from, q, options);
    for (const a of parts) {
      const l = e.lots.find((x) => x.id === a.lotId);
      origins.restore(l, to, a);
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
      ...(origins.references(extra.allocations).length ? { originReferences: origins.references(extra.allocations), traceabilityStatus: 'physical_origin_pending', note: `${extra.note || ''} ${origins.note}`.trim() } : {}),
    });
    return id;
  }
  flush() {
    for (const e of this.stock.values()) {
      for (const l of e.lots) this.put("distLots", l.id, l);
      for (const b of e.balances.values()) this.put("distBalances", b.id, b);
    }
    for (const w of this.writes.values()) this.tx.set(w.ref, w.data);
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
  const parts = await o.moveStock(p.line.productId, from, to, p.line.quantity);
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
    const allocations = await o.moveStock(l.productId, from, to, physicalQuantity, options);
    const effective = linesByProduct.get(l.productId) || { productId: l.productId, productName: product.name, unitType: product.unitType, quantity: 0, normalQuantity: 0, dispatchMerma: 0, allocations: [], dispatchMermaAllocations: [] };
    effective.quantity = round(effective.quantity + l.quantity);
    effective.normalQuantity = round((effective.normalQuantity || 0) + normalQuantity);
    effective.dispatchMerma = round((effective.dispatchMerma || 0) + dispatchMerma);
    for (const allocation of allocations) {
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
      if (existing) existing.quantity = round(existing.quantity + allocation.quantity);
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
    origins.restore(lot, warehouse, part);
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
              { lotId: c.lotId || line.lotId },
            );
          } else {
            allocationsAdded = await o.moveStock(
              line.productId,
              warehouse,
              route,
              addQty,
            );
          }
        } catch (lotErr) {
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
                { lotId: c.lotId || line.lotId },
              );
            } else {
              allocationsAdded = await o.moveStock(
                line.productId,
                warehouse,
                route,
                addQty,
              );
            }
          } catch (lotErr) {
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
    const allocations = await o.take(l.productId, loc, physicalQuantity, { precision: quantityPrecision(product) });
    const known = allocations.every((a) => a.productionCost !== null);
    lines.push({
      productId: l.productId,
      productNameSnapshot: product.name,
      presentationSnapshot: product.presentation || product.category || "",
      descriptionSnapshot: product.description || "",
      unitType: product.unitType,
      quantity: l.quantity,
      ...(physicalQuantity !== chargedQuantity ? { physicalQuantity, excessWeightQuantity } : {}),
      actualUnitPrice: round(actualUnitPrice),
      referenceUnitPrice: round(product.referencePrice),
      isPromotional: promotional,
      subtotal: isCourtesy ? 0 : round(l.quantity * actualUnitPrice),
      ...(isCourtesy ? { referenceSubtotal: round(l.quantity * product.referencePrice) } : {}),
      allocations,
      costTotal: known
        ? round(
            allocations.reduce((s, a) => s + a.quantity * a.productionCost, 0),
          )
        : null,
    });
    o.ledger(l.productId, physicalQuantity, loc, null, isCourtesy ? "courtesy" : "sale", {
      allocations,
      ...(excessWeightQuantity > 0 ? { chargedQuantity, excessWeightQuantity, note: `Excedente de peso entregado: ${excessWeightQuantity} kg` } : {}),
      ...(isCourtesy ? { courtesyReason: p.courtesyReason.trim(), lossCost: known ? round(allocations.reduce((sum, a) => sum + a.quantity * a.productionCost, 0)) : null } : {}),
    });
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
  const updated = { ...product, unitType: p.unitType, approximateWeightKg: p.unitType === "kg" ? null : product.approximateWeightKg ?? null, updatedAt: o.now, updatedBy: o.actor };
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
async function editSale(o, p) {
  check(["admin", "distributor"].includes(o.member.role), "Sin permiso para corregir ventas.");
  check(p.reason?.trim(), "La razón de la edición es obligatoria.");
  const sale = await o.read("distSales", p.saleId);
  check(sale, "Venta inexistente.");
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
    lines.push({ productId: product.id, productNameSnapshot: product.name, presentationSnapshot: product.presentation || product.category || "", descriptionSnapshot: product.description || "", quantity, ...(physicalQuantity !== quantity ? { physicalQuantity, excessWeightQuantity: roundAt(physicalQuantity - quantity, quantityPrecision(product)) } : {}), unitType: product.unitType, actualUnitPrice: round(input.actualUnitPrice), referenceUnitPrice, isPromotional: isCourtesy ? false : promotional, subtotal: lineSubtotal, ...(isCourtesy ? { referenceSubtotal: round(quantity * referenceUnitPrice) } : {}), allocations, costTotal: allocations.every(a => a.productionCost !== null) ? round(allocations.reduce((sum, a) => sum + a.quantity * a.productionCost, 0)) : null });
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
  const groups = ["administration", "indirect", "equipment", "other", "production_additional", "production_input"];
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
  if (typeof p.presetId === "string" && p.presetId.startsWith("admin-category:")) {
    o.admin();
    const id = safeId(p.presetId.slice("admin-category:".length));
    const saved = await o.read("distExpenseCategories", id);
    const defaultIndex = Number(String(id).split("-").at(-1)) - 1;
    const defaultGroup = groups.find((candidate) => id.startsWith(`${candidate}-`));
    const defaultName = defaultGroup && expenseCategoryDefaults[defaultGroup]?.[defaultIndex];
    check(saved ? saved.active === true && groups.includes(saved.group) : Boolean(defaultName), "La categoría ya no está activa. Actualiza la selección.");
    group = saved?.group || defaultGroup;
    categoryId = id;
    category = saved?.name || defaultName;
    check(group && category, "La categoría seleccionada no es válida.");
    economicType = group === "production_input" ? "production_input" : "operating_expense";
    classificationStatus = "reviewed";
    classificationSource = "admin_review";
    concept = category;
  } else if (typeof p.presetId === "string" && p.presetId.startsWith("category:")) {
    const id = safeId(p.presetId.slice("category:".length));
    const saved = await o.read("distExpenseCategories", id);
    check(saved?.active && saved.autoClassifiable === true && (o.member.role === "admin" || saved.distributorVisible === true), "Esta categoría no está habilitada para el registro automático.");
    check(groups.includes(saved.group), "El grupo de la categoría no es válido.");
    group = saved.group;
    categoryId = id;
    category = saved.name;
    economicType = group === "production_input" ? "production_input" : "operating_expense";
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
    categoryId = preset.categoryId;
    const saved = await o.read("distExpenseCategories", categoryId);
    check(!saved || (saved.active && saved.group === group), "La categoría ya no está activa. Actualiza la selección.");
    category = saved?.name || preset.categoryName;
    economicType = preset.economicType;
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
    check(groups.includes(group), "El grupo del egreso no es válido.");
    economicType = p.economicType || (p.affectsOperatingResult === false ? "production_input" : "operating_expense");
    check(["operating_expense", "production_input"].includes(economicType), "El tipo de salida no es válido.");
    check(p.affectsOperatingResult === undefined || p.affectsOperatingResult === (economicType === "operating_expense"), "El tipo de salida y su tratamiento económico no coinciden.");
    check(economicType === "production_input" ? group === "production_input" : group !== "production_input", "El grupo debe corresponder al tipo de salida.");
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
  };
  o.put("distExpenses", o.id, e);
  return e;
}

async function deleteExpense(o, p) {
  o.admin();
  check(String(p.reason || "").trim(), "Indica el motivo de anulación del egreso.");
  const expense = await o.read("distExpenses", p.expenseId);
  check(expense && !expense.voided, "El gasto ya no está activo.");
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
  const groups = ["administration", "indirect", "equipment", "other", "production_additional", "production_input"];
  const id = safeId(p.categoryId);
  const name = String(p.name || "").trim();
  check(groups.includes(p.group), "El grupo de la categoría no es válido.");
  check(name.length > 0 && name.length <= 60, "Escribe una categoría de hasta 60 caracteres.");
  const previous = await o.read("distExpenseCategories", id);
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

async function classifyExpense(o, p) {
  o.admin();
  const expense = await o.read("distExpenses", safeId(p.expenseId));
  check(expense && !expense.voided, "El egreso ya no está activo.");
  const groups = ["administration", "indirect", "equipment", "other", "production_additional", "production_input"];
  check(groups.includes(p.group), "El grupo del egreso no es válido.");
  const categoryId = safeId(p.categoryId);
  const category = await o.read("distExpenseCategories", categoryId);
  const index = Number(String(categoryId).split("-").at(-1)) - 1;
  const defaultName = String(categoryId).startsWith(`${p.group}-`) ? expenseCategoryDefaults[p.group]?.[index] : undefined;
  check(category ? category.active && category.group === p.group : Boolean(defaultName), "La categoría ya no está activa.");
  const economicType = p.economicType || (p.affectsOperatingResult === false ? "production_input" : p.affectsOperatingResult === true ? "operating_expense" : undefined);
  check(["operating_expense", "production_input"].includes(economicType), "Selecciona el tipo de salida.");
  check(p.affectsOperatingResult === undefined || typeof p.affectsOperatingResult === "boolean", "La decisión económica del egreso no es válida.");
  check(p.affectsOperatingResult === undefined || p.affectsOperatingResult === (economicType === "operating_expense"), "El tipo de salida y su tratamiento económico no coinciden.");
  check(economicType === "production_input" ? p.group === "production_input" : p.group !== "production_input", "El grupo debe corresponder al tipo de salida.");
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
  const next = { group: p.group, categoryId, categoryName: category?.name || defaultName, economicType, affectsOperatingResult, classificationStatus: "reviewed", classificationSource: "admin_review" };
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

    const sales = (await o.query("distSales", "dayKey", dayKey))
      .filter((s) => isAdministrationRouteId(s.routeId) || (!s.routeId && s.sourceLocation === "centralWarehouse"))
      .map((sale) => (sale.effectiveSnapshot ? { ...sale, ...sale.effectiveSnapshot } : sale));

    const collections = (await o.query("distCollections", "dayKey", dayKey))
      .filter((x) => isAdministrationRouteId(x.routeId) || x.collectedByUid === o.actor);

    const expenses = (await o.query("distExpenses", "dayKey", dayKey))
      .filter((x) => (isAdministrationRouteId(x.routeId) || !x.routeId) && !x.voided);

    const claims = (await o.query("distClaims", "dayKey", dayKey))
      .filter((x) => isAdministrationRouteId(x.routeId));

    const sum = (list, key) => round(list.reduce((n, r) => n + (r[key] || 0), 0));
    const commercialSales = sales.filter((s) => s.saleKind !== "courtesy");
    const cashSales = sum(commercialSales, "cashAmount"),
      cashCollections = round(collections.reduce((n, x) => n + (Number.isFinite(x.cashAmount) ? x.cashAmount : x.method === "cash" ? x.amount : 0), 0)),
      cashExpenses = sum(expenses.filter((expense) => (expense.paymentMethod || "cash") === "cash"), "amount"),
      claimCash = round(sum(claims, "cashIn") - sum(claims, "cashOut")),
      expectedCash = round(
        cashSales + cashCollections - cashExpenses + claimCash,
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
      claimCash,
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
  const sales = (await o.query("distSales", "dispatchId", d.id))
    .filter((sale) => isSaleForDispatch(sale, d.routeId))
    .map((sale) =>
      sale.effectiveSnapshot ? { ...sale, ...sale.effectiveSnapshot } : sale,
    );
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
      const expected = e.balances.get(route).quantity;
      const returnRow = requested.products?.find((r) => r.productId === pid);
      const previousProduct = previous.products?.find((row) => row.productId === pid);
      const actualRaw = Number(returnRow?.actualReturn);
      const wasteRaw = Number(returnRow?.returnWaste || 0);
      const hasRecoverableMerma = Object.prototype.hasOwnProperty.call(returnRow || {}, "returnMerma");
      const precision = hasRecoverableMerma && e.p.unitType === "kg" ? 3 : 2;
      const quantityRound = (value) => roundAt(value, precision);
      const actual = Number.isFinite(actualRaw) ? quantityRound(actualRaw) : Number.NaN;
      const waste = Number.isFinite(wasteRaw) ? quantityRound(wasteRaw) : Number.NaN;
      const recoverableMerma = hasRecoverableMerma && Number.isFinite(Number(returnRow?.returnMerma))
        ? quantityRound(Number(returnRow.returnMerma))
        : hasRecoverableMerma ? Number.NaN : 0;
      const wasteReason = String(returnRow?.returnWasteReason || "").trim();
      // Operaciones nuevas envían tres componentes independientes. En las
      // antiguas returnWaste sigue significando pérdida/no vendible.
      const received = hasRecoverableMerma
        ? quantityRound(actual + recoverableMerma + (Number.isFinite(waste) ? waste : 0))
        : Number.isFinite(Number(returnRow?.physicalReturn))
          ? round(Number(returnRow.physicalReturn))
          : round(actual + (Number.isFinite(waste) ? waste : 0));
      check(
        Number.isFinite(actual) && actual >= 0 && Number.isFinite(received) && received >= 0,
        "Completa las cantidades recibidas físicamente.",
      );
      check(Number.isFinite(waste) && waste >= 0 && Number.isFinite(recoverableMerma) && recoverableMerma >= 0,
        "Las cantidades de merma deben ser válidas y no negativas.");
      check(e.p.unitType === "kg" || [actual, recoverableMerma, waste, received].every(Number.isInteger),
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
      const expectedNormalReturn = quantityRound(normalLoaded - nominalSold - courtesySold);
      const precisionTolerance = precision === 3 ? 0.001 : 0.01;
      // Merma adicional solo se concilia con ventas cuando el saldo transaccional
      // de ruta, las ventas efectivas y el retorno normal coinciden exactamente.
      // El producto no apto se descuenta explícitamente del componente adicional;
      // cualquier diferencia no demostrada queda pendiente y no se imputa a ventas.
      const canSettleDispatchMerma = !legacySemantics && e.p.unitType === "kg"
        && dispatchMermaSent > 0 && nominalSold > 0
        && expectedNormalReturn >= 0
        && Math.abs(expected - (expectedNormalReturn + dispatchMermaSent)) <= precisionTolerance
        && Math.abs(actual - expectedNormalReturn) <= precisionTolerance
        && recoverableMerma + waste <= dispatchMermaSent + precisionTolerance;
      const allDispatchMermaReturned = !legacySemantics && e.p.unitType === "kg"
        && dispatchMermaSent > 0 && waste === 0
        && Math.abs(expected - (expectedNormalReturn + dispatchMermaSent)) <= precisionTolerance
        && Math.abs(actual - expectedNormalReturn) <= precisionTolerance
        && Math.abs(recoverableMerma - dispatchMermaSent) <= precisionTolerance;
      const dispatchMermaIncludedInSales = canSettleDispatchMerma
        ? quantityRound(Math.max(0, dispatchMermaSent - recoverableMerma - waste))
        : 0;
      const adjustedExpected = quantityRound(expected - dispatchMermaIncludedInSales);
      const overage = quantityRound(Math.max(0, received - adjustedExpected));
      const shortage = quantityRound(Math.max(0, adjustedExpected - received));
      check(!(dispatchMermaSent > 0 && !canSettleDispatchMerma && !allDispatchMermaReturned
        && (shortage > precisionTolerance || overage > precisionTolerance)),
      "No se puede confirmar esta recepción: la merma adicional enviada no coincide con las ventas y el retorno normal. Revisa las cantidades físicas y las ventas antes de guardar.");
      // Solo se mueven desde ruta cantidades con saldo y lote comprobables.
      // En el modelo nuevo, normal y merma recuperable se conservan como stock;
      // lo no apto se descuenta como pérdida, nunca vuelve al almacén vendible.
      const accountedRouteQuantity = legacySemantics
        ? quantityRound(normalApt + waste)
        : quantityRound(normalApt + recoverableFromRoute + wasteFromRoute);
      const receivedParts = accountedRouteQuantity > 0
        ? await o.take(pid, route, accountedRouteQuantity, { allowExpired: true, precision })
        : [];
      const [returnParts, recoverableMermaParts, wasteParts] = splitAllocationsByAmounts(
        receivedParts,
        [normalApt, recoverableFromRoute, wasteFromRoute],
      );
      for (const a of [...returnParts, ...recoverableMermaParts]) {
        const lot = e.lots.find((x) => x.id === a.lotId);
        check(lot, "No se encontró el lote del producto retornado.");
        origins.restore(lot, warehouse, a);
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
      let dispatchMermaSaleMovementId;
      let dispatchMermaSaleCost = null;
      if (dispatchMermaIncludedInSales > 0) {
        const soldMermaParts = await o.take(pid, route, dispatchMermaIncludedInSales, { allowExpired: true, precision });
        const costKnown = soldMermaParts.length > 0 && soldMermaParts.every((allocation) => allocation.productionCost !== null);
        dispatchMermaSaleCost = costKnown
          ? round(soldMermaParts.reduce((sum, allocation) => sum + allocation.quantity * allocation.productionCost, 0))
          : null;
        dispatchMermaSaleMovementId = o.ledger(pid, dispatchMermaIncludedInSales, route, null, "dispatch_merma_sale", {
          allocations: soldMermaParts,
          dispatchId: d.id,
          costOfSales: dispatchMermaSaleCost,
          dispatchMermaSent,
          recoverableMermaReturned: recoverableMerma,
          note: "Parte de la merma adicional enviada que salió dentro de ventas registradas; costo incluido una sola vez en costo de venta, no es pérdida.",
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
        const loss = await o.take(pid, route, shortage, { allowExpired: true, precision });
        const knownCost = loss.every((a) => a.productionCost !== null);
        shortageMovementId = o.ledger(pid, shortage, route, null, "shortage", {
          allocations: loss,
          lossCost: knownCost ? round(loss.reduce((sum, a) => sum + a.quantity * a.productionCost, 0)) : null,
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
  const cashSales = sum(commercialSales, "cashAmount"),
    cashCollections = round(collections.reduce((n, x) => n + (Number.isFinite(x.cashAmount) ? x.cashAmount : x.method === "cash" ? x.amount : 0), 0)),
    cashExpenses = sum(expenses.filter((expense) => (expense.paymentMethod || "cash") === "cash"), "amount"),
    claimCash = round(sum(claims, "cashIn") - sum(claims, "cashOut")),
    expectedCash = round(
      cashSales + cashCollections - cashExpenses + claimCash,
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
        claimCash: previous.claimCash,
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
        claimCash,
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
async function claim(o, p) {
  check(["admin", "distributor"].includes(o.member.role), "Sin permiso para registrar cambios o devoluciones.");
  check(p.reason?.trim(), "Indica el motivo del cambio o devolución.");
  check(["exchange", "return"].includes(p.kind), "Tipo de reclamo inválido.");
  const s = await o.read("distSales", p.saleId);
  check(s, "No existe la venta original.");
  check(s.saleKind !== "courtesy" && s.effectiveSnapshot?.saleKind !== "courtesy", "Las cortesías no generan cambios ni devoluciones con movimientos de dinero.");
  const isDistributor = o.member.role === "distributor";
  if (isDistributor) {
    check(s.sellerUid === o.actor, "Solo puedes registrar cambios o devoluciones de tus propias ventas.");
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
Object.assign(handlers, { adjustment, adjustmentRequest, reviewAdjustmentRequest, expense, deleteExpense, saveExpenseCategory, classifyExpense, deleteProduct, closure, claim });
async function updateLot(o, p) {
  o.admin();
  const lot = await o.read("distLots", p.lotId);
  check(lot, "No existe el lote.");
  check(!Object.keys(lot.pendingOrigins || {}).some(loc => origins.pending(lot, loc) > 0), 'Este lote contiene cantidades con origen pendiente; no se puede cambiar su identidad ni costo sin conciliar la excepción.');
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
        if (["return", "return_merma", "return_waste", "return_waste_unassigned", "shortage", "overage", "dispatch_merma_sale"].includes(movement.type)) movementsById.set(movement.id, movement);
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
      if (movement.type === "return" || movement.type === "return_merma") {
        const allocations = movement.allocations || [];
        check(allocations.length > 0, "No se puede reabrir: faltan lotes del retorno confirmado.");
        for (const part of allocations) {
          const lot = e.lots.find((item) => item.id === part.lotId);
          check(lot, "No se puede reabrir: falta el lote retornado.");
          origins.remove(lot, warehouse, part);
          origins.restore(lot, route, part);
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
