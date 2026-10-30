// Mutation check: breaks the real Code.js in security-critical ways, one at a time, and confirms the passkey
// tests notice each break. A surviving mutant means a hole in the tests.  Run: node tests/mutation-check.js
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const src = fs.readFileSync(path.join(__dirname, '..', 'Code.js'), 'utf8');
const mutants = [
  ['login ignores the fingerprint (UV) flag', "if ((parsed.flags & AUTHDATA_UP) === 0 || (parsed.flags & AUTHDATA_UV) === 0) throw fail('fingerprint check missing');", "if ((parsed.flags & AUTHDATA_UP) === 0) throw fail('fingerprint check missing');"],
  ['login does not require a live challenge', "if (!consumeChallenge_(cd.challenge, 'auth', cid)) throw fail('challenge');", ''],
  ['origin is not checked', "if (PASSKEY_ORIGINS.indexOf(data.origin) === -1) throw new Error('origin not allowed');", ''],
  ['challenges are not single-use', "  cache.remove(key);\n  if (!raw) return false;", "  if (!raw) return false;"],
  ['signature is not verified', "if (!verifyEs256_(pub, ad.concat(sha256_(cd.bytes)), sig)) throw fail('signature');", ''],
  ['removed devices keep working sessions', "if (!loadPasskeys_()[payload.cid]) throw bad();", ''],
  ['session expiry is ignored', "|| payload.exp * 1000 <= Date.now()) throw bad();", ") throw bad();"],
  ['sign counter is ignored', "&& parsed.signCount <= cred.signCount) throw fail('counter');", "&& false) throw fail('counter');"],
  ['throttle never blocks', "if (f.n >= PASSKEY_FAIL_LIMIT && f.until > Date.now()) {", "if (false) {"],
  ['a session can add a device', "PASSKEY_GOOGLE_ONLY_ACTIONS.indexOf(action) === -1) {\n        sessionCid", "true) {\n        sessionCid"],
  ['enrolment skips the on-curve check', "if (!p256IsOnCurve_(bytesToBig_(x), bytesToBig_(y))) throw bad('key');", ''],
  ['rpId hash is not checked at login', "if (!bytesEqual_(parsed.rpIdHash, sha256_(utf8Encode_(PASSKEY_RP_ID)))) throw fail('rpId');", ''],
  ['a challenge for one device works for another', "return c.type === type && (c.cid || null) === (cid || null) && c.exp > Date.now();", "return c.type === type && c.exp > Date.now();"],
  ['kill switch does not end sessions', "if (!PASSKEYS_ENABLED || typeof token !== 'string') throw bad();", "if (typeof token !== 'string') throw bad();"],
];

let survived = 0;
for (const [name, from, to] of mutants) {
  if (!src.includes(from)) { console.log('  SKIP  (pattern not found) ' + name); survived++; continue; }
  const file = path.join(os.tmpdir(), 'pf-mutant.js');
  let mutated = src.replace(from, to);
  if (name.startsWith('kill switch')) mutated = mutated.replace('const PASSKEYS_ENABLED = true;', 'const PASSKEYS_ENABLED = false;');
  fs.writeFileSync(file, mutated);
  const r = spawnSync(process.execPath, [path.join(__dirname, 'passkey-flow.test.js')], { env: { ...process.env, PF_CODE_FILE: file }, encoding: 'utf8' });
  const caught = r.status !== 0;
  if (!caught) survived++;
  console.log((caught ? '  CAUGHT   ' : '  SURVIVED ') + name);
}
console.log(`\n${mutants.length - survived}/${mutants.length} mutants caught`);
process.exit(survived ? 1 : 0);
