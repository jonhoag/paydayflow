// Generates the known-answer vectors embedded in Code.js (runPasskeySelfTest_). Run: node tests/make-selftest-vectors.js
// Output is JSON to paste into Code.js. Vectors use Node's real crypto, so they are independent of the code under test.
const crypto = require('crypto');
const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
const jwk = publicKey.export({ format: 'jwk' });
const x = Buffer.from(jwk.x, 'base64url').toString('hex'), y = Buffer.from(jwk.y, 'base64url').toString('hex');
const hex = b => Buffer.from(b).toString('hex');
const vectors = [];
for (let i = 0; i < 3; i++) {
  const msg = Buffer.from('paydayflow self-test message ' + i + ' ' + crypto.randomBytes(8).toString('hex'));
  const sig = crypto.sign('sha256', msg, { key: privateKey, dsaEncoding: 'der' });
  const badMsg = Buffer.from(msg); badMsg[0] ^= 1;
  const badSig = Buffer.from(sig); badSig[badSig.length - 1] ^= 1;
  vectors.push({ x, y, msg: hex(msg), sig: hex(sig), valid: true });
  vectors.push({ x, y, msg: hex(badMsg), sig: hex(sig), valid: false });
  vectors.push({ x, y, msg: hex(msg), sig: hex(badSig), valid: false });
}
console.log(JSON.stringify(vectors));
