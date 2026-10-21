import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

process.env.FIRESTORE_EMULATOR_HOST ||= '127.0.0.1:8085'
const require = createRequire(new URL('../../functions/package.json', import.meta.url))
const { initializeApp } = require('firebase-admin/app')
const { getFirestore } = require('firebase-admin/firestore')
const { submitDiagnostic, listDiagnostics, updateDiagnostic } = require('./error-diagnostics.cjs')

const app = initializeApp({ projectId: 'demo-pachax-audit' }, `error-diagnostics-${Date.now()}`)
const db = getFirestore(app)
const root = db.doc('restaurants/sanjose')
const prefix = `diagnostic-${Date.now().toString(36)}`
const users = { admin: `${prefix}-admin`, support: `${prefix}-support`, warehouse: `${prefix}-warehouse`, distributor: `${prefix}-distributor` }
let checks = 0
const pass = (condition, label) => { assert.ok(condition, label); checks++; console.log('PASS', label) }

try {
  for (const [role, uid] of Object.entries(users)) await root.collection('members').doc(uid).set({ uid, role, active: true, displayName: `QA ${role}`, routeId: role === 'distributor' ? 'route-luciano' : '' })
  const report = {
    code: 'ERR-A1B2C3', occurredAt: new Date().toISOString(), appVersion: '1.4.49', build: 'test-build',
    browser: 'Chrome', operatingSystem: 'Android', view: 'dist.closure', source: 'react_render', category: 'render',
    errorName: 'TypeError', message: 'Falló Bs 41 en cliente=Nombre Juan teléfono=70012345 correo=juan@example.com',
    stack: 'at ClosureView (src/modules/distribution/views/ClosureView.tsx:10:3)', componentStack: 'at ClosureView',
    recentEvents: [{ at: new Date().toISOString(), stage: 'confirmation_received', status: 'closed', dispatchId: 'dispatch-QA', closureId: 'closure-QA', operationId: 'op-QA', operationStatus: 'confirmed' }],
    closureContext: { dispatchId: 'dispatch-QA', closureId: 'closure-QA', operationId: 'op-QA', dayKey: '2026-10-17', dispatchStatus: 'closed', closureStatus: 'closed', confirmation: 'confirmed' },
    financialAmount: 99999,
  }
  const request = { auth: { uid: users.distributor }, data: { report, occurrenceIdentity: { uid: users.distributor, restaurantId: 'sanjose' } } }
  const first = await submitDiagnostic(db, request)
  pass(first.accepted && !first.grouped, 'la Function acepta el reporte de la propia sesión y crea registro central')
  const stored = (await root.collection('distErrorDiagnostics').doc(first.reportId).get()).data()
  pass(stored.actorUid === users.distributor && stored.actorRole === 'distributor' && stored.actorRouteId === 'route-luciano', 'identidad, rol y ruta se derivan de la membresía autenticada')
  pass(!('financialAmount' in stored) && !stored.message.includes('example.com') && !stored.message.includes('70012345') && !stored.message.includes('Bs 41'), 'servidor aplica lista permitida y elimina correo, teléfono y montos')
  pass(stored.closureContext.dispatchId === 'dispatch-QA' && stored.recentEvents[0].operationStatus === 'confirmed', 'contexto técnico permite distinguir cierre confirmado del error visual')

  const grouped = await submitDiagnostic(db, { ...request, data: { ...request.data, report: { ...report, code: 'ERR-D4E5F6' } } })
  pass(grouped.grouped && (await root.collection('distErrorDiagnostics').doc(first.reportId).get()).data().occurrenceCount === 2, 'errores equivalentes quedan agrupados sin duplicar reportes')
  const retried = await submitDiagnostic(db, request)
  pass(retried.duplicateDelivery && (await root.collection('distErrorDiagnostics').doc(first.reportId).get()).data().occurrenceCount === 2, 'reintentar una entrega aceptada no incrementa ocurrencias')
  await assert.rejects(() => submitDiagnostic(db, { ...request, data: { ...request.data, occurrenceIdentity: { uid: users.admin, restaurantId: 'sanjose' } } }), { code: 'permission-denied' })
  await assert.rejects(() => submitDiagnostic(db, { ...request, data: { ...request.data, occurrenceIdentity: { uid: users.distributor, restaurantId: 'otro-tenant' } } }), { code: 'permission-denied' })
  await assert.rejects(() => submitDiagnostic(db, { ...request, auth: { uid: users.admin } }), { code: 'permission-denied' })
  pass(true, 'no se acepta suplantar identidad ni enviar un incidente como otro usuario')

  const adminList = await listDiagnostics(db, { auth: { uid: users.admin }, data: {} })
  const supportList = await listDiagnostics(db, { auth: { uid: users.support }, data: {} })
  pass(adminList.reports.some(item => item.id === first.reportId) && supportList.reports.some(item => item.id === first.reportId), 'Administración y Soporte pueden consultar los reportes globales')
  await assert.rejects(() => listDiagnostics(db, { auth: { uid: users.warehouse }, data: {} }), { code: 'permission-denied' })
  await assert.rejects(() => listDiagnostics(db, { auth: { uid: users.distributor }, data: {} }), { code: 'permission-denied' })
  const fixedTenantList = await listDiagnostics(db, { auth: { uid: users.admin }, data: { restaurantId: 'otro-tenant' } })
  assert.ok(fixedTenantList.reports.some(item => item.id === first.reportId), 'el callable siempre limita la consulta al tenant configurado; no acepta un tenant arbitrario')
  pass(true, 'warehouse, distribuidor y cruce de tenant no pueden consultar reportes globales')

  await root.collection('distDiagnosticRateLimits').doc(users.warehouse).set({ windowStartedAt: new Date().toISOString(), count: 20 })
  await assert.rejects(() => submitDiagnostic(db, {
    auth: { uid: users.warehouse },
    data: { report: { ...report, code: 'ERR-ABC123' }, occurrenceIdentity: { uid: users.warehouse, restaurantId: 'sanjose' } },
  }), { code: 'resource-exhausted' })
  pass(true, 'el límite horario también protege los reintentos/errores ya agrupados')

  await updateDiagnostic(db, { auth: { uid: users.support }, data: { reportId: first.reportId, reviewStatus: 'reviewing', internalNote: 'Se está revisando el cierre.' } })
  const updated = (await root.collection('distErrorDiagnostics').doc(first.reportId).get()).data()
  pass(updated.reviewStatus === 'reviewing' && updated.internalNote === 'Se está revisando el cierre.' && updated.reviewedBy === users.support, 'Soporte puede cambiar revisión y nota sin tocar datos operativos')
  await assert.rejects(() => updateDiagnostic(db, { auth: { uid: users.distributor }, data: { reportId: first.reportId, reviewStatus: 'resolved' } }), { code: 'permission-denied' })
  console.log(`${checks} verificaciones de diagnósticos aprobadas`)
} finally { await app.delete() }
