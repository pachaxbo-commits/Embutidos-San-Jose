import { deleteApp, getApp, getApps, initializeApp, type FirebaseApp } from 'firebase/app'
import {
  browserLocalPersistence,
  connectAuthEmulator,
  createUserWithEmailAndPassword,
  getAuth,
  inMemoryPersistence,
  onAuthStateChanged,
  sendPasswordResetEmail,
  setPersistence,
  signInWithEmailAndPassword,
  signOut as firebaseSignOut,
  type Auth,
  type User,
  type Unsubscribe,
} from 'firebase/auth'
import { getStorage, ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage'
import {
  collection,
  connectFirestoreEmulator,
  deleteDoc,
  disableNetwork,
  enableNetwork,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  initializeFirestore,
  memoryLocalCache,
  persistentLocalCache,
  persistentMultipleTabManager,
  serverTimestamp,
  setDoc,
  updateDoc,
  type Firestore,
} from 'firebase/firestore'
import type { BusinessType, RestaurantAccount, RestaurantBranding, RestaurantMember, UserRole } from '../types'
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

let currentActiveRestaurantId: string = localStorage.getItem('pachax_active_restaurant_id') || import.meta.env.VITE_FIREBASE_RESTAURANT_ID || 'restaurant-demo'

export function getFirebaseRestaurantId(): string {
  return currentActiveRestaurantId || 'restaurant-demo'
}

export function setFirebaseRestaurantId(id: string) {
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

export async function fetchRestaurantAccount(restaurantId: string): Promise<RestaurantAccount | null> {
  const context = await getFirebaseContext()
  if (!context) return null

  const ref = doc(context.db, 'restaurants', restaurantId)
  const snap = await getDoc(ref)
  if (!snap.exists()) return null

  const data = snap.data()
  return {
    id: snap.id,
    name: data.name || 'Mi Restaurante',
    slug: data.slug || restaurantId,
    ownerUid: data.ownerUid || '',
    createdAt: data.createdAt || new Date().toISOString(),
    plan: data.plan || 'pro',
    // Un tenant sin businessType es un restaurante: nada cambia para los existentes.
    businessType: (data.businessType as BusinessType) || 'restaurant',
    currencyCode: data.currencyCode || 'BOB',
    currencySymbol: data.currencySymbol || 'Bs',
    branding: data.branding || {
      name: data.name || 'Mi Restaurante',
      primaryColor: '#0B132B',
      accentColor: '#00F0FF',
      tablesCount: 12,
    },
  }
}

/** Configura el perfil del tenant (tipo de empresa, moneda, marca). */
export async function updateRestaurantProfile(
  restaurantId: string,
  updates: {
    name?: string
    businessType?: BusinessType
    currencyCode?: string
    currencySymbol?: string
    branding?: Partial<RestaurantBranding>
  },
) {
  const context = await getFirebaseContext()
  if (!context) throw new Error('Firebase no esta configurado.')

  const payload: Record<string, unknown> = { updatedAt: serverTimestamp() }
  if (updates.name) payload.name = updates.name
  if (updates.businessType) payload.businessType = updates.businessType
  if (updates.currencyCode) payload.currencyCode = updates.currencyCode
  if (updates.currencySymbol) payload.currencySymbol = updates.currencySymbol
  if (updates.branding) payload.branding = updates.branding

  await setDoc(doc(context.db, 'restaurants', restaurantId), payload, { merge: true })
}

export async function updateRestaurantBranding(restaurantId: string, branding: Partial<RestaurantBranding>) {
  const context = await getFirebaseContext()
  if (!context) throw new Error('Firebase no está configurado.')

  const ref = doc(context.db, 'restaurants', restaurantId)
  await updateDoc(ref, {
    branding,
    updatedAt: serverTimestamp(),
  })
}

export async function createNewRestaurantAccount(input: {
  restaurantName: string
  ownerName: string
  email: string
  password: string
}): Promise<string> {
  const firebaseConfig = readFirebaseConfig()
  if (!firebaseConfig) throw new Error('Firebase no esta configurado.')

  const secondary = createSecondaryAuth('tenant-create')
  if (!secondary) throw new Error('Firebase no esta configurado.')
  const { app: secondaryApp, auth: secondaryAuth } = secondary

  try {
    const cred = await createUserWithEmailAndPassword(secondaryAuth, input.email.trim(), input.password)
    const ownerUid = cred.user.uid
    const restaurantId = `rest_${input.restaurantName.toLowerCase().replace(/[^a-z0-9]/g, '')}_${Date.now().toString(36)}`

    const context = await getFirebaseContext()
    if (!context) throw new Error('Error al conectar con la base de datos.')

    // 1. Create Restaurant Doc
    await setDoc(doc(context.db, 'restaurants', restaurantId), {
      id: restaurantId,
      name: input.restaurantName.trim(),
      slug: restaurantId,
      ownerUid,
      createdAt: serverTimestamp(),
      plan: 'pro',
      branding: {
        name: input.restaurantName.trim(),
        primaryColor: '#0B132B',
        accentColor: '#00F0FF',
        receiptHeader: `*** ${input.restaurantName.toUpperCase()} ***`,
        receiptFooter: '¡Gracias por su preferencia!',
        tablesCount: 12,
      },
    })

    // 2. Add Owner as Admin Member inside the restaurant
    await setDoc(doc(context.db, 'restaurants', restaurantId, 'members', ownerUid), {
      uid: ownerUid,
      email: input.email.trim(),
      displayName: input.ownerName.trim(),
      role: 'admin',
      active: true,
      createdAt: serverTimestamp(),
    })

    // 3. User mapping record
    await setDoc(doc(context.db, 'users', ownerUid), {
      uid: ownerUid,
      email: input.email.trim(),
      displayName: input.ownerName.trim(),
      defaultRestaurantId: restaurantId,
      restaurants: [restaurantId],
    })

    setFirebaseRestaurantId(restaurantId)
    return restaurantId
  } finally {
    await firebaseSignOut(secondaryAuth).catch(() => undefined)
    await deleteApp(secondaryApp).catch(() => undefined)
  }
}

export async function listRestaurantMembers() {
  const context = await getFirebaseContext()
  if (!context) throw new Error('Firebase no esta configurado.')

  const snap = await getDocs(collection(context.db, 'restaurants', context.restaurantId, 'members'))
  return snap.docs.map((memberDoc) => ({ uid: memberDoc.id, ...memberDoc.data() }) as RestaurantMember)
}

export async function createRestaurantMember(input: {
  email: string
  password: string
  displayName: string
  role: UserRole
  /** Ruta asignada (roles de distribucion) */
  routeId?: string
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

export async function updateRestaurantMember(uid: string, updates: Partial<Pick<RestaurantMember, 'role' | 'active' | 'displayName' | 'routeId'>>) {
  const context = await getFirebaseContext()
  if (!context) throw new Error('Firebase no esta configurado.')

  await updateDoc(doc(context.db, 'restaurants', context.restaurantId, 'members', uid), updates)
}

export async function sendRestaurantMemberPasswordReset(email: string) {
  const context = await getFirebaseContext()
  if (!context) throw new Error('Firebase no esta configurado.')

  await sendPasswordResetEmail(context.auth, email.trim())
}

export async function deleteRestaurantMemberAccess(uid: string) {
  const context = await getFirebaseContext()
  if (!context) throw new Error('Firebase no esta configurado.')

  await deleteDoc(doc(context.db, 'restaurants', context.restaurantId, 'members', uid))
}

export async function uploadProductImageToFirebase(file: File, restaurantId: string): Promise<string> {
  const context = await getFirebaseContext()
  if (!context) throw new Error('Firebase no esta configurado.')

  const storage = getStorage(context.app)
  const fileExt = file.name.split('.').pop() || 'jpg'
  const path = `restaurants/${restaurantId}/products/${Date.now()}_${Math.random().toString(36).substring(2, 7)}.${fileExt}`
  const fileRef = storageRef(storage, path)

  await uploadBytes(fileRef, file)
  return getDownloadURL(fileRef)
}
