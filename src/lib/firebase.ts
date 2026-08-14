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
  restaurantId: string
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
  firebaseContextPromise = null
}

export function isFirebaseConfigured() {
  return Boolean(readFirebaseConfig())
}

let firebaseContextPromise: Promise<FirebaseContext | null> | null = null

export async function getFirebaseContext(): Promise<FirebaseContext | null> {
  if (!isFirebaseConfigured()) {
    return null
  }

  if (!firebaseContextPromise) {
    firebaseContextPromise = (async () => {
      const firebaseConfig = readFirebaseConfig()
      const restaurantId = getFirebaseRestaurantId()

      if (!firebaseConfig) {
        return null
      }

      const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig)
      let db: Firestore

      const useEmulator = import.meta.env.VITE_USE_FIREBASE_EMULATOR === 'true'

      try {
        db = getFirestore(app)
      } catch {
        try {
          db = initializeFirestore(app, {
            localCache: useEmulator
              ? memoryLocalCache()
              : persistentLocalCache({
                  tabManager: persistentMultipleTabManager(),
                }),
          })
        } catch {
          db = getFirestore(app)
        }
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

      TenantContextService.setContext(restaurantId, 'main', auth.currentUser?.uid)

      return {
        app,
        auth,
        db,
        restaurantId,
      }
    })()
  }

  return firebaseContextPromise
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

  const secondaryApp = initializeApp(firebaseConfig, `tenant-create-${Date.now()}`)
  const secondaryAuth = getAuth(secondaryApp)

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
  const firebaseConfig = readFirebaseConfig()
  if (!context || !firebaseConfig) throw new Error('Firebase no esta configurado.')

  const secondaryApp = initializeApp(firebaseConfig, `member-create-${Date.now()}`)
  const secondaryAuth = getAuth(secondaryApp)

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
