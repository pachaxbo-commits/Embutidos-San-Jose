import { EmailAuthProvider, reauthenticateWithCredential } from 'firebase/auth'
import { doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore'
import { assertFirebaseWritesAllowed, getFirebaseContext } from '../../../lib/firebase'

export interface SupportSettings {
  companyName: string
  taxId: string
  address: string
  phone: string
  receiptHeader: string
  receiptFooter: string
  expiryAlertDays: number
  creditBlockDays: number
  requireQrVerification: boolean
  defaultPaperWidth: '58mm' | '80mm'
}

export interface ResetPreview {
  requestId: string
  expiresAt: string
  totalDocuments: number
  counts: Record<string, number>
  preserved: string[]
  selectedGroups: CleanupGroupKey[]
  resolvedGroups: CleanupGroupKey[]
  dependencyReasons: Partial<Record<CleanupGroupKey, CleanupGroupKey>>
  preservedGroups: CleanupGroupKey[]
}

export interface ResetResult {
  resetId: string
  backupId: string
  deletedDocuments: number
  completedAt: string
  backedUpDocuments: number
  customersPreserved: number
  deletedByCollection: Record<string, number>
}

export type CleanupGroupKey = 'customers' | 'credits' | 'sales' | 'expenses' | 'inventory' | 'dispatches' | 'closures' | 'claims' | 'qr' | 'technical' | 'quotes'

export const CLEANUP_GROUPS: Array<{ key: CleanupGroupKey; label: string; description: string; dependencies: CleanupGroupKey[] }> = [
  { key: 'customers', label: 'Clientes', description: 'Clientes registrados y sus CI.', dependencies: ['sales', 'credits', 'claims', 'qr'] },
  { key: 'credits', label: 'Créditos y cobros', description: 'Deudas, cobros, estados y autorizaciones.', dependencies: ['qr'] },
  { key: 'sales', label: 'Ventas', description: 'Ventas y sus correcciones auditadas.', dependencies: ['credits', 'claims', 'qr'] },
  { key: 'expenses', label: 'Gastos', description: 'Gastos registrados en rutas.', dependencies: [] },
  { key: 'inventory', label: 'Inventario operativo y lotes', description: 'Existencias, lotes, movimientos y ajustes.', dependencies: ['dispatches', 'sales'] },
  { key: 'dispatches', label: 'Despachos y transferencias', description: 'Cargas, despachos y traslados de stock.', dependencies: ['closures', 'sales'] },
  { key: 'closures', label: 'Cierres y arqueos', description: 'Cierres de ruta y conciliaciones.', dependencies: [] },
  { key: 'claims', label: 'Cambios y devoluciones', description: 'Cambios, devoluciones y diferencias asociadas.', dependencies: ['qr'] },
  { key: 'qr', label: 'Verificaciones QR', description: 'Confirmaciones bancarias relacionadas.', dependencies: [] },
  { key: 'technical', label: 'Historial y operaciones técnicas', description: 'Cola operativa y turnos de almacén.', dependencies: [] },
  { key: 'quotes', label: 'Cotizaciones', description: 'Propuestas de precios emitidas; no afectan ventas ni existencias.', dependencies: [] },
]

export const RECOMMENDED_CLEANUP_GROUPS = CLEANUP_GROUPS.map(group => group.key).filter(key => key !== 'customers')

export function resolveCleanupGroups(selected: CleanupGroupKey[]) {
  const resolved = new Set(selected)
  const reasons: Partial<Record<CleanupGroupKey, CleanupGroupKey>> = {}
  const queue = [...selected]
  while (queue.length) {
    const parent = queue.shift()!
    const group = CLEANUP_GROUPS.find(item => item.key === parent)
    for (const dependency of group?.dependencies || []) {
      if (!resolved.has(dependency)) { resolved.add(dependency); queue.push(dependency) }
      if (!selected.includes(dependency) && !reasons[dependency]) reasons[dependency] = parent
    }
  }
  return { resolved: CLEANUP_GROUPS.map(group => group.key).filter(key => resolved.has(key)), reasons }
}

export const DEFAULT_SUPPORT_SETTINGS: SupportSettings = {
  companyName: 'Embutidos San José',
  taxId: '',
  address: '',
  phone: '',
  receiptHeader: 'EMBUTIDOS SAN JOSÉ',
  receiptFooter: 'Gracias por su preferencia',
  expiryAlertDays: 14,
  creditBlockDays: 7,
  requireQrVerification: true,
  defaultPaperWidth: '58mm',
}

let maintenanceEmulatorConnected = false

async function callable<TInput, TOutput>(name: string) {
  const context = await getFirebaseContext()
  if (!context) throw new Error('Firebase no está configurado.')
  const { connectFunctionsEmulator, getFunctions, httpsCallable } = await import('firebase/functions')
  const functions = getFunctions(context.app, 'us-central1')
  if (import.meta.env.VITE_USE_FIREBASE_EMULATOR === 'true' && !maintenanceEmulatorConnected) {
    connectFunctionsEmulator(functions, window.location.hostname || 'localhost', 5001)
    maintenanceEmulatorConnected = true
  }
  return httpsCallable<TInput, TOutput>(functions, name)
}

export async function loadSupportSettings(): Promise<SupportSettings> {
  const context = await getFirebaseContext()
  if (!context) throw new Error('Firebase no está configurado.')
  const snapshot = await getDoc(doc(context.db, 'restaurants', context.restaurantId, 'supportConfig', 'main'))
  return { ...DEFAULT_SUPPORT_SETTINGS, ...(snapshot.exists() ? snapshot.data() : {}) } as SupportSettings
}

export async function saveSupportSettings(settings: SupportSettings): Promise<void> {
  const context = await getFirebaseContext()
  if (!context?.auth.currentUser) throw new Error('Inicia sesión para guardar la configuración.')
  assertFirebaseWritesAllowed(context.app.options.projectId)
  await setDoc(doc(context.db, 'restaurants', context.restaurantId, 'supportConfig', 'main'), {
    ...settings,
    restaurantId: context.restaurantId,
    updatedAt: serverTimestamp(),
    updatedBy: context.auth.currentUser.uid,
  })
}

export async function prepareCleanDelivery(selectedGroups: CleanupGroupKey[]): Promise<ResetPreview> {
  const call = await callable<{ action: 'prepareCleanDelivery'; selectedGroups: CleanupGroupKey[] }, ResetPreview>('changeSanJoseMemberPassword')
  return (await call({ action: 'prepareCleanDelivery', selectedGroups })).data
}

export async function executeCleanDelivery(input: { requestId: string; password: string; phrase: string }): Promise<ResetResult> {
  const context = await getFirebaseContext()
  const user = context?.auth.currentUser
  if (!user?.email) throw new Error('La cuenta actual no puede confirmar su identidad.')
  await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email, input.password))
  await user.getIdToken(true)
  const call = await callable<{ action: 'executeCleanDelivery'; requestId: string; phrase: string; acknowledgement: boolean }, ResetResult>('changeSanJoseMemberPassword')
  return (await call({ action: 'executeCleanDelivery', requestId: input.requestId, phrase: input.phrase, acknowledgement: true })).data
}
