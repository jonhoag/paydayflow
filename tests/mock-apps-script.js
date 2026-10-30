// Fake Google Apps Script services, so the real Code.js can run in Node (unit tests, local dev backend).
// Crypto-related services use Node's real crypto, so signatures/digests behave like production.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');
const { readBackendSource } = require('./load-code');

const CLIENT_ID = '1074590107449-b3clq41r6un84qma18lomq7ip2f833pk.apps.googleusercontent.com';
const EMAIL = 'jonfhoag@gmail.com';

const toBuf = v => (typeof v === 'string' ? Buffer.from(v, 'utf8') : Buffer.from(Array.from(v, b => b & 255)));
const toSigned = buf => Array.from(buf, b => (b > 127 ? b - 256 : b));   // Apps Script byte arrays are signed

// options:
//   transformCode(src) -> src       edit the source before it runs (e.g. point the passkey constants at localhost)
//   googleTokens: { token: payload } what Google's tokeninfo should answer; default: any token is the owner
function makeEnv(options = {}) {
  let code = process.env.PF_CODE_FILE ? fs.readFileSync(process.env.PF_CODE_FILE, 'utf8') : readBackendSource();
  if (options.transformCode) code = options.transformCode(code);

  const log = [];            // ordered events: 'lock:wait', 'write', 'lock:release', ...
  const writes = { count: 0 };
  const clock = { offsetMs: 0 };

  const blankRows = (n, c) => Array.from({ length: n }, () => Array(c).fill(''));
  const range = {
    getValues: () => blankRows(80, 20),
    getNotes: () => Array.from({ length: 80 }, () => ['']),
    getValue: () => '',
  };
  ['setValue', 'setNote', 'clearNote', 'setFontFamily', 'setFontSize', 'setFontWeight',
    'setBackground', 'setFontColor', 'setNumberFormat', 'clearContent'].forEach(m => {
    range[m] = () => { writes.count++; log.push('write'); return range; };
  });
  const mkSheet = name => ({
    getName: () => name, getLastRow: () => 80, getLastColumn: () => 20, getSheetId: () => 1,
    getRange: () => range, getMaxRows: () => 180, getMaxColumns: () => 20,
    deleteRows() {}, deleteColumns() {}, setName() {}, copyTo() { return mkSheet('copy'); },
  });
  const sheets = [mkSheet('Real Month')];
  const ss = {
    getSheets: () => sheets,
    getSheetByName: n => sheets.find(s => s.getName() === n) || null,
    getUrl: () => 'https://example/sheet',
    setActiveSheet() {}, moveActiveSheet() {},
  };

  const props = {};
  const cacheStore = {};
  const lockCalls = { waits: 0, releases: 0 };

  class FakeDate extends Date {
    constructor(...a) { if (a.length === 0) super(Date.now() + clock.offsetMs); else super(...a); }
    static now() { return Date.now() + clock.offsetMs; }
  }

  const defaultTokeninfo = () => ({ email_verified: 'true', email: EMAIL, aud: CLIENT_ID, exp: String(Math.floor((Date.now() + clock.offsetMs) / 1000) + 600) });

  const sandbox = {
    console: options.verbose ? console : { log() {}, warn() {}, error() {} }, BigInt, Date: FakeDate, Math,
    SpreadsheetApp: { getActiveSpreadsheet: () => ss, flush() {} },
    CacheService: { getScriptCache: () => ({
      get: k => (k in cacheStore ? cacheStore[k] : null),
      put: (k, v) => { cacheStore[k] = String(v); },
      remove: k => { delete cacheStore[k]; } }) },
    // Like the real service, refuse values over ~9KB.
    PropertiesService: { getScriptProperties: () => ({
      getProperty: k => (k in props ? props[k] : null),
      setProperty: (k, v) => {
        if (String(v).length > 9216) throw new Error('Argument too large: value');
        props[k] = String(v);
      },
      deleteProperty: k => { delete props[k]; } }) },
    LockService: { getScriptLock: () => ({
      waitLock: () => { lockCalls.waits++; log.push('lock:wait'); },
      releaseLock: () => { lockCalls.releases++; log.push('lock:release'); } }) },
    ContentService: {
      MimeType: { JSON: 'json', TEXT: 'text' },
      createTextOutput: s => ({ content: s, setMimeType() { return this; } }) },
    Session: { getActiveUser: () => ({ getEmail: () => EMAIL }), getScriptTimeZone: () => 'Europe/London' },
    Utilities: {
      DigestAlgorithm: { SHA_256: 'sha256' },
      computeDigest: (alg, v) => toSigned(crypto.createHash('sha256').update(toBuf(v)).digest()),
      computeHmacSha256Signature: (v, key) => toSigned(crypto.createHmac('sha256', toBuf(key)).update(toBuf(v)).digest()),
      base64EncodeWebSafe: v => toBuf(v).toString('base64').replace(/\+/g, '-').replace(/\//g, '_'),
      base64DecodeWebSafe: s => toSigned(Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64')),
      getUuid: () => crypto.randomUUID(),
      formatDate: () => '000000' },
    UrlFetchApp: { fetch: url => {
      const token = decodeURIComponent(String(url).split('id_token=')[1] || '');
      const payload = options.googleTokens ? options.googleTokens[token] : defaultTokeninfo();
      return { getResponseCode: () => (payload ? 200 : 400), getContentText: () => JSON.stringify(payload || { error: 'invalid_token' }) };
    } },
    HtmlService: {},
  };
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);
  return { sandbox, log, writes, lockCalls, props, cacheStore, clock, defaultTokeninfo };
}

module.exports = { makeEnv, CLIENT_ID, EMAIL, toSigned, toBuf };
