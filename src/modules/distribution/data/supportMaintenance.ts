import { EmailAuthProvider, reauthenticateWithCredential } from 'firebase/auth'
import { doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore'
import { getFirebaseContext } from '../../../lib/firebase'

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
}

export interface ResetResult {
  resetId: string
  backupId: string
  deletedDocuments: number
  completedAt: string
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
  await setDoc(doc(context.db, 'restaurants', context.restaurantId, 'supportConfig', 'main'), {
    ...settings,
    restaurantId: context.restaurantId,
    updatedAt: serverTimestamp(),
    updatedBy: context.auth.currentUser.uid,
  })
}

export async function prepareCleanDelivery(): Promise<ResetPreview> {
  const call = await callable<{ action: 'prepareCleanDelivery' }, ResetPreview>('changeSanJoseMemberPassword')
  return (await call({ action: 'prepareCleanDelivery' })).data
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
