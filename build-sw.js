// The one list of the website's files, and the build step that keeps the page and the service worker in step with them.
// It stamps index.html with each script's and the stylesheet's own hash (app.js?v=HASH), so a browser never mixes an
// old file with a new page, and writes the SHA-256 of every published site file into sw.js (SITE_HASHES). The service
// worker serves a saved copy only when it is byte-for-byte the file this version was built with, so nothing written
// into the browser's saved copies by anything else (code injected into the page, say) can ever be opened in place of
// the real app.
//
//   node build-sw.js                    update the ?v= stamps in index.html and the hashes in sw.js
//   node build-sw.js --check            exit 1 if either is out of date (does not change any files)
//   node build-sw.js --collect _site    copy exactly the files to publish into _site (pages.yml runs this)
//   node build-sw.js --published _site  exit 1 unless the files collected for publishing, exactly as they are on
//                                       disk, match that folder's stamps and sw.js hashes (pages.yml runs this)
//
// Run it after any change to a site file (build-css.js runs it too). Any change to a site file changes sw.js, so every
// device picks up the new version as a service-worker update. Stale stamps or hashes stop that update installing
// (devices stay on the old version, new ones get no offline copy), so they fail the build.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const TEXT = /\.(html|js|json|css|txt)$/;
const BLOCK = /(\/\/ <site-hashes>\r?\n)([\s\S]*?)( *\/\/ <\/site-hashes>)/;
// index.html asks for each of these as FILE?v=<the first 10 characters of its SHA-256>.
const STAMPED = ['guard.js', 'app.js', 'tailwind.css'];
// Published but never saved by the service worker: sw.js itself, and the domain name file for GitHub Pages.
const NOT_SAVED = ['sw.js', 'CNAME'];

// The bytes as published: Git stores text files with plain \n line endings (this PC checks them out with \r\n).
function publishedBytes(file) {
  const raw = fs.readFileSync(file);
  return TEXT.test(file) ? Buffer.from(raw.toString('latin1').replace(/\r\n/g, '\n'), 'latin1') : raw;
}
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
// The SHA-256 of a site file: as published, or with raw, its bytes on disk exactly as they are. The ?v= stamp is its
// first 10 characters, so the stamp and sw.js's record always come from the same hash.
const fileHash = (root, rel, raw) => sha256(raw ? fs.readFileSync(path.join(root, rel)) : publishedBytes(path.join(root, rel)));

// Every file the service worker may save, relative to the site folder. The test servers (tests/lib/site-files.js)
// serve these, and --collect publishes these plus NOT_SAVED. Add a new kind of file here (and to ALLOWED in the
// private public-files check).
function siteFiles(root = __dirname) {
  const dir = d => fs.readdirSync(path.join(root, d)).sort().map(f => d + '/' + f);
  return ['index.html', ...STAMPED, 'manifest.json', ...dir('icons'), ...dir('fonts')];
}
const publishedFiles = (root = __dirname) => [...siteFiles(root), ...NOT_SAVED];

// { address it is fetched at (the page itself is "/"): SHA-256 }. With raw, the bytes on disk exactly as they are.
function siteHashes(root = __dirname, raw = false) {
  const out = {};
  for (const rel of siteFiles(root)) out[rel === 'index.html' ? '/' : '/' + rel] = fileHash(root, rel, raw);
  return out;
}

// Brings the ?v= stamps in index.html up to date (or, with check, only says whether they are). Returns true if they
// were current. Each file must be asked for exactly once.
function stampVersions({ check = false, root = __dirname, raw = false } = {}) {
  const htmlPath = path.join(root, 'index.html');
  const html = fs.readFileSync(htmlPath, 'utf8');
  let next = html;
  const stale = [];
  for (const rel of STAMPED) {
    const v = fileHash(root, rel, raw).slice(0, 10);
    const re = new RegExp(`((?:src|href)="${rel.replace(/\./g, '\\.')})(\\?v=[0-9a-f]*)?"`, 'g');
    const found = [...next.matchAll(re)];
    if (found.length !== 1) throw new Error(`index.html asks for ${rel} ${found.length} times (it must be exactly once)`);
    if (found[0][2] !== '?v=' + v) stale.push(rel);
    next = next.replace(re, (all, start) => `${start}?v=${v}"`);
  }
  if (check) {
    if (stale.length) console.error(`index.html asks for an old version of ${stale.join(', ')}. Run: node build-sw.js`);
    else console.log(`index.html asks for the current ${STAMPED.join(', ')}`);
  } else if (next !== html) {
    fs.writeFileSync(htmlPath, next);
    console.log('updated index.html for ' + stale.join(', '));
  }
  return !stale.length;
}

const parseBlock = text => Object.fromEntries([...text.matchAll(/'([^']+)': '([0-9a-f]{64})'/g)].map(m => [m[1], m[2]]));
const differing = (a, b) => [...new Set([...Object.keys(a), ...Object.keys(b)])].filter(k => a[k] !== b[k]);

// Brings the hashes in sw.js up to date (or, with check, only says whether they are). Returns true if they were current.
function stampServiceWorker({ check = false, root = __dirname, raw = false } = {}) {
  const swPath = path.join(root, 'sw.js');
  const sw = fs.readFileSync(swPath, 'utf8');
  const m = sw.match(BLOCK);
  if (!m) throw new Error(swPath + ' has no // <site-hashes> block');
  const eol = m[1].endsWith('\r\n') ? '\r\n' : '\n';
  const hashes = siteHashes(root, raw);
  const next = sw.replace(BLOCK, (all, open, body, close) => open + Object.entries(hashes).map(([p, h]) => `  '${p}': '${h}',${eol}`).join('') + close);
  const n = Object.keys(hashes).length;
  if (check) {
    if (next !== sw) console.error(`sw.js does not match the site files (${differing(parseBlock(m[2]), hashes).join(', ') || 'layout'}). Run: node build-sw.js`);
    else console.log(`sw.js hashes are up to date (${n} files)`);
  } else {
    if (next !== sw) fs.writeFileSync(swPath, next);
    console.log(`${next !== sw ? 'updated' : 'already current:'} sw.js hashes for ${n} files`);
  }
  return next === sw;
}

// The stamps first: they change index.html, whose hash then goes into sw.js. Returns true if both were current.
function build(opts = {}) {
  const stamps = stampVersions(opts);
  return stampServiceWorker(opts) && stamps;
}

// Copies the files to publish, exactly as they are on disk, into a new folder.
function collect(dest) {
  if (fs.existsSync(dest)) throw new Error(dest + ' already exists');
  for (const rel of publishedFiles()) {
    fs.mkdirSync(path.dirname(path.join(dest, rel)), { recursive: true });
    fs.copyFileSync(path.join(__dirname, rel), path.join(dest, rel));
    console.log(rel);
  }
}

if (require.main === module) {
  const arg = flag => { const at = process.argv.indexOf(flag); return at > -1 ? path.resolve(process.argv[at + 1] || '.') : null; };
  if (arg('--collect')) collect(arg('--collect'));
  else {
    const published = arg('--published');
    const opts = published ? { check: true, root: published, raw: true } : { check: process.argv.includes('--check') };
    if (!build(opts) && opts.check) process.exit(1);
  }
}

module.exports = { publishedBytes, siteFiles, publishedFiles, siteHashes, stampVersions, stampServiceWorker, build };
