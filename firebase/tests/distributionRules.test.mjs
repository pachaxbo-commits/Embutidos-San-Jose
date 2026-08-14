/**
 * Pruebas de reglas Firestore del modulo de distribucion movil.
 *
 * Ejecuta contra el emulador (no toca produccion):
 *   npm run emulators   (en otra terminal)
 *   npm run test:rules
 *
 * Cubre casos positivos y negativos por rol, aislamiento entre tenants,
 * aislamiento entre rutas e inmutabilidad de los documentos contables.
 */
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing'
import { doc, getDoc, setDoc, updateDoc, deleteDoc, getDocs, collection, query, where } from 'firebase/firestore'
import fs from 'fs'

const HOST = '127.0.0.1'
const PORT = 8085

const TENANT = 'tenant-pruebas-reglas'
const OTHER_TENANT = 'otra-empresa'
const ROUTE_NORTE = 'route-norte'
const ROUTE_SUD = 'route-sud'

let passed = 0
let failed = 0
const failures = []

async function check(name, promise) {
  try {
    await promise
    passed++
    console.log(`PASS: ${name}`)
  } catch (error) {
    failed++
    failures.push(`${name}: ${error.message}`)
    console.log(`FAIL: ${name}`)
  }
}

function saleDoc(restaurantId, routeId, overrides = {}) {
  return {
    id: 'sale-1',
    operationId: 'sale-1',
    restaurantId,
    branchId: 'main',
    createdAt: new Date().toISOString(),
    createdBy: 'uid-hugo',
    dayKey: '2026-08-14',
    schemaVersion: 1,
    sourceLocation: 'route',
    routeId,
    routeName: 'Zona Norte',
    sellerUid: 'uid-hugo',
    sellerName: 'Hugo',
    lines: [],
    total: 288,
    paymentKind: 'cash',
    cashAmount: 288,
    qrAmount: 0,
    creditAmount: 0,
    ...overrides,
  }
}

async function run() {
  const rules = fs.readFileSync('firebase/firestore.rules', 'utf8')
  const testEnv = await initializeTestEnvironment({
    projectId: 'pachax-flow',
    firestore: { host: HOST, port: PORT, rules },
  })

  await testEnv.clearFirestore()

  // --- Semilla de miembros y documentos base (sin reglas) ---
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore()

    await setDoc(doc(db, `restaurants/${TENANT}/members/uid-admin`), {
      uid: 'uid-admin', email: 'admin@sanjose.bo', displayName: 'Duena', role: 'admin', active: true,
    })
    await setDoc(doc(db, `restaurants/${TENANT}/members/uid-almacen`), {
      uid: 'uid-almacen', email: 'almacen@sanjose.bo', displayName: 'Almacen', role: 'warehouse', active: true,
    })
    await setDoc(doc(db, `restaurants/${TENANT}/members/uid-hugo`), {
      uid: 'uid-hugo', email: 'hugo@sanjose.bo', displayName: 'Hugo', role: 'distributor', active: true, routeId: ROUTE_NORTE,
    })
    await setDoc(doc(db, `restaurants/${TENANT}/members/uid-ricardo`), {
      uid: 'uid-ricardo', email: 'ricardo@sanjose.bo', displayName: 'Ricardo', role: 'distributor', active: true, routeId: ROUTE_SUD,
    })
    await setDoc(doc(db, `restaurants/${TENANT}`), {
      id: TENANT, name: 'Embutidos San Jose', slug: TENANT, ownerUid: 'uid-admin', plan: 'pro',
      businessType: 'mobile_distribution', currencyCode: 'BOB', currencySymbol: 'Bs', createdAt: new Date().toISOString(),
    })
    await setDoc(doc(db, `restaurants/${OTHER_TENANT}`), {
      id: OTHER_TENANT, name: 'Otra Empresa', slug: OTHER_TENANT, ownerUid: 'uid-ajeno', plan: 'pro',
      createdAt: new Date().toISOString(),
    })
    await setDoc(doc(db, `users/uid-hugo`), { uid: 'uid-hugo', email: 'hugo@sanjose.bo', defaultRestaurantId: TENANT })
    await setDoc(doc(db, `users/uid-ajeno`), { uid: 'uid-ajeno', email: 'ajeno@otra.bo', defaultRestaurantId: OTHER_TENANT })
    await setDoc(doc(db, `restaurants/${OTHER_TENANT}/members/uid-ajeno`), {
      uid: 'uid-ajeno', email: 'ajeno@otra.bo', displayName: 'Ajeno', role: 'admin', active: true,
    })

    // Documentos existentes para probar lecturas y mutaciones
    await setDoc(doc(db, `restaurants/${TENANT}/distProducts/p1`), {
      id: 'p1', name: 'Viena granel', category: 'Granel', unitType: 'kg', referencePrice: 48, active: true, restaurantId: TENANT,
    })
    await setDoc(doc(db, `restaurants/${TENANT}/distSales/sale-norte`), saleDoc(TENANT, ROUTE_NORTE, { id: 'sale-norte' }))
    await setDoc(doc(db, `restaurants/${TENANT}/distSales/sale-sud`), saleDoc(TENANT, ROUTE_SUD, { id: 'sale-sud' }))
    await setDoc(doc(db, `restaurants/${TENANT}/distReceivables/rec-norte`), {
      id: 'rec-norte', restaurantId: TENANT, branchId: 'main', createdAt: new Date().toISOString(), createdBy: 'uid-hugo',
      dayKey: '2026-08-14', schemaVersion: 1, saleId: 'sale-norte', customerId: 'c1', customerName: 'Cliente',
      routeId: ROUTE_NORTE, distributorUid: 'uid-hugo', distributorName: 'Hugo',
      originalAmount: 159, paidAmount: 0, balance: 159, status: 'OPEN',
    })
    await setDoc(doc(db, `restaurants/${TENANT}/distCollections/col-1`), {
      id: 'col-1', restaurantId: TENANT, routeId: ROUTE_NORTE, amount: 100, method: 'cash',
      createdAt: new Date().toISOString(), createdBy: 'uid-hugo', dayKey: '2026-08-14', schemaVersion: 1, branchId: 'main',
    })
    await setDoc(doc(db, `restaurants/${TENANT}/distStockMovements/mov-1`), {
      id: 'mov-1', restaurantId: TENANT, routeId: ROUTE_NORTE, type: 'dispatch', productId: 'p1', quantity: 20,
      centralDelta: -20, routeDelta: 20, createdAt: new Date().toISOString(), createdBy: 'uid-almacen',
      dayKey: '2026-08-14', schemaVersion: 1, branchId: 'main',
    })
    await setDoc(doc(db, `restaurants/${TENANT}/distDispatches/disp-sud`), {
      id: 'disp-sud', restaurantId: TENANT, branchId: 'main', createdAt: new Date().toISOString(), createdBy: 'uid-almacen',
      dayKey: '2026-08-14', schemaVersion: 1, routeId: ROUTE_SUD, routeName: 'Zona Sud',
      distributorUid: 'uid-ricardo', distributorName: 'Ricardo', status: 'open', lines: [], additions: [],
    })
    await setDoc(doc(db, `restaurants/${OTHER_TENANT}/distProducts/p9`), {
      id: 'p9', name: 'Producto ajeno', category: 'Granel', unitType: 'kg', referencePrice: 10, active: true, restaurantId: OTHER_TENANT,
    })
  })

  const admin = testEnv.authenticatedContext('uid-admin').firestore()
  const almacen = testEnv.authenticatedContext('uid-almacen').firestore()
  const hugo = testEnv.authenticatedContext('uid-hugo').firestore()
  const ajeno = testEnv.authenticatedContext('uid-ajeno').firestore()
  const anonimo = testEnv.unauthenticatedContext().firestore()

  // =====================================================================
  // ADMIN
  // =====================================================================
  await check('ADMIN lee el catalogo de su tenant',
    assertSucceeds(getDoc(doc(admin, `restaurants/${TENANT}/distProducts/p1`))))

  await check('ADMIN crea/edita productos',
    assertSucceeds(setDoc(doc(admin, `restaurants/${TENANT}/distProducts/p2`), {
      id: 'p2', name: 'Chorizo', category: 'Granel', unitType: 'kg', referencePrice: 57, active: true, restaurantId: TENANT,
    })))

  await check('ADMIN lee ventas de cualquier ruta',
    assertSucceeds(getDocs(collection(admin, `restaurants/${TENANT}/distSales`))))

  await check('ADMIN registra venta directa desde almacen central',
    assertSucceeds(setDoc(doc(admin, `restaurants/${TENANT}/distSales/sale-central`),
      saleDoc(TENANT, 'route-directa', { id: 'sale-central', sourceLocation: 'centralWarehouse', createdBy: 'uid-admin' }))))

  await check('ADMIN lee el ledger de movimientos',
    assertSucceeds(getDocs(collection(admin, `restaurants/${TENANT}/distStockMovements`))))

  // =====================================================================
  // WAREHOUSE
  // =====================================================================
  await check('ALMACEN crea un despacho',
    assertSucceeds(setDoc(doc(almacen, `restaurants/${TENANT}/distDispatches/disp-1`), {
      id: 'disp-1', restaurantId: TENANT, branchId: 'main', createdAt: new Date().toISOString(), createdBy: 'uid-almacen',
      dayKey: '2026-08-14', schemaVersion: 1, routeId: ROUTE_NORTE, routeName: 'Zona Norte',
      distributorUid: 'uid-hugo', distributorName: 'Hugo', status: 'open', lines: [], additions: [],
    })))

  await check('ALMACEN escribe movimientos de inventario',
    assertSucceeds(setDoc(doc(almacen, `restaurants/${TENANT}/distStockMovements/mov-2`), {
      id: 'mov-2', restaurantId: TENANT, routeId: ROUTE_NORTE, type: 'dispatch', productId: 'p1', quantity: 20,
      centralDelta: -20, routeDelta: 20, createdAt: new Date().toISOString(), createdBy: 'uid-almacen',
      dayKey: '2026-08-14', schemaVersion: 1, branchId: 'main',
    })))

  await check('ALMACEN actualiza saldos de inventario',
    assertSucceeds(setDoc(doc(almacen, `restaurants/${TENANT}/distBalances/central__p1`), {
      id: 'central__p1', locationKind: 'central', productId: 'p1', productName: 'Viena', unitType: 'kg',
      quantity: 100, restaurantId: TENANT, updatedAt: new Date().toISOString(),
    })))

  await check('ALMACEN NO puede registrar una venta de ruta',
    assertFails(setDoc(doc(almacen, `restaurants/${TENANT}/distSales/sale-almacen`),
      saleDoc(TENANT, ROUTE_NORTE, { id: 'sale-almacen', createdBy: 'uid-almacen' }))))

  await check('ALMACEN NO puede editar productos ni precios',
    assertFails(setDoc(doc(almacen, `restaurants/${TENANT}/distProducts/p1`), {
      id: 'p1', name: 'Viena granel', category: 'Granel', unitType: 'kg', referencePrice: 1, active: true, restaurantId: TENANT,
    })))

  // =====================================================================
  // DISTRIBUTOR
  // =====================================================================
  await check('DISTRIBUIDOR lee el catalogo',
    assertSucceeds(getDoc(doc(hugo, `restaurants/${TENANT}/distProducts/p1`))))

  await check('DISTRIBUIDOR lee las ventas de SU ruta',
    assertSucceeds(getDocs(query(collection(hugo, `restaurants/${TENANT}/distSales`), where('routeId', '==', ROUTE_NORTE)))))

  await check('DISTRIBUIDOR NO lee las ventas de otra ruta',
    assertFails(getDocs(query(collection(hugo, `restaurants/${TENANT}/distSales`), where('routeId', '==', ROUTE_SUD)))))

  await check('DISTRIBUIDOR NO lee la coleccion de ventas sin filtrar por ruta',
    assertFails(getDocs(collection(hugo, `restaurants/${TENANT}/distSales`))))

  await check('DISTRIBUIDOR NO lee una venta suelta de otra ruta',
    assertFails(getDoc(doc(hugo, `restaurants/${TENANT}/distSales/sale-sud`))))

  await check('DISTRIBUIDOR registra una venta de SU ruta',
    assertSucceeds(setDoc(doc(hugo, `restaurants/${TENANT}/distSales/sale-hugo-1`),
      saleDoc(TENANT, ROUTE_NORTE, { id: 'sale-hugo-1' }))))

  await check('DISTRIBUIDOR NO registra ventas a nombre de otra ruta',
    assertFails(setDoc(doc(hugo, `restaurants/${TENANT}/distSales/sale-hugo-2`),
      saleDoc(TENANT, ROUTE_SUD, { id: 'sale-hugo-2' }))))

  await check('DISTRIBUIDOR crea la cuenta por cobrar de su venta a credito',
    assertSucceeds(setDoc(doc(hugo, `restaurants/${TENANT}/distReceivables/rec-hugo-1`), {
      id: 'rec-hugo-1', restaurantId: TENANT, branchId: 'main', createdAt: new Date().toISOString(), createdBy: 'uid-hugo',
      dayKey: '2026-08-14', schemaVersion: 1, saleId: 'sale-hugo-1', customerId: 'c1', customerName: 'Cliente',
      routeId: ROUTE_NORTE, distributorUid: 'uid-hugo', distributorName: 'Hugo',
      originalAmount: 159, paidAmount: 0, balance: 159, status: 'OPEN',
    })))

  await check('DISTRIBUIDOR registra un cobro de su ruta',
    assertSucceeds(setDoc(doc(hugo, `restaurants/${TENANT}/distCollections/col-hugo-1`), {
      id: 'col-hugo-1', restaurantId: TENANT, branchId: 'main', routeId: ROUTE_NORTE, amount: 100, method: 'cash',
      createdAt: new Date().toISOString(), createdBy: 'uid-hugo', dayKey: '2026-08-14', schemaVersion: 1,
    })))

  await check('DISTRIBUIDOR NO registra cobros con monto cero o negativo',
    assertFails(setDoc(doc(hugo, `restaurants/${TENANT}/distCollections/col-hugo-2`), {
      id: 'col-hugo-2', restaurantId: TENANT, branchId: 'main', routeId: ROUTE_NORTE, amount: 0, method: 'cash',
      createdAt: new Date().toISOString(), createdBy: 'uid-hugo', dayKey: '2026-08-14', schemaVersion: 1,
    })))

  await check('DISTRIBUIDOR registra un gasto de su ruta',
    assertSucceeds(setDoc(doc(hugo, `restaurants/${TENANT}/distExpenses/exp-hugo-1`), {
      id: 'exp-hugo-1', restaurantId: TENANT, branchId: 'main', routeId: ROUTE_NORTE, routeName: 'Zona Norte',
      concept: 'Gasolina', amount: 20, registeredByUid: 'uid-hugo', registeredByName: 'Hugo',
      createdAt: new Date().toISOString(), createdBy: 'uid-hugo', dayKey: '2026-08-14', schemaVersion: 1,
    })))

  await check('DISTRIBUIDOR NO registra gastos de otra ruta',
    assertFails(setDoc(doc(hugo, `restaurants/${TENANT}/distExpenses/exp-hugo-2`), {
      id: 'exp-hugo-2', restaurantId: TENANT, branchId: 'main', routeId: ROUTE_SUD, routeName: 'Zona Sud',
      concept: 'Gasolina', amount: 20, registeredByUid: 'uid-hugo', registeredByName: 'Hugo',
      createdAt: new Date().toISOString(), createdBy: 'uid-hugo', dayKey: '2026-08-14', schemaVersion: 1,
    })))

  await check('DISTRIBUIDOR crea un cliente rapido durante la venta',
    assertSucceeds(setDoc(doc(hugo, `restaurants/${TENANT}/distCustomers/c-nuevo`), {
      id: 'c-nuevo', name: 'Tienda Dona Rosa', restaurantId: TENANT, active: true,
      createdAt: new Date().toISOString(), createdBy: 'uid-hugo',
    })))

  await check('DISTRIBUIDOR NO edita el catalogo ni los precios',
    assertFails(setDoc(doc(hugo, `restaurants/${TENANT}/distProducts/p1`), {
      id: 'p1', name: 'Viena granel', category: 'Granel', unitType: 'kg', referencePrice: 1, active: true, restaurantId: TENANT,
    })))

  await check('DISTRIBUIDOR NO lee el ledger completo de inventario',
    assertFails(getDocs(collection(hugo, `restaurants/${TENANT}/distStockMovements`))))

  await check('DISTRIBUIDOR NO administra usuarios',
    assertFails(setDoc(doc(hugo, `restaurants/${TENANT}/members/uid-nuevo`), {
      uid: 'uid-nuevo', email: 'x@y.bo', displayName: 'X', role: 'distributor', active: true, routeId: ROUTE_NORTE,
    })))

  // =====================================================================
  // Aislamiento entre empresas
  // =====================================================================
  await check('Otro tenant NO lee el catalogo de San Jose',
    assertFails(getDoc(doc(ajeno, `restaurants/${TENANT}/distProducts/p1`))))

  await check('Otro tenant NO lee las ventas de San Jose',
    assertFails(getDocs(collection(ajeno, `restaurants/${TENANT}/distSales`))))

  await check('Otro tenant NO escribe en San Jose',
    assertFails(setDoc(doc(ajeno, `restaurants/${TENANT}/distSales/sale-ajena`), saleDoc(TENANT, ROUTE_NORTE, { id: 'sale-ajena' }))))

  await check('ADMIN de San Jose NO lee el catalogo de otra empresa',
    assertFails(getDoc(doc(admin, `restaurants/${OTHER_TENANT}/distProducts/p9`))))

  await check('ADMIN NO puede escribir documentos con restaurantId de otro tenant',
    assertFails(setDoc(doc(admin, `restaurants/${TENANT}/distSales/sale-suplantada`),
      saleDoc(OTHER_TENANT, ROUTE_NORTE, { id: 'sale-suplantada' }))))

  await check('Usuario sin sesion NO lee nada',
    assertFails(getDoc(doc(anonimo, `restaurants/${TENANT}/distProducts/p1`))))

  await check('DISTRIBUIDOR cierra SU despacho (solo marca el estado)',
    assertSucceeds(updateDoc(doc(hugo, `restaurants/${TENANT}/distDispatches/disp-1`), {
      status: 'closed', closedAt: new Date().toISOString(), closureId: 'closure-disp-1',
    })))

  await check('DISTRIBUIDOR NO altera la carga de su despacho',
    assertFails(updateDoc(doc(hugo, `restaurants/${TENANT}/distDispatches/disp-1`), {
      lines: [{ productId: 'p1', productName: 'Viena', unitType: 'kg', quantity: 999 }],
    })))

  await check('DISTRIBUIDOR NO cierra el despacho de otra ruta',
    assertFails(updateDoc(doc(hugo, `restaurants/${TENANT}/distDispatches/disp-sud`), {
      status: 'closed', closedAt: new Date().toISOString(), closureId: 'closure-disp-sud',
    })))

  await check('ALMACEN lista el personal para elegir distribuidor',
    assertSucceeds(getDocs(collection(almacen, `restaurants/${TENANT}/members`))))

  await check('DISTRIBUIDOR NO lista el personal de la empresa',
    assertFails(getDocs(collection(hugo, `restaurants/${TENANT}/members`))))

  // =====================================================================
  // Perfil del tenant y mapa usuario -> empresa
  // =====================================================================
  await check('Cualquier miembro lee el perfil de SU empresa (businessType)',
    assertSucceeds(getDoc(doc(hugo, `restaurants/${TENANT}`))))

  await check('ADMIN lee el perfil de su empresa',
    assertSucceeds(getDoc(doc(admin, `restaurants/${TENANT}`))))

  await check('ADMIN actualiza el perfil (tipo de empresa y marca)',
    assertSucceeds(updateDoc(doc(admin, `restaurants/${TENANT}`), { businessType: 'mobile_distribution' })))

  await check('DISTRIBUIDOR NO cambia el perfil de la empresa',
    assertFails(updateDoc(doc(hugo, `restaurants/${TENANT}`), { businessType: 'restaurant' })))

  await check('Otro tenant NO lee el perfil de San Jose',
    assertFails(getDoc(doc(ajeno, `restaurants/${TENANT}`))))

  await check('Usuario sin sesion NO lee el perfil de la empresa',
    assertFails(getDoc(doc(anonimo, `restaurants/${TENANT}`))))

  await check('Cada usuario lee su propio mapa de empresa',
    assertSucceeds(getDoc(doc(hugo, 'users/uid-hugo'))))

  await check('Un usuario NO lee el mapa de empresa de otro',
    assertFails(getDoc(doc(hugo, 'users/uid-ajeno'))))

  await check('ADMIN apunta a un usuario nuevo hacia SU empresa',
    assertSucceeds(setDoc(doc(admin, 'users/uid-nuevo-distribuidor'), {
      uid: 'uid-nuevo-distribuidor', email: 'nuevo@sanjose.bo', displayName: 'Nuevo', defaultRestaurantId: TENANT,
    })))

  await check('ADMIN NO puede apuntar a un usuario hacia otra empresa',
    assertFails(setDoc(doc(admin, 'users/uid-secuestrado'), {
      uid: 'uid-secuestrado', email: 'x@y.bo', displayName: 'X', defaultRestaurantId: OTHER_TENANT,
    })))

  // =====================================================================
  // Arranque de una empresa nueva
  // =====================================================================
  await check('El dueno crea el documento de su empresa',
    assertSucceeds(setDoc(doc(admin, 'restaurants/empresa-nueva'), {
      id: 'empresa-nueva', name: 'Empresa Nueva', slug: 'empresa-nueva', ownerUid: 'uid-admin',
      plan: 'pro', createdAt: new Date().toISOString(),
    })))

  await check('El dueno se registra como primer administrador de su empresa',
    assertSucceeds(setDoc(doc(admin, 'restaurants/empresa-nueva/members/uid-admin'), {
      uid: 'uid-admin', email: 'admin@sanjose.bo', displayName: 'Duena', role: 'admin', active: true,
      createdAt: new Date().toISOString(),
    })))

  await check('Nadie mas puede autoproclamarse miembro de esa empresa',
    assertFails(setDoc(doc(hugo, 'restaurants/empresa-nueva/members/uid-hugo'), {
      uid: 'uid-hugo', email: 'hugo@sanjose.bo', displayName: 'Hugo', role: 'admin', active: true,
      createdAt: new Date().toISOString(),
    })))

  await check('Un usuario NO puede crear una empresa a nombre de otro dueno',
    assertFails(setDoc(doc(hugo, 'restaurants/empresa-secuestrada'), {
      id: 'empresa-secuestrada', name: 'Ajena', slug: 'ajena', ownerUid: 'uid-admin',
      plan: 'pro', createdAt: new Date().toISOString(),
    })))

  // =====================================================================
  // Inmutabilidad contable
  // =====================================================================
  await check('Una venta NO se puede modificar (ni el admin)',
    assertFails(updateDoc(doc(admin, `restaurants/${TENANT}/distSales/sale-norte`), { total: 1 })))

  await check('Una venta NO se puede borrar',
    assertFails(deleteDoc(doc(admin, `restaurants/${TENANT}/distSales/sale-norte`))))

  await check('Un cobro NO se puede modificar',
    assertFails(updateDoc(doc(admin, `restaurants/${TENANT}/distCollections/col-1`), { amount: 1 })))

  await check('Un movimiento del ledger NO se puede modificar',
    assertFails(updateDoc(doc(almacen, `restaurants/${TENANT}/distStockMovements/mov-1`), { quantity: 999 })))

  await check('Un movimiento del ledger NO se puede borrar',
    assertFails(deleteDoc(doc(almacen, `restaurants/${TENANT}/distStockMovements/mov-1`))))

  await check('La cuenta por cobrar solo admite actualizar saldo y estado',
    assertSucceeds(updateDoc(doc(hugo, `restaurants/${TENANT}/distReceivables/rec-norte`), {
      paidAmount: 100, balance: 59, status: 'PARTIAL', updatedAt: new Date().toISOString(),
    })))

  await check('La cuenta por cobrar NO admite cambiar el monto original',
    assertFails(updateDoc(doc(hugo, `restaurants/${TENANT}/distReceivables/rec-norte`), { originalAmount: 1 })))

  await check('La deuda NO se puede borrar',
    assertFails(deleteDoc(doc(admin, `restaurants/${TENANT}/distReceivables/rec-norte`))))

  await check('Un gasto NO se puede borrar',
    assertFails(deleteDoc(doc(admin, `restaurants/${TENANT}/distExpenses/exp-hugo-1`))))

  await testEnv.cleanup()

  console.log(`\n${passed} passed / ${failed} failed`)
  if (failures.length > 0) {
    console.log('\nDetalle de fallos:')
    failures.forEach((line) => console.log(`  - ${line}`))
    process.exitCode = 1
  }
}

run().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
