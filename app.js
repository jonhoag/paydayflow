// PaydayFlow: everything the page does, except talking to the server, saves and the offline outbox (net.js, loaded
// just before this file, in the same scope). Loaded by index.html at the end of <body> (and put back inside the page
// for the copy Apps Script serves, by deploy-backend.ps1). Buttons and fields name what they do with data-action and the like
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
const SPEND_VIEW_KEY = 'pf_spend_view';                // Spending shows "mine" (your share) or "total"
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
function saveSession(token, expiresAt) { return lsSet(SESSION_STORAGE_KEY, JSON.stringify({ token, exp: expiresAt })); }
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
const PASSKEY_RETRY_MS = 1500;        // gap before trying the fingerprint's first request again (once, inside one try)
// No connection after both of those: the lock screen asks again by itself after 2 s, 4 s, 8 s, then every 15 s (or as
// soon as the phone says it is back online), one try at a time, for as long as it is on screen and allowed to ask.
const PASSKEY_AGAIN_FIRST_MS = 2000;
const PASSKEY_AGAIN_MAX_MS = 15000;
let passkeyNoConnection = 0;          // tries in a row that found no connection
const PASSKEY_OFFLINE_MSG = 'Waiting for a connection…';
const PASSKEY_NO_CONNECTION_MSG = "No connection yet. Trying again as soon as it's back.";
const LOCK_IDLE_MSG = 'Unlock to continue.';
// The fingerprint's first request is small: give up on it sooner. Just after waking, a phone can send it down a Wi-Fi
// that hasn't got through yet, where it hangs; the next try goes down whatever works by then.
const PASSKEY_BEGIN_TIMEOUT_MS = 12000;
// The last request (finish) runs in about a second on the server, but just after waking its reply can fail to reach
// the phone. So it is given up after 10 s and the same signed answer sent again (the server hands back the same
// session for it, never a new one). The server's challenge lasts 120 s from begin (PASSKEY_CHALLENGE_TTL_MS in the
// backend), so the page stops sending 110 s after begin answered; after that a fresh fingerprint is needed.
const PASSKEY_FINISH_TIMEOUT_MS = 10000;
const PASSKEY_ANSWER_WINDOW_MS = 110000;  // from begin's reply; must stay under the backend's 120 s
const PASSKEY_FINISH_AGAIN_MS = 1000;     // gap before sending it again (or as soon as the phone is back online)
const PASSKEY_SLOW_MSG = 'Fingerprint accepted. The connection is slow, still trying…';
const PASSKEY_FINISH_LOST_MSG = 'Your fingerprint was accepted, but the reply didn\'t arrive. Tap "Unlock with fingerprint" to try again, or sign in with Google.';
const PASSKEY_PROMPT_GRACE_MS = 5000;     // how long past its own time limit a fingerprint prompt may run before it is dropped
const OFFLINE_RESYNC_MS = 5000;       // signed in without the figures: when to try fetching them again
// The line under "PaydayFlow Locked": red for a problem, grey for a plain note. `kind` (optional) names a line the
// fingerprint steps may clear again (see UNLOCK_STEPS): 'fail', 'offline', 'noConnection', 'slow', 'stuck'.
let lockLineKind = null;
function setLockMsg(text, isError, kind) {
  const el = document.getElementById('authLockMsg');
  if (!el) return;
  lockLineKind = kind || null;
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
// `againInMs`: a try that found no connection asks again after that gap, or as soon as the phone says it is back
// online, whichever comes first.
let stopPasskeyWait = () => {};
function autoUnlockWithPasskey(againInMs) {
  stopPasskeyWait();   // only one wait at a time
  if (!againInMs) passkeyNoConnection = 0;   // a fresh start, not a try again
  const online = () => navigator.onLine !== false;
  // (Not over the "prompt is stuck" line: that try can only reload, which waits for a connection anyway.)
  const offlineNote = () => { if (!passkeyNeedsReload) setLockMsg(PASSKEY_OFFLINE_MSG, false, 'offline'); };
  let due = !againInMs;
  if (due && document.hasFocus() && online()) { unlockWithPasskey(true); return; }
  if (!online()) offlineNote();
  // Focus isn't always reported, so after 3 s (or the gap) it is enough for the app to be on screen and online.
  let waitedLong = false;
  const stop = stopPasskeyWait = () => {
    window.removeEventListener('focus', check);
    window.removeEventListener('online', check);
    window.removeEventListener('offline', check);
    document.removeEventListener('visibilitychange', check);
    clearTimeout(timer);
  };
  const check = e => {
    // Only while the lock screen is still up and still wants it (a Google sign-in may have happened meanwhile).
    if (!lockAllowsAuto || !lockScreenShowing()) return stop();
    if (e && e.type === 'online') due = waitedLong = true;   // the connection is back: no need to wait out the gap
    if (!online()) { offlineNote(); return; }
    if (due && (document.hasFocus() || (waitedLong && document.visibilityState === 'visible'))) { stop(); unlockWithPasskey(true); }
  };
  window.addEventListener('focus', check);
  window.addEventListener('online', check);
  window.addEventListener('offline', check);
  document.addEventListener('visibilitychange', check);
  const timer = setTimeout(() => { due = waitedLong = true; check(); }, againInMs || PASSKEY_FOCUS_WAIT_MS);
}

// Everything that happens once the user is in. Both ways open the app with the figures saved on this device and ask
// for the latest. A fingerprint sign-in was already accepted by the server (it issued the session), so the app shows
// at once and the latest figures follow behind, as when it opens already signed in: after a while away, Apps Script
// can take many seconds to answer that first read. A Google account waits on the lock screen until the server has
// checked it.
function startSignedIn() {
  lockAllowsAuto = false;   // a fingerprint prompt still waiting for focus must not pop up over this sign-in
  ssDel(SIGNED_OUT_FLAG);
  openApp();
  return apiCall('getCachedSheetState', { sheetName: activeMonth, forceRefresh: true });
}
// The first figures are in. If the session later runs out while the app is open, the lock screen may ask for the
// fingerprint by itself again. (Not before: a server that turned down the session it had just issued would otherwise
// be asked round and round.)
function firstFiguresIn(s) {
  passkeyAutoTried = false;
  applyServerState(s);
}
// A sign-in the server turned down: the lock screen says why (and which Google account), and doesn't ask by itself.
function signInRefused(err, email) {
  const reason = String((err && err.message) || 'Sign-in failed.').replace(/^[A-Z_]+: /, '');
  showLockScreen('Access Denied: ' + reason + (email ? ' (' + email + ')' : ''), { noAuto: true });
}

function afterPasskeySignIn() {
  hideLockScreen();
  startSignedIn()
    .then(s => { firstFiguresIn(s); flushOutbox(); })
    .catch(err => {
      if (err && (err.auth || err.needsSignIn)) return signInRefused(err);
      // The app is open and signed in; only this refresh didn't work (the sync status shows it).
      passkeyAutoTried = false;
      if (isConnectionError(err)) {
        // No signal yet, or the server hiccuped: the figures saved here stay, and are fetched again shortly.
        showToast("Signed in, but couldn't reach the server. Showing the figures saved on this device.");
        setTimeout(forceSyncSheet, OFFLINE_RESYNC_MS);
      } else console.error(err);
    });
}

let signInInFlight = false;   // a Google sign-in is waiting for the server's check (a second one meanwhile is ignored)
function afterGoogleSignIn(email) {
  cancelPasskeyAttempt();   // a fingerprint try still on its way must not land over this (its first request may answer late)
  setLockMsg('Signing in…', false);
  signInInFlight = true;
  startSignedIn()
    .then(s => {
      signInInFlight = false;
      hideLockScreen();
      firstFiguresIn(s);
      onGoogleSignedIn();
      flushOutbox();
    })
    .catch(err => {
      signInInFlight = false;
      if (isConnectionError(err)) {
        // No signal yet, or the server hiccuped: not a refusal, but the account hasn't been checked yet, so the token
        // isn't kept for a reload to use.
        lsDel(TOKEN_STORAGE_KEY);
        showLockScreen("Couldn't reach the server. Try again in a moment.", { noAuto: true });
        return;
      }
      signInRefused(err, email);
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
          afterGoogleSignIn(String((payload && payload.email) || ''));
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

// A new device works only once its owner has tapped Approve in the email the server sent (security M1).
const PASSKEY_PENDING_MSG = 'This device\'s fingerprint isn\'t switched on yet. Tap "Approve" in the email, then try again.';
const PASSKEY_APPROVE_MSG = 'Nearly done: tap "Approve" in the email just sent to you, then fingerprint works on this device.';
// Words for the person, not the browser, for the ways a fingerprint step can fail.
function describePasskeyError(err, auto) {
  const code = err && err.code;
  if (code === 'AUTH_PASSKEY_UNKNOWN') return { text: 'Fingerprint sign-in was turned off for this device. Sign in with Google to set it up again.', error: true, forget: true };
  if (code === 'AUTH_PASSKEY_PENDING') return { text: PASSKEY_PENDING_MSG, error: false, wait: true };
  if (code === 'AUTH_THROTTLED') return { text: 'Fingerprint sign-in is paused for a few minutes after too many tries. You can still sign in with Google.', error: true };
  // (The lock screen words this itself, since its button reloads; this is for the fingerprint dialog's "Test it now".)
  if (err && err.promptBusy) return { text: 'The fingerprint prompt is stuck. Reload the page and try again.', error: false };
  // AbortError: a prompt that never answered was dropped (a try cancelled on purpose shows no message at all).
  if (err && (err.name === 'NotAllowedError' || err.name === 'AbortError')) return auto ? { text: 'Tap "Unlock with fingerprint", or sign in with Google.', error: false } : { text: 'Fingerprint was cancelled or timed out. Try again, or sign in with Google.', error: true };
  if (err && err.name === 'InvalidStateError') return { text: 'This device already has a fingerprint sign-in for PaydayFlow. Remove it in your password manager (or turn it off below) and try again.', error: true };
  if (err && err.name === 'SecurityError') return { text: 'This page address does not match the fingerprint sign-in, so the browser blocked it.', error: true };
  if (err && err.finishLost) return { text: PASSKEY_FINISH_LOST_MSG, error: false };
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

// Begin -> the browser's fingerprint prompt -> finish. Resolves with { session, expiresAt }. `signal` (optional)
// cancels it at any step; `onPrompt` (optional) is called once the server has answered, just before the browser's
// prompt, `onAccepted` (optional) once the fingerprint was accepted, before the last request, and `onSlow` (optional)
// if that request's first try got no reply (it is sent again: see sendPasskeyFinish).
async function passkeyLoginRoundTrip(signal, { onPrompt, onAccepted, onSlow } = {}) {
  const cid = lsGet(PASSKEY_ID_KEY);
  const beginReq = { action: 'passkeyLoginBegin', payload: { credentialId: cid } };
  const beginOpts = { signal, timeoutMs: PASSKEY_BEGIN_TIMEOUT_MS };
  // Just after the phone wakes up, the first request often fails before the connection is back: try once more.
  const begin = await postToServer(beginReq, beginOpts).catch(err => {
    if (!err || !err.network || err.timedOut) throw err;   // not after a long wait: that is long enough
    return waitForOnlineOr(PASSKEY_RETRY_MS, signal).then(() => postToServer(beginReq, beginOpts));
  });
  if (!begin.ok) throw serverError(begin, 'Sign-in failed');
  const giveUpAt = Date.now() + PASSKEY_ANSWER_WINDOW_MS;
  if (onPrompt) onPrompt();
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
  return sendPasskeyFinish({ action: 'passkeyLoginFinish', payload: {
    credentialId: bytesToB64u(cred.rawId),
    clientDataJSON: bytesToB64u(r.clientDataJSON),
    authenticatorData: bytesToB64u(r.authenticatorData),
    signature: bytesToB64u(r.signature)
  } }, { signal, onSlow, giveUpAt });
}

// Sends the signed answer, and the very same one again while no reply gets through (see PASSKEY_FINISH_TIMEOUT_MS),
// or while the server is busy, until `giveUpAt`. Resolves with { session, expiresAt }. `onSlow` (optional) is called
// once, when the first try didn't get in. Running out of time throws an error marked `finishLost`, and so does a
// resend the server turns down: an earlier try used up the challenge, but its reply never came back.
async function sendPasskeyFinish(req, { signal, onSlow, giveUpAt }) {
  let resent = false, slowSaid = false;   // resent: an earlier try may have used up the challenge
  for (;;) {
    let reply = null, lost = null;
    try {
      reply = await postToServer(req, { signal, timeoutMs: Math.max(1000, Math.min(PASSKEY_FINISH_TIMEOUT_MS, giveUpAt - Date.now())) });
    } catch (err) {
      if (!err || !err.network || (signal && signal.aborted)) throw err;
      lost = err;
    }
    if (reply && reply.ok) return reply.data;
    if (reply && resent && reply.code === 'AUTH_FAILED') throw Object.assign(serverError(reply, 'Sign-in failed'), { finishLost: true });
    if (reply && reply.code !== 'BUSY') throw serverError(reply, 'Sign-in failed');
    if (Date.now() + PASSKEY_FINISH_AGAIN_MS >= giveUpAt) throw Object.assign(lost || serverError(reply, 'Sign-in failed'), { finishLost: true });
    if (!slowSaid && onSlow) { slowSaid = true; onSlow(); }
    await waitForOnlineOr(PASSKEY_FINISH_AGAIN_MS, signal);
    if (lost) resent = true;   // that try may have reached the server (a busy one didn't: the challenge is still unused)
  }
}

// Waits `ms`, or less if the phone says it is back online; fails (AbortError) as soon as `signal` (optional) aborts.
function waitForOnlineOr(ms, signal) {
  return new Promise((resolve, reject) => {
    const done = () => { clearTimeout(t); window.removeEventListener('online', done); if (signal) signal.removeEventListener('abort', stop); resolve(); };
    const stop = () => { done(); reject(new DOMException('Cancelled', 'AbortError')); };
    const t = setTimeout(done, ms);
    window.addEventListener('online', done);
    if (signal) { if (signal.aborted) return stop(); signal.addEventListener('abort', stop); }
  });
}

// A stuck fingerprint request belongs to the page, so only reloading it clears it. By itself the lock screen reloads
// only while it is showing, on screen, with no sheet open under it (so nothing typed can be lost; spends saved offline
// are kept on the device and survive it), and not again within PASSKEY_RELOAD_GAP_MS, so it can never loop; otherwise a
// tap on the button (`byTap`) reloads. (A phone can hold a fingerprint request from a prompt that never showed, say one
// asked for while the screen went off, until the page is reloaded; with the app left open overnight that is the norm.)
const sheetOpenUnderLock = () => !!document.querySelector('.kb-sheet:not(.hidden)');   // every sheet has kb-sheet (a test checks)
const PASSKEY_RELOAD_KEY = 'pf_pk_reloaded';   // sessionStorage: when this tab last reloaded for a stuck request
const PASSKEY_RELOAD_GAP_MS = 60 * 1000;
let passkeyNeedsReload = false;
const PASSKEY_STUCK_MSG = 'The fingerprint prompt is stuck. Tap "Unlock with fingerprint" to reload and try again, or sign in with Google.';
function reloadForStuckPrompt(byTap) {
  if (apiInflight > 0) return false;   // a save on its way finishes first
  if (!byTap && (!lockScreenShowing() || sheetOpenUnderLock() || document.visibilityState !== 'visible')) return false;
  if (!byTap && Date.now() - (Number(ssGet(PASSKEY_RELOAD_KEY)) || 0) < PASSKEY_RELOAD_GAP_MS) return false;
  if (!ssSet(PASSKEY_RELOAD_KEY, String(Date.now())) && !byTap) return false;   // no record means no guard against a loop: only a tap may reload then
  location.reload();
  return true;
}

// The fingerprint sign-in running now (its AbortController), or null.
let passkeyAttempt = null;
function setPasskeyFailMsg(text, isError) { setLockMsg(text, isError, 'fail'); }   // the next try clears it
// The lock screen's fingerprint button says which step the try is on, and the line above it never contradicts that.
// This is the only place that writes the button; each step also says what happens to the line (`line`: its own note;
// `clears`: lines of those kinds give way). A "trying again" note stays while connecting, since that is what happens.
const UNLOCK_STEPS = {
  idle: { label: 'Unlock with fingerprint', clears: ['slow'] },
  connecting: { label: 'Connecting…', clears: ['fail', 'slow'] },
  prompting: { label: 'Waiting for fingerprint…', clears: ['noConnection', 'offline'] },
  finishing: { label: 'Signing in…' },
  slow: { label: 'Still signing in…', line: PASSKEY_SLOW_MSG }
};
function showUnlockStep(step) {
  const s = UNLOCK_STEPS[step];
  const label = document.getElementById('passkeyUnlockLabel');
  if (label) label.textContent = s.label;
  if (s.line) setLockMsg(s.line, false, step);
  else if (s.clears && s.clears.includes(lockLineKind)) setLockMsg(LOCK_IDLE_MSG, false);
}
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
  showUnlockStep('connecting');
  try {
    const s = await passkeyLoginRoundTrip(attempt.signal, {
      onPrompt: () => {
        passkeyNoConnection = 0;
        showUnlockStep('prompting');
      },
      onAccepted: () => {
        attempt.accepted = true;
        showUnlockStep('finishing');
      },
      onSlow: () => showUnlockStep('slow')
    });
    // Without the session saved nothing can be sent (and the lock screen would ask again and again): say so plainly.
    if (!saveSession(s.session, s.expiresAt)) { setPasskeyFailMsg(STORAGE_REFUSED_MSG, true); return; }
    passkeyAutoTried = true;   // tapped or not, no prompt by itself until the first figures are in (firstFiguresIn)
    afterPasskeySignIn();
  } catch (err) {
    // Cancelled (by a tap that asks again, or a Google sign-in): no message, whatever cancelled it has the screen.
    if (attempt.signal.aborted) return;
    if (err && err.promptBusy) {
      passkeyNeedsReload = true;
      if (!reloadForStuckPrompt(false)) setLockMsg(PASSKEY_STUCK_MSG, false, 'stuck');
      return;
    }
    // No connection yet (often just after waking): the lock screen asks again by itself once it's back. (Not once the
    // fingerprint was accepted: a second prompt popping up by itself would be a surprise; the button is there.)
    if (err && err.network && lockAllowsAuto && !attempt.accepted) {
      setLockMsg(PASSKEY_NO_CONNECTION_MSG, false, 'noConnection');
      autoUnlockWithPasskey(Math.min(PASSKEY_AGAIN_MAX_MS, PASSKEY_AGAIN_FIRST_MS * 2 ** passkeyNoConnection++));
      return;
    }
    const d = describePasskeyError(err, auto);
    if (d.forget) { lsDel(PASSKEY_ID_KEY); updateLockPasskeyUi(); }
    setPasskeyFailMsg(d.text, d.error);
  } finally {
    if (passkeyAttempt === attempt) passkeyAttempt = null;
    // The button and the timing belong to a newer try, if one has started meanwhile.
    if (!passkeyAttempt) {
      showUnlockStep('idle');
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
    if (!err || err.code !== 'REAUTH') throw err;
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
const PENDING_LOOK = 'bg-amber-500/15 text-amber-700 dark:text-amber-300';   // waiting for approval in the email
const PK_MESSAGE_LOOKS = { error: 'bg-rose-500/10 text-rose-600 dark:text-rose-400', ok: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
  wait: PENDING_LOOK, info: 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300' };
function setPkMessage(text, kind) {
  const el = document.getElementById('pkMsg');
  if (!el) return;
  el.textContent = text || '';
  el.className = text ? 'text-xs rounded-xl px-3 py-2 ' + (PK_MESSAGE_LOOKS[kind] || PK_MESSAGE_LOOKS.info) : 'hidden';
}
function renderPasskeyModal() {
  const here = passkeyEnrolledHere();
  const supported = passkeySupported();
  const waiting = here && pkDevices && pkDevices.some(d => d.id === lsGet(PASSKEY_ID_KEY) && d.pending);
  document.getElementById('pkStatus').textContent = !supported ? "This browser can't use fingerprint sign-in."
    : waiting ? 'Fingerprint sign-in on this device is waiting for your approval in the email. No email? Tap "Turn off", then set it up again.'
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
          <div class="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 min-w-0"><span class="font-medium text-slate-800 dark:text-slate-100 truncate min-w-0">${esc(d.label)}</span>${d.id === mine ? '<span class="text-xs px-1.5 py-0.5 rounded-full whitespace-nowrap bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">this device</span>' : ''}${d.pending ? `<span class="text-xs px-1.5 py-0.5 rounded-full whitespace-nowrap ${PENDING_LOOK}">waiting for approval</span>` : ''}</div>
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
    renderPasskeyModal();   // the status line says if this device still waits for approval
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
      setPkMessage(PASSKEY_APPROVE_MSG, 'wait');
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
    const s = await passkeyLoginRoundTrip(undefined, { onSlow: () => setPkMessage(PASSKEY_SLOW_MSG, 'info') });
    saveSession(s.session, s.expiresAt);
    setPkMessage('It works. Next time the app locks, just use your fingerprint.', 'ok');
    refreshPasskeyDevices();
  } catch (err) {
    // (Not the lock screen's words for it: this dialog has no "Unlock with fingerprint" button.)
    const d = err && err.finishLost ? { text: "Your fingerprint was accepted, but the reply didn't arrive. Try again in a moment." } : describePasskeyError(err, false);
    if (d.forget) { lsDel(PASSKEY_ID_KEY); renderPasskeyModal(); }
    setPkMessage(d.text, d.wait ? 'wait' : 'error');
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
const SIGN_OUT_KEEP = [THEME_KEY, PASSKEY_OFFER_DISMISSED_KEY, SPEND_VIEW_KEY];   // preferences, not data
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
  document.getElementById('soEverywhereBtn').textContent = soArmed === 'everywhere' ? 'Tap again to sign out everywhere' : 'Sign out everywhere';
  ['soBtn', 'soForgetBtn', 'soEverywhereBtn', 'soSendBtn'].forEach(id => { document.getElementById(id).disabled = soBusy; });
}
// The first tap of a button that needs two: arms `which` for 4 s. True if it armed (so the caller stops there).
function armSignOut(which) {
  if (soArmed === which) return false;
  soArmed = which;
  clearTimeout(soArmTimer);
  soArmTimer = setTimeout(() => { soArmed = null; renderSignOutModal(); }, 4000);
  renderSignOutModal();
  return true;
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
  if (loadOutbox().length && armSignOut(forget ? 'forget' : 'keep')) return;
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
  finishSignOut(forget);
}
// The sign-out itself, on this device: what it saved goes, the other tabs lock, and the page starts afresh.
function finishSignOut(forget) {
  clearThisDevice(forget);
  lsSet(SIGNED_OUT_NOTICE, String(Date.now()));   // tells this app's other open tabs (see below)
  ssSet(SIGNED_OUT_FLAG, '1');
  stopGoogleAutoSignIn();
  location.reload();
}
// Sign out everywhere: always two taps. The server then refuses every sign-in made before now, on every device (each
// one has to sign in again; fingerprint devices stay set up), and this device signs out as a plain sign-out would.
// Not while spends wait to be sent: afterwards nothing here could send them. If the server can't be told, nothing is
// cleared here and it says so.
async function signOutEverywhere() {
  if (soBusy) return;
  if (apiInflight) {   // a save still on its way may yet end up waiting to send
    soBusy = true;
    renderSignOutModal();
    await apiQueue;
    await new Promise(r => setTimeout(r, 0));
    soBusy = false;
    renderSignOutModal();
  }
  if (loadOutbox().length) {
    soArmed = null;
    renderSignOutModal();
    setSoMessage('Send the spends waiting on this device first (Send now, above), then sign out everywhere.');
    return;
  }
  if (armSignOut('everywhere')) return;
  clearTimeout(soArmTimer);
  soArmed = null;
  soBusy = true;
  setSoMessage('');
  renderSignOutModal();
  try {
    await apiCall('signOutEverywhere', {});
  } catch (err) {
    soBusy = false;
    renderSignOutModal();
    setSoMessage(err && (err.auth || err.needsSignIn)
      ? 'Sign in again, then tap "Sign out everywhere" once more. Nothing has changed yet.'
      : "Couldn't sign out everywhere (" + ((err && err.message) || 'unknown error') + '). Nothing was cleared on this device. Try again.');
    return;
  }
  finishSignOut(false);
}
// Signed out in another tab: this one locks too, the same way, so it can't go on showing the figures or save them
// again.
window.addEventListener('storage', e => {
  if (e.key !== SIGNED_OUT_NOTICE || !e.newValue || IS_GAS_ENV) return;
  ssSet(SIGNED_OUT_FLAG, '1');
  location.reload();
});

    // Each account is a small card in its own colour with a short label: readable at a glance, no brand logos.
    const ACCOUNT_CARDS = {
      amex: { label: 'AX', name: 'Amex', from: '#3B82F6', to: '#1E3A8A' },
      barclays: { label: 'BC', name: 'Barclays', from: '#06B6D4', to: '#0E5A8A' },
      checking: { label: 'NW', name: 'Nationwide', from: '#8B5CF6', to: '#3B2A8C' },
      marcus: { label: 'MS', name: 'Marcus', from: '#F59E0B', to: '#9A4B0B' }
    };
    // The four accounts in the order the screen lists them.
    const ACCTS = ['amex', 'barclays', 'checking', 'marcus'];
    function accountCard(acct) { return ACCOUNT_CARDS[acct] || ACCOUNT_CARDS.marcus; }
    function getBankLogo(acct) {
      const c = accountCard(acct);
      return `<span class="inline-flex items-center justify-center shrink-0 text-white font-bold" title="${c.name}" style="width:30px;height:20px;border-radius:4px;font-size:9.5px;letter-spacing:.04em;background:linear-gradient(135deg,${c.from},${c.to})">${c.label}</span>`;
    }

    // What the screen shows before any figures have arrived.
    const SHEET_LINK = /^https:\/\/docs\.google\.com\/spreadsheets\//;
    function emptyState() {
      return {
        sheetUrl: '#', availableMonths: [], activeMonth,
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
    // Whether a month's figures are ones the screen can draw (a damaged or cut-short saved copy isn't). The totals are
    // worked out from the rows (sheetFigures), so every list must be there and every row needs an amount that is a number.
    function usableMonth(s) {
      if (!s || typeof s !== 'object') return false;
      if (s.availableMonths !== undefined && !Array.isArray(s.availableMonths)) return false;
      return MONTH_LISTS.every(k => Array.isArray(s[k])
        && s[k].every(r => r && typeof r === 'object' && Number.isFinite(Number(r.amount || 0))));
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
    // Small two-way switches inside a sheet or box (the Owed tabs, Mine | Total).
    const SEG_ON = 'hit px-3 py-1 rounded-lg bg-white dark:bg-slate-900 text-slate-900 dark:text-white';
    const SEG_OFF = 'hit px-3 py-1 rounded-lg text-slate-500 dark:text-slate-400';
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
    // A chosen / not chosen option in the Pay off sheet: an outline, so its Pay button stays the one solid green thing.
    const PICK_ON = 'rounded-xl border border-emerald-500 bg-emerald-500/10 text-slate-900 dark:text-white';
    const PICK_OFF = 'rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-300';
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
      ['Eating out', /uber ?eats|deliveroo|just ?eat|mcdo|mcdonald|burger|\bwolf\b|spoons|pretzel|cafe|café|kebab|wasabi|\btea\b|coffee|pizza|restaurant|takeaway|\bpub\b|greggs|chipotle|fish and chips|breakfast/],
      ['Travel', /airport|hotel|airbnb|flight|ryanair|easyjet|ferry|holiday/],
      ['Transport', /petrol|\btfl\b|taxi|\bbus\b|train|fuel|\buber\b|trainline|railcard|stagecoach|\bparking\b/],
      ['Groceries', /waitrose|sainsbur|sains|tesco|lidl|aldi|\bcoop\b|co-op|\bm&s\b|asda|morrisons|iceland|ocado|nespresso|grocer|asian shop|beer hawk/],
      ['Bills & subscriptions', /spotify|netflix|disney|\bsky\b|windscribe|curve|\bsub\b|subscription|premium|\byt\b|youtube|\bo2\b|\bee\b|broadband|phone|energy|water|insurance|monthly fee|claude|yearly fee|\bhp\b/],
      ['Entertainment', /comedy|cinema|theatre|\bgig\b|ticket|\bpsn\b|steam|\bgame|\bwow\b|warcraft|festival/],
      ['Health', /pharmacy|\bboots\b|dentist|dental|optician|vision express|vitality|doctor|\bgp\b|haircut|\bgym\b/],
      ['Shopping', /amazon|ebay|vinted|primark|home barg|the works|\bdhl\b|oxfam|argos|post office|savers|temu|\bwise\b|tk ?maxx|sostrene|\bsmiths\b|\bshelter\b/]
    ];
    // Your own extra words for a category (local places), which the backend sends once you're signed in, so they
    // aren't in this public page. Each counts as part of its category's rule above, in the same order.
    let SPEND_EXTRA = {};
    // A word list from the backend as a pattern: each word as plain text (no pattern characters).
    const escRe = w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    function setSpendWords(words) {
      const out = {};
      Object.keys(words && typeof words === 'object' ? words : {}).forEach(cat => {
        const list = (Array.isArray(words[cat]) ? words[cat] : []).map(w => String(w).trim().toLowerCase()).filter(Boolean);
        if (SPEND_CATEGORIES.indexOf(cat) !== -1 && list.length) out[cat] = new RegExp(list.map(escRe).join('|'));
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
    // Money paid back for a card spend, by the spend's shop: a Nationwide row with money in whose words end with that
    // shop's name ("kim waitrose" or "kim / lee waitrose" for "Waitrose"; "insurer dental care" for "Dental care";
    // "savings ..." when your savings paid a share), still owed or already paid. Nationwide's own spends compete too, so
    // "kim brighton taxi" belongs to a Nationwide "Brighton taxi", not to a card "Taxi"; the longest matching name wins
    // (only card shops are looked up afterwards). An owed row carried over from `prev` (last month, as Start New Month copies
    // unpaid ones: same words, same amount) was counted there, so it isn't counted again, even once it is paid back
    // here. Anything else is left alone.
    function paybacksByShop(st, cardShops, prev) {
      const out = Object.create(null);
      const checking = st && st.checking || [];
      const own = checking.filter(r => Number(r.amount || 0) < 0).map(r => spendKey(r.desc)).filter(Boolean);
      const shops = [...new Set(cardShops.concat(own))].sort((a, b) => b.length - a.length);
      const carried = Object.create(null);   // "words|amount" -> how many owed rows last month
      (prev && prev.checking || []).filter(r => r.need).forEach(r => {
        const k = spendKey(r.desc) + '|' + Number(r.amount || 0).toFixed(2);
        carried[k] = (carried[k] || 0) + 1;
      });
      checking.forEach(r => {
        const amt = Number(r.amount || 0);
        if (!(amt > 0)) return;
        const key = spendKey(r.desc);
        const ck = key + '|' + amt.toFixed(2);
        if (carried[ck]) { carried[ck]--; return; }   // owed or paid back since: counted last month either way
        const shop = shops.find(sh => key.endsWith(' ' + sh));
        if (shop) out[shop] = (out[shop] || 0) + amt;   // only card shops are ever read back
      });
      return out;
    }
    // Amex and Barclays spending by category and shop, each with `charged` (as on the card) and `share` (yours: less
    // what was paid back for it, never below £0), and the month's `charged`, `share` and `paidBack`. Pass last month
    // as `prev` when there is one (see paybacksByShop). Categories and shops come largest first by `charged`.
    function summariseSpend(st, overrides, prev) {
      const cats = {};
      ['amex', 'barclays'].forEach(acct => (st && st[acct] || []).forEach(r => {
        const key = spendKey(r.desc);
        if (!key || SPEND_SKIP.test(key)) return;
        const amt = -Number(r.amount || 0);   // spends are negative in the sheet; refunds positive
        if (!amt) return;
        const cat = categoryFor(key, overrides);
        const c = cats[cat] || (cats[cat] = { cat, merchants: Object.create(null) });   // shops are keyed by sheet text (see groupOwed)
        const m = c.merchants[key] || (c.merchants[key] = { key, name: String(r.desc).trim(), charged: 0, count: 0 });
        m.charged += amt;
        m.count++;
      }));
      const back = paybacksByShop(st, Object.values(cats).flatMap(c => Object.keys(c.merchants)), prev);
      const r2 = n => +n.toFixed(2);
      const sum = { charged: 0, share: 0, paidBack: 0 };
      const categories = Object.values(cats).map(c => {
        const merchants = Object.values(c.merchants).map(m => {
          const off = back[m.key] ? Math.min(back[m.key], Math.max(m.charged, 0)) : 0;
          return { key: m.key, name: m.name, count: m.count, charged: r2(m.charged), share: r2(m.charged - off), off };
        });
        const cc = merchants.reduce((t, m) => t + m.charged, 0), cs = merchants.reduce((t, m) => t + m.share, 0);
        sum.charged += cc;
        sum.share += cs;
        sum.paidBack += merchants.reduce((t, m) => t + m.off, 0);
        merchants.forEach(m => delete m.off);
        return { cat: c.cat, charged: r2(cc), share: r2(cs), merchants: merchants.sort((a, b) => b.charged - a.charged) };
      }).sort((a, b) => b.charged - a.charged);
      return { charged: r2(sum.charged), share: r2(sum.share), paidBack: r2(sum.paidBack), categories };
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

    let spendOpenCat = null;
    function loadSpendOverrides() {
      const o = lsJson(SPEND_OVERRIDES_KEY);
      return o && typeof o === 'object' ? o : {};
    }
    // The sheet's backend keeps your choices so every device agrees; this device keeps a copy so the view
    // still works offline. The server's copy wins whenever it is fetched.
    function storeSpendOverrides(map) { lsSet(SPEND_OVERRIDES_KEY, JSON.stringify(map || {})); }
    // Any reply carrying the whole map (a fetch, or the reply to a change made here) counts as fresh. The sheet is
    // only redrawn when the choices really changed, so an open Spending sheet doesn't flicker for nothing.
    const sameChoices = (a, b) => Object.keys(a).length === Object.keys(b).length && Object.keys(a).every(k => a[k] === b[k]);
    function applyCategoryChoices(reply) {
      if (!reply || !reply.choices) return;
      categoriesFetchedAt = Date.now();
      if (sameChoices(reply.choices, loadSpendOverrides())) return;
      storeSpendOverrides(reply.choices);
      if (!document.getElementById('spendModal').classList.contains('hidden')) renderSpend();
    }
    // Requests go one at a time, so opening Spending asks the server for the choices made on other devices at most
    // once every CATEGORIES_FRESH_MS; in between it uses this device's copy (a change made here is sent at once).
    // A failed or empty reply leaves the next open to ask again.
    const CATEGORIES_FRESH_MS = 10 * 60 * 1000;
    let categoriesFetchedAt = 0;
    function refreshCategoryChoices() {
      if (Date.now() - categoriesFetchedAt < CATEGORIES_FRESH_MS) return;
      categoriesFetchedAt = Date.now();   // asked: a second open meanwhile doesn't ask again
      apiCall('getCategoryChoices')
        .then(reply => { if (!reply || !reply.choices) categoriesFetchedAt = 0; applyCategoryChoices(reply); })
        .catch(() => { categoriesFetchedAt = 0; });   // quiet: the saved copy is already showing
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
          categoriesFetchedAt = 0;   // so the next open fetches the server's copy, as the message says
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
      if (spendTab === 'year') loadYear();   // first, so the view drawn says it is getting your months
      renderSpend();
      document.getElementById('spendModal').classList.remove('hidden');
      refreshCategoryChoices();
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
    // "November" (or "Nov" when short) for a tab named "November Payday 2026"; another name as it is (its first word when short).
    function monthLabel(name, short) {
      const word = String(name).split(' ')[0];
      if (!monthSortValue(name)) return short ? word : String(name);
      return short ? word.slice(0, 3) : word;
    }
    // The newest month: by name, whatever order the sheet's tabs are in (without names that say, the first tab).
    const newestMonth = months => months.slice().sort(newestFirst)[0];
    // Totals for every month this device has loaded before (the current one comes from live state), newest first.
    function spendMonthTotals(overrides, field) {
      const names = [...new Set((state.availableMonths || []).concat(activeMonth))].sort(newestFirst);
      const stateOf = name => name === activeMonth ? state : savedMonth(name);
      const out = [];
      names.forEach((name, i) => {
        const st = stateOf(name);
        if (st) out.push({ name, total: summariseSpend(st, overrides, names[i + 1] ? stateOf(names[i + 1]) : null)[field] });
      });
      return out;
    }

    // The month before the one on screen: by name when the names say so ("October Payday 2026"), otherwise the next
    // tab along (the sheet keeps the newest first).
    function monthBefore(name) {
      const months = state.availableMonths || [];
      const v = monthSortValue(name);
      const older = v ? months.filter(m => monthSortValue(m) && monthSortValue(m) < v).sort(newestFirst) : [];
      if (older.length) return older[0];
      const i = months.indexOf(name);
      return i > -1 && i + 1 < months.length ? months[i + 1] : null;
    }
    function previousMonthName() { return monthBefore(activeMonth); }
    // Last month's figures from this device's saved copy. Without one, they're fetched once, quietly, and the
    // Spending details redrawn when they arrive.
    let prevMonthAsked = null;
    function previousMonthState(name) {
      const st = savedMonth(name);
      if (st) return st;
      if (prevMonthAsked !== name && hasValidToken()) {   // not before sign-in, when it could only fail
        prevMonthAsked = name;
        apiCall('getCachedSheetState', { sheetName: name, forceRefresh: false })
          .then(s => {
            savePhoneCache(name, s, false);
            if (!document.getElementById('spendModal').classList.contains('hidden')) renderSpend();
            renderActSpend();   // its carried-over owed rows are now known there too
          })
          .catch(() => {});
      }
      return null;
    }

    // Against last month, in plain words (green is kept for the spending bars and what you've picked).
    function spendChangeHtml(now, before, monthLabel) {
      const c = compareSpend(now, before);
      if (c.kind === 'new') return ' · New';
      if (c.kind === 'same') return ' · Same as ' + esc(monthLabel);
      return ' · ' + (c.kind === 'up' ? '▲ ' : '▼ ') + fmtGBP(c.diff) + ' vs ' + esc(monthLabel);
    }

    // Mine (your share: each card spend less what others paid back for it) or Total (the cards as charged). One choice
    // for Spending and the Activity tab, kept on this device (a preference: Sign out keeps it).
    let spendView = lsGet(SPEND_VIEW_KEY) === 'total' ? 'total' : 'mine';
    function setSpendView(v) {
      spendView = v === 'total' ? 'total' : 'mine';
      lsSet(SPEND_VIEW_KEY, spendView);
      renderSpend();
      renderTransactions();   // the Activity tab's summary, and its list (a category chip may have gone)
    }
    // Which figure the summaries show: summariseSpend gives both.
    const spendField = () => spendView === 'mine' ? 'share' : 'charged';

    // ---- Month summaries for the Year view ----
    // A finished month in a few figures, kept by the backend (one row per month on a hidden "_Year" tab): card spending
    // as charged and your share by category, what was paid back, "Saved" (yours: your own savings rows in Marcus, from
    // the config's words, or null without them; total: the raw change in Marcus over the month, interest and money
    // taken out included) and Money Left at the end. `prev` is the month before (see paybacksByShop).
    let MY_SAVINGS = null;
    function monthSummary(st, prev, overrides) {
      const sum = summariseSpend(st, overrides, prev);
      const cats = {};
      sum.categories.forEach(c => { cats[c.cat] = [c.charged, c.share]; });
      const marcus = (st.marcus || []).filter(r => spendKey(r.desc) !== 'start');
      return {
        charged: sum.charged, share: sum.share, paidBack: sum.paidBack, cats,
        savedMine: MY_SAVINGS ? sumAmounts(marcus.filter(r => Number(r.amount) > 0 && MY_SAVINGS.test(spendKey(r.desc)))) : null,
        savedTotal: sumAmounts(marcus),
        left: sheetFigures(st, new Set()).eomSavingsJ,
      };
    }
    // A month's figures: this device's copy, or (`fresh`, or none here) fetched from the sheet. A fetched month isn't
    // kept on the device: the Year view may fetch many old months, and only the newest few are kept (KEEP_MONTHS).
    function monthStateFor(name, fresh) {
      const st = !fresh && savedMonth(name);
      if (st) return Promise.resolve(st);
      return apiCall('getCachedSheetState', { sheetName: name, forceRefresh: false }).then(s => {
        if (!s || s.activeMonth !== name) throw new Error('The sheet sent another month.');   // that tab is gone or renamed
        return s;
      });
    }
    // Your category choices, fetched (the server's copy wins), or this device's copy if they can't be.
    const freshCategoryChoices = () => apiCall('getCategoryChoices').then(r => { applyCategoryChoices(r); return loadSpendOverrides(); }).catch(() => loadSpendOverrides());
    // Sends a finished month's summary, worked out from the sheet's own figures, not this device's copies (which may
    // hold spends not yet sent, or be out of date): the month and the month before it (for its carried-over owed rows),
    // fetched, and your category choices (fetched unless given). Quietly: if a month can't be had, nothing is sent, and
    // the Year view makes it when it finds it missing. Resolves to whether it was saved; a saved one is also put into
    // the Year view's copy, so a month just finished shows there at once.
    function sendMonthSummary(name, overrides) {
      const before = monthBefore(name);
      let summary;
      return Promise.all([monthStateFor(name, true), before ? monthStateFor(before, true) : null, overrides || freshCategoryChoices()])
        .then(([st, prev, ov]) => { summary = monthSummary(st, prev, ov); return apiCall('saveMonthSummary', { sheetName: name, summary }); })
        .then(() => { keepYearRow(name, summary); return true; })
        .catch(err => { console.error('month summary not sent:', err); return false; });
    }

    // ---- Year view (the Spending sheet's "Year" side): one bar per finished month, from the summaries the backend
    // keeps (see sendMonthSummary). Finished months without one are worked out and sent once; a finished month whose
    // fresh figures differ from its summary is sent again when it's opened (it was edited since).
    const YEAR_CACHE_KEY = 'pf_year';          // the summaries last fetched, so the Year view shows at once (and offline)
    const YEAR_FILL_MAX = 24;                  // at most this many missing months are worked out in one go
    const YEAR_FIGURES = ['charged', 'share', 'paidBack', 'savedMine', 'savedTotal', 'left'];
    const MUTED = 'text-slate-500 dark:text-slate-400', STRONG = 'text-slate-900 dark:text-white';
    const NARROW_MQ = window.matchMedia('(max-width: 379px)');   // single-letter month names under the bars
    let spendTab = 'month';                    // 'month' or 'year'
    let yearRows = null;                       // [{ month, summary }] from the backend (or this device's copy); null: none yet
    let yearAsked = false, yearLoading = false, yearLoaded = false, yearFilling = false, yearFailed = false;
    const yearSavedHere = new Map();           // month -> summary saved from this device this session (newer than any read on its way)
    const yearFillTried = new Set();           // months the fill has tried this session (one that fails isn't tried again till the next)
    let yearPeriod = 'last';                   // 'last' (the last 12 finished months) or a year, like '2026'
    let yearPickMonth = null, yearPickCat = null, yearTable = false;
    const yearResent = new Set();              // months sent again this session, so a mismatch can't repeat forever

    const fmtGBP0 = n => { const v = Math.round(n); return (v < 0 ? '−' : '') + '£' + Math.abs(v).toLocaleString('en-GB'); };
    const monthYear = name => monthSortValue(name) ? Math.floor(monthSortValue(name) / 12) : 0;
    // "November 2026" from "November Payday 2026" (or the name as it is).
    const monthTitle = name => monthYear(name) ? monthLabel(name) + ' ' + monthYear(name) : String(name);
    // A category's amount in a month's summary: yours (mine) or as charged.
    const catAmt = (r, c, mine) => r.summary.cats[c] ? r.summary.cats[c][mine ? 1 : 0] : 0;

    // A saved summary as the Year view uses it, or null if it isn't one (a damaged copy on this device, say).
    function cleanYearRow(r) {
      if (!r || typeof r.month !== 'string' || !r.summary || typeof r.summary !== 'object') return null;
      const s = r.summary, out = { cats: {} };
      for (const k of YEAR_FIGURES) {
        const v = s[k];
        if (v === null && k === 'savedMine') out[k] = null;
        else if (typeof v === 'number' && isFinite(v)) out[k] = v;
        else return null;
      }
      Object.keys(s.cats && typeof s.cats === 'object' ? s.cats : {}).forEach(c => {
        const p = s.cats[c];
        if (SPEND_CATEGORIES.indexOf(c) !== -1 && Array.isArray(p) && p.length === 2 && p.every(v => typeof v === 'number' && isFinite(v))) out.cats[c] = [p[0], p[1]];
      });
      return { month: r.month, summary: out };
    }
    // null (nothing to show yet) stays null; anything else becomes the list of good rows.
    function setYearRows(rows, keep) {
      yearRows = rows == null ? null : (Array.isArray(rows) ? rows : []).map(cleanYearRow).filter(Boolean);
      if (keep && yearRows) lsSet(YEAR_CACHE_KEY, JSON.stringify(yearRows));
    }
    // A month's summary just saved: into the Year view's copy (replacing an older one), once the copy exists.
    function keepYearRow(name, summary) {
      yearSavedHere.set(name, summary);
      if (!yearRows) return;
      setYearRows(yearRows.filter(r => r.month !== name).concat([{ month: name, summary }]), true);
      if (spendTab === 'year') renderSpend();
    }
    // Two summaries are the same when every figure matches to the penny.
    function sameSummary(a, b) {
      if (!a || !b) return false;
      const same = (x, y) => (x === null || y === null) ? x === y : Math.abs(x - y) < 0.005;
      if (!YEAR_FIGURES.every(k => same(a[k], b[k]))) return false;
      const ca = a.cats || {}, cb = b.cats || {};
      return [...new Set(Object.keys(ca).concat(Object.keys(cb)))].every(c => ca[c] && cb[c] && same(ca[c][0], cb[c][0]) && same(ca[c][1], cb[c][1]));
    }
    // Every month in the sheet but the newest (the one still going), newest first: only tabs named with a month and a
    // year ("November Payday 2026"), as only those can be put in order.
    function finishedMonths() {
      const months = (state.availableMonths || []).filter(m => monthSortValue(m)).sort(newestFirst);
      return months.slice(1);
    }
    function setSpendTab(t) {
      spendTab = t === 'year' ? 'year' : 'month';
      yearPickMonth = yearPickCat = null;
      if (spendTab === 'year') loadYear();   // first, so the view drawn says it is getting your months
      renderSpend();
    }
    // Asked once a session (this device's copy shows meanwhile), when Year is tapped or Spending opens on it: never
    // from a redraw, so a read that fails can't set off another. A failed one is tried again on the next open.
    function loadYear() {
      if (yearAsked) return;
      yearAsked = yearLoading = true;
      yearFailed = false;
      apiCall('getYearSummaries').then(r => {
        const rows = (r && Array.isArray(r.months) ? r.months : []).filter(x => !(x && yearSavedHere.has(x.month)));
        setYearRows(rows.concat([...yearSavedHere].map(([month, summary]) => ({ month, summary }))), true);
        yearLoading = false;
        yearLoaded = true;
        fillYear();
        checkMonthSummary();
        if (spendTab === 'year') renderSpend();
      }).catch(() => {
        yearAsked = yearLoading = false;
        yearFailed = true;
        if (spendTab === 'year' && !document.getElementById('spendModal').classList.contains('hidden')) renderSpend();
      });
    }
    // Finished months the backend has no summary for (from before summaries were kept, or one that didn't arrive):
    // worked out and sent one at a time, oldest first (each lands in the view as it is saved). Once the summaries have
    // been read; tried again when the month list changes (applyServerState), but each month once a session.
    function fillYear() {
      if (yearFilling || !yearLoaded || !yearRows) return;
      const have = new Set(yearRows.map(r => r.month));
      const missing = finishedMonths().filter(m => !have.has(m) && !yearFillTried.has(m)).slice(0, YEAR_FILL_MAX).reverse();
      missing.forEach(m => yearFillTried.add(m));
      if (!missing.length) return;
      yearFilling = true;
      freshCategoryChoices()
        .then(ov => missing.reduce((p, m) => p.then(() => sendMonthSummary(m, ov)), Promise.resolve()))
        .then(() => { yearFilling = false; if (spendTab === 'year') renderSpend(); });
    }
    // A finished month opened with fresh figures: if its summary differs (it was edited since), send it again, once a
    // session. Needs last month on this device; without it the comparison isn't fair, so it waits.
    function checkMonthSummary() {
      if (!yearRows || state.loading || yearResent.has(activeMonth) || finishedMonths().indexOf(activeMonth) === -1) return;
      const stored = yearRows.find(r => r.month === activeMonth);
      if (!stored) return;   // a missing one is the Year view's to fill
      const before = monthBefore(activeMonth), prev = before ? savedMonth(before) : null;
      if (before && !prev) return;
      if (sameSummary(monthSummary(state, prev, loadSpendOverrides()), stored.summary)) return;
      const month = activeMonth;
      yearResent.add(month);
      sendMonthSummary(month);   // once a session, sent or not (a month the backend keeps refusing can't repeat)
    }

    // The summaries for the chosen period, oldest first, of months still in the sheet.
    function yearRowsInSheet() {
      const order = finishedMonths().reverse();
      return (yearRows || []).filter(r => order.indexOf(r.month) !== -1).sort((a, b) => order.indexOf(a.month) - order.indexOf(b.month));
    }
    // The years to choose from (only when there are months in more than one).
    function yearPeriods(inSheet) {
      const years = [...new Set(inSheet.map(r => monthYear(r.month)).filter(Boolean).map(String))].sort().reverse();
      return years.length > 1 ? years : [];
    }
    function setYearPeriod(v) { yearPeriod = v === 'last' || /^\d{4}$/.test(v) ? v : 'last'; yearPickMonth = yearPickCat = null; renderSpend(); }
    function pickYearMonth(m) { yearPickMonth = yearPickMonth === m ? null : m; yearPickCat = null; renderSpend(); }
    function pickYearCat(c) {
      yearPickCat = yearPickCat === c ? null : c;
      yearPickMonth = null;
      renderSpend();
      if (yearPickCat) { const ch = document.getElementById('yearChart'); if (ch && ch.scrollIntoView) ch.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }
    }
    function clearYearPick() { yearPickMonth = yearPickCat = null; renderSpend(); }
    function setYearTable(view) { yearTable = view === 'table'; renderSpend(); }
    // Chart | Table (a computer only), a small two-way switch like Mine | Total.
    const yearViewSwitch = () => '<div role="group" aria-label="Show as" class="flex gap-1 bg-slate-100 dark:bg-slate-800 p-1 rounded-xl w-fit text-xs font-semibold">'
      + [['chart', 'Chart'], ['table', 'Table']].map(([v, t]) => '<button data-action="setYearTable" data-arg="' + v + '" aria-pressed="' + (yearTable === (v === 'table')) + '" class="' + (yearTable === (v === 'table') ? SEG_ON : SEG_OFF) + '">' + t + '</button>').join('') + '</div>';

    // What stood out, worked out by rules from 3 months on (at most three): a category clearly up or down lately
    // (spent on in each of the last 3 months), a month far above a category's usual (a trip, say), the best month for
    // money left, months nothing was saved (yours) or Marcus went down (in all).
    function yearNotes(rows, mine) {
      if (rows.length < 3) return [];
      const notes = [];
      const avg = list => list.length ? list.reduce((a, b) => a + b, 0) / list.length : 0;
      if (rows.length >= 4) {
        let best = null;
        SPEND_CATEGORIES.forEach(c => {
          if (!rows.slice(-3).every(r => catAmt(r, c, mine) > 0)) return;
          const late = avg(rows.slice(-3).map(r => catAmt(r, c, mine))), early = avg(rows.slice(0, -3).map(r => catAmt(r, c, mine)));
          const diff = late - early;
          if (early > 0 && Math.abs(diff) >= 15 && Math.abs(diff) / early >= 0.2 && (!best || Math.abs(diff) > Math.abs(best.diff))) best = { c, late, early, diff };
        });
        if (best) notes.push([best.c + (best.diff > 0 ? ' is up' : ' is down'), 'Last 3 months ' + fmtGBP0(best.late) + ' a month, against ' + fmtGBP0(best.early) + ' before.']);
      }
      let big = null;
      SPEND_CATEGORIES.forEach(c => {
        const list = rows.map(r => catAmt(r, c, mine)), median = list.slice().sort((a, b) => a - b)[Math.floor(list.length / 2)];
        list.forEach((v, i) => { if (v >= 150 && v >= 3 * Math.max(median, 1) && (!big || v > big.v)) big = { c, v, m: rows[i].month }; });
      });
      if (big) notes.push(['A big month for ' + big.c, monthTitle(big.m) + ': ' + fmtGBP0(big.v) + '.']);
      const bestLeft = rows.reduce((a, r) => r.summary.left > a.summary.left ? r : a, rows[0]);
      if (bestLeft.summary.left > 0) notes.push(['Best month: ' + monthLabel(bestLeft.month), fmtGBP0(bestLeft.summary.left) + ' left at payday.']);
      const key = mine ? 'savedMine' : 'savedTotal';
      const low = rows.filter(r => r.summary[key] !== null && (mine ? r.summary[key] <= 0 : r.summary[key] < 0));
      if (low.length && low.length <= 2) notes.push([(mine ? 'Nothing saved in ' : 'Marcus went down in ') + low.map(r => monthLabel(r.month)).join(' and '),
        low.map(r => monthLabel(r.month) + ' ' + fmtGBP0(r.summary[key])).join(', ') + '.']);
      return notes.slice(0, 3);
    }

    function renderYear(k) {
      const mine = k === 'share';
      const inSheet = yearRowsInSheet(), periods = yearPeriods(inSheet);
      if (yearPeriod !== 'last' && periods.indexOf(yearPeriod) === -1) yearPeriod = 'last';   // that year has gone
      const rows = yearPeriod === 'last' ? inSheet.slice(-12) : inSheet.filter(r => String(monthYear(r.month)) === yearPeriod);
      const n = rows.length, wide = WIDE_SCREEN_MQ.matches;
      if (yearPickMonth && !rows.some(r => r.month === yearPickMonth)) yearPickMonth = null;
      const totals = SPEND_CATEGORIES.map(c => ({ c, v: rows.reduce((a, r) => a + catAmt(r, c, mine), 0), any: rows.some(r => r.summary.cats[c]) }))
        .filter(x => x.any).sort((a, b) => b.v - a.v);
      if (yearPickCat && !totals.some(x => x.c === yearPickCat)) yearPickCat = null;

      // The period (a choice once there is more than one year; plain words otherwise) and, on a wide screen, Chart | Table.
      let html = '<div class="flex items-center justify-between gap-2">';
      if (periods.length) {
        html += '<label class="block text-xs font-semibold ' + STRONG + '"><span class="sr-only">Period</span><select data-change="setYearPeriod" class="bg-transparent font-semibold ' + STRONG + ' -ml-1">'
          + ['last'].concat(periods).map(p => '<option value="' + p + '"' + (p === yearPeriod ? ' selected' : '') + '>' + (p === 'last' ? 'Last 12 months' : p) + '</option>').join('') + '</select></label>';
      } else if (n) {
        html += '<div class="text-xs font-semibold ' + MUTED + '">' + (n < 12 ? 'Since ' + esc(monthTitle(rows[0].month)) : esc(monthTitle(rows[0].month)) + ' to ' + esc(monthTitle(rows[n - 1].month))) + '</div>';
      } else html += '<div></div>';
      html += (n && WIDE_SCREEN_MQ.matches ? yearViewSwitch() : '') + '</div>';
      if (!n) {
        const words = yearLoading || yearFilling ? 'Getting your months…'
          : yearFailed || (yearRows !== null && finishedMonths().length) ? "Couldn't get your months just now. Open Year again to try again."
          : yearRows === null ? 'Getting your months…' : 'Your year starts once a month has finished: each one joins when you start the next.';
        return html + '<p class="text-sm ' + MUTED + '">' + words + '</p>';
      }
      html += yearFiguresHtml(rows, mine);
      if (WIDE_SCREEN_MQ.matches && yearTable) return html + yearTableHtml(rows, totals, mine);
      html += yearChartHtml(rows, mine, wide);
      // Below the chart: what stood out and the categories (side by side on a wide screen).
      const notes = yearNotes(rows, mine);
      html += wide ? '<div class="grid grid-cols-2 gap-6 items-start">' : '';
      if (notes.length) {
        html += '<div><div class="text-sm font-semibold ' + MUTED + '">What stood out</div>' + notes.map(([t, b]) =>
          '<div class="my-1.5 pl-3 py-1 border-l-[3px] border-slate-300 dark:border-slate-600"><div class="text-sm font-semibold ' + STRONG + '">' + esc(t) + '</div><div class="text-xs ' + MUTED + '">' + esc(b) + '</div></div>').join('') + '</div>';
      } else if (n < 3) {
        html += '<p class="text-xs ' + MUTED + '">Each month joins when you start the next one. Notes start at 3 months.</p>';
      }
      html += yearCatsHtml(rows, totals);
      return html + (wide ? '</div>' : '');
    }
    // The three figures (spent, saved, left at payday) and what was paid back.
    function yearFiguresHtml(rows, mine) {
      const n = rows.length, sum = f => rows.reduce((a, r) => a + f(r), 0);
      const spent = sum(r => r.summary[mine ? 'share' : 'charged']), charged = sum(r => r.summary.charged), paidBack = sum(r => r.summary.paidBack);
      const key = mine ? 'savedMine' : 'savedTotal', known = rows.filter(r => r.summary[key] !== null);
      const savedMonths = known.filter(r => r.summary[key] > 0).length;
      const fig = (label, big, small) => '<div class="min-w-0 px-2.5 first:pl-0 last:pr-0"><div class="text-xs ' + MUTED + ' whitespace-nowrap">' + label + '</div>'
        + '<div class="text-lg font-semibold tabular-nums ' + STRONG + ' whitespace-nowrap">' + big + '</div><div class="text-xs ' + MUTED + ' tabular-nums whitespace-nowrap">' + small + '</div></div>';
      return '<div><div class="grid grid-cols-3 divide-x divide-slate-200 dark:divide-slate-700 bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-xl py-2.5 px-1">'
        + fig(mine ? 'You spent' : 'Charged', fmtGBP0(spent), fmtGBP0(spent / n) + ' a month')
        + fig('Saved', known.length ? fmtGBP0(known.reduce((a, r) => a + r.summary[key], 0)) : '—', mine ? savedMonths + (savedMonths === 1 ? ' month' : ' months') : 'Marcus in all')
        + fig('Left at payday', fmtGBP0(sum(r => r.summary.left) / n), 'on average') + '</div>'
        + '<div class="mt-1.5 text-xs ' + MUTED + ' tabular-nums">' + (mine ? 'Charged ' + fmtGBP0(charged) + ' · ' + fmtGBP0(paidBack) + ' paid back to you' : 'Includes ' + fmtGBP0(paidBack) + ' others paid back') + '</div></div>';
    }
    // The chart: one bar per month (a picked category on its own scale; a picked month brighter, with its line below),
    // an average line, and in the first months flat slots for the months to come.
    function yearChartHtml(rows, mine, wide) {
      const n = rows.length, cat = yearPickCat, k = mine ? 'share' : 'charged';
      const amt = r => cat ? catAmt(r, cat, mine) : r.summary[k];
      const max = Math.max(1, ...rows.map(amt)) * 1.08, avg = rows.reduce((a, r) => a + amt(r), 0) / n;
      const h = wide ? 180 : 130;
      const short = t => NARROW_MQ.matches ? t.charAt(0) : t;
      const last = monthSortValue(rows[n - 1].month);
      const slots = yearPeriod === 'last' && n < 12 && last ? 12 - n : 0;
      const clear = cat ? '<button data-action="clearYearPick" aria-label="Show every category" class="hit ml-2 font-semibold text-emerald-600 dark:text-emerald-400">' + esc(cat) + ' <span aria-hidden="true">✕</span></button>'
        : yearPickMonth ? '<button data-action="clearYearPick" aria-label="Show no month" class="hit ml-2 font-semibold text-emerald-600 dark:text-emerald-400">' + esc(monthLabel(yearPickMonth, true)) + ' <span aria-hidden="true">✕</span></button>' : '';
      let html = '<div id="yearChart"><div class="flex items-center justify-between gap-2 mb-2"><div class="text-sm font-semibold ' + MUTED + ' truncate">' + esc(cat ? cat + ', month by month' : (mine ? 'You spent, month by month' : 'Charged, month by month')) + '</div>'
        + '<div class="text-xs ' + MUTED + ' whitespace-nowrap inline-flex items-center"><span class="inline-block w-3.5 border-t border-dashed border-slate-400 mr-1" aria-hidden="true"></span>avg ' + fmtGBP0(avg) + clear + '</div></div>'
        + '<div class="relative"><div class="flex items-end gap-0.5">';
      rows.forEach(r => {
        const v = amt(r), on = yearPickMonth === r.month, dim = yearPickMonth && !on;
        html += '<button data-action="pickYearMonth" data-arg="' + esc(r.month) + '" aria-pressed="' + on + '" aria-label="' + esc(monthTitle(r.month)) + ' ' + fmtGBP0(v) + '" class="flex-1 min-w-0 flex flex-col items-center gap-1">'
          + '<span class="w-full flex items-end justify-center" style="height:' + h + 'px"><span class="block w-[72%] max-w-[34px] rounded-t-md rounded-b-sm bg-emerald-500' + (dim ? ' opacity-30' : '') + '" style="height:' + Math.max(v > 0 ? 2 : 0, Math.round(Math.max(0, v) / max * h)) + 'px"></span></span>'
          + '<span class="text-[11px] ' + (on ? 'font-semibold ' + STRONG : MUTED) + '">' + esc(short(monthLabel(r.month, true))) + '</span></button>';
      });
      for (let i = 1; i <= slots; i++) {
        html += '<div class="flex-1 min-w-0 flex flex-col items-center gap-1" aria-hidden="true"><span class="w-full flex items-end justify-center" style="height:' + h + 'px"><span class="block w-[72%] max-w-[34px] h-[3px] rounded-sm bg-slate-300 dark:bg-slate-700"></span></span>'
          + '<span class="text-[11px] ' + MUTED + ' opacity-60">' + short(MONTHS[(last + i) % 12].slice(0, 3)) + '</span></div>';
      }
      html += '</div>' + (n >= 2 && avg > 0 ? '<div class="absolute inset-x-0 border-t border-dashed border-slate-400/70 pointer-events-none" style="top:' + Math.round(h - avg / max * h) + 'px"></div>' : '') + '</div>';
      const r = yearPickMonth && rows.find(x => x.month === yearPickMonth);
      if (r) {
        const most = Object.keys(r.summary.cats).filter(c => catAmt(r, c, mine) > 0).sort((a, b) => catAmt(r, b, mine) - catAmt(r, a, mine))[0];
        const sv = r.summary[mine ? 'savedMine' : 'savedTotal'];
        html += '<div class="mt-2.5 bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 text-xs ' + MUTED + '">'
          + '<div class="flex justify-between gap-2"><span class="text-sm font-semibold ' + STRONG + '">' + esc(monthTitle(r.month)) + '</span><span class="text-sm font-semibold tabular-nums ' + STRONG + '">' + fmtGBP0(r.summary[k]) + '</span></div>'
          + '<div class="tabular-nums truncate">Saved ' + (sv === null ? '—' : fmtGBP0(sv)) + ' · left ' + fmtGBP0(r.summary.left) + (most ? ' · most on ' + esc(most) + ' ' + fmtGBP0(catAmt(r, most, mine)) : '') + '</div></div>';
      }
      return html + '</div>';
    }
    // By category over the period, each with its share of the whole; tap one to see it in the chart.
    function yearCatsHtml(rows, totals) {
      const all = totals.reduce((a, x) => a + Math.max(0, x.v), 0);
      return '<div><div class="flex items-center justify-between gap-2"><div class="text-sm font-semibold ' + MUTED + '">By category</div><div class="text-xs ' + MUTED + '">tap one to see it in the chart</div></div><div class="divide-y divide-slate-100 dark:divide-slate-800/70">'
        + totals.map(x => {
          const on = yearPickCat === x.c, pct = all > 0 ? Math.round(Math.max(0, x.v) / all * 100) : 0;
          return '<button data-action="pickYearCat" data-cat="' + esc(x.c) + '" aria-pressed="' + on + '" class="w-full text-left py-2.5 flex items-center gap-3' + (on ? ' bg-emerald-500/10 rounded-xl px-2 -mx-2' : '') + '">'
            + '<span class="w-9 h-9 rounded-xl shrink-0 inline-flex items-center justify-center bg-slate-100 dark:bg-slate-800 ' + MUTED + '">' + icon(CAT_ICON_NAMES[x.c] || 'cat_other', 'w-[18px] h-[18px]') + '</span>'
            + '<span class="min-w-0 flex-1"><span class="flex items-center justify-between gap-2"><span class="text-sm font-semibold ' + STRONG + ' truncate">' + esc(x.c) + '</span><span class="tabular-nums text-sm font-semibold ' + STRONG + '">' + fmtGBP0(x.v) + '</span></span>'
            + '<span class="block text-xs ' + MUTED + ' tabular-nums">' + fmtGBP0(x.v / rows.length) + ' a month · ' + pct + '%</span>' + shareBar(pct) + '</span>'
            + (on ? '<span class="text-emerald-600 dark:text-emerald-400 font-semibold" aria-hidden="true">✕</span>' : '') + '</button>';
        }).join('') + '</div></div>';
    }
    // The table (wide screens): categories by month, yours or as charged; a month well above a category's usual is
    // shaded. "Saved" counts only months where it is known.
    function yearTableHtml(rows, totals, mine) {
      const cell = 'text-right px-1.5 py-1 whitespace-nowrap tabular-nums text-xs';
      const whole = v => Math.round(v).toLocaleString('en-GB');
      let html = '<div class="overflow-x-auto"><table class="w-full"><thead><tr><th></th>' + rows.map(r => '<th class="' + cell + ' font-medium ' + MUTED + '">' + esc(monthLabel(r.month, true)) + '</th>').join('')
        + '<th class="' + cell + ' font-medium ' + MUTED + '">In all</th><th class="' + cell + ' font-medium ' + MUTED + '">A month</th></tr></thead><tbody>';
      totals.forEach(x => {
        const avg = x.v / rows.length;
        html += '<tr><td class="text-xs font-semibold ' + STRONG + ' pr-2 py-1 whitespace-nowrap">' + esc(x.c) + '</td>'
          + rows.map(r => { const v = catAmt(r, x.c, mine); return '<td class="' + cell + ' ' + (v ? STRONG : MUTED) + (v > avg * 1.25 && v - avg >= 15 ? ' font-bold bg-slate-200/70 dark:bg-slate-700/60 rounded' : '') + '">' + (v ? whole(v) : '–') + '</td>'; }).join('')
          + '<td class="' + cell + ' font-semibold ' + STRONG + '">' + fmtGBP0(x.v) + '</td><td class="' + cell + ' ' + MUTED + '">' + fmtGBP0(avg) + '</td></tr>';
      });
      const line = (label, f, noTotal) => {
        const vals = rows.map(f), known = vals.filter(v => v !== null), total = known.reduce((a, b) => a + b, 0);
        return '<tr class="border-t border-slate-200 dark:border-slate-700"><td class="text-xs font-semibold ' + MUTED + ' pr-2 py-1">' + label + '</td>'
          + vals.map(v => '<td class="' + cell + ' font-semibold ' + STRONG + '">' + (v === null ? '—' : whole(v)) + '</td>').join('')
          + '<td class="' + cell + ' font-semibold ' + STRONG + '">' + (noTotal || !known.length ? '–' : fmtGBP0(total)) + '</td><td class="' + cell + ' ' + MUTED + '">' + (known.length ? fmtGBP0(total / known.length) : '—') + '</td></tr>';
      };
      html += line(mine ? 'You spent' : 'Charged', r => r.summary[mine ? 'share' : 'charged'])
        + line('Paid back to you', r => r.summary.paidBack)
        + line('Saved', r => r.summary[mine ? 'savedMine' : 'savedTotal'])
        + line('Left at payday', r => r.summary.left, true);
      return html + '</tbody></table></div><p class="text-xs ' + MUTED + '">Shaded: well above that category\'s usual month.</p>';
    }
    // Only a copy that is a list is shown at first; without one the Year view says it is getting your months.
    const yearCopy = lsJson(YEAR_CACHE_KEY);
    if (Array.isArray(yearCopy)) setYearRows(yearCopy, false);
    const WIDE_SCREEN_MQ = window.matchMedia('(min-width: 1024px)');   // a computer: the table is offered
    [NARROW_MQ, WIDE_SCREEN_MQ].forEach(mq => { if (mq.addEventListener) mq.addEventListener('change', () => { if (!document.getElementById('spendModal').classList.contains('hidden')) renderSpend(); }); });
    // A thin bar: this share of the whole, in the one accent colour.
    const shareBar = pct => '<div class="mt-1.5 h-1 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden"><div class="h-full rounded-full bg-emerald-500" style="width:' + Math.max(0, Math.min(100, pct)) + '%"></div></div>';

    function renderSpend() {
      const overrides = loadSpendOverrides();
      const k = spendField(), mine = k === 'share';
      markChoice('sv_', ['mine', 'total'], spendView, SEG_ON, SEG_OFF);
      markChoice('stab_', ['month', 'year'], spendTab, SEG_ON, SEG_OFF);
      document.querySelector('#spendModal [role="dialog"]').classList.toggle('yr-wide', spendTab === 'year');
      if (spendTab === 'year') {
        document.getElementById('spendBody').innerHTML = renderYear(k);
        return;
      }
      const prevName = previousMonthName();
      const prevState = prevName ? previousMonthState(prevName) : null;
      const sum = summariseSpend(state, overrides, prevState);
      const before = prevName && monthBefore(prevName);
      const prevSum = prevState ? summariseSpend(prevState, overrides, before ? savedMonth(before) : null) : null;
      const prevLabel = prevName && monthSortValue(prevName) ? monthLabel(prevName, true) : 'last month';
      // A category all paid back stays (at £0.00), so its shops can still be seen and moved.
      const catRows = sum.categories.filter(c => Math.abs(c.charged) >= 0.005).sort((a, b) => b[k] - a[k]);
      const opts = sel => ['<option value="">Automatic</option>'].concat(SPEND_CATEGORIES.map(c => '<option value="' + esc(c) + '"' + (c === sel ? ' selected' : '') + '>' + esc(c) + '</option>')).join('');
      const sub = [mine ? 'of ' + fmtGBP(sum.charged) + ' charged' : fmtGBP(sum.paidBack) + ' paid back to you'];
      if (prevSum) sub.push(esc(monthLabel(prevName)) + ': ' + fmtGBP(prevSum[k]));
      let html = '<div id="spendHead"><div class="text-sm text-slate-500 dark:text-slate-400 truncate">' + (mine ? 'Your spending' : 'Spent on cards') + ' · ' + esc(monthLabel(activeMonth)) + '</div>'
        + '<div class="text-3xl font-semibold tracking-tight tabular-nums text-slate-900 dark:text-white">' + fmtGBP(sum[k]) + '</div>'
        + '<div class="text-xs text-slate-500 dark:text-slate-400 tabular-nums">' + sub.join(' · ') + '</div></div>';
      if (!catRows.length) html += '<p class="text-sm text-slate-500 dark:text-slate-400">No card spending recorded in this month yet.</p>';
      html += '<div class="divide-y divide-slate-100 dark:divide-slate-800/70">';
      catRows.forEach(c => {
        const pct = sum[k] > 0 ? Math.round(c[k] / sum[k] * 100) : 0;
        const open = spendOpenCat === c.cat;
        const n = c.merchants.reduce((a, m) => a + m.count, 0);
        html += '<div>'
          + '<button data-cat="' + esc(c.cat) + '" data-action="toggleSpendCat" class="w-full text-left py-2.5 flex items-center gap-3" aria-expanded="' + open + '">'
          + '<span class="w-9 h-9 rounded-xl shrink-0 inline-flex items-center justify-center bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400">' + icon(CAT_ICON_NAMES[c.cat] || 'cat_other', 'w-[18px] h-[18px]') + '</span>'
          + '<span class="min-w-0 flex-1"><span class="flex items-center justify-between gap-2"><span class="text-sm font-semibold text-slate-900 dark:text-white truncate">' + esc(c.cat) + '</span>'
          + '<span class="tabular-nums text-sm font-semibold text-slate-900 dark:text-white">' + fmtGBP(c[k]) + '</span></span>'
          + '<span class="block text-xs text-slate-500 dark:text-slate-400">' + n + (n === 1 ? ' purchase' : ' purchases') + ' · ' + pct + '%'
          + (prevSum ? spendChangeHtml(c[k], (prevSum.categories.find(x => x.cat === c.cat) || { [k]: 0 })[k], prevLabel) : '') + '</span>'
          + shareBar(pct) + '</span>'
          + '<span class="text-slate-400">' + icon(open ? 'chevron_up' : 'chevron_down', 'w-4 h-4') + '</span></button>';
        if (open) {
          html += '<div class="pl-12 pb-2 divide-y divide-slate-100 dark:divide-slate-800/70 text-sm">';
          c.merchants.slice().sort((a, b) => b[k] - a[k]).forEach(m => {
            html += '<div class="py-2 flex items-center gap-2"><div class="min-w-0 flex-1"><div class="truncate text-slate-700 dark:text-slate-200">' + esc(displayName(m.name)) + (m.count > 1 ? ' <span class="text-slate-500 dark:text-slate-400">×' + m.count + '</span>' : '') + '</div></div>'
              + '<span class="tabular-nums text-slate-700 dark:text-slate-200">' + fmtGBP(m[k]) + '</span>'
              + '<select data-key="' + esc(m.key) + '" data-change="setSpendCategory" aria-label="Category for ' + esc(m.name) + '" class="h-9 max-w-[7.5rem] rounded-full bg-transparent text-slate-600 dark:text-slate-300 border border-slate-300 dark:border-slate-700 text-xs px-2">' + opts(overrides[m.key]) + '</select></div>';
          });
          html += '</div>';
        }
        html += '</div>';
      });
      html += '</div>';
      // Month by month: the months this device has loaded, oldest on the left, this month highlighted.
      // Full amounts ("£1,234.56") fit four bars across on a folded phone, six in the wider box.
      const months = spendMonthTotals(overrides, k).slice(0, SPEND_WIDE_MQ.matches ? 6 : 4).reverse();
      if (months.length > 1) {
        const mtop = Math.max(1, ...months.map(m => m.total));
        html += '<div><div class="text-sm font-semibold text-slate-500 dark:text-slate-400 mb-2">Month by month</div><div class="flex items-end gap-2 h-28">';
        months.forEach(m => {
          const on = m.name === activeMonth;
          html += '<div class="flex-1 h-full flex flex-col items-center justify-end gap-1.5">'
            + '<span class="text-xs tabular-nums text-slate-500 dark:text-slate-400">' + fmtGBP(m.total) + '</span>'
            + '<div class="w-full max-w-[44px] rounded-md ' + (on ? 'bg-emerald-500' : 'bg-slate-200 dark:bg-slate-700') + '" style="height:' + Math.max(4, Math.round(Math.max(0, m.total) / mtop * 70)) + 'px"></div>'
            + '<span class="text-xs ' + (on ? 'font-semibold text-slate-900 dark:text-white' : 'text-slate-500 dark:text-slate-400') + '">' + esc(monthLabel(m.name, true)) + '</span></div>';
        });
        html += '</div></div>';
      }
      html += '<p class="text-xs text-slate-500 dark:text-slate-400">' + (mine ? 'Mine: Amex and Barclays spends less what others (or your savings) paid back to Nationwide for them.' : 'Total: Amex and Barclays, as charged.')
        + ' Tap a category to see where it went; change a shop\'s category with its menu and it is remembered on all your devices.</p>';
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
    // The Who's paying list opens over the Add or Edit sheet, so it comes first: Back closes it before them.
    const SHEETS = [['whoListModal', closeWhoList], ['spendModal', closeSpendModal], ['addModal', closeAddModal], ['editTxModal', closeEditTxModal],
      ['newMonthModal', closeNewMonthModal], ['passkeyModal', closePasskeyModal], ['signOutModal', closeSignOutModal],
      ['budgetModal', closeBudgetForm], ['payModal', closePayModal]];
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

    // Smooth scrolling, unless the phone or computer asks for less motion.
    const REDUCED_MOTION_MQ = window.matchMedia('(prefers-reduced-motion: reduce)');
    function scrollMotion() { return REDUCED_MOTION_MQ.matches ? 'auto' : 'smooth'; }
    function jumpToSection(target) {
      if (target === 'top') return window.scrollTo({ top: 0, behavior: scrollMotion() });
      if (!SECTIONS[target]) return;
      setSectionOpen(target, true);
      document.getElementById(SECTIONS[target].sec).scrollIntoView({ behavior: scrollMotion(), block: 'start' });
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
      if (b) openBudgetForm(b.row, b.name, b.amount, b.isRecurring, isPaidBill(b) ? b.originalBudget : 0);
    }
    // Paid: shown as 0, with the amount it goes back to on Restore remembered (originalBudget). A 0 with nothing
    // remembered is not paid: Restore then asks for an amount.
    function isPaidBill(b) {
      return Number(b.amount) === 0 && Number(b.originalBudget || 0) !== 0;
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
      checkMonthSummary();
      fillYear();
      pruneLocalMonths(s.availableMonths);
      const sel = document.getElementById('monthSelector');
      if (s.availableMonths && s.availableMonths.length) {
        // Newest first by name (the sheet's tabs can be in any order); names without a month and year go last, as listed.
        sel.innerHTML = s.availableMonths.slice().sort(newestFirst).map(m => `<option value="${esc(m)}" ${m === activeMonth ? 'selected' : ''}>${esc(m)}</option>`).join('');
      }
      if (SHEET_LINK.test(String(s.sheetUrl || ''))) {   // only ever a link to a Google Sheet
        document.getElementById('rawSheetBtn').href = s.sheetUrl;
        const menuLink = document.getElementById('rawSheetMenuBtn');
        if (menuLink) menuLink.href = s.sheetUrl;
      }
      renderAll();
    }

    // Saved copies of months that are no longer in the sheet are deleted from this device, and so are all but the newest
    // KEEP_MONTHS (enough for the Spending bars), so old figures don't sit on the phone for ever (security L4). The
    // month on screen is always kept.
    const KEEP_MONTHS = 6;
    function pruneLocalMonths(available) {
      if (!Array.isArray(available) || !available.length) return;
      const keep = new Set(available.slice().sort(newestFirst).slice(0, KEEP_MONTHS).concat(activeMonth));
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
        + (opts.actionLabel ? '<button id="toastAction" class="hit font-bold text-emerald-300 px-2.5 h-9 -my-1.5 -mr-2 rounded-lg inline-flex items-center gap-1">' + icon(opts.actionIcon || 'undo', 'w-3.5 h-3.5') + esc(opts.actionLabel) + '</button>' : '');
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

    // The rows' amounts added up, to the penny.
    const sumAmounts = list => +(list || []).reduce((a, r) => a + Number(r.amount || 0), 0).toFixed(2);
    // Every figure on the screen, worked out from the month's rows: each account's balance is the sum of its rows (as
    // the server adds them up), bills left is the sum of the bills not switched off in the what-if view (`skipped`:
    // their rows), and Money Left is the current account after those bills, plus the two cards (which are negative).
    // This is the page's one source for them (audit 3.3), worked out wherever they are shown: the `summary` the server
    // sends isn't used, so a change shown before the sheet has it counts at once, and taking it back off the screen
    // takes it out of the totals too.
    function sheetFigures(s, skipped) {
      const nCA = sumAmounts(s.checking), amex = sumAmounts(s.amex), barclays = sumAmounts(s.barclays);
      const budgetRem = sumAmounts((s.budgets || []).filter(b => !skipped.has(b.row)));
      const checkingExpected = +(nCA + budgetRem).toFixed(2);
      return { nCA, mSAV: sumAmounts(s.marcus), amex, barclays, budgetRem, checkingExpected, eomSavingsJ: +(checkingExpected + amex + barclays).toFixed(2) };
    }

    // Money Left spread over the days until payday, shown only on the newest month (older months are history).
    function renderDailyStrip(left) {
      const strip = document.getElementById('dailyStrip');
      const months = state.availableMonths || [];
      if (!months.length || activeMonth !== newestMonth(months) || !isFinite(Number(left))) { strip.classList.add('hidden'); return; }
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
      const s = sheetFigures(state, skippedBudgetRows);
      const money = n => state.loading ? '£—' : fmtGBP(n);
      document.getElementById('kpiAmex').textContent = money(s.amex);
      document.getElementById('kpiBarclays').textContent = money(s.barclays);
      // A card tile can be tapped to pay it off only while it owes something (never at £0 or in credit).
      document.querySelectorAll('.pay-tile').forEach(tile => {
        const card = tile.dataset.arg, owes = !state.loading && cardOwes(card) > 0;
        tile.disabled = !owes;
        tile.setAttribute('aria-label', accountCard(card).name + ' ' + money(s[card]) + (owes ? ', pay it off' : ''));
      });
      renderPaySheet();   // the Pay off sheet, if it is open
      document.getElementById('kpiNCA').textContent = money(s.nCA);
      document.getElementById('kpiMarcus').textContent = money(s.mSAV);
      document.getElementById('kpiSurplus').textContent = money(s.eomSavingsJ);
      renderDailyStrip(state.loading ? NaN : s.eomSavingsJ);
      document.getElementById('simBadge').classList.toggle('hidden', skippedBudgetRows.size === 0);
      renderWhatIfHint(s);

      renderBudgets();
      renderSplits();
      renderTransactions();
    }

    // ================= BUDGETS & EVENTS LOGIC =================
    // The Bills chips' looks: chosen, not chosen, and the What if chip while it is on (amber, like the What-If badge).
    const BILL_CHIP = 'hit shrink-0 whitespace-nowrap px-2.5 py-1 rounded-lg ';
    const BILL_CHIP_ON = BILL_CHIP + 'bg-slate-900 dark:bg-white text-white dark:text-slate-900';
    const BILL_CHIP_OFF = BILL_CHIP + 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400';
    const WHAT_IF_ON = BILL_CHIP + 'bg-amber-500/15 text-amber-700 dark:text-amber-300';
    function setBudFilter(f) {
      budFilter = f;
      markChoice('bf_', ['all', 'recurring', 'events'], f, BILL_CHIP_ON, BILL_CHIP_OFF);
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

    // "What if": a chip in the Bills filter row. While it is on, each unpaid bill has a switch that leaves it out of
    // Money Left and the Bills total (on screen only: nothing is saved). Turning the chip off counts every bill again.
    // The bills left out are rows of the month on screen (skippedBudgetRows): moving to another month starts afresh
    // (switchMonth), with the chip left as it was on purpose.
    let whatIfMode = false;
    function setWhatIfMode(on) {
      whatIfMode = !!on;
      if (!whatIfMode) skippedBudgetRows.clear();
      markChoice('bf_', ['whatif'], whatIfMode ? 'whatif' : null, WHAT_IF_ON, BILL_CHIP_OFF);
      renderAll();
    }
    // With What if on, the Bills box says what Money Left would be with the bills switched off (so the phone's Bills tab
    // shows the answer without going back to Home), and how to stop; before any is switched off, how it works.
    function renderWhatIfHint(s) {
      const box = document.getElementById('whatIfHint');
      box.classList.toggle('hidden', !whatIfMode);
      if (!whatIfMode) return;
      const off = skippedBudgetRows.size;
      if (!off || state.loading) {
        box.className = 'text-xs text-slate-500 dark:text-slate-400';
        box.textContent = 'Switch bills off to see Money Left without them.';
        return;
      }
      const diff = +(s.eomSavingsJ - sheetFigures(state, new Set()).eomSavingsJ).toFixed(2);
      box.className = 'rounded-xl px-3 py-2.5 flex items-center justify-between gap-3 bg-amber-500/15 border border-amber-500/40';
      const html = '<div class="min-w-0"><div class="text-xs font-semibold text-amber-700 dark:text-amber-300">Money Left with ' + off + (off === 1 ? ' bill' : ' bills') + ' off</div>'
        + '<div class="text-lg font-semibold tabular-nums text-slate-900 dark:text-white">' + fmtGBP(s.eomSavingsJ)
        + ' <span class="text-xs font-medium text-slate-500 dark:text-slate-400">(' + (diff >= 0 ? '+' : '−') + fmtGBP(Math.abs(diff)) + ')</span></div>'
        + '<div class="text-xs text-slate-500 dark:text-slate-400">Nothing is saved.</div></div>'
        + '<button data-action="toggleWhatIfMode" aria-label="Stop What if" class="hit shrink-0 h-8 px-3 rounded-full border border-slate-300 dark:border-slate-600 text-xs font-semibold text-slate-700 dark:text-slate-200">Stop</button>';
      // Only when it changed: a redraw on every refresh would re-announce it and take the Stop button from under a tap.
      if (box.innerHTML !== html) box.innerHTML = html;
    }
    function toggleWhatIf(row) {
      if (!whatIfMode) return;
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

      document.getElementById('budLeftVal').textContent = state.loading ? 'Loading…' : billsLeftText(sheetFigures(state, skippedBudgetRows).budgetRem);
      document.getElementById('budClearedCount').textContent = state.loading ? '' : `${cleared.length} of ${totalCount} paid`;
      document.getElementById('budProgressBar').style.width = `${pct}%`;
      document.getElementById('clearedBudCount').textContent = cleared.length;
      document.getElementById('paidFold').classList.toggle('hidden', cleared.length === 0);

      // Tap a bill's name to edit it (Delete lives inside the edit form, with Undo, so it can't be hit by accident).
      // On the left, the bill's kind (monthly or one-off); in What if mode, a switch that counts it in Money Left or not,
      // with that icon in its knob. Paid is the only button on the right.
      const kindIcon = (b, cls) => icon(b.isRecurring ? 'repeat' : 'sparkle', cls);
      const kindTone = b => b.isRecurring ? 'text-indigo-400' : 'text-amber-400';
      const lead = (b, isSkipped) => !whatIfMode || b.pending
        ? `<span class="w-10 h-10 -ml-2 shrink-0 inline-flex items-center justify-center ${kindTone(b)}" aria-hidden="true">${kindIcon(b, 'w-4 h-4')}</span>`
        : `<button data-action="toggleWhatIf" data-row="${b.row}" role="switch" aria-checked="${!isSkipped}" aria-label="Count ${esc(b.name)} in Money Left"
                   class="hit w-9 h-10 -ml-1 shrink-0 inline-flex items-center justify-end">
             <span class="w-8 h-5 rounded-full p-0.5 flex items-center transition-colors ${isSkipped ? 'bg-slate-300 dark:bg-slate-700' : 'bg-emerald-500 justify-end'}">
               <span class="w-4 h-4 rounded-full bg-white inline-flex items-center justify-center ${isSkipped ? 'text-slate-400' : kindTone(b)}">${kindIcon(b, 'w-2.5 h-2.5')}</span>
             </span>
           </button>`;
      const nameBtn = (b, cls) => b.pending
        ? `<span class="min-w-0 truncate ${cls}">${esc(b.name)}</span>`
        : `<button data-action="openBudgetFormForRow" data-row="${b.row}" aria-label="Edit ${esc(b.name)}" class="min-w-0 flex-1 truncate text-left py-2 ${cls}">${esc(b.name)}</button>`;
      const pill = 'h-9 px-3 rounded-full border text-xs font-semibold whitespace-nowrap inline-flex items-center gap-1';
      const billsTab = onPhoneTab('budgets');   // the phone's Bills tab lists every unpaid bill; Home the first few
      const shown = showAll.bills || billsTab ? upcoming : upcoming.slice(0, BILLS_PREVIEW);
      document.getElementById('upcomingBudgetsList').innerHTML = upcoming.length ? shown.map(b => {
        const isSkipped = skippedBudgetRows.has(b.row);
        return `
          <div class="py-1 flex items-center justify-between gap-2 text-sm">
            <div class="flex items-center gap-1 min-w-0 flex-1">
              ${lead(b, isSkipped)}
              ${nameBtn(b, 'font-medium ' + (isSkipped ? 'text-slate-400 dark:text-slate-500' : 'text-slate-800 dark:text-slate-100'))}
            </div>
            <div class="flex items-center gap-2 shrink-0">
              <span class="tabular-nums font-semibold whitespace-nowrap ${isSkipped ? 'line-through text-slate-400 dark:text-slate-500' : moneyTone(b.amount)}">${fmtSigned(b.amount)}</span>
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
    // A paid bill being edited (shown as 0, with its amount remembered): it is saved as still paid, so renaming it or
    // changing its monthly setting doesn't un-pay it. Restore is what un-pays a bill.
    let budFormPaid = false;
    // The bill form is the sheet #budgetModal: "Add bill" or "Edit <name>" with Delete. The cursor goes to Amount when
    // it is empty (Add, or Restore of a paid bill whose amount wasn't remembered), like Add spend. A paid bill
    // (isPaidBill) is opened with `restoreAmount`, the amount it would go back to, which the form shows.
    function openBudgetForm(row = '', name = '', amount = '', isRecurring = false, restoreAmount = 0) {
      ['inpBudAmt', 'inpBudName'].forEach(clearFieldError);   // filled in code below, which clears no old message by itself
      budFormExpect = row ? { name, amount: Number(amount) } : null;
      budFormPaid = !!row && Number(restoreAmount) !== 0;
      document.getElementById('editBudRow').value = row;
      document.getElementById('inpBudName').value = name;
      const numAmt = budFormPaid ? Number(restoreAmount) : Number(amount || 0);
      document.getElementById('inpBudAmt').value = numAmt !== 0 ? Math.abs(numAmt) : '';
      setBudFormType(row ? isRecurring : false);
      setBudFormSign(numAmt > 0 ? 1 : -1);
      document.getElementById('budFormTitle').textContent = row ? 'Edit ' + displayName(name) : 'Add bill';
      document.getElementById('budPaidTag').classList.toggle('hidden', !budFormPaid);
      document.getElementById('budSaveBtn').textContent = row ? 'Save changes' : 'Save bill';
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
      budFormPaid = false;
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
      const paid = !!row && budFormPaid;
      closeBudgetForm();
      mutate('the bill', () => {
        if (!row) return takeOut(state.budgets, addBudgetOptimistic(name, signedAmt, isRecurring));
        const existing = findBudget(Number(row), expect);
        if (!existing) return;
        const undo = keepFields(existing, ['name', 'amount', 'originalBudget', 'isRecurring']);
        Object.assign(existing, { name, amount: paid ? 0 : signedAmt, originalBudget: signedAmt, isRecurring });
        return undo;
      }, () => apiCall('saveBudgetItem', {
        sheetName: activeMonth,
        row: row || null,
        name,
        amount: signedAmt,
        isRecurring,
        expect,
        paid
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
      const paid = isPaidBill(item);
      const amount = paid ? item.originalBudget : item.amount;
      return mutate('the restored bill', () => {
        if (month === activeMonth) return takeOut(state.budgets, addBudgetOptimistic(item.name, amount, item.isRecurring, paid));
      }, () => apiCall('saveBudgetItem', { sheetName: month, row: null, name: item.name, amount, isRecurring: item.isRecurring, paid }),
      applyStateIfViewing(month));
    }

    // Paid sets a bill to 0 and remembers its amount (originalBudget); Restore puts that amount back. A paid bill
    // with no remembered amount opens its form instead, to ask for one rather than guess.
    function markBudgetPaid(row) {
      skippedBudgetRows.delete(row);   // a paid bill has nothing left to leave out (and comes back counted if restored)
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
      markChoice('pill_', ['pending', 'settled'], mode, SEG_ON, SEG_OFF);
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
      SETTLED_PREFIX = new RegExp('^(' + names.concat('savings').map(escRe).join('|') + ')\\b', 'i');
      setSpendWords(cfg.spendWords);
      const mine = (Array.isArray(cfg.mySavings) ? cfg.mySavings : []).map(spendKey).filter(Boolean);
      MY_SAVINGS = mine.length ? new RegExp('^(' + mine.map(escRe).join('|') + ')(?=$| )') : null;
      if (remember) lsSet(CONFIG_KEY, configShown);
      renderPersonChips();
      renderQuickSplit();
    }
    function loadSavedConfig() {
      applyConfig(lsJson(CONFIG_KEY), false);
    }
    // "Half with ..." and "All ...'s" in the Who's paying list are named after QUICK_SPLIT, and only offered with one.
    function renderQuickSplit() {
      if (!QUICK_SPLIT && (formSplit === 'half' || formSplit === 'all')) selectSplit('100_me');
      else updateSplitSummary();
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
    // A name typed for a share, as the sheet stores it: lower case, one word. Owed reads the first word of
    // "<person> <what>" as the person, so "Mary Jane" is kept as "mary-jane", not taken for Mary owing "Jane Tesco".
    function splitPersonKey(name) {
      return String(name || '').trim().toLowerCase().replace(/\s+/g, '-');
    }
    // A name a share can go under: one word, and not one the sheet uses for itself (the "savings" row of a Marcus share).
    const validSplitName = key => /^\S+$/.test(key) && key !== 'savings' && key !== 'marcus';
    function owedPerson(desc) {
      const parts = String(desc || '').trim().split(/\s+/);
      return { key: (parts[0] || '').toLowerCase(), name: displayName(parts[0] || '').replace(/-([a-z])/g, (m, c) => '-' + c.toUpperCase()), what: displayName(parts.slice(1).join(' ')) || displayName(desc) };
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
      // Owed to you and what you owe (an "I owe", or a share of money in to pass on) are shown apart, not netted.
      const owedToYou = pending.reduce((a, b) => a + Math.max(0, b.amount), 0), youOwe = -pending.reduce((a, b) => a + Math.min(0, b.amount), 0);
      document.getElementById('sumPending').innerHTML = !(youOwe >= 0.005) ? esc(fmtGBP(owedToYou))
        : (owedToYou >= 0.005 ? `<span class="block">${esc(fmtGBP(owedToYou))} owed to you</span>` : '')
          + `<span class="block text-rose-600 dark:text-rose-400">You owe ${esc(fmtGBP(youOwe))}</span>`;

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
              <span class="block text-xs text-slate-600 dark:text-slate-300">${g.total <= -0.005 ? 'You owe ' + esc(g.name) : count(g)}</span></span>
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
                <span class="block text-xs text-slate-600 dark:text-slate-300 tabular-nums">${count(g)} · ${g.total <= -0.005
                  ? `<span class="text-rose-600 dark:text-rose-400">you owe ${esc(g.name)} ${fmtGBP(-g.total)}</span>` : fmtSigned(g.total)}</span></span>
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

    // Undo of "All paid back" (offerUndo waits for it to be in the sheet): one save ticks every row as owed again,
    // after the server has checked each still holds what it did; if any changed meanwhile, none is ticked, the screen
    // goes back and the sheet is fetched to show what it holds.
    // Shown at once like any save. If you've since left that month, only the sheet is updated.
    function undoSettle(rows, expects, month) {
      return mutate('the Undo', () => {
        if (month !== activeMonth) return;
        const items = rows.map((row, i) => state.checking.find(r => r.row === row && !r.pending && holds(r, expects[i]))).filter(Boolean);
        const undos = items.map(r => keepFields(r, ['need']));
        items.forEach(r => { r.need = true; });
        return () => undos.forEach(u => u());
      }, () => apiCall('settleAllNeeds', { sheetName: month, rows, expect: expects, setNeed: true }),
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

    function renderActSpend() {
      const box = document.getElementById('actSpend');
      if (!box) return;
      const k = spendField();
      const prevName = previousMonthName();
      const sum = summariseSpend(state, loadSpendOverrides(), prevName ? previousMonthState(prevName) : null);
      const cats = sum.categories.filter(c => c[k] > 0.005).sort((a, b) => b[k] - a[k]);
      if (actCat && !cats.some(c => c.cat === actCat)) actCat = null;
      const sel = actCat && cats.find(c => c.cat === actCat);
      const what = k === 'share' ? (sel ? esc(sel.cat) + ', your share' : 'Your spending this month') : (sel ? esc(sel.cat) + ' on cards' : 'Spent on cards this month');
      box.innerHTML = `
        <div class="flex items-center gap-3.5 pb-3">
          <div class="min-w-0 flex-1">
            <div class="text-sm text-slate-500 dark:text-slate-400">${what}</div>
            <div class="text-2xl font-semibold tracking-tight tabular-nums text-slate-900 dark:text-white">${fmtGBP(sel ? sel[k] : sum[k])}</div>
          </div>
          <button data-action="openSpendModal" class="h-8 px-3 rounded-full border text-xs font-semibold border-slate-300 text-slate-700 dark:border-slate-700 dark:text-slate-200">Details</button>
        </div>
        ${cats.length ? `<div class="chip-row flex gap-2 overflow-x-auto">${cats.map(c => {
          const on = actCat === c.cat;
          return `<button data-cat="${esc(c.cat)}" data-action="setActCat" aria-pressed="${on}"
                    class="hit shrink-0 h-9 px-3 rounded-full border text-sm font-semibold inline-flex items-center gap-1.5 ${on ? 'border-emerald-500 bg-emerald-500/10 text-slate-900 dark:text-white' : 'border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200'}">
                    ${esc(c.cat)}<span class="tabular-nums font-medium text-slate-500 dark:text-slate-400">${fmtGBP(c[k])}</span></button>`;
        }).join('')}</div>` : '<p class="text-sm text-slate-500 dark:text-slate-400">' + (k === 'share' && sum.charged > 0.005 ? 'All of this month\'s card spending was paid back.' : 'No card spending recorded in this month yet.') + '</p>'}`;
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
        <${r.pending ? 'div' : 'button'} ${r.pending ? '' : `type="button" data-action="openEditTxForRow" data-acct="${esc(r.acct)}" data-row="${r.row}" aria-label="Edit ${esc(displayName(r.desc))}, ${fmtSigned(r.amount)}, ${accountCard(r.acct).name}"`}
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

    // A form sheet's main button stays in sight on its strip (.sheet-foot in index.html). The line above the strip shows
    // only while part of the form is under it: a marker just after the strip is out of view exactly then. (The observer
    // speaks only when that changes, so a closed sheet keeps the line on: a tall one has it as soon as it opens.)
    (function lineAboveSheetButtons() {
      if (!('IntersectionObserver' in window)) return;
      document.querySelectorAll('.sheet-foot').forEach(foot => {
        const end = document.createElement('div');
        end.style.cssText = 'margin:0;height:0';   // not spaced like the sheet's other rows
        foot.after(end);
        // (2px to spare: scrolled to the end, the marker sits right on the sheet's bottom edge.)
        new IntersectionObserver(([e]) => foot.classList.toggle('stuck', !e.isIntersecting),
          { root: foot.parentElement, rootMargin: '0px 0px 2px 0px' }).observe(end);
      });
    })();

    // ================= ADD TRANSACTION & DYNAMIC GROUP SPLIT =================
    function openAddModal() {
      placeWho('add');
      setTxDirection('spend');
      const lastAcct = lsGet(LAST_ACCT_KEY);
      selectAcct(ACCTS.includes(lastAcct) ? lastAcct : 'amex');   // the card the last spend went on
      customSplitEntries = [];
      autoEqualActive = false;
      iOwe = { person: '', share: 'half', amount: 0 };
      selectSplit('100_me');
      renderDynamicSplitRows();
      ['inpAmount', 'inpMerchant'].forEach(clearFieldError);
      document.getElementById('addModal').classList.remove('hidden');
      document.getElementById('inpAmount').focus();   // the number pad comes straight up
    }
    function closeAddModal() {
      closeWhoList();
      document.getElementById('addModal').classList.add('hidden');
    }

    function setTxDirection(dir) {
      txDirection = dir;
      markToggle('dir_', ['spend', 'refund'], dir, 'refund');
      // "Someone paid for me" is for money out only: money in from a friend is just money in.
      if (dir === 'refund' && formSplit === 'iowe') selectSplit('100_me');
      else updateSplitSummary();
    }

    function selectAcct(a) {
      formAcct = a;
      markChoice('acct_', ACCTS, a, CARD_ON, CARD_OFF);
    }

    // ---- Who's paying: one row in the Add (or Edit) sheet; a tap opens the list of choices ----
    // formSplit: '100_me' (just me / all mine), 'half' / 'all' (with QUICK_SPLIT), 'custom' (the group box), 'marcus'
    // (savings pays / it goes to savings), 'iowe' (someone paid for me: Add only, money out only).
    let whoSheet = 'add';   // the sheet the block is in: 'add' or 'edit'
    let iOwe = { person: '', share: 'half', amount: 0 };   // "Someone paid for me": who, and your share ('half', 'all' or 'other' = amount)
    let editShares = null;  // the edited spend's shares (sharesOf), or null when the Edit sheet shows no Who's paying
    // Moves the Who's paying block into the sheet that opens (both use the same row, list and group box).
    function placeWho(where) {
      whoSheet = where;
      const block = document.getElementById('whoBlock');
      if (where === 'edit') document.getElementById('editWhoSlot').appendChild(block);
      else document.getElementById('addAcctBlock').after(block);
    }
    // The open sheet's amount box and direction.
    const splitAmountId = () => whoSheet === 'edit' ? 'editTxAmt' : 'inpAmount';
    const splitIsRefund = () => whoSheet === 'edit' ? editTxSign > 0 : txDirection === 'refund';

    function selectSplit(s) {
      if ((s === 'half' || s === 'all') && !QUICK_SPLIT) s = '100_me';
      if (s === 'iowe' && (whoSheet !== 'add' || txDirection === 'refund')) s = '100_me';
      formSplit = s;
      document.getElementById('customSplitBox').classList.toggle('hidden', s !== 'custom');
      // A group split shares the amount equally from the start, and again as people are added or taken off, until
      // you type someone's share yourself (÷ Split Equally goes back to equal shares).
      if (s === 'custom' && customSplitEntries.length === 0) {
        autoEqualActive = true;
        if (QUICK_SPLIT) togglePersonChip(QUICK_SPLIT);
      }
      updateSplitSummary();
    }

    // The amount with a choice's own figures (`gross`: the amount in the open sheet).
    const halfOf = gross => +(gross / 2).toFixed(2);
    const nameOf = key => displayName(key).replace(/-([a-z])/g, (m, c) => '-' + c.toUpperCase());
    // Who a group split's shares go to ("Kim", "Kim, Lee"); empty while nobody has a share.
    const whoNames = (splits, marcusShare) => splits.map(sp => nameOf(sp.person)).concat(marcusShare > 0 ? ['Marcus'] : []).join(', ');
    // What a choice is called: `main` on the row and in the list, `sub` the row's short line, `more` the list's line.
    function whoWords(kind, isRefund, gross) {
      const q = nameOf(QUICK_SPLIT), half = fmtGBP(halfOf(gross)), all = fmtGBP(gross);
      if (kind === 'iowe') {
        const p = iOwe.person ? nameOf(iOwe.person) : 'Someone';
        return { main: iOwe.person ? p + ' paid' : 'Someone paid for me', sub: 'you owe ' + p + ' ' + fmtGBP(iOweShareOf(gross)), more: 'nothing goes on your cards' };
      }
      if (kind === 'custom') {
        const { splits, marcusShare } = buildSplitData();
        // One person is named; more are in the group box just below, so the row stays short enough for 344px.
        const total = fmtGBP(splits.reduce((a, b) => a + b.amount, 0) + marcusShare), names = whoNames(splits, marcusShare);
        const one = splits.length + (marcusShare > 0 ? 1 : 0) === 1;
        const sub = !names ? 'pick people below' : isRefund ? 'pay ' + (one ? names + ' ' : '') + total : one ? names + ' owes ' + total : total + ' owed';
        return { main: 'Split with others', sub, more: 'pick people and shares' };
      }
      const words = isRefund ? {
        '100_me': ['All mine', 'nothing to pass on', 'nothing to pass on'],
        half: ['Half to ' + q, 'you pay ' + q + ' ' + half, 'you pay ' + q + ' ' + half],
        all: ['All ' + q + "'s", 'you pay ' + q + ' ' + all, 'you pay ' + q + ' ' + all],
        marcus: ['To Marcus', 'goes to savings', 'it goes to your savings']
      } : {
        '100_me': ['Just me', 'nobody owes you', 'nobody owes you'],
        half: ['Half with ' + q, q + ' owes ' + half, q + ' owes you ' + half],
        all: ['All ' + q + "'s", q + ' owes ' + all, q + ' owes you ' + all],
        marcus: ['From Marcus', 'savings pays it', 'your savings pays it']
      };
      const [main, sub, more] = words[kind] || words['100_me'];
      return { main, sub, more };
    }
    // The choices the list offers in the open sheet.
    function whoChoices(isRefund) {
      return ['100_me'].concat(QUICK_SPLIT ? ['half', 'all'] : [], ['custom', 'marcus'],
        !isRefund && whoSheet === 'add' ? ['iowe'] : []);
    }

    // Redraws the row, and with it everything in the sheet that depends on the choice: the group box, the "Add to Owed"
    // tick, and for "Someone paid for me" the Add sheet's own look (no card, "Whole bill", "Save: I owe ...").
    function updateSplitSummary() {
      clearFieldError('dynamicSplitRows');
      const isRefund = splitIsRefund(), gross = amountIn(splitAmountId()) || 0;
      const locked = whoSheet === 'edit' && editShares && (editShares.locked || editShares.unknown);
      const w = whoWords(formSplit, isRefund, gross);
      document.getElementById('lblWho').textContent = isRefund ? 'Whose money is it?' : "Who's Paying?";
      document.getElementById('customSplitBox').classList.toggle('hidden', formSplit !== 'custom' || !!locked);
      const row = document.getElementById('whoRow');
      row.disabled = !!locked;
      row.setAttribute('aria-label', (isRefund ? 'Whose money is it: ' : "Who's paying: ") + w.main + ', ' + w.sub + (locked ? '' : '. Change'));
      document.getElementById('whoMain').textContent = locked && editShares.unknown ? 'Not sure' : w.main;
      document.getElementById('whoSub').textContent = locked ? (editShares.unknown ? "its shares can't be matched" : 'paid back') : w.sub;
      document.getElementById('whoRight').innerHTML = locked
        ? `<span class="inline-flex items-center gap-1 font-medium text-slate-500 dark:text-slate-400">${icon('lock', 'w-3.5 h-3.5')}Locked</span>`
        : `<span class="inline-flex items-center text-emerald-600 dark:text-emerald-400">Change${icon('chevron_right', 'w-4 h-4')}</span>`;
      document.getElementById('needToggleWrap').classList.toggle('hidden', whoSheet !== 'add' || formSplit === '100_me' || formSplit === 'iowe');
      renderWhoNote(isRefund);
      if (whoSheet === 'add') renderIOweLook(gross);
    }
    function onGrossAmountInput() {
      if (formSplit === 'custom' && autoEqualActive && customSplitEntries.length > 0) {
        applyEqualGroupSplit();
      } else {
        updateSplitSummary();
      }
    }

    // ---- The list (a sheet over the Add or Edit sheet) ----
    function openWhoList() {
      if (document.getElementById('whoRow').disabled) return;
      showWhoStep(false);
      document.getElementById('whoListModal').classList.remove('hidden');
      const on = document.querySelector('#whoListRows [aria-checked="true"]');
      if (on) on.focus();
    }
    function closeWhoList() {
      if (document.getElementById('whoListModal').classList.contains('hidden')) return;
      document.getElementById('whoListModal').classList.add('hidden');
      document.getElementById('whoRow').focus();
    }
    // The list, or (`iowe`) the "Someone paid for me" step in its place.
    function showWhoStep(iowe) {
      const isRefund = splitIsRefund(), gross = amountIn(splitAmountId()) || 0;
      document.getElementById('whoListBack').classList.toggle('hidden', !iowe);
      document.getElementById('whoListRows').classList.toggle('hidden', iowe);
      document.getElementById('iOweStep').classList.toggle('hidden', !iowe);
      document.getElementById('whoListTitle').textContent = iowe ? 'Someone paid for me' : isRefund ? 'Whose money is it?' : "Who's paying?";
      if (iowe) return renderIOweStep();
      document.getElementById('whoListRows').innerHTML = whoChoices(isRefund).map(k => {
        const on = k === formSplit, w = whoWords(k, isRefund, gross);
        return `<button type="button" role="radio" aria-checked="${on}" data-action="pickWho" data-arg="${k}" class="w-full min-h-[52px] flex items-center gap-3 px-3 py-1.5 text-left">
            <span class="w-5 h-5 shrink-0 rounded-full inline-flex items-center justify-center border-2 ${on ? 'border-emerald-500' : 'border-slate-400/60'}">${on ? '<span class="w-2.5 h-2.5 rounded-full bg-emerald-500"></span>' : ''}</span>
            <span class="min-w-0"><span class="block text-sm font-semibold text-slate-900 dark:text-white">${esc(k === 'iowe' ? 'Someone paid for me' : w.main)}</span>
              <span class="block text-xs text-slate-500 dark:text-slate-400">${esc(w.more)}</span></span>
          </button>`;
      }).join('');
    }
    function pickWho(kind) {
      if (kind === 'iowe') return openIOweStep();
      selectSplit(kind);
      closeWhoList();
    }

    // ---- Someone paid for me ----
    // Your share of the whole bill (the Amount box): half, all of it, or an amount typed in the step.
    const iOweShareOf = gross => iOwe.share === 'all' ? +gross.toFixed(2) : iOwe.share === 'other' ? iOwe.amount : halfOf(gross);
    // The step works on a copy (iOweDraft), which becomes the choice only on Done: closing the list or going back to it
    // leaves the choice made before as it was.
    let iOweDraft = null;
    function openIOweStep() {
      iOweDraft = { ...iOwe };
      const typed = !!iOwe.person && !PEOPLE.includes(iOwe.person);
      const name = document.getElementById('iOweName'), amt = document.getElementById('iOweAmt');
      name.value = typed ? iOwe.person : '';
      name.classList.toggle('hidden', !typed);
      amt.value = iOwe.share === 'other' && iOwe.amount ? iOwe.amount.toFixed(2) : '';
      ['iOweName', 'iOweAmt'].forEach(clearFieldError);
      showWhoStep(true);
    }
    function renderIOweStep() {
      const gross = amountIn('inpAmount') || 0, d = iOweDraft;
      const chip = (on, attrs, label) => `<button type="button" ${attrs} aria-pressed="${on}" class="${on ? CHIP_ON : chipOff('')} hit hit-32">${label}</button>`;
      const otherOpen = !document.getElementById('iOweName').classList.contains('hidden');
      document.getElementById('iOweWho').innerHTML = PEOPLE.map(p => chip(!otherOpen && p === d.person, `data-action="pickIOwePerson" data-person="${esc(p)}"`, esc(nameOf(p))))
        .concat(chip(otherOpen, 'data-action="pickIOwePerson" data-person=""', '＋ Other')).join('');
      document.getElementById('lblIOweShare').textContent = gross > 0 ? 'Your share of ' + fmtGBP(gross) : 'Your share';
      document.getElementById('iOweShare').innerHTML = [['half', 'Half ' + fmtGBP(halfOf(gross))], ['all', 'All ' + fmtGBP(gross)], ['other', 'Other amount']]
        .map(([k, label]) => chip(d.share === k, `data-action="pickIOweShare" data-arg="${k}"`, label)).join('');
      document.getElementById('iOweAmt').classList.toggle('hidden', d.share !== 'other');
    }
    // A name chip, or "＋ Other" (key ''), which opens a box for a name typed in (read on Done).
    function pickIOwePerson(key) {
      clearFieldError('iOweName');
      const box = document.getElementById('iOweName');
      box.classList.toggle('hidden', !!key);
      iOweDraft.person = key;
      renderIOweStep();
      if (!key) box.focus();
    }
    function pickIOweShare(k) {
      clearFieldError('iOweAmt');
      iOweDraft.share = k;
      renderIOweStep();
      if (k === 'other') document.getElementById('iOweAmt').focus();
    }
    function doneIOwe() {
      const d = { ...iOweDraft }, name = document.getElementById('iOweName');
      if (!name.classList.contains('hidden')) d.person = splitPersonKey(name.value);
      if (!d.person) return showFieldError('iOweName', name.classList.contains('hidden') ? 'Pick who paid' : 'Add their name');
      if (!validSplitName(d.person)) return showFieldError('iOweName', 'Pick a person');
      if (d.share === 'other') {
        const amt = checkedAmount('iOweAmt', true);
        if (amt === null) return;
        d.amount = +amt.toFixed(2);
      }
      iOwe = d;
      selectSplit('iowe');
      closeWhoList();
    }
    // The Add sheet while "Someone paid for me" is picked: nothing goes on a card, so the card choice goes; the amount
    // is the whole bill; the button says what will be saved.
    function renderIOweLook(gross) {
      const on = formSplit === 'iowe';
      document.getElementById('addAcctBlock').classList.toggle('hidden', on);
      document.querySelector('label[for="inpAmount"]').textContent = on ? 'Whole bill (£)' : 'Amount (£)';
      document.getElementById('btnSubmitTx').textContent = on ? 'Save: I owe ' + nameOf(iOwe.person) + ' ' + fmtGBP(iOweShareOf(gross))
        : txDirection === 'refund' ? 'Save money in' : 'Save spend';
    }

    function togglePersonChip(personKey) {
      const idx = customSplitEntries.findIndex(e => splitPersonKey(e.person) === splitPersonKey(personKey));
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
      const isMarcus = e => splitPersonKey(e.person) === 'marcus';
      const people = customSplitEntries.filter(e => !isMarcus(e));
      const marcus = customSplitEntries.filter(isMarcus).reduce((a, e) => a + (e.amount || 0), 0);
      const pence = Math.max(0, Math.round(((amountIn(splitAmountId()) || 0) - marcus) * 100));
      const incMe = document.getElementById('chkEqualIncludeMe').checked;
      equalShares(pence, people.length, incMe).forEach((p, i) => { people[i].amount = p / 100; });
      renderDynamicSplitRows();
      updateSplitSummary();
    }

    function renderDynamicSplitRows() {
      PEOPLE.concat('marcus').forEach(p => {
        const btn = document.getElementById('chip_' + p);
        if (!btn) return;
        btn.className = customSplitEntries.some(e => splitPersonKey(e.person) === p) ? CHIP_ON : chipOff(p);
      });

      const container = document.getElementById('dynamicSplitRows');
      customSplitEntries.forEach(e => { e.bad = false; });   // the boxes are redrawn from the amounts, so no bad text is left
      if (customSplitEntries.length === 0) {
        container.innerHTML = '<div class="text-xs text-slate-500 dark:text-slate-400 py-1">Tap any name above to split this spend...</div>';
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
          <button type="button" data-action="removePersonRow" data-idx="${idx}" aria-label="Take ${esc(displayName(entry.person) || 'this person')} off the split" class="hit hit-32 text-slate-500 dark:text-slate-400 hover:text-rose-500 px-1.5 font-bold">✕</button>
        </div>
      `).join('');
    }

    // The shares the open sheet would save (positive amounts; the sign comes from the direction, as on the server).
    // Shares saved from the Edit sheet always go in Owed; on Add, the "Add to Owed" tick says.
    function buildSplitData() {
      const gross = amountIn(splitAmountId()) || 0;
      const isRefund = splitIsRefund();
      const need = formSplit !== '100_me' && (whoSheet === 'edit' || document.getElementById('chkNeed').checked);
      const splits = [];
      let marcusShare = 0;

      if (formSplit === 'half' && QUICK_SPLIT) {
        splits.push({ person: QUICK_SPLIT, amount: halfOf(gross), need });
      } else if (formSplit === 'all' && QUICK_SPLIT) {
        splits.push({ person: QUICK_SPLIT, amount: gross, need });
      } else if (formSplit === 'marcus') {
        marcusShare = gross;
      } else if (formSplit === 'custom') {
        customSplitEntries.forEach(e => {
          const p = splitPersonKey(e.person);
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
      if (customSplitEntries.some(e => splitPersonKey(e.person) === 'savings')) return '"Savings" is kept for Marcus: use another name';
      const { gross, splits, marcusShare } = buildSplitData();
      const others = splits.reduce((a, b) => a + b.amount, 0) + marcusShare;
      if (others - gross > 0.005) return 'The shares come to ' + fmtGBP(others) + ', more than ' + fmtGBP(gross);
      return '';
    }
    // Shows splitProblem's words under the group box; true if there was one.
    function showSplitProblem() {
      const problem = splitProblem();
      if (!problem) return false;
      showFieldError('dynamicSplitRows', problem);   // the rows can't take the cursor, so their first box does
      const box = document.querySelector('#dynamicSplitRows .split-amt');
      if (box) box.focus();
      return true;
    }

    // The share rows a spend saves, shown at once as "saving..." (made-up rows from `firstRow` up until the server says
    // where each went), the way the server writes them (see addTransactionBundle).
    function addPendingShares(merchant, { isRefund, need, splits, marcusShare }, firstRow, ts) {
      const splitSign = isRefund ? -1 : 1, added = [];
      if (marcusShare > 0) {
        added.push(addPendingTx('marcus', firstRow, merchant, -splitSign * marcusShare, false, ts));
        added.push(addPendingTx('checking', firstRow + 1, 'savings ' + merchant, splitSign * marcusShare, need, ts));
      }
      splits.forEach((s, i) => added.push(addPendingTx('checking', firstRow + 2 + i, `${s.person} ${merchant}`, +(splitSign * Math.abs(s.amount)).toFixed(2), s.need, ts)));
      return added;
    }

    function submitExpense() {
      const merchant = document.getElementById('inpMerchant').value.trim();
      if (checkedAmount('inpAmount', true) === null) return;
      if (!merchant) return showFieldError('inpMerchant', 'Add where it was');
      if (showSplitProblem()) return;
      if (formSplit === 'iowe') return submitIOwe(merchant);
      const data = buildSplitData();
      const { gross, isRefund, need, splits, marcusShare } = data;
      lsSet(LAST_ACCT_KEY, formAcct);

      const now = Date.now();
      // Made-up row numbers (99 and up) until the server says where each entry went.
      addPendingTx(formAcct, 99, merchant, isRefund ? gross : -gross, false, now);
      addPendingShares(merchant, data, 100, now);

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
    // Someone paid and you owe them your share: one Nationwide row "<person> <what>" with minus your share, in Owed
    // (the row a split refund writes for "Pay Kim"), and nothing on a card. Sent as its own action (addIOwe), queued
    // offline and never saved twice like a spend.
    function submitIOwe(merchant) {
      const gross = amountIn('inpAmount'), share = iOweShareOf(gross);
      if (!(share > 0)) return showFieldError('inpAmount', 'Add the amount');
      if (share - gross > 0.005) return showFieldError('inpAmount', 'Your share (' + fmtGBP(share) + ') is more than the whole bill');
      const person = splitPersonKey(iOwe.person);
      if (!validSplitName(person)) { openWhoList(); return openIOweStep(); }   // (Done checks it, so only if that was skipped)
      addPendingTx('checking', 99, person + ' ' + merchant, -share, true, Date.now());
      closeAddModal();
      document.getElementById('inpMerchant').value = '';
      document.getElementById('inpAmount').value = '';
      savePhoneCache(activeMonth, state);
      renderAll();
      sendNewSpend({ sheetName: activeMonth, merchant, person, grossAmount: share, iOwe: true, clientId: newClientId() });
    }

    // ================= PAY OFF A CARD =================
    // A tap on the Amex or Barclays tile: money in on the card and the same amount out of the account it was paid from,
    // sent through sendNewSpend as a card payment (addCardPayment, with payFrom), so it is queued offline and never saved
    // twice like a spend. Both rows are named "<Card> CC Payment": the word "payment" keeps them out of Spending
    // (SPEND_SKIP). Once saved they are two ordinary rows, edited or deleted one at a time. PAY_FROM is the one list of
    // cards that can be paid off and where from; the first account in each is the usual one, picked when the sheet opens.
    const PAY_FROM = { barclays: ['checking', 'marcus'], amex: ['barclays', 'checking'] };
    let payCard = null, payFrom = null, payWhole = true;   // payCard: the card whose sheet is open (null when closed)

    const balanceOf = acct => sumAmounts(state[acct]);   // the same adder as sheetFigures, so to the penny
    // What the card owes (0 if nothing, or if it is in credit): what "Whole" pays, and the most a payment may be.
    const cardOwes = card => Math.max(0, -balanceOf(card));
    // The amount the sheet would pay now, to the penny: the whole balance, or what is typed (NaN if not an amount).
    const payAmountNow = () => payWhole ? cardOwes(payCard) : +amountIn('payAmount').toFixed(2);
    const payWaiting = card => loadOutbox().find(x => x.payload && x.payload.payFrom && x.payload.account === card);

    function openPayCard(card) {
      if (!PAY_FROM[card] || state.loading || !(cardOwes(card) > 0)) return;
      // A payment still in this device's queue isn't on screen after a sync, so the card would look unpaid: no second one
      // until it has gone, or you have removed it (one set aside waits for a tap on ↻).
      const waiting = payWaiting(card);
      if (waiting) return showToast('A ' + accountCard(card).name + (waiting.setAside
        ? " payment couldn't be sent and is set aside: tap ↻ to send it again, or Remove it." : " payment is still waiting to send, so it isn't offered again yet."), { kind: 'info' });
      payCard = card;
      payFrom = PAY_FROM[card][0];
      payWhole = true;
      document.getElementById('payAmount').value = '';
      clearFieldError('payAmount');
      document.getElementById('payLogo').innerHTML = getBankLogo(card);
      document.getElementById('payTitle').textContent = 'Pay off ' + accountCard(card).name;
      // The rows are drawn once here; renderPaySheet only updates them, so a sync never moves the focus off one.
      document.getElementById('payFromList').innerHTML = PAY_FROM[card].map(a => `<button type="button" role="radio" data-action="selectPayFrom" data-arg="${a}">
          ${getBankLogo(a)}<span class="text-sm font-semibold text-slate-900 dark:text-white">${accountCard(a).name}</span>
          <span class="pay-bal ml-auto text-xs tabular-nums text-slate-500 dark:text-slate-400"></span><span class="pay-tick"></span>
        </button>`).join('');
      renderPaySheet();
      document.getElementById('payModal').classList.remove('hidden');
    }
    function closePayModal() {
      document.getElementById('payModal').classList.add('hidden');
      payCard = null;
    }

    function setPayWhole(how) {
      payWhole = how === 'whole';
      clearFieldError('payAmount');
      renderPaySheet();
      if (!payWhole) document.getElementById('payAmount').focus();
    }
    function selectPayFrom(acct) {
      if (!payCard || !PAY_FROM[payCard].includes(acct)) return;
      payFrom = acct;
      renderPaySheet();
    }

    // Brings the open sheet up to date (the figures may have changed underneath it): the choices, each account's
    // balance, the "After this" line and the Pay button.
    function renderPaySheet() {
      if (!payCard) return;
      const amt = payAmountNow(), name = a => accountCard(a).name;
      document.getElementById('payWholeAmt').textContent = fmtGBP(cardOwes(payCard));
      markChoice('payHow_', ['whole', 'part'], payWhole ? 'whole' : 'part', PICK_ON + ' min-h-[44px] whitespace-nowrap', PICK_OFF + ' min-h-[44px] whitespace-nowrap');
      document.getElementById('payAmountBox').classList.toggle('hidden', payWhole);
      document.querySelectorAll('#payFromList [role="radio"]').forEach(row => {
        const a = row.dataset.arg, on = a === payFrom, tick = row.querySelector('.pay-tick');
        row.className = (on ? PICK_ON : PICK_OFF) + ' w-full flex items-center gap-3 px-3 min-h-[48px] text-left';
        row.setAttribute('aria-checked', String(on));
        row.querySelector('.pay-bal').textContent = fmtGBP(balanceOf(a));
        tick.className = 'pay-tick shrink-0 w-5 h-5 inline-flex items-center justify-center rounded-full ' + (on ? 'bg-emerald-500 text-slate-950' : 'border border-slate-300 dark:border-slate-600');
        tick.innerHTML = on ? icon('check', 'w-3 h-3') : '';
      });
      const ok = amt > 0;
      const after = (a, change) => `<span class="whitespace-nowrap">${name(a)} <strong class="tabular-nums">${fmtGBP(+(balanceOf(a) + change).toFixed(2))}</strong></span>`;
      document.getElementById('payAfter').innerHTML = ok
        ? `<span class="text-slate-500 dark:text-slate-400">After this:</span> ${after(payCard, amt)} • ${after(payFrom, -amt)}`
        : '<span class="text-slate-500 dark:text-slate-400">Type how much you paid.</span>';
      document.getElementById('btnPay').textContent = ok ? 'Pay ' + fmtGBP(amt) : 'Pay';
    }

    function submitPayCard() {
      if (!payCard) return;
      const owes = cardOwes(payCard);
      if (!payWhole && checkedAmount('payAmount', true) === null) return;
      const amt = payAmountNow();   // to the penny, as the button shows it
      if (amt > owes) return showFieldError('payAmount', `That's more than ${accountCard(payCard).name} owes (${fmtGBP(owes)})`);
      if (!payWhole && !(amt > 0)) return showFieldError('payAmount', 'Add the amount');   // less than a penny
      if (!(amt > 0)) return closePayModal();   // nothing owed any more (the figures changed while the sheet was open)
      const card = payCard, desc = accountCard(card).name + ' CC Payment', now = Date.now();
      addPendingTx(card, 99, desc, amt, false, now);   // made-up rows until the server says where each went
      addPendingTx(payFrom, 100, desc, -amt, false, now);
      closePayModal();
      savePhoneCache(activeMonth, state);
      renderAll();
      sendNewSpend({ sheetName: activeMonth, merchant: desc, grossAmount: amt, isRefund: true, account: card,
        payFrom, splits: [], marcusShare: 0, markNeed: false, clientId: newClientId() });
    }

    // ================= EDIT OR MOVE TRANSACTION MODAL =================
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
      selectEditTxAcct(acct);
      // Who's paying: the spend's shares as saved (none for an entry that is itself a share or an "I owe").
      const item = findEditedTx(acct, row, editTxExpect);
      editShares = item ? sharesOf(state, { ...item, acct }) : null;
      placeWho('edit');
      document.getElementById('whoBlock').classList.toggle('hidden', !editShares);
      customSplitEntries = editShares && editShares.kind === 'custom' ? editShares.entries.map(e => ({ ...e })) : [];
      autoEqualActive = false;
      setEditTxSign(num >= 0 ? 1 : -1);
      if (editShares) selectSplit(editShares.unknown ? '100_me' : editShares.kind);
      renderDynamicSplitRows();
      document.getElementById('editTxModal').classList.remove('hidden');
    }

    function closeEditTxModal() {
      closeWhoList();
      document.getElementById('editTxModal').classList.add('hidden');
      editTxExpect = null;
      editShares = null;
      document.getElementById('whoBlock').classList.remove('hidden');
      placeWho('add');
    }

    function setEditTxSign(sign) {
      editTxSign = sign < 0 ? -1 : 1;
      markToggle('etsign_', ['neg', 'pos'], editTxSign < 0 ? 'neg' : 'pos', 'pos');
      if (whoSheet === 'edit') updateSplitSummary();
    }

    // The share rows saved with a spend (see addTransactionBundle): one "<person> <shop>" Nationwide row per person, and
    // for a savings share a Marcus row "<shop>" with a Nationwide row "savings <shop>". The sheet doesn't link them to
    // their spend, so they are found by their save times: the server stamps the spend T, Marcus T-1, savings T-2 and
    // person i T-3-i (SHARE_TS_BACK in Code.js; the test page's shareRows the same), and keeps them in step when the spend
    // is edited with its shares (editSpendSplit). A time is the spend's own, so a share found by it counts whatever it
    // says (the spend may have been renamed since). Shares with no time (typed in the sheet, or their time since
    // dropped) are found by their words, which only works when no other spend that month has the same words.
    // Returns null for an entry that can't be split (a share, an "I owe", a card payment, a Marcus row);
    // { unknown: true } when its shares can't be told apart from another spend's (or a share's time links it to none);
    // else { olds, kind, entries, locked }: the share rows (with what each held), the choice they make ('100_me',
    // 'half', 'all', 'marcus' or 'custom' with its entries: { person, amount }, Marcus as 'marcus'), and locked when one
    // has been paid back (or was never put in Owed), which an edit must not change.
    const SHARE_ROWS_MAX = 12;   // as many person shares as the server writes for one spend
    function sharesOf(st, item) {
      const desc = String(item.desc || '').trim(), low = desc.toLowerCase(), amount = Number(item.amount);
      if (!desc || !amount || item.acct === 'marcus' || SPEND_SKIP.test(low)) return null;
      const rows = acct => (st[acct] || []).filter(r => !r.pending && !(acct === item.acct && r.row === item.row)).map(r => ({ ...r, acct }));
      const same = (a, b) => String(a).trim().toLowerCase() === b;
      const words = r => { const m = /^(\S+) (.+)$/.exec(String(r.desc).trim()); return m ? [m[1].toLowerCase(), m[2].toLowerCase()] : [null, null]; };
      const spends = ['amex', 'barclays', 'checking'].flatMap(rows);
      // The spend a timed row was saved with: one stamped just above it (see SHARE_TS_BACK), whatever either says now.
      const parentOf = r => r.clientTs ? spends.find(s => s.clientTs > r.clientTs && s.clientTs - r.clientTs <= 2 + SHARE_ROWS_MAX) : null;
      // A Nationwide row that is itself someone's share (stamped beside its spend, or "kim Tesco" signed against a
      // "Tesco"), or is still owed: nothing to split.
      if (item.acct === 'checking' && (item.need || SETTLED_PREFIX.test(desc) || parentOf(item)
        || spends.some(r => same(r.desc, words(item)[1] || '\u0000') && Math.sign(r.amount) === -Math.sign(amount)))) return null;
      const sign = amount < 0 ? 1 : -1;   // the shares' sign: + on money out (they owe you), - on money in (you pass it on)
      const T = Number(item.clientTs) || 0;
      const isSavings = r => words(r)[0] === 'savings';
      const marcus = [], savings = [], people = [];
      if (T) {
        marcus.push(...rows('marcus').filter(r => r.clientTs === T - 1));
        savings.push(...rows('checking').filter(r => r.clientTs === T - 2 && isSavings(r)));
        for (let i = 0; i < SHARE_ROWS_MAX; i++) people.push(...rows('checking').filter(r => r.clientTs === T - 3 - i && words(r)[0] && !isSavings(r)));
      }
      // By words: rows with no save time of their own. One with a time is another spend's (stamped beside it), or its
      // spend can't be found, so it is never taken by its words.
      const found = new Set([...marcus, ...savings, ...people].map(r => r.acct + '|' + r.row));
      const timed = [], add = list => r => { if (found.has(r.acct + '|' + r.row)) return; if (r.clientTs) timed.push(r); else list.push(r); };
      rows('marcus').filter(r => same(r.desc, low) && Math.sign(r.amount) === -sign).forEach(add(marcus));
      rows('checking').filter(r => same(r.desc, 'savings ' + low) && Math.sign(r.amount) === sign).forEach(add(savings));
      rows('checking').filter(r => !isSavings(r) && words(r)[1] === low && Math.sign(r.amount) === sign).forEach(add(people));
      const byWords = [...marcus, ...savings, ...people].some(r => !r.clientTs);
      // A timed share with these words whose spend isn't stamped just above it: whose it is can't be told. (On money in a
      // minus row like that is an "I owe", saved on its own, so not a share at all.)
      const stray = sign > 0 && timed.some(r => !parentOf(r));
      // Another spend with the same words (a Marcus share has them too, so not in Marcus), or the same share twice.
      const twin = spends.some(r => same(r.desc, low));
      const twice = marcus.length > 1 || savings.length > 1 || new Set(people.map(r => words(r)[0])).size < people.length;
      if (stray || twice || (byWords && twin)) return { unknown: true };
      const olds = marcus.concat(savings, people).map(r => ({ acct: r.acct, row: r.row, desc: r.desc, amount: Number(r.amount), need: !!r.need }));
      const locked = olds.some(r => r.acct === 'checking' && !r.need);
      const entries = people.map(r => ({ person: words(r)[0], amount: Math.abs(Number(r.amount)) }));
      const marcusShare = Math.abs(Number((savings[0] || marcus[0] || { amount: 0 }).amount));
      if (marcusShare) entries.push({ person: 'marcus', amount: marcusShare });
      const gross = Math.abs(amount), near = (a, b) => Math.abs(a - b) < 0.005;
      let kind = 'custom';
      if (!entries.length) kind = '100_me';
      else if (!people.length && near(marcusShare, gross) && marcus.length && savings.length) kind = 'marcus';
      else if (entries.length === 1 && entries[0].person === QUICK_SPLIT) {
        if (near(entries[0].amount, halfOf(gross))) kind = 'half';
        else if (near(entries[0].amount, gross)) kind = 'all';
      }
      return { olds, kind, entries, locked };
    }

    // Under the row in the Edit sheet: why it can't be changed, or what saving will do to Owed.
    function renderWhoNote(isRefund) {
      const note = document.getElementById('whoNote'), sh = whoSheet === 'edit' ? editShares : null;
      let text = '', tone = 'text-slate-500 dark:text-slate-400';
      if (sh && sh.unknown) {
        text = "Another spend this month has the same name, so its shares can't be told apart. Change them in Owed.";
      } else if (sh && sh.locked) {
        const paid = owedPerson(sh.olds.find(r => r.acct === 'checking' && !r.need).desc);
        text = (paid.key === 'savings' ? 'The savings' : paid.name + "'s") + " share has been paid back. To change who's paying, untick it under Paid back in Owed first.";
      } else if (sh) {
        const was = new Map(sh.entries.map(e => [e.person, e.amount]));
        const { splits, marcusShare } = buildSplitData();
        const now = new Map(splits.map(s => [s.person, s.amount]).concat(marcusShare ? [['marcus', marcusShare]] : []));
        const name = k => k === 'marcus' ? 'Marcus' : nameOf(k), parts = [];
        was.forEach((amt, k) => { if (!now.has(k)) parts.push('takes ' + name(k) + "'s " + fmtGBP(amt) + ' off Owed'); });
        now.forEach((amt, k) => {
          if (!was.has(k)) parts.push('adds ' + name(k) + "'s " + fmtGBP(amt) + ' to Owed');
          else if (Math.abs(was.get(k) - amt) >= 0.005) parts.push('makes ' + name(k) + "'s share " + fmtGBP(amt));
        });
        if (parts.length) {
          const wasWords = whoWords(sh.kind, isRefund, 0).main;
          text = (sh.kind !== formSplit && sh.kind !== '100_me' ? 'Was ' + wasWords + '. ' : '') + 'Saving ' + parts.join(', ').replace(/, ([^,]*)$/, ' and $1') + '.';
          tone = 'font-medium text-amber-700 dark:text-amber-300';
        }
      }
      note.textContent = text;
      note.className = 'mt-1.5 text-xs leading-snug ' + tone + (text ? '' : ' hidden');
    }

    function selectEditTxAcct(a) {
      editTxNewAcct = a;
      markChoice('etx_', ACCTS, a, CARD_ON, CARD_OFF);
    }

    // Shows a new entry straight away (marked pending until the server confirms it and gives it a real row); the
    // totals count it from the next render (sheetFigures).
    function addPendingTx(acct, row, desc, amount, need, ts) {
      const tx = { row, acct, desc, amount, need: !!need, clientTs: ts, relOrder: 0, pending: true };
      state[acct].unshift(tx);
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
      // The shares go with the spend (editSpendSplit) when they can change: found, none paid back, and there are some
      // now or some wanted. Shares that can't change (one is paid back) still go with a spend moved to another card, just
      // as they are (keepShares: only their save times follow the spend's), so they are found again next time.
      // Otherwise only the spend's own row changes, as before.
      const sh = editShares && !editShares.unknown ? editShares : null;
      let split = null;
      if (sh && sh.locked) {
        if (newAcct !== oldAcct && sh.olds.length) split = { keep: true };
      } else if (sh && (sh.olds.length > 0 || formSplit !== '100_me')) {
        if (showSplitProblem()) return;
        split = buildSplitData();
      }

      const newAmount = +(rawAbs * editTxSign).toFixed(2);
      const now = Date.now();
      if (newAcct === oldAcct) recordEditTime(newAcct, row, newDesc, newAmount);   // a move gets the server's time

      closeEditTxModal();
      mutate('the spend', () => {
        const oldArr = state[oldAcct] || [];
        const oldItem = findEditedTx(oldAcct, row, expect);
        if (!oldItem) return;
        const undos = [];
        if (oldAcct === newAcct) {
          undos.push(keepFields(oldItem, ['desc', 'amount', 'clientTs']));
          oldItem.desc = newDesc;
          oldItem.amount = newAmount;
          oldItem.clientTs = now;
        } else {
          undos.push(removeItem(oldArr, oldItem));
          const moved = addPendingTx(newAcct, 98, newDesc, newAmount, false, now);
          undos.push(takeOut(state[newAcct], moved));
        }
        if (split && !split.keep) {
          // The old shares go and the new ones show as "saving..." until the sheet's figures come back.
          sh.olds.forEach(o => {
            const r = (state[o.acct] || []).find(x => x.row === o.row && !x.pending && x.desc === o.desc && Number(x.amount) === o.amount);
            if (r) undos.push(removeItem(state[o.acct], r));
          });
          addPendingShares(newDesc, split, 100, now).forEach(r => undos.push(takeOut(state[r.acct], r)));
        }
        return () => undos.reverse().forEach(u => u());
      }, () => split
        ? apiCall('editSpendSplit', {
          sheetName: activeMonth, oldAcct, newAcct, row, newDesc, newAmount, expect,
          oldShares: sh.olds.map(o => ({ acct: o.acct, row: o.row, expect: { desc: o.desc, amount: o.amount, need: o.need } })),
          ...(split.keep ? { keepShares: true } : { splits: split.splits, marcusShare: split.marcusShare, markNeed: true })
        })
        : apiCall('editOrMoveTransaction', { sheetName: activeMonth, oldAcct, newAcct, row, newDesc, newAmount, expect }));
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
        return removeItem(oldArr, item);
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
      const s = sheetFigures(state, skippedBudgetRows);
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
      const pendingSum = sumAmounts(pendingItems);
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
      setNewMonthButton(exists ? 'Replace month' : 'Create month', exists);
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
      const finished = activeMonth;
      apiCall('startNewMonth', {
        sourceSheetName: activeMonth,
        newMonthName,
        paycheck,
        savingsAmount,
        keepBudgetRows,
        replaceExisting
      }).then(s => {
        applyServerState(s);
        sendMonthSummary(finished);   // for the Year view
      }).catch(err => {
        // Made, but its figures couldn't be read back: open it, which fetches them.
        if (failureKind(err) === 'saved') {
          openMadeMonth(newMonthName);
          sendMonthSummary(finished);
        } else if (err && err.code === 'EXISTS') {
          // Another device made this month in the meantime: nothing was changed. Load the latest so the warning shows.
          showToast('"' + newMonthName + '" already exists, so nothing was changed. Open Start new month again if you want to replace it.');
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
      dropOverdueRequests();   // nothing stale may hold up what coming back (or unlocking) asks for
      updateSyncUi();
      const awayFor = hiddenAt ? Date.now() - hiddenAt : 0;
      hiddenAt = 0;
      if (IS_GAS_ENV || awayFor < RETURN_REFRESH_MS) return;
      // Left on the lock screen: ask for the fingerprint again now you're back, in place of any old message (but not
      // after Sign out or a refused account, where the lock screen never asks by itself).
      if (lockScreenShowing()) {
        if (lockAllowsAuto && !passkeyAttempt && passkeyEnrolledHere()) { passkeyAutoTried = false; showLockScreen(passkeyNeedsReload ? PASSKEY_STUCK_MSG : LOCK_IDLE_MSG); }
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
      signOutEverywhere: () => signOutEverywhere(),
      // bills
      openBudgetForm: () => openBudgetForm(),
      openBudgetFormForRow: el => openBudgetFormForRow(rowOf(el)),
      setBudFilter: el => setBudFilter(el.dataset.arg),
      toggleWhatIf: el => toggleWhatIf(rowOf(el)),
      toggleWhatIfMode: () => setWhatIfMode(!whatIfMode),
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
      setSpendView: el => setSpendView(el.dataset.arg),
      setSpendTab: el => setSpendTab(el.dataset.arg),
      pickYearMonth: el => pickYearMonth(el.dataset.arg),
      pickYearCat: el => pickYearCat(el.dataset.cat),
      clearYearPick: () => clearYearPick(),
      setYearPeriod: el => setYearPeriod(el.value),
      setYearTable: el => setYearTable(el.dataset.arg),
      openEditTxForRow: el => openEditTxForRow(el.dataset.acct, rowOf(el)),
      toggleSpendCat: el => toggleSpendCat(el.dataset.cat),
      setSpendCategory: el => setSpendCategory(el.dataset.key, el.value),
      // Add sheet
      closeAddModal: () => closeAddModal(),
      setTxDirection: el => setTxDirection(el.dataset.arg),
      onGrossAmountInput: () => onGrossAmountInput(),
      selectAcct: el => selectAcct(el.dataset.arg),
      openWhoList: () => openWhoList(),
      closeWhoList: () => closeWhoList(),
      whoListBack: () => showWhoStep(false),   // (the step's choices are left as they were before it opened)
      pickWho: el => pickWho(el.dataset.arg),
      pickIOwePerson: el => pickIOwePerson(el.dataset.person),
      pickIOweShare: el => pickIOweShare(el.dataset.arg),
      doneIOwe: () => doneIOwe(),
      togglePersonChip: el => togglePersonChip(el.dataset.person),
      addBlankPersonRow: () => addBlankPersonRow(),
      updatePersonRowName: el => updatePersonRowName(idxOf(el), el.value),
      updatePersonRowAmt: el => updatePersonRowAmt(idxOf(el), el.value),
      removePersonRow: el => removePersonRow(idxOf(el)),
      applyEqualGroupSplit: () => applyEqualGroupSplit(),
      includeMeChanged: () => { if (autoEqualActive) applyEqualGroupSplit(); },
      submitExpense: () => submitExpense(),
      // pay off a card
      openPayCard: el => openPayCard(el.dataset.arg),
      closePayModal: () => closePayModal(),
      setPayWhole: el => setPayWhole(el.dataset.arg),
      selectPayFrom: el => selectPayFrom(el.dataset.arg),
      renderPaySheet: () => renderPaySheet(),
      submitPayCard: () => submitPayCard(),
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
