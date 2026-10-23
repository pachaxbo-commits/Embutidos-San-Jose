// Pure accounting-maintenance primitives. No targets, credentials or I/O.
const { createHash } = require('node:crypto');
const stable = value => Array.isArray(value) ? value.map(stable) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])])) : value;
const fingerprint = value => createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
const q = value => Math.round((Number(value) + Number.EPSILON) * 1000) / 1000;
const bs = value => Math.round((Number(value) + Number.EPSILON) * 100) / 100;
module.exports = { fingerprint, q, bs };
