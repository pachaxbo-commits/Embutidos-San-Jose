/**
 * Inspecciona el estado del tenant San Jose en el Firebase de .env.
 * Solo lectura. Requiere las credenciales del administrador.
 *
 *   SANJOSE_ADMIN_PASSWORD=... node scripts/inspectSanJose.mjs
 */
import fs from 'fs'
import { initializeApp } from 'firebase/app'
import { getAuth, signInWithEmailAndPassword } from 'firebase/auth'
import { collection, getDocs, getFirestore } from 'firebase/firestore'

const TENANT = process.env.SANJOSE_TENANT_ID || 'sanjose'
const EMAIL = process.env.SANJOSE_ADMIN_EMAIL || 'admin@embutidossanjose.com'
const PASSWORD = process.env.SANJOSE_ADMIN_PASSWORD

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
}, `inspect-${Date.now()}`)

const auth = getAuth(app)
const db = getFirestore(app)
await signInWithEmailAndPassword(auth, EMAIL, PASSWORD)

async function list(name) {
  const snap = await getDocs(collection(db, 'restaurants', TENANT, name))
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }))
}

const [members, dispatches, balances, sales] = await Promise.all([
  list('members'),
  list('distDispatches'),
  list('distBalances'),
  list('distSales'),
])

console.log('=== PERSONAL ===')
members.forEach((m) => console.log(`  ${m.displayName} | ${m.role} | ruta=${m.routeId || '-'}`))

console.log('\n=== DESPACHOS ===')
dispatches.forEach((d) =>
  console.log(`  ${d.id}\n    ruta=${d.routeId} (${d.routeName}) | distribuidor=${d.distributorName} (${d.distributorUid}) | ${d.status}`),
)

console.log('\n=== SALDOS ===')
balances
  .filter((b) => Math.abs(Number(b.quantity) || 0) > 0.001)
  .sort((a, b) => a.id.localeCompare(b.id))
  .forEach((b) => console.log(`  ${b.id} = ${b.quantity}`))

console.log(`\n=== VENTAS: ${sales.length} ===`)
for (const sale of sales) {
  console.log(`  ${sale.id}`)
  console.log(`    origen=${sale.sourceLocation} ruta=${sale.routeId} despacho=${sale.dispatchId || '-'} vendedor=${sale.sellerName}`)
  console.log(`    total=${sale.total} pago=${sale.paymentKind} dia=${sale.dayKey}`)
  for (const line of sale.lines || []) {
    console.log(`      ${line.quantity} ${line.unitType} x ${line.productNameSnapshot} @ ${line.actualUnitPrice} = ${line.subtotal}`)
  }
}

process.exit(0)
