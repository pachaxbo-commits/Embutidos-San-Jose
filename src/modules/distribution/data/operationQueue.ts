import {
  doc,
  onSnapshot,
  setDoc,
  getDocFromCache,
  updateDoc,
} from "firebase/firestore";
import { getFirebaseContext } from "../../../lib/firebase";

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
): Promise<T> {
  const ctx = await getFirebaseContext();
  if (!ctx?.auth.currentUser) throw new Error("Inicia sesión para continuar.");
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
  let writeError: Error | undefined;
  let rejectWrite: ((error: Error) => void) | undefined;
  if (existing?.exists()) {
    if (existing.data().status === "confirmed")
      return existing.data().result as T;
    if (existing.data().status === "rejected")
      throw new RejectedOperationError(
        existing.data().error ||
          "Operación rechazada. Revisa los datos antes de repetirla.",
      );
  } else {
    void setDoc(ref, {
      id,
      restaurantId: ctx.restaurantId,
      createdBy: ctx.auth.currentUser.uid,
      createdAt: new Date().toISOString(),
      type,
      payload: JSON.parse(JSON.stringify(payload)),
      status: "queued",
    }).catch((error) => {
      writeError = error;
      rejectWrite?.(error);
      localStorage.setItem(
        "pachax_dist_sync_error",
        `No se pudo enviar la operación: ${error.message}`,
      );
      window.dispatchEvent(new Event("distribution-operation-error"));
    });
  }
  if (!online && provisional !== undefined) return provisional;
  return await new Promise<T>((resolve, reject) => {
    let stop = () => {};
    const finishError = (error: Error) => {
      clearTimeout(timer);
      stop();
      reject(error);
    };
    rejectWrite = finishError;
    const timer = setTimeout(() => {
      stop();
      reject(
        new Error(
          "La operación sigue pendiente de confirmación. Revisa Operaciones pendientes antes de volver a registrarla.",
        ),
      );
    }, 45000);
    stop = onSnapshot(
      ref,
      (snapshot) => {
        if (!snapshot.exists()) return;
        const op = snapshot.data();
        if (op.status === "confirmed") {
          clearTimeout(timer);
          stop();
          resolve(op.result as T);
        }
        if (op.status === "rejected") {
          clearTimeout(timer);
          stop();
          reject(new RejectedOperationError(op.error));
        }
      },
      finishError,
    );
    if (writeError) finishError(writeError);
  });
}

export async function acknowledgeOperation(id: string) {
  const ctx = await getFirebaseContext();
  if (!ctx) throw new Error("Inicia sesión.");
  await updateDoc(
    doc(ctx.db, "restaurants", ctx.restaurantId, "distOperations", id),
    { acknowledged: true },
  );
}
