import { SAN_JOSE_ID } from '../config/sanJose'
import { deleteApp, getApp, getApps, initializeApp, type FirebaseApp } from 'firebase/app'
import {
  browserLocalPersistence,
  connectAuthEmulator,
  createUserWithEmailAndPassword,
  getAuth,
  inMemoryPersistence,
  onAuthStateChanged,
  setPersistence,
  signInWithEmailAndPassword,
  signOut as firebaseSignOut,
  type Auth,
  type User,
  type Unsubscribe,
} from 'firebase/auth'
import {
  collection,
  connectFirestoreEmulator,
  disableNetwork,
  enableNetwork,
  doc,
  getDocs,
  getFirestore,
  initializeFirestore,
  memoryLocalCache,
  onSnapshot,
  persistentLocalCache,
  persistentMultipleTabManager,
  serverTimestamp,
  setDoc,
  type Firestore,
} from 'firebase/firestore'
import type { RestaurantMember, UserRole } from '../types'
import { TenantContextService } from '../services/tenantService'

interface FirebaseWebConfig {
  apiKey: string
  authDomain: string
  projectId: string
  storageBucket: string
  messagingSenderId: string
  appId: string
  measurementId?: string
}

export interface FirebaseContext {
  app: FirebaseApp
  auth: Auth
  db: Firestore
  /** Tenant activo al momento de pedir el contexto */
  restaurantId: string
}

interface FirebaseRuntime {
  app: FirebaseApp
  auth: Auth
  db: Firestore
}

function readFirebaseConfig(): FirebaseWebConfig | null {
  const config = {
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
    authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
    storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
    appId: import.meta.env.VITE_FIREBASE_APP_ID,
    measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID,
  }

  const requiredValues = [
    config.apiKey,
    config.authDomain,
    config.projectId,
    config.storageBucket,
    config.messagingSenderId,
    config.appId,
  ]

  return requiredValues.every(Boolean) ? config : null
}

let currentActiveRestaurantId: string = SAN_JOSE_ID

export function getFirebaseRestaurantId(): string {
  return currentActiveRestaurantId
}

export function setFirebaseRestaurantId(id: string) {
  if (id !== SAN_JOSE_ID) throw new Error('ACCESS_DENIED: La cuenta no pertenece a Embutidos San José.')
  currentActiveRestaurantId = id
  localStorage.setItem('pachax_active_restaurant_id', id)
  // Ojo: NO se invalida la inicializacion de Firebase. La app, la sesion y la
  // instancia de Firestore no dependen del tenant activo, y volver a
  // inicializarlas lanzaba "Firestore has already been started": el fallo
  // dejaba al usuario en el tenant equivocado justo despues de resolver su
  // empresa por defecto.
}

export function isFirebaseConfigured() {
  return Boolean(readFirebaseConfig())
}

let firebaseRuntimePromise: Promise<FirebaseRuntime | null> | null = null
let functionsEmulatorConnected = false

/** Inicializa app, Firestore y Auth una sola vez por sesion. */
async function getFirebaseRuntime(): Promise<FirebaseRuntime | null> {
  if (!isFirebaseConfigured()) {
    return null
  }

  if (!firebaseRuntimePromise) {
    firebaseRuntimePromise = (async () => {
      const firebaseConfig = readFirebaseConfig()

      if (!firebaseConfig) {
        return null
      }

      const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig)
      let db: Firestore

      const useEmulator = import.meta.env.VITE_USE_FIREBASE_EMULATOR === 'true'

      // La persistencia local tiene que configurarse ANTES de la primera
      // llamada a getFirestore: si se pide la instancia primero, Firestore
      // queda con cache en memoria y la aplicacion pierde todo al cerrarse,
      // que es justo lo contrario de lo que necesita quien vende en calle.
      //
      // Contra el emulador se usa cache en memoria para no arrastrar datos
      // entre sesiones de desarrollo, salvo que se pida explicitamente la
      // cache persistente para poder validar el comportamiento offline real.
      const useMemoryCache = useEmulator && import.meta.env.VITE_EMULATOR_PERSISTENT_CACHE !== 'true'

      try {
        db = initializeFirestore(app, {
          localCache: useMemoryCache
            ? memoryLocalCache()
            : persistentLocalCache({
                tabManager: persistentMultipleTabManager(),
              }),
        })
      } catch {
        // Ya inicializada (por ejemplo, en un hot reload): se reutiliza.
        db = getFirestore(app)
      }

      const auth = getAuth(app)

      if (useEmulator) {
        const host = window.location.hostname || 'localhost'
        // Custom ports for PACHAX: 8085 for Firestore, 9095 for Auth
        connectFirestoreEmulator(db, host, 8085)
        connectAuthEmulator(auth, `http://${host}:9095`, { disableWarnings: true })
      }

      try {
        await setPersistence(auth, browserLocalPersistence)
      } catch {
        await setPersistence(auth, inMemoryPersistence)
      }

      // Interruptor de red solo para desarrollo/QA: permite reproducir el modo
      // avion desde la propia capa de Firestore al validar el flujo offline.
      if (import.meta.env.DEV) {
        ;(window as unknown as { __pachaxDevNetwork?: unknown }).__pachaxDevNetwork = {
          goOffline: () => disableNetwork(db),
          goOnline: () => enableNetwork(db),
        }
      }

      return { app, auth, db }
    })()
  }

  return firebaseRuntimePromise
}

export async function getFirebaseContext(): Promise<FirebaseContext | null> {
  const runtime = await getFirebaseRuntime()
  if (!runtime) return null

  // El tenant activo se resuelve en cada llamada: puede cambiar al iniciar
  // sesion, sin necesidad de reinicializar Firebase.
  const restaurantId = getFirebaseRestaurantId()
  TenantContextService.setContext(restaurantId, 'main', runtime.auth.currentUser?.uid)

  return { ...runtime, restaurantId }
}


/**
 * Instancia secundaria de Auth para crear cuentas sin cerrar la sesion activa.
 *
 * Tiene que respetar el modo emulador: sin esto, probar en el emulador creaba
 * usuarios reales en el proyecto de produccion.
 */
function createSecondaryAuth(label: string): { app: FirebaseApp; auth: Auth } | null {
  const firebaseConfig = readFirebaseConfig()
  if (!firebaseConfig) return null

  const app = initializeApp(firebaseConfig, `${label}-${Date.now()}`)
  const auth = getAuth(app)

  if (import.meta.env.VITE_USE_FIREBASE_EMULATOR === 'true') {
    const host = window.location.hostname || 'localhost'
    connectAuthEmulator(auth, `http://${host}:9095`, { disableWarnings: true })
  }

  return { app, auth }
}

export async function signInWithEmail(email: string, password: string) {
  const context = await getFirebaseContext()

  if (!context) {
    throw new Error('Firebase no esta configurado.')
  }

  return signInWithEmailAndPassword(context.auth, email, password)
}

export async function signOutUser() {
  const context = await getFirebaseContext()

  if (!context) {
    return
  }

  await firebaseSignOut(context.auth)
}

export async function getCurrentFirebaseUser() {
  const context = await getFirebaseContext()
  return context?.auth.currentUser ?? null
}

export async function subscribeToAuthChanges(listener: (user: User | null) => void): Promise<Unsubscribe> {
  const context = await getFirebaseContext()

  if (!context) {
    return () => undefined
  }

  return onAuthStateChanged(context.auth, listener)
}

export async function listRestaurantMembers() {
  const context = await getFirebaseContext()
  if (!context) throw new Error('Firebase no esta configurado.')

  const snap = await getDocs(collection(context.db, 'restaurants', context.restaurantId, 'members'))
  return snap.docs.map((memberDoc) => ({ uid: memberDoc.id, ...memberDoc.data() }) as RestaurantMember)
}

/**
 * Mantiene la lista de usuarios en tiempo real. A diferencia de getDocs(),
 * onSnapshot entrega primero la caché local y no deja la pantalla esperando
 * indefinidamente cuando la conexión móvil cambia entre Wi-Fi y datos.
 */
export async function subscribeRestaurantMembers(
  listener: (members: RestaurantMember[]) => void,
  onError?: (error: Error) => void,
): Promise<Unsubscribe> {
  const context = await getFirebaseContext()
  if (!context) throw new Error('Firebase no esta configurado.')
  return onSnapshot(
    collection(context.db, 'restaurants', context.restaurantId, 'members'),
    snapshot => listener(snapshot.docs.map(memberDoc => ({ uid: memberDoc.id, ...memberDoc.data() }) as RestaurantMember)),
    error => onError?.(error),
  )
}

export async function createRestaurantMember(input: {
  email: string
  password: string
  displayName: string
  role: UserRole
  /** Ruta asignada (roles de distribucion) */
  routeId?: string
  warehouseId?: string
}) {
  const context = await getFirebaseContext()
  if (!context) throw new Error('Firebase no esta configurado.')

  const secondary = createSecondaryAuth('member-create')
  if (!secondary) throw new Error('Firebase no esta configurado.')
  const { app: secondaryApp, auth: secondaryAuth } = secondary

  try {
    const credential = await createUserWithEmailAndPassword(secondaryAuth, input.email.trim(), input.password)
    await setDoc(doc(context.db, 'restaurants', context.restaurantId, 'members', credential.user.uid), {
      uid: credential.user.uid,
      email: input.email.trim(),
      displayName: input.displayName.trim() || input.email.trim(),
      role: input.role,
      routeId: input.routeId || '',
      warehouseId: input.warehouseId || 'central',
      active: true,
      createdAt: serverTimestamp(),
    })

    // Mapa usuario -> tenant, para que al iniciar sesion caiga en su empresa.
    await setDoc(
      doc(context.db, 'users', credential.user.uid),
      {
        uid: credential.user.uid,
        email: input.email.trim(),
        displayName: input.displayName.trim() || input.email.trim(),
        defaultRestaurantId: context.restaurantId,
      },
      { merge: true },
    )
  } finally {
    await firebaseSignOut(secondaryAuth).catch(() => undefined)
    await deleteApp(secondaryApp).catch(() => undefined)
  }
}

async function callMemberAdministration<TResult>(payload: Record<string, unknown>): Promise<TResult> {
  const context = await getFirebaseContext()
  if (!context) throw new Error('Firebase no esta configurado.')
  const { connectFunctionsEmulator, getFunctions, httpsCallable } = await import('firebase/functions')
  const functions = getFunctions(context.app, 'us-central1')
  if (import.meta.env.VITE_USE_FIREBASE_EMULATOR === 'true' && !functionsEmulatorConnected) {
    connectFunctionsEmulator(functions, window.location.hostname || 'localhost', 5001)
    functionsEmulatorConnected = true
  }
  const call = httpsCallable<Record<string, unknown>, TResult>(functions, 'changeSanJoseMemberPassword')
  return (await call(payload)).data
}

export async function updateRestaurantMember(uid: string, updates: Partial<Pick<RestaurantMember, 'role' | 'active' | 'displayName' | 'email' | 'routeId' | 'warehouseId'>>) {
  await callMemberAdministration<{ changed: boolean }>({ action: 'updateMember', uid, ...updates })
}

export async function changeRestaurantMemberPassword(uid: string, password: string) {
  await callMemberAdministration<{ changed: boolean }>({ action: 'changePassword', uid, password })
}

export async function deleteRestaurantMemberAccess(uid: string) {
  await callMemberAdministration<{ deleted: boolean }>({ action: 'deleteMember', uid })
}
