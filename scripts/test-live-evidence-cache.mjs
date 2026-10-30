import assert from 'node:assert/strict'
import { createLiveEvidenceCache } from '../src/modules/distribution/data/liveEvidenceCache.ts'

const callbacks = new Map()
let reads = 0
let stopped = 0
let updates = 0
const cache = createLiveEvidenceCache((id, next, error) => {
  reads++
  callbacks.set(id, { next, error })
  return () => { stopped++ }
}, () => { updates++ })
const initial = cache.get('sale-correction')
callbacks.get('sale-correction').next(8)
assert.equal(await initial, 8)
for (let metadataEmission = 0; metadataEmission < 100; metadataEmission++) assert.equal(await cache.get('sale-correction'), 8)
assert.equal(reads, 1, '100 metadata emissions reuse one live reference instead of 101 explicit reads')
callbacks.get('sale-correction').next(9)
assert.equal(await cache.get('sale-correction'), 9, 'evidence changes invalidate the previous value')
callbacks.get('sale-correction').next(undefined)
assert.equal(await cache.get('sale-correction'), undefined, 'deleted evidence must not retain a receipt')
callbacks.get('sale-correction').error(new Error('permission denied'))
await assert.rejects(cache.get('sale-correction'), /permission denied/)
callbacks.get('sale-correction').next(7)
assert.equal(await cache.get('sale-correction'), 7, 'recovered listener replaces the error')
cache.retain(new Set())
assert.equal(stopped, 1)
const again = cache.get('sale-correction')
callbacks.get('sale-correction').next(6)
assert.equal(await again, 6)
assert.equal(reads, 2, 're-entering the scope obtains fresh server evidence')
cache.dispose()
assert.equal(stopped, 2)
assert.equal(updates, 4)
console.log('PASS: live evidence, metadata reuse, updates, deletion, permission failure, recovery and disposal; 101 -> 1 subscriptions/read initializations')
