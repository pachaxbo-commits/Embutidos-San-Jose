const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const round = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
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
  amount(q, p, negative = false) {
    check(
      Number.isFinite(q) && (negative ? q !== 0 : q > 0),
      "Cantidad inválida.",
    );
    check(
      p.unitType === "kg" || Number.isInteger(q),
      "Paquetes y unidades requieren cantidades enteras.",
    );
    return round(q);
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
      const tracked = round(
        entry.lots.reduce((n, l) => n + (l.quantities?.[loc] || 0), 0),
      );
      const legacy = round((bal?.quantity || 0) - tracked);
      check(
        legacy >= -0.01,
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
  move(entry, loc, delta) {
    const b = entry.balances.get(loc);
    b.quantity = round(b.quantity + delta);
    check(b.quantity >= 0, "Stock insuficiente.");
    b.updatedAt = this.now;
  }
  async take(pid, loc, quantity, { allowExpired = false, lotId } = {}) {
    const e = await this.loadStock(pid, loc);
    quantity = this.amount(quantity, e.p);
    const lots = e.lots
      .filter(
        (l) =>
          (l.quantities?.[loc] || 0) > 0 &&
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
      round(lots.reduce((s, l) => s + (l.quantities[loc] || 0), 0)) >= quantity,
      `Stock apto insuficiente de ${e.p.name}. Revisa lotes vencidos o cantidades.`,
    );
    let remaining = quantity;
    const allocations = [];
    for (const l of lots) {
      if (remaining <= 0) break;
      const q = round(Math.min(remaining, l.quantities[loc]));
      l.quantities[loc] = round(l.quantities[loc] - q);
      remaining = round(remaining - q);
      allocations.push({
        lotId: l.id,
        lotCode: l.lotCode,
        expiresOn: l.expiresOn,
        quantity: q,
        productionCost: l.productionCost ?? null,
      });
    }
    this.move(e, loc, -quantity);
    return allocations;
  }
  async moveStock(pid, from, to, q) {
    const e = await this.loadStock(pid, from);
    await this.loadStock(pid, to);
    const parts = await this.take(pid, from, q);
    for (const a of parts) {
      const l = e.lots.find((x) => x.id === a.lotId);
      l.quantities[to] = round((l.quantities[to] || 0) + a.quantity);
    }
    this.move(e, to, q);
    return parts;
  }
  ledger(pid, q, from, to, type, extra = {}) {
    const e = this.stock.get(pid);
    const id = `${this.id}__${this.sequence++}`;
    this.put("distStockMovements", id, {
      id,
      ...this.base(),
      type,
      productId: pid,
      productName: e.p.name,
      unitType: e.p.unitType,
      quantity: Math.abs(q),
      fromLocation: from || "",
      toLocation: to || "",
      centralDelta: round(
        (to && !to.startsWith("route__") ? q : 0) -
          (from && !from.startsWith("route__") ? q : 0),
      ),
      routeDelta: round(
        (to?.startsWith("route__") ? q : 0) -
          (from?.startsWith("route__") ? q : 0),
      ),
      routeId: (from?.startsWith("route__")
        ? from
        : to?.startsWith("route__")
          ? to
          : ""
      ).slice(7),
      refId: this.id,
      refType: "operation",
      responsibleName: this.member.displayName || this.actor,
      responsibleRole: this.member.role,
      ...extra,
    });
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
  const lines = [];
  for (const l of p.lines) {
    const allocations = await o.moveStock(l.productId, from, to, l.quantity);
    const product = o.stock.get(l.productId).p;
    lines.push({
      productId: l.productId,
      productName: product.name,
      unitType: product.unitType,
      quantity: l.quantity,
      allocations,
    });
    o.ledger(
      l.productId,
      l.quantity,
      from,
      to,
      addition ? "dispatch_addition" : "dispatch",
      { refId: current?.id || o.id, allocations },
    );
  }
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
    additions: [],
    observation: p.observation || "",
  };
  o.put("distDispatches", o.id, d);
  return d;
}
async function sale(o, p) {
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
    check(c.identityNumber, "Completa el CI del cliente antes de vender.");
    const debts = await o.query("distReceivables", "customerId", p.customerId);
    const supportConfig = await o.read("supportConfig", "main");
    const creditBlockDays = Number.isInteger(supportConfig?.creditBlockDays)
      ? supportConfig.creditBlockDays
      : 7;
    check(
      !debts.some(
        (d) =>
          d.balance > 0 &&
          new Date(d.createdAt).getTime() + creditBlockDays * 86400000 <= Date.now(),
      ),
      `Venta bloqueada: el cliente tiene créditos pendientes de ${creditBlockDays} días o más.`,
    );
    p.customerName = c.name;
    p.customerCode = c.identityNumber;
  }
  check(Array.isArray(p.lines) && p.lines.length, "Agrega productos.");
  const lines = [];
  for (const l of p.lines) {
    const product = await o.product(l.productId);
    const promotional = round(l.actualUnitPrice) !== round(product.referencePrice);
    check(
      o.member.role === "admin" || !promotional || l.isPromotional === true,
      "Marca la venta como promocional para modificar el precio.",
    );
    check(
      Number.isFinite(l.actualUnitPrice) && l.actualUnitPrice > 0,
      "Precio inválido.",
    );
    const allocations = await o.take(l.productId, loc, l.quantity);
    const known = allocations.every((a) => a.productionCost !== null);
    lines.push({
      productId: l.productId,
      productNameSnapshot: product.name,
      unitType: product.unitType,
      quantity: l.quantity,
      actualUnitPrice: round(l.actualUnitPrice),
      referenceUnitPrice: round(product.referencePrice),
      isPromotional: promotional,
      subtotal: round(l.quantity * l.actualUnitPrice),
      allocations,
      costTotal: known
        ? round(
            allocations.reduce((s, a) => s + a.quantity * a.productionCost, 0),
          )
        : null,
    });
    o.ledger(l.productId, l.quantity, loc, null, "sale", { allocations });
  }
  const total = round(lines.reduce((n, l) => n + l.subtotal, 0));
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
    operationId: o.id,
    sourceLocation: p.sourceLocation,
    routeId: p.routeId,
    routeName: p.routeName,
    sellerUid: o.actor,
    sellerName: o.member.displayName || o.actor,
    dispatchId: p.dispatchId || "",
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
  const r = await o.read("distReceivables", p.receivable.id);
  check(r, "La deuda no existe.");
  check(
    o.member.role === "admin" ||
      o.member.role === "distributor",
    "No puedes cobrar esta deuda.",
  );
  check(
    Number.isFinite(p.amount) && p.amount > 0 && p.amount <= r.balance,
    "El cobro supera el saldo pendiente.",
  );
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
  r.paidAmount = round(r.paidAmount + p.amount);
  r.balance = round(r.balance - p.amount);
  r.status = r.balance === 0 ? "PAID" : "PARTIAL";
  o.put("distReceivables", r.id, r);
  const collectionRouteId =
    o.member.role === "distributor" ? o.member.routeId : p.routeId || r.routeId;
  check(collectionRouteId, "El cobrador no tiene una ruta asignada.");
  const c = {
    id: o.id,
    ...o.base(),
    operationId: o.id,
    receivableId: r.id,
    saleLines: r.saleLines || [],
    customerId: r.customerId,
    customerName: r.customerName,
    customerCode: r.customerCode || "",
    // El efectivo pertenece a la ruta del usuario que lo recibe. Se conserva
    // aparte la ruta donde nació la deuda para auditoría de la venta original.
    routeId: collectionRouteId,
    originRouteId: r.routeId,
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
const handlers = {
  intake,
  transfer,
  dispatch,
  addition: (o, p) => dispatch(o, p, true),
  sale,
  collection,
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
  check(
    Number.isFinite(p.amount) && p.amount > 0 && p.concept?.trim(),
    "Revisa concepto y monto.",
  );
  const e = {
    id: o.id,
    ...o.base(),
    operationId: o.id,
    concept: p.concept.trim(),
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
  const expense = await o.read("distExpenses", p.expenseId);
  check(expense && !expense.voided, "El gasto ya no está activo.");
  o.put("distExpenses", expense.id, {
    ...expense,
    voided: true,
    voidedAt: o.now,
    voidedBy: o.actor,
    voidedByName: o.member.displayName || o.actor,
  });
  return { id: expense.id, voided: true };
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
  const requested = p.closure;
  const d = await o.read("distDispatches", requested.dispatchId);
  check(d?.status === "open", "La ruta ya está cerrada.");
  const id = `closure_${d.id}`,
    previous = (await o.read("distClosures", id)) || {};
  const route = location("route", d.routeId),
    warehouse = location("warehouse", d.warehouseId || "central");
  const sales = await o.query("distSales", "dispatchId", d.id);
  if (p.mode === "warehouse") {
    o.owns(warehouse);
    check(!previous.warehouseClosedBy, "El retorno ya se confirmó.");
    const ids = [
      ...new Set(
        [
          ...d.lines,
          ...(d.additions || []).flatMap((a) => a.quantityByProduct),
        ].map((l) => l.productId),
      ),
    ];
    const rows = [];
    for (const pid of ids) {
      const e = await o.loadStock(pid, route);
      await o.loadStock(pid, warehouse);
      const expected = e.balances.get(route).quantity;
      const actual = requested.products?.find(
        (r) => r.productId === pid,
      )?.actualReturn;
      check(
        Number.isFinite(actual) && actual >= 0,
        "Completa las cantidades de retorno.",
      );
      const received = Math.min(expected, actual);
      const parts =
        received > 0
          ? await o.take(pid, route, received, { allowExpired: true })
          : [];
      for (const a of parts) {
        const l = e.lots.find((x) => x.id === a.lotId);
        l.quantities[warehouse] = round(
          (l.quantities[warehouse] || 0) + a.quantity,
        );
      }
      o.move(e, warehouse, received);
      if (received)
        o.ledger(pid, received, route, warehouse, "return", {
          allocations: parts,
        });
      if (expected > actual) {
        const loss = await o.take(pid, route, round(expected - actual), {
          allowExpired: true,
        });
        o.ledger(pid, expected - actual, route, null, "shortage", {
          allocations: loss,
          lossCost: loss.every((a) => a.productionCost !== null)
            ? round(loss.reduce((s, a) => s + a.quantity * a.productionCost, 0))
            : null,
        });
      }
      if (actual > expected) {
        const excess = round(actual - expected);
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
          quantities: { [warehouse]: excess },
          createdAt: o.now,
          createdBy: o.actor,
        });
        o.move(e, warehouse, excess);
        o.ledger(pid, excess, null, warehouse, "overage", {
          note: "Sobrante separado hasta verificar lote y origen.",
        });
      }
      const initial = d.lines
          .filter((l) => l.productId === pid)
          .reduce((s, l) => s + l.quantity, 0),
        additions = (d.additions || [])
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
          sales
            .flatMap((s) => s.lines)
            .filter((l) => l.productId === pid)
            .reduce((s, l) => s + l.quantity, 0),
        ),
        expectedReturn: expected,
        actualReturn: actual,
        variance: round(actual - expected),
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
  const cashSales = sum(sales, "cashAmount"),
    cashCollections = round(collections.reduce((n, x) => n + (Number.isFinite(x.cashAmount) ? x.cashAmount : x.method === "cash" ? x.amount : 0), 0)),
    cashExpenses = sum(expenses, "amount"),
    claimCash = round(sum(claims, "cashIn") - sum(claims, "cashOut")),
    expectedCash = round(
      cashSales + cashCollections - cashExpenses + claimCash,
    );
  check(
    Number.isFinite(requested.physicalCashDeclared) &&
      requested.physicalCashDeclared >= 0,
    "Efectivo declarado inválido.",
  );
  const c = {
    ...previous,
    status: "closed",
    cashSales,
    qrSales: sum(sales, "qrAmount"),
    creditGenerated: sum(sales, "creditAmount"),
    cashCollections,
    qrCollections: round(collections.reduce((n, x) => n + (Number.isFinite(x.qrAmount) ? x.qrAmount : x.method === "qr" ? x.amount : 0), 0)),
    cashExpenses,
    claimCash,
    expectedCash,
    physicalCashDeclared: requested.physicalCashDeclared,
    cashDifference: round(requested.physicalCashDeclared - expectedCash),
    closedBy: o.actor,
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
  o.admin();
  check(p.reason?.trim(), "Indica el motivo del cambio o devolución.");
  check(["exchange", "return"].includes(p.kind), "Tipo de reclamo inválido.");
  const s = await o.read("distSales", p.saleId);
  check(s, "No existe la venta original.");
  const orig = s.lines.filter((l) => l.productId === p.productId);
  check(orig.length, "El producto no pertenece a esta venta.");
  const product = await o.read("distProducts", p.productId);
  check(product, "Producto inexistente.");
  const q = o.amount(p.quantity, product);
  const past = await o.query("distClaims", "saleId", s.id);
  check(
    round(
      q +
        past
          .filter((c) => c.productId === p.productId)
          .reduce((n, c) => n + c.quantity, 0),
    ) <= round(orig.reduce((n, l) => n + l.quantity, 0)),
    "La cantidad supera lo vendido o ya fue devuelta.",
  );
  const originalUnit = orig[0].actualUnitPrice;
  check(
    orig.every((l) => l.actualUnitPrice === originalUnit),
    "Esta venta tiene precios distintos para el mismo producto; revisa el comprobante con Administración.",
  );
  const loc = location("warehouse", p.warehouseId || "central");
  if (p.warehouseId && p.warehouseId !== "central")
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
    note: p.reason,
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
Object.assign(handlers, { adjustment, adjustmentRequest, reviewAdjustmentRequest, expense, deleteExpense, deleteProduct, closure, claim });
async function updateLot(o, p) {
  o.admin();
  const lot = await o.read("distLots", p.lotId);
  check(lot, "No existe el lote.");
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
  const c = await o.read("distClosures", p.closureId);
  check(c?.status === "closed", "Solo se puede reabrir un cierre finalizado.");
  const d = await o.read("distDispatches", c.dispatchId);
  check(d?.status === "closed", "El despacho no está cerrado.");
  const others = await o.query("distDispatches", "routeId", c.routeId);
  check(
    !others.some((x) => x.status === "open"),
    "La ruta tiene otro despacho abierto.",
  );
  o.put("distClosures", c.id, {
    ...c,
    status: "reopened",
    reopenedBy: o.actor,
    reopenedAt: o.now,
  });
  o.put("distDispatches", d.id, {
    ...d,
    status: "open",
    closedAt: "",
    closureId: "",
  });
  return { id: c.id };
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
