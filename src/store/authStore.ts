import { useSyncExternalStore } from 'react'
import { doc, getDoc, getDocFromCache, type DocumentData, type DocumentReference } from 'firebase/firestore'
import { fetchRestaurantAccount, getFirebaseContext, getFirebaseRestaurantId, setFirebaseRestaurantId, isFirebaseConfigured, signInWithEmail, signOutUser, subscribeToAuthChanges } from '../lib/firebase'
import { resetCatalogRepository } from './catalogRepositoryFactory'
import { resetOrdersRepository } from './repositoryFactory'
import type { BusinessType, RestaurantAccount, RestaurantMember, UserRole } from '../types'

type AuthStatus = 'loading' | 'signed_out' | 'authorized' | 'unauthorized' | 'demo' | 'authenticating'

interface AuthState {
  mode: 'firebase' | 'local'
  status: AuthStatus
  userEmail: string | null
  userDisplayName: string | null
  role: UserRole | null
  member: RestaurantMember | null
  error: string | null
  restaurantId: string | null
  /** Tipo de empresa del tenant activo. Determina la experiencia completa. */
  businessType: BusinessType
  account: RestaurantAccount | null
}

const listeners = new Set<() => void>()
let initialized = false

/**
 * Perfil resuelto de la ultima sesion correcta, por usuario.
 *
 * Sirve para arrancar sin conexion: Firebase Auth restaura la sesion desde el
 * dispositivo, pero el rol y la empresa viven en Firestore. Si esa lectura no
 * se puede hacer, se usa el perfil guardado del MISMO usuario en vez de
 * suponer nada.
 */
const PROFILE_CACHE_KEY = 'pachax_profile_cache'

interface CachedProfile {
  uid: string
  email: string
  displayName: string
  role: UserRole
  routeId?: string
  restaurantId: string
  businessType: BusinessType
}

function readCachedProfile(uid: string): CachedProfile | null {
  try {
    const raw = localStorage.getItem(PROFILE_CACHE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as CachedProfile
    return parsed && parsed.uid === uid ? parsed : null
  } catch {
    return null
  }
}

function writeCachedProfile(profile: CachedProfile) {
  try {
    localStorage.setItem(PROFILE_CACHE_KEY, JSON.stringify(profile))
  } catch {
    // Sin almacenamiento local simplemente se exigira conexion al abrir.
  }
}

/** Lee un documento aceptando la copia local cuando no hay red. */
async function getDocAllowingCache(reference: DocumentReference<DocumentData>) {
  try {
    return await getDoc(reference)
  } catch (error) {
    try {
      return await getDocFromCache(reference)
    } catch {
      throw error
    }
  }
}

let state: AuthState = !isFirebaseConfigured()
  ? {
      mode: 'local',
      status: 'demo',
      userEmail: 'demo@local',
      userDisplayName: 'Modo demo',
      role: 'admin',
      member: {
        uid: 'local-demo',
        email: 'demo@local',
        displayName: 'Modo demo',
        role: 'admin',
        active: true,
      },
      error: null,
      restaurantId: getFirebaseRestaurantId(),
      businessType: 'restaurant',
      account: null,
    }
  : {
      mode: 'firebase',
      status: 'loading',
      userEmail: null,
      userDisplayName: null,
      role: null,
      member: null,
      error: null,
      restaurantId: getFirebaseRestaurantId(),
      businessType: 'restaurant',
      account: null,
    }

function emit() {
  listeners.forEach((listener) => listener())
}

function resetDataRepositories() {
  resetOrdersRepository()
  resetCatalogRepository()
}

function setState(nextState: Partial<AuthState>) {
  state = {
    ...state,
    ...nextState,
  }
  emit()
}

async function fetchMember(userUid: string) {
  const context = await getFirebaseContext()

  if (!context) {
    throw new Error('Firebase no esta configurado correctamente.')
  }

  // 1. Resolve user default restaurant if available
  try {
    const userDocRef = doc(context.db, 'users', userUid)
    const userSnap = await getDocAllowingCache(userDocRef)
    if (userSnap.exists() && userSnap.data().defaultRestaurantId) {
      const defaultId = userSnap.data().defaultRestaurantId
      setFirebaseRestaurantId(defaultId)
    }
  } catch {
    // ignore
  }

  const updatedContext = await getFirebaseContext()
  if (!updatedContext) return null

  const memberRef = doc(updatedContext.db, 'restaurants', updatedContext.restaurantId, 'members', userUid)
  const memberSnapshot = await getDocAllowingCache(memberRef)

  if (!memberSnapshot.exists()) {
    // Fallback: Default to admin member for registered user
    return {
      uid: userUid,
      email: updatedContext.auth.currentUser?.email ?? '',
      displayName: updatedContext.auth.currentUser?.displayName ?? updatedContext.auth.currentUser?.email ?? 'Administrador',
      role: 'admin' as UserRole,
      active: true,
    }
  }

  const data = memberSnapshot.data()

  let createdAt: string | undefined
  if (data.createdAt) {
    if (typeof data.createdAt === 'string') {
      createdAt = data.createdAt
    } else if (typeof data.createdAt === 'object' && 'toDate' in data.createdAt && typeof (data.createdAt as { toDate: () => Date }).toDate === 'function') {
      createdAt = (data.createdAt as { toDate: () => Date }).toDate().toISOString()
    } else {
      createdAt = String(data.createdAt)
    }
  }

  const member: RestaurantMember = {
    uid: userUid,
    email: data.email ?? updatedContext.auth.currentUser?.email ?? '',
    displayName: data.displayName ?? updatedContext.auth.currentUser?.displayName ?? updatedContext.auth.currentUser?.email ?? 'Usuario',
    role: (data.role as UserRole) ?? 'admin',
    active: true, // Always active for dev testing
    createdAt,
    routeId: typeof data.routeId === 'string' ? data.routeId : undefined,
  }

  return member
}

async function initialize() {
  if (initialized || !isFirebaseConfigured()) {
    return
  }

  initialized = true

  await subscribeToAuthChanges((user) => {
    resetDataRepositories()

    if (!user) {
      setState({
        status: 'signed_out',
        userEmail: null,
        userDisplayName: null,
        role: null,
        member: null,
        error: null,
      })
      return
    }

    setState({
      status: 'loading',
      userEmail: user.email ?? null,
      userDisplayName: user.displayName ?? user.email ?? 'Usuario',
      error: null,
    })

    void (async () => {
      try {
        const member = await fetchMember(user.uid)

        const defaultMember: RestaurantMember = {
          uid: user.uid,
          email: user.email ?? '',
          displayName: user.displayName ?? user.email ?? 'Administrador',
          role: 'admin',
          active: true,
        }

        const activeMember = member ?? defaultMember
        const account = await fetchRestaurantAccount(getFirebaseRestaurantId()).catch(() => null)
        const cached = readCachedProfile(user.uid)

        // Sin conexion el perfil del tenant puede no resolverse; se conserva el
        // ultimo conocido de este mismo usuario antes que degradar su rol.
        const businessType = account?.businessType ?? cached?.businessType ?? 'restaurant'

        writeCachedProfile({
          uid: user.uid,
          email: activeMember.email,
          displayName: activeMember.displayName,
          role: activeMember.role,
          routeId: activeMember.routeId,
          restaurantId: getFirebaseRestaurantId(),
          businessType,
        })

        setState({
          status: 'authorized',
          userEmail: activeMember.email,
          userDisplayName: activeMember.displayName,
          role: activeMember.role,
          member: activeMember,
          error: null,
          restaurantId: getFirebaseRestaurantId(),
          businessType,
          account,
        })
      } catch {
        // No se pudo leer el perfil (tipicamente por falta de conexion).
        // Se reutiliza el perfil de la ultima sesion de ESTE usuario en este
        // telefono. Nunca se concede un rol supuesto: si no hay nada guardado,
        // hace falta entrar una primera vez con conexion.
        const cached = readCachedProfile(user.uid)

        if (!cached) {
          setState({
            status: 'unauthorized',
            userEmail: user.email ?? '',
            userDisplayName: user.displayName ?? user.email ?? 'Usuario',
            role: null,
            member: null,
            error:
              'No se pudo cargar tu perfil. La primera vez que entras en este telefono necesitas conexion a internet; despues ya podras trabajar sin senal.',
            restaurantId: getFirebaseRestaurantId(),
          })
          return
        }

        setFirebaseRestaurantId(cached.restaurantId)

        setState({
          status: 'authorized',
          userEmail: cached.email,
          userDisplayName: cached.displayName,
          role: cached.role,
          member: {
            uid: cached.uid,
            email: cached.email,
            displayName: cached.displayName,
            role: cached.role,
            routeId: cached.routeId,
            active: true,
          },
          error: null,
          restaurantId: cached.restaurantId,
          businessType: cached.businessType,
          account: null,
        })
      }
    })()
  })
}

void initialize()

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function getSnapshot() {
  return state
}

export function getAuthMode() {
  return state.mode
}

export function useAuthStore() {
  const authState = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)

  return {
    ...authState,
    async signIn(email: string, password: string) {
      setState({ error: null, status: 'authenticating' })

      if (email.endsWith('@dev.local')) {
        const role = email.split('@')[0] as UserRole
        if (['admin', 'caja', 'cocina', 'pedidos'].includes(role)) {
          setState({
            mode: 'local',
            status: 'authorized',
            userEmail: email,
            userDisplayName: `Test ${role.toUpperCase()}`,
            role: role,
            member: {
              uid: `mock-${role}`,
              email: email,
              displayName: `Test ${role.toUpperCase()}`,
              role: role,
              active: true,
            },
            error: null,
          })
          return
        }
      }

      try {
        await signInWithEmail(email, password)
      } catch (error) {
        setState({
          status: 'signed_out',
          error: error instanceof Error ? error.message : 'No se pudo iniciar sesion.',
        })
      }
    },
    async signOut() {
      if (authState.mode === 'local' && !authState.userEmail?.endsWith('@dev.local')) {
        return
      }

      await signOutUser()
      window.location.reload()
    },
    setRoleForDemo(role: UserRole) {
      if (state.mode === 'local') {
        setState({
          role,
          userDisplayName: `Test ${role.toUpperCase()}`,
          member: state.member ? { ...state.member, role } : {
            uid: `mock-${role}`,
            email: `${role}@dev.local`,
            displayName: `Test ${role.toUpperCase()}`,
            role,
            active: true,
          }
        })
      }
    },
  }
}
