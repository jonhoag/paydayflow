// End-to-end test of fingerprint sign-in in a REAL Chrome: the real page talks to the real Code.js (via
// tests/dev-backend.js) and Chrome's built-in virtual authenticator produces genuine WebAuthn messages.
//
//   set PW_PATH=C:\Users\JonfH\pf-tools\node_modules\playwright-core   (a folder containing playwright-core)
//   node tests/e2e-passkey.js
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { startDevBackend } = require('./dev-backend');

const { chromium } = require(process.env.PW_PATH || 'playwright-core');
const CHROME = process.env.CHROME_PATH || 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 8124;
const SHOTS = process.env.E2E_SHOTS;   // optional folder for screenshots

const results = [];
let currentPage = null;
async function step(name, fn) {
  try { await fn(); results.push([true, name]); } catch (e) {
    results.push([false, name + '\n      ' + String(e.message).split('\n').slice(0, 4).join('\n      ')]);
    if (SHOTS && currentPage) { fs.mkdirSync(SHOTS, { recursive: true }); await currentPage.screenshot({ path: path.join(SHOTS, 'FAIL-' + name.slice(0, 2).replace(/\W/g, '') + '.png') }).catch(() => {}); }
  }
}
const admin = async (p) => (await fetch('http://localhost:' + PORT + '/__admin/' + p)).json();

(async () => {
  const { server, env } = await startDevBackend(PORT);
  const origin = 'http://localhost:' + PORT;
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  const page = await context.newPage();
  currentPage = page;
  const consoleErrors = [];
  page.on('pageerror', e => consoleErrors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push('console: ' + m.text()); });

  const cdp = await context.newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', { options: {
    protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true } });

  const shot = async name => { if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: path.join(SHOTS, name + '.png') }); } };
  const visible = sel => page.evaluate(s => { const e = document.querySelector(s); return !!e && getComputedStyle(e).display !== 'none' && !e.classList.contains('hidden'); }, sel);
  const ls = key => page.evaluate(k => localStorage.getItem(k), key);
  const googleToken = async () => (await admin('token')).token;
  const googleSignIn = async () => { const t = await googleToken(); await page.evaluate(tok => window.__gsiCallback({ credential: tok }), t); await page.waitForFunction(() => getComputedStyle(document.getElementById('authLockScreen')).display === 'none', null, { timeout: 8000 }); };
  const unlocked = () => page.waitForFunction(() => getComputedStyle(document.getElementById('authLockScreen')).display === 'none', null, { timeout: 10000 });
  const lastRequests = async n => (await admin('state')).requests.slice(-n);

  await step('1. fresh visit shows the lock screen with Google sign-in and no fingerprint button', async () => {
    await page.goto(origin + '/');
    await page.waitForFunction(() => document.getElementById('authLockScreen') && getComputedStyle(document.getElementById('authLockScreen')).display === 'flex');
    assert.strictEqual(await visible('#passkeyUnlockBtn'), false);
    assert.ok(await page.evaluate(() => typeof window.__gsiCallback === 'function'), 'Google button was not initialised');
  });

  await step('2. Google sign-in unlocks the app and offers fingerprint sign-in', async () => {
    await googleSignIn();
    await page.waitForFunction(() => !document.getElementById('passkeyOffer').classList.contains('hidden'), null, { timeout: 8000 });
    await shot('1-offer-banner');
  });

  await step('3. "Set up" runs a real WebAuthn registration that the real server verifies', async () => {
    await page.click('#passkeyOffer button:has-text("Set up")');
    await page.waitForFunction(() => !document.getElementById('passkeyModal').classList.contains('hidden'));
    await page.click('#pkSetupBtn');
    await page.waitForFunction(() => document.getElementById('pkMsg').textContent.includes('Set up!'), null, { timeout: 15000 });
    const cid = await ls('pf_passkey_cid');
    assert.ok(cid && cid.length > 10, 'no credential id saved on the device');
    const st = await admin('state');
    assert.strictEqual(Object.keys(st.passkeys).length, 1, 'server should hold exactly one device');
    assert.ok(Object.keys(st.passkeys)[0] === cid, 'server and device disagree about the credential id');
    assert.strictEqual(await visible('#passkeyOffer'), false, 'offer banner should be gone');
    const listText = await page.textContent('#pkDevices');
    assert.ok(/this device/.test(listText), 'device list should mark this device: ' + listText);
    await shot('2-dialog-enrolled');
  });

  await step('4. "Test it now" signs in with a real assertion and stores a session', async () => {
    await page.click('#pkTestBtn');
    await page.waitForFunction(() => document.getElementById('pkMsg').textContent.includes('It works'), null, { timeout: 15000 });
    assert.ok(await ls('pf_session'), 'no session stored');
    const reqs = await lastRequests(6).then(r => r.filter(x => x.action.startsWith('passkeyLogin')));
    assert.ok(reqs.length >= 2 && reqs.every(r => r.ok), 'login steps failed: ' + JSON.stringify(reqs));
    await page.click('#passkeyModal button[aria-label="Close"]');
  });

  await step('5. after the Google token and session are gone, reopening the app unlocks with just the fingerprint', async () => {
    await page.evaluate(() => { localStorage.removeItem('pf_google_id_token'); localStorage.removeItem('pf_session'); });
    await admin('clear-log');
    await page.reload();
    await unlocked();
    const reqs = (await admin('state')).requests;
    const loginSteps = reqs.filter(r => r.action.startsWith('passkeyLogin')).map(r => r.action + ':' + r.ok).join(',');
    assert.strictEqual(loginSteps, 'passkeyLoginBegin:true,passkeyLoginFinish:true', loginSteps);
    const state = reqs.find(r => r.action === 'getCachedSheetState');
    assert.ok(state && state.ok && state.auth === 'session', 'data should load using the session, got: ' + JSON.stringify(state));
    assert.strictEqual(await page.evaluate(() => !!localStorage.getItem('pf_google_id_token')), false, 'no Google token should have been needed');
  });

  await step('6. writes work on a fingerprint session (no Google token involved)', async () => {
    await admin('clear-log');
    await page.evaluate(() => { selectAcct('amex'); document.getElementById('inpMerchant').value = 'E2E coffee'; document.getElementById('inpAmount').value = '3.5'; submitExpense(); });
    await page.waitForFunction(async () => (await (await fetch('/__admin/state')).json()).requests.some(r => r.action === 'addTransactionBundle'), null, { timeout: 8000 });
    const w = (await admin('state')).requests.find(r => r.action === 'addTransactionBundle');
    assert.ok(w.ok && w.auth === 'session', JSON.stringify(w));
  });

  await step('7. when the server ends the session, the app goes back to the fingerprint prompt by itself', async () => {
    await admin('advance?ms=' + 13 * 3600 * 1000);
    await admin('clear-log');
    await page.evaluate(() => forceSyncSheet());
    await page.waitForFunction(async () => { const s = (await (await fetch('/__admin/state')).json()).requests; return s.some(r => r.action === 'passkeyLoginFinish' && r.ok); }, null, { timeout: 15000 });
    await unlocked();
    const seq = (await admin('state')).requests.map(r => r.action + ':' + (r.ok ? 'ok' : (r.error || '').slice(0, 12)));
    assert.ok(seq[0].startsWith('getCachedSheetState:AUTH_EXPIRED'), 'expected the old session to be refused first: ' + seq.join(' '));
    assert.ok(seq.includes('passkeyLoginFinish:ok'), seq.join(' '));
  });

  await step('8. "Turn off" removes the device on the server and on this phone; Google sign-in still works', async () => {
    await page.click('#menuBtn');
    await page.click('#menuPasskeyItem');
    await page.click('#pkOffBtn');                       // first tap arms it
    assert.ok((await page.textContent('#pkOffBtn')).includes('Tap again'));
    await page.click('#pkOffBtn');
    // only the fingerprint session was keeping this phone signed in, so turning it off asks for Google, and says why
    await page.waitForFunction(() => document.getElementById('authLockMsg').textContent.includes('Fingerprint sign-in is off'), null, { timeout: 8000 });
    assert.strictEqual(await ls('pf_passkey_cid'), null);
    assert.strictEqual(await ls('pf_session'), null);
    assert.strictEqual(Object.keys((await admin('state')).passkeys).length, 0);
    assert.strictEqual(await visible('#passkeyUnlockBtn'), false, 'no fingerprint button once turned off');
    await page.reload();
    await page.waitForFunction(() => getComputedStyle(document.getElementById('authLockScreen')).display === 'flex');
    assert.strictEqual(await visible('#passkeyUnlockBtn'), false);
    await googleSignIn();
  });

  await step('9. a device removed elsewhere is told so clearly, and falls back to Google', async () => {
    await page.evaluate(() => localStorage.setItem('pf_passkey_offer_dismissed', ''));
    await page.evaluate(() => localStorage.removeItem('pf_passkey_offer_dismissed'));
    await page.evaluate(() => openPasskeyModal());
    await page.click('#pkSetupBtn');
    await page.waitForFunction(() => document.getElementById('pkMsg').textContent.includes('Set up!'), null, { timeout: 15000 });
    await page.click('#passkeyModal button[aria-label="Close"]');
    await admin('wipe-passkeys');
    await page.evaluate(() => { localStorage.removeItem('pf_google_id_token'); localStorage.removeItem('pf_session'); });
    await page.reload();
    await page.waitForFunction(() => document.getElementById('authLockMsg').textContent.includes('turned off for this device'), null, { timeout: 10000 });
    assert.strictEqual(await ls('pf_passkey_cid'), null, 'the stale device id should be forgotten');
    assert.strictEqual(await visible('#passkeyUnlockBtn'), false);
    await googleSignIn();
  });

  await step('10. a failed fingerprint check shows a calm message and a retry button; a second try works', async () => {
    await page.evaluate(() => openPasskeyModal());
    await page.click('#pkSetupBtn');
    await page.waitForFunction(() => document.getElementById('pkMsg').textContent.includes('Set up!'), null, { timeout: 15000 });
    await page.click('#passkeyModal button[aria-label="Close"]');
    await cdp.send('WebAuthn.setUserVerified', { authenticatorId, isUserVerified: false });
    await page.evaluate(() => { localStorage.removeItem('pf_google_id_token'); localStorage.removeItem('pf_session'); });
    await page.reload();
    await page.waitForFunction(() => document.getElementById('authLockMsg').textContent.includes('Tap "Unlock with fingerprint"'), null, { timeout: 15000 });
    assert.strictEqual(await visible('#passkeyUnlockBtn'), true, 'retry button should be there');
    await shot('3-lock-screen-retry');
    await cdp.send('WebAuthn.setUserVerified', { authenticatorId, isUserVerified: true });
    await page.click('#passkeyUnlockBtn');
    await unlocked();
  });

  await step('11. the server has seen only successful logins plus the expected refusals (no unexpected errors)', async () => {
    const bad = (await admin('state')).requests.filter(r => !r.ok && !/AUTH_EXPIRED|AUTH_PASSKEY_UNKNOWN|Authentication/.test(r.error || ''));
    assert.strictEqual(bad.length, 0, JSON.stringify(bad));
  });

  await step('12. no JavaScript errors in the page during the whole run', async () => {
    const real = consoleErrors.filter(e => !/NotAllowedError|Failed to load resource|AUTH_EXPIRED/.test(e));
    assert.strictEqual(real.length, 0, real.join(' | '));
  });

  // a desktop-sized look at the dialog
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.evaluate(() => openPasskeyModal());
  await new Promise(r => setTimeout(r, 400));
  await shot('4-dialog-desktop');

  await browser.close();
  server.close();
  let failed = 0;
  results.forEach(([ok, name]) => { if (!ok) failed++; console.log((ok ? '  PASS  ' : '  FAIL  ') + name); });
  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error('E2E crashed:', e); process.exit(2); });
