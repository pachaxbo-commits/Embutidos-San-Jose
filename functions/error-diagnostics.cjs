const crypto = require("node:crypto");
const { HttpsError } = require("firebase-functions/v2/https");

const REPORT_FIELDS = [
  "code", "occurredAt", "appVersion", "build", "browser", "operatingSystem",
  "view", "source", "category", "errorName", "message", "stack",
  "componentStack", "recentEvents", "closureContext",
];
const VALID_SOURCES = new Set(["react_render", "window_error", "unhandled_rejection", "handled_operation_failure"]);
const VALID_CATEGORIES = new Set(["render", "asynchronous", "permission", "synchronization", "data", "unknown"]);
const VALID_STATUSES = new Set(["new", "reviewing", "resolved"]);
const MAX_REPORT_BYTES = 20_000;

function redact(value, max = 2400) {
  return String(value ?? "")
    .replace(/Bearer\s+[A-Za-z0-9._~+\/-]+=*/gi, "Bearer [REDACTED]")
    .replace(/eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, "[TOKEN REDACTED]")
    .replace(/AIza[\w-]{20,}/g, "[KEY REDACTED]")
    .replace(/(password|token|authorization|secret|credential)\s*[:=]\s*[^\s,;]+/gi, "$1=[REDACTED]")
    .replace(/(cliente|customer|nombre|teléfono|telefono|email|correo)\s*[:=]\s*[^,;\n]+/gi, "$1=[DATO REDACTADO]")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[EMAIL REDACTED]")
    .replace(/\bBs\.?\s*\d[\d.,]*/gi, "[MONTO REDACTED]")
    .replace(/\b\+?\d[\d\s().-]{6,}\d\b/g, "[TELÉFONO/ID REDACTADO]")
    .slice(0, max);
}

function omitUndefined(value) {
  if (Array.isArray(value)) return value.map(omitUndefined);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined).map(([key, item]) => [key, omitUndefined(item)]));
  }
  return value;
}

function sanitizeReport(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new HttpsError("invalid-argument", "El reporte técnico no es válido.");
  }
  const report = Object.fromEntries(REPORT_FIELDS.filter((key) => Object.hasOwn(input, key)).map((key) => [key, input[key]]));
  const json = JSON.stringify(report);
  if (Buffer.byteLength(json, "utf8") > MAX_REPORT_BYTES) {
    throw new HttpsError("invalid-argument", "El reporte técnico supera el tamaño permitido.");
  }
  if (!/^ERR-[A-F0-9]{6}$/.test(report.code || "") || !Number.isFinite(Date.parse(report.occurredAt || ""))) {
    throw new HttpsError("invalid-argument", "Falta un código o fecha válida del incidente.");
  }
  if (!VALID_SOURCES.has(report.source) || !VALID_CATEGORIES.has(report.category)) {
    throw new HttpsError("invalid-argument", "El tipo del incidente no es válido.");
  }
  const occurred = Date.parse(report.occurredAt);
  if (occurred < Date.now() - 30 * 24 * 60 * 60 * 1000 || occurred > Date.now() + 5 * 60 * 1000) {
    throw new HttpsError("invalid-argument", "La fecha del incidente está fuera del período permitido.");
  }
  const allowedViews = /^(dist\.[a-z-]+|aplicación)$/;
  if (!allowedViews.test(String(report.view || ""))) {
    throw new HttpsError("invalid-argument", "La sección del incidente no es válida.");
  }
  const clean = {
    code: report.code,
    occurredAt: new Date(occurred).toISOString(),
    appVersion: redact(report.appVersion, 40),
    build: redact(report.build, 48),
    browser: redact(report.browser, 48),
    operatingSystem: redact(report.operatingSystem, 40),
    view: report.view,
    source: report.source,
    category: report.category,
    errorName: redact(report.errorName, 80),
    message: redact(report.message, 1200),
    stack: redact(report.stack, 3600),
    componentStack: redact(report.componentStack, 2400),
    recentEvents: Array.isArray(report.recentEvents) ? report.recentEvents.slice(-20).map((event) => ({
      at: typeof event?.at === "string" ? redact(event.at, 40) : "",
      stage: ["before_confirmation", "operation_sent", "confirmation_received", "closure_snapshot", "dispatch_removed", "post_close_render"].includes(event?.stage) ? event.stage : "",
      status: ["draft", "warehouse_done", "closed", "reopened", "open", "none"].includes(event?.status) ? event.status : undefined,
      ...(event?.dispatchId ? { dispatchId: redact(event.dispatchId, 160) } : {}),
      ...(event?.closureId ? { closureId: redact(event.closureId, 160) } : {}),
      ...(event?.operationId ? { operationId: redact(event.operationId, 160) } : {}),
      ...(event?.operationStatus ? { operationStatus: ["queued", "confirmed", "rejected", "unknown"].includes(event.operationStatus) ? event.operationStatus : "unknown" } : {}),
    })) : [],
    closureContext: report.closureContext && typeof report.closureContext === "object" ? {
      ...(report.closureContext.dispatchId ? { dispatchId: redact(report.closureContext.dispatchId, 160) } : {}),
      ...(report.closureContext.closureId ? { closureId: redact(report.closureContext.closureId, 160) } : {}),
      ...(report.closureContext.operationId ? { operationId: redact(report.closureContext.operationId, 160) } : {}),
      ...(report.closureContext.dayKey && /^\d{4}-\d{2}-\d{2}$/.test(report.closureContext.dayKey) ? { dayKey: report.closureContext.dayKey } : {}),
      ...(report.closureContext.dispatchStatus ? { dispatchStatus: ["open", "closed", "unknown"].includes(report.closureContext.dispatchStatus) ? report.closureContext.dispatchStatus : "unknown" } : {}),
      ...(report.closureContext.closureStatus ? { closureStatus: ["draft", "warehouse_done", "closed", "reopened", "unknown"].includes(report.closureContext.closureStatus) ? report.closureContext.closureStatus : "unknown" } : {}),
      ...(report.closureContext.confirmation ? { confirmation: ["before", "queued", "confirmed", "rejected", "unknown"].includes(report.closureContext.confirmation) ? report.closureContext.confirmation : "unknown" } : {}),
    } : undefined,
  };
  return omitUndefined(clean);
}

async function requireMember(db, uid, allowedRoles) {
  const snapshot = await db.doc(`restaurants/sanjose/members/${uid}`).get();
  const member = snapshot.exists ? snapshot.data() : null;
  if (!member || member.active !== true) throw new HttpsError("permission-denied", "La cuenta no tiene acceso activo.");
  if (allowedRoles && !allowedRoles.includes(member.role)) throw new HttpsError("permission-denied", "No tienes permiso para consultar diagnósticos.");
  return member;
}

function reportIdentity(uid, report) {
  const fingerprint = crypto.createHash("sha256").update([report.source, report.category, report.errorName, report.message, report.stack.slice(0, 1000), report.componentStack.slice(0, 600)].join("\n")).digest("hex");
  const week = new Date(report.occurredAt).toISOString().slice(0, 10);
  return crypto.createHash("sha256").update(`${uid}|${fingerprint}|${week}`).digest("hex");
}

async function submitDiagnostic(db, request) {
  if (!request.auth?.uid) throw new HttpsError("unauthenticated", "Inicia sesión para enviar el diagnóstico.");
  const member = await requireMember(db, request.auth.uid);
  const report = sanitizeReport(request.data?.report);
  const context = request.data?.occurrenceIdentity;
  if (!context || context.uid !== request.auth.uid || context.restaurantId !== "sanjose") {
    throw new HttpsError("permission-denied", "La identidad original de este reporte no coincide con la sesión.");
  }
  const root = db.doc("restaurants/sanjose");
  const reportId = reportIdentity(request.auth.uid, report);
  const reportRef = root.collection("distErrorDiagnostics").doc(reportId);
  const rateRef = root.collection("distDiagnosticRateLimits").doc(request.auth.uid);
  const result = await db.runTransaction(async (tx) => {
    const [previous, rate] = await Promise.all([tx.get(reportRef), tx.get(rateRef)]);
    const now = new Date().toISOString();
    const rateData = rate.exists ? rate.data() : {};
    const windowStart = Date.parse(rateData.windowStartedAt || "") || 0;
    const count = Date.now() - windowStart < 60 * 60 * 1000 ? Number(rateData.count || 0) : 0;
    if (count >= 20) throw new HttpsError("resource-exhausted", "Se alcanzó el límite temporal de reportes. El incidente permanece guardado en este dispositivo.");
    tx.set(rateRef, { windowStartedAt: count ? rateData.windowStartedAt : now, count: count + 1, expireAt: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString() });
    if (previous.exists) {
      const previousData = previous.data();
      const occurrenceCodes = Array.isArray(previousData.occurrenceCodes) ? previousData.occurrenceCodes : [previousData.code].filter(Boolean);
      const isRetry = occurrenceCodes.includes(report.code);
      const previousLastOccurredAt = Date.parse(previousData.lastOccurredAt || "") || 0;
      const incomingOccurredAt = Date.parse(report.occurredAt);
      tx.update(reportRef, {
        lastOccurredAt: new Date(Math.max(previousLastOccurredAt, incomingOccurredAt)).toISOString(),
        lastReceivedAt: now,
        occurrenceCount: Number(previousData.occurrenceCount || 1) + (isRetry ? 0 : 1),
        occurrenceCodes: isRetry ? occurrenceCodes : [...occurrenceCodes, report.code].slice(-100),
      });
      return { reportId, grouped: true, duplicateDelivery: isRetry };
    }
    tx.create(reportRef, {
      id: reportId,
      ...report,
      restaurantId: "sanjose",
      actorUid: request.auth.uid,
      actorName: redact(member.displayName || "Usuario", 80),
      actorRole: member.role,
      actorRouteId: member.role === "distributor" ? redact(member.routeId || "", 160) : "",
      receivedAt: now,
      lastReceivedAt: now,
      lastOccurredAt: report.occurredAt,
      occurrenceCount: 1,
      occurrenceCodes: [report.code],
      reviewStatus: "new",
      internalNote: "",
    });
    return { reportId, grouped: false };
  });
  return { accepted: true, ...result };
}

async function listDiagnostics(db, request) {
  if (!request.auth?.uid) throw new HttpsError("unauthenticated", "Inicia sesión para continuar.");
  await requireMember(db, request.auth.uid, ["admin", "support"]);
  const root = db.doc("restaurants/sanjose");
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  let query = root.collection("distErrorDiagnostics").where("lastOccurredAt", ">=", cutoff).orderBy("lastOccurredAt", "desc").limit(51);
  const cursor = request.data?.cursor;
  if (cursor?.lastOccurredAt && cursor?.id) {
    const cursorDoc = await root.collection("distErrorDiagnostics").doc(String(cursor.id)).get();
    if (cursorDoc.exists) query = query.startAfter(cursorDoc);
  }
  const snapshot = await query.get();
  const reports = snapshot.docs.slice(0, 50).map((doc) => ({ ...doc.data(), id: doc.id }));
  const last = reports.at(-1);
  return {
    reports,
    nextCursor: snapshot.docs.length > 50 && last ? { id: last.id, lastOccurredAt: last.lastOccurredAt } : null,
  };
}

async function updateDiagnostic(db, request) {
  if (!request.auth?.uid) throw new HttpsError("unauthenticated", "Inicia sesión para continuar.");
  const member = await requireMember(db, request.auth.uid, ["admin", "support"]);
  const reportId = String(request.data?.reportId || "");
  if (!/^[a-f0-9]{64}$/.test(reportId)) throw new HttpsError("invalid-argument", "El reporte seleccionado no es válido.");
  const reviewStatus = request.data?.reviewStatus;
  const internalNote = request.data?.internalNote;
  if (reviewStatus !== undefined && !VALID_STATUSES.has(reviewStatus)) throw new HttpsError("invalid-argument", "El estado de revisión no es válido.");
  if (internalNote !== undefined && (typeof internalNote !== "string" || internalNote.length > 500)) throw new HttpsError("invalid-argument", "La nota no puede superar 500 caracteres.");
  const ref = db.doc(`restaurants/sanjose/distErrorDiagnostics/${reportId}`);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new HttpsError("not-found", "El reporte ya no existe.");
    tx.update(ref, {
      ...(reviewStatus === undefined ? {} : { reviewStatus }),
      ...(internalNote === undefined ? {} : { internalNote: redact(internalNote, 500) }),
      reviewedAt: new Date().toISOString(),
      reviewedBy: request.auth.uid,
      reviewedByName: redact(member.displayName || "Soporte", 80),
    });
  });
  return { updated: true };
}

module.exports = { redact, sanitizeReport, submitDiagnostic, listDiagnostics, updateDiagnostic };
