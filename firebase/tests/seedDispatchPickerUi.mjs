import { initializeTestEnvironment } from '@firebase/rules-unit-testing'
import { doc, setDoc } from 'firebase/firestore'
import fs from 'node:fs'

const projectId = 'demo-pachax-audit'
const products = [
  { id: 'qa-dispatch-order-a', name: 'Orden A' },
  { id: 'qa-dispatch-order-b', name: 'Orden B' },
  { id: 'qa-dispatch-order-c', name: 'Orden C', photo: true },
  { id: 'qa-dispatch-order-d', name: 'Orden D' },
  ...Array.from({ length: 24 }, (_, index) => ({
    id: `qa-dispatch-extra-${String(index).padStart(2, '0')}`,
    name: `QA extra ${String(index).padStart(2, '0')}`,
    photo: index === 10,
  })),
]

const env = await initializeTestEnvironment({
  projectId,
  firestore: {
    host: '127.0.0.1',
    port: 8085,
    rules: fs.readFileSync('firebase/firestore.rules', 'utf8'),
  },
})

try {
  await env.withSecurityRulesDisabled(async context => {
    const db = context.firestore()
    const photoDataUrl = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='2' height='1'%3E%3Crect width='2' height='1' fill='%23ddd'/%3E%3C/svg%3E"
    await Promise.all(products.map(async (product, index) => {
      await Promise.all([
        setDoc(doc(db, 'restaurants/sanjose/distProducts', product.id), {
          id: product.id,
          name: product.name,
          category: 'QA despacho',
          presentation: 'Prueba sintética',
          unitType: 'package',
          referencePrice: 1,
          active: true,
          sortOrder: index,
          restaurantId: 'sanjose',
          createdAt: new Date().toISOString(),
          ...(product.photo ? { photoDataUrl } : {}),
        }),
        setDoc(doc(db, 'restaurants/sanjose/distBalances', `central__${product.id}`), {
          id: `central__${product.id}`,
          locationKind: 'central',
          productId: product.id,
          productName: product.name,
          unitType: 'package',
          quantity: 100,
          restaurantId: 'sanjose',
          updatedAt: new Date().toISOString(),
        }),
      ])
    }))
  })
  console.log(`${products.length} productos y saldos sintéticos cargados solo en Firestore Emulator.`)
} finally {
  await env.cleanup()
}
