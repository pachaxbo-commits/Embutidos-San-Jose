/**
 * Siembra el tenant de demo San Jose en el EMULADOR para la prueba E2E.
 * No toca produccion: apunta a 127.0.0.1:8085 (Firestore) y :9095 (Auth).
 *
 *   npm run seed:demo
 *
 * Crea las cuentas de acceso, el tenant con businessType mobile_distribution,
 * el catalogo minimo del escenario, stock inicial en almacen central y un
 * credito anterior para poder registrar el cobro de Bs 100.
 */
import { initializeTestEnvironment } from '@firebase/rules-unit-testing'
import { doc, setDoc } from 'firebase/firestore'
import fs from 'fs'

const AUTH_HOST = 'http://127.0.0.1:9095'
const PROJECT_ID = 'pachax-flow'
const TENANT = 'sanjose'
const PASSWORD = 'demo1234'

const ACCOUNTS = [
  { email: 'admin@sanjose.bo', displayName: 'Duena San Jose', role: 'admin', routeId: '' },
  { email: 'almacen@sanjose.bo', displayName: 'Almacen Central', role: 'warehouse', routeId: '' },
  { email: 'hugo@sanjose.bo', displayName: 'Hugo Herbas', role: 'distributor', routeId: 'route-norte' },
  { email: 'ricardo@sanjose.bo', displayName: 'Ricardo Jimenez', role: 'distributor', routeId: 'route-sud' },
]

const PRODUCTS = [
  { id: 'gra-viena', name: 'Salchicha tipo Viena', category: 'Granel', presentation: 'Bs 48 / kg', unitType: 'kg', referencePrice: 48 },
  { id: 'gra-chorizo-parrillero-crudo', name: 'Chorizo parrillero crudo', category: 'Granel', presentation: 'Bs 57 / kg', unitType: 'kg', referencePrice: 57 },
  { id: 'gra-jamon-cerdo', name: 'Jamon de cerdo', category: 'Granel', presentation: 'Bs 53 / kg', unitType: 'kg', referencePrice: 53 },
  { id: 'vac-mortadela-jamonada-200', name: 'Mortadela jamonada', category: 'Al vacio', presentation: 'Sachet 200 g', unitType: 'package', referencePrice: 12, approximateWeightKg: 0.2 },
]

const ROUTES = [
  { id: 'route-norte', name: 'Zona Norte', kind: 'route' },
  { id: 'route-sud', name: 'Zona Sud', kind: 'route' },
  { id: 'route-sacaba', name: 'Sacaba', kind: 'route' },
  { id: 'route-directa', name: 'Venta directa / Impulsacion', kind: 'direct' },
]

/** Stock inicial del almacen central (kg) */
const CENTRAL_STOCK = {
  'gra-viena': 100,
  'gra-chorizo-parrillero-crudo': 60,
  'gra-jamon-cerdo': 40,
  'vac-mortadela-jamonada-200': 50,
}

async function createAuthUser(email) {
  const response = await fetch(
    `${AUTH_HOST}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake-api-key`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: PASSWORD, returnSecureToken: true }),
    },
  )
  const body = await response.json()
  if (body.error) {
    if (String(body.error.message).includes('EMAIL_EXISTS')) {
      const lookup = await fetch(
        `${AUTH_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake-api-key`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password: PASSWORD, returnSecureToken: true }),
        },
      )
      const existing = await lookup.json()
      return existing.localId
    }
    throw new Error(`${email}: ${body.error.message}`)
  }
  return body.localId
}

function nowIso() {
  return new Date().toISOString()
}

function dayKeyOf(date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

async function run() {
  const uids = {}
  for (const account of ACCOUNTS) {
    uids[account.email] = await createAuthUser(account.email)
    console.log(`auth: ${account.email} -> ${uids[account.email]}`)
  }

  const rules = fs.readFileSync('firebase/firestore.rules', 'utf8')
  const testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { host: '127.0.0.1', port: 8085, rules },
  })

  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore()

    await setDoc(doc(db, `restaurants/${TENANT}`), {
      id: TENANT,
      name: 'Embutidos San Jose',
      slug: TENANT,
      plan: 'pro',
      businessType: 'mobile_distribution',
      currencyCode: 'BOB',
      currencySymbol: 'Bs',
      createdAt: nowIso(),
      branding: {
        name: 'Embutidos San Jose',
        primaryColor: '#C1121F',
        accentColor: '#F2B705',
        surfaceColor: '#FAF7F2',
        receiptHeader: 'EMBUTIDOS SAN JOSE',
        receiptFooter: 'Gracias por su preferencia',
      },
    })

    for (const account of ACCOUNTS) {
      const uid = uids[account.email]
      await setDoc(doc(db, `restaurants/${TENANT}/members/${uid}`), {
        uid,
        email: account.email,
        displayName: account.displayName,
        role: account.role,
        routeId: account.routeId,
        active: true,
        createdAt: nowIso(),
      })
      await setDoc(doc(db, `users/${uid}`), {
        uid,
        email: account.email,
        displayName: account.displayName,
        defaultRestaurantId: TENANT,
      })
    }

    for (const [index, product] of PRODUCTS.entries()) {
      await setDoc(doc(db, `restaurants/${TENANT}/distProducts/${product.id}`), {
        ...product,
        active: true,
        sortOrder: index,
        restaurantId: TENANT,
        createdAt: nowIso(),
      })
    }

    for (const route of ROUTES) {
      await setDoc(doc(db, `restaurants/${TENANT}/distRoutes/${route.id}`), {
        ...route,
        active: true,
        restaurantId: TENANT,
        createdAt: nowIso(),
      })
    }

    // Ingreso inicial al almacen central, con su movimiento de ledger.
    for (const [productId, quantity] of Object.entries(CENTRAL_STOCK)) {
      const product = PRODUCTS.find((item) => item.id === productId)
      await setDoc(doc(db, `restaurants/${TENANT}/distBalances/central__${productId}`), {
        id: `central__${productId}`,
        locationKind: 'central',
        productId,
        productName: product.name,
        unitType: product.unitType,
        quantity,
        restaurantId: TENANT,
        updatedAt: nowIso(),
      })
      await setDoc(doc(db, `restaurants/${TENANT}/distStockMovements/seed_intake_${productId}`), {
        id: `seed_intake_${productId}`,
        restaurantId: TENANT,
        branchId: 'main',
        createdAt: nowIso(),
        createdBy: uids['almacen@sanjose.bo'],
        dayKey: dayKeyOf(new Date()),
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
        note: 'Stock inicial de demo',
      })
    }

    // Cliente y credito anterior (para el cobro de Bs 100 del escenario).
    await setDoc(doc(db, `restaurants/${TENANT}/distCustomers/cust-demo`), {
      id: 'cust-demo',
      name: 'Tienda Dona Rosa',
      phone: '70000000',
      address: 'Av. Blanco Galindo',
      routeId: 'route-norte',
      notes: 'Cliente de demostracion',
      active: true,
      restaurantId: TENANT,
      createdAt: nowIso(),
      createdBy: uids['hugo@sanjose.bo'],
    })

    const yesterday = new Date()
    yesterday.setDate(yesterday.getDate() - 1)
    await setDoc(doc(db, `restaurants/${TENANT}/distReceivables/rec-anterior`), {
      id: 'rec-anterior',
      restaurantId: TENANT,
      branchId: 'main',
      createdAt: yesterday.toISOString(),
      createdBy: uids['hugo@sanjose.bo'],
      dayKey: dayKeyOf(yesterday),
      schemaVersion: 1,
      saleId: 'venta-anterior',
      customerId: 'cust-demo',
      customerName: 'Tienda Dona Rosa',
      routeId: 'route-norte',
      distributorUid: uids['hugo@sanjose.bo'],
      distributorName: 'Hugo Herbas',
      originalAmount: 250,
      paidAmount: 0,
      balance: 250,
      status: 'OPEN',
      note: 'Credito de dias anteriores',
    })
  })

  await testEnv.cleanup()

  console.log('\nTenant de demo sembrado en el emulador.')
  console.log(`  admin:     admin@sanjose.bo / ${PASSWORD}`)
  console.log(`  almacen:   almacen@sanjose.bo / ${PASSWORD}`)
  console.log(`  hugo:      hugo@sanjose.bo / ${PASSWORD} (Zona Norte)`)
  console.log(`  ricardo:   ricardo@sanjose.bo / ${PASSWORD} (Zona Sud)`)
}

run().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
