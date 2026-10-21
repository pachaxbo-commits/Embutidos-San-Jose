import { formatQrRecordDate } from '../qrRecordDate.ts'

const assert = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message)
}

const payment = formatQrRecordDate('2026-10-21T18:35:00.000Z')
assert(payment.text === '21/10/2026 · 14:35', `Bolivia timezone format: ${payment.text}`)
assert(payment.precision === 'date-time', 'an ISO timestamp has time precision')

const laterVerification = formatQrRecordDate('2026-10-21T22:05:00.000Z')
assert(laterVerification.text === '21/10/2026 · 18:05', 'verification timestamp can be displayed independently')

const legacyDate = formatQrRecordDate('', '2026-10-17')
assert(legacyDate.text === '17/10/2026' && legacyDate.precision === 'date', 'legacy dayKey is date-only')
const dateOnlyTimestamp = formatQrRecordDate('2026-10-21')
assert(dateOnlyTimestamp.text === '21/10/2026' && dateOnlyTimestamp.precision === 'date', 'date-only timestamp is preserved without inventing a time')

const partialTimestamp = formatQrRecordDate('2026-10-19T14:30:00')
assert(partialTimestamp.text === '19/10/2026' && partialTimestamp.precision === 'date', 'timezone-less historic timestamp must not invent an hour')

const firestoreTimestamp = formatQrRecordDate({ seconds: 1792607700, nanoseconds: 0 })
assert(firestoreTimestamp.text === '21/10/2026 · 14:35', `Firestore timestamp uses Bolivia: ${firestoreTimestamp.text}`)

const runtimeProcess = (globalThis as typeof globalThis & { process?: { env: Record<string, string | undefined> } }).process
const previousZone = runtimeProcess?.env.TZ
if (runtimeProcess) runtimeProcess.env.TZ = 'Pacific/Honolulu'
assert(formatQrRecordDate('2026-10-21T18:35:00.000Z').text === '21/10/2026 · 14:35', 'device timezone does not affect display')
if (runtimeProcess) {
  if (previousZone === undefined) delete runtimeProcess.env.TZ
  else runtimeProcess.env.TZ = previousZone
}

assert(formatQrRecordDate(undefined).precision === 'none', 'missing timestamps remain missing')
console.log('qrRecordDate: PASS')
