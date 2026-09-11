const { initializeApp } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
const { getFirestore } = require("firebase-admin/firestore");
const { onDocumentCreated } = require("firebase-functions/v2/firestore");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { processCommand } = require("./operations.cjs");
const { prepareCleanDelivery, executeCleanDelivery } = require("./maintenance.cjs");
initializeApp();
exports.processSanJoseOperation = onDocumentCreated(
  {
    document: "restaurants/sanjose/distOperations/{operationId}",
    region: "us-central1",
    retry: true,
    maxInstances: 3,
    memory: "256MiB",
  },
  async (event) => {
    if (event.data) await processCommand(getFirestore(), event.data.ref);
  },
);
const { onDocumentWritten } = require("firebase-functions/v2/firestore");
const { refreshCreditStatus } = require("./operations.cjs");
exports.refreshSanJoseCredit = onDocumentWritten(
  {
    document: "restaurants/sanjose/distReceivables/{id}",
    region: "us-central1",
    retry: true,
    maxInstances: 2,
  },
  async (event) => {
    const resetState = await getFirestore().doc("restaurants/sanjose/maintenanceState/reset").get();
    if (resetState.data()?.active === true) return;
    const value = event.data?.after.exists
      ? event.data.after.data()
      : event.data?.before.data();
    if (value?.customerId)
      await refreshCreditStatus(
        getFirestore(),
        getFirestore().doc("restaurants/sanjose"),
        value.customerId,
      );
  },
);

exports.initializeSanJoseCredit = onDocumentCreated(
  {
    document: "restaurants/sanjose/distCustomers/{id}",
    region: "us-central1",
    retry: true,
    maxInstances: 2,
  },
  async (event) => {
    const resetState = await getFirestore().doc("restaurants/sanjose/maintenanceState/reset").get();
    if (resetState.data()?.active === true) return;
    if (event.data)
      await refreshCreditStatus(
        getFirestore(),
        getFirestore().doc("restaurants/sanjose"),
        event.params.id,
      );
  },
);

exports.changeSanJoseMemberPassword = onCall(
  {
    region: "us-central1",
    memory: "512MiB",
    timeoutSeconds: 540,
    // La llamada sigue protegida por Firebase Auth dentro del handler. Este permiso
    // permite que Cloud Run reciba la solicitud y valide el token del administrador.
    invoker: "public",
  },
  async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "Inicia sesión para continuar.");
    if (request.data?.action === "prepareCleanDelivery")
      return prepareCleanDelivery(getFirestore(), request);
    if (request.data?.action === "executeCleanDelivery")
      return executeCleanDelivery(getFirestore(), request);
    const targetUid = String(request.data?.uid || "");
    const password = String(request.data?.password || "");
    if (!targetUid || password.length < 6 || password.length > 72)
      throw new HttpsError("invalid-argument", "La contraseña debe tener entre 6 y 72 caracteres.");
    const db = getFirestore();
    const root = db.collection("restaurants").doc("sanjose");
    const [actor, target] = await Promise.all([
      root.collection("members").doc(request.auth.uid).get(),
      root.collection("members").doc(targetUid).get(),
    ]);
    if (!actor.exists || actor.data().active !== true || actor.data().role !== "admin")
      throw new HttpsError("permission-denied", "Solo Administración puede cambiar contraseñas.");
    if (!target.exists)
      throw new HttpsError("not-found", "El usuario no pertenece a Embutidos San José.");
    await getAuth().updateUser(targetUid, { password });
    await target.ref.set({
      passwordChangedAt: new Date().toISOString(),
      passwordChangedBy: request.auth.uid,
    }, { merge: true });
    return { changed: true };
  },
);
