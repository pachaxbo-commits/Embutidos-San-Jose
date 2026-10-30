// Quantities are accounting references, never certificates of physical origin.
const r = n => Math.round((Number(n) + Number.EPSILON) * 1000) / 1000;
const check = (v, m) => { if (!v) throw Error(m); };
const pending = (lot, loc) => r((lot.pendingOrigins?.[loc] || []).reduce((n, a) => n + a.quantity, 0));
const refsQuantity = a => r((a.originReferences || []).reduce((n, x) => n + x.quantity, 0));
const note = 'Referencia contable; procedencia física pendiente de confirmar. Lo recibido con esta condición queda reservado, no disponible para venta.';
function validate(lot, loc) {
  const refs = lot.pendingOrigins?.[loc] || [];
  check(refs.every(x => x.exceptionId && x.accountingLotId === lot.id && x.physicalOriginConfirmed === false && Number.isFinite(x.quantity) && x.quantity > 0), 'Excepción de origen inválida.');
  check(new Set(refs.map(x => x.exceptionId)).size === refs.length && pending(lot, loc) <= r(lot.quantities[loc] || 0), 'La reserva de origen no coincide con la existencia.');
}
function slice(a, offset, quantity) {
  const total = r(a.quantity), refs = a.originReferences || [], confirmed = r(total - refsQuantity(a));
  check(offset >= 0 && quantity >= 0 && r(offset + quantity) <= total && confirmed >= 0, 'Fracción de asignación inválida.');
  let cursor = confirmed;
  const selected = [];
  for (const ref of refs) {
    const n = r(Math.max(0, Math.min(offset + quantity, cursor + ref.quantity) - Math.max(offset, cursor)));
    if (n > 0) selected.push({ ...ref, quantity: n });
    cursor = r(cursor + ref.quantity);
  }
  const result = { ...a, quantity: r(quantity) };
  delete result.originReferences;
  if (selected.length) result.originReferences = selected;
  if (a.processingAllocation) {
    const allocation = a.processingAllocation;
    const packageCount = Number(allocation.quantity);
    check(Number.isSafeInteger(packageCount) && packageCount > 0 && Number.isSafeInteger(offset) && Number.isSafeInteger(quantity), 'Fracción comercial del lote derivado inválida.');
    const share = (total, start, count) => {
      if (total === null || total === undefined) return null;
      check(Number.isSafeInteger(total) && total >= 0, 'Peso o costo asignado del lote derivado inválido.');
      const end = start + count;
      return Number((BigInt(total) * BigInt(end) / BigInt(packageCount)) - (BigInt(total) * BigInt(start) / BigInt(packageCount)));
    };
    result.processingAllocation = {
      ...allocation,
      quantity: Number(quantity),
      physicalWeightG: share(allocation.physicalWeightG, offset, Number(quantity)),
      costCents: share(allocation.costCents, offset, Number(quantity)),
      allocationMethod: 'documented_average',
    };
  }
  return result;
}
function remove(lot, loc, allocation, allowPending = true) {
  validate(lot, loc);
  const amount = r(allocation.quantity), uncertain = refsQuantity(allocation), current = r(lot.quantities[loc] || 0);
  check(Number.isFinite(amount) && amount > 0 && uncertain <= amount, 'Cantidad o reserva de asignación inválida.');
  check(allowPending || uncertain === 0, 'Esta cantidad tiene origen pendiente y no está disponible para venta o despacho.');
  check(amount <= current && r(amount - uncertain) <= r(current - pending(lot, loc)), 'La parte identificada del lote ya no está disponible.');
  const refs = structuredClone(lot.pendingOrigins?.[loc] || []);
  for (const part of allocation.originReferences || []) {
    const found = refs.find(x => x.exceptionId === part.exceptionId);
    check(found && found.accountingLotId === lot.id && found.quantity >= part.quantity, 'La reserva original fue consumida o resuelta; requiere revisión administrativa.');
    found.quantity = r(found.quantity - part.quantity);
  }
  lot.quantities[loc] = r(current - amount);
  if (lot.pendingOrigins || refs.length) { lot.pendingOrigins ||= {}; lot.pendingOrigins[loc] = refs.filter(x => x.quantity > 0); }
  validate(lot, loc);
}
function restore(lot, loc, allocation) {
  validate(lot, loc);
  check(Number.isFinite(allocation.quantity) && allocation.quantity > 0 && refsQuantity(allocation) <= r(allocation.quantity), 'Cantidad o reserva a restituir inválida.');
  lot.quantities[loc] = r((lot.quantities[loc] || 0) + allocation.quantity);
  for (const part of allocation.originReferences || []) {
    check(part.accountingLotId === lot.id && part.physicalOriginConfirmed === false, 'Referencia contable de origen inválida.');
    lot.pendingOrigins ||= {}; lot.pendingOrigins[loc] ||= [];
    const current = lot.pendingOrigins[loc].find(x => x.exceptionId === part.exceptionId);
    if (current) current.quantity = r(current.quantity + part.quantity);
    else lot.pendingOrigins[loc].push({ ...part });
  }
  validate(lot, loc);
}
function take(lot, loc, amount, allowPending) {
  validate(lot, loc);
  const base = { lotId: lot.id, lotCode: lot.lotCode, expiresOn: lot.expiresOn, productionCost: lot.productionCost ?? null };
  const confirmed = r((lot.quantities[loc] || 0) - pending(lot, loc));
  check(amount <= r(confirmed + (allowPending ? pending(lot, loc) : 0)), 'Stock identificado insuficiente en el lote.');
  const parts = [];
  let remaining = r(amount);
  const good = r(Math.min(remaining, confirmed));
  if (good > 0) { parts.push({ ...base, quantity: good }); remaining = r(remaining - good); }
  for (const ref of lot.pendingOrigins?.[loc] || []) {
    const n = r(Math.min(remaining, ref.quantity));
    if (n > 0) parts.push({ ...base, productionCost: Number.isFinite(ref.historicalUnitCost) ? ref.historicalUnitCost : null, quantity: n, originReferences: [{ ...ref, quantity: n }] });
    remaining = r(remaining - n);
    if (!remaining) break;
  }
  check(remaining === 0, 'No se pudo distribuir la reserva de origen.');
  for (const part of parts) remove(lot, loc, part, allowPending);
  return parts;
}
const references = allocations => (allocations || []).flatMap(a => a.originReferences || []);
module.exports = { pending, refsQuantity, slice, remove, restore, take, validate, references, note };
