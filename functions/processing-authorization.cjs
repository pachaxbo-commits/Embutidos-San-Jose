const { randomUUID } = require('node:crypto');

const MAX_AUTHORIZATION_DAYS = 90;

function validateRequest(request) {
  if (!request.auth?.uid) throw Object.assign(new Error('Debes iniciar sesión.'), { code: 'unauthenticated' });
  if (request.auth.token?.processingQualityGrantAuthority !== true) throw Object.assign(new Error('No tienes autoridad privilegiada para administrar permisos de calidad.'), { code: 'permission-denied' });
  const data = request.data || {};
  if (!['grant', 'revoke'].includes(data.action)) throw Object.assign(new Error('La acción de autorización no es válida.'), { code: 'invalid-argument' });
  const beneficiaryUid = String(data.beneficiaryUid || '').trim();
  const reason = String(data.reason || '').trim();
  if (!beneficiaryUid || beneficiaryUid.length > 128 || reason.length < 5 || reason.length > 500) throw Object.assign(new Error('Indica beneficiario y motivo (5 a 500 caracteres).'), { code: 'invalid-argument' });
  if (beneficiaryUid === request.auth.uid) throw Object.assign(new Error('No puedes concederte autorización de calidad a ti mismo.'), { code: 'permission-denied' });
  let expiresAt;
  if (data.action === 'grant') {
    const days = Number(data.validDays);
    if (!Number.isInteger(days) || days < 1 || days > MAX_AUTHORIZATION_DAYS) throw Object.assign(new Error(`La vigencia debe ser de 1 a ${MAX_AUTHORIZATION_DAYS} días.`), { code: 'invalid-argument' });
    expiresAt = new Date(Date.now() + days * 86400000).toISOString();
  }
  return { action: data.action, beneficiaryUid, reason, expiresAt };
}

async function manageProcessingQualityAuthorization(db, request) {
  const input = validateRequest(request);
  const root = db.doc('restaurants/sanjose');
  const actorUid = request.auth.uid;
  const at = new Date().toISOString();
  const eventId = randomUUID();
  return db.runTransaction(async tx => {
    const grantorRef = root.collection('members').doc(actorUid);
    const memberRef = root.collection('members').doc(input.beneficiaryUid);
    const authorizationRef = root.collection('distProcessingQualityAuthorizations').doc(input.beneficiaryUid);
    const grantorSnap = await tx.get(grantorRef);
    const memberSnap = await tx.get(memberRef);
    const authSnap = await tx.get(authorizationRef);
    if (!grantorSnap.exists || grantorSnap.data().active !== true || grantorSnap.data().role !== 'admin') throw Object.assign(new Error('La autoridad concedente debe ser una cuenta administrativa activa de San José.'), { code: 'permission-denied' });
    if (!memberSnap.exists || memberSnap.data().active !== true || memberSnap.data().role !== 'admin') throw Object.assign(new Error('La autorización solo puede concederse a una cuenta activa de Administración.'), { code: 'failed-precondition' });
    const previous = authSnap.exists ? authSnap.data() : null;
    if (input.action === 'grant') {
      if (previous?.status === 'active' && Date.parse(previous.expiresAt || '') > Date.now()) throw Object.assign(new Error('Esta cuenta ya tiene una autorización de calidad vigente; revócala antes de renovarla.'), { code: 'already-exists' });
      const authorizationId = `quality_${eventId}`;
      const next = { id: authorizationId, authorizationId, restaurantId: 'sanjose', status: 'active', beneficiaryUid: input.beneficiaryUid, grantedBy: actorUid, grantedAt: at, grantReason: input.reason, expiresAt: input.expiresAt, revokedAt: null, revokedBy: null, revokeReason: null, schemaVersion: 1 };
      tx.set(authorizationRef, next);
      tx.create(root.collection('distProcessingQualityAuthorizationEvents').doc(eventId), { id: eventId, restaurantId: 'sanjose', event: 'granted', authorizationId, beneficiaryUid: input.beneficiaryUid, actorUid, reason: input.reason, at, expiresAt: input.expiresAt, schemaVersion: 1 });
      return { authorizationId, beneficiaryUid: input.beneficiaryUid, status: 'active', expiresAt: input.expiresAt };
    }
    if (!previous || previous.status !== 'active') throw Object.assign(new Error('No existe una autorización de calidad activa para revocar.'), { code: 'failed-precondition' });
    const next = { ...previous, status: 'revoked', revokedAt: at, revokedBy: actorUid, revokeReason: input.reason };
    tx.set(authorizationRef, next);
    tx.create(root.collection('distProcessingQualityAuthorizationEvents').doc(eventId), { id: eventId, restaurantId: 'sanjose', event: 'revoked', authorizationId: previous.id, beneficiaryUid: input.beneficiaryUid, actorUid, reason: input.reason, at, previousGrantorUid: previous.grantedBy, previousGrantedAt: previous.grantedAt, schemaVersion: 1 });
    return { authorizationId: previous.id, beneficiaryUid: input.beneficiaryUid, status: 'revoked', revokedAt: at };
  });
}

module.exports = { MAX_AUTHORIZATION_DAYS, manageProcessingQualityAuthorization, validateRequest };
