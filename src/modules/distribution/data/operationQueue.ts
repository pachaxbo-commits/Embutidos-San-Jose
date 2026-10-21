import {
  doc,
  onSnapshot,
  setDoc,
  getDocFromCache,
  updateDoc,
} from "firebase/firestore";
import { assertFirebaseWritesAllowed, getFirebaseContext } from "../../../lib/firebase";
import { shouldReturnProvisional } from "../domain/offlineOperationPolicy";
export { shouldReturnProvisional } from "../domain/offlineOperationPolicy";

export class RejectedOperationError extends Error {
  rejected = true;
}
let online = navigator.onLine;
window.addEventListener("online", () => {
  online = true;
});
window.addEventListener("offline", () => {
  online = false;
});
export interface PendingOperation {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  createdBy: string;
  createdAt: string;
  status: "queued" | "confirmed" | "rejected";
  error?: string;
  acknowledged?: boolean;
}
/** Firestore conserva la solicitud sin conexión; solo el servidor modifica stock y finanzas. */
export async function submitOperation<T>(
  type: string,
  payload: unknown,
  id: string,
  provisional?: T,
  timeoutMs = 45000,
): Promise<T> {
  const ctx = await getFirebaseContext();
  if (!ctx?.auth.currentUser) throw new Error("Inicia sesión para continuar.");
  assertFirebaseWritesAllowed(ctx.app.options.projectId);
  if (!online && provisional === undefined)
    throw new Error("Esta operación requiere conexión.");
  const ref = doc(
    ctx.db,
    "restaurants",
    ctx.restaurantId,
    "distOperations",
    id,
  );
  const existing = await getDocFromCache(ref).catch(() => null);
  if (existing?.exists()) {
    if (existing.data().status === "confirmed")
      return existing.data().result as T;
    if (existing.data().status === "rejected")
      throw new RejectedOperationError(
        existing.data().error ||
          "Operación rechazada. Revisa los datos antes de repetirla.",
      );
    if (shouldReturnProvisional(existing.data().status, false, provisional !== undefined))
      return provisional as T;
  }
  return await new Promise<T>((resolve, reject) => {
    let stop = () => {};
    let listening = false;
    let settled = false;
    let writeError: Error | undefined;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (listening) stop();
      callback();
    };
    const finishError = (error: Error) => {
      finish(() => reject(error));
    };
    const rejectWrite = finishError;
    const timer = setTimeout(() => {
      finishError(new Error(
        provisional !== undefined
          ? "Firestore no pudo guardar la operación en este dispositivo. Verifica la conexión y vuelve a intentarlo."
          : "La operación sigue pendiente de confirmación. Revisa Operaciones pendientes antes de volver a registrarla.",
      ));
    }, provisional === undefined ? timeoutMs : 3000);
    stop = onSnapshot(
      ref,
      { includeMetadataChanges: true },
      (snapshot) => {
        if (!snapshot.exists()) return;
        const op = snapshot.data();
        if (op.status === "confirmed") {
          finish(() => resolve(op.result as T));
          return;
        }
        if (op.status === "rejected") {
          finish(() => reject(new RejectedOperationError(op.error)));
          return;
        }
        if (shouldReturnProvisional(op.status, snapshot.metadata.hasPendingWrites, provisional !== undefined))
          finish(() => resolve(provisional as T));
      },
      finishError,
    );
    listening = true;
    if (settled) stop();
    if (!existing?.exists()) {
      // Start listening before writing so the local-cache acknowledgement is
      // observed even when navigator.onLine incorrectly remains true.
      void setDoc(ref, {
        id,
        restaurantId: ctx.restaurantId,
        createdBy: ctx.auth.currentUser!.uid,
        createdAt: new Date().toISOString(),
        type,
        payload: JSON.parse(JSON.stringify(payload)),
        status: "queued",
      }).catch((error) => {
        writeError = error;
        rejectWrite?.(error);
        const failure = error as Error & { code?: string };
        const message = failure.code === 'permission-denied'
          ? 'Firebase rechazó la creación de la operación por permisos. No se confirmó; revisa su estado antes de volver a registrarla.'
          : `No se pudo confirmar la creación de la operación. Revisa su estado antes de volver a registrarla. ${failure.message}`;
        try {
          localStorage.setItem("pachax_dist_sync_error", JSON.stringify({
            message,
            operationType: type,
            operationId: id,
            occurredAt: new Date().toISOString(),
            ...(failure.code ? { errorCode: failure.code } : {}),
          }));
        } catch { /* storage is optional; the rejected promise still reports the cause */ }
        window.dispatchEvent(new Event("distribution-operation-error"));
      });
    }
    if (writeError) finishError(writeError);
  });
}

export async function acknowledgeOperation(id: string) {
  const ctx = await getFirebaseContext();
  if (!ctx) throw new Error("Inicia sesión.");
  assertFirebaseWritesAllowed(ctx.app.options.projectId);
  await updateDoc(
    doc(ctx.db, "restaurants", ctx.restaurantId, "distOperations", id),
    { acknowledged: true },
  );
}
