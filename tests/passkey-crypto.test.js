// Tests the passkey crypto building blocks in Code.js (base64url, CBOR, P-256 ECDSA verification)
// against Node's real crypto. Run: node tests/passkey-crypto.test.js
const vm = require('vm');
const crypto = require('crypto');
const assert = require('assert');
const { makeEnv } = require('./mock-apps-script');

const env = makeEnv();
const fn = name => vm.runInContext(name, env.sandbox);
const results = [];
function test(name, f) {
  try { f(); results.push([true, name]); } catch (e) { results.push([false, name + '\n      ' + String(e.message).split('\n')[0]]); }
}
const big = h => BigInt('0x' + h);
const arr = buf => Array.from(buf);
// the code under test runs in a separate JS realm, so compare plain values rather than object identity
const same = (a, b, msg) => assert.strictEqual(JSON.stringify(a), JSON.stringify(b), msg);

// ---------- base64url ----------
test('base64url: encode/decode round-trips for every length and matches Node', () => {
  const enc = fn('b64urlEncode_'), dec = fn('b64urlDecode_');
  for (let len = 0; len <= 70; len++) {
    const b = crypto.randomBytes(len);
    const s = enc(arr(b));
    assert.strictEqual(s, b.toString('base64url'), 'encode mismatch at length ' + len);
    same(dec(s), arr(b), 'decode mismatch at length ' + len);
  }
});
test('base64url: tolerates padding, rejects invalid characters and impossible lengths', () => {
  const dec = fn('b64urlDecode_');
  same(dec('aGk='), [104, 105]);
  assert.throws(() => dec('ab+/'));
  assert.throws(() => dec('a'));
  assert.throws(() => dec('ab cd'));
});

// ---------- CBOR ----------
// tiny reference encoder (test only)
function cbor(v) {
  const head = (major, n) => n < 24 ? [major << 5 | n] : n < 256 ? [major << 5 | 24, n] : n < 65536 ? [major << 5 | 25, n >> 8, n & 255] : [major << 5 | 26, (n >>> 24) & 255, (n >> 16) & 255, (n >> 8) & 255, n & 255];
  if (typeof v === 'number') return v >= 0 ? head(0, v) : head(1, -1 - v);
  if (Buffer.isBuffer(v)) return [...head(2, v.length), ...v];
  if (typeof v === 'string') { const b = Buffer.from(v); return [...head(3, b.length), ...b]; }
  if (Array.isArray(v)) return [...head(4, v.length), ...v.flatMap(cbor)];
  if (v === true) return [0xf5]; if (v === false) return [0xf4]; if (v === null) return [0xf6];
  return [...head(5, v.size), ...[...v].flatMap(([k, x]) => [...cbor(k), ...cbor(x)])];   // Map
}
test('CBOR: decodes ints (incl. negative), bytes, text, arrays, nested maps, bools', () => {
  const decode = fn('cborDecode_');
  const m = new Map([['fmt', 'none'], ['attStmt', new Map()], ['authData', Buffer.from([1, 2, 3, 255])], [-3, 300], [1, [1, -7, 70000]], [-1, true]]);
  const { value, next } = decode(cbor(m), 0);
  assert.strictEqual(value.fmt, 'none'); same(Object.keys(value.attStmt), []);
  same(value.authData, [1, 2, 3, 255]);
  assert.strictEqual(value['-3'], 300); same(value['1'], [1, -7, 70000]); assert.strictEqual(value['-1'], true);
  assert.strictEqual(next, cbor(m).length);
});
test('CBOR: reports where the value ends (needed to read the key after the credential id)', () => {
  const decode = fn('cborDecode_');
  const bytes = [...cbor(new Map([[1, 2]])), 9, 9, 9];
  assert.strictEqual(decode(bytes, 0).next, bytes.length - 3);
});
test('CBOR: rejects truncated, over-long and unsupported input instead of crashing', () => {
  const decode = fn('cborDecode_');
  assert.throws(() => decode([0xa1, 0x01], 0));            // map missing its value
  assert.throws(() => decode([0x58, 0x20, 1, 2], 0));      // byte string longer than the data
  assert.throws(() => decode([0x1b, 0, 0, 0, 0, 0, 0, 0, 1], 0));   // 8-byte lengths unsupported
  assert.throws(() => decode([0x9f], 0));                  // indefinite length unsupported
  assert.throws(() => decode([], 0));
});

// ---------- P-256 ECDSA ----------
const makeKey = () => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const jwk = publicKey.export({ format: 'jwk' });
  return { privateKey, pub: { x: big(Buffer.from(jwk.x, 'base64url').toString('hex')), y: big(Buffer.from(jwk.y, 'base64url').toString('hex')) } };
};
const sign = (priv, msg) => crypto.sign('sha256', msg, { key: priv, dsaEncoding: 'der' });
const verify = (pub, msg, sig) => fn('verifyEs256_')(pub, arr(msg), arr(sig));

test('P-256: accepts 40 valid signatures from random keys and messages', () => {
  for (let i = 0; i < 40; i++) {
    const k = makeKey(), msg = crypto.randomBytes(1 + Math.floor(Math.random() * 200));
    assert.strictEqual(verify(k.pub, msg, sign(k.privateKey, msg)), true, 'valid signature rejected on round ' + i);
  }
});
test('P-256: rejects a changed message', () => {
  const k = makeKey(), msg = crypto.randomBytes(64), sig = sign(k.privateKey, msg);
  for (let i = 0; i < 10; i++) { const bad = Buffer.from(msg); bad[Math.floor(Math.random() * bad.length)] ^= 1 << Math.floor(Math.random() * 8); assert.strictEqual(verify(k.pub, bad, sig), false); }
});
test('P-256: rejects the wrong public key', () => {
  const a = makeKey(), b = makeKey(), msg = crypto.randomBytes(32);
  assert.strictEqual(verify(b.pub, msg, sign(a.privateKey, msg)), false);
});
test('P-256: rejects a signature with any single flipped bit', () => {
  const k = makeKey(), msg = crypto.randomBytes(32), sig = sign(k.privateKey, msg);
  for (let i = 0; i < sig.length; i++) { const bad = Buffer.from(sig); bad[i] ^= 0x01; assert.strictEqual(verify(k.pub, msg, bad), false, 'accepted bit flip at byte ' + i); }
});
test('P-256: accepts the "high-s" twin of a valid signature (also a valid ECDSA signature)', () => {
  const n = 0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551n;
  const k = makeKey(), msg = crypto.randomBytes(32), der = sign(k.privateKey, msg);
  const rLen = der[3], r = der.subarray(4, 4 + rLen), s = BigInt('0x' + der.subarray(6 + rLen).toString('hex'));
  const s2 = (n - s).toString(16).padStart(64, '0'), sb = Buffer.from(s2, 'hex'), sbody = sb[0] & 0x80 ? Buffer.concat([Buffer.from([0]), sb]) : sb;
  const body = Buffer.concat([Buffer.from([2, rLen]), r, Buffer.from([2, sbody.length]), sbody]);
  assert.strictEqual(verify(k.pub, msg, Buffer.concat([Buffer.from([0x30, body.length]), body])), true);
});
test('P-256: rejects r or s of zero or >= the group order, and malformed DER', () => {
  const k = makeKey(), msg = crypto.randomBytes(32);
  const der = (r, s) => { const e = x => { const b = Buffer.from(x.toString(16).padStart(64, '0'), 'hex'); return b[0] & 0x80 ? Buffer.concat([Buffer.from([0]), b]) : b; }; const rb = e(r), sb = e(s); const body = Buffer.concat([Buffer.from([2, rb.length]), rb, Buffer.from([2, sb.length]), sb]); return Buffer.concat([Buffer.from([0x30, body.length]), body]); };
  const n = 0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551n;
  assert.strictEqual(verify(k.pub, msg, der(0n, 5n)), false);
  assert.strictEqual(verify(k.pub, msg, der(5n, 0n)), false);
  assert.strictEqual(verify(k.pub, msg, der(n, 5n)), false);
  assert.strictEqual(verify(k.pub, msg, der(5n, n + 1n)), false);
  for (const junk of [[], [0x30], [0x30, 0x00], [0x31, 0x06, 2, 1, 1, 2, 1, 1], [0x30, 0x06, 3, 1, 1, 2, 1, 1], [0x30, 0x07, 2, 1, 1, 2, 1, 1]]) assert.strictEqual(verify(k.pub, msg, Buffer.from(junk)), false);
});
test('P-256: public keys that are not on the curve are rejected', () => {
  const onCurve = fn('p256IsOnCurve_');
  const k = makeKey();
  assert.strictEqual(onCurve(k.pub.x, k.pub.y), true);
  assert.strictEqual(onCurve(k.pub.x, k.pub.y + 1n), false);
  assert.strictEqual(onCurve(0n, 0n), false);
  assert.strictEqual(onCurve(-1n, 5n), false);
  const msg = crypto.randomBytes(32);
  assert.strictEqual(verify({ x: k.pub.x, y: k.pub.y + 1n }, msg, sign(k.privateKey, msg)), false);
});
test('P-256: handles special cases (signature made with a tiny private scalar)', () => {
  // d = 1 gives public key = G; exercises point doubling/addition edge paths
  const d = Buffer.alloc(32); d[31] = 1;
  const jwk = { kty: 'EC', crv: 'P-256', d: d.toString('base64url'), x: Buffer.from('6b17d1f2e12c4247f8bce6e563a440f277037d812deb33a0f4a13945d898c296', 'hex').toString('base64url'), y: Buffer.from('4fe342e2fe1a7f9b8ee7eb4a7c0f9e162bce33576b315ececbb6406837bf51f5', 'hex').toString('base64url') };
  const priv = crypto.createPrivateKey({ key: jwk, format: 'jwk' });
  const pub = { x: big('6b17d1f2e12c4247f8bce6e563a440f277037d812deb33a0f4a13945d898c296'), y: big('4fe342e2fe1a7f9b8ee7eb4a7c0f9e162bce33576b315ececbb6406837bf51f5') };
  for (let i = 0; i < 5; i++) { const msg = crypto.randomBytes(20); assert.strictEqual(verify(pub, msg, sign(priv, msg)), true); }
});
test('P-256: a verification takes well under a second (Node timing, informational)', () => {
  const k = makeKey(), msg = crypto.randomBytes(100), sig = sign(k.privateKey, msg);
  const t0 = process.hrtime.bigint(); for (let i = 0; i < 10; i++) verify(k.pub, msg, sig); const ms = Number(process.hrtime.bigint() - t0) / 1e6 / 10;
  console.log(`      (~${ms.toFixed(1)} ms per verification in Node)`);
  assert.ok(ms < 500, 'too slow: ' + ms + ' ms');
});

let failed = 0;
results.forEach(([ok, name]) => { if (!ok) failed++; console.log((ok ? '  PASS  ' : '  FAIL  ') + name); });
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
