const crypto = require('node:crypto')
const { HttpsError } = require('firebase-functions/v2/https')

const RESTAURANT_ID = 'sanjose'
const RESET_PHRASE = 'LIMPIAR EMBUTIDOS SAN JOSE'
const REQUEST_TTL_MS = 10 * 60 * 1000
const MAX_REAUTH_AGE_SECONDS = 5 * 60

// Registro central y autoritativo. React solo refleja estas reglas; el servidor
// vuelve a resolverlas y congela el alcance exacto antes de permitir el borrado.
const CLEANUP_GROUPS = {
  customers: { label: 'Clientes', collections: ['distCustomers', 'distCustomerIdentities'], dependencies: ['sales', 'credits', 'claims', 'qr'] },
  credits: { label: 'Créditos y cobros', collections: ['distReceivables', 'distCollections', 'distCreditStatus', 'distCreditOverrides', 'distReceivableAdjustments'], dependencies: ['qr'] },
  sales: { label: 'Ventas', collections: ['distSales', 'distSaleCorrections'], dependencies: ['credits', 'claims', 'qr'] },
  expenses: { label: 'Gastos', collections: ['distExpenses'], dependencies: [] },
  inventory: { label: 'Inventario operativo y lotes', collections: ['distBalances', 'distStockMovements', 'distLots', 'distLotHistory', 'distAdjustmentRequests'], dependencies: ['dispatches', 'sales'] },
  dispatches: { label: 'Despachos y transferencias', collections: ['distDispatches', 'distTransfers'], dependencies: ['closures', 'sales'] },
  closures: { label: 'Cierres y arqueos', collections: ['distClosures'], dependencies: [] },
  claims: { label: 'Cambios y devoluciones', collections: ['distClaims'], dependencies: ['qr'] },
  qr: { label: 'Verificaciones QR', collections: ['distQrVerifications'], dependencies: [] },
  technical: { label: 'Historial y operaciones técnicas', collections: ['distOperations', 'distWarehouseShifts'], dependencies: [] },
}

const GROUP_KEYS = Object.freeze(Object.keys(CLEANUP_GROUPS))
const RECOMMENDED_GROUPS = Object.freeze(GROUP_KEYS.filter(key => key !== 'customers'))
const PRESERVED = [
  'Usuarios y permisos', 'Catálogo y fotografías de productos', 'Rutas', 'Almacenes',
  'Configuración de empresa e impresión', 'Respaldos anteriores', 'Auditoría y solicitudes de mantenimiento',
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

function validateRequestedGroups(value) {
  if (!Array.isArray(value) || value.length === 0)
    throw new HttpsError('invalid-argument', 'Selecciona al menos un tipo de información para limpiar.')
  const groups = [...new Set(value.map(item => String(item)))]
  if (groups.some(key => !CLEANUP_GROUPS[key]))
    throw new HttpsError('invalid-argument', 'La selección contiene un grupo no permitido.')
  return groups
}

function resolveGroups(requestedGroups) {
  const resolved = new Set(requestedGroups)
  const reasons = {}
  const queue = [...requestedGroups]
  while (queue.length) {
    const parent = queue.shift()
    for (const dependency of CLEANUP_GROUPS[parent].dependencies) {
      if (!resolved.has(dependency)) { resolved.add(dependency); queue.push(dependency) }
      if (!requestedGroups.includes(dependency) && !reasons[dependency]) reasons[dependency] = parent
    }
  }
  return { resolvedGroups: GROUP_KEYS.filter(key => resolved.has(key)), dependencyReasons: reasons }
}

function emptyScope() {
  return Object.fromEntries([...new Set(GROUP_KEYS.flatMap(key => CLEANUP_GROUPS[key].collections))].map(name => [name, new Set()]))
}

function addWhere(rows, target, predicate) {
  let changed = false
  for (const row of rows) {
    if (predicate(row.data, row.id) && !target.has(row.id)) { target.add(row.id); changed = true }
  }
  return changed
}

async function loadOperationalRows(root) {
  const names = [...new Set(GROUP_KEYS.flatMap(key => CLEANUP_GROUPS[key].collections))]
  const entries = await Promise.all(names.map(async name => {
    const snapshot = await root.collection(name).get()
    return [name, snapshot.docs.map(doc => ({ id: doc.id, data: doc.data() }))]
  }))
  return Object.fromEntries(entries)
}

function resolveExactScope(rows, requestedGroups) {
  const { resolvedGroups, dependencyReasons } = resolveGroups(requestedGroups)
  const scope = emptyScope()
  for (const key of requestedGroups) {
    for (const collectionName of CLEANUP_GROUPS[key].collections) {
      for (const row of rows[collectionName]) scope[collectionName].add(row.id)
    }
  }
  // Reiniciar existencias sin retirar despachos/ventas activas dejaría lotes y
  // asignaciones operativas rotas. En este único caso la dependencia es amplia.
  if (requestedGroups.includes('inventory')) {
    for (const key of ['dispatches', 'sales']) {
      for (const collectionName of CLEANUP_GROUPS[key].collections) {
        for (const row of rows[collectionName]) scope[collectionName].add(row.id)
      }
    }
  }

  let changed = true
  while (changed) {
    changed = false
    const customerIds = scope.distCustomers
    const saleIds = scope.distSales
    const receivableIds = scope.distReceivables
    const collectionIds = scope.distCollections
    const dispatchIds = scope.distDispatches
    const claimIds = scope.distClaims
    if (customerIds.size) {
      changed = addWhere(rows.distCustomerIdentities, scope.distCustomerIdentities, data => customerIds.has(data.customerId)) || changed
      changed = addWhere(rows.distSales, saleIds, data => customerIds.has(data.customerId)) || changed
      changed = addWhere(rows.distReceivables, receivableIds, data => customerIds.has(data.customerId)) || changed
      changed = addWhere(rows.distCollections, collectionIds, data => customerIds.has(data.customerId)) || changed
      changed = addWhere(rows.distCreditStatus, scope.distCreditStatus, (data, id) => customerIds.has(data.customerId || id)) || changed
      changed = addWhere(rows.distCreditOverrides, scope.distCreditOverrides, (data, id) => customerIds.has(data.customerId || id)) || changed
      changed = addWhere(rows.distClaims, claimIds, data => customerIds.has(data.customerId)) || changed
    }
    if (dispatchIds.size) {
      changed = addWhere(rows.distClosures, scope.distClosures, data => dispatchIds.has(data.dispatchId)) || changed
      changed = addWhere(rows.distSales, saleIds, data => dispatchIds.has(data.dispatchId)) || changed
    }
    if (saleIds.size) {
      changed = addWhere(rows.distSaleCorrections, scope.distSaleCorrections, data => saleIds.has(data.saleId)) || changed
      changed = addWhere(rows.distReceivables, receivableIds, (data, id) => saleIds.has(data.saleId || id)) || changed
      changed = addWhere(rows.distClaims, claimIds, data => saleIds.has(data.saleId)) || changed
      changed = addWhere(rows.distQrVerifications, scope.distQrVerifications, data => data.sourceType === 'sale' && saleIds.has(data.sourceId)) || changed
    }
    if (receivableIds.size) {
      changed = addWhere(rows.distCollections, collectionIds, data => receivableIds.has(data.receivableId) || (Array.isArray(data.allocations) && data.allocations.some(item => receivableIds.has(item.receivableId)))) || changed
      const affectedCustomers = new Set(rows.distReceivables.filter(row => receivableIds.has(row.id)).map(row => row.data.customerId).filter(Boolean))
      changed = addWhere(rows.distCreditStatus, scope.distCreditStatus, (data, id) => affectedCustomers.has(data.customerId || id)) || changed
    }
    if (collectionIds.size) {
      changed = addWhere(rows.distQrVerifications, scope.distQrVerifications, data => data.sourceType === 'collection' && collectionIds.has(data.sourceId)) || changed
      const linkedReceivables = new Set()
      for (const row of rows.distCollections.filter(item => collectionIds.has(item.id))) {
        if (row.data.receivableId) linkedReceivables.add(row.data.receivableId)
        for (const allocation of Array.isArray(row.data.allocations) ? row.data.allocations : []) if (allocation.receivableId) linkedReceivables.add(allocation.receivableId)
      }
      changed = addWhere(rows.distReceivables, receivableIds, (_data, id) => linkedReceivables.has(id)) || changed
    }
    if (claimIds.size) changed = addWhere(rows.distQrVerifications, scope.distQrVerifications, data => data.sourceType === 'claim' && claimIds.has(data.sourceId)) || changed
  }
  const exactScope = Object.fromEntries(Object.entries(scope).filter(([, ids]) => ids.size).map(([name, ids]) => [name, [...ids].sort()]))
  const counts = Object.fromEntries(Object.entries(exactScope).map(([name, ids]) => [name, ids.length]))
  return { resolvedGroups, dependencyReasons, exactScope, counts }
}

async function commitChunks(db, operations) {
  for (let offset = 0; offset < operations.length; offset += 350) {
    const batch = db.batch()
    for (const operation of operations.slice(offset, offset + 350)) operation(batch)
    await batch.commit()
  }
}

async function storeExactScope(requestRef, exactScope) {
  const operations = []
  for (const [collectionName, documentIds] of Object.entries(exactScope)) {
    for (let offset = 0; offset < documentIds.length; offset += 500) {
      const ref = requestRef.collection('scope').doc(`${collectionName}__${String(offset / 500).padStart(4, '0')}`)
      operations.push(batch => batch.set(ref, { collectionName, documentIds: documentIds.slice(offset, offset + 500) }))
    }
  }
  await commitChunks(requestRef.firestore, operations)
}

async function readExactScope(requestRef) {
  const snapshot = await requestRef.collection('scope').get()
  const allowed = new Set(GROUP_KEYS.flatMap(key => CLEANUP_GROUPS[key].collections))
  const scope = {}
  for (const row of snapshot.docs) {
    const data = row.data()
    if (!allowed.has(data.collectionName) || !Array.isArray(data.documentIds))
      throw new HttpsError('failed-precondition', 'El alcance guardado de la vista previa no es válido.')
    scope[data.collectionName] = [...(scope[data.collectionName] || []), ...data.documentIds.map(String)]
  }
  return scope
}

async function prepareCleanDelivery(db, request) {
  const actor = await getActor(db, request)
  const selectedGroups = validateRequestedGroups(request.data?.selectedGroups)
  const rows = await loadOperationalRows(actor.root)
  const { resolvedGroups, dependencyReasons, exactScope, counts } = resolveExactScope(rows, selectedGroups)
  const requestId = `reset_${crypto.randomUUID()}`
  const expiresAt = new Date(Date.now() + REQUEST_TTL_MS).toISOString()
  const requestRef = actor.root.collection('maintenanceResetRequests').doc(requestId)
  const totalDocuments = Object.values(counts).reduce((sum, value) => sum + value, 0)
  const preservedGroups = GROUP_KEYS.filter(key => !resolvedGroups.includes(key))
  await requestRef.set({ id: requestId, actorUid: actor.uid, actorRole: actor.member.role, createdAt: new Date().toISOString(), expiresAt, status: 'previewed', selectedGroups, resolvedGroups, dependencyReasons, counts, totalDocuments, preservedGroups, preserved: PRESERVED })
  await storeExactScope(requestRef, exactScope)
  return { requestId, expiresAt, selectedGroups, resolvedGroups, dependencyReasons, counts, totalDocuments, preservedGroups, preserved: PRESERVED }
}

async function backupExactScope(db, root, backupRef, exactScope, hooks = {}) {
  let total = 0
  for (const [collectionName, documentIds] of Object.entries(exactScope)) {
    for (let offset = 0; offset < documentIds.length; offset += 350) {
      const refs = documentIds.slice(offset, offset + 350).map(id => root.collection(collectionName).doc(id))
      const snapshots = refs.length ? await db.getAll(...refs) : []
      const writes = snapshots.filter(source => source.exists).map(source => batch => {
        const key = Buffer.from(`${collectionName}/${source.id}`).toString('base64url')
        batch.set(backupRef.collection('documents').doc(key), { collectionName, documentId: source.id, data: source.data() })
      })
      await commitChunks(db, writes)
      total += writes.length
    }
  }
  if (hooks.afterBackup) await hooks.afterBackup()
  return total
}

async function deleteExactScope(db, root, exactScope) {
  const deletedByCollection = {}
  for (const [collectionName, documentIds] of Object.entries(exactScope)) {
    let deleted = 0
    for (let offset = 0; offset < documentIds.length; offset += 350) {
      const refs = documentIds.slice(offset, offset + 350).map(id => root.collection(collectionName).doc(id))
      const snapshots = refs.length ? await db.getAll(...refs) : []
      const existing = snapshots.filter(source => source.exists)
      await commitChunks(db, existing.map(source => batch => batch.delete(source.ref)))
      deleted += existing.length
    }
    deletedByCollection[collectionName] = deleted
  }
  return { deletedByCollection, deletedDocuments: Object.values(deletedByCollection).reduce((sum, value) => sum + value, 0) }
}

async function affectedCreditCustomers(db, root, exactScope) {
  const ids = exactScope.distReceivables || []
  const customers = new Set()
  for (let offset = 0; offset < ids.length; offset += 350) {
    const rows = await db.getAll(...ids.slice(offset, offset + 350).map(id => root.collection('distReceivables').doc(id)))
    for (const row of rows) if (row.exists && row.data().customerId) customers.add(row.data().customerId)
  }
  return [...customers]
}

async function rebuildCreditStatus(db, root, customerIds) {
  for (const customerId of customerIds) {
    if (!(await root.collection('distCustomers').doc(customerId).get()).exists) continue
    const rows = await root.collection('distReceivables').where('customerId', '==', customerId).get()
    const dates = rows.docs.map(row => row.data()).filter(row => Number(row.balance) > 0).map(row => row.createdAt).filter(Boolean).sort()
    await root.collection('distCreditStatus').doc(customerId).set({ id: customerId, restaurantId: RESTAURANT_ID, oldestPendingAt: dates[0] || null, checkedAt: new Date().toISOString() })
  }
}

async function executeCleanDelivery(db, request, hooks = {}) {
  const actor = await getActor(db, request)
  if (request.data?.phrase !== RESET_PHRASE || request.data?.acknowledgement !== true) throw new HttpsError('invalid-argument', 'La frase y la confirmación no coinciden.')
  const authTime = Number(request.auth.token.auth_time || 0)
  if (!authTime || Math.floor(Date.now() / 1000) - authTime > MAX_REAUTH_AGE_SECONDS) throw new HttpsError('failed-precondition', 'Vuelve a escribir tu contraseña para confirmar tu identidad.')
  const requestId = String(request.data?.requestId || '')
  const requestRef = actor.root.collection('maintenanceResetRequests').doc(requestId)
  const requestSnapshot = await requestRef.get()
  const resetRequest = requestSnapshot.data()
  if (!requestSnapshot.exists || resetRequest.actorUid !== actor.uid || resetRequest.status !== 'previewed') throw new HttpsError('failed-precondition', 'La vista previa ya no es válida. Vuelve a calcularla.')
  if (Date.parse(resetRequest.expiresAt) < Date.now()) throw new HttpsError('deadline-exceeded', 'La vista previa venció. Vuelve a calcularla.')
  await db.runTransaction(async transaction => {
    const fresh = await transaction.get(requestRef)
    if (fresh.data()?.status !== 'previewed') throw new HttpsError('already-exists', 'Esta limpieza ya fue iniciada.')
    transaction.update(requestRef, { status: 'executing', startedAt: new Date().toISOString() })
  })
  const exactScope = await readExactScope(requestRef)
  const creditCustomers = await affectedCreditCustomers(db, actor.root, exactScope)
  const backupId = `backup_${new Date().toISOString().replace(/[-:.TZ]/g, '')}_${crypto.randomUUID().slice(0, 8)}`
  const backupRef = actor.root.collection('maintenanceBackups').doc(backupId)
  const stateRef = actor.root.collection('maintenanceState').doc('reset')
  await stateRef.set({ active: true, resetId: requestId, startedAt: new Date().toISOString() })
  try {
    await backupRef.set({ id: backupId, restaurantId: RESTAURANT_ID, createdAt: new Date().toISOString(), createdBy: actor.uid, createdByRole: actor.member.role, status: 'creating', selectedGroups: resetRequest.selectedGroups, resolvedGroups: resetRequest.resolvedGroups, collections: Object.keys(exactScope), counts: resetRequest.counts, preservedGroups: resetRequest.preservedGroups, preserved: PRESERVED })
    const backedUp = await backupExactScope(db, actor.root, backupRef, exactScope, hooks)
    await backupRef.update({ status: 'complete', documentCount: backedUp, completedAt: new Date().toISOString() })
    const { deletedByCollection, deletedDocuments } = await deleteExactScope(db, actor.root, exactScope)
    await rebuildCreditStatus(db, actor.root, creditCustomers)
    const completedAt = new Date().toISOString()
    const customersPreserved = (await actor.root.collection('distCustomers').get()).size
    await Promise.all([
      requestRef.update({ status: 'completed', backupId, backedUpDocuments: backedUp, deletedDocuments, deletedByCollection, completedAt }),
      actor.root.collection('maintenanceAudit').doc(requestId).set({ id: requestId, action: 'selective_clean_delivery', actorUid: actor.uid, actorRole: actor.member.role, backupId, selectedGroups: resetRequest.selectedGroups, resolvedGroups: resetRequest.resolvedGroups, automaticDependencies: resetRequest.dependencyReasons || {}, backedUpDocuments: backedUp, deletedDocuments, deletedByCollection, preservedGroups: resetRequest.preservedGroups, preserved: PRESERVED, customersPreserved, createdAt: completedAt }),
      actor.root.collection('supportConfig').doc('main').set({ lastResetAt: completedAt, lastResetBy: actor.uid }, { merge: true }),
    ])
    return { resetId: requestId, backupId, backedUpDocuments: backedUp, deletedDocuments, deletedByCollection, customersPreserved, completedAt }
  } catch (error) {
    await requestRef.set({ status: 'failed', error: String(error?.message || error), failedAt: new Date().toISOString() }, { merge: true })
    throw error
  } finally {
    await stateRef.set({ active: false, finishedAt: new Date().toISOString() }, { merge: true })
  }
}

module.exports = { CLEANUP_GROUPS, GROUP_KEYS, RECOMMENDED_GROUPS, RESET_PHRASE, resolveGroups, resolveExactScope, prepareCleanDelivery, executeCleanDelivery }
