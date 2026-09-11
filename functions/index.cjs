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
    const db = getFirestore();
    const root = db.collection("restaurants").doc("sanjose");
    const actor = await root.collection("members").doc(request.auth.uid).get();
    if (!actor.exists || actor.data().active !== true || actor.data().role !== "admin")
      throw new HttpsError("permission-denied", "Solo Administración puede gestionar usuarios.");
    const targetUid = String(request.data?.uid || "");
    const targetRef = root.collection("members").doc(targetUid);
    const target = await targetRef.get();
    if (!target.exists)
      throw new HttpsError("not-found", "El usuario no pertenece a Embutidos San José.");

    const action = String(request.data?.action || "changePassword");
    if (action === "changePassword") {
      const password = String(request.data?.password || "");
      if (password.length < 6 || password.length > 72)
        throw new HttpsError("invalid-argument", "La contraseña debe tener entre 6 y 72 caracteres.");
      await getAuth().updateUser(targetUid, { password });
      await targetRef.set({
        passwordChangedAt: new Date().toISOString(),
        passwordChangedBy: request.auth.uid,
      }, { merge: true });
      return { changed: true };
    }

    if (action === "updateMember") {
      const current = target.data();
      const displayName = String(request.data?.displayName ?? current.displayName ?? "").trim();
      const email = String(request.data?.email ?? current.email ?? "").trim().toLowerCase();
      const role = String(request.data?.role ?? current.role ?? "");
      const active = request.data?.active === undefined ? current.active !== false : request.data.active;
      const routeId = role === "distributor" ? String(request.data?.routeId ?? current.routeId ?? "").trim() : "";
      const warehouseId = role === "warehouse" ? String(request.data?.warehouseId ?? current.warehouseId ?? "central").trim() || "central" : "central";
      if (displayName.length < 2 || displayName.length > 80)
        throw new HttpsError("invalid-argument", "El nombre debe tener entre 2 y 80 caracteres.");
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 160)
        throw new HttpsError("invalid-argument", "Escribe un correo válido.");
      if (!["admin", "warehouse", "distributor", "support"].includes(role))
        throw new HttpsError("invalid-argument", "El rol indicado no es válido.");
      if (typeof active !== "boolean")
        throw new HttpsError("invalid-argument", "El estado del usuario no es válido.");
      if (role === "distributor" && !routeId)
        throw new HttpsError("failed-precondition", "El distribuidor necesita una ruta asignada.");
      if (targetUid === request.auth.uid && (role !== "admin" || !active))
        throw new HttpsError("failed-precondition", "No puedes quitar tu propio acceso administrativo.");

      const authUser = await getAuth().getUser(targetUid);
      const authBefore = { email: authUser.email, displayName: authUser.displayName, disabled: authUser.disabled };
      try {
        await getAuth().updateUser(targetUid, { email, displayName, disabled: !active });
      } catch (error) {
        if (error?.code === "auth/email-already-exists")
          throw new HttpsError("already-exists", "Ese correo ya pertenece a otro usuario.");
        throw error;
      }

      try {
        await db.runTransaction(async transaction => {
          const [freshActor, freshTarget, members] = await Promise.all([
            transaction.get(root.collection("members").doc(request.auth.uid)),
            transaction.get(targetRef),
            transaction.get(root.collection("members")),
          ]);
          if (!freshActor.exists || freshActor.data().active !== true || freshActor.data().role !== "admin")
            throw new HttpsError("permission-denied", "La cuenta administradora ya no está activa.");
          if (!freshTarget.exists)
            throw new HttpsError("not-found", "El usuario ya no existe.");
          const wasActiveAdmin = freshTarget.data().role === "admin" && freshTarget.data().active === true;
          const removesActiveAdmin = wasActiveAdmin && (role !== "admin" || !active);
          const activeAdmins = members.docs.filter(document => document.data().role === "admin" && document.data().active === true).length;
          if (removesActiveAdmin && activeAdmins <= 1)
            throw new HttpsError("failed-precondition", "Debe quedar al menos una cuenta de Administración activa.");
          const updatedAt = new Date().toISOString();
          transaction.set(targetRef, { email, displayName, role, active, routeId, warehouseId, updatedAt, updatedBy: request.auth.uid }, { merge: true });
          transaction.set(db.collection("users").doc(targetUid), { uid: targetUid, email, displayName, defaultRestaurantId: "sanjose", updatedAt }, { merge: true });
        });
      } catch (error) {
        await getAuth().updateUser(targetUid, authBefore).catch(() => undefined);
        throw error;
      }
      return { changed: true };
    }

    if (action === "deleteMember") {
      if (targetUid === request.auth.uid)
        throw new HttpsError("failed-precondition", "No puedes eliminar tu propia cuenta.");
      const userRef = db.collection("users").doc(targetUid);
      const userMap = await userRef.get();
      await db.runTransaction(async transaction => {
        const [freshActor, freshTarget, members] = await Promise.all([
          transaction.get(root.collection("members").doc(request.auth.uid)),
          transaction.get(targetRef),
          transaction.get(root.collection("members")),
        ]);
        if (!freshActor.exists || freshActor.data().active !== true || freshActor.data().role !== "admin")
          throw new HttpsError("permission-denied", "La cuenta administradora ya no está activa.");
        if (!freshTarget.exists)
          throw new HttpsError("not-found", "El usuario ya no existe.");
        const activeAdmins = members.docs.filter(document => document.data().role === "admin" && document.data().active === true).length;
        if (freshTarget.data().role === "admin" && freshTarget.data().active === true && activeAdmins <= 1)
          throw new HttpsError("failed-precondition", "Debe quedar al menos una cuenta de Administración activa.");
        transaction.delete(targetRef);
        transaction.delete(userRef);
      });
      try {
        await getAuth().deleteUser(targetUid);
      } catch (error) {
        if (error?.code !== "auth/user-not-found") {
          await targetRef.set(target.data()).catch(() => undefined);
          if (userMap.exists) await userRef.set(userMap.data()).catch(() => undefined);
          throw error;
        }
      }
      return { deleted: true };
    }

    throw new HttpsError("invalid-argument", "La acción solicitada no es válida.");
  },
);
