/**
 * Deja lista la empresa Embutidos San Jose en el Firebase que indique .env.
 *
 *   node scripts/seedSanJoseTenant.mjs
 *
 * Es idempotente: se puede ejecutar varias veces sin duplicar nada.
 *
 * No usa Admin SDK ni credenciales de servicio: hace exactamente lo que hace la
 * aplicacion (cuenta en Firebase Auth + documentos bajo el tenant), de modo que
 * lo que queda sembrado es indistinguible de lo que la duena creara despues
 * desde la pantalla Usuarios.
 *
 * Requiere que las reglas de firebase/firestore.rules esten publicadas, porque
 * se apoya en la regla de arranque que permite al dueno registrarse como primer
 * administrador de su propia empresa.
 *
 * Contrasenas: se leen de las variables SANJOSE_ADMIN_PASSWORD,
 * SANJOSE_WAREHOUSE_PASSWORD y SANJOSE_DISTRIBUTOR_PASSWORD.
 */
import fs from 'fs'
import { initializeApp, deleteApp } from 'firebase/app'
import {
  createUserWithEmailAndPassword,
  getAuth,
  signInWithEmailAndPassword,
  signOut,
} from 'firebase/auth'
import { doc, getDoc, getFirestore, setDoc } from 'firebase/firestore'

const TENANT = process.env.SANJOSE_TENANT_ID || 'sanjose'

const ACCOUNTS = {
  admin: {
    email: process.env.SANJOSE_ADMIN_EMAIL || 'admin@embutidossanjose.com',
    password: process.env.SANJOSE_ADMIN_PASSWORD,
    displayName: 'Administracion San Jose',
    role: 'admin',
    routeId: '',
  },
  warehouse: {
    email: process.env.SANJOSE_WAREHOUSE_EMAIL || 'almacen@embutidossanjose.com',
    password: process.env.SANJOSE_WAREHOUSE_PASSWORD,
    displayName: 'Almacen Central',
    role: 'warehouse',
    routeId: '',
  },
  distributor: {
    email: process.env.SANJOSE_DISTRIBUTOR_EMAIL || 'hugo@embutidossanjose.com',
    password: process.env.SANJOSE_DISTRIBUTOR_PASSWORD,
    displayName: 'Hugo Herbas',
    role: 'distributor',
    routeId: 'route-norte',
  },
}

const ROUTES = [
  { id: 'route-norte', name: 'Zona Norte', kind: 'route' },
  { id: 'route-sud', name: 'Zona Sud', kind: 'route' },
  { id: 'route-sacaba', name: 'Sacaba', kind: 'route' },
  { id: 'route-directa', name: 'Venta directa / Impulsacion', kind: 'direct' },
]

const PRODUCTS = [
  { id: 'vac-viena-agua-10u-12cm', name: 'Salchicha tipo Viena para el agua', category: 'Al vacio', presentation: '10 unidades 12 cm (aprox. 350 g)', unitType: 'package', referencePrice: 20, approximateWeightKg: 0.35 },
  { id: 'vac-viena-agua-12u-19cm', name: 'Salchicha tipo Viena para el agua', category: 'Al vacio', presentation: '12 unidades 19 cm (aprox. 650 g)', unitType: 'package', referencePrice: 32, approximateWeightKg: 0.65 },
  { id: 'vac-viena-clasico-10u-12cm', name: 'Salchicha tipo Viena clasico', category: 'Al vacio', presentation: '10 unidades 12 cm (aprox. 450 g)', unitType: 'package', referencePrice: 24, approximateWeightKg: 0.45 },
  { id: 'vac-chorizo-parrillero-precocido-500', name: 'Chorizo parrillero precocido ahumado', category: 'Al vacio', presentation: 'Con/sin picante, aprox. 500 g', unitType: 'package', referencePrice: 28, approximateWeightKg: 0.5 },
  { id: 'vac-chorizo-criollo-1kg', name: 'Chorizo parrillero criollo', category: 'Al vacio', presentation: '1 kg', unitType: 'package', referencePrice: 57, approximateWeightKg: 1 },
  { id: 'vac-chorizo-criollo-500', name: 'Chorizo parrillero criollo', category: 'Al vacio', presentation: '500 g', unitType: 'package', referencePrice: 29, approximateWeightKg: 0.5 },
  { id: 'vac-chorizo-freir-1kg', name: 'Chorizo de freir', category: 'Al vacio', presentation: '1 kg', unitType: 'package', referencePrice: 55, approximateWeightKg: 1 },
  { id: 'vac-chorizo-freir-500', name: 'Chorizo de freir', category: 'Al vacio', presentation: '500 g', unitType: 'package', referencePrice: 28, approximateWeightKg: 0.5 },
  { id: 'vac-mortadela-jamonada-200', name: 'Mortadela jamonada', category: 'Al vacio', presentation: 'Sachet 200 g', unitType: 'package', referencePrice: 12, approximateWeightKg: 0.2 },
  { id: 'vac-mortadela-primavera-200', name: 'Mortadela primavera', category: 'Al vacio', presentation: 'Sachet 200 g', unitType: 'package', referencePrice: 12, approximateWeightKg: 0.2 },
  { id: 'vac-jamon-cerdo-200', name: 'Jamon de cerdo', category: 'Al vacio', presentation: 'Sachet 200 g', unitType: 'package', referencePrice: 13, approximateWeightKg: 0.2 },
  { id: 'vac-viena-coctelera-500', name: 'Salchicha tipo Viena coctelera', category: 'Al vacio', presentation: '500 g', unitType: 'package', referencePrice: 28, approximateWeightKg: 0.5 },
  { id: 'vac-tocino-ahumado-150', name: 'Tocino ahumado', category: 'Al vacio', presentation: 'Sachet 150 g', unitType: 'package', referencePrice: 17, approximateWeightKg: 0.15 },
  { id: 'vac-pate-higado-100', name: 'Pate de higado de cerdo', category: 'Al vacio', presentation: 'Aprox. 100 g', unitType: 'package', referencePrice: 7, approximateWeightKg: 0.1 },
  { id: 'vac-pate-higado-200', name: 'Pate de higado de cerdo', category: 'Al vacio', presentation: 'Aprox. 200 g', unitType: 'package', referencePrice: 13, approximateWeightKg: 0.2 },
  { id: 'vac-enrollado-cerdo-200', name: 'Enrollado de cerdo', category: 'Al vacio', presentation: 'Sachet aprox. 200 g', unitType: 'package', referencePrice: 15, approximateWeightKg: 0.2 },
  { id: 'gra-chorizo-parrillero-crudo', name: 'Chorizo parrillero crudo', category: 'Granel', presentation: 'Bs 57 / kg', unitType: 'kg', referencePrice: 57 },
  { id: 'gra-chorizo-parrillero-precocido', name: 'Chorizo parrillero precocido ahumado', category: 'Granel', presentation: 'Con/sin picante, Bs 53 / kg', unitType: 'kg', referencePrice: 53 },
  { id: 'gra-viena', name: 'Salchicha tipo Viena', category: 'Granel', presentation: 'Bs 48 / kg', unitType: 'kg', referencePrice: 48 },
  { id: 'gra-viena-agua', name: 'Salchicha tipo Viena para el agua', category: 'Granel', presentation: 'Bs 50 / kg', unitType: 'kg', referencePrice: 50 },
  { id: 'gra-jamon-cerdo', name: 'Jamon de cerdo', category: 'Granel', presentation: 'Bs 53 / kg', unitType: 'kg', referencePrice: 53 },
  { id: 'gra-mortadela', name: 'Mortadela primavera / jamonada', category: 'Granel', presentation: 'Bs 50 / kg', unitType: 'kg', referencePrice: 50 },
]

/** Stock inicial del almacen central para poder despachar en la demo */
const CENTRAL_STOCK = {
  'gra-viena': 100,
  'gra-chorizo-parrillero-crudo': 60,
  'gra-jamon-cerdo': 40,
  'gra-viena-agua': 50,
  'vac-mortadela-jamonada-200': 60,
  'vac-chorizo-criollo-500': 40,
}

function readEnv() {
  const raw = fs.readFileSync('.env', 'utf8')
  const values = Object.fromEntries(
    raw
      .split(/\r?\n/)
      .filter((line) => line.includes('=') && !line.trim().startsWith('#'))
      .map((line) => {
        const index = line.indexOf('=')
        return [line.slice(0, index).trim(), line.slice(index + 1).trim()]
      }),
  )

  if (values.VITE_USE_FIREBASE_EMULATOR === 'true') {
    throw new Error('.env apunta al emulador. Este script es para el Firebase real.')
  }

  return {
    apiKey: values.VITE_FIREBASE_API_KEY,
    authDomain: values.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: values.VITE_FIREBASE_PROJECT_ID,
    storageBucket: values.VITE_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: values.VITE_FIREBASE_MESSAGING_SENDER_ID,
    appId: values.VITE_FIREBASE_APP_ID,
  }
}

const config = readEnv()

for (const [key, account] of Object.entries(ACCOUNTS)) {
  if (!account.password) {
    throw new Error(`Falta la contrasena de la cuenta "${key}" (variable de entorno correspondiente).`)
  }
}

const nowIso = () => new Date().toISOString()

/** Crea la cuenta si no existe; en cualquier caso devuelve su uid. */
async function ensureAccount(auth, account) {
  try {
    const credential = await createUserWithEmailAndPassword(auth, account.email, account.password)
    console.log(`  auth: creada ${account.email}`)
    return credential.user.uid
  } catch (error) {
    if (error.code !== 'auth/email-already-in-use') throw error
    const credential = await signInWithEmailAndPassword(auth, account.email, account.password)
    console.log(`  auth: ya existia ${account.email}`)
    return credential.user.uid
  }
}

async function main() {
  console.log(`Proyecto Firebase: ${config.projectId}`)
  console.log(`Tenant: ${TENANT}\n`)

  // App secundaria: crea las cuentas sin arrastrar la sesion principal.
  const secondaryApp = initializeApp(config, `seed-accounts-${Date.now()}`)
  const secondaryAuth = getAuth(secondaryApp)

  console.log('1. Cuentas de acceso')
  const uids = {}
  for (const [key, account] of Object.entries(ACCOUNTS)) {
    uids[key] = await ensureAccount(secondaryAuth, account)
  }
  await signOut(secondaryAuth).catch(() => undefined)

  // Sesion principal: el administrador escribe su propia empresa.
  const app = initializeApp(config, `seed-main-${Date.now()}`)
  const auth = getAuth(app)
  const db = getFirestore(app)

  await signInWithEmailAndPassword(auth, ACCOUNTS.admin.email, ACCOUNTS.admin.password)
  console.log(`\n2. Sesion iniciada como ${ACCOUNTS.admin.email}`)

  const tenantRef = doc(db, 'restaurants', TENANT)
  const tenantSnap = await getDoc(tenantRef).catch(() => null)

  if (!tenantSnap || !tenantSnap.exists()) {
    await setDoc(tenantRef, {
      id: TENANT,
      name: 'Embutidos San Jose',
      slug: TENANT,
      ownerUid: uids.admin,
      plan: 'pro',
      createdAt: nowIso(),
      businessType: 'mobile_distribution',
      currencyCode: 'BOB',
      currencySymbol: 'Bs',
      branding: {
        name: 'Embutidos San Jose',
        primaryColor: '#C1121F',
        accentColor: '#F2B705',
        surfaceColor: '#FAF7F2',
        receiptHeader: 'EMBUTIDOS SAN JOSE',
        receiptFooter: 'Gracias por su preferencia',
      },
    })
    console.log('3. Empresa creada')
  } else {
    await setDoc(
      tenantRef,
      { businessType: 'mobile_distribution', currencyCode: 'BOB', currencySymbol: 'Bs', updatedAt: nowIso() },
      { merge: true },
    )
    console.log('3. Empresa ya existia (perfil actualizado)')
  }

  // El dueno se registra como primer administrador (regla de arranque).
  await setDoc(
    doc(db, 'restaurants', TENANT, 'members', uids.admin),
    {
      uid: uids.admin,
      email: ACCOUNTS.admin.email,
      displayName: ACCOUNTS.admin.displayName,
      role: 'admin',
      routeId: '',
      active: true,
      createdAt: nowIso(),
    },
    { merge: true },
  )
  await setDoc(
    doc(db, 'users', uids.admin),
    { uid: uids.admin, email: ACCOUNTS.admin.email, displayName: ACCOUNTS.admin.displayName, defaultRestaurantId: TENANT },
    { merge: true },
  )
  console.log('4. Administrador registrado en la empresa')

  console.log('5. Rutas y catalogo')
  for (const route of ROUTES) {
    await setDoc(doc(db, 'restaurants', TENANT, 'distRoutes', route.id), {
      ...route, active: true, restaurantId: TENANT, createdAt: nowIso(),
    }, { merge: true })
  }
  for (const [index, product] of PRODUCTS.entries()) {
    await setDoc(doc(db, 'restaurants', TENANT, 'distProducts', product.id), {
      ...product, active: true, sortOrder: index, restaurantId: TENANT, createdAt: nowIso(),
    }, { merge: true })
  }
  console.log(`   ${ROUTES.length} rutas y ${PRODUCTS.length} productos`)

  console.log('6. Personal interno')
  for (const key of ['warehouse', 'distributor']) {
    const account = ACCOUNTS[key]
    await setDoc(
      doc(db, 'restaurants', TENANT, 'members', uids[key]),
      {
        uid: uids[key],
        email: account.email,
        displayName: account.displayName,
        role: account.role,
        routeId: account.routeId,
        active: true,
        createdAt: nowIso(),
      },
      { merge: true },
    )
    await setDoc(
      doc(db, 'users', uids[key]),
      { uid: uids[key], email: account.email, displayName: account.displayName, defaultRestaurantId: TENANT },
      { merge: true },
    )
    console.log(`   ${account.displayName} (${account.role})`)
  }

  console.log('7. Stock inicial del almacen central')
  for (const [productId, quantity] of Object.entries(CENTRAL_STOCK)) {
    const product = PRODUCTS.find((item) => item.id === productId)
    await setDoc(doc(db, 'restaurants', TENANT, 'distBalances', `central__${productId}`), {
      id: `central__${productId}`,
      locationKind: 'central',
      productId,
      productName: product.name,
      unitType: product.unitType,
      quantity,
      restaurantId: TENANT,
      updatedAt: nowIso(),
    }, { merge: true })
    await setDoc(doc(db, 'restaurants', TENANT, 'distStockMovements', `seed_intake_${productId}`), {
      id: `seed_intake_${productId}`,
      restaurantId: TENANT,
      branchId: 'main',
      createdAt: nowIso(),
      createdBy: uids.admin,
      dayKey: nowIso().slice(0, 10),
      schemaVersion: 1,
      type: 'intake',
      productId,
      productName: product.name,
      unitType: product.unitType,
      quantity,
      centralDelta: quantity,
      routeDelta: 0,
      routeId: '',
      refType: 'manual',
      refId: 'seed',
      note: 'Stock inicial',
    }, { merge: true })
  }

  await signOut(auth).catch(() => undefined)

  // Verificacion final: cada cuenta entra y resuelve su empresa.
  console.log('\n8. Verificacion de acceso')
  for (const [key, account] of Object.entries(ACCOUNTS)) {
    await signInWithEmailAndPassword(auth, account.email, account.password)
    const userSnap = await getDoc(doc(db, 'users', uids[key]))
    const memberSnap = await getDoc(doc(db, 'restaurants', TENANT, 'members', uids[key]))
    const tenantDoc = await getDoc(doc(db, 'restaurants', TENANT))
    console.log(
      `   ${account.email}: tenant=${userSnap.data()?.defaultRestaurantId} rol=${memberSnap.data()?.role} businessType=${tenantDoc.data()?.businessType}`,
    )
    await signOut(auth)
  }

  await deleteApp(app).catch(() => undefined)
  await deleteApp(secondaryApp).catch(() => undefined)
  console.log('\nListo.')
}

main().catch((error) => {
  console.error('\nFallo la siembra:', error?.code || '', error?.message || error)
  process.exitCode = 1
})
