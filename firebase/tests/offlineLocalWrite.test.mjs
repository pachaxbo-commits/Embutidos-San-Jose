import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { collection, disableNetwork, doc, enableNetwork, getDocsFromServer, onSnapshot, setDoc } from 'firebase/firestore'
import { initializeTestEnvironment } from '@firebase/rules-unit-testing'

const host = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8085'
const [hostname, port] = host.split(':')
const environment = await initializeTestEnvironment({ projectId: 'demo-pachax-audit', firestore: { host: hostname, port: Number(port) } })

try {
  await environment.withSecurityRulesDisabled(async context => {
    const db = context.firestore()
    const operationId = `offline-write-${randomUUID()}`
    const ref = doc(db, 'restaurants', 'sanjose', 'distOperations', operationId)
    let stop = () => {}
    const localAcceptance = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Firestore no notificó la escritura local')), 2500)
      stop = onSnapshot(ref, { includeMetadataChanges: true }, snapshot => {
        if (!snapshot.exists() || !snapshot.metadata.hasPendingWrites) return
        clearTimeout(timeout)
        resolve(snapshot.data())
      }, reject)
    })

    await disableNetwork(db)
    const serverWrite = setDoc(ref, { id: operationId, restaurantId: 'sanjose', type: 'sale', status: 'queued', payload: {}, createdAt: new Date().toISOString() })
    const local = await localAcceptance
    assert.equal(local.status, 'queued')
    assert.equal(local.id, operationId)
    console.log('PASS: Firestore admite localmente la operación offline y el listener la ve como pendiente')

    await enableNetwork(db)
    await serverWrite
    const serverRows = await getDocsFromServer(collection(db, 'restaurants', 'sanjose', 'distOperations'))
    assert.equal(serverRows.docs.filter(row => row.id === operationId).length, 1)
    console.log('PASS: al reconectar se sincroniza el mismo operationId y existe una sola operación')
    stop()
  })
} finally {
  await environment.cleanup()
}
