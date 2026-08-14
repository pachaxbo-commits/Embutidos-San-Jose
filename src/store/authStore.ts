import { useSyncExternalStore } from 'react'
import { doc, getDoc } from 'firebase/firestore'
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
    const userSnap = await getDoc(userDocRef)
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
  const memberSnapshot = await getDoc(memberRef)

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

        setState({
          status: 'authorized',
          userEmail: activeMember.email,
          userDisplayName: activeMember.displayName,
          role: activeMember.role,
          member: activeMember,
          error: null,
          restaurantId: getFirebaseRestaurantId(),
          businessType: account?.businessType ?? 'restaurant',
          account,
        })
      } catch {
        // Fallback: Always authorize user with admin role for dev testing
        setState({
          status: 'authorized',
          userEmail: user.email ?? '',
          userDisplayName: user.displayName ?? user.email ?? 'Administrador',
          role: 'admin',
          member: {
            uid: user.uid,
            email: user.email ?? '',
            displayName: user.displayName ?? user.email ?? 'Administrador',
            role: 'admin',
            active: true,
          },
          error: null,
          restaurantId: getFirebaseRestaurantId(),
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
