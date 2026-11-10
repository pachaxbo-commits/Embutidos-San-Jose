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
    await Promise.all(products
      .map(product => setDoc(doc(db, 'restaurants/sanjose/distLots', `qa-lot-${product.id}`), {
        id: `qa-lot-${product.id}`,
        productId: product.id,
        productName: product.name,
        lotCode: `QA-${product.name.replaceAll(' ', '-').toUpperCase()}`,
        unitType: 'package',
        manufacturedOn: '2026-10-01',
        expiresOn: '2026-12-01',
        quantities: { central: 100 },
        restaurantId: 'sanjose',
        createdAt: '2026-10-01T00:00:00.000Z',
        createdBy: 'dispatch-picker-test',
      })))
    await setDoc(doc(db, 'restaurants/sanjose/distLots', 'qa-lot-viena-3kg'), {
      id: 'qa-lot-viena-3kg',
      productId: 'gra-viena',
      productName: 'Salchicha tipo Viena',
      lotCode: 'VIENA-TEST-3KG',
      unitType: 'kg',
      manufacturedOn: '2026-10-01',
      expiresOn: '2026-12-01',
      quantities: { central: 3 },
      restaurantId: 'sanjose',
      createdAt: '2026-10-01T00:00:00.000Z',
      createdBy: 'dispatch-picker-test',
    })
  })
  console.log(`${products.length} productos, lotes para orden y un lote de 3 kg cargados solo en Firestore Emulator.`)
} finally {
  await env.cleanup()
}
