import { initializeTestEnvironment } from '@firebase/rules-unit-testing'
import { collection, doc, getDoc, getDocs } from 'firebase/firestore'

const operationId = process.argv[2]
if (!operationId || !/^[A-Za-z0-9_-]{8,120}$/.test(operationId)) throw new Error('operationId de Emulator inválido')
const env = await initializeTestEnvironment({ projectId: 'demo-pachax-audit', firestore: { host: '127.0.0.1', port: 8085 } })
try {
  let result
  await env.withSecurityRulesDisabled(async context => {
    const db = context.firestore()
    const [dispatches, operation] = await Promise.all([
      getDocs(collection(db, 'restaurants/sanjose/distDispatches')),
      getDoc(doc(db, 'restaurants/sanjose/distOperations', operationId)),
    ])
    result = { dispatchCount: dispatches.size, operation: operation.exists() ? operation.data() : null }
  })
  process.stdout.write(JSON.stringify(result))
} finally {
  await env.cleanup()
}
