// PaydayFlow: everything the page does. Loaded by index.html at the end of <body> (and put back inside the page for the
// copy Apps Script serves, by deploy-backend.ps1). Buttons and fields name what they do with data-action and the like
// (see ACTIONS near the end); nothing is written into the page as an on...= handler or an inline script.

// Backstop for the frame guard (guard.js, the same check): if that file didn't arrive, the app still stays blank and
// never starts inside another website's frame.
if (!window.PF_FRAMED && window.top !== window.self && !/\.googleusercontent\.com$/.test(location.hostname)) {
  window.PF_FRAMED = true;
  document.documentElement.style.display = 'none';
}
    // Also written in the Content-Security-Policy at the top of the page (the screen tests check they match).
    const APPS_SCRIPT_EXEC_URL = 'https://script.google.com/macros/s/AKfycbwiuLsruSCA-k2EeMn8bH6AZygi0ISA2WDTB_UJmetDOJdU6S4qLE21WmjyJK1ktCMrUA/exec';
    const GOOGLE_CLIENT_ID = '1074590107449-b3clq41r6un84qma18lomq7ip2f833pk.apps.googleusercontent.com';
const IS_GAS_ENV = (typeof google !== 'undefined' && google.script && google.script.run);

// ---- What this device saves: every key starts with pf_ (Sign out clears them all but SIGN_OUT_KEEP) ----
const TOKEN_STORAGE_KEY = 'pf_google_id_token';
const SESSION_STORAGE_KEY = 'pf_session';              // fingerprint sign-in session: { token, exp }
const PASSKEY_ID_KEY = 'pf_passkey_cid';               // this device's fingerprint credential id
const PASSKEY_OFFER_DISMISSED_KEY = 'pf_passkey_offer_dismissed';
const THEME_KEY = 'pf_theme_mode';
const LAST_MONTH_KEY = 'pf_last_month';                // the month last shown
const CACHE_PREFIX = 'pf_cache_';                      // + month name: that month's figures
const TX_TS_PREFIX = 'pf_tx_ts_';                      // + month name: when this device added or edited each entry
const CONFIG_KEY = 'pf_config';                        // the names the backend last sent (see applyConfig)
const SPEND_OVERRIDES_KEY = 'pf_cat_overrides';        // your Spending category choices
const OUTBOX_KEY = 'pf_outbox';                        // spends saved offline, still to send
const LAST_ACCT_KEY = 'pf_last_acct';                  // the card the last spend went on (the Add form starts there)
const SIGNED_OUT_FLAG = 'pf_signed_out';               // sessionStorage: this tab has just signed out
const SIGNED_OUT_NOTICE = 'pf_signed_out_at';           // set on sign-out, so the app's other open tabs lock too
// Storage can refuse (a private window, or a full or blocked store): a read then finds nothing and a write is
// skipped, rather than stopping the page.
function lsGet(key) { try { return localStorage.getItem(key); } catch (e) { return null; } }
function lsSet(key, value) { try { localStorage.setItem(key, value); return true; } catch (e) { return false; } }
function lsDel(key) { try { localStorage.removeItem(key); } catch (e) {} }
function lsJson(key) { try { return JSON.parse(lsGet(key) || 'null'); } catch (e) { return null; } }   // null if unreadable
function ssGet(key) { try { return sessionStorage.getItem(key); } catch (e) { return null; } }   // the same, for this tab only
function ssSet(key, value) { try { sessionStorage.setItem(key, value); return true; } catch (e) { return false; } }
function ssDel(key) { try { sessionStorage.removeItem(key); } catch (e) {} }
function lsKeys() { try { return Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i)).filter(Boolean); } catch (e) { return []; } }
const STORAGE_REFUSED_MSG = "This browser won't let PaydayFlow save anything (a private window, or storage full?), so it can't keep you signed in here.";

// ---- Line icons (replace emoji, which look different on every device) ----
const ICON_PATHS = {
  home: '<path d="M3 11.5 12 4l9 7.5"/><path d="M5 10v10h14V10"/><path d="M10 20v-6h4v6"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  card: '<rect x="2.5" y="5" width="19" height="14" rx="2.5"/><path d="M2.5 10h19M6.5 15h3"/>',
  repeat: '<path d="M17 2l4 4-4 4"/><path d="M3 11V9a3 3 0 0 1 3-3h15"/><path d="M7 22l-4-4 4-4"/><path d="M21 13v2a3 3 0 0 1-3 3H3"/>',
  sparkle: '<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/><path d="M19 17v4M17 19h4"/>',
  'arrow-up-right': '<path d="M7 17 17 7M8 7h9v9"/>',
  'arrow-down-left': '<path d="M17 7 7 17M16 17H7V8"/>',
  skip: '<circle cx="12" cy="12" r="9"/><path d="M5.6 5.6l12.8 12.8"/>',
  more: '<circle cx="5" cy="12" r="1.6" fill="currentColor"/><circle cx="12" cy="12" r="1.6" fill="currentColor"/><circle cx="19" cy="12" r="1.6" fill="currentColor"/>',
  refresh: '<path d="M21 12a9 9 0 1 1-3-6.7"/><path d="M21 4v5h-5"/>',
  contrast: '<circle cx="12" cy="12" r="9"/><path d="M12 3v18a9 9 0 0 0 0-18z" fill="currentColor"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  moon: '<path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  sheet: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M4 9h16M4 15h16M10 3v18"/>',
  calendar_plus: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4M12 13v5M9.5 15.5h5"/>',
  check: '<path d="M5 12.5 10 17.5 19 7"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/>',
  chevron_down: '<path d="m6 9 6 6 6-6"/>',
  chevron_up: '<path d="m6 15 6-6 6 6"/>',
  chart: '<path d="M4 20V11"/><path d="M10 20V4"/><path d="M16 20v-6"/><path d="M22 20H2"/>',
  pound: '<circle cx="12" cy="12" r="9"/><path d="M14.5 8.8a2.6 2.6 0 0 0-5 .9V16h5.5M8.5 12.5h4.5"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/>',
  filter: '<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>',
  share: '<path d="M4 12v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7"/><path d="m16 6-4-4-4 4"/><path d="M12 2v13"/>',
  chevron_right: '<path d="m9 6 6 6-6 6"/>',
  // Spending categories
  cat_groceries: '<path d="M5 9h14l-1.6 10.5H6.6z"/><path d="M9 9l3-5 3 5"/>',
  cat_eating: '<path d="M7 3v8M5 3v4a2 2 0 0 0 4 0V3M7 11v10"/><path d="M17 21V3c-2 0-3.2 2-3.2 5v5H17"/>',
  cat_transport: '<path d="M5 16v-5l2-5h10l2 5v5"/><path d="M3 16h18v3H3z"/><path d="M7 12.5h.01M17 12.5h.01"/>',
  cat_bills: '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6"/>',
  cat_shopping: '<path d="M5 8h14l-1 13H6z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/>',
  cat_travel: '<path d="M2 16l20-8-6 12-3-5z"/><path d="M13 15l9-7"/>',
  cat_entertainment: '<rect x="3" y="6" width="18" height="12" rx="2"/><path d="M15 6v12"/>',
  cat_health: '<path d="M12 20s-7-4.5-7-10a4 4 0 0 1 7-2.5A4 4 0 0 1 19 10c0 5.5-7 10-7 10z"/>',
  cat_other: '<circle cx="6" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="18" cy="12" r="1.2"/>',
  fingerprint: '<path d="M12 10a2 2 0 0 0-2 2c0 1.02-.1 2.51-.26 4"/><path d="M14 13.12c0 2.38 0 6.38-1 8.88"/><path d="M17.29 21.02c.12-.6.43-2.3.5-3.02"/><path d="M2 12a10 10 0 0 1 18-6"/><path d="M2 16h.01"/><path d="M21.8 16c.2-2 .131-5.354 0-6"/><path d="M5 19.5C5.5 18 6 15 6 12a6 6 0 0 1 .34-2"/><path d="M8.65 22c.21-.66.45-1.32.57-2"/><path d="M9 6.8a6 6 0 0 1 9 5.2v2"/>'
};
function icon(name, cls) {
  return '<svg class="' + (cls || 'w-4 h-4') + ' shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (ICON_PATHS[name] || '') + '</svg>';
}
// Static markup marks icon slots as <span data-icon="home" data-class="w-4 h-4"></span>; swap them for SVGs.
function hydrateIcons(root) {
  (root || document).querySelectorAll('[data-icon]').forEach(el => {
    el.insertAdjacentHTML('afterend', icon(el.getAttribute('data-icon'), el.getAttribute('data-class')));
    el.remove();
  });
}

// The middle part of a Google sign-in token, as an object (null if it isn't one).
function parseJwtPayload(token) {
  try {
    const part = String(token).split('.')[1];
    return part ? JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(b64uToBytes(part))) : null;
  } catch (e) {
    return null;
  }
}

// A fingerprint sign-in session (from the server, 1 hour) or a Google sign-in token (about 1 hour) unlocks the app.
function getSession() {
  const s = lsJson(SESSION_STORAGE_KEY);
  return s && s.token && s.exp > Date.now() + 60000 ? s : null;
}
function saveSession(token, expiresAt) { lsSet(SESSION_STORAGE_KEY, JSON.stringify({ token, exp: expiresAt })); }
function clearSession() { lsDel(SESSION_STORAGE_KEY); }

// A Google sign-in that hasn't run out. Whose account it is, is for the server to decide: the page doesn't hold the
// allowed address.
function hasValidGoogleToken() {
  const token = lsGet(TOKEN_STORAGE_KEY);
  const payload = token ? parseJwtPayload(token) : null;
  return !!payload && (payload.exp * 1000) > (Date.now() + 60000);
}

// After the server turns down a Google sign-in, Google must not pick that account again by itself, or the lock
// screen would sign it straight back in, over and over. Choosing an account on the button still works.
function stopGoogleAutoSignIn() {
  try { if (window.google && google.accounts && google.accounts.id) google.accounts.id.disableAutoSelect(); } catch (e) {}
}

function hasValidToken() {
  if (IS_GAS_ENV) return true;
  return !!getSession() || hasValidGoogleToken();
}

// What to send with a request: the fingerprint session if there is one, otherwise the Google token.
function getAuthFields() {
  const s = getSession();
  return s ? { session: s.token } : { idToken: lsGet(TOKEN_STORAGE_KEY) };
}

let passkeyAutoTried = false;
let lockAllowsAuto = false;   // whether the lock screen now showing may ask for the fingerprint by itself
// Being away from the app: when it was last hidden (set by the "back in the app" check below, and by
// unlockWithPasskey, so that time in the fingerprint prompt doesn't count), and how long counts as a while.
const RETURN_REFRESH_MS = 60 * 1000;
let hiddenAt = 0;
const PASSKEY_FOCUS_WAIT_MS = 3000;   // how long the automatic fingerprint prompt waits for focus to be reported
const PASSKEY_RETRY_MS = 1500;        // gap before trying the fingerprint's first request again
const REQUEST_TIMEOUT_MS = 45000;         // how long any request to the server may take before it is given up
const PASSKEY_BEGIN_TIMEOUT_MS = 20000;   // the fingerprint's first request is small: give up on it sooner
const PASSKEY_PROMPT_GRACE_MS = 5000;     // how long past its own time limit a fingerprint prompt may run before it is dropped
const OFFLINE_RESYNC_MS = 5000;       // signed in without the figures: when to try fetching them again
// The line under "PaydayFlow Locked": red for a problem, grey for a plain note.
function setLockMsg(text, isError) {
  const el = document.getElementById('authLockMsg');
  if (!el) return;
  el.textContent = text;
  el.style.color = isError ? '#F87171' : '#94A3B8';
}
function showLockScreen(msg, opts) {
  if (IS_GAS_ENV) return;
  const lockEl = document.getElementById('authLockScreen');
  if (msg) setLockMsg(msg, msg.indexOf('Access Denied') === 0 || msg.indexOf('Fingerprint') === 0);
  if (lockEl) lockEl.style.display = 'flex';
  dropToasts();   // no Undo may come back over the lock screen
  lockAllowsAuto = !(opts && opts.noAuto);
  initGoogleAuthButton();
  updateLockPasskeyUi();
  // If this device is set up for fingerprint sign-in, offer it straight away (once per page load).
  if (!passkeyAutoTried && passkeyEnrolledHere() && lockAllowsAuto && document.visibilityState === 'visible') {
    passkeyAutoTried = true;
    autoUnlockWithPasskey();
  }
}

// The fingerprint prompt needs the page to have focus (Chrome turns it down otherwise), and the request before it
// needs a connection. Straight after the app is reopened neither may be there yet, so wait a moment for them.
let stopPasskeyWait = () => {};
function autoUnlockWithPasskey() {
  stopPasskeyWait();   // only one wait at a time
  const online = () => navigator.onLine !== false;
  if (document.hasFocus() && online()) { unlockWithPasskey(true); return; }
  // Focus isn't always reported, so after 3 s it is enough for the app to be on screen and online.
  let waitedLong = false;
  const stop = stopPasskeyWait = () => {
    window.removeEventListener('focus', check);
    window.removeEventListener('online', check);
    clearTimeout(timer);
  };
  const check = () => {
    // Only while the lock screen is still up and still wants it (a Google sign-in may have happened meanwhile).
    if (!lockAllowsAuto || !lockScreenShowing()) return stop();
    if (online() && (document.hasFocus() || (waitedLong && document.visibilityState === 'visible'))) { stop(); unlockWithPasskey(true); }
  };
  window.addEventListener('focus', check);
  window.addEventListener('online', check);
  const timer = setTimeout(() => { waitedLong = true; check(); }, PASSKEY_FOCUS_WAIT_MS);
}

// Everything that happens once the user is in, whichever way they signed in. `email` is the Google account just
// chosen, so a refusal can say which account it was.
let signInInFlight = false;   // a sign-in is waiting for its first figures (a second one meanwhile is ignored)
function afterSignIn(viaGoogle, email) {
  passkeyAutoTried = false;   // if the session later expires while the app is open, prompt for the fingerprint again
  lockAllowsAuto = false;     // and a fingerprint prompt still waiting for focus must not pop up over this sign-in
  if (viaGoogle) cancelPasskeyAttempt();   // nor one still on its way (its first request may answer late)
  ssDel(SIGNED_OUT_FLAG);
  openApp();
  signInInFlight = true;
  apiCall('getCachedSheetState', { sheetName: activeMonth, forceRefresh: true })
    .then(s => {
      signInInFlight = false;
      hideLockScreen();
      applyServerState(s);
      if (viaGoogle) onGoogleSignedIn();
      flushOutbox();
    })
    .catch(err => {
      signInInFlight = false;
      if (isConnectionError(err)) {
        // No signal yet, or the server hiccuped: that is not a refusal. A fingerprint sign-in was already accepted by
        // the server, so open the app with the figures saved here, as when opening it offline; they refresh when you
        // come back to the app. A Google account the server hasn't checked yet stays on the lock screen.
        if (!viaGoogle && getSession()) {
          hideLockScreen();
          showToast("Signed in, but couldn't reach the server. Showing the figures saved on this device.");
          setTimeout(forceSyncSheet, OFFLINE_RESYNC_MS);
        } else {
          if (viaGoogle) lsDel(TOKEN_STORAGE_KEY);   // never checked by the server, so not kept for a reload to use
          showLockScreen("Couldn't reach the server. Try again in a moment.", { noAuto: true });
        }
        return;
      }
      const reason = String((err && err.message) || 'Sign-in failed.').replace(/^[A-Z_]+: /, '');
      showLockScreen('Access Denied: ' + reason + (email ? ' (' + email + ')' : ''), { noAuto: true });
    });
}

function lockScreenShowing() {
  return document.getElementById('authLockScreen').style.display !== 'none';
}
function hideLockScreen() {
  const lockEl = document.getElementById('authLockScreen');
  if (lockEl) lockEl.style.display = 'none';
}

// Google's sign-in script is only needed on the lock screen, so it is fetched the first time that shows (an app that
// opens already signed in never downloads it). If it can't load (no signal), it is tried again while the lock screen
// is still up.
function loadGoogleSignInScript() {
  if (document.getElementById('gsiScript')) return;
  const s = document.createElement('script');
  s.id = 'gsiScript';
  s.src = 'https://accounts.google.com/gsi/client';
  s.async = true;
  s.onerror = () => setTimeout(() => s.remove(), 5000);
  document.head.appendChild(s);
}

// Google's own sign-in is set up once per page load (Google asks for that); the button is drawn each time the lock
// screen shows. On a device with fingerprint sign-in, Google doesn't sign in by itself: its "Signing you in" sheet
// would cover the page, and Chrome then turns the fingerprint prompt down. The Google button stays as the fallback.
let gsiInitialised = false, gsiWaiting = false;
function initGoogleAuthButton() {
  if (IS_GAS_ENV) return;
  if (!window.google || !window.google.accounts || !window.google.accounts.id) {
    loadGoogleSignInScript();
    if (!gsiWaiting) {   // one wait at a time, however often the lock screen is shown meanwhile
      gsiWaiting = true;
      setTimeout(() => { gsiWaiting = false; if (lockScreenShowing()) initGoogleAuthButton(); }, 150);
    }
    return;
  }
  if (!gsiInitialised) {
    gsiInitialised = true;
    google.accounts.id.initialize({
      client_id: GOOGLE_CLIENT_ID,
      callback: (response) => {
        // Already unlocked, or unlocking (say, by fingerprint): a late Google sign-in has nothing to do.
        if (signInInFlight || !lockScreenShowing()) return;
        if (response && response.credential) {
          // The server checks that this is the owner's account; a refusal comes back as an auth error (apiCallNow).
          const payload = parseJwtPayload(response.credential);
          // Nothing can be sent without the saved token, so say why plainly instead of "Authentication required".
          if (!lsSet(TOKEN_STORAGE_KEY, response.credential)) { setLockMsg(STORAGE_REFUSED_MSG, true); return; }
          clearSession();   // a fresh Google sign-in replaces any older fingerprint session
          afterSignIn(true, String((payload && payload.email) || ''));
        }
      },
      auto_select: true
    });
  }
  const btnContainer = document.getElementById('googleSignInBtn');
  if (btnContainer) {
    btnContainer.innerHTML = '';
    google.accounts.id.renderButton(btnContainer, {
      theme: 'filled_black',
      size: 'large',
      shape: 'pill',
      text: 'continue_with',
      width: 260
    });
  }
  // Straight after signing out, Google must not sign the same account back in by itself.
  if (justSignedOut()) stopGoogleAutoSignIn();
  if (!passkeyEnrolledHere()) google.accounts.id.prompt();
}

// ================= FINGERPRINT (PASSKEY) SIGN-IN =================
// Your device keeps a private key behind its fingerprint / face / screen lock. To unlock, the server sends a
// random challenge, the device signs it after you verify yourself, and the server (which only holds the public
// key) swaps the signature for a 1-hour session. Google sign-in stays as the fallback and is needed to add a device.
function b64uToBytes(s) {
  s = String(s).replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function bytesToB64u(buf) {
  const b = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function passkeySupported() {
  return !IS_GAS_ENV && window.isSecureContext && !!(window.PublicKeyCredential && navigator.credentials && navigator.credentials.create);
}
function passkeyEnrolledHere() {
  return passkeySupported() && !!lsGet(PASSKEY_ID_KEY);
}
async function platformAuthenticatorAvailable() {
  try { return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable(); } catch (e) { return false; }
}
function deviceLabel() {
  const ua = navigator.userAgent || '';
  const browser = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  const os = /Android/.test(ua) ? 'Android' : /Windows/.test(ua) ? 'Windows' : /iPhone|iPad/.test(ua) ? 'iOS' : /Mac OS/.test(ua) ? 'Mac' : /Linux/.test(ua) ? 'Linux' : '';
  return browser + (os ? ' on ' + os : '') + ' (' + new Date().toLocaleDateString('en-GB') + ')';
}

// Words for the person, not the browser, for the ways a fingerprint step can fail.
function describePasskeyError(err, auto) {
  const code = String((err && err.serverCode) || '');
  if (code.indexOf('AUTH_PASSKEY_UNKNOWN') === 0) return { text: 'Fingerprint sign-in was turned off for this device. Sign in with Google to set it up again.', error: true, forget: true };
  if (code.indexOf('AUTH_THROTTLED') === 0) return { text: 'Fingerprint sign-in is paused for a few minutes after too many tries. You can still sign in with Google.', error: true };
  // (The lock screen words this itself, since its button reloads; this is for the fingerprint dialog's "Test it now".)
  if (err && err.promptBusy) return { text: 'The fingerprint prompt is stuck. Reload the page and try again.', error: false };
  // AbortError: a prompt that never answered was dropped (a try cancelled on purpose shows no message at all).
  if (err && (err.name === 'NotAllowedError' || err.name === 'AbortError')) return auto ? { text: 'Tap "Unlock with fingerprint", or sign in with Google.', error: false } : { text: 'Fingerprint was cancelled or timed out. Try again, or sign in with Google.', error: true };
  if (err && err.name === 'InvalidStateError') return { text: 'This device already has a fingerprint sign-in for PaydayFlow. Remove it in your password manager (or turn it off below) and try again.', error: true };
  if (err && err.name === 'SecurityError') return { text: 'This page address does not match the fingerprint sign-in, so the browser blocked it.', error: true };
  if (err && err.network) return { text: 'No connection yet. Try again in a moment.', error: false };
  if (isConnectionError(err)) return { text: 'The server didn\'t answer properly. Try again in a moment.', error: false };
  return { text: "Fingerprint sign-in didn't work (" + ((err && err.message) || 'unknown error') + '). You can sign in with Google instead.', error: true };
}

function updateLockPasskeyUi() {
  const show = passkeyEnrolledHere();
  const btn = document.getElementById('passkeyUnlockBtn');
  const or = document.getElementById('passkeyOr');
  if (btn) btn.style.display = show ? 'flex' : 'none';
  if (or) or.style.display = show ? 'block' : 'none';
}

// Settles like `promise`, except that it fails (AbortError) as soon as `signal` is aborted, even if `promise` never
// settles at all.
function unlessAborted(promise, signal) {
  return new Promise((resolve, reject) => {
    const stop = () => reject(new DOMException('Cancelled', 'AbortError'));
    if (signal.aborted) return stop();
    signal.addEventListener('abort', stop);
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', stop));
  });
}

// Aborts `to` as soon as `from` aborts (at once if it already has). Returns a function that unhooks it again.
function chainAbort(from, to) {
  if (!from) return () => {};
  const go = () => to.abort();
  if (from.aborted) go(); else from.addEventListener('abort', go);
  return () => from.removeEventListener('abort', go);
}

// Begin -> the browser's fingerprint prompt -> finish. Resolves with { session, expiresAt }. `signal` (optional)
// cancels it at any step; `onAccepted` (optional) is called once the fingerprint was accepted, before the last request.
async function passkeyLoginRoundTrip(signal, onAccepted) {
  const cid = lsGet(PASSKEY_ID_KEY);
  const beginReq = { action: 'passkeyLoginBegin', payload: { credentialId: cid } };
  const beginOpts = { signal, timeoutMs: PASSKEY_BEGIN_TIMEOUT_MS };
  // Just after the phone wakes up, the first request often fails before the connection is back: try once more.
  const begin = await postToServer(beginReq, beginOpts).catch(err => {
    if (!err || !err.network || err.timedOut) throw err;   // not after a long wait: that is long enough
    return new Promise(r => setTimeout(r, PASSKEY_RETRY_MS)).then(() => postToServer(beginReq, beginOpts));
  });
  if (!begin.ok) throw Object.assign(new Error(begin.error || 'Sign-in failed'), { serverCode: begin.error });
  // The prompt should end by itself after its time limit, but on a phone one that never appeared can leave the
  // request waiting for good, so it is dropped a little after that (or as soon as the caller cancels).
  const prompt = new AbortController();
  const unlink = chainAbort(signal, prompt);
  const timer = setTimeout(() => prompt.abort(), (begin.data.timeoutMs || 60000) + PASSKEY_PROMPT_GRACE_MS);
  let cred;
  try {
    cred = await unlessAborted(navigator.credentials.get({ signal: prompt.signal, publicKey: {
      challenge: b64uToBytes(begin.data.challenge),
      rpId: begin.data.rpId,
      userVerification: 'required',
      timeout: begin.data.timeoutMs,
      allowCredentials: [{ type: 'public-key', id: b64uToBytes(cid) }]
    } }), prompt.signal);
  } catch (err) {
    // The browser is still holding an earlier fingerprint request (e.g. one a phone dropped while the app was opening).
    // Chrome says so as an OperationError "A request is already pending."; others use InvalidStateError.
    if (err && (err.name === 'InvalidStateError' || /already pending/i.test(err.message || ''))) {
      throw Object.assign(new Error('The fingerprint prompt is still busy.'), { promptBusy: true });
    }
    throw err;
  } finally {
    clearTimeout(timer);
    unlink();
  }
  if (onAccepted) onAccepted();
  const r = cred.response;
  const fin = await postToServer({ action: 'passkeyLoginFinish', payload: {
    credentialId: bytesToB64u(cred.rawId),
    clientDataJSON: bytesToB64u(r.clientDataJSON),
    authenticatorData: bytesToB64u(r.authenticatorData),
    signature: bytesToB64u(r.signature)
  } }, { signal });
  if (!fin.ok) throw Object.assign(new Error(fin.error || 'Sign-in failed'), { serverCode: fin.error });
  return fin.data;
}

// A stuck fingerprint request belongs to the page, so only reloading it clears it. By itself the lock screen reloads
// only while the app is on screen and hasn't opened in this page yet (nothing typed can be lost), and not again within
// PASSKEY_RELOAD_GAP_MS, so it can never loop; otherwise a tap on the button (`byTap`) reloads.
const PASSKEY_RELOAD_KEY = 'pf_pk_reloaded';   // sessionStorage: when this tab last reloaded for a stuck request
const PASSKEY_RELOAD_GAP_MS = 60 * 1000;
let passkeyNeedsReload = false;
const PASSKEY_STUCK_MSG = 'The fingerprint prompt is stuck. Tap "Unlock with fingerprint" to reload and try again, or sign in with Google.';
function reloadForStuckPrompt(byTap) {
  if (apiInflight > 0) return false;   // a save on its way finishes first
  if (!byTap && (appUiReady || document.visibilityState !== 'visible')) return false;
  if (!byTap && Date.now() - (Number(ssGet(PASSKEY_RELOAD_KEY)) || 0) < PASSKEY_RELOAD_GAP_MS) return false;
  if (!ssSet(PASSKEY_RELOAD_KEY, String(Date.now())) && !byTap) return false;   // no record means no guard against a loop: only a tap may reload then
  location.reload();
  return true;
}

// The fingerprint sign-in running now (its AbortController), or null.
let passkeyAttempt = null;
function cancelPasskeyAttempt() {
  if (passkeyAttempt) { passkeyAttempt.abort(); passkeyAttempt = null; }
}
async function unlockWithPasskey(auto) {
  if (!passkeyEnrolledHere()) return;
  // Asking again in this page can't work: reload instead.
  if (passkeyNeedsReload) {
    if (!reloadForStuckPrompt(!auto) && !auto) setLockMsg('Finishing a save first. Try again in a moment.', false);
    return;
  }
  if (passkeyAttempt) {
    // An automatic try never asks over one already running, and a tap mustn't throw away a fingerprint that was
    // already accepted. Otherwise a tap means no prompt is on screen (it would cover the button), so the running try
    // has stalled (a phone can drop the prompt while the app is still opening): cancel it and ask again.
    if (auto || passkeyAttempt.accepted) return;
    cancelPasskeyAttempt();
  }
  stopPasskeyWait();   // asked now, so a wait for focus must not ask a second time
  const attempt = passkeyAttempt = new AbortController();
  const label = document.getElementById('passkeyUnlockLabel');
  if (label) label.textContent = 'Waiting for fingerprint…';
  try {
    const s = await passkeyLoginRoundTrip(attempt.signal, () => {
      attempt.accepted = true;
      if (label) label.textContent = 'Signing in…';
    });
    saveSession(s.session, s.expiresAt);
    afterSignIn(false);
  } catch (err) {
    // Cancelled (by a tap that asks again, or a Google sign-in): no message, whatever cancelled it has the screen.
    if (attempt.signal.aborted) return;
    if (err && err.promptBusy) {
      passkeyNeedsReload = true;
      if (!reloadForStuckPrompt(false)) setLockMsg(PASSKEY_STUCK_MSG, false);
      return;
    }
    const d = describePasskeyError(err, auto);
    if (d.forget) { lsDel(PASSKEY_ID_KEY); updateLockPasskeyUi(); }
    setLockMsg(d.text, d.error);
  } finally {
    if (passkeyAttempt === attempt) passkeyAttempt = null;
    // The button and the timing belong to a newer try, if one has started meanwhile.
    if (!passkeyAttempt) {
      if (label) label.textContent = 'Unlock with fingerprint';
      // Time spent in the fingerprint prompt doesn't count as being away (Android may show it over the app): if the
      // app is still out of sight when the prompt ends, being away starts now.
      if (document.visibilityState === 'hidden') hiddenAt = Date.now();
    }
  }
}

// Adding a device always needs a fresh Google sign-in: one made in the last few minutes, which the server checks
// (REAUTH). Returns false if it had to ask for one first; the set-up carries on once you have signed in.
let pendingPasskeySetup = false;
function askGoogleForPasskeySetup(msg) {
  pendingPasskeySetup = true;
  clearSession();
  closePasskeyModal();
  showLockScreen(msg, { noAuto: true });
  return false;
}
async function setUpPasskey() {
  if (!passkeySupported()) throw new Error("This browser can't use fingerprint sign-in.");
  if (!(await platformAuthenticatorAvailable())) throw new Error('This device has no fingerprint, face or screen lock set up.');
  if (!hasValidGoogleToken()) return askGoogleForPasskeySetup('Sign in with Google to set up fingerprint on this device.');
  let begin;
  try {
    begin = await apiCall('passkeyRegisterBegin', {}, { needGoogle: true });
  } catch (err) {
    if (!/^REAUTH/.test(String(err && err.message))) throw err;
    lsDel(TOKEN_STORAGE_KEY);   // that Google sign-in is too old to add a device: ask for a new one
    return askGoogleForPasskeySetup('Sign in with Google again to set up fingerprint on this device.');
  }
  const cred = await navigator.credentials.create({ publicKey: {
    rp: { id: begin.rpId, name: begin.rpName },
    user: { id: b64uToBytes(begin.userId), name: begin.userName, displayName: 'PaydayFlow' },
    challenge: b64uToBytes(begin.challenge),
    pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
    excludeCredentials: (begin.excludeCredentialIds || []).map(id => ({ type: 'public-key', id: b64uToBytes(id) })),
    authenticatorSelection: { authenticatorAttachment: 'platform', residentKey: 'preferred', userVerification: 'required' },
    attestation: 'none',
    timeout: begin.timeoutMs
  } });
  const out = await apiCall('passkeyRegisterFinish', {
    credentialId: bytesToB64u(cred.rawId),
    clientDataJSON: bytesToB64u(cred.response.clientDataJSON),
    attestationObject: bytesToB64u(cred.response.attestationObject),
    label: deviceLabel()
  }, { needGoogle: true });
  if (!lsSet(PASSKEY_ID_KEY, out.credentialId)) throw new Error(STORAGE_REFUSED_MSG);
  return true;
}

// After a Google sign-in: finish a set-up that was waiting for it, otherwise offer fingerprint once.
function onGoogleSignedIn() {
  if (pendingPasskeySetup) {
    pendingPasskeySetup = false;
    openPasskeyModal('Signed in. Tap "Set up on this device" to finish.');
    return;
  }
  maybeOfferPasskey();
}
async function maybeOfferPasskey() {
  if (!passkeySupported() || passkeyEnrolledHere() || lsGet(PASSKEY_OFFER_DISMISSED_KEY)) return;
  if (!(await platformAuthenticatorAvailable())) return;
  document.getElementById('passkeyOffer').classList.remove('hidden');
}
function dismissPasskeyOffer() {
  lsSet(PASSKEY_OFFER_DISMISSED_KEY, '1');
  document.getElementById('passkeyOffer').classList.add('hidden');
}

// ---- the "Fingerprint sign-in" dialog ----
let pkConfirmId = null, pkConfirmTimer = null;
function setPkMessage(text, kind) {
  const el = document.getElementById('pkMsg');
  if (!el) return;
  el.textContent = text || '';
  el.className = text ? 'text-xs rounded-xl px-3 py-2 ' + (kind === 'error' ? 'bg-rose-500/10 text-rose-600 dark:text-rose-400' : kind === 'ok' ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400' : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300') : 'hidden';
}
function renderPasskeyModal() {
  const here = passkeyEnrolledHere();
  const supported = passkeySupported();
  document.getElementById('pkStatus').textContent = !supported ? "This browser can't use fingerprint sign-in."
    : here ? 'Fingerprint sign-in is on for this device.' : 'Fingerprint sign-in is off for this device.';
  document.getElementById('pkSetupBtn').classList.toggle('hidden', !supported || here);
  document.getElementById('pkTestBtn').classList.toggle('hidden', !here);
  document.getElementById('pkOffBtn').classList.toggle('hidden', !here);
  document.getElementById('pkOffBtn').textContent = pkConfirmId && pkConfirmId === lsGet(PASSKEY_ID_KEY) ? 'Tap again to turn off' : 'Turn off';
}
// The last device list from the server, so arming "Remove" redraws at once instead of waiting for a round trip.
let pkDevices = null;
function renderPasskeyDevices() {
  if (!pkDevices) return;
  const mine = lsGet(PASSKEY_ID_KEY);
  document.getElementById('pkDevices').innerHTML = pkDevices.length ? pkDevices.map(d => `
      <div class="py-2 flex items-center justify-between gap-2 text-xs">
        <div class="min-w-0">
          <div class="font-medium text-slate-800 dark:text-slate-100 truncate">${esc(d.label)}${d.id === mine ? ' <span class="ml-1 text-xs px-1.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">this device</span>' : ''}</div>
          <div class="text-xs text-slate-500 dark:text-slate-400">Added ${esc(new Date(d.created).toLocaleDateString('en-GB'))}${d.lastUsed ? ' · last used ' + esc(relTime(new Date(d.lastUsed).getTime())) : ''}</div>
        </div>
        <button data-id="${esc(d.id)}" data-action="removePasskeyDevice" class="h-10 px-3 rounded-lg text-xs font-semibold ${pkConfirmId === d.id ? 'bg-rose-500 text-white' : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300'}">${pkConfirmId === d.id ? 'Tap again' : 'Remove'}</button>
      </div>`).join('') : '<div class="py-3 text-xs text-slate-500 dark:text-slate-400">No devices yet.</div>';
}
async function refreshPasskeyDevices() {
  const list = document.getElementById('pkDevices');
  list.innerHTML = '<div class="py-3 text-xs text-slate-500 dark:text-slate-400">Loading…</div>';
  try {
    pkDevices = (await apiCall('passkeyList', {})).passkeys;
    renderPasskeyDevices();
  } catch (err) {
    pkDevices = null;
    list.innerHTML = '<div class="py-3 text-xs text-slate-500 dark:text-slate-400">Couldn\'t load the device list. Sign in again to see it.</div>';
  }
}
function openPasskeyModal(note) {
  closeMenu();
  document.getElementById('passkeyModal').classList.remove('hidden');
  setPkMessage(note || '', 'info');
  renderPasskeyModal();
  refreshPasskeyDevices();
}
function closePasskeyModal() {
  document.getElementById('passkeyModal').classList.add('hidden');
  pkConfirmId = null;
}
async function runPasskeySetup() {
  const btn = document.getElementById('pkSetupBtn');
  btn.disabled = true;
  setPkMessage('Follow your phone\'s prompt to confirm…', 'info');
  try {
    const done = await setUpPasskey();
    if (done) {
      document.getElementById('passkeyOffer').classList.add('hidden');
      setPkMessage('Set up! Tap "Test it now" to try it. (You\'ll get an email about it too.)', 'ok');
      renderPasskeyModal();
      refreshPasskeyDevices();
    }
  } catch (err) {
    setPkMessage(describePasskeyError(err, false).text, 'error');
  } finally {
    btn.disabled = false;
  }
}
async function testPasskey() {
  const btn = document.getElementById('pkTestBtn');
  if (btn.disabled) return;
  btn.disabled = true;
  setPkMessage('Follow your phone\'s prompt…', 'info');
  try {
    const s = await passkeyLoginRoundTrip();
    saveSession(s.session, s.expiresAt);
    setPkMessage('It works. Next time the app locks, just use your fingerprint.', 'ok');
    refreshPasskeyDevices();
  } catch (err) {
    const d = describePasskeyError(err, false);
    if (d.forget) { lsDel(PASSKEY_ID_KEY); renderPasskeyModal(); }
    setPkMessage(d.text, 'error');
  } finally {
    btn.disabled = false;
  }
}
// Two taps to remove: the first arms the button for a few seconds.
async function removePasskeyDevice(id) {
  if (!id) return;
  if (pkConfirmId !== id) {
    pkConfirmId = id;
    clearTimeout(pkConfirmTimer);
    pkConfirmTimer = setTimeout(() => { pkConfirmId = null; renderPasskeyModal(); renderPasskeyDevices(); }, 4000);
    renderPasskeyModal();
    renderPasskeyDevices();
    return;
  }
  clearTimeout(pkConfirmTimer);
  pkConfirmId = null;
  try {
    await apiCall('passkeyRemove', { credentialId: id });
    if (id === lsGet(PASSKEY_ID_KEY)) {
      // Removing this device ends its own session, so if no Google sign-in is still active we must sign in again.
      lsDel(PASSKEY_ID_KEY);
      clearSession();
      if (!hasValidGoogleToken()) {
        closePasskeyModal();
        showLockScreen('Fingerprint sign-in is off. Sign in with Google to continue.', { noAuto: true });
        return;
      }
    }
    setPkMessage('Removed.', 'ok');
  } catch (err) {
    setPkMessage("Couldn't remove it: " + err.message, 'error');
  }
  renderPasskeyModal();
  refreshPasskeyDevices();
}

// ---- Sign out: clears everything this device has saved and locks the app. The Google Sheet is never touched. ----
// "Forget this device" first turns off this device's fingerprint sign-in on the server. Then the page reloads, so
// nothing from the signed-in session stays in memory; a flag for this tab tells the fresh page to say so.
const SIGN_OUT_KEEP = [THEME_KEY, PASSKEY_OFFER_DISMISSED_KEY];   // preferences, not data
let soArmed = null, soArmTimer = null, soBusy = false;

function justSignedOut() {
  return ssGet(SIGNED_OUT_FLAG) === '1';
}
function setSoMessage(text) {
  const el = document.getElementById('soMsg');
  el.textContent = text || '';
  el.className = text ? 'text-xs rounded-xl px-3 py-2 bg-rose-500/10 text-rose-600 dark:text-rose-400' : 'hidden';
}
function renderSignOutModal() {
  const waiting = loadOutbox().length;
  document.getElementById('soWaiting').classList.toggle('hidden', !waiting);
  document.getElementById('soWaitingText').textContent = waiting === 1
    ? "1 spend saved offline hasn't been sent yet. Signing out would lose it."
    : waiting + " spends saved offline haven't been sent yet. Signing out would lose them.";
  // Without fingerprint sign-in on this device there is nothing more to forget.
  const here = passkeyEnrolledHere();
  document.getElementById('soKeepNote').classList.toggle('hidden', !here);
  document.getElementById('soForgetBlock').classList.toggle('hidden', !here);
  document.getElementById('soBtn').textContent = soArmed === 'keep' ? 'Tap again to sign out anyway' : 'Sign out';
  document.getElementById('soForgetBtn').textContent = soArmed === 'forget' ? 'Tap again to sign out anyway' : 'Sign out and forget this device';
  ['soBtn', 'soForgetBtn', 'soSendBtn'].forEach(id => { document.getElementById(id).disabled = soBusy; });
}
function openSignOutModal() {
  closeMenu();
  soArmed = null;
  clearTimeout(soArmTimer);
  setSoMessage('');
  renderSignOutModal();
  document.getElementById('signOutModal').classList.remove('hidden');
}
function closeSignOutModal() {
  if (soBusy) return;
  document.getElementById('signOutModal').classList.add('hidden');
  soArmed = null;
  clearTimeout(soArmTimer);
}
async function sendWaitingBeforeSignOut() {
  if (navigator.onLine === false) { setSoMessage('Still offline. Try again when you have signal.'); return; }
  const btn = document.getElementById('soSendBtn');
  soBusy = true;
  soArmed = null;
  setSoMessage('');
  renderSignOutModal();
  btn.textContent = 'Sending…';
  retrySetAside();   // a tap: spends set aside are tried too
  try { await flushOutbox(); } finally {
    soBusy = false;
    btn.textContent = 'Send now';
  }
  renderSignOutModal();
  const left = loadOutbox();
  if (left.length) setSoMessage(left.some(x => x.setAside) ? "Your sheet didn't take one of them, so it is still here. Signing out would lose it." : "Couldn't send them yet. Try again in a moment.");
}
// Every saved key of this app goes, except the preferences above and, for a plain sign-out, the fingerprint link.
function clearThisDevice(forget) {
  const keep = SIGN_OUT_KEEP.concat(forget ? [] : [PASSKEY_ID_KEY]);
  lsKeys().filter(k => k.indexOf('pf_') === 0 && keep.indexOf(k) === -1).forEach(lsDel);
}
// With spends still waiting to send, the first tap only warns; a second tap within a few seconds signs out anyway.
async function signOut(forget) {
  if (soBusy) return;
  // Let any save that is still on its way finish first: one that can't get through is kept to send later, and
  // then counts as waiting below.
  if (apiInflight) {
    soBusy = true;
    renderSignOutModal();
    await apiQueue;
    await new Promise(r => setTimeout(r, 0));
    soBusy = false;
    renderSignOutModal();
  }
  const which = forget ? 'forget' : 'keep';
  if (loadOutbox().length && soArmed !== which) {
    soArmed = which;
    clearTimeout(soArmTimer);
    soArmTimer = setTimeout(() => { soArmed = null; renderSignOutModal(); }, 4000);
    renderSignOutModal();
    return;
  }
  clearTimeout(soArmTimer);
  soArmed = null;
  const cid = lsGet(PASSKEY_ID_KEY);
  if (forget && cid) {
    soBusy = true;
    setSoMessage('');
    renderSignOutModal();
    try {
      await apiCall('passkeyRemove', { credentialId: cid });
    } catch (err) {
      soBusy = false;
      renderSignOutModal();
      setSoMessage(err && (err.auth || err.needsSignIn)
        ? 'Sign in again, then tap "Sign out and forget this device" once more. Nothing has been cleared yet.'
        : "Couldn't turn off fingerprint sign-in (" + ((err && err.message) || 'unknown error') + '). Nothing has been cleared yet.');
      return;
    }
  }
  clearThisDevice(forget);
  lsSet(SIGNED_OUT_NOTICE, String(Date.now()));   // tells this app's other open tabs (see below)
  ssSet(SIGNED_OUT_FLAG, '1');
  stopGoogleAutoSignIn();
  location.reload();
}
// Signed out in another tab: this one locks too, the same way, so it can't go on showing the figures or save them
// again.
window.addEventListener('storage', e => {
  if (e.key !== SIGNED_OUT_NOTICE || !e.newValue || IS_GAS_ENV) return;
  ssSet(SIGNED_OUT_FLAG, '1');
  location.reload();
});

    // Requests go to the server strictly one at a time. Apps Script can answer two quick requests out of
    // order, and a late, older reply would otherwise overwrite newer screen state.
    let apiQueue = Promise.resolve();
    // For the sync status (updateSyncUi): requests not yet answered, and how the last one to the sheet went:
    // lastSyncFailed is null (fine), 'reach' (no reply, none that could be read, or a read the server couldn't answer)
    // or 'refused' (the server turned a change down). Fingerprint requests aren't about the sheet, so they don't count.
    let apiInflight = 0, lastSyncAt = null, lastSyncFailed = null;
    const SHEET_READS = ['getCachedSheetState', 'getCategoryChoices'];
    // What a failed request means: 'signin' (the lock screen deals with it), 'reach' (no usable reply), 'busy' (the
    // sheet was busy with another save, so the server did nothing), 'saved' (the change is in the sheet, but its new
    // figures couldn't be read back: fetch them afresh) or 'refused' (turned down, or failed part way).
    function failureKind(err) {
      if (err && (err.needsSignIn || err.auth)) return 'signin';
      if (!err || isConnectionError(err)) return 'reach';
      const msg = String(err.message);
      return /^Lock timeout/i.test(msg) ? 'busy' : /^SAVED_NO_STATE/.test(msg) ? 'saved' : 'refused';
    }
    // What a failed sheet request means for the sync status: null for a sign-in problem (the lock screen shows that),
    // 'reach' when nothing usable came back or a read failed, 'refused' when the server turned a change down.
    function syncFailure(action, err) {
      const kind = failureKind(err);
      if (kind === 'signin') return null;
      return (kind === 'reach' || kind === 'saved' || SHEET_READS.includes(action)) ? 'reach' : 'refused';
    }
    function apiCall(action, payload = {}, opts = {}) {
      const run = () => apiCallNow(action, payload, opts);
      apiInflight++;
      updateSyncUi();
      const p = apiQueue.then(run, run);
      apiQueue = p.catch(() => {});
      // Track sync health for the status (a sign-in problem is the lock screen's to show instead).
      const counts = !/^passkey/.test(action);
      p.then(() => { if (counts) { lastSyncFailed = null; lastSyncAt = Date.now(); } },
             err => { if (counts) lastSyncFailed = syncFailure(action, err) || lastSyncFailed; })
       .then(() => { apiInflight--; updateSyncUi(); });
      return p;
    }

    async function apiCallNow(action, payload = {}, opts = {}) {
      // Mode 1: the copy of the page Apps Script serves itself. gasCall runs the same actions, checks and write
      // lock as the website's requests.
      if (IS_GAS_ENV) {
        // Apps Script hands back an error whose text may start "Error: " or "Exception: ". A lost connection is
        // named (or worded) "NetworkError": like no reply on the website, not a refusal.
        const failed = e => {
          const name = String((e && e.name) || ''), text = String((e && e.message) || e);
          const err = new Error(text.replace(/^(?:(?:Error|Exception|ScriptError): )+/, ''));
          if (/NetworkError/.test(name + ' ' + text)) err.network = true;
          return err;
        };
        return new Promise((resolve, reject) => {
          google.script.run.withSuccessHandler(resolve).withFailureHandler(e => reject(failed(e))).gasCall(action, payload);
        });
      }

      // Mode 2: Running externally on https://jonhoag.co.uk
  // `needGoogle` is for adding a fingerprint device, which always needs a Google sign-in (the server also checks it is recent).
  const needGoogle = !!opts.needGoogle;
  if (needGoogle ? !hasValidGoogleToken() : !hasValidToken()) {
    showLockScreen(needGoogle ? 'Sign in with Google to continue.' : 'Session expired. Please tap below to unlock.', needGoogle ? { noAuto: true } : undefined);
    throw Object.assign(new Error('Authentication required'), { needsSignIn: true });   // never sent: not a failed sync
  }

  const auth = needGoogle ? { idToken: lsGet(TOKEN_STORAGE_KEY) } : getAuthFields();
  const json = await postToServer({ action, payload, ...auth });

  if (!json.ok) {
    // The server couldn't fetch Google's keys just now: the sign-in wasn't turned down, so keep it and try again later.
    if (/^AUTH_UNAVAILABLE/.test(String(json.error))) {
      throw Object.assign(new Error(String(json.error).replace(/^[A-Z_]+: /, '')), { unavailable: true });
    }
    if (json.authError) {
      const usedSession = !!auth.session;
      if (usedSession) clearSession(); else { lsDel(TOKEN_STORAGE_KEY); stopGoogleAutoSignIn(); }
      // An expired fingerprint session is normal: go straight back to the fingerprint prompt.
      showLockScreen(usedSession ? 'Session ended. Unlock to continue.' : 'Access Denied: ' + String(json.error || 'Unauthorised account.').replace(/^[A-Z_]+: /, ''), usedSession ? undefined : { noAuto: true });
    }
    const apiErr = new Error(json.error || 'API request failed');
    apiErr.auth = !!json.authError;
    throw apiErr;
  }
  return json.data;
}

// No reply, one that wasn't readable, or a server that couldn't check the sign-in just now: worth trying again
// later, not a refusal.
const isConnectionError = err => !!(err && (err.network || err.badReply || err.unavailable));

// One POST to the Apps Script web app; resolves with the parsed { ok, data | error, authError } reply.
// `opts.timeoutMs` shortens the wait; `opts.signal` lets the caller cancel it.
async function postToServer(bodyObj, opts = {}) {
  // Give up after a while so one stuck request can't block every request queued behind it.
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), opts.timeoutMs || REQUEST_TIMEOUT_MS);
  const unlink = chainAbort(opts.signal, abort);
  let rawText;
  try {
    const res = await fetch(APPS_SCRIPT_EXEC_URL, {
      method: 'POST',
      redirect: 'follow',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(bodyObj),
      signal: abort.signal
    });
    rawText = await res.text();
  } catch (e) {
    const netErr = new Error(e && e.name === 'AbortError' ? 'The server took too long to respond.' : (e && e.message) || 'Network error');
    netErr.network = true;   // never reached a reply, so the save may be retried later (the server ignores repeats)
    netErr.timedOut = !!(e && e.name === 'AbortError');
    throw netErr;
  } finally {
    clearTimeout(timer);
    unlink();
  }
  try {
    return JSON.parse(rawText);
  } catch (e) {
    console.warn('Unreadable reply from the server:', rawText.slice(0, 200));
    throw Object.assign(new Error('The server sent back something unexpected. Try again in a moment.'), { badReply: true });
  }
}

    // Each account is a small card in its own colour with a short label: readable at a glance, no brand logos.
    const ACCOUNT_CARDS = {
      amex: { label: 'AX', name: 'Amex', from: '#3B82F6', to: '#1E3A8A' },
      barclays: { label: 'BC', name: 'Barclays', from: '#06B6D4', to: '#0E5A8A' },
      checking: { label: 'NW', name: 'Nationwide', from: '#8B5CF6', to: '#3B2A8C' },
      marcus: { label: 'MS', name: 'Marcus', from: '#F59E0B', to: '#9A4B0B' }
    };
    // The four accounts in the order the screen lists them, and where each one's balance sits in state.summary.
    const ACCTS = ['amex', 'barclays', 'checking', 'marcus'];
    const SUMMARY_KEY = { amex: 'amex', barclays: 'barclays', checking: 'nCA', marcus: 'mSAV' };
    function getBankLogo(acct) {
      const c = ACCOUNT_CARDS[acct] || ACCOUNT_CARDS.marcus;
      return `<span class="inline-flex items-center justify-center shrink-0 text-white font-bold" title="${c.name}" style="width:30px;height:20px;border-radius:4px;font-size:9.5px;letter-spacing:.04em;background:linear-gradient(135deg,${c.from},${c.to})">${c.label}</span>`;
    }

    // What the screen shows before any figures have arrived.
    const SHEET_LINK = /^https:\/\/docs\.google\.com\/spreadsheets\//;
    function emptyState() {
      return {
        sheetUrl: '#', availableMonths: [], activeMonth,
        summary: { nCA: 0, mSAV: 0, amex: 0, barclays: 0, budgetRem: 0, checkingExpected: 0, eomSavingsJ: 0 },
        budgets: [], checking: [], amex: [], barclays: [], marcus: []
      };
    }

    let activeMonth = lsGet(LAST_MONTH_KEY) || '';
    // Nothing to show yet (no saved copy, first figures not here): the screen says so instead of showing £0.00.
    function loadingState() { return { ...emptyState(), loading: true }; }
    let state = loadingState();
    let skippedBudgetRows = new Set();
    let budFilter = 'all';

    // Budget Form State
    let budFormIsRecurring = false;
    let budFormSign = -1; // -1 for Expense (-), +1 for Carry-In (+)

    // Transaction Modal State
    let txDirection = 'spend'; // 'spend' (-) or 'refund' (+)
    let formAcct = 'amex';
    let formSplit = '100_me';
    let customSplitEntries = []; // [{ person: 'sam', amount: 3.33 }, ...]
    let autoEqualActive = false;

    // Edit Transaction Modal State
    let editTxNewAcct = 'amex';
    let editTxSign = -1;

    let splitPanelMode = 'pending';
    let txFilter = 'all';

    // When this device edited an entry in place, for the newest-first order of Activity. The server keeps a time for
    // every add and move (by row, sent as clientTs), not for edits in place. Kept under the row and what it holds now,
    // so an identical purchase in another row, or whatever later fills a cleared row, isn't moved by it. (Times kept
    // before 2026-11 under what the entry held alone, which mixed up identical purchases, are no longer read.)
    function getLocalTimestamps() {
      const map = lsJson(TX_TS_PREFIX + activeMonth);
      return map && typeof map === 'object' ? map : {};
    }
    const localTsKey = (acct, row, desc, amount) => `${acct}|${row}|${String(desc).toLowerCase()}|${Number(amount)}`;

    function recordEditTime(acct, row, desc, amount) {
      const map = getLocalTimestamps();
      map[localTsKey(acct, row, desc, amount)] = Date.now();
      lsSet(TX_TS_PREFIX + activeMonth, JSON.stringify(map));
    }

    // The lists of rows in a month's figures.
    const MONTH_LISTS = ['budgets'].concat(ACCTS);
    // Whether a month's figures are ones the screen can draw (a damaged saved copy isn't).
    function usableMonth(s) {
      if (!s || typeof s !== 'object' || !s.summary || typeof s.summary !== 'object') return false;
      if (!Object.values(s.summary).every(Number.isFinite)) return false;
      if (s.availableMonths !== undefined && !Array.isArray(s.availableMonths)) return false;
      return MONTH_LISTS.every(k => s[k] === undefined || (Array.isArray(s[k]) && s[k].every(r => r && typeof r === 'object')));
    }
    // Every row number made a number: they go into the page's markup.
    function numberRows(s) {
      MONTH_LISTS.forEach(k => { if (Array.isArray(s[k])) s[k].forEach(r => { if (r && typeof r === 'object') r.row = Number(r.row); }); });
      return s;
    }
    // A month's figures saved on this device, or null if there are none it can use.
    function savedMonth(monthName) {
      const saved = lsJson(CACHE_PREFIX + monthName);
      return usableMonth(saved) && (!saved.activeMonth || saved.activeMonth === monthName) ? numberRows(saved) : null;
    }
    function loadPhoneCache(monthName) {
      const saved = savedMonth(monthName);
      if (saved) { state = { ...emptyState(), ...saved }; return true; }
      return false;
    }

    // A month's figures are only ever saved under that month's own name.
    function savePhoneCache(monthName, dataObj, remember = true) {
      if (!dataObj || dataObj.loading || (dataObj.activeMonth && dataObj.activeMonth !== monthName)) return;
      if (remember) lsSet(LAST_MONTH_KEY, monthName);
      lsSet(CACHE_PREFIX + monthName, JSON.stringify(dataObj));
    }

    const osDarkQuery = window.matchMedia('(prefers-color-scheme: dark)');

    function applyThemeMode() {
      const pref = lsGet(THEME_KEY) || 'auto';
      const isDark = pref === 'auto' ? osDarkQuery.matches : (pref === 'dark');
      document.documentElement.classList.toggle('dark', isDark);

      const iconName = pref === 'auto' ? 'contrast' : (isDark ? 'moon' : 'sun');
      const label = pref === 'auto' ? 'Auto' : (isDark ? 'Dark' : 'Light');
      const d = document.getElementById('themeBtnDesktop');
      const mIcon = document.getElementById('themeMenuIcon');
      const mLbl = document.getElementById('themeMenuLabel');
      if (d) d.innerHTML = icon(iconName, 'w-4 h-4');
      if (mIcon) mIcon.innerHTML = icon(iconName, 'w-4 h-4');
      if (mLbl) mLbl.textContent = label;
    }

    // Segmented buttons: the chosen one gets the `on` classes, the rest `off`. `on` can be a function of the key, for
    // the buttons that colour their chosen state differently.
    function markChoice(prefix, keys, chosen, on, off) {
      keys.forEach(k => {
        const el = document.getElementById(prefix + k);
        if (!el) return;
        el.className = k === chosen ? (typeof on === 'function' ? on(k) : on) : off;
        el.setAttribute('aria-pressed', String(k === chosen));   // for screen readers, which can't see the colour
      });
    }
    // The sheets' buttons, 44px tall everywhere: two-way toggles (TOGGLE_IN for a chosen "money in" side) and the card
    // picker. markToggle marks a toggle whose `inKey` choice is money in.
    const TOGGLE_ON = 'min-h-[44px] rounded-lg bg-white dark:bg-slate-900 text-slate-900 dark:text-white';
    const TOGGLE_IN = 'min-h-[44px] rounded-lg bg-white dark:bg-slate-900 text-emerald-600 dark:text-emerald-400';
    const TOGGLE_OFF = 'min-h-[44px] rounded-lg text-slate-500 dark:text-slate-400';
    const CARD_ON = 'min-h-[44px] rounded-xl bg-emerald-500 text-slate-950';
    const CARD_OFF = 'min-h-[44px] rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300';
    const markToggle = (prefix, keys, chosen, inKey) => markChoice(prefix, keys, chosen, k => k === inKey ? TOGGLE_IN : TOGGLE_ON, TOGGLE_OFF);

    // ---- Overflow menu (phone header) ----
    // Its button has data-stop, so the tap that opens the menu doesn't reach the page's close-on-tap below.
    function toggleMenu() {
      const panel = document.getElementById('menuPanel');
      const open = !panel.classList.toggle('hidden');
      document.getElementById('menuBtn').setAttribute('aria-expanded', String(open));
    }
    function closeMenu() {
      const panel = document.getElementById('menuPanel');
      if (panel) panel.classList.add('hidden');
      const btn = document.getElementById('menuBtn');
      if (btn) btn.setAttribute('aria-expanded', 'false');
    }
    document.addEventListener('click', e => { if (!e.target.closest('#menuPanel')) closeMenu(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') closeMenu(); });

    // ---- Spending summary: where the card money went this month ----
    // Cards only (Amex + Barclays). Categories are guessed from the merchant text; your own choices are kept on
    // all your devices (saved by the backend) and win over the guess. Card payments and balance adjustments are not spending.
    // <spending-core>
    const SPEND_CATEGORIES = ['Groceries', 'Eating out', 'Transport', 'Bills & subscriptions', 'Shopping', 'Travel', 'Entertainment', 'Health', 'Other'];
    // First matching rule wins, so the specific ones ("uber eats", "sains petrol") sit above the general ones.
    const SPEND_RULES = [
      ['Eating out', /uber ?eats|deliveroo|just ?eat|mcdo|mcdonald|burger|\bwolf\b|spoons|pretzel|cafe|café|kebab|wasabi|\btea\b|coffee|pizza|restaurant|takeaway|\bpub\b/],
      ['Travel', /airport|hotel|airbnb|flight|ryanair|easyjet|ferry|holiday/],
      ['Transport', /petrol|\btfl\b|taxi|\bbus\b|train|fuel|\buber\b|trainline|railcard/],
      ['Groceries', /waitrose|sainsbur|sains|tesco|lidl|aldi|\bcoop\b|co-op|\bm&s\b|asda|morrisons|iceland|ocado|nespresso|grocer/],
      ['Bills & subscriptions', /spotify|netflix|disney|\bsky\b|windscribe|curve|\bsub\b|subscription|premium|\byt\b|youtube|\bo2\b|\bee\b|broadband|phone|energy|water|insurance|monthly fee/],
      ['Entertainment', /comedy|cinema|theatre|\bgig\b|ticket|\bpsn\b|steam|\bgame/],
      ['Health', /pharmacy|\bboots\b|dentist|optician|vitality|doctor|\bgp\b/],
      ['Shopping', /amazon|ebay|vinted|primark|home barg|the works|\bdhl\b|oxfam|argos|post office|savers|temu|\bwise\b/]
    ];
    // Your own extra words for a category (local places), which the backend sends once you're signed in, so they
    // aren't in this public page. Each counts as part of its category's rule above, in the same order.
    let SPEND_EXTRA = {};
    function setSpendWords(words) {
      const out = {};
      Object.keys(words && typeof words === 'object' ? words : {}).forEach(cat => {
        const list = (Array.isArray(words[cat]) ? words[cat] : []).map(w => String(w).trim().toLowerCase()).filter(Boolean);
        if (SPEND_CATEGORIES.indexOf(cat) !== -1 && list.length) out[cat] = new RegExp(list.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'));
      });
      SPEND_EXTRA = out;
    }
    const SPEND_SKIP = /payment|^balance$|^start$/;
    function spendKey(desc) { return String(desc || '').trim().toLowerCase().replace(/\s+/g, ' ').slice(0, 60); }
    function guessCategory(key) {
      for (const [cat, re] of SPEND_RULES) if (re.test(key) || (SPEND_EXTRA[cat] && SPEND_EXTRA[cat].test(key))) return cat;
      return 'Other';
    }
    function categoryFor(desc, overrides) {
      const key = spendKey(desc);
      const own = overrides && overrides[key];
      return own && SPEND_CATEGORIES.indexOf(own) !== -1 ? own : guessCategory(key);
    }
    function summariseSpend(st, overrides) {
      const cats = {};
      let total = 0;
      ['amex', 'barclays'].forEach(acct => (st && st[acct] || []).forEach(r => {
        const key = spendKey(r.desc);
        if (!key || SPEND_SKIP.test(key)) return;
        const amt = -Number(r.amount || 0);   // spends are negative in the sheet; refunds positive
        if (!amt) return;
        const cat = categoryFor(key, overrides);
        const c = cats[cat] || (cats[cat] = { cat, total: 0, merchants: Object.create(null) });   // shops are keyed by sheet text (see groupOwed)
        c.total += amt;
        total += amt;
        const m = c.merchants[key] || (c.merchants[key] = { key, name: String(r.desc).trim(), total: 0, count: 0 });
        m.total += amt;
        m.count++;
      }));
      const r2 = n => +n.toFixed(2);
      const categories = Object.values(cats)
        .map(c => ({ cat: c.cat, total: r2(c.total), merchants: Object.values(c.merchants).map(m => ({ key: m.key, name: m.name, total: r2(m.total), count: m.count })).sort((a, b) => b.total - a.total) }))
        .sort((a, b) => b.total - a.total);
      return { total: r2(total), categories };
    }
    // Payday is the 30th (the last day in February), or the Friday before when that falls on a weekend.
    function paydayIn(year, month) {
      const d = new Date(year, month, Math.min(30, new Date(year, month + 1, 0).getDate()));
      const dow = d.getDay();
      if (dow === 6) d.setDate(d.getDate() - 1);
      if (dow === 0) d.setDate(d.getDate() - 2);
      return d;
    }
    // The next payday on or after `today` (local time), and the whole days until it (0 on payday itself).
    function nextPayday(today) {
      const t = new Date(today.getFullYear(), today.getMonth(), today.getDate());
      let p = paydayIn(t.getFullYear(), t.getMonth());
      if (p < t) p = paydayIn(t.getFullYear(), t.getMonth() + 1);
      return { date: p, days: Math.round((p - t) / 86400000) };
    }
    // One category against last month: up or down by how much, the same (within 50p), or new this month.
    function compareSpend(now, before) {
      if (!(before > 0.005)) return { kind: 'new' };
      const diff = +(now - before).toFixed(2);
      if (Math.abs(diff) < 0.5) return { kind: 'same' };
      return { kind: diff > 0 ? 'up' : 'down', diff: Math.abs(diff) };
    }
    // </spending-core>

    const SPEND_COLOURS = { 'Groceries': '#10b981', 'Eating out': '#f59e0b', 'Transport': '#0ea5e9', 'Bills & subscriptions': '#8b5cf6', 'Shopping': '#ec4899', 'Travel': '#14b8a6', 'Entertainment': '#f97316', 'Health': '#ef4444', 'Other': '#94a3b8' };
    let spendOpenCat = null;
    function loadSpendOverrides() {
      const o = lsJson(SPEND_OVERRIDES_KEY);
      return o && typeof o === 'object' ? o : {};
    }
    // The sheet's backend keeps your choices so every device agrees; this device keeps a copy so the view
    // still works offline. The server's copy wins whenever it is fetched.
    function storeSpendOverrides(map) { lsSet(SPEND_OVERRIDES_KEY, JSON.stringify(map || {})); }
    function applyCategoryChoices(reply) {
      if (!reply || !reply.choices) return;
      storeSpendOverrides(reply.choices);
      if (!document.getElementById('spendModal').classList.contains('hidden')) renderSpend();
    }
    function setSpendCategory(key, cat) {
      const o = loadSpendOverrides();
      if (SPEND_CATEGORIES.indexOf(cat) === -1) { delete o[key]; cat = ''; } else o[key] = cat;
      storeSpendOverrides(o);
      renderSpend();
      apiCall('setCategoryChoice', { merchant: key, category: cat })
        .then(applyCategoryChoices)
        .catch(err => {
          console.error('category save error:', err);
          showToast("Couldn't save that category change - it will revert when you next open Spending.");
        });
    }
    function toggleSpendCat(cat) { spendOpenCat = spendOpenCat === cat ? null : cat; renderSpend(); }
    // Wide enough for six month bars with full amounts (the same 640px line as Tailwind's sm:, where the box stops
    // being a bottom sheet). Folding or unfolding with Spending open redraws it.
    const SPEND_WIDE_MQ = window.matchMedia('(min-width: 640px)');
    if (SPEND_WIDE_MQ.addEventListener) SPEND_WIDE_MQ.addEventListener('change', () => {
      if (!document.getElementById('spendModal').classList.contains('hidden')) renderSpend();
    });
    function openSpendModal() {
      closeMenu();
      spendOpenCat = null;
      renderSpend();
      document.getElementById('spendModal').classList.remove('hidden');
      apiCall('getCategoryChoices').then(applyCategoryChoices).catch(() => {});   // quiet: the saved copy is already showing
    }
    function closeSpendModal() { document.getElementById('spendModal').classList.add('hidden'); }

    // Month tabs are named like "October Payday 2026".
    const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    // A month name -> a sortable number (year * 12 + month), or 0 if the name doesn't follow that pattern.
    function monthSortValue(name) {
      const i = MONTHS.findIndex(m => String(name).toLowerCase().startsWith(m.toLowerCase()));
      const y = String(name).match(/\b(20\d{2})\b/);
      return i === -1 || !y ? 0 : Number(y[1]) * 12 + i;
    }
    const newestFirst = (a, b) => monthSortValue(b) - monthSortValue(a);
    // Totals for every month this device has loaded before (the current one comes from live state), newest first.
    function spendMonthTotals(overrides) {
      const out = [];
      [...new Set((state.availableMonths || []).concat(activeMonth))].sort(newestFirst).forEach(name => {
        const st = name === activeMonth ? state : savedMonth(name);
        if (st) out.push({ name, total: summariseSpend(st, overrides).total });
      });
      return out;
    }

    // The month before the one on screen: by name when the names say so ("October Payday 2026"), otherwise the next
    // tab along (the sheet keeps the newest first).
    function previousMonthName() {
      const months = state.availableMonths || [];
      const v = monthSortValue(activeMonth);
      const older = v ? months.filter(m => monthSortValue(m) && monthSortValue(m) < v).sort(newestFirst) : [];
      if (older.length) return older[0];
      const i = months.indexOf(activeMonth);
      return i > -1 && i + 1 < months.length ? months[i + 1] : null;
    }
    // Last month's figures from this device's saved copy. Without one, they're fetched once, quietly, and the
    // Spending details redrawn when they arrive.
    let prevMonthAsked = null;
    function previousMonthState(name) {
      const st = savedMonth(name);
      if (st) return st;
      if (prevMonthAsked !== name) {
        prevMonthAsked = name;
        apiCall('getCachedSheetState', { sheetName: name, forceRefresh: false })
          .then(s => {
            savePhoneCache(name, s, false);
            if (!document.getElementById('spendModal').classList.contains('hidden')) renderSpend();
          })
          .catch(() => {});
      }
      return null;
    }
    function spendChangeHtml(now, before, monthLabel) {
      const c = compareSpend(now, before);
      if (c.kind === 'new') return ' · New';
      if (c.kind === 'same') return ' · Same as ' + esc(monthLabel);
      const tone = c.kind === 'up' ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-600 dark:text-emerald-400';
      return ' · <span class="' + tone + '">' + (c.kind === 'up' ? '▲ ' : '▼ ') + fmtGBP(c.diff) + ' vs ' + esc(monthLabel) + '</span>';
    }

    function renderSpend() {
      const overrides = loadSpendOverrides();
      const sum = summariseSpend(state, overrides);
      const prevName = previousMonthName();
      const prevState = prevName ? previousMonthState(prevName) : null;
      const prevSum = prevState ? summariseSpend(prevState, overrides) : null;
      const prevLabel = prevName && monthSortValue(prevName) ? prevName.slice(0, 3) : 'last month';
      const catRows = sum.categories.filter(c => Math.abs(c.total) >= 0.005);
      const ringCats = catRows.filter(c => c.total > 0);
      const opts = sel => ['<option value="">Automatic</option>'].concat(SPEND_CATEGORIES.map(c => '<option value="' + esc(c) + '"' + (c === sel ? ' selected' : '') + '>' + esc(c) + '</option>')).join('');
      let html = '<div class="flex items-center gap-5">' + spendRing(ringCats, sum.total, 120, 13)
        + '<div class="min-w-0"><div class="text-sm text-slate-500 dark:text-slate-400">Spent on cards</div>'
        + '<div class="text-3xl font-semibold tracking-tight tabular-nums text-slate-900 dark:text-white">' + fmtGBP(sum.total) + '</div>'
        + '<div class="text-sm text-slate-500 dark:text-slate-400 truncate">' + esc(activeMonth) + '</div></div></div>';
      if (!catRows.length) html += '<p class="text-sm text-slate-500 dark:text-slate-400">No card spending recorded in this month yet.</p>';
      html += '<div class="divide-y divide-slate-100 dark:divide-slate-800/70">';
      catRows.forEach(c => {
        const pct = sum.total > 0 ? Math.round(c.total / sum.total * 100) : 0;
        const open = spendOpenCat === c.cat;
        const colour = SPEND_COLOURS[c.cat] || '#94a3b8';
        const n = c.merchants.reduce((a, m) => a + m.count, 0);
        html += '<div>'
          + '<button data-cat="' + esc(c.cat) + '" data-action="toggleSpendCat" class="w-full text-left py-2.5 flex items-center gap-3" aria-expanded="' + open + '">'
          + '<span class="w-9 h-9 rounded-xl shrink-0 inline-flex items-center justify-center" style="background:' + colour + '26;color:' + colour + '">' + icon(CAT_ICON_NAMES[c.cat] || 'cat_other', 'w-[18px] h-[18px]') + '</span>'
          + '<span class="min-w-0 flex-1"><span class="block text-sm font-semibold text-slate-900 dark:text-white">' + esc(c.cat) + '</span>'
          + '<span class="block text-xs text-slate-500 dark:text-slate-400">' + n + (n === 1 ? ' purchase' : ' purchases') + ' · ' + pct + '%'
          + (prevSum ? spendChangeHtml(c.total, (prevSum.categories.find(x => x.cat === c.cat) || { total: 0 }).total, prevLabel) : '') + '</span></span>'
          + '<span class="tabular-nums text-sm font-semibold text-slate-900 dark:text-white">' + fmtGBP(c.total) + '</span>'
          + '<span class="text-slate-400">' + icon(open ? 'chevron_up' : 'chevron_down', 'w-4 h-4') + '</span></button>';
        if (open) {
          html += '<div class="pl-12 pb-2 divide-y divide-slate-100 dark:divide-slate-800/70 text-sm">';
          c.merchants.forEach(m => {
            html += '<div class="py-2 flex items-center gap-2"><div class="min-w-0 flex-1"><div class="truncate text-slate-700 dark:text-slate-200">' + esc(displayName(m.name)) + (m.count > 1 ? ' <span class="text-slate-500 dark:text-slate-400">×' + m.count + '</span>' : '') + '</div></div>'
              + '<span class="tabular-nums text-slate-700 dark:text-slate-200">' + fmtGBP(m.total) + '</span>'
              + '<select data-key="' + esc(m.key) + '" data-change="setSpendCategory" aria-label="Category for ' + esc(m.name) + '" class="h-9 max-w-[7.5rem] rounded-full bg-transparent text-slate-600 dark:text-slate-300 border border-slate-300 dark:border-slate-700 text-xs px-2">' + opts(overrides[m.key]) + '</select></div>';
          });
          html += '</div>';
        }
        html += '</div>';
      });
      html += '</div>';
      // Month by month: the months this device has loaded, oldest on the left, this month highlighted.
      // Full amounts ("£1,234.56") fit four bars across on a folded phone, six in the wider box.
      const months = spendMonthTotals(overrides).slice(0, SPEND_WIDE_MQ.matches ? 6 : 4).reverse();
      if (months.length > 1) {
        const mtop = Math.max(1, ...months.map(m => m.total));
        const label = name => monthSortValue(name) ? String(name).slice(0, 3) : String(name).split(' ')[0];
        html += '<div><div class="text-sm font-semibold text-slate-500 dark:text-slate-400 mb-2">Month by month</div><div class="flex items-end gap-2 h-28">';
        months.forEach(m => {
          const on = m.name === activeMonth;
          html += '<div class="flex-1 h-full flex flex-col items-center justify-end gap-1.5">'
            + '<span class="text-xs tabular-nums text-slate-500 dark:text-slate-400">' + fmtGBP(m.total) + '</span>'
            + '<div class="w-full max-w-[44px] rounded-md ' + (on ? 'bg-emerald-500' : 'bg-slate-200 dark:bg-slate-700') + '" style="height:' + Math.max(4, Math.round(Math.max(0, m.total) / mtop * 70)) + 'px"></div>'
            + '<span class="text-xs ' + (on ? 'font-semibold text-slate-900 dark:text-white' : 'text-slate-500 dark:text-slate-400') + '">' + esc(label(m.name)) + '</span></div>';
        });
        html += '</div></div>';
      }
      html += '<p class="text-xs text-slate-500 dark:text-slate-400">Amex and Barclays, as charged, before anything others pay back. Tap a category to see where it went; change a shop\'s category with its menu and it is remembered on all your devices.</p>';
      document.getElementById('spendBody').innerHTML = html;
    }

    // ---- Phone views: the bottom bar switches between Home (everything) and one focused section ----
    const PHONE_MQ = window.matchMedia('(max-width: 1023px)');   // must match the 1023px / 1024px lines in the CSS above
    // The three main sections (each also a phone tab): the box, its body and its ▾ button.
    const SECTIONS = {
      budgets: { sec: 'sec_budgets', body: 'budgetsBody', chev: 'chevBudgets' },
      pending: { sec: 'sec_pending', body: 'pendingBody', chev: 'chevPending' },
      activity: { sec: 'sec_activity', body: 'activityBody', chev: 'chevActivity' }
    };
    // On a phone, showing tab v (budgets, pending or activity). On a desktop there are no tabs: everything shows.
    function onPhoneTab(v) { return document.body.dataset.view === v && PHONE_MQ.matches; }
    function setView(v) {
      document.body.dataset.view = v;
      document.querySelectorAll('[data-nav]').forEach(b => {
        const on = b.dataset.nav === v;
        b.classList.toggle('text-emerald-500', on);
        b.classList.toggle('font-semibold', on);
        if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
      });
      if (SECTIONS[v]) setSectionOpen(v, true);
      renderAll();   // the Bills and Activity tabs list everything; Home shows the first few
      window.scrollTo({ top: 0 });
      syncHistory();
    }

    // ---- Back (Android's Back gesture, or the browser's back button) ----
    // An open sheet, and a phone tab other than Home, are each one step in the browser's history, so Back closes the
    // sheet, then goes back to Home, before it leaves the app. history.state.pfDepth is how many steps an entry is.
    // Escape closes a sheet too. Sheets are watched (a MutationObserver), so every way of opening or closing one counts,
    // even a close that is turned down (Sign out while busy); tabs change only in setView, which calls syncHistory.
    // A new sheet goes in SHEETS (with its close function) and gets the kb-sheet class; a test checks the two match.
    const SHEETS = [['spendModal', closeSpendModal], ['addModal', closeAddModal], ['editTxModal', closeEditTxModal],
      ['newMonthModal', closeNewMonthModal], ['passkeyModal', closePasskeyModal], ['signOutModal', closeSignOutModal],
      ['budgetModal', closeBudgetForm]];
    const sheetOpen = id => !document.getElementById(id).classList.contains('hidden');
    // Closes the first open sheet in SHEETS (two are never open together). True if one was open, even if it stayed
    // open (Sign out while busy), so that Back doesn't go on to change the tab as well.
    function closeTopSheet() {
      const top = SHEETS.find(([id]) => sheetOpen(id));
      if (top) top[1]();
      return !!top;
    }
    document.addEventListener('keydown', e => { if (e.key === 'Escape') closeTopSheet(); });
    const historyDepth = () => (history.state && history.state.pfDepth) || 0;
    const wantedDepth = () => (document.body.dataset.view !== 'home' && PHONE_MQ.matches ? 1 : 0) + (SHEETS.some(([id]) => sheetOpen(id)) ? 1 : 0);
    let historyMoving = false, historyMovingTimer = 0;   // a history.go() of ours is on its way (its popstate isn't a Back)
    function historyGo(steps) {
      historyMoving = true;
      clearTimeout(historyMovingTimer);
      historyMovingTimer = setTimeout(() => { historyMoving = false; }, 1000);   // should its popstate never come
      history.go(steps);
    }
    // Brings the history in line with what shows: a step added when a sheet or tab opens, taken off when it closes.
    function syncHistory() {
      if (IS_GAS_ENV || historyMoving) return;
      const want = wantedDepth();
      let have = historyDepth();
      while (have < want) history.pushState({ pfDepth: ++have }, '');
      if (have > want) historyGo(want - have);
    }
    if (!IS_GAS_ENV) {
      // Reloaded with a sheet or tab open (Sign out and "Reload" do that): nothing is open now, so go back down to the
      // app's bottom entry, or the first Back would do nothing.
      if (historyDepth()) historyGo(-historyDepth());
      window.addEventListener('popstate', () => {
        if (historyMoving) { historyMoving = false; clearTimeout(historyMovingTimer); syncHistory(); return; }
        // Back: take off what shows, one step for each step gone back (the top sheet first, then the tab).
        for (let i = wantedDepth() - historyDepth(); i > 0; i--) {
          if (!closeTopSheet() && document.body.dataset.view !== 'home') setView('home');
        }
        syncHistory();   // e.g. a sheet that wouldn't close (Sign out while it is busy) gets its step back
      });
      const watchSheets = new MutationObserver(syncHistory);
      SHEETS.forEach(([id]) => watchSheets.observe(document.getElementById(id), { attributes: true, attributeFilter: ['class'] }));
    }
    // Folding or unfolding the phone (or resizing a window) across the phone/desktop line changes what the lists show.
    // A section folded on the desktop must open again if it becomes a phone tab, which has no ▾ to open it.
    if (PHONE_MQ.addEventListener) PHONE_MQ.addEventListener('change', () => {
      const v = document.body.dataset.view;
      if (SECTIONS[v] && PHONE_MQ.matches) setSectionOpen(v, true);
      renderAll();
      syncHistory();   // a tab is a Back step only on a phone
    });

    // ---- Long lists show a few rows with a "Show all" toggle instead of scrolling inside the page ----
    // (Home on a phone shows HOME_TX_PREVIEW spends and "See all", which opens the Activity tab.)
    const BILLS_PREVIEW = 6, TX_PREVIEW = 8, HOME_TX_PREVIEW = 4, SETTLED_PREVIEW = 5;
    const showAll = { bills: false, tx: false, settled: false };
    function toggleShowAll(key) { showAll[key] = !showAll[key]; renderAll(); }
    function showMoreBtn(key, total, limit) {
      if (total <= limit) return '';
      return `<button data-action="toggleShowAll" data-arg="${key}" class="w-full h-11 text-xs font-semibold text-emerald-600 dark:text-emerald-400 inline-flex items-center justify-center gap-1">
        ${showAll[key] ? 'Show fewer ' + icon('chevron_up', 'w-3.5 h-3.5') : 'Show all ' + total + ' ' + icon('chevron_down', 'w-3.5 h-3.5')}
      </button>`;
    }

    function seeAllActivityBtn(total) {
      if (total <= HOME_TX_PREVIEW) return '';
      return `<button data-action="setView" data-arg="activity" class="w-full h-11 text-xs font-semibold text-emerald-600 dark:text-emerald-400 inline-flex items-center justify-center">See all</button>`;
    }

    function cycleTheme() {
      const cur = lsGet(THEME_KEY) || 'auto';
      lsSet(THEME_KEY, cur === 'auto' ? 'light' : (cur === 'light' ? 'dark' : 'auto'));
      applyThemeMode();
    }

    if (osDarkQuery.addEventListener) {
      osDarkQuery.addEventListener('change', () => {
        if ((lsGet(THEME_KEY) || 'auto') === 'auto') applyThemeMode();
      });
    }

    function setSectionOpen(key, open) {
      document.getElementById(SECTIONS[key].body).classList.toggle('hidden', !open);
      const chev = document.getElementById(SECTIONS[key].chev);
      chev.textContent = open ? '▾' : '▸';
      chev.setAttribute('aria-expanded', String(open));
    }
    function toggleSection(key) {
      if (onPhoneTab(key)) return;   // a phone tab that is this one section can't fold it away (its ▾ is hidden there too)
      setSectionOpen(key, document.getElementById(SECTIONS[key].body).classList.contains('hidden'));
    }

    function jumpToSection(target) {
      if (target === 'top') return window.scrollTo({ top: 0, behavior: 'smooth' });
      if (!SECTIONS[target]) return;
      setSectionOpen(target, true);
      document.getElementById(SECTIONS[target].sec).scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    // Escape text from the sheet before it goes into innerHTML.
    function esc(s) {
      return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }

    // Click handlers pass only an account and row number; the text is looked up from state, so awkward
    // characters in a description can never break the markup. Pending (unsaved) rows are skipped.
    function openEditTxForRow(acct, row) {
      const r = (state[acct] || []).find(x => x.row === row && !x.pending);
      if (r) openEditTxModal(acct, r.row, r.desc, r.amount);
    }
    function openBudgetFormForRow(row) {
      const b = state.budgets.find(x => x.row === row && !x.pending);
      if (b) openBudgetForm(b.row, b.name, b.amount, b.isRecurring);
    }

    // Display only: a real minus sign (−), which lines up with + and digits better than a hyphen.
    function fmtGBP(val) {
      const n = Number(val || 0);
      return (n < 0 ? '−' : '') + '£' + Math.abs(n).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }
    // With a + for money in: "+£12.00", "−£12.00".
    function fmtSigned(val) { return (val > 0 ? '+' : '') + fmtGBP(val); }
    // Colour of a bill or spend amount: plain when money goes out, green when it comes in (Owed uses amtTone instead).
    function moneyTone(val) { return val < 0 ? 'text-slate-900 dark:text-white' : 'text-emerald-600 dark:text-emerald-400'; }

    // Shown in place of a row's buttons until the server has saved it.
    const SAVING_TAG = '<span class="text-xs text-slate-500 dark:text-slate-400">saving…</span>';
    // A list with nothing left in it ("All clear", "Nothing owed").
    function emptyRow(text, pad) {
      if (state.loading) return `<div class="${pad} text-xs text-slate-500 dark:text-slate-400 text-center w-full">Loading…</div>`;
      return `<div class="${pad} text-xs text-slate-500 dark:text-slate-400 text-center inline-flex items-center justify-center gap-1.5 w-full">${icon('check', 'w-4 h-4 text-emerald-500')} ${text}</div>`;
    }

    // Display only: "sam Groceries" shows as "Sam Groceries". The sheet keeps whatever was typed.
    function displayName(s) {
      const t = String(s == null ? '' : s).trim();
      return t.charAt(0).toUpperCase() + t.slice(1);
    }

    // While a month switch is in flight, replies for any other month (e.g. a slow save started before the
    // switch) are cached but not shown, so they can't flip the screen back.
    let pendingSwitchTarget = null;

    // `fresh`: skip the server's saved copy (after a month was just made or replaced).
    function switchMonth(monthName, fresh) {
      activeMonth = monthName;
      pendingSwitchTarget = monthName;
      skippedBudgetRows.clear();
      closeBudgetForm();   // it belongs to the month you were on
      // Nothing saved for that month yet: show it empty until it arrives, never the old month's rows (a tap on one of
      // those would be sent to the new month).
      if (!loadPhoneCache(monthName)) state = { ...loadingState(), availableMonths: state.availableMonths || [] };
      renderAll();

      const done = () => { if (pendingSwitchTarget === monthName) pendingSwitchTarget = null; };   // not a later switch's
      apiCall('getCachedSheetState', { sheetName: monthName, forceRefresh: !!fresh })
        .then(s => { done(); applyServerState(s); })
        .catch(err => {
          done();
          console.error(err);
          if (err && !err.auth && !err.needsSignIn && activeMonth === monthName) showToast("Couldn't load " + monthName + '. Try again in a moment.');
        });
    }

    // The sync button (and the red caption): fetch the sheet afresh, then send anything saved on this device.
    function forceSyncSheet() {
      apiCall('getCachedSheetState', { sheetName: activeMonth, forceRefresh: true })
        .then(applyServerState)
        .catch(err => console.error(err))
        .then(flushOutbox);
    }

    function applyServerState(s) {
      if (!s) return;
      numberRows(s);
      if (s.config) applyConfig(s.config, true);   // older backends send none: the names this device has are kept
      if (pendingSwitchTarget && s.activeMonth !== pendingSwitchTarget) {
        savePhoneCache(s.activeMonth, s, false);
        return;
      }
      activeMonth = s.activeMonth;
      state = s;
      savePhoneCache(activeMonth, s);
      pruneLocalMonths(s.availableMonths);
      const sel = document.getElementById('monthSelector');
      if (s.availableMonths && s.availableMonths.length) {
        sel.innerHTML = s.availableMonths.map(m => `<option value="${esc(m)}" ${m === activeMonth ? 'selected' : ''}>${esc(m)}</option>`).join('');
      }
      if (SHEET_LINK.test(String(s.sheetUrl || ''))) {   // only ever a link to a Google Sheet
        document.getElementById('rawSheetBtn').href = s.sheetUrl;
        const menuLink = document.getElementById('rawSheetMenuBtn');
        if (menuLink) menuLink.href = s.sheetUrl;
      }
      renderAll();
    }

    // Saved copies of months that are no longer in the sheet are deleted from this device.
    function pruneLocalMonths(available) {
      if (!Array.isArray(available) || !available.length) return;
      const keep = new Set(available);
      lsKeys().forEach(k => {
        const prefix = [CACHE_PREFIX, TX_TS_PREFIX].find(p => k.indexOf(p) === 0);
        if (prefix && !keep.has(k.slice(prefix.length))) lsDel(k);
      });
    }

    // For a save that targets a specific month: if you've since moved to another month, keep the reply in the
    // cache but leave the screen on the month you're viewing.
    function applyStateIfViewing(month) {
      return s => {
        if (s && month !== activeMonth && s.activeMonth !== activeMonth) savePhoneCache(s.activeMonth, s, false);
        else applyServerState(s);
      };
    }

    // opts: { kind: 'info' | 'error' (default), actionLabel, actionIcon (default 'undo'), onAction, duration, keep }
    // There is one toast on screen. A `keep` toast (an Undo) that a newer toast covers is put aside, with the time it
    // had left, and comes back once the newer one has gone, so an Undo is never lost unseen. Returns withdraw(): takes
    // this toast away, on screen or put aside (as when what it would undo didn't go through).
    let toastTimer = null, toastShown = null;
    const toastsAside = [];   // newest last
    function showToast(msg, opts = {}) {
      if (!document.getElementById('toast')) return () => {};
      if (toastShown && toastShown.opts.keep) {
        toastShown.left = toastShown.ends - Date.now();
        toastsAside.push(toastShown);
      }
      const t = { msg, opts };
      drawToast(t, opts.duration || 6000);
      return () => {
        const at = toastsAside.indexOf(t);
        if (at >= 0) toastsAside.splice(at, 1);
        if (toastShown === t) closeToast();
      };
    }
    // Every toast goes, those put aside too (the app has locked: nothing behind the lock screen can be undone).
    function dropToasts() {
      toastsAside.length = 0;
      if (toastShown) closeToast();
    }
    // The toast goes; the newest one put aside, if any, comes back (for at least 3 s).
    function closeToast() {
      clearTimeout(toastTimer);
      document.getElementById('toast').classList.add('hidden');
      toastShown = null;
      const next = toastsAside.pop();
      if (next) drawToast(next, Math.max(next.left, 3000));
    }
    function drawToast(t, ms) {
      const { msg, opts } = t;
      const el = document.getElementById('toast');
      // Set before the words change, so a screen reader reads them: a failure at once, anything else when it can.
      el.setAttribute('role', opts.kind === 'info' ? 'status' : 'alert');
      el.setAttribute('aria-live', opts.kind === 'info' ? 'polite' : 'assertive');
      el.className = 'fixed left-1/2 -translate-x-1/2 bottom-24 lg:bottom-6 z-[100000] max-w-sm w-[90%] px-4 py-2.5 rounded-xl text-white text-xs font-medium shadow-lg flex items-center justify-between gap-3 '
        + (opts.kind === 'info' ? 'bg-slate-800 border border-slate-600' : 'bg-rose-600');
      el.innerHTML = '<span class="flex-1 text-left"></span>'
        + (opts.actionLabel ? '<button id="toastAction" class="font-bold text-emerald-300 px-2.5 h-9 -my-1.5 -mr-2 rounded-lg inline-flex items-center gap-1">' + icon(opts.actionIcon || 'undo', 'w-3.5 h-3.5') + esc(opts.actionLabel) + '</button>' : '');
      el.firstChild.textContent = msg;
      clearTimeout(toastTimer);
      if (opts.actionLabel) {
        document.getElementById('toastAction').onclick = () => { closeToast(); opts.onAction(); };
      }
      toastShown = t;
      t.ends = Date.now() + ms;
      toastTimer = setTimeout(closeToast, ms);
    }

    // "Done / Undo" for a change shown at once. `done` (from mutate) settles true once the change is in the sheet,
    // false if it didn't go through: then the Undo is taken away, and one tapped before the reply does nothing (there
    // is nothing to undo, and undoing it would, say, add a second copy). Otherwise onUndo runs once it is in.
    function offerUndo(msg, done, onUndo) {
      const withdraw = showToast(msg, { kind: 'info', actionLabel: 'Undo', duration: 9000, keep: true,
        onAction: () => done.then(ok => { if (ok) onUndo(); }) });
      done.then(ok => { if (!ok) withdraw(); });
    }

    // ---- Sync status: the sync button's colour and label, and a red caption when a sync failed ----
    function relTime(t) {
      const s = Math.floor((Date.now() - t) / 1000);
      if (s < 45) return 'just now';
      if (s < 3600) return Math.round(s / 60) + ' min ago';
      return 'at ' + new Date(t).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
    }
    // The red caption, the only words the sync status shows (short enough for one line on a 344px phone).
    const SYNC_FAILED = {
      reach: { text: "Couldn't reach your sheet. Tap ↻ to try again.", label: "Couldn't reach your sheet. Tap to try again" },
      refused: { text: 'Your sheet turned down the last change.', label: 'Your sheet turned down the last change. Tap to sync' },
      setAside: { text: "A spend couldn't be sent. Tap ↻ to try again.", label: "A spend saved on this device couldn't be sent. Tap to try again" }
    };
    // The sync button shows the status by its colour (green synced, amber syncing or something waiting to send, grey
    // offline, red failed). Its tooltip and screen-reader label say it in words, including when it last synced.
    // A spend set aside comes before others still waiting: it needs you.
    function updateSyncUi() {
      const btn = document.getElementById('syncBtn'), note = document.getElementById('syncStatus');
      if (!btn || !note) return;
      const list = loadOutbox(), setAside = list.filter(x => x.setAside).length, waiting = list.length - setAside;
      const offline = !IS_GAS_ENV && navigator.onLine === false;
      const failed = setAside && !offline ? 'setAside' : lastSyncFailed;
      let status, label;
      if (apiInflight > 0) { status = 'busy'; label = 'Syncing…'; }
      else if (failed === 'setAside') { status = 'failed'; label = SYNC_FAILED.setAside.label; }
      else if (waiting) {
        status = 'waiting';
        label = waiting + (waiting === 1 ? ' spend' : ' spends') + ' waiting to send. ' + (offline ? (waiting === 1 ? 'It sends' : 'They send') + " when you're back online" : 'Tap to send now');
      }
      else if (offline) { status = 'offline'; label = 'Offline, showing saved figures'; }
      else if (failed) { status = 'failed'; label = SYNC_FAILED[failed].label; }
      else if (lastSyncAt) { status = 'synced'; label = 'Synced ' + relTime(lastSyncAt) + '. Tap to sync now'; }
      else { status = 'saved'; label = 'Showing saved figures. Tap to sync'; }
      btn.dataset.sync = status;
      btn.title = label;
      btn.setAttribute('aria-label', label);
      document.getElementById('syncText').textContent = status === 'failed' ? SYNC_FAILED[failed].text : '';
      note.classList.toggle('hidden', status !== 'failed');
      const spin = btn.querySelector('svg');
      if (spin) spin.classList.toggle('animate-spin', apiInflight > 0);
    }
    setInterval(updateSyncUi, 20000);

    // A save failed: say so, then reload the real sheet state so the screen never silently disagrees with it.
    function handleSaveError(what, err) {
      // Saved after all, only its new figures couldn't be read back: nothing to say (a "Deleted / Undo" toast stays
      // up), just fetch them.
      if (failureKind(err) === 'saved') return refreshFromSheet(true);
      console.error(what + ' error:', err);
      // The server refuses an edit or delete when the row changed on another device since this screen loaded.
      const stale = /STALE/.test(String(err && err.message));
      showToast(stale ? 'That entry changed on another device, so nothing was changed. Showing the latest.' : "Couldn't save " + what + ' - refreshing from your sheet.');
      refreshFromSheet();
    }

    // A change shown straight away, before the sheet has it. `change()` updates `state` and returns how to undo that
    // (or nothing); `send()` makes the request. If the save fails, other than 'saved' (it is in the sheet), the change
    // is undone on screen and in the saved copy before the sheet is fetched afresh, so a fetch that fails too
    // (offline) can't leave it there; unless the sheet's figures or another month have replaced the screen since.
    // Resolves true once the change is in the sheet, false if it isn't.
    function mutate(what, change, send, onReply = applyServerState) {
      const month = activeMonth, shown = state;
      const undo = change();
      savePhoneCache(month, state);
      renderAll();
      return send().then(s => {
        try { onReply(s); } catch (e) { console.error('after the save:', e); }
        return true;
      }, err => {
        const saved = failureKind(err) === 'saved';
        if (!saved && undo && state === shown && activeMonth === month) {
          undo();
          renderAll();   // first: it works out the totals the saved copy holds
          savePhoneCache(month, state);
        }
        handleSaveError(what, err);
        return saved;
      });
    }
    // Undo helpers for mutate. keepFields: what puts back the fields an object holds now. removeItem: takes an item out
    // of its list; what puts it back. takeOut: what takes an added item out again.
    const keepFields = (obj, keys) => { const was = keys.map(k => [k, obj[k]]); return () => was.forEach(([k, v]) => { obj[k] = v; }); };
    const removeItem = (list, item) => {
      const at = list.indexOf(item);
      if (at >= 0) list.splice(at, 1);
      return () => { if (at >= 0 && !list.includes(item)) list.splice(at, 0, item); };
    };
    const takeOut = (list, item) => () => { const at = list.indexOf(item); if (at >= 0) list.splice(at, 1); };

    function recomputeSummary() {
      const s = state.summary;
      s.budgetRem = +state.budgets
        .filter(b => !skippedBudgetRows.has(b.row))
        .reduce((a, b) => a + Number(b.amount || 0), 0).toFixed(2);
      s.checkingExpected = +(s.nCA + s.budgetRem).toFixed(2);
      s.eomSavingsJ = +(s.checkingExpected + s.amex + s.barclays).toFixed(2);
    }

    // Money Left spread over the days until payday, shown only on the newest month (older months are history).
    function renderDailyStrip(left) {
      const strip = document.getElementById('dailyStrip');
      const months = state.availableMonths || [];
      if (!months.length || activeMonth !== months[0] || !isFinite(Number(left))) { strip.classList.add('hidden'); return; }
      const pay = nextPayday(new Date());
      const fig = (cls, amount, words) => '<span class="font-semibold tabular-nums ' + cls + '">' + fmtGBP(amount) + '</span> <span class="text-slate-500 dark:text-slate-400">' + words + '</span>';
      document.getElementById('dailyLeft').innerHTML = pay.days === 0
        ? '<span class="font-semibold text-emerald-700 dark:text-emerald-300">Payday today</span>'
        : Number(left) <= 0
          ? fig('text-rose-600 dark:text-rose-400', Math.abs(Number(left)), 'over')
          : fig('text-emerald-700 dark:text-emerald-300', Math.floor(Number(left) / pay.days * 100) / 100, 'a day');
      document.getElementById('dailyPayday').textContent = pay.days === 0 ? ''
        : 'Payday ' + pay.date.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }).replace(',', '');
      strip.classList.remove('hidden');
    }

    function renderAll() {
      recomputeSummary();
      const s = state.summary;
      const money = n => state.loading ? '£—' : fmtGBP(n);
      document.getElementById('kpiAmex').textContent = money(s.amex);
      document.getElementById('kpiBarclays').textContent = money(s.barclays);
      document.getElementById('kpiNCA').textContent = money(s.nCA);
      document.getElementById('kpiMarcus').textContent = money(s.mSAV);
      document.getElementById('kpiSurplus').textContent = money(s.eomSavingsJ);
      renderDailyStrip(state.loading ? NaN : s.eomSavingsJ);
      document.getElementById('simBadge').classList.toggle('hidden', skippedBudgetRows.size === 0);

      renderBudgets();
      renderSplits();
      renderTransactions();
    }

    // ================= BUDGETS & EVENTS LOGIC =================
    function setBudFilter(f) {
      budFilter = f;
      markChoice('bf_', ['all', 'recurring', 'events'], f,
        'hit shrink-0 whitespace-nowrap px-2.5 py-1 rounded-lg bg-slate-900 dark:bg-white text-white dark:text-slate-900',
        'hit shrink-0 whitespace-nowrap px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400');
      renderBudgets();
    }

    function setBudFormType(isRec) {
      budFormIsRecurring = Boolean(isRec);
      markChoice('btype_', ['bill', 'event'], budFormIsRecurring ? 'bill' : 'event', TOGGLE_ON, TOGGLE_OFF);
    }

    function setBudFormSign(sign) {
      budFormSign = sign < 0 ? -1 : 1;
      markToggle('bsign_', ['neg', 'pos'], budFormSign < 0 ? 'neg' : 'pos', 'pos');
    }

    function toggleWhatIf(row) {
      if (skippedBudgetRows.has(row)) skippedBudgetRows.delete(row);
      else skippedBudgetRows.add(row);
      renderAll();
    }

    // The Bills header: what the unpaid bills still come to. Bills can be money in as well as out, so the total can be
    // either way round; it never shows a minus sign.
    function billsLeftText(rem) {
      const n = Number(rem || 0);
      if (Math.abs(n) < 0.005) return 'Nothing to pay';
      return n < 0 ? fmtGBP(-n) + ' to pay' : '+' + fmtGBP(n) + ' to come in';
    }

    function renderBudgets() {
      const allUpcoming = state.budgets.filter(b => Number(b.amount) !== 0);
      const upcoming = allUpcoming.filter(b => {
        if (budFilter === 'recurring') return b.isRecurring;
        if (budFilter === 'events') return !b.isRecurring;
        return true;
      });
      const cleared = state.budgets.filter(b => Number(b.amount) === 0);
      const totalCount = state.budgets.length;
      const pct = totalCount ? Math.round((cleared.length / totalCount) * 100) : 0;

      document.getElementById('budLeftVal').textContent = state.loading ? 'Loading…' : billsLeftText(state.summary.budgetRem);
      document.getElementById('budClearedCount').textContent = state.loading ? '' : `${cleared.length} of ${totalCount} paid`;
      document.getElementById('budProgressBar').style.width = `${pct}%`;
      document.getElementById('clearedBudCount').textContent = cleared.length;
      document.getElementById('paidFold').classList.toggle('hidden', cleared.length === 0);

      // Tap a bill's name to edit it (Delete lives inside the edit form, with Undo, so it can't be hit by accident).
      // The icon on the left is the "what if I skip this" toggle; Paid is the only button on the right.
      const nameBtn = (b, cls) => b.pending
        ? `<span class="min-w-0 truncate ${cls}">${esc(b.name)}</span>`
        : `<button data-action="openBudgetFormForRow" data-row="${b.row}" aria-label="Edit ${esc(b.name)}" class="min-w-0 flex-1 truncate text-left py-2 ${cls}">${esc(b.name)}</button>`;
      const pill = 'h-9 px-3 rounded-full border text-xs font-semibold whitespace-nowrap inline-flex items-center gap-1';
      const billsTab = onPhoneTab('budgets');   // the phone's Bills tab lists every unpaid bill; Home the first few
      const shown = showAll.bills || billsTab ? upcoming : upcoming.slice(0, BILLS_PREVIEW);
      document.getElementById('upcomingBudgetsList').innerHTML = upcoming.length ? shown.map(b => {
        const isSkipped = skippedBudgetRows.has(b.row);
        return `
          <div class="py-1 flex items-center justify-between gap-2 text-sm ${isSkipped ? 'opacity-40 line-through' : ''}">
            <div class="flex items-center gap-1 min-w-0 flex-1">
              <button data-action="toggleWhatIf" data-row="${b.row}" title="Tap to simulate skipping" aria-label="Simulate skipping ${esc(b.name)}"
                      class="w-10 h-10 -ml-2 shrink-0 inline-flex items-center justify-center ${b.isRecurring ? 'text-indigo-400' : 'text-amber-400'}">
                ${isSkipped ? icon('skip', 'w-4 h-4') : icon(b.isRecurring ? 'repeat' : 'sparkle', 'w-4 h-4')}
              </button>
              ${nameBtn(b, 'font-medium text-slate-800 dark:text-slate-100')}
            </div>
            <div class="flex items-center gap-2 shrink-0">
              <span class="tabular-nums font-semibold whitespace-nowrap ${moneyTone(b.amount)}">${fmtSigned(b.amount)}</span>
              ${b.pending ? SAVING_TAG : `
              <button data-action="markBudgetPaid" data-row="${b.row}" aria-label="Mark ${esc(b.name)} paid"
                      class="hit ${pill} border-emerald-300 text-emerald-700 hover:bg-emerald-50 dark:border-emerald-800 dark:text-emerald-300 dark:hover:bg-emerald-950">
                ${icon('check', 'w-3.5 h-3.5')} Paid
              </button>`}
            </div>
          </div>
        `;
      }).join('') + (billsTab ? '' : showMoreBtn('bills', upcoming.length, BILLS_PREVIEW))
        : emptyRow('All clear', 'py-3');

      document.getElementById('clearedBudgetsList').innerHTML = cleared.map(b => `
        <div class="py-1 flex items-center justify-between gap-2 text-sm text-slate-500 dark:text-slate-400">
          <div class="flex items-center gap-1.5 min-w-0 flex-1">
            ${icon(b.isRecurring ? 'repeat' : 'sparkle', 'w-3.5 h-3.5')}
            ${nameBtn(b, '')}
            ${b.originalBudget ? `<span class="tabular-nums text-xs shrink-0">(${fmtGBP(b.originalBudget)})</span>` : ''}
          </div>
          <button data-action="restoreBudget" data-row="${b.row}" ${b.pending ? 'disabled' : ''}
                  class="hit ${pill} shrink-0 border-slate-300 text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800">Restore</button>
        </div>
      `).join('');
    }

    // What the bill form showed when it opened: a save or delete from it is checked against this, not against whatever
    // the screen holds by the time you tap (the figures can refresh while the form is open).
    let budFormExpect = null;
    // The bill form is the sheet #budgetModal: "Add bill" or "Edit <name>" with Delete. The cursor goes to Amount when
    // it is empty (Add, or Restore of a paid bill whose amount wasn't remembered), like Add Transaction.
    function openBudgetForm(row = '', name = '', amount = '', isRecurring = false) {
      ['inpBudAmt', 'inpBudName'].forEach(clearFieldError);   // filled in code below, which clears no old message by itself
      budFormExpect = row ? { name, amount: Number(amount) } : null;
      document.getElementById('editBudRow').value = row;
      document.getElementById('inpBudName').value = name;
      const numAmt = Number(amount || 0);
      document.getElementById('inpBudAmt').value = numAmt !== 0 ? Math.abs(numAmt) : '';
      setBudFormType(row ? isRecurring : false);
      setBudFormSign(numAmt > 0 ? 1 : -1);
      document.getElementById('budFormTitle').textContent = row ? 'Edit ' + displayName(name) : 'Add bill';
      document.getElementById('budSaveBtn').textContent = row ? 'Save Changes' : 'Save Bill';
      document.getElementById('budDeleteBtn').classList.toggle('hidden', !row);
      document.getElementById('budgetModal').classList.remove('hidden');
      if (!numAmt) document.getElementById('inpBudAmt').focus();   // the number pad comes straight up
    }

    function deleteBudgetFromForm() {
      const row = Number(document.getElementById('editBudRow').value);
      const expect = budFormExpect;
      if (!row || !expect) return;
      closeBudgetForm();
      removeBudgetRow(row, expect);
    }

    function closeBudgetForm() {
      document.getElementById('budgetModal').classList.add('hidden');
      budFormExpect = null;
    }

    // Shows a new bill straight away (marked pending until the server confirms it and gives it a real row). A `paid`
    // bill shows as paid, with signedAmt as the amount to restore.
    function addBudgetOptimistic(name, signedAmt, isRecurring, paid = false) {
      const usedRows = new Set(state.budgets.map(b => Number(b.row)));
      let tempRow = 4;
      while (usedRows.has(tempRow) || (tempRow >= 32 && tempRow <= 39)) {
        tempRow++;
      }
      const bill = { row: tempRow, name, amount: paid ? 0 : signedAmt, originalBudget: signedAmt, isRecurring, pending: true };
      state.budgets.push(bill);
      return bill;
    }

    function submitBudgetForm() {
      const row = document.getElementById('editBudRow').value;
      const name = document.getElementById('inpBudName').value.trim();
      const rawAbs = checkedAmount('inpBudAmt', true);
      if (rawAbs === null) return;
      if (!name) return showFieldError('inpBudName', 'Add a name');

      const signedAmt = +(rawAbs * budFormSign).toFixed(2);

      const expect = row ? budFormExpect : null;
      if (row && !expect) return;
      const isRecurring = budFormIsRecurring;
      closeBudgetForm();
      mutate('the bill', () => {
        if (!row) return takeOut(state.budgets, addBudgetOptimistic(name, signedAmt, isRecurring));
        const existing = findBudget(Number(row), expect);
        if (!existing) return;
        const undo = keepFields(existing, ['name', 'amount', 'originalBudget', 'isRecurring']);
        Object.assign(existing, { name, amount: signedAmt, originalBudget: signedAmt, isRecurring });
        return undo;
      }, () => apiCall('saveBudgetItem', {
        sheetName: activeMonth,
        row: row || null,
        name,
        amount: signedAmt,
        isRecurring,
        expect
      }));
    }

    // The saved (not still-saving) bill in a row, and only if it is still the one expected.
    function findBudget(row, expect) {
      return state.budgets.find(b => b.row === row && !b.pending && (!expect || (b.name === expect.name && Number(b.amount) === Number(expect.amount))));
    }

    // `expect` is what the bill form showed; without it, the bill on screen now (a tap on its own button).
    function removeBudgetRow(row, expect) {
      const item = findBudget(row, expect);
      if (!item && !expect) return;
      const sent = expect || { name: item.name, amount: item.amount };
      const month = activeMonth;
      skippedBudgetRows.delete(row);
      const deleted = mutate('the bill deletion', () => {
        if (item) return removeItem(state.budgets, item);
      }, () => apiCall('deleteBudgetItem', { sheetName: month, row, expect: sent }));
      if (item) offerUndo('Deleted "' + item.name + '"', deleted, () => undoDeleteBudget(item, month));
    }

    // Undo waits for the delete, then re-adds the bill, paid again if it was paid. If it was deleted from a month you've
    // since left, only the sheet is updated.
    function undoDeleteBudget(item, month) {
      const paid = Number(item.amount) === 0 && Number(item.originalBudget || 0) !== 0;
      const amount = paid ? item.originalBudget : item.amount;
      return mutate('the restored bill', () => {
        if (month === activeMonth) return takeOut(state.budgets, addBudgetOptimistic(item.name, amount, item.isRecurring, paid));
      }, () => apiCall('saveBudgetItem', { sheetName: month, row: null, name: item.name, amount, isRecurring: item.isRecurring, paid }),
      applyStateIfViewing(month));
    }

    // Paid sets a bill to 0 and remembers its amount (originalBudget); Restore puts that amount back. A paid bill
    // with no remembered amount opens its form instead, to ask for one rather than guess.
    function markBudgetPaid(row) {
      const item = findBudget(row);
      if (item) setBudgetAmount(item, 0, Number(item.amount));
    }
    function restoreBudget(row) {
      const item = findBudget(row);
      if (!item) return;
      if (!item.originalBudget) return openBudgetFormForRow(row);
      setBudgetAmount(item, Number(item.originalBudget), Number(item.originalBudget));
    }
    function setBudgetAmount(item, newAmt, origAmt) {
      const expect = { name: item.name, amount: item.amount };
      mutate('the bill update', () => {
        const undo = keepFields(item, ['amount', 'originalBudget']);
        if (newAmt === 0 && item.amount !== 0) item.originalBudget = item.amount;
        item.amount = newAmt;
        return undo;
      }, () => apiCall('updateBudgetRow', { sheetName: activeMonth, row: item.row, newAmount: newAmt, originalBudget: origAmt, expect }));
    }

    // ================= OWED & SPLITS PANEL =================
    function setSplitPanel(mode) {
      splitPanelMode = mode;
      document.getElementById('panel_pending').classList.toggle('hidden', mode !== 'pending');
      document.getElementById('panel_settled').classList.toggle('hidden', mode !== 'settled');
      markChoice('pill_', ['pending', 'settled'], mode,
        'hit px-3 py-1 rounded-lg bg-white dark:bg-slate-900 text-slate-900 dark:text-white', 'hit px-3 py-1 rounded-lg text-slate-500 dark:text-slate-400');
    }

    // Friends you split with: their quick-tap chips, the split rows and the "Paid back" list all use this list. The
    // names live in the private backend, not in this public page: every reply carries them (`config`), and this device
    // keeps the last ones it was sent, so they are there offline too. Until the first reply, there are none.
    let PEOPLE = [];
    let QUICK_SPLIT = '';   // the person on the "Half w/ ..." and "All ...'s" buttons
    let SETTLED_PREFIX = /^savings\b/i;
    let configShown = '';   // the names last applied: every reply carries them, but the chips are only rebuilt (which
                            // would interrupt typing in a split) when they have actually changed
    function applyConfig(cfg, remember) {
      if (!cfg || typeof cfg !== 'object' || JSON.stringify(cfg) === configShown) return;
      configShown = JSON.stringify(cfg);
      const names = (Array.isArray(cfg.people) ? cfg.people : []).map(p => String(p).trim().toLowerCase())
        .filter((p, i, all) => /^\S{1,30}$/.test(p) && p !== 'marcus' && p !== 'savings' && all.indexOf(p) === i);
      PEOPLE = names;
      QUICK_SPLIT = names.indexOf(String(cfg.quickSplit || '').trim().toLowerCase()) !== -1 ? String(cfg.quickSplit).trim().toLowerCase() : '';
      SETTLED_PREFIX = new RegExp('^(' + names.concat('savings').map(p => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')\\b', 'i');
      setSpendWords(cfg.spendWords);
      if (remember) lsSet(CONFIG_KEY, configShown);
      renderPersonChips();
      renderQuickSplit();
    }
    function loadSavedConfig() {
      applyConfig(lsJson(CONFIG_KEY), false);
    }
    function renderQuickSplit() {
      const name = esc(displayName(QUICK_SPLIT));
      [['sp_half', 'Half w/ ' + name], ['sp_all', 'All ' + name + "'s"]].forEach(([id, label]) => {
        const btn = document.getElementById(id);
        if (!btn) return;
        btn.innerHTML = QUICK_SPLIT ? label : '';
        btn.style.display = QUICK_SPLIT ? '' : 'none';
      });
      if (!QUICK_SPLIT && (formSplit === 'half' || formSplit === 'all')) selectSplit('100_me');
    }
    const CHIP_ON = 'px-2.5 py-1 rounded-lg bg-emerald-500 text-slate-950 font-bold';
    const chipOff = p => p === 'marcus'
      ? 'px-2.5 py-1 rounded-lg bg-white dark:bg-slate-900 border border-amber-500/40 text-amber-600 dark:text-amber-400 font-medium'
      : 'px-2.5 py-1 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 font-medium';
    function renderPersonChips() {
      document.getElementById('personChips').innerHTML = PEOPLE.concat('marcus').map(p =>
        `<button type="button" data-person="${esc(p)}" data-action="togglePersonChip" id="chip_${esc(p)}" class="${chipOff(p)}">＋ ${esc(displayName(p))}</button>`).join('')
        + '<button type="button" data-action="addBlankPersonRow" class="px-2.5 py-1 rounded-lg bg-slate-200 dark:bg-slate-700 font-semibold">＋ Other</button>';
      renderDynamicSplitRows();
    }

    // Owed items are written "<person> <what>" in the sheet (e.g. "sam Groceries"), so they group by first word.
    const PERSON_COLOURS = ['#8B5CF6', '#EC4899', '#F59E0B', '#06B6D4', '#10B981', '#F97316'];
    function personColour(name) {
      let h = 0;
      for (const ch of String(name)) h += ch.charCodeAt(0);
      return PERSON_COLOURS[h % PERSON_COLOURS.length];
    }
    function owedPerson(desc) {
      const parts = String(desc || '').trim().split(/\s+/);
      return { key: (parts[0] || '').toLowerCase(), name: displayName(parts[0] || ''), what: displayName(parts.slice(1).join(' ')) || displayName(desc) };
    }
    function groupOwed(pending) {
      const groups = Object.create(null);   // keyed by sheet text: "constructor" is just a name here
      pending.forEach(r => {
        const p = owedPerson(r.desc);
        const g = groups[p.key] || (groups[p.key] = { key: p.key, name: p.name, items: [], total: 0 });
        g.items.push({ ...r, what: p.what });
        g.total = +(g.total + Number(r.amount || 0)).toFixed(2);
      });
      return Object.values(groups).sort((x, y) => y.total - x.total);
    }
    // ---- "Send them what they owe": a plain message for the phone's own share sheet (copied, on a computer) ----
    let owedGroupsShown = [];
    function owedMessage(g) {
      const lines = g.items.map(r => (displayName(r.what) || 'Shared') + '  ' + fmtGBP(r.amount));
      return 'Hi ' + g.name + ", here's what you owe me:\n\n" + lines.join('\n') + '\n\nTotal  ' + fmtGBP(g.total) + '\n\nThanks!';
    }
    async function shareOwed(personKey) {
      const g = owedGroupsShown.find(x => x.key === personKey);
      if (!g) return;
      const text = owedMessage(g);
      if (navigator.share) {
        try { await navigator.share({ text }); return; }
        catch (e) { if (e && e.name === 'AbortError') return; }   // cancelled; any other refusal: copy it instead
      }
      try {
        await navigator.clipboard.writeText(text);
        showToast('Copied. Paste it into a message to ' + g.name + '.', { kind: 'info' });
      } catch (e) {
        showToast("Couldn't copy the message.");
      }
    }
    const amtTone = n => n < 0 ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-600 dark:text-emerald-400';

    function renderSplits() {
      const reimb = state.checking.filter(r =>
        (r.need || r.amount > 0) && !['start', 'paycheck'].includes(r.desc.toLowerCase())
      );
      const pending = reimb.filter(r => r.need);
      const settled = reimb.filter(r => !r.need && (r.amount > 0 || SETTLED_PREFIX.test(r.desc.trim())));
      const pendingSum = pending.reduce((a, b) => a + b.amount, 0);

      document.getElementById('sumPending').textContent = fmtGBP(pendingSum);

      const groups = groupOwed(pending);
      owedGroupsShown = groups;
      // With one person, their own "All paid back" (or the item's tick) does the same job, so the header has none.
      document.getElementById('btnSettleAll').classList.toggle('hidden', groups.length < 2);
      const avatar = g => `<span class="w-8 h-8 rounded-full shrink-0 inline-flex items-center justify-center text-sm font-bold" style="background:${personColour(g.key)}26;color:${personColour(g.key)}">${esc(g.name.charAt(0) || '?')}</span>`;
      const count = g => g.items.length + (g.items.length === 1 ? ' item' : ' items');
      const pill = 'h-8 px-3 rounded-full border text-xs font-semibold whitespace-nowrap border-emerald-300 text-emerald-700 hover:bg-emerald-50 dark:border-emerald-800 dark:text-emerald-300 dark:hover:bg-emerald-950';

      // Phone Home: one line per person; each one opens the Owed tab.
      const summary = `<div class="owed-summary">${groups.map(g => `
          <button data-action="setView" data-arg="pending" class="w-full py-2 flex items-center gap-3 text-left">
            ${avatar(g)}
            <span class="min-w-0 flex-1"><span class="block text-sm font-semibold text-slate-900 dark:text-white truncate">${esc(g.name)}</span>
              <span class="block text-xs text-slate-600 dark:text-slate-300">${count(g)}</span></span>
            <span class="tabular-nums text-sm font-semibold ${amtTone(g.total)}">${fmtSigned(g.total)}</span>
            <span class="text-slate-400">${icon('chevron_right', 'w-4 h-4')}</span>
          </button>`).join('')}
        </div>`;

      // Owed tab (and desktop): every item, grouped by person.
      const full = `<div class="owed-groups divide-y divide-slate-100 dark:divide-slate-800/70">${groups.map(g => `
          <div class="py-2">
            <div class="flex items-center gap-3 py-1">
              ${avatar(g)}
              <span class="min-w-0 flex-1"><span class="block text-sm font-semibold text-slate-900 dark:text-white truncate">${esc(g.name)}</span>
                <span class="block text-xs text-slate-600 dark:text-slate-300 tabular-nums">${count(g)} · ${fmtSigned(g.total)}</span></span>
              ${g.items.length > 1 ? `<button data-person="${esc(g.key)}" data-action="handleSettlePerson" class="hit ${pill}">All paid back</button>` : ''}
            </div>
            ${g.items.map(r => `
              <div class="pl-11 py-1.5 flex items-center gap-2 text-sm">
                <span class="min-w-0 flex-1 truncate text-slate-700 dark:text-slate-200">${esc(r.what)}</span>
                <span class="tabular-nums ${amtTone(r.amount)}">${fmtSigned(r.amount)}</span>
                ${r.pending
                  ? SAVING_TAG
                  : `<button data-action="markPaidBack" data-row="${r.row}" aria-label="Mark ${esc(g.name)} ${esc(r.what)} paid back"
                            class="hit w-8 h-8 shrink-0 rounded-full border inline-flex items-center justify-center border-emerald-300 text-emerald-700 hover:bg-emerald-50 dark:border-emerald-800 dark:text-emerald-300 dark:hover:bg-emerald-950">${icon('check', 'w-3.5 h-3.5')}</button>`}
              </div>`).join('')}
            ${g.total > 0 ? `<div class="pl-11"><button data-person="${esc(g.key)}" data-action="shareOwed" aria-label="Send ${esc(g.name)} what they owe"
                      class="h-9 inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700 hover:underline dark:text-emerald-300">${icon('share', 'w-3.5 h-3.5')}Send ${esc(g.name)} what they owe</button></div>` : ''}
          </div>`).join('')}</div>`;

      document.getElementById('panel_pending').innerHTML = pending.length ? summary + full
        : emptyRow('Nothing owed', 'py-4');

      const settledShown = showAll.settled ? settled : settled.slice(0, SETTLED_PREVIEW);
      document.getElementById('panel_settled').innerHTML = '<div class="divide-y divide-slate-100 dark:divide-slate-800/70">' + settledShown.map(r => `
          <div class="py-1.5 flex items-center justify-between gap-2 text-sm text-slate-500 dark:text-slate-400">
            <span class="min-w-0 truncate inline-flex items-center gap-1.5">${icon('check', 'w-3.5 h-3.5 text-emerald-500')} ${esc(displayName(r.desc))}</span>
            <div class="flex items-center gap-2 shrink-0">
              <span class="tabular-nums ${amtTone(r.amount)}">${fmtSigned(r.amount)}</span>
              ${r.pending ? SAVING_TAG
                : `<button data-action="undoPaidBack" data-row="${r.row}" class="h-8 px-3 rounded-full border text-xs font-semibold border-slate-300 text-slate-600 dark:border-slate-700 dark:text-slate-300">Undo</button>`}
            </div>
          </div>
        `).join('') + '</div>' + showMoreBtn('settled', settled.length, SETTLED_PREVIEW);
    }

    // What a Nationwide row held when the screen showed it. The server refuses the change if it now holds something else.
    const expectOf = r => ({ desc: r.desc, amount: r.amount });
    const holds = (r, expect) => r.desc === expect.desc && r.amount === expect.amount;

    function toggleSplitNeed(row, setNeed) {
      const item = state.checking.find(r => r.row === row && !r.pending);
      if (!item) return;
      const expect = expectOf(item);
      mutate('the paid-back change', () => {
        const undo = keepFields(item, ['need']);
        item.need = setNeed;
        return undo;
      }, () => apiCall('toggleNeedFlag', { sheetName: activeMonth, row, setNeed, expect }));
    }

    // "All paid back" for one person: same save as the overall button, just their rows.
    function handleSettlePerson(personKey) {
      settleOwed(state.checking.filter(r => r.need && !r.pending && owedPerson(r.desc).key === personKey));
    }

    // Items still saving have no real row yet, so they are left as they are (they stay in the list as "saving…").
    function handleSettleAll() {
      settleOwed(state.checking.filter(r => r.need && !r.pending));
    }

    function settleOwed(items) {
      if (!items.length) return;
      const rows = items.map(r => r.row);
      const expect = items.map(expectOf);
      const month = activeMonth;
      const settled = mutate('All paid back', () => {
        const undos = items.map(r => keepFields(r, ['need']));
        items.forEach(r => { r.need = false; });
        return () => undos.forEach(u => u());
      }, () => apiCall('settleAllNeeds', { sheetName: month, rows, expect }));
      offerUndo(rows.length === 1 ? 'Marked 1 item paid back' : 'Marked ' + rows.length + ' items paid back', settled,
        () => undoSettle(rows, expect, month));
    }

    // Undo of "All paid back" (offerUndo waits for it to be in the sheet): each row is ticked as owed again, one
    // request after another, each checking the row still holds what it did. A row changed meanwhile is refused and
    // the rest still go; if any was refused, the screen goes back and the sheet is fetched, to show what it holds
    // (a refusal counts over a 'saved' reply, which would fetch it quietly).
    // Shown at once like any save. If you've since left that month, only the sheet is updated.
    function undoSettle(rows, expects, month) {
      return mutate('the Undo', () => {
        if (month !== activeMonth) return;
        const items = rows.map((row, i) => state.checking.find(r => r.row === row && !r.pending && holds(r, expects[i]))).filter(Boolean);
        const undos = items.map(r => keepFields(r, ['need']));
        items.forEach(r => { r.need = true; });
        return () => undos.forEach(u => u());
      }, () => rows.reduce((prev, row, i) => prev.then(last => apiCall('toggleNeedFlag', { sheetName: month, row, setNeed: true, expect: expects[i] })
        .then(s => ({ s, err: last.err }), err => ({ s: last.s, err: last.err && failureKind(last.err) !== 'saved' ? last.err : err }))), Promise.resolve({}))
        .then(last => { if (last.err) throw last.err; return last.s; }),
      applyStateIfViewing(month));
    }

    // ================= TRANSACTIONS & INTERLEAVED FEED =================
    function markTxFilter(flt) {
      txFilter = flt;
      markChoice('txf_', ['all'].concat(ACCTS), flt,
        'hit px-2.5 py-1 rounded-lg bg-white dark:bg-slate-900 text-slate-900 dark:text-white', 'hit px-2.5 py-1 rounded-lg text-slate-500 dark:text-slate-400');
    }
    function setTxFilter(flt) {
      markTxFilter(flt);
      renderTransactions();
    }
    // Phone Activity tab: the account filters and search sit behind one button. While they are folded away, any
    // still on shows as a chip (tap to clear). They start folded away each time you open the tab.
    let txFiltersOpen = false;
    function toggleTxFilters() {
      closeMenu();   // the header's buttons stop the page click that would close it
      txFiltersOpen = !txFiltersOpen;
      renderTransactions();
    }
    function clearTxSearch() {
      document.getElementById('txSearch').value = '';
      renderTransactions();
    }
    function renderTxFilterUi(q) {
      const btn = document.getElementById('txFilterBtn');
      btn.setAttribute('aria-expanded', String(txFiltersOpen));
      document.getElementById('txFilterPanel').classList.toggle('hidden', !txFiltersOpen);
      const chip = (label, action) => `<button type="button" data-action="${action}" aria-label="Clear filter: ${esc(label)}" class="hit h-8 px-3 rounded-full text-xs font-semibold inline-flex items-center gap-1.5 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300">${esc(label)}<span aria-hidden="true">✕</span></button>`;
      const chips = txFiltersOpen ? [] : [
        txFilter !== 'all' ? chip(ACCOUNT_CARDS[txFilter].name + ' only', 'showAllAccounts') : '',
        q ? chip('“' + q + '”', 'clearTxSearch') : ''
      ].filter(Boolean);
      const box = document.getElementById('txActive');
      box.innerHTML = chips.join('');
      box.classList.toggle('hidden', !chips.length);
    }

    // The phone's Activity tab shows the whole list, with this month's card spending on top. Tapping a category
    // there filters the list to that category's card spends. That, the account filter and the search belong to the
    // tab: they are cleared when you leave it, and phone Home (which has none of them) shows the latest few spends.
    let actCat = null;
    function setActCat(cat) {
      actCat = actCat === cat ? null : cat;
      renderTransactions();
    }
    const CAT_ICON_NAMES = { 'Groceries': 'cat_groceries', 'Eating out': 'cat_eating', 'Transport': 'cat_transport', 'Bills & subscriptions': 'cat_bills', 'Shopping': 'cat_shopping', 'Travel': 'cat_travel', 'Entertainment': 'cat_entertainment', 'Health': 'cat_health', 'Other': 'cat_other' };

    // A ring chart of category totals as SVG circles (one stroke segment per category).
    function spendRing(cats, total, size, stroke, highlight) {
      const r = (size - stroke) / 2, c = 2 * Math.PI * r, mid = size / 2;
      let offset = 0;
      const arcs = cats.map(cat => {
        const len = c * cat.total / Math.max(total, 0.01);
        const gap = cats.length > 1 ? Math.min(3, len / 3) : 0;
        const dim = highlight && highlight !== cat.cat ? ' opacity="0.25"' : '';
        const arc = `<circle cx="${mid}" cy="${mid}" r="${r}" fill="none" stroke="${SPEND_COLOURS[cat.cat] || '#94a3b8'}" stroke-width="${stroke}" stroke-dasharray="${Math.max(len - gap, 0.5)} ${c}" stroke-dashoffset="${-offset}" transform="rotate(-90 ${mid} ${mid})"${dim}/>`;
        offset += len;
        return arc;
      }).join('');
      return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" class="shrink-0" aria-hidden="true"><circle cx="${mid}" cy="${mid}" r="${r}" fill="none" stroke="rgba(148,163,184,.18)" stroke-width="${stroke}"/>${arcs}</svg>`;
    }

    function renderActSpend() {
      const box = document.getElementById('actSpend');
      if (!box) return;
      const sum = summariseSpend(state, loadSpendOverrides());
      const cats = sum.categories.filter(c => c.total > 0.005);
      if (actCat && !cats.some(c => c.cat === actCat)) actCat = null;
      const sel = actCat && cats.find(c => c.cat === actCat);
      box.innerHTML = `
        <div class="flex items-center gap-3.5 pb-3">
          ${spendRing(cats, sum.total, 56, 7, actCat)}
          <div class="min-w-0 flex-1">
            <div class="text-sm text-slate-500 dark:text-slate-400">${sel ? esc(sel.cat) + ' on cards' : 'Spent on cards this month'}</div>
            <div class="text-2xl font-semibold tracking-tight tabular-nums text-slate-900 dark:text-white">${fmtGBP(sel ? sel.total : sum.total)}</div>
          </div>
          <button data-action="openSpendModal" class="h-8 px-3 rounded-full border text-xs font-semibold border-emerald-300 text-emerald-700 dark:border-emerald-800 dark:text-emerald-300">Details</button>
        </div>
        ${cats.length ? `<div class="chip-row flex gap-2 overflow-x-auto">${cats.map(c => {
          const on = actCat === c.cat, col = SPEND_COLOURS[c.cat] || '#94a3b8';
          return `<button data-cat="${esc(c.cat)}" data-action="setActCat" aria-pressed="${on}"
                    class="hit shrink-0 h-9 px-3 rounded-full border text-sm font-semibold inline-flex items-center gap-1.5 text-slate-700 dark:text-slate-200 ${on ? '' : 'border-slate-200 dark:border-slate-700'}"
                    style="${on ? `border-color:${col};background:${col}26` : ''}">
                    <span class="w-2 h-2 rounded-full" style="background:${col}"></span>${esc(c.cat)}
                    <span class="tabular-nums font-medium text-slate-500 dark:text-slate-400">${fmtGBP(c.total)}</span></button>`;
        }).join('')}</div>` : '<p class="text-sm text-slate-500 dark:text-slate-400">No card spending recorded in this month yet.</p>'}`;
    }

    function renderTransactions() {
      const search = document.getElementById('txSearch');
      const onTab = onPhoneTab('activity');
      const phoneHome = PHONE_MQ.matches && !onTab;
      if (!onTab) { actCat = null; txFiltersOpen = false; }
      // Home on a phone has no filters, so none may be left on (this also clears them when a window narrows to phone size).
      if (phoneHome && (txFilter !== 'all' || search.value)) { markTxFilter('all'); search.value = ''; }
      if (onTab) renderActSpend();
      // Trimmed, so a phone keyboard's trailing space (or a search of only spaces) can't hide rows with no chip to say so.
      const q = search.value.trim().toLowerCase();
      renderTxFilterUi(search.value.trim());
      const tsMap = getLocalTimestamps();

      const tagRows = (arr, acct) => {
        const valid = (arr || []).filter(r => r.desc.toLowerCase() !== 'start');
        const len = Math.max(valid.length, 1);
        return valid.map((r, i) => {
          const clientTs = r.clientTs || tsMap[localTsKey(acct, r.row, r.desc, r.amount)] || 0;
          const relOrder = typeof r.relOrder === 'number' ? r.relOrder : (i / len);
          return { ...r, acct, clientTs, sortScore: relOrder };
        });
      };

      let list = [];
      if (txFilter === 'all') {
        list = ACCTS.flatMap(acct => tagRows(state[acct], acct));
        list.sort((a, b) => {
          if (b.clientTs !== a.clientTs) return b.clientTs - a.clientTs;
          return a.sortScore - b.sortScore;
        });
      } else {
        list = tagRows(state[txFilter], txFilter);
      }

      let filtered = list.filter(r => r.desc.toLowerCase().includes(q));
      if (actCat) {
        const overrides = loadSpendOverrides();
        filtered = filtered.filter(r => (r.acct === 'amex' || r.acct === 'barclays') && !SPEND_SKIP.test(spendKey(r.desc)) && categoryFor(r.desc, overrides) === actCat);
      }
      // While searching, filtering by category or on the Activity tab, show every match; otherwise the latest few.
      // "Show all" (showAll.tx) is the desktop's: phone Home has "See all" instead, which opens the Activity tab.
      const showEvery = q || actCat || onTab || (showAll.tx && !PHONE_MQ.matches);
      const visible = showEvery ? filtered : filtered.slice(0, phoneHome ? HOME_TX_PREVIEW : TX_PREVIEW);
      // Like Bills: tap a row to edit it (no pencil). A row that is still saving can't be edited yet.
      document.getElementById('txListContainer').innerHTML = visible.map(r => `
        <${r.pending ? 'div' : 'button'} ${r.pending ? '' : `type="button" data-action="openEditTxForRow" data-acct="${esc(r.acct)}" data-row="${r.row}" aria-label="Edit ${esc(displayName(r.desc))}"`}
             class="tx-row w-[calc(100%+0.75rem)] text-left py-2.5 px-1.5 -mx-1.5 min-h-[48px] rounded-lg flex items-center justify-between gap-2 text-sm transition ${r.pending ? 'opacity-60' : 'hover:bg-slate-50 dark:hover:bg-slate-800/60 cursor-pointer'}">
          <span class="flex items-center gap-3 min-w-0">
            ${getBankLogo(r.acct)}
            <span class="font-medium text-slate-800 dark:text-slate-100 truncate">${esc(displayName(r.desc))}</span>
          </span>
          <span class="flex items-center gap-2 shrink-0">
            <span class="tabular-nums font-semibold whitespace-nowrap ${moneyTone(r.amount)}">${fmtSigned(r.amount)}</span>
            ${r.pending ? SAVING_TAG : ''}
          </span>
        </${r.pending ? 'div' : 'button'}>
      `).join('') + (actCat && !visible.length ? '<p class="py-3 text-sm text-slate-500 dark:text-slate-400 text-center">Nothing in this category matches.</p>' : '')
        + (q || actCat || onTab ? '' : phoneHome ? seeAllActivityBtn(filtered.length) : showMoreBtn('tx', filtered.length, TX_PREVIEW));
    }

    // What was typed in an amount box, as a number: "12.50", "£1,234.50" and " 7 " work; 0 when empty; NaN for anything
    // else ("12,50", "-4", "12.5e3"), so a typo is never saved as some other amount. (Spend / Refund says which way it
    // goes. The boxes are text with a decimal keypad, so a mouse wheel can't change them by accident.)
    function parseAmount(raw) {
      let t = String(raw == null ? '' : raw).trim().replace(/^£\s*/, '');
      if (t === '') return 0;
      if (/^[1-9]\d{0,2}(,\d{3})+(\.\d*)?$/.test(t)) t = t.replace(/,/g, '');   // thousands commas
      return /^(\d+\.?\d*|\.\d+)$/.test(t) ? Number(t) : NaN;
    }
    function amountIn(id) { return parseAmount(document.getElementById(id).value); }
    // An amount box that must hold a real amount: its value, or null after saying what is wrong (`needed`: 0 won't do).
    function checkedAmount(id, needed) {
      const v = amountIn(id);
      if (Number.isNaN(v)) { showFieldError(id, 'Type an amount, like 12.50'); return null; }
      if (needed && !(v > 0)) { showFieldError(id, 'Add the amount'); return null; }
      return v;
    }

    // A short red line under a form box (id + 'Err'), until it is typed in.
    function showFieldError(id, msg) {
      const el = document.getElementById(id), note = document.getElementById(id + 'Err');
      note.textContent = msg;
      note.classList.remove('hidden');
      el.setAttribute('aria-invalid', 'true');
      el.setAttribute('aria-describedby', id + 'Err');
      el.focus();
    }
    function clearFieldError(id) {
      const el = document.getElementById(id), note = document.getElementById(id + 'Err');
      if (!el || !note || note.classList.contains('hidden')) return;
      note.classList.add('hidden');
      el.removeAttribute('aria-invalid');
      el.removeAttribute('aria-describedby');
    }
    document.addEventListener('input', e => { if (e.target.id) clearFieldError(e.target.id); });
    // Enter in a form box goes to the box named by its data-enter, or presses the button named there (saving the form).
    document.addEventListener('keydown', e => {
      const to = e.key === 'Enter' && !e.isComposing && e.target.dataset && e.target.dataset.enter;
      const next = to && document.getElementById(to);
      if (!next) return;
      e.preventDefault();
      if (next.tagName === 'BUTTON') next.click(); else next.focus();
    });

    // The phone keyboard slides over the page without moving anything fixed, so a sheet would sit under it. While it is
    // up, --kb is its height (and --kbtop how far the page was moved up), so the sheets fill just what is visible.
    (function followKeyboard() {
      const vv = window.visualViewport;
      if (!vv) return;
      const set = () => {
        const root = document.documentElement.style;
        root.setProperty('--kbtop', Math.max(0, Math.round(vv.offsetTop)) + 'px');   // the page scrolled up to show a box
        root.setProperty('--kb', Math.max(0, Math.round(innerHeight - vv.height - vv.offsetTop)) + 'px');
      };
      vv.addEventListener('resize', set);
      vv.addEventListener('scroll', set);
    })();

    // ================= ADD TRANSACTION & DYNAMIC GROUP SPLIT =================
    function openAddModal() {
      setTxDirection('spend');
      const lastAcct = lsGet(LAST_ACCT_KEY);
      selectAcct(ACCTS.includes(lastAcct) ? lastAcct : 'amex');   // the card the last spend went on
      selectSplit('100_me');
      customSplitEntries = [];
      autoEqualActive = false;
      renderDynamicSplitRows();
      ['inpAmount', 'inpMerchant'].forEach(clearFieldError);
      document.getElementById('addModal').classList.remove('hidden');
      document.getElementById('inpAmount').focus();   // the number pad comes straight up
    }
    function closeAddModal() { document.getElementById('addModal').classList.add('hidden'); }

    function setTxDirection(dir) {
      txDirection = dir;
      const isRefund = dir === 'refund';
      markToggle('dir_', ['spend', 'refund'], dir, 'refund');

      document.getElementById('needToggleWrap').classList.toggle('hidden', formSplit === '100_me');
      document.getElementById('btnSubmitTx').textContent = isRefund ? 'Save Refund / Money In (+)' : 'Save Spend';
      updateSplitSummary();
    }

    function selectAcct(a) {
      formAcct = a;
      markChoice('acct_', ACCTS, a, CARD_ON, CARD_OFF);
    }

    function selectSplit(s) {
      if ((s === 'half' || s === 'all') && !QUICK_SPLIT) s = '100_me';
      formSplit = s;
      markChoice('sp_', ['100_me', 'half', 'all', 'custom', 'marcus'], s,
        'px-2.5 py-1.5 rounded-xl bg-emerald-500 text-slate-950', 'px-2.5 py-1.5 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300');
      document.getElementById('customSplitBox').classList.toggle('hidden', s !== 'custom');
      document.getElementById('needToggleWrap').classList.toggle('hidden', s === '100_me');
      // A group split shares the amount equally from the start, and again as people are added or taken off, until
      // you type someone's share yourself (÷ Split Equally goes back to equal shares).
      if (s === 'custom' && customSplitEntries.length === 0) {
        autoEqualActive = true;
        if (QUICK_SPLIT) togglePersonChip(QUICK_SPLIT);
      }
      updateSplitSummary();
    }

    function togglePersonChip(personKey) {
      const idx = customSplitEntries.findIndex(e => e.person.toLowerCase() === personKey.toLowerCase());
      if (idx > -1) {
        customSplitEntries.splice(idx, 1);
      } else {
        customSplitEntries.push({ person: personKey, amount: 0 });
      }
      if (autoEqualActive) applyEqualGroupSplit();
      else {
        renderDynamicSplitRows();
        updateSplitSummary();
      }
    }

    function addBlankPersonRow() {
      customSplitEntries.push({ person: '', amount: 0 });
      if (autoEqualActive) applyEqualGroupSplit(); else renderDynamicSplitRows();
    }

    function removePersonRow(idx) {
      customSplitEntries.splice(idx, 1);
      if (autoEqualActive) applyEqualGroupSplit();
      else {
        renderDynamicSplitRows();
        updateSplitSummary();
      }
    }

    function updatePersonRowName(idx, val) {
      if (customSplitEntries[idx]) customSplitEntries[idx].person = val;
      updateSplitSummary();
    }

    function updatePersonRowAmt(idx, val) {
      autoEqualActive = false;
      const e = customSplitEntries[idx];
      if (e) { const n = parseAmount(val); e.amount = n || 0; e.bad = Number.isNaN(n); }
      updateSplitSummary();
    }

    // `pence` shared equally between `count` people, in pence. With includeMe you have a share too (what's left after
    // theirs); without, the last person takes the odd pence. A few pence between many: no share is below 0.
    function equalShares(pence, count, includeMe) {
      const divisor = count + (includeMe ? 1 : 0);
      if (!divisor) return [];
      let each = Math.round(pence / divisor);
      if (!includeMe && each * (count - 1) > pence) each = Math.floor(pence / divisor);
      const shares = new Array(count).fill(each);
      if (!includeMe) shares[count - 1] = pence - each * (count - 1);
      return shares;
    }
    // Equal shares of the amount, less anything typed for Marcus (savings are never shared out by themselves). With
    // "Include me", what's left after the shares is yours; without, the last person takes the odd penny, so the shares
    // add up to the amount.
    function applyEqualGroupSplit() {
      autoEqualActive = true;
      const isMarcus = e => e.person.toLowerCase() === 'marcus';
      const people = customSplitEntries.filter(e => !isMarcus(e));
      const marcus = customSplitEntries.filter(isMarcus).reduce((a, e) => a + (e.amount || 0), 0);
      const pence = Math.max(0, Math.round(((amountIn('inpAmount') || 0) - marcus) * 100));
      const incMe = document.getElementById('chkEqualIncludeMe').checked;
      equalShares(pence, people.length, incMe).forEach((p, i) => { people[i].amount = p / 100; });
      renderDynamicSplitRows();
      updateSplitSummary();
    }

    function onGrossAmountInput() {
      if (formSplit === 'custom' && autoEqualActive && customSplitEntries.length > 0) {
        applyEqualGroupSplit();
      } else {
        updateSplitSummary();
      }
    }

    function renderDynamicSplitRows() {
      PEOPLE.concat('marcus').forEach(p => {
        const btn = document.getElementById('chip_' + p);
        if (!btn) return;
        btn.className = customSplitEntries.some(e => e.person.toLowerCase() === p) ? CHIP_ON : chipOff(p);
      });

      const container = document.getElementById('dynamicSplitRows');
      customSplitEntries.forEach(e => { e.bad = false; });   // the boxes are redrawn from the amounts, so no bad text is left
      if (customSplitEntries.length === 0) {
        container.innerHTML = '<div class="text-xs text-slate-500 dark:text-slate-400 py-1">Tap any name above to split this transaction...</div>';
        return;
      }

      container.innerHTML = customSplitEntries.map((entry, idx) => `
        <div class="flex items-center gap-2">
          <input type="text" value="${esc(entry.person)}" placeholder="Name (e.g. Sam)" aria-label="Name" data-input="updatePersonRowName" data-idx="${idx}"
                 class="split-name w-32 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg px-2.5 py-1.5 text-xs font-medium text-slate-900 dark:text-white capitalize" />
          <div class="relative flex-1">
            <span class="absolute left-2.5 top-1.5 text-slate-500 dark:text-slate-400 text-xs tabular-nums">£</span>
            <input type="text" inputmode="decimal" autocomplete="off" aria-label="Their share (£)" value="${entry.amount || ''}" placeholder="0.00" data-input="updatePersonRowAmt" data-idx="${idx}"
                   class="split-amt w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg pl-6 pr-2.5 py-1.5 text-xs tabular-nums font-semibold text-slate-900 dark:text-white" />
          </div>
          <button type="button" data-action="removePersonRow" data-idx="${idx}" class="hit hit-32 text-slate-500 dark:text-slate-400 hover:text-rose-500 px-1.5 font-bold">✕</button>
        </div>
      `).join('');
    }

    function buildSplitData() {
      const gross = amountIn('inpAmount') || 0;
      const isRefund = txDirection === 'refund';
      const need = formSplit !== '100_me' && document.getElementById('chkNeed').checked;
      const splits = [];
      let marcusShare = 0;

      if (formSplit === 'half' && QUICK_SPLIT) {
        splits.push({ person: QUICK_SPLIT, amount: +(gross / 2).toFixed(2), need });
      } else if (formSplit === 'all' && QUICK_SPLIT) {
        splits.push({ person: QUICK_SPLIT, amount: gross, need });
      } else if (formSplit === 'marcus') {
        marcusShare = gross;
      } else if (formSplit === 'custom') {
        customSplitEntries.forEach(e => {
          const p = (e.person || '').trim().toLowerCase();
          const amt = e.amount || 0;
          if (amt > 0 && p) {
            if (p === 'marcus') marcusShare += amt;
            else splits.push({ person: p, amount: amt, need });
          }
        });
      }
      return { gross, isRefund, need, splits, marcusShare };
    }

    // What is wrong with the group split's shares, or '' if nothing: a share that isn't an amount, a share with no
    // name, or shares that come to more than the whole amount (each would otherwise be dropped or hidden quietly).
    function splitProblem() {
      if (formSplit !== 'custom') return '';
      if (customSplitEntries.some(e => e.bad)) return 'Each share needs an amount like 12.50';
      if (customSplitEntries.some(e => e.amount > 0 && !(e.person || '').trim())) return 'Add a name for each share';
      const { gross, splits, marcusShare } = buildSplitData();
      const others = splits.reduce((a, b) => a + b.amount, 0) + marcusShare;
      if (others - gross > 0.005) return 'The shares come to ' + fmtGBP(others) + ', more than ' + fmtGBP(gross);
      return '';
    }

    function updateSplitSummary() {
      clearFieldError('dynamicSplitRows');
      const { gross, isRefund, splits, marcusShare } = buildSplitData();
      if (formSplit === '100_me') {
        document.getElementById('cleanSplitPill').innerHTML = isRefund
          ? `Money in / refund • <strong class="text-emerald-500">+${fmtGBP(gross)}</strong>`
          : `Personal spend • <strong>${fmtGBP(gross)}</strong>`;
        return;
      }
      const others = splits.reduce((a, b) => a + b.amount, 0) + marcusShare;
      const myNet = +(gross - others).toFixed(2);
      if (isRefund) {
        const parts = [`You keep: <strong class="text-emerald-500">+${fmtGBP(Math.max(0, myNet))}</strong>`];
        if (splits.length === 1) {
          parts.push(`Pay ${esc(splits[0].person)}:<strong class="text-rose-500">−${fmtGBP(splits[0].amount)}</strong>`);
        } else if (splits.length > 1) {
          const spSum = splits.reduce((a, b) => a + b.amount, 0);
          parts.push(`Pay ${splits.length} people: <strong class="text-rose-500">−${fmtGBP(spSum)}</strong>`);
        }
        if (marcusShare > 0) parts.push(`To Marcus: <strong class="text-rose-500">−${fmtGBP(marcusShare)}</strong>`);
        document.getElementById('cleanSplitPill').innerHTML = parts.join(' • ');
        return;
      }
      const parts = [`You pay: <strong>${fmtGBP(Math.max(0, myNet))}</strong>`];
      if (splits.length === 1) {
        parts.push(`${esc(splits[0].person)}: <strong>${fmtGBP(splits[0].amount)}</strong>`);
      } else if (splits.length > 1) {
        const spSum = splits.reduce((a, b) => a + b.amount, 0);
        parts.push(`${splits.length} people owe: <strong>${fmtGBP(spSum)}</strong>`);
      }
      if (marcusShare > 0) parts.push(`Marcus: <strong>${fmtGBP(marcusShare)}</strong>`);
      document.getElementById('cleanSplitPill').innerHTML = parts.join(' • ');
    }

    function submitExpense() {
      const merchant = document.getElementById('inpMerchant').value.trim();
      if (checkedAmount('inpAmount', true) === null) return;
      if (!merchant) return showFieldError('inpMerchant', 'Add where it was');
      const problem = splitProblem();
      if (problem) {
        showFieldError('dynamicSplitRows', problem);   // the rows can't take the cursor, so their first box does
        const box = document.querySelector('#dynamicSplitRows .split-amt');
        if (box) box.focus();
        return;
      }
      const { gross, isRefund, need, splits, marcusShare } = buildSplitData();
      lsSet(LAST_ACCT_KEY, formAcct);

      const now = Date.now();
      const primarySigned = isRefund ? gross : -gross;
      const splitSign = isRefund ? -1 : 1;

      // Made-up row numbers (99 and up) until the server says where each entry went.
      addPendingTx(formAcct, 99, merchant, primarySigned, false, now);

      if (marcusShare > 0) {
        const mAmt = -splitSign * marcusShare;
        const cAmt = splitSign * marcusShare;
        addPendingTx('marcus', 100, merchant, mAmt, false, now);
        addPendingTx('checking', 101, 'savings ' + merchant, cAmt, need, now);
      }

      splits.forEach((s, i) => {
        const spDesc = `${s.person} ${merchant}`;
        const signedSplitAmt = +(splitSign * Math.abs(s.amount)).toFixed(2);
        addPendingTx('checking', 102 + i, spDesc, signedSplitAmt, s.need, now);
      });

      closeAddModal();
      document.getElementById('inpMerchant').value = '';
      document.getElementById('inpAmount').value = '';
      savePhoneCache(activeMonth, state);
      renderAll();

      sendNewSpend({
        sheetName: activeMonth,
        merchant,
        grossAmount: gross,
        isRefund,
        account: formAcct,
        splits,
        marcusShare,
        markNeed: need,
        clientId: newClientId()
      });
    }

    // ---- Offline outbox: a new spend that can't reach the server (no signal, timeout) is kept on this device and
    // sent when the connection returns. Every spend carries a clientId, and the server ignores a repeat of one it
    // has already saved, so a retry after a lost reply can't add it twice. Only new spends are queued: edits and
    // deletes point at sheet rows, which could have moved by the time they were sent. ----
    let outboxFlushing = false;
    function newClientId() {
      return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
    }
    function loadOutbox() {
      const a = lsJson(OUTBOX_KEY);
      return Array.isArray(a) ? a : [];
    }
    function saveOutbox(list) {
      return lsSet(OUTBOX_KEY, JSON.stringify(list));
    }
    // False when this device's storage can't be written, so the spend couldn't be kept.
    function queueSpend(payload, extra) {
      const kept = saveOutbox(loadOutbox().concat([{ id: payload.clientId, payload, ...extra }]));
      updateSyncUi();
      return kept;
    }
    // Changes one waiting spend (null removes it; a key set to undefined is dropped when saved).
    function updateOutboxItem(id, change) {
      saveOutbox(loadOutbox().flatMap(x => x.id !== id ? [x] : change ? [{ ...x, ...change }] : []));
    }
    // When a spend is sent again (see failureKind):
    // - the sheet was busy ('busy'): nothing was done, so it is sent again, up to OUTBOX_MAX_TRIES times in a row;
    // - no usable reply ('reach'): it may have got there, but the server ignores a repeat of a spend it already saved.
    //   It only remembers that for a few hours, though, so one first sent longer ago than RESEND_WITHIN_MS (`sentAt`)
    //   is set aside for you to check instead;
    // - any other server error ('refused'): set aside at once, since it may have failed part way. The screen is
    //   fetched afresh, so you can see whether it got there.
    // A spend set aside (`setAside`: why) stays on this device until a tap on sync sends it again, or you remove it.
    const OUTBOX_MAX_TRIES = 5;
    const RESEND_WITHIN_MS = 5 * 3600 * 1000;
    const plainError = err => String((err && err.message) || 'unknown error').replace(/^[A-Z_]+: /, '');
    function setSpendAside(item, why) {
      updateOutboxItem(item.id, { setAside: why, tries: undefined });
      const p = item.payload;
      const what = String(p.merchant || 'a spend') + (p.grossAmount ? ' ' + fmtGBP(p.grossAmount) : '');
      showToast("Couldn't send " + what + ': ' + why, {
        actionLabel: 'Remove', actionIcon: 'trash', duration: 9000,
        onAction: () => { updateOutboxItem(item.id, null); forceSyncSheet(); }
      });
    }
    // The sheet fetched afresh for the screen only: it sends nothing, so it can't set off another round of sending.
    // `again`: if the sheet can't be read just now either, try once more a little later. After a save whose figures
    // couldn't be read back, its "saving…" rows would otherwise stay until the next sync.
    const REFRESH_AGAIN_MS = 5000;
    function refreshFromSheet(again) {
      apiCall('getCachedSheetState', { sheetName: activeMonth, forceRefresh: true })
        .then(applyServerState)
        .catch(err => {
          console.error(err);
          if (again && failureKind(err) !== 'signin') setTimeout(() => refreshFromSheet(false), REFRESH_AGAIN_MS);   // signing in fetches them anyway
        });
    }
    // A tap on sync (or Send now when signing out): spends set aside go back in the queue, counted afresh. Offline,
    // nothing could be sent, so they stay as they are.
    function retrySetAside() {
      if (!IS_GAS_ENV && navigator.onLine === false) return;
      saveOutbox(loadOutbox().map(x => x.setAside ? { ...x, setAside: undefined, tries: undefined, sentAt: undefined } : x));
    }
    // `onSaved` runs once the sheet's figures after this save are on screen (not when it is queued or set aside).
    function sendNewSpend(payload, onSaved) {
      if (!IS_GAS_ENV && navigator.onLine === false) {
        if (!queueSpend(payload)) return showToast("You're offline and this device couldn't keep that spend, so it isn't saved.");
        showToast("You're offline - saved on this device, it will send when you're back online.", { kind: 'info' });
        return;
      }
      apiCall('addTransactionBundle', payload)
        .then(s => {
          applyStateIfViewing(payload.sheetName)(s);
          // Saved: a slip in the follow-up must not be taken for a failed save (the spend would be queued again).
          if (onSaved) try { onSaved(); } catch (e) { console.error('after the save:', e); }
        })
        .catch(err => {
          const kind = failureKind(err);
          if (kind === 'saved') return refreshFromSheet(true);
          // Kept on this device either way (the Apps Script copy of the page too), so a spend is never just lost (see
          // OUTBOX_MAX_TRIES for what happens next). Only if this device can't store anything is it gone, and then
          // the sheet is shown afresh so the screen doesn't pretend it was saved.
          if (!queueSpend(payload, kind === 'reach' ? { sentAt: Date.now() } : {})) return handleSaveError('the transaction', err);
          if (kind === 'refused') { setSpendAside({ id: payload.clientId, payload }, plainError(err)); refreshFromSheet(); }
          else showToast(err && err.network ? "No connection - saved on this device, it will send when you're back online."
            : "Couldn't save it just now - kept on this device, it will send again shortly.", { kind: 'info' });
        });
    }
    // Sends the waiting spends, oldest first. Ones set aside wait for a tap on sync (retrySetAside).
    async function flushOutbox() {
      if (outboxFlushing || !loadOutbox().some(x => !x.setAside) || (!IS_GAS_ENV && navigator.onLine === false)) return;
      // Signed out or locked: wait. Asking now would redraw the lock screen and overwrite what it says.
      if (!hasValidToken() || lockScreenShowing()) return;
      outboxFlushing = true;
      let refresh = false;   // a spend was set aside, or saved without its figures: the screen is fetched afresh once, at the end
      try {
        const tried = new Set();   // each spend at most once a round, even if this phone's storage can't be written
        let item;
        while ((item = loadOutbox().find(x => !x.setAside && !tried.has(x.id)))) {
          tried.add(item.id);
          if (item.sentAt && Date.now() - item.sentAt > RESEND_WITHIN_MS) {
            setSpendAside(item, 'it may already be in your sheet. Check, then tap ↻ to send it anyway.');
            refresh = true;
            continue;
          }
          try {
            const s = await apiCall('addTransactionBundle', item.payload);
            updateOutboxItem(item.id, null);
            applyStateIfViewing(item.payload.sheetName)(s);
          } catch (err) {
            const kind = failureKind(err);
            if (kind === 'saved') { updateOutboxItem(item.id, null); refresh = true; continue; }
            if (kind === 'reach' && !item.sentAt) updateOutboxItem(item.id, { sentAt: Date.now() });
            if (kind === 'reach' || kind === 'signin') break;   // try again later
            const tries = (item.tries || 0) + 1;
            if (kind === 'busy' && tries < OUTBOX_MAX_TRIES) { updateOutboxItem(item.id, { tries }); break; }
            setSpendAside(item, plainError(err));
            refresh = true;
          }
        }
      } finally {
        outboxFlushing = false;
        updateSyncUi();
      }
      if (refresh) refreshFromSheet(true);
    }
    // Back online: send what was saved here. If a request failed meanwhile, check the sheet again too (which also
    // sends), so the red caption doesn't stay up once the connection is back.
    window.addEventListener('online', () => {
      if (lastSyncFailed && appUiReady && hasValidToken() && !lockScreenShowing()) forceSyncSheet(); else flushOutbox();
    });
    window.addEventListener('offline', updateSyncUi);
    setInterval(flushOutbox, 60000);
    
    // ================= EDIT OR MOVE TRANSACTION MODAL =================
    function setEditTxSign(sign) {
      editTxSign = sign < 0 ? -1 : 1;
      markToggle('etsign_', ['neg', 'pos'], editTxSign < 0 ? 'neg' : 'pos', 'pos');
    }

    // What the edit form showed when it opened (see budFormExpect).
    let editTxExpect = null;
    function openEditTxModal(acct, row, desc, amount) {
      clearFieldError('editTxAmt');
      clearFieldError('editTxDesc');
      editTxExpect = { desc, amount: Number(amount) };
      document.getElementById('editTxOldAcct').value = acct;
      document.getElementById('editTxRow').value = row;
      document.getElementById('editTxDesc').value = desc;
      const num = Number(amount || 0);
      document.getElementById('editTxAmt').value = Math.abs(num);
      setEditTxSign(num >= 0 ? 1 : -1);
      selectEditTxAcct(acct);
      document.getElementById('editTxModal').classList.remove('hidden');
    }

    function closeEditTxModal() {
      document.getElementById('editTxModal').classList.add('hidden');
      editTxExpect = null;
    }

    function selectEditTxAcct(a) {
      editTxNewAcct = a;
      markChoice('etx_', ACCTS, a, CARD_ON, CARD_OFF);
    }

    function updateSummaryBalance(acct, delta) {
      const k = SUMMARY_KEY[acct];
      if (k) state.summary[k] = +(state.summary[k] + delta).toFixed(2);
    }

    // Shows a new entry straight away (marked pending until the server confirms it and gives it a real row), and
    // adds it to its account's balance.
    function addPendingTx(acct, row, desc, amount, need, ts) {
      const tx = { row, acct, desc, amount, need: !!need, clientTs: ts, relOrder: 0, pending: true };
      state[acct].unshift(tx);
      updateSummaryBalance(acct, amount);
      return tx;
    }

    // The saved (not still-saving) entry in a row, and only if it is still the one the form showed.
    function findEditedTx(acct, row, expect) {
      return (state[acct] || []).find(r => r.row === row && !r.pending && r.desc === expect.desc && Number(r.amount) === expect.amount);
    }

    function saveEditedTx() {
      const expect = editTxExpect;
      if (!expect) return;
      const oldAcct = document.getElementById('editTxOldAcct').value;
      const newAcct = editTxNewAcct;
      const row = Number(document.getElementById('editTxRow').value);
      const newDesc = document.getElementById('editTxDesc').value.trim();
      const rawAbs = checkedAmount('editTxAmt', true);
      if (rawAbs === null) return;
      if (!newDesc) return showFieldError('editTxDesc', 'Add where it was');

      const newAmount = +(rawAbs * editTxSign).toFixed(2);
      const now = Date.now();
      if (newAcct === oldAcct) recordEditTime(newAcct, row, newDesc, newAmount);   // a move gets the server's time

      closeEditTxModal();
      mutate('the transaction edit', () => {
        const oldArr = state[oldAcct] || [];
        const oldItem = findEditedTx(oldAcct, row, expect);
        if (!oldItem) return;
        const was = oldItem.amount;
        updateSummaryBalance(oldAcct, -was);
        if (oldAcct === newAcct) {
          const undo = keepFields(oldItem, ['desc', 'amount', 'clientTs']);
          oldItem.desc = newDesc;
          oldItem.amount = newAmount;
          oldItem.clientTs = now;
          updateSummaryBalance(newAcct, newAmount);
          return () => { undo(); updateSummaryBalance(newAcct, was - newAmount); };
        }
        const putBack = removeItem(oldArr, oldItem);
        const moved = addPendingTx(newAcct, 98, newDesc, newAmount, false, now);
        return () => {
          takeOut(state[newAcct], moved)();
          updateSummaryBalance(newAcct, -newAmount);
          putBack();
          updateSummaryBalance(oldAcct, was);
        };
      }, () => apiCall('editOrMoveTransaction', {
        sheetName: activeMonth,
        oldAcct,
        newAcct,
        row,
        newDesc,
        newAmount,
        expect
      }));
    }

    function deleteCurrentTx() {
      const expect = editTxExpect;
      if (!expect) return;
      const oldAcct = document.getElementById('editTxOldAcct').value;
      const row = Number(document.getElementById('editTxRow').value);

      const oldArr = state[oldAcct] || [];
      const item = findEditedTx(oldAcct, row, expect);
      const month = activeMonth;

      closeEditTxModal();
      // `deleted` settles true once the sheet has lost the row (also when only its new figures couldn't be read
      // back), false if the delete didn't go through.
      const deleted = mutate('the deletion', () => {
        if (!item) return;
        const putBack = removeItem(oldArr, item);
        updateSummaryBalance(oldAcct, -item.amount);
        return () => { putBack(); updateSummaryBalance(oldAcct, item.amount); };
      }, () => apiCall('deleteTransactionRow', { sheetName: month, acct: oldAcct, row, expect }));
      // Undo only for an entry that is really going (if the row changed meanwhile, the server refuses the delete, and
      // an Undo would add a second copy).
      if (!item) return;
      const gone = { acct: oldAcct, desc: item.desc, amount: item.amount, need: !!item.need };
      offerUndo('Deleted "' + gone.desc + '"', deleted, () => undoDeleteTx(gone, month));
    }

    // Undo of a delete that went through (offerUndo waits for it): the entry is re-added as a new spend (with a clientId and the outbox, so a failed re-add is kept on this device,
    // never lost or sent twice). It lands in the first empty row of its account, so it may sit in a different
    // position than before. If you've since left that month, only the sheet is updated.
    function undoDeleteTx(item, month) {
      const same = x => x.desc === item.desc && x.amount === item.amount && !x.pending;
      // Rows already holding an identical entry, so the "owed" flag goes back on the re-added one, not a twin.
      const before = new Set(state.checking.filter(same).map(x => x.row));
      if (month === activeMonth) {
        addPendingTx(item.acct, 99, item.desc, item.amount, false, Date.now());
        savePhoneCache(activeMonth, state);
        renderAll();
      }
      sendNewSpend({
        sheetName: month, merchant: item.desc, grossAmount: Math.abs(item.amount), isRefund: item.amount > 0,
        account: item.acct, splits: [], marcusShare: 0, markNeed: false, clientId: newClientId()
      }, () => {
        if (!item.need || month !== activeMonth) return;
        const back = state.checking.find(x => same(x) && !x.need && !before.has(x.row));
        if (back) toggleSplitNeed(back.row, true);
      });
    }

    // ================= START NEW MONTH ROLLOVER MODAL =================
    function getNextMonthName(currentMonthStr) {
      const str = String(currentMonthStr || '').trim();
      const idx = MONTHS.findIndex(m => str.toLowerCase().startsWith(m.toLowerCase()));
      if (idx === -1) return str ? (str + ' (Next)') : 'New Payday Month';

      const nextIdx = (idx + 1) % 12;
      const yearMatch = str.match(/\b(20\d{2})\b/);
      let year = yearMatch ? Number(yearMatch[1]) : new Date().getFullYear();
      if (idx === 11) year += 1; // December -> January rolls the year forward!

      return `${MONTHS[nextIdx]} Payday ${year}`;
    }

    // This month's figure for an entry like "paycheck", as a starting point for next month (blank if there isn't one).
    function thisMonthAmount(re) {
      const r = (state.checking || []).find(x => re.test(String(x.desc).trim()));
      return r ? Math.abs(Number(r.amount)) : '';
    }

    function openNewMonthModal() {
      ['nmPaycheck', 'nmSavings'].forEach(clearFieldError);
      const s = state.summary;
      document.getElementById('nmName').value = getNextMonthName(activeMonth);
      document.getElementById('nmPaycheck').value = thisMonthAmount(/^paycheck$/i);
      document.getElementById('nmSavings').value = thisMonthAmount(/^\S+ to savings$/i);
      updateNewMonthName();
      document.getElementById('roNCA').textContent = fmtGBP(s.nCA);
      document.getElementById('roMarcus').textContent = fmtGBP(s.mSAV);
      document.getElementById('roAmex').textContent = fmtGBP(s.amex);
      document.getElementById('roBarclays').textContent = fmtGBP(s.barclays);

      // What is still owed carries over to the new month
      const pendingItems = (state.checking || []).filter(r => r.need);
      const pendingSum = +pendingItems.reduce((acc, r) => acc + Number(r.amount || 0), 0).toFixed(2);
      const settleEl = document.getElementById('roSettle');
      if (settleEl) {
        settleEl.textContent = pendingItems.length
          ? `${pendingItems.length} item${pendingItems.length === 1 ? '' : 's'} (${fmtSigned(pendingSum)})`
          : 'None';
      }

      // Render interactive checklist of bills/events to pull into the new month (not ones still saving: their row
      // number is only a guess until the server answers)
      const listEl = document.getElementById('roBudgetChecklist');
      listEl.innerHTML = state.budgets.filter(b => !b.pending).map(b => {
        const resetAmt = b.originalBudget !== 0 ? b.originalBudget : b.amount;
        return `
          <label class="py-2.5 flex items-center justify-between gap-2 cursor-pointer">
            <div class="flex items-center gap-2.5 min-w-0">
              <input type="checkbox" class="ro-bud-chk w-5 h-5 rounded text-emerald-500" value="${b.row}" ${b.isRecurring ? 'checked' : ''} data-change="updateRolloverCount" />
              <span class="truncate text-slate-700 dark:text-slate-200 inline-flex items-center gap-1.5">${icon(b.isRecurring ? 'repeat' : 'sparkle', 'w-3.5 h-3.5 ' + (b.isRecurring ? 'text-indigo-400' : 'text-amber-400'))} ${esc(b.name)}</span>
            </div>
            <span class="tabular-nums text-xs text-slate-500 shrink-0">${fmtGBP(resetAmt)}</span>
          </label>
        `;
      }).join('');
      updateRolloverCount();
      document.getElementById('newMonthModal').classList.remove('hidden');
    }

    function updateRolloverCount() {
      const checked = document.querySelectorAll('.ro-bud-chk:checked').length;
      document.getElementById('roBudCount').textContent = checked;
    }

    function closeNewMonthModal() { document.getElementById('newMonthModal').classList.add('hidden'); }

    // If a month with this name already exists, creating it again would replace it (the sheet keeps the old tab as a
    // hidden backup). Say so, and only go ahead on a second tap.
    let nmReplaceArmed = false, nmArmTimer = null;
    function updateNewMonthName() {
      const name = document.getElementById('nmName').value.trim();
      const exists = !!name && (state.availableMonths || []).includes(name);
      const warn = document.getElementById('nmExistsWarn');
      warn.textContent = exists ? '"' + name + '" already exists. Creating it again replaces it with a fresh copy of this month (the sheet keeps the old one as a hidden backup tab).' : '';
      warn.classList.toggle('hidden', !exists);
      nmReplaceArmed = false;
      clearTimeout(nmArmTimer);
      setNewMonthButton(exists ? 'Replace month' : 'Create Month', exists);
    }
    function setNewMonthButton(label, danger) {
      const btn = document.getElementById('nmCreateBtn');
      btn.textContent = label;
      btn.className = 'w-full py-2.5 rounded-xl font-bold text-sm transition ' + (danger ? 'bg-rose-500 hover:bg-rose-400 text-white' : 'bg-emerald-500 hover:bg-emerald-400 text-slate-950');
    }

    function confirmStartNewMonth() {
      const newMonthName = document.getElementById('nmName').value.trim();
      const paycheck = checkedAmount('nmPaycheck'), savingsAmount = checkedAmount('nmSavings');
      if (paycheck === null || savingsAmount === null) return;
      const keepBudgetRows = Array.from(document.querySelectorAll('.ro-bud-chk:checked')).map(el => Number(el.value));
      if (!newMonthName) return;
      const replaceExisting = (state.availableMonths || []).includes(newMonthName);
      if (replaceExisting && !nmReplaceArmed) {
        nmReplaceArmed = true;
        setNewMonthButton('Tap again to replace "' + newMonthName + '"', true);
        clearTimeout(nmArmTimer);
        nmArmTimer = setTimeout(updateNewMonthName, 5000);
        return;
      }

      closeNewMonthModal();
      apiCall('startNewMonth', {
        sourceSheetName: activeMonth,
        newMonthName,
        paycheck,
        savingsAmount,
        keepBudgetRows,
        replaceExisting
      }).then(applyServerState).catch(err => {
        // Made, but its figures couldn't be read back: open it, which fetches them.
        if (failureKind(err) === 'saved') {
          openMadeMonth(newMonthName);
        } else if (/^EXISTS/.test(String(err && err.message))) {
          // Another device made this month in the meantime: nothing was changed. Load the latest so the warning shows.
          showToast('"' + newMonthName + '" already exists, so nothing was changed. Open Start New Month again if you want to replace it.');
          forceSyncSheet();
        } else if (failureKind(err) === 'reach') {
          checkNewMonthAfterNoReply(newMonthName, replaceExisting);
        } else {
          showToast("Couldn't create the month: " + ((err && err.message) || 'unknown error'));
        }
      });
    }
    // The month is in the sheet: open it, which fetches its figures.
    function openMadeMonth(newMonthName) {
      showToast('Made ' + newMonthName + '. Loading it now.', { kind: 'info' });
      switchMonth(newMonthName, true);
    }
    // No reply (no signal, or it took too long), yet the server may have finished the month anyway. Look at the sheet
    // before saying it failed, so you aren't sent to make (or replace) it a second time.
    function checkNewMonthAfterNoReply(newMonthName, replaceExisting) {
      showToast('No reply yet about ' + newMonthName + '. Checking your sheet...', { kind: 'info' });
      apiCall('getCachedSheetState', { sheetName: activeMonth, forceRefresh: true }).then(s => {
        const there = !!(s && (s.availableMonths || []).includes(newMonthName));
        if (there && !replaceExisting) return openMadeMonth(newMonthName);
        applyServerState(s);
        if (there) {
          showToast('No reply about replacing ' + newMonthName + '; it may have gone through. Open it to check before trying again.');
        } else {
          showToast(newMonthName + " isn't in your sheet yet. It may still appear in a minute; check before trying again.");
        }
      }).catch(() => {
        showToast("Couldn't reach your sheet to check whether " + newMonthName + ' was made. Check again before trying again.');
      });
    }


    // Back in the app after a minute or more away: fetch the latest figures and send anything saved offline. If the
    // sign-in ran out while you were away, the lock screen (and fingerprint prompt) appears now, not on your next tap.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') { hiddenAt = Date.now(); return; }
      updateSyncUi();
      const awayFor = hiddenAt ? Date.now() - hiddenAt : 0;
      hiddenAt = 0;
      if (IS_GAS_ENV || awayFor < RETURN_REFRESH_MS) return;
      // Left on the lock screen: ask for the fingerprint again now you're back, in place of any old message (but not
      // after Sign out or a refused account, where the lock screen never asks by itself).
      if (lockScreenShowing()) {
        if (lockAllowsAuto && !passkeyAttempt && passkeyEnrolledHere()) { passkeyAutoTried = false; showLockScreen(passkeyNeedsReload ? PASSKEY_STUCK_MSG : 'Unlock to continue.'); }
        return;
      }
      if (!appUiReady) return;
      if (!hasValidToken()) { showLockScreen('Session ended. Unlock to continue.'); return; }
      apiCall('getCachedSheetState', { sheetName: activeMonth, forceRefresh: false })
        .then(applyStateIfViewing(activeMonth))
        .catch(err => console.error(err))
        .then(flushOutbox);
    });

    // A newer version of the page has been saved by the service worker: offer to switch to it.
    if (!IS_GAS_ENV && 'serviceWorker' in navigator) {
      navigator.serviceWorker.addEventListener('message', e => {
        if (e.data && e.data.type === 'pf-updated') {
          showToast('A new version of PaydayFlow is ready.', { kind: 'info', actionLabel: 'Reload', actionIcon: 'refresh', duration: 15000, onAction: () => location.reload() });
        }
      });
    }

    // One-time page setup. Runs on load when already signed in, or straight after a fresh sign-in.
    let appUiReady = false;
    function initAppUi() {
      if (appUiReady) return;
      appUiReady = true;
      document.getElementById('logoCardAmex').innerHTML = getBankLogo('amex');
      document.getElementById('logoCardBarclays').innerHTML = getBankLogo('barclays');
      document.getElementById('logoCardChecking').innerHTML = getBankLogo('checking');
      document.getElementById('logoCardMarcus').innerHTML = getBankLogo('marcus');
      applyThemeMode();
    }

    // Home-screen shortcuts (manifest.json) open the app at /?go=add, ?go=owed or ?go=spending. The marker is taken
    // off the address straight away, so a reload doesn't open the same screen again; the screen opens once signed in.
    let launchGo = new URLSearchParams(location.search).get('go') || '';
    if (launchGo) {
      try { const u = new URL(location.href); u.searchParams.delete('go'); history.replaceState(null, '', u.pathname + u.search + u.hash); } catch (e) {}
    }
    function applyLaunchShortcut() {
      const go = launchGo;
      launchGo = '';
      if (go === 'add') openAddModal();
      else if (go === 'owed') setView('pending');
      else if (go === 'spending') openSpendModal();
    }

    // Shows the app from the figures saved on this device (the latest are asked for straight after). Used both when the
    // app opens already signed in and after a sign-in.
    function openApp() {
      initAppUi();
      loadPhoneCache(activeMonth);
      renderAll();
      applyLaunchShortcut();
    }

    function startApp() {
      if (window.PF_FRAMED) return;   // inside another website's frame (see guard.js)
      hydrateIcons();
      renderPersonChips();
      loadSavedConfig();
      if (!passkeySupported()) {   // e.g. inside Apps Script, or a browser without WebAuthn
        ['menuPasskeyItem', 'sidePasskeyBtn'].forEach(id => { const el = document.getElementById(id); if (el) el.classList.add('hidden'); });
      }
      if (IS_GAS_ENV) {   // Apps Script signs you in with your Google account itself, so there is nothing to sign out of here
        ['menuSignOutRule', 'menuSignOutItem', 'sideSignOutBtn'].forEach(id => { const el = document.getElementById(id); if (el) el.classList.add('hidden'); });
      }
      // If on jonhoag.co.uk without a valid token, stop here and show Lock Screen. Straight after signing out, say
      // so, and don't ask for the fingerprint by itself.
      if (!IS_GAS_ENV && !hasValidToken()) {
        if (justSignedOut()) {
          clearThisDevice(false);   // a reply that landed between Sign out and the reload may have saved figures again
          showLockScreen('Signed out. Nothing is saved on this device any more.', { noAuto: true });
        } else showLockScreen();
        return;
      }
      hideLockScreen();
      openApp();

      apiCall('getCachedSheetState', { sheetName: activeMonth, forceRefresh: false })
        .then(applyServerState)
        .catch(console.error)
        .then(flushOutbox);
    }

    // ---- What each button and field does ----
    // The page holds no inline handlers (onclick="..."), so its security policy can refuse inline script. A control
    // names its job instead: data-action (a tap or click), data-input or data-change (typing, or a pick from a list),
    // each the name of one of these ACTIONS; data-arg, data-row, data-idx and the like carry what it acts on. Every
    // action is called as action(element).
    const rowOf = el => Number(el.dataset.row);
    const idxOf = el => Number(el.dataset.idx);
    const ACTIONS = {
      // lock screen, header, menu, sidebar
      unlockWithPasskey: () => unlockWithPasskey(false),
      cycleTheme: () => cycleTheme(),
      syncNow: () => { retrySetAside(); forceSyncSheet(); },
      switchMonth: el => switchMonth(el.value),
      toggleMenu: () => toggleMenu(),
      closeMenu: () => closeMenu(),
      menuNewMonth: () => { closeMenu(); openNewMonthModal(); },
      jumpToSection: el => jumpToSection(el.dataset.arg),
      setView: el => setView(el.dataset.arg),
      toggleSection: el => toggleSection(el.dataset.arg),
      toggleShowAll: el => toggleShowAll(el.dataset.arg),
      openAddModal: () => openAddModal(),
      openSpendModal: () => openSpendModal(),
      closeSpendModal: () => closeSpendModal(),
      openNewMonthModal: () => openNewMonthModal(),
      // fingerprint sign-in
      openPasskeyModal: () => openPasskeyModal(),
      closePasskeyModal: () => closePasskeyModal(),
      dismissPasskeyOffer: () => dismissPasskeyOffer(),
      runPasskeySetup: () => runPasskeySetup(),
      testPasskey: () => testPasskey(),
      removeThisPasskey: () => removePasskeyDevice(lsGet(PASSKEY_ID_KEY)),
      removePasskeyDevice: el => removePasskeyDevice(el.dataset.id),
      // sign out
      openSignOutModal: () => openSignOutModal(),
      closeSignOutModal: () => closeSignOutModal(),
      sendWaitingBeforeSignOut: () => sendWaitingBeforeSignOut(),
      signOut: () => signOut(false),
      signOutAndForget: () => signOut(true),
      // bills
      openBudgetForm: () => openBudgetForm(),
      openBudgetFormForRow: el => openBudgetFormForRow(rowOf(el)),
      setBudFilter: el => setBudFilter(el.dataset.arg),
      toggleWhatIf: el => toggleWhatIf(rowOf(el)),
      markBudgetPaid: el => markBudgetPaid(rowOf(el)),
      restoreBudget: el => restoreBudget(rowOf(el)),
      closeBudgetForm: () => closeBudgetForm(),
      setBudFormType: el => setBudFormType(el.dataset.arg === 'true'),
      setBudFormSign: el => setBudFormSign(Number(el.dataset.arg)),
      deleteBudgetFromForm: () => deleteBudgetFromForm(),
      submitBudgetForm: () => submitBudgetForm(),
      // Owed
      handleSettleAll: () => handleSettleAll(),
      handleSettlePerson: el => handleSettlePerson(el.dataset.person),
      setSplitPanel: el => setSplitPanel(el.dataset.arg),
      markPaidBack: el => toggleSplitNeed(rowOf(el), false),
      undoPaidBack: el => toggleSplitNeed(rowOf(el), true),
      shareOwed: el => shareOwed(el.dataset.person),
      // Activity and Spending
      toggleTxFilters: () => toggleTxFilters(),
      setTxFilter: el => setTxFilter(el.dataset.arg),
      showAllAccounts: () => setTxFilter('all'),
      clearTxSearch: () => clearTxSearch(),
      renderTransactions: () => renderTransactions(),
      setActCat: el => setActCat(el.dataset.cat),
      openEditTxForRow: el => openEditTxForRow(el.dataset.acct, rowOf(el)),
      toggleSpendCat: el => toggleSpendCat(el.dataset.cat),
      setSpendCategory: el => setSpendCategory(el.dataset.key, el.value),
      // Add sheet
      closeAddModal: () => closeAddModal(),
      setTxDirection: el => setTxDirection(el.dataset.arg),
      onGrossAmountInput: () => onGrossAmountInput(),
      selectAcct: el => selectAcct(el.dataset.arg),
      selectSplit: el => selectSplit(el.dataset.arg),
      togglePersonChip: el => togglePersonChip(el.dataset.person),
      addBlankPersonRow: () => addBlankPersonRow(),
      updatePersonRowName: el => updatePersonRowName(idxOf(el), el.value),
      updatePersonRowAmt: el => updatePersonRowAmt(idxOf(el), el.value),
      removePersonRow: el => removePersonRow(idxOf(el)),
      applyEqualGroupSplit: () => applyEqualGroupSplit(),
      includeMeChanged: () => { if (autoEqualActive) applyEqualGroupSplit(); },
      submitExpense: () => submitExpense(),
      // Edit sheet
      closeEditTxModal: () => closeEditTxModal(),
      setEditTxSign: el => setEditTxSign(Number(el.dataset.arg)),
      selectEditTxAcct: el => selectEditTxAcct(el.dataset.arg),
      deleteCurrentTx: () => deleteCurrentTx(),
      saveEditedTx: () => saveEditedTx(),
      // Start new month
      closeNewMonthModal: () => closeNewMonthModal(),
      updateNewMonthName: () => updateNewMonthName(),
      updateRolloverCount: () => updateRolloverCount(),
      confirmStartNewMonth: () => confirmStartNewMonth()
    };
    // One listener per kind of event, on the page itself. It walks out from what was tapped, the way the browser
    // passes an event outwards: each control on the way that names an action for this event runs it (innermost
    // first). data-stop ends the walk there and keeps the tap from going any further (so it doesn't close the
    // menu); data-backdrop acts only on a tap on the element itself (the dark area round a sheet), not inside it.
    // A disabled control does nothing. The walk follows the path the event set out on, so it carries on as before
    // when an action redraws the list it was in; anything on it that isn't an element (say a browser add-on's own
    // panel) is passed over.
    const ACTION_ATTRS = { click: 'action', input: 'input', change: 'change' };
    Object.keys(ACTION_ATTRS).forEach(type => document.documentElement.addEventListener(type, e => {
      const key = ACTION_ATTRS[type];
      for (const el of e.composedPath()) {
        if (el === document.documentElement) break;
        if (el.nodeType !== 1) continue;
        if (el.disabled) return;
        const name = el.dataset && el.dataset[key];
        if (name && !(el.hasAttribute('data-backdrop') && e.target !== el)) {
          if (!Object.prototype.hasOwnProperty.call(ACTIONS, name)) throw new Error('No such action: ' + name);
          ACTIONS[name](el);
        }
        if (type === 'click' && el.hasAttribute('data-stop')) { e.stopPropagation(); break; }
      }
    }));

    // Start as soon as the page is parsed rather than on `load`, which also waits for every font and
    // script (including Google sign-in) and so delayed the first data request.
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', startApp);
    else startApp();

    // The service worker can wait until the page has fully loaded.
    window.addEventListener('load', () => {
      if (!IS_GAS_ENV && !window.PF_FRAMED && 'serviceWorker' in navigator) { navigator.serviceWorker.register('sw.js').catch(() => {}); }
    });
