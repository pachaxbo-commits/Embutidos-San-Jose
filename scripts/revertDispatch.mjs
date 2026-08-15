/**
 * Revierte un despacho abierto que se registro por error: devuelve la carga al
 * almacen central, deja la ruta en cero y cierra el despacho.
 *
 * Solo debe usarse cuando el despacho NO tiene ventas asociadas. El script lo
 * comprueba y se detiene si las encuentra.
 *
 *   SANJOSE_ADMIN_PASSWORD=... node scripts/revertDispatch.mjs <dispatchId>
 */
import fs from 'fs'
import { initializeApp } from 'firebase/app'
import { getAuth, signInWithEmailAndPassword } from 'firebase/auth'
import { collection, doc, getDocs, getFirestore, increment, writeBatch } from 'firebase/firestore'

const TENANT = process.env.SANJOSE_TENANT_ID || 'sanjose'
const EMAIL = process.env.SANJOSE_ADMIN_EMAIL || 'admin@embutidossanjose.com'
const PASSWORD = process.env.SANJOSE_ADMIN_PASSWORD
const DISPATCH_ID = process.argv[2]

if (!DISPATCH_ID) {
  console.error('Falta el id del despacho.')
  process.exit(1)
}

const raw = fs.readFileSync('.env', 'utf8')
const values = Object.fromEntries(
  raw.split(/\r?\n/).filter((l) => l.includes('=') && !l.trim().startsWith('#')).map((l) => {
    const i = l.indexOf('=')
    return [l.slice(0, i).trim(), l.slice(i + 1).trim()]
  }),
)

const app = initializeApp({
  apiKey: values.VITE_FIREBASE_API_KEY,
  authDomain: values.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: values.VITE_FIREBASE_PROJECT_ID,
  storageBucket: values.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: values.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: values.VITE_FIREBASE_APP_ID,
}, `revert-${Date.now()}`)

const auth = getAuth(app)
const db = getFirestore(app)
const credential = await signInWithEmailAndPassword(auth, EMAIL, PASSWORD)

const dispatches = await getDocs(collection(db, 'restaurants', TENANT, 'distDispatches'))
const target = dispatches.docs.find((d) => d.id === DISPATCH_ID)
if (!target) {
  console.error('No se encontro el despacho.')
  process.exit(1)
}
const dispatch = target.data()

const sales = await getDocs(collection(db, 'restaurants', TENANT, 'distSales'))
const linked = sales.docs.filter((d) => d.data().dispatchId === DISPATCH_ID)
if (linked.length > 0) {
  console.error(`El despacho tiene ${linked.length} venta(s) asociada(s). No se revierte.`)
  process.exit(1)
}

// Carga total = lineas iniciales + aumentos
const totals = new Map()
const addLine = (line) => {
  const current = totals.get(line.productId) || { ...line, quantity: 0 }
  current.quantity = Math.round((current.quantity + Number(line.quantity || 0)) * 100) / 100
  totals.set(line.productId, current)
}
;(dispatch.lines || []).forEach(addLine)
;(dispatch.additions || []).forEach((addition) => (addition.quantityByProduct || []).forEach(addLine))

const now = new Date().toISOString()
const dayKey = now.slice(0, 10)
const batch = writeBatch(db)

for (const [productId, line] of totals) {
  const movementId = `revert_${DISPATCH_ID}_${productId}`
  batch.set(doc(db, 'restaurants', TENANT, 'distStockMovements', movementId), {
    id: movementId,
    restaurantId: TENANT,
    branchId: 'main',
    createdAt: now,
    createdBy: credential.user.uid,
    dayKey,
    schemaVersion: 1,
    type: 'adjustment',
    productId,
    productName: line.productName,
    unitType: line.unitType,
    quantity: line.quantity,
    centralDelta: line.quantity,
    routeDelta: -line.quantity,
    routeId: dispatch.routeId,
    refType: 'dispatch',
    refId: DISPATCH_ID,
    note: 'Reversion de despacho registrado por error',
  })

  batch.set(doc(db, 'restaurants', TENANT, 'distBalances', `central__${productId}`), {
    quantity: increment(line.quantity), updatedAt: now,
  }, { merge: true })

  batch.set(doc(db, 'restaurants', TENANT, 'distBalances', `route__${dispatch.routeId}__${productId}`), {
    quantity: increment(-line.quantity), updatedAt: now,
  }, { merge: true })

  console.log(`  devuelto al almacen: ${line.productName} ${line.quantity}`)
}

batch.set(doc(db, 'restaurants', TENANT, 'distDispatches', DISPATCH_ID), {
  status: 'closed',
  closedAt: now,
  observation: `${dispatch.observation || ''} [revertido: ruta incorrecta]`.trim(),
}, { merge: true })

await batch.commit()
console.log('\nDespacho revertido y cerrado.')
process.exit(0)
