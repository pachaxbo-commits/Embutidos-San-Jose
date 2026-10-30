const { getStorage } = require('firebase-admin/storage');
const { createHash } = require('node:crypto');

const sha256Pattern = /^[a-f0-9]{64}$/i;
const emulator = () => process.env.FUNCTIONS_EMULATOR === 'true' && /^(localhost|127\.0\.0\.1):\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST || '');

async function activeQualityAuthorization(operation, authorizationId, beneficiaryUid = operation.actor) {
  const row = await operation.read('distProcessingQualityAuthorizations', beneficiaryUid);
  const expiry = typeof row?.expiresAt === 'string' ? Date.parse(row.expiresAt) : NaN;
  // Operation.read() intentionally normalizes `id` to the Firestore document ID
  // (the beneficiary UID). The opaque authorization ID therefore has its own field.
  if (!row || row.restaurantId !== 'sanjose' || row.status !== 'active' || row.beneficiaryUid !== beneficiaryUid || row.authorizationId !== authorizationId || !row.grantedBy || row.grantedBy === beneficiaryUid || !Number.isFinite(expiry) || expiry <= Date.now()) return null;
  return { ...row, id: row.authorizationId };
}

async function verifyProcessingEvidence(operation, evidenceRefs, expected) {
  if (!Array.isArray(evidenceRefs) || evidenceRefs.length === 0 || evidenceRefs.length > 10) return null;
  const rows = [];
  const unique = new Set();
  for (const rawId of evidenceRefs) {
    if (typeof rawId !== 'string' || !rawId.trim() || unique.has(rawId.trim())) return null;
    const id = rawId.trim(); unique.add(id);
    const row = await operation.read('distProcessingEvidence', id);
    if (!row || row.id !== id || row.status !== 'verified' || row.restaurantId !== 'sanjose'
      || row.lotId !== expected.lotId || row.reservationId !== expected.reservationId
      || row.reviewCaseId !== expected.reviewCaseId || row.location !== expected.location
      || row.reviewRevision !== expected.reviewRevision
      || !row.uploadedBy || !row.recordedAt || !row.evidenceType || !row.objectPath
      || !row.objectGeneration || !sha256Pattern.test(String(row.sha256 || ''))
      || !Number.isSafeInteger(row.byteSize) || row.byteSize <= 0 || row.byteSize > 15 * 1024 * 1024
      || !['image/jpeg','image/png','application/pdf'].includes(row.contentType)
      || !['photo','measurement_record','signed_quality_record'].includes(row.evidenceType)
      || !Number.isFinite(Date.parse(row.recordedAt))
      || row.viewers?.includes(operation.actor) !== true && operation.member.role !== 'admin') return null;
    const uploader = await operation.read('members', row.uploadedBy);
    const uploaderOwnsLocation = uploader?.role === 'warehouse'
      && (expected.location === 'central' ? !uploader.warehouseId || uploader.warehouseId === 'central' : expected.location === `warehouse__${uploader.warehouseId}`);
    if (!uploader || uploader.active !== true || (uploader.role !== 'admin' && !uploaderOwnsLocation)) return null;
    if (emulator() && row.verificationMethod === 'emulator_fixture') {
      if (row.objectExists !== true || !/^processing-evidence\/sanjose\/[A-Za-z0-9/_.-]+$/.test(row.objectPath) || row.objectPath.includes('..')) return null;
    } else {
      const bucketName = emulator() ? row.bucket : process.env.SANJOSE_PROCESSING_EVIDENCE_BUCKET;
      if (!bucketName || row.bucket !== bucketName || !/^processing-evidence\/sanjose\/[A-Za-z0-9/_.-]+$/.test(row.objectPath) || row.objectPath.includes('..')) return null;
      try {
        const file = getStorage().bucket(bucketName).file(row.objectPath, { generation: String(row.objectGeneration) });
        const [metadata] = await file.getMetadata();
        if (String(metadata.generation) !== String(row.objectGeneration)
          || String(metadata.metadata?.sha256 || '').toLowerCase() !== String(row.sha256).toLowerCase()
          || metadata.metadata?.restaurantId !== 'sanjose'
          || metadata.metadata?.lotId !== expected.lotId
          || metadata.metadata?.reservationId !== expected.reservationId
          || metadata.metadata?.reviewCaseId !== expected.reviewCaseId
          || Number(metadata.metadata?.reviewRevision) !== expected.reviewRevision
          || metadata.metadata?.location !== expected.location
          || metadata.contentType !== row.contentType || Number(metadata.size) !== row.byteSize) return null;
        const [content] = await file.download();
        if (content.length !== row.byteSize || createHash('sha256').update(content).digest('hex') !== String(row.sha256).toLowerCase()) return null;
      } catch {
        return null;
      }
    }
    rows.push(row);
  }
  return rows;
}

async function verifyProcessingEvidenceObject(bucketName, objectPath, expected, uploadedBy) {
  if (!bucketName || typeof objectPath !== 'string' || !objectPath.startsWith('processing-evidence/sanjose/') || objectPath.includes('..')) return null;
  try {
    const file = getStorage().bucket(bucketName).file(objectPath);
    const [metadata] = await file.getMetadata();
    const custom = metadata.metadata || {};
    const byteSize = Number(metadata.size);
    const contentType = metadata.contentType;
    if (!metadata.generation || custom.restaurantId !== 'sanjose' || custom.lotId !== expected.lotId
      || custom.reservationId !== expected.reservationId || custom.reviewCaseId !== expected.reviewCaseId
      || Number(custom.reviewRevision) !== expected.reviewRevision || custom.location !== expected.location
      || custom.uploadedBy !== uploadedBy || custom.evidenceType !== expected.evidenceType
      || !sha256Pattern.test(String(custom.sha256 || '')) || !Number.isSafeInteger(byteSize) || byteSize <= 0 || byteSize > 15 * 1024 * 1024
      || !['image/jpeg','image/png','application/pdf'].includes(contentType)) return null;
    const [content] = await file.download();
    const sha256 = createHash('sha256').update(content).digest('hex');
    if (content.length !== byteSize || sha256 !== String(custom.sha256).toLowerCase()) return null;
    return { bucket: bucketName, objectPath, objectGeneration: String(metadata.generation), sha256, byteSize, contentType };
  } catch { return null; }
}

module.exports = { activeQualityAuthorization, verifyProcessingEvidence, verifyProcessingEvidenceObject, isProcessingRepackEmulator: emulator };
