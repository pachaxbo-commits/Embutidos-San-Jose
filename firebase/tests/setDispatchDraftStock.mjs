import { initializeTestEnvironment } from '@firebase/rules-unit-testing'
import { doc, setDoc } from 'firebase/firestore'
import fs from 'node:fs'

const productId = process.argv[2]
const quantity = Number(process.argv[3])
if (!/^qa-dispatch-extra-\d{2}$/.test(productId || '') || !Number.isFinite(quantity) || quantity < 0) {
  throw new Error('Fixture sintético inválido. Uso: node setDispatchDraftStock.mjs qa-dispatch-extra-00 0|100')
}

const env = await initializeTestEnvironment({
  projectId: 'demo-pachax-audit',
  firestore: { host: '127.0.0.1', port: 8085, rules: fs.readFileSync('firebase/firestore.rules', 'utf8') },
})

try {
  await env.withSecurityRulesDisabled(async context => {
    const db = context.firestore()
    const now = new Date().toISOString()
    await Promise.all([
      setDoc(doc(db, 'restaurants/sanjose/distBalances', `central__${productId}`), {
        id: `central__${productId}`, locationKind: 'central', productId,
        productName: 'Synthetic QA', unitType: 'package', quantity: quantity + 100,
        restaurantId: 'sanjose', updatedAt: now,
      }),
      setDoc(doc(db, 'restaurants/sanjose/distLots', `qa-lot-b-${productId}`), {
        id: `qa-lot-b-${productId}`, productId, productName: 'Synthetic QA',
        lotCode: `QA-B-${productId}`, unitType: 'package', manufacturedOn: '2026-10-02',
        expiresOn: '2026-12-02', quantities: { central: quantity },
        restaurantId: 'sanjose', createdAt: now, createdBy: 'dispatch-draft-qa',
      }),
    ])
  })
} finally {
  await env.cleanup()
}

console.log(`Synthetic emulator fixture ${productId} stock=${quantity}; no Production access.`)
