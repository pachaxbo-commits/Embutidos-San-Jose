import { SAN_JOSE_ID, SAN_JOSE_ROLES } from '../config/sanJose'
import { useSyncExternalStore } from 'react'
import { doc, getDoc, getDocFromCache, onSnapshot, type DocumentData, type DocumentReference } from 'firebase/firestore'
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
let stopMemberWatch: (() => void) | null = null

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
  warehouseId?: string
  restaurantId: string
  businessType: BusinessType
}

function readCachedProfile(uid: string): CachedProfile | null {
  try {
    const raw = localStorage.getItem(PROFILE_CACHE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as CachedProfile
    return parsed && parsed.uid === uid && parsed.restaurantId === SAN_JOSE_ID && SAN_JOSE_ROLES.some(role => role === parsed.role) ? parsed : null
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

  setFirebaseRestaurantId(SAN_JOSE_ID)

  const updatedContext = await getFirebaseContext()
  if (!updatedContext) throw new Error('ACCESS_DENIED: Falta contexto de empresa.')

  const memberRef = doc(updatedContext.db, 'restaurants', updatedContext.restaurantId, 'members', userUid)
  const memberSnapshot = await getDocAllowingCache(memberRef)

  if (!memberSnapshot.exists()) {
    throw new Error('ACCESS_DENIED: No tienes membresia en esta empresa.')
  }

  const data = memberSnapshot.data()
  if (data.active !== true || !SAN_JOSE_ROLES.some(role => role === data.role)) throw new Error('ACCESS_DENIED: Tu acceso fue desactivado.')

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
    active: data.active === true,
    createdAt,
    routeId: typeof data.routeId === 'string' ? data.routeId : undefined,
    warehouseId: typeof data.warehouseId === 'string' ? data.warehouseId : 'central',
  }

  return member
}

async function initialize() {
  if (initialized || !isFirebaseConfigured()) {
    return
  }

  initialized = true

  await subscribeToAuthChanges((user) => {
    stopMemberWatch?.()
    stopMemberWatch = null
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

        const activeMember = member
        const account = await fetchRestaurantAccount(getFirebaseRestaurantId()).catch(() => null)
        // Sin conexion el perfil del tenant puede no resolverse; se conserva el
        // ultimo conocido de este mismo usuario antes que degradar su rol.
        const businessType: BusinessType = 'mobile_distribution'

        writeCachedProfile({
          uid: user.uid,
          email: activeMember.email,
          displayName: activeMember.displayName,
          role: activeMember.role,
          routeId: activeMember.routeId,
          warehouseId: activeMember.warehouseId,
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
        const ctx = await getFirebaseContext()
        if (ctx && ctx.auth.currentUser?.uid === user.uid) stopMemberWatch = onSnapshot(doc(ctx.db, 'restaurants', ctx.restaurantId, 'members', user.uid), snapshot => {
          if (!snapshot.exists() || snapshot.data().active !== true || !SAN_JOSE_ROLES.some(role => role === snapshot.data().role)) {
            localStorage.removeItem(PROFILE_CACHE_KEY)
            setState({ status: 'unauthorized', member: null, role: null, account: null, error: 'Tu acceso fue desactivado. Consulta con administracion.' })
          } else {
            const current = snapshot.data()
            const updated = { ...activeMember, role: current.role as UserRole, routeId: current.routeId || '', warehouseId: current.warehouseId || 'central' }
            setState({ member: updated, role: updated.role })
            writeCachedProfile({ uid: user.uid, email: updated.email, displayName: updated.displayName, role: updated.role, routeId: updated.routeId, warehouseId: updated.warehouseId, restaurantId: ctx.restaurantId, businessType })
          }
        }, error => {
          if (error.code === 'permission-denied') setState({ status: 'unauthorized', member: null, role: null, error: 'No tienes acceso a esta empresa.' })
        })

      } catch (error) {
        const code = (error as { code?: string }).code
        if ((error as Error).message?.startsWith('ACCESS_DENIED') || code === 'permission-denied') {
          localStorage.removeItem(PROFILE_CACHE_KEY)
          setState({ status: 'unauthorized', role: null, member: null, account: null, error: 'Tu acceso no esta autorizado. Consulta con administracion.' })
          return
        }
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
            warehouseId: cached.warehouseId,
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
