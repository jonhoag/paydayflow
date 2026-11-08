// Writes the SHA-256 of every published site file into sw.js (SITE_HASHES). The service worker serves a saved copy
// only when it is byte-for-byte the file this version was built with, so nothing written into the browser's saved
// copies by anything else (code injected into the page, say) can ever be opened in place of the real app.
//
//   node build-sw.js                    update the hashes in sw.js
//   node build-sw.js --check            exit 1 if sw.js is out of date (does not change any files)
//   node build-sw.js --published _site  exit 1 unless the files collected for publishing, exactly as they are on
//                                       disk, match the hashes in that folder's sw.js (pages.yml runs this)
//
// Run it after any change to a site file (build-css.js runs it too, since it rewrites index.html). Any change to a
// site file changes sw.js, so every device picks up the new version as a service-worker update. Stale hashes stop
// that update installing (devices stay on the old version, new ones get no offline copy), so they fail the build.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const TEXT = /\.(html|js|json|css|txt)$/;
const BLOCK = /(\/\/ <site-hashes>\r?\n)([\s\S]*?)( *\/\/ <\/site-hashes>)/;

// The bytes as published: Git stores text files with plain \n line endings (this PC checks them out with \r\n).
function publishedBytes(file) {
  const raw = fs.readFileSync(file);
  return TEXT.test(file) ? Buffer.from(raw.toString('latin1').replace(/\r\n/g, '\n'), 'latin1') : raw;
}

// Every file the service worker may save, relative to the site folder. Keep in step with "Collect the site files" in
// pages.yml (sw.js and CNAME are never saved); the --published check there fails if one is missing.
function siteFiles(root = __dirname) {
  const dir = d => fs.readdirSync(path.join(root, d)).sort().map(f => d + '/' + f);
  return ['index.html', 'manifest.json', 'tailwind.css', ...dir('icons'), ...dir('fonts')];
}

// { address it is fetched at (the page itself is "/"): SHA-256 }. With raw, the bytes on disk exactly as they are.
function siteHashes(root = __dirname, raw = false) {
  const out = {};
  for (const rel of siteFiles(root)) {
    const file = path.join(root, rel);
    out[rel === 'index.html' ? '/' : '/' + rel] = crypto.createHash('sha256').update(raw ? fs.readFileSync(file) : publishedBytes(file)).digest('hex');
  }
  return out;
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

if (require.main === module) {
  const at = process.argv.indexOf('--published');
  const opts = at > -1 ? { check: true, root: path.resolve(process.argv[at + 1] || '.'), raw: true } : { check: process.argv.includes('--check') };
  if (!stampServiceWorker(opts) && opts.check) process.exit(1);
}

module.exports = { publishedBytes, siteFiles, siteHashes, stampServiceWorker };
