// PaydayFlow: talking to the server, and keeping saves safe. Loaded by index.html just before app.js (and put back
// inside the page for the copy Apps Script serves, by deploy-backend.ps1), in the same shared scope. It uses app.js's
// screen functions (updateSyncUi, showToast, renderAll, applyServerState, showLockScreen...) only from inside its own
// functions, which run once app.js has loaded: never name one of them at the top level here (as a listener passed by
// name, say), where it doesn't exist yet. The screen tests' "no page errors" check catches that.
// - Requests: one at a time (apiCall), with time limits, one resend for a slow read, and what a failure means
//   (failureKind), which the sync status and the outbox act on.
// - Saves shown before the sheet has them (mutate), put back if the save fails.
// - The offline outbox for new spends (sendNewSpend, flushOutbox).

// ---- Requests ----
const REQUEST_TIMEOUT_MS = 45000;         // how long any request to the server may take before it is given up
// Reading the figures takes the server 0.5-3 s, but Google can hold a request for a minute before it even starts
// (seen 2026-11-20 on about 1 in 8). So a read with no reply after 15 s is sent once more, and the two together wait
// no longer than one request did before. Only reads: asking twice changes nothing.
const READ_FIRST_TRY_MS = 15000;

// Aborts `to` as soon as `from` aborts (at once if it already has). Returns a function that unhooks it again.
function chainAbort(from, to) {
  if (!from) return () => {};
  const go = () => to.abort();
  if (from.aborted) go(); else from.addEventListener('abort', go);
  return () => from.removeEventListener('abort', go);
}

// Requests go to the server strictly one at a time. Apps Script can answer two quick requests out of
// order, and a late, older reply would otherwise overwrite newer screen state.
let apiQueue = Promise.resolve();
// For the sync status (updateSyncUi): requests not yet answered, and how the last one to the sheet went:
// lastSyncFailed is null (fine), 'reach' (no reply, none that could be read, or a read the server couldn't answer)
// or 'refused' (the server turned a change down). Fingerprint requests aren't about the sheet, so they don't count.
let apiInflight = 0, lastSyncAt = null, lastSyncFailed = null;
// The reads: a failed one shows as 'reach' in the sync status, and a slow one is sent again (postReadToServer).
// So only actions that change nothing on the server belong here.
const SHEET_READS = ['getCachedSheetState', 'getCategoryChoices'];
// What a failed request means: 'signin' (the lock screen deals with it), 'reach' (no usable reply), 'busy' (the
// sheet was busy with another save, so the server did nothing), 'saved' (the change is in the sheet, but its new
// figures couldn't be read back: fetch them afresh) or 'refused' (turned down, or failed part way).
function failureKind(err) {
  if (err && (err.needsSignIn || err.auth)) return 'signin';
  if (!err || isConnectionError(err)) return 'reach';
  return err.code === 'BUSY' ? 'busy' : err.code === 'SAVED_NO_STATE' ? 'saved' : 'refused';
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
    // Apps Script hands back an error whose text may start "Error: " or "Exception: ", then the server's code in
    // brackets ("[STALE] ..."; see gasCall). A lost connection is named (or worded) "NetworkError": like no
    // reply on the website, not a refusal.
    const failed = e => {
      const name = String((e && e.name) || ''), text = String((e && e.message) || e);
      const plain = text.replace(/^(?:(?:Error|Exception|ScriptError): )+/, '');
      const coded = /^\[([A-Z_]+)\] ([\s\S]*)$/.exec(plain);
      const err = new Error(coded ? coded[2] : plain);
      if (coded) err.code = coded[1];
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
  const body = { action, payload, ...auth };
  const json = await (SHEET_READS.includes(action) ? postReadToServer(body) : postToServer(body));

  if (!json.ok) {
    const apiErr = serverError(json, 'API request failed');
    // The server couldn't fetch Google's keys just now: the sign-in wasn't turned down, so keep it and try again later.
    if (apiErr.code === 'AUTH_UNAVAILABLE') {
      throw Object.assign(new Error(String(json.error).replace(/^[A-Z_]+: /, '')), { unavailable: true, code: apiErr.code });
    }
    if (json.authError) {
      const usedSession = !!auth.session;
      if (usedSession) clearSession(); else { lsDel(TOKEN_STORAGE_KEY); stopGoogleAutoSignIn(); }
      // An expired fingerprint session is normal: go straight back to the fingerprint prompt.
      showLockScreen(usedSession ? 'Session ended. Unlock to continue.' : 'Access Denied: ' + String(json.error || 'Unauthorised account.').replace(/^[A-Z_]+: /, ''), usedSession ? undefined : { noAuto: true });
    }
    apiErr.auth = !!json.authError;
    throw apiErr;
  }
  return json.data;
}

// A refused reply as an error. What happened is its `code` (see ERROR CODES in the backend; ERROR if it has none):
// the page acts on that alone, and the words are only for showing.
const serverError = (json, fallback) => Object.assign(new Error(json.error || fallback), { code: String(json.code || 'ERROR') });

// No reply, one that wasn't readable, or a server that couldn't check the sign-in just now: worth trying again
// later, not a refusal.
const isConnectionError = err => !!(err && (err.network || err.badReply || err.unavailable));

// Requests on their way: when each runs out of time (by the clock), and how to give it up.
const liveRequests = new Set();
// A phone that sleeps, or a page Android freezes in the background, may not count the time limit down meanwhile, so a
// request sent just before can still hold up the queue for most of its 45 s once the app is back. So, coming back,
// the requests already past their limit by the clock are given up, exactly as if their time limit had run out; after
// a moment (DROP_OVERDUE_AFTER_MS), so that a reply which arrived while the app was away still lands. They are marked
// overdue at once, though: a request's own time limit, also past by then, may run out before that moment, and must
// still count as given up after the phone slept (postToServer), not as an ordinary wait.
const DROP_OVERDUE_AFTER_MS = 1500;
const LATE_TIMER_MS = 3000;   // a time limit that ran out later than this was asleep too (see postToServer)
function dropOverdueRequests() {
  const now = Date.now();
  const overdue = [...liveRequests].filter(r => now >= r.deadline);
  overdue.forEach(r => { r.overdue = true; });
  if (overdue.length) setTimeout(() => overdue.forEach(r => { if (liveRequests.has(r)) r.abort.abort(); }), DROP_OVERDUE_AFTER_MS);
}

// One POST to the Apps Script web app; resolves with the parsed { ok, data | error, authError } reply.
// `opts.timeoutMs` shortens the wait; `opts.signal` lets the caller cancel it.
async function postToServer(bodyObj, opts = {}) {
  // Give up after a while so one stuck request can't block every request queued behind it.
  const abort = new AbortController();
  const limit = opts.timeoutMs || REQUEST_TIMEOUT_MS;
  const timer = setTimeout(() => abort.abort(), limit);
  const unlink = chainAbort(opts.signal, abort);
  const live = { deadline: Date.now() + limit, abort };
  liveRequests.add(live);
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
    // Given up on coming back after the phone slept (or the page was frozen), rather than after an ordinary wait.
    netErr.afterSleep = netErr.timedOut && !!(live.overdue || Date.now() > live.deadline + LATE_TIMER_MS);
    throw netErr;
  } finally {
    clearTimeout(timer);
    unlink();
    liveRequests.delete(live);
  }
  try {
    return JSON.parse(rawText);
  } catch (e) {
    console.warn('Unreadable reply from the server:', rawText.slice(0, 200));
    throw Object.assign(new Error('The server sent back something unexpected. Try again in a moment.'), { badReply: true });
  }
}

// A read (see READ_FIRST_TRY_MS): sent again once if the first try got no reply in time. Any other failure is final,
// and so is a try given up after the phone slept (afterSleep): coming back, the page asks afresh anyway, and the
// sign-in the read was sent with may have run out meanwhile. The second try gets what is left of REQUEST_TIMEOUT_MS
// since the first was sent, so the two together never wait longer than one request used to (a first time limit
// that ran out a little late leaves a little less).
async function postReadToServer(bodyObj) {
  const sentAt = Date.now();
  try {
    return await postToServer(bodyObj, { timeoutMs: READ_FIRST_TRY_MS });
  } catch (err) {
    if (!err || !err.timedOut || err.afterSleep) throw err;
    // (never more than the usual second wait, even if the phone's clock was put back meanwhile)
    const left = Math.min(REQUEST_TIMEOUT_MS - READ_FIRST_TRY_MS, REQUEST_TIMEOUT_MS - (Date.now() - sentAt));
    if (left <= 0) throw err;
    return postToServer(bodyObj, { timeoutMs: left });
  }
}

// ---- Saves shown before the sheet has them ----
// A save failed: say so, then reload the real sheet state so the screen never silently disagrees with it.
function handleSaveError(what, err) {
  // Saved after all, only its new figures couldn't be read back: nothing to say (a "Deleted / Undo" toast stays
  // up), just fetch them.
  if (failureKind(err) === 'saved') return refreshFromSheet(true);
  console.error(what + ' error:', err);
  // The server refuses an edit or delete when the row changed on another device since this screen loaded.
  const stale = !!err && err.code === 'STALE';
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
      renderAll();
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
// A card payment (it carries payFrom) has its own action, so a backend from before it refuses it instead of saving
// only the card's half; everything else about sending, queueing and resending is the same as for a spend.
const spendAction = payload => payload.payFrom ? 'addCardPayment' : 'addTransactionBundle';
// `onSaved` runs once the sheet's figures after this save are on screen (not when it is queued or set aside).
function sendNewSpend(payload, onSaved) {
  if (!IS_GAS_ENV && navigator.onLine === false) {
    if (!queueSpend(payload)) return showToast("You're offline and this device couldn't keep that spend, so it isn't saved.");
    showToast("You're offline - saved on this device, it will send when you're back online.", { kind: 'info' });
    return;
  }
  apiCall(spendAction(payload), payload)
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
      if (!queueSpend(payload, kind === 'reach' ? { sentAt: Date.now() } : {})) return handleSaveError('the spend', err);
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
        const s = await apiCall(spendAction(item.payload), item.payload);
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
window.addEventListener('offline', () => updateSyncUi());   // (app.js's, there by the time this runs)
setInterval(flushOutbox, 60000);
