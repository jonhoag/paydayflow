// Passkey sign-in flow tests: enrolment, login, sessions, revocation, throttling, kill switch.
// Runs the real Code.js with a software authenticator. Run: node tests/passkey-flow.test.js
const vm = require('vm');
const assert = require('assert');
const { makeEnv } = require('./mock-apps-script');
const { SoftAuthenticator } = require('./soft-authenticator');

const results = [];
function test(name, fn) {
  try { fn(); results.push([true, name]); } catch (e) { results.push([false, name + '\n      ' + String(e.stack || e.message).split('\n').slice(0, 2).join(' | ')]); }
}

const call = (env, action, payload, auth) => {
  const res = vm.runInContext('doPost', env.sandbox)({ postData: { contents: JSON.stringify({ action, payload: payload || {}, ...auth }) } });
  return JSON.parse(res.content);
};
const GOOGLE = { idToken: 'tok' };
const fresh = (opts) => makeEnv(opts);
const lastKey = env => Object.keys(env.cacheStore);

function register(env, auth, authn, label, o = {}) {
  const begin = call(env, 'passkeyRegisterBegin', {}, auth);
  if (!begin.ok) return { begin, finish: null };
  const finish = call(env, 'passkeyRegisterFinish', { ...authn.makeAttestation(o.challenge ?? begin.data.challenge, o), label: label || 'Test phone' }, auth);
  return { begin, finish };
}
function login(env, authn, o = {}) {
  const begin = call(env, 'passkeyLoginBegin', { credentialId: o.beginId ?? authn.id }, {});
  if (!begin.ok) return { begin, finish: null };
  const finish = call(env, 'passkeyLoginFinish', authn.makeAssertion(o.challenge ?? begin.data.challenge, o), {});
  return { begin, finish };
}
const enrolled = (env, authn = new SoftAuthenticator()) => { const r = register(env, GOOGLE, authn); assert.ok(r.finish && r.finish.ok, 'setup: enrolment failed: ' + JSON.stringify(r.finish)); return authn; };
const errOf = r => (r && r.error) || '';

// ================= enrolment =================
test('enrolment: needs a fresh Google sign-in (a session or nothing is not enough)', () => {
  const env = fresh(); const a = enrolled(env); const s = login(env, a).finish.data.session;
  assert.strictEqual(call(env, 'passkeyRegisterBegin', {}, {}).ok, false);
  assert.strictEqual(call(env, 'passkeyRegisterBegin', {}, { session: s }).ok, false, 'a session must not be able to add devices');
  const b = new SoftAuthenticator(); const begin = call(env, 'passkeyRegisterBegin', {}, GOOGLE);
  assert.strictEqual(call(env, 'passkeyRegisterFinish', b.makeAttestation(begin.data.challenge), { session: s }).ok, false);
});
test('enrolment: happy path stores the device, lists it, and hands out options the browser needs', () => {
  const env = fresh(); const a = new SoftAuthenticator();
  const r = register(env, GOOGLE, a, 'Fold 7 (Edge)');
  assert.strictEqual(r.begin.ok, true);
  assert.strictEqual(r.begin.data.rpId, 'jonhoag.co.uk');
  assert.ok(r.begin.data.challenge.length >= 43, 'challenge should be 32 random bytes');
  assert.strictEqual(r.finish.ok, true, JSON.stringify(r.finish));
  const list = call(env, 'passkeyList', {}, GOOGLE).data.passkeys;
  assert.strictEqual(list.length, 1); assert.strictEqual(list[0].id, a.id); assert.strictEqual(list[0].label, 'Fold 7 (Edge)');
  assert.ok(!JSON.stringify(list).includes('"x"'), 'public key material is not needed by the client');
});
test('enrolment: a second begin lists existing devices so the browser will not re-register them', () => {
  const env = fresh(); const a = enrolled(env);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(call(env, 'passkeyRegisterBegin', {}, GOOGLE).data.excludeCredentialIds)), [a.id]);
});
const badEnrol = (name, mutate) => test('enrolment rejects: ' + name, () => {
  const env = fresh(); const a = new SoftAuthenticator();
  const r = mutate(env, a);
  assert.strictEqual(r.finish.ok, false, 'accepted a bad enrolment');
  assert.strictEqual(call(env, 'passkeyList', {}, GOOGLE).data.passkeys.length, 0, 'bad enrolment must not store anything');
});
badEnrol('a made-up challenge', (env, a) => register(env, GOOGLE, a, 'x', { challenge: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' }));
badEnrol('a wrong origin', (env, a) => register(env, GOOGLE, a, 'x', { origin: 'https://evil.example' }));
badEnrol('a different rpId', (env, a) => register(env, GOOGLE, a, 'x', { rpId: 'evil.example' }));
badEnrol('missing user verification (fingerprint) flag', (env, a) => register(env, GOOGLE, a, 'x', { flags: 0x01 | 0x40 }));
badEnrol('missing user presence flag', (env, a) => register(env, GOOGLE, a, 'x', { flags: 0x04 | 0x40 }));
badEnrol('missing attested-credential flag', (env, a) => register(env, GOOGLE, a, 'x', { flags: 0x01 | 0x04 }));
badEnrol('an assertion-type clientData', (env, a) => register(env, GOOGLE, a, 'x', { type: 'webauthn.get' }));
badEnrol('a non-ES256 key (RS256)', (env, a) => register(env, GOOGLE, a, 'x', { alg: -257 }));
badEnrol('a public key that is not on the curve', (env, a) => { const y = Buffer.from(a.y); y[31] ^= 1; return register(env, GOOGLE, a, 'x', { y }); });
badEnrol('a credential id that differs from the one claimed', (env, a) => register(env, GOOGLE, a, 'x', { claimedId: 'ZGlmZmVyZW50' }));
test('enrolment: a challenge cannot be replayed, and expires after 2 minutes', () => {
  const env = fresh(); const a = new SoftAuthenticator(), b = new SoftAuthenticator();
  const begin = call(env, 'passkeyRegisterBegin', {}, GOOGLE);
  assert.strictEqual(call(env, 'passkeyRegisterFinish', a.makeAttestation(begin.data.challenge), GOOGLE).ok, true);
  assert.strictEqual(call(env, 'passkeyRegisterFinish', b.makeAttestation(begin.data.challenge), GOOGLE).ok, false, 'replayed challenge accepted');
  const begin2 = call(env, 'passkeyRegisterBegin', {}, GOOGLE); env.clock.offsetMs += 121 * 1000;
  assert.strictEqual(call(env, 'passkeyRegisterFinish', b.makeAttestation(begin2.data.challenge), GOOGLE).ok, false, 'expired challenge accepted');
});
test('enrolment: a login challenge cannot be used to enrol (challenges are typed)', () => {
  const env = fresh(); const a = enrolled(env); const b = new SoftAuthenticator();
  const lb = call(env, 'passkeyLoginBegin', { credentialId: a.id }, {});
  assert.strictEqual(call(env, 'passkeyRegisterFinish', b.makeAttestation(lb.data.challenge), GOOGLE).ok, false);
});
test('enrolment: at most 5 devices', () => {
  const env = fresh();
  for (let i = 0; i < 5; i++) enrolled(env);
  const r = register(env, GOOGLE, new SoftAuthenticator()); assert.ok(!(r.finish && r.finish.ok) && !(r.begin.ok && r.finish.ok), 'sixth device accepted');
});
test('enrolment: device labels are trimmed and cleaned', () => {
  const env = fresh(); register(env, GOOGLE, new SoftAuthenticator(), '  <b>Edge</b>\n on "phone" ' + 'x'.repeat(100));
  const label = call(env, 'passkeyList', {}, GOOGLE).data.passkeys[0].label;
  assert.ok(label.length <= 40 && !/[<>"\n]/.test(label), 'label not cleaned: ' + label);
});

// ================= login =================
test('login: happy path returns a session that works for reads AND writes, without any Google token', () => {
  const env = fresh(); const a = enrolled(env);
  const r = login(env, a); assert.strictEqual(r.finish.ok, true, JSON.stringify(r.finish));
  const s = r.finish.data.session; assert.ok(s && s.includes('.'));
  assert.ok(r.finish.data.expiresAt > Date.now() + 11 * 3600 * 1000 && r.finish.data.expiresAt < Date.now() + 13 * 3600 * 1000, 'session should last about 12 hours');
  assert.strictEqual(call(env, 'getCachedSheetState', { sheetName: 'Real Month', forceRefresh: true }, { session: s }).ok, true);
  assert.strictEqual(call(env, 'deleteBudgetItem', { sheetName: 'Real Month', row: 5 }, { session: s }).ok, true);
  assert.ok(env.writes.count > 0);
});
test('login: unknown device is told apart from a failed attempt', () => {
  const env = fresh(); enrolled(env); const stranger = new SoftAuthenticator();
  const r = login(env, stranger); assert.strictEqual(r.begin.ok, false); assert.ok(/AUTH_PASSKEY_UNKNOWN/.test(errOf(r.begin)), errOf(r.begin));
  assert.strictEqual(r.begin.authError, true);
  assert.strictEqual(lastKey(env).filter(k => k.startsWith('PF_CH_')).length, 0, 'no challenge should be created for an unknown device');
});
const badLogin = (name, o, opts = {}) => test('login rejects: ' + name, () => {
  const env = fresh(); const a = enrolled(env, new SoftAuthenticator({ signCountStart: opts.stored ?? 0 }));
  if (opts.stored) { login(env, a); }   // make the stored counter non-zero
  const mutated = typeof o === 'function' ? o(env, a) : o;
  const r = login(env, a, mutated);
  assert.strictEqual(r.finish.ok, false, 'accepted: ' + name);
  assert.strictEqual(r.finish.authError, true);
});
badLogin('a signature from a different key', (env, a) => ({ signWith: new SoftAuthenticator() }));
badLogin('a tampered signature', { tamper: 'sig' });
badLogin('tampered authenticator data', { tamper: 'authData' });
badLogin('tampered client data (challenge changed after signing)', { tamper: 'clientData' });
badLogin('a wrong origin', { origin: 'https://evil.example' });
badLogin('a different rpId', { rpId: 'evil.example' });
badLogin('missing fingerprint (user verification) flag', { flags: 0x01 });
badLogin('missing user presence flag', { flags: 0x04 });
badLogin('a registration-type clientData', { type: 'webauthn.create' });
badLogin('a made-up challenge', { challenge: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' });
badLogin('a counter that went backwards (cloned authenticator)', { signCount: 2 }, { stored: 6 });
badLogin('a counter that stayed the same once it is non-zero', { signCount: 7 }, { stored: 6 });
test('login: counter handling accepts increasing values and a constant zero (as many platform passkeys do)', () => {
  const env = fresh(); const z = enrolled(env, new SoftAuthenticator());
  for (let i = 0; i < 3; i++) assert.strictEqual(login(env, z, { signCount: 0 }).finish.ok, true, 'zero counter rejected on try ' + i);
  const env2 = fresh(); const a = enrolled(env2);
  for (let i = 0; i < 3; i++) assert.strictEqual(login(env2, a).finish.ok, true);
});
test('login: a challenge is single-use and expires after 2 minutes', () => {
  const env = fresh(); const a = enrolled(env);
  const begin = call(env, 'passkeyLoginBegin', { credentialId: a.id }, {});
  const assertion = a.makeAssertion(begin.data.challenge);
  assert.strictEqual(call(env, 'passkeyLoginFinish', assertion, {}).ok, true);
  assert.strictEqual(call(env, 'passkeyLoginFinish', assertion, {}).ok, false, 'replayed assertion accepted');
  const b2 = call(env, 'passkeyLoginBegin', { credentialId: a.id }, {}); const ass2 = a.makeAssertion(b2.data.challenge); env.clock.offsetMs += 121 * 1000;
  assert.strictEqual(call(env, 'passkeyLoginFinish', ass2, {}).ok, false, 'expired challenge accepted');
});
test('login: a challenge issued for one device cannot be used by another enrolled device', () => {
  const env = fresh(); const a = enrolled(env), b = enrolled(env);
  const begin = call(env, 'passkeyLoginBegin', { credentialId: a.id }, {});
  assert.strictEqual(call(env, 'passkeyLoginFinish', b.makeAssertion(begin.data.challenge), {}).ok, false);
});
test('login: failed attempts do not leave the script lock held', () => {
  const env = fresh(); const a = enrolled(env); login(env, a, { tamper: 'sig' });
  assert.strictEqual(env.lockCalls.waits, env.lockCalls.releases);
});

// ================= throttling =================
test('throttle: 10 failures block further attempts (even a valid one) until the window passes', () => {
  const env = fresh(); const a = enrolled(env);
  for (let i = 0; i < 10; i++) login(env, a, { tamper: 'sig' });
  const blocked = login(env, a); assert.ok(!(blocked.finish && blocked.finish.ok), 'a valid attempt got through while throttled'); assert.ok(/AUTH_THROTTLED/.test(errOf(blocked.finish)) || /AUTH_THROTTLED/.test(errOf(blocked.begin)), 'expected throttle: ' + JSON.stringify(blocked));
  env.clock.offsetMs += 11 * 60 * 1000;
  assert.strictEqual(login(env, a).finish.ok, true, 'should work again after the window');
});
test('throttle: a success resets the failure count', () => {
  const env = fresh(); const a = enrolled(env);
  for (let i = 0; i < 9; i++) login(env, a, { tamper: 'sig' });
  assert.strictEqual(login(env, a).finish.ok, true);
  for (let i = 0; i < 9; i++) login(env, a, { tamper: 'sig' });
  assert.strictEqual(login(env, a).finish.ok, true, 'count should have reset after the success');
});

// ================= sessions =================
test('session: expires after 12 hours', () => {
  const env = fresh(); const a = enrolled(env); const s = login(env, a).finish.data.session;
  env.clock.offsetMs += 11.5 * 3600 * 1000; assert.strictEqual(call(env, 'getCachedSheetState', { sheetName: 'Real Month' }, { session: s }).ok, true);
  env.clock.offsetMs += 1 * 3600 * 1000;
  const r = call(env, 'getCachedSheetState', { sheetName: 'Real Month' }, { session: s });
  assert.strictEqual(r.ok, false); assert.strictEqual(r.authError, true);
});
test('session: a tampered token is rejected (payload, signature, or swapped parts)', () => {
  const env = fresh(); const a = enrolled(env); const s = login(env, a).finish.data.session;
  const [p, sig] = s.split('.');
  const forged = JSON.parse(Buffer.from(p, 'base64url').toString()); forged.exp += 999999;
  const cases = [Buffer.from(JSON.stringify(forged)).toString('base64url') + '.' + sig, p + '.' + sig.slice(0, -2) + 'AA', sig + '.' + p, p, '', 'x.y', p + '.' + sig + '.extra'];
  for (const c of cases) assert.strictEqual(call(env, 'getCachedSheetState', { sheetName: 'Real Month' }, { session: c }).ok, false, 'accepted forged token: ' + c.slice(0, 30));
});
test('session: removing the device kills its sessions immediately', () => {
  const env = fresh(); const a = enrolled(env); const s = login(env, a).finish.data.session;
  assert.strictEqual(call(env, 'passkeyRemove', { credentialId: a.id }, GOOGLE).ok, true);
  assert.strictEqual(call(env, 'getCachedSheetState', { sheetName: 'Real Month' }, { session: s }).ok, false);
  assert.strictEqual(call(env, 'passkeyList', {}, GOOGLE).data.passkeys.length, 0);
  assert.strictEqual(login(env, a).begin.ok, false, 'a removed device must not be able to log in');
});
test('session: a signed-in session can list and remove devices, but not add new ones', () => {
  const env = fresh(); const a = enrolled(env); const b = enrolled(env); const s = login(env, a).finish.data.session;
  assert.strictEqual(call(env, 'passkeyList', {}, { session: s }).data.passkeys.length, 2);
  assert.strictEqual(call(env, 'passkeyRemove', { credentialId: b.id }, { session: s }).ok, true);
  assert.strictEqual(call(env, 'passkeyList', {}, { session: s }).data.passkeys.length, 1);
});
test('session: rotating the secret (owner emergency function) revokes every session and device', () => {
  const env = fresh(); const a = enrolled(env); const s = login(env, a).finish.data.session;
  vm.runInContext('revokeAllPasskeysAndSessions', env.sandbox)();
  assert.strictEqual(call(env, 'getCachedSheetState', { sheetName: 'Real Month' }, { session: s }).ok, false);
  assert.strictEqual(login(env, a).begin.ok, false);
});
test('session: Google sign-in still works exactly as before alongside passkeys', () => {
  const env = fresh(); enrolled(env);
  assert.strictEqual(call(env, 'getCachedSheetState', { sheetName: 'Real Month' }, GOOGLE).ok, true);
  const env2 = fresh({ googleTokens: {} }); const r = call(env2, 'getCachedSheetState', { sheetName: 'Real Month' }, { idToken: 'nope' });
  assert.strictEqual(r.ok, false); assert.strictEqual(r.authError, true);
});
test('session: no secret or key material ever appears in a response', () => {
  const env = fresh(); const a = new SoftAuthenticator(); const all = [];
  const b = call(env, 'passkeyRegisterBegin', {}, GOOGLE); all.push(b);
  all.push(call(env, 'passkeyRegisterFinish', { ...a.makeAttestation(b.data.challenge), label: 'x' }, GOOGLE));
  const l = login(env, a); all.push(l.begin, l.finish); all.push(call(env, 'passkeyList', {}, GOOGLE));
  const secret = env.props['PF_SESSION_SECRET']; assert.ok(secret && secret.length >= 32, 'secret should exist');
  const text = JSON.stringify(all); assert.ok(!text.includes(secret), 'secret leaked'); assert.ok(!text.includes(a.x.toString('base64url')), 'public key leaked');
});
test('session: tokens need the secret held only on the server (a token signed with another secret is refused)', () => {
  const env = fresh(); const a = enrolled(env); const s = login(env, a).finish.data.session;
  env.props['PF_SESSION_SECRET'] = 'a-completely-different-secret-value-1234567890';
  assert.strictEqual(call(env, 'getCachedSheetState', { sheetName: 'Real Month' }, { session: s }).ok, false);
});

// ================= kill switch =================
test('kill switch: with PASSKEYS_ENABLED = false every passkey action and session is refused', () => {
  const on = fresh(); const a = enrolled(on); const s = login(on, a).finish.data.session;
  const off = fresh({ transformCode: c => c.replace('const PASSKEYS_ENABLED = true;', 'const PASSKEYS_ENABLED = false;') });
  off.props['PF_PASSKEYS'] = on.props['PF_PASSKEYS']; off.props['PF_SESSION_SECRET'] = on.props['PF_SESSION_SECRET'];
  for (const [action, payload, auth] of [['passkeyRegisterBegin', {}, GOOGLE], ['passkeyList', {}, GOOGLE], ['passkeyLoginBegin', { credentialId: a.id }, {}]]) assert.strictEqual(call(off, action, payload, auth).ok, false, action + ' should be off');
  assert.strictEqual(call(off, 'getCachedSheetState', { sheetName: 'Real Month' }, { session: s }).ok, false, 'sessions must stop working');
  assert.strictEqual(call(off, 'getCachedSheetState', { sheetName: 'Real Month' }, GOOGLE).ok, true, 'Google sign-in must still work');
});

let failed = 0;
results.forEach(([ok, name]) => { if (!ok) failed++; console.log((ok ? '  PASS  ' : '  FAIL  ') + name); });
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
