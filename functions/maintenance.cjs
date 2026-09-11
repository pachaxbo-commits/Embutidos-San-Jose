const crypto = require('node:crypto')
const { HttpsError } = require('firebase-functions/v2/https')

const RESTAURANT_ID = 'sanjose'
const RESET_PHRASE = 'LIMPIAR EMBUTIDOS SAN JOSE'
const REQUEST_TTL_MS = 10 * 60 * 1000
const MAX_REAUTH_AGE_SECONDS = 5 * 60

// La función nunca devuelve documentos comerciales: la vista previa expone solo conteos.

const RESET_COLLECTIONS = [
  'distCustomers', 'distCustomerIdentities', 'distBalances', 'distStockMovements',
  'distTransfers', 'distDispatches', 'distSales', 'distReceivables', 'distCollections',
  'distExpenses', 'distClosures', 'distQrVerifications', 'distLots', 'distLotHistory',
  'distClaims', 'distCreditStatus', 'distOperations',
]

const PRESERVED = [
  'Usuarios y permisos', 'Catálogo y fotografías de productos', 'Rutas',
  'Almacenes', 'Configuración de empresa e impresión',
]

async function getActor(db, request) {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Inicia sesión para continuar.')
  const root = db.collection('restaurants').doc(RESTAURANT_ID)
  const member = await root.collection('members').doc(request.auth.uid).get()
  const data = member.data()
  if (!member.exists || data.active !== true || !['admin', 'support'].includes(data.role))
    throw new HttpsError('permission-denied', 'Solo Administración o Soporte técnico pueden preparar la entrega limpia.')
  return { root, member: data, uid: request.auth.uid }
}

async function countResetDocuments(root) {
  const entries = await Promise.all(RESET_COLLECTIONS.map(async name => [name, (await root.collection(name).get()).size]))
  return Object.fromEntries(entries)
}

async function prepareCleanDelivery(db, request) {
  const actor = await getActor(db, request)
  const counts = await countResetDocuments(actor.root)
  const requestId = `reset_${crypto.randomUUID()}`
  const expiresAt = new Date(Date.now() + REQUEST_TTL_MS).toISOString()
  await actor.root.collection('maintenanceResetRequests').doc(requestId).set({
    id: requestId,
    actorUid: actor.uid,
    actorRole: actor.member.role,
    createdAt: new Date().toISOString(),
    expiresAt,
    status: 'previewed',
    counts,
  })
  return { requestId, expiresAt, counts, totalDocuments: Object.values(counts).reduce((sum, value) => sum + value, 0), preserved: PRESERVED }
}

async function commitChunks(db, operations) {
  for (let offset = 0; offset < operations.length; offset += 350) {
    const batch = db.batch()
    for (const operation of operations.slice(offset, offset + 350)) operation(batch)
    await batch.commit()
  }
}

async function backupCollections(db, root, backupRef) {
  let total = 0
  for (const collectionName of RESET_COLLECTIONS) {
    const snapshot = await root.collection(collectionName).get()
    const writes = snapshot.docs.map(source => batch => {
      const key = Buffer.from(`${collectionName}/${source.id}`).toString('base64url')
      batch.set(backupRef.collection('documents').doc(key), {
        collectionName,
        documentId: source.id,
        data: source.data(),
      })
    })
    await commitChunks(db, writes)
    total += snapshot.size
  }
  return total
}

async function deleteResetCollections(db, root) {
  let deleted = 0
  for (const collectionName of RESET_COLLECTIONS) {
    while (true) {
      const snapshot = await root.collection(collectionName).limit(350).get()
      if (snapshot.empty) break
      await commitChunks(db, snapshot.docs.map(source => batch => batch.delete(source.ref)))
      deleted += snapshot.size
    }
  }
  return deleted
}

async function executeCleanDelivery(db, request) {
  const actor = await getActor(db, request)
  if (request.data?.phrase !== RESET_PHRASE || request.data?.acknowledgement !== true)
    throw new HttpsError('invalid-argument', 'La frase y la confirmación no coinciden.')
  const authTime = Number(request.auth.token.auth_time || 0)
  if (!authTime || Math.floor(Date.now() / 1000) - authTime > MAX_REAUTH_AGE_SECONDS)
    throw new HttpsError('failed-precondition', 'Vuelve a escribir tu contraseña para confirmar tu identidad.')

  const requestId = String(request.data?.requestId || '')
  const requestRef = actor.root.collection('maintenanceResetRequests').doc(requestId)
  const requestSnapshot = await requestRef.get()
  const resetRequest = requestSnapshot.data()
  if (!requestSnapshot.exists || resetRequest.actorUid !== actor.uid || resetRequest.status !== 'previewed')
    throw new HttpsError('failed-precondition', 'La vista previa ya no es válida. Vuelve a calcularla.')
  if (Date.parse(resetRequest.expiresAt) < Date.now())
    throw new HttpsError('deadline-exceeded', 'La vista previa venció. Vuelve a calcularla.')

  await db.runTransaction(async transaction => {
    const fresh = await transaction.get(requestRef)
    if (fresh.data()?.status !== 'previewed') throw new HttpsError('already-exists', 'Esta limpieza ya fue iniciada.')
    transaction.update(requestRef, { status: 'executing', startedAt: new Date().toISOString() })
  })

  const backupId = `backup_${new Date().toISOString().replace(/[-:.TZ]/g, '')}_${crypto.randomUUID().slice(0, 8)}`
  const backupRef = actor.root.collection('maintenanceBackups').doc(backupId)
  const stateRef = actor.root.collection('maintenanceState').doc('reset')
  await stateRef.set({ active: true, resetId: requestId, startedAt: new Date().toISOString() })
  try {
    await backupRef.set({
      id: backupId, restaurantId: RESTAURANT_ID, createdAt: new Date().toISOString(),
      createdBy: actor.uid, createdByRole: actor.member.role, status: 'creating',
      counts: resetRequest.counts, preserved: PRESERVED,
    })
    const backedUp = await backupCollections(db, actor.root, backupRef)
    await backupRef.update({ status: 'complete', documentCount: backedUp, completedAt: new Date().toISOString() })
    const deletedDocuments = await deleteResetCollections(db, actor.root)
    const completedAt = new Date().toISOString()
    await Promise.all([
      requestRef.update({ status: 'completed', backupId, deletedDocuments, completedAt }),
      actor.root.collection('maintenanceAudit').doc(requestId).set({
        id: requestId, action: 'clean_delivery', actorUid: actor.uid, actorRole: actor.member.role,
        backupId, deletedDocuments, createdAt: completedAt,
      }),
      actor.root.collection('supportConfig').doc('main').set({ lastResetAt: completedAt, lastResetBy: actor.uid }, { merge: true }),
    ])
    return { resetId: requestId, backupId, deletedDocuments, completedAt }
  } catch (error) {
    await requestRef.set({ status: 'failed', error: String(error?.message || error), failedAt: new Date().toISOString() }, { merge: true })
    throw error
  } finally {
    await stateRef.set({ active: false, finishedAt: new Date().toISOString() }, { merge: true })
  }
}

module.exports = { RESET_COLLECTIONS, RESET_PHRASE, prepareCleanDelivery, executeCleanDelivery }
