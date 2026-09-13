import { SAN_JOSE_ID } from '../config/sanJose'

/**
 * Contexto técnico de acceso a datos.
 * `restaurantId` es el nombre histórico del identificador de empresa en
 * Firestore; en esta aplicación su único valor permitido es `sanjose`.
 */
export interface TenantContext {
  restaurantId: string
  branchId: string
  userUid: string | null
  userRole?: string | null
}

const MAIN_BRANCH = 'main'
let currentContext: TenantContext = {
  restaurantId: SAN_JOSE_ID,
  branchId: MAIN_BRANCH,
  userUid: null,
}

export const TenantContextService = {
  setContext(restaurantId: string, branchId: string = MAIN_BRANCH, userUid: string | null = null, userRole?: string | null): void {
    if (restaurantId !== SAN_JOSE_ID) {
      throw new Error('[TenantContextService] Empresa no autorizada')
    }
    currentContext = {
      restaurantId: SAN_JOSE_ID,
      branchId: branchId.trim() || MAIN_BRANCH,
      userUid: userUid?.trim() || null,
      userRole: userRole || null,
    }
  },

  getContext(): TenantContext {
    return { ...currentContext }
  },

  requireValidContext(): TenantContext {
    if (currentContext.restaurantId !== SAN_JOSE_ID) {
      throw new Error('[TenantContextService] Falta el contexto de Embutidos San José')
    }
    return { ...currentContext }
  },
}
