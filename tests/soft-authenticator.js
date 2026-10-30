// A software WebAuthn authenticator for tests: produces the same bytes a real platform authenticator would
// (attestationObject with fmt "none", authenticatorData, ES256 DER signatures), with switches to break them.
const crypto = require('crypto');

// minimal CBOR encoder
function cbor(v) {
  const head = (major, n) => n < 24 ? [major << 5 | n] : n < 256 ? [major << 5 | 24, n] : n < 65536 ? [major << 5 | 25, n >> 8, n & 255] : [major << 5 | 26, (n >>> 24) & 255, (n >> 16) & 255, (n >> 8) & 255, n & 255];
  if (typeof v === 'number') return v >= 0 ? head(0, v) : head(1, -1 - v);
  if (Buffer.isBuffer(v)) return [...head(2, v.length), ...v];
  if (typeof v === 'string') { const b = Buffer.from(v); return [...head(3, b.length), ...b]; }
  if (Array.isArray(v)) return [...head(4, v.length), ...v.flatMap(cbor)];
  if (v === true) return [0xf5]; if (v === false) return [0xf4]; if (v === null) return [0xf6];
  return [...head(5, v.size), ...[...v].flatMap(([k, x]) => [...cbor(k), ...cbor(x)])];
}

const sha256 = b => crypto.createHash('sha256').update(b).digest();
const b64u = b => Buffer.from(b).toString('base64url');

class SoftAuthenticator {
  constructor({ rpId = 'jonhoag.co.uk', origin = 'https://jonhoag.co.uk', signCountStart = 0 } = {}) {
    this.rpId = rpId; this.origin = origin;
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
    this.privateKey = privateKey;
    const jwk = publicKey.export({ format: 'jwk' });
    this.x = Buffer.from(jwk.x, 'base64url'); this.y = Buffer.from(jwk.y, 'base64url');
    this.credentialId = crypto.randomBytes(32);
    this.signCount = signCountStart;
  }
  get id() { return b64u(this.credentialId); }

  clientData(type, challenge, o = {}) {
    return Buffer.from(JSON.stringify({ type, challenge, origin: o.origin ?? this.origin, crossOrigin: false }));
  }
  authData(o = {}) {
    const flags = o.flags ?? (0x01 | 0x04 | (o.attested ? 0x40 : 0));          // UP | UV | (AT)
    const sc = Buffer.alloc(4); sc.writeUInt32BE(o.signCount ?? this.signCount);
    let out = Buffer.concat([sha256(Buffer.from(o.rpId ?? this.rpId)), Buffer.from([flags]), sc]);
    if (o.attested) {
      const alg = o.alg ?? -7;
      const x = o.x ?? this.x, y = o.y ?? this.y;
      const cose = Buffer.from(cbor(new Map([[1, 2], [3, alg], [-1, 1], [-2, x], [-3, y]])));
      const idLen = Buffer.alloc(2); idLen.writeUInt16BE((o.credentialId ?? this.credentialId).length);
      out = Buffer.concat([out, Buffer.alloc(16), idLen, o.credentialId ?? this.credentialId, cose]);
    }
    return out;
  }

  // options: origin, rpId, flags, alg, x, y, credentialId (in authData), claimedId (what the client says), type
  makeAttestation(challenge, o = {}) {
    const authData = this.authData({ ...o, attested: true });
    const attObj = Buffer.from(cbor(new Map([['fmt', 'none'], ['attStmt', new Map()], ['authData', authData]])));
    return {
      credentialId: o.claimedId ?? this.id,
      clientDataJSON: b64u(this.clientData(o.type ?? 'webauthn.create', challenge, o)),
      attestationObject: b64u(attObj),
    };
  }
  // options: origin, rpId, flags, signCount, type, signWith (another SoftAuthenticator's key), tamper ('authData'|'clientData'|'sig')
  makeAssertion(challenge, o = {}) {
    if (o.signCount === undefined && !o.keepSignCount) this.signCount += 1;
    const authData = this.authData({ ...o, signCount: o.signCount ?? this.signCount });
    const clientData = this.clientData(o.type ?? 'webauthn.get', challenge, o);
    const signer = (o.signWith ?? this).privateKey;
    const sig = crypto.sign('sha256', Buffer.concat([authData, sha256(clientData)]), { key: signer, dsaEncoding: 'der' });
    const out = { credentialId: o.claimedId ?? this.id, clientDataJSON: b64u(clientData), authenticatorData: b64u(authData), signature: b64u(sig) };
    if (o.tamper === 'authData') { const b = Buffer.from(authData); b[33] ^= 0xff; out.authenticatorData = b64u(b); }
    if (o.tamper === 'clientData') out.clientDataJSON = b64u(this.clientData(o.type ?? 'webauthn.get', challenge + 'x', o));
    if (o.tamper === 'sig') { const b = Buffer.from(sig); b[b.length - 1] ^= 1; out.signature = b64u(b); }
    return out;
  }
}

module.exports = { SoftAuthenticator, cbor, sha256, b64u };
