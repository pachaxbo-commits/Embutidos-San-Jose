/**
 * Siembra un tenant de RESTAURANTE (sin businessType) en el emulador, para
 * comprobar que la experiencia existente no cambio.
 *
 *   npm run seed:restaurant
 */
import { initializeTestEnvironment } from '@firebase/rules-unit-testing'
import { doc, setDoc } from 'firebase/firestore'
import fs from 'fs'

const AUTH_HOST = 'http://127.0.0.1:9095'
const PROJECT_ID = 'pachax-flow'
const TENANT = 'resto-demo'
const PASSWORD = 'demo1234'
const EMAIL = 'admin@resto.bo'

async function createAuthUser(email) {
  const signUp = await fetch(`${AUTH_HOST}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake-api-key`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: PASSWORD, returnSecureToken: true }),
  })
  const body = await signUp.json()
  if (body.error) {
    const signIn = await fetch(`${AUTH_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake-api-key`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: PASSWORD, returnSecureToken: true }),
    })
    return (await signIn.json()).localId
  }
  return body.localId
}

const uid = await createAuthUser(EMAIL)

const rules = fs.readFileSync('firebase/firestore.rules', 'utf8')
const testEnv = await initializeTestEnvironment({
  projectId: PROJECT_ID,
  firestore: { host: '127.0.0.1', port: 8085, rules },
})

await testEnv.withSecurityRulesDisabled(async (context) => {
  const db = context.firestore()
  const now = new Date().toISOString()

  // Tenant SIN businessType: debe comportarse como siempre.
  await setDoc(doc(db, `restaurants/${TENANT}`), {
    id: TENANT,
    name: 'Restaurante Demo',
    slug: TENANT,
    ownerUid: uid,
    plan: 'pro',
    createdAt: now,
    branding: { name: 'Restaurante Demo', primaryColor: '#0B132B', accentColor: '#00F0FF', tablesCount: 12 },
  })

  await setDoc(doc(db, `restaurants/${TENANT}/members/${uid}`), {
    uid, email: EMAIL, displayName: 'Admin Restaurante', role: 'admin', active: true, createdAt: now,
  })
  await setDoc(doc(db, `users/${uid}`), { uid, email: EMAIL, displayName: 'Admin Restaurante', defaultRestaurantId: TENANT })

  await setDoc(doc(db, `restaurants/${TENANT}/catalog/current/categories/cat-hamburguesas`), {
    id: 'cat-hamburguesas', name: 'Hamburguesas', emoji: '🍔', subtitle: 'Clasicas',
    sortOrder: 0, isActive: true, isVisible: true,
  })
  await setDoc(doc(db, `restaurants/${TENANT}/catalog/current/products/prod-clasica`), {
    id: 'prod-clasica', categoryId: 'cat-hamburguesas', name: 'Hamburguesa clasica', description: 'Con papas',
    price: 35, image: '', availability: 'available', sortOrder: 0, isActive: true, isVisible: true,
    extras: [], options: [],
  })
})

await testEnv.cleanup()

console.log('Tenant de restaurante sembrado en el emulador.')
console.log(`  ${EMAIL} / ${PASSWORD}`)
