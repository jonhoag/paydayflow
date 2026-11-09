// Regenerates tailwind.css from the class names used in index.html and app.js, then runs build-sw.js (which stamps
// index.html with the file's hash, tailwind.css?v=HASH, and updates sw.js).
//
//   node build-css.js           build tailwind.css, then update the stamps and sw.js
//   node build-css.js --check   exit 1 if tailwind.css is not what a fresh build gives (does not change any files;
//                               node build-sw.js --check checks the stamp)
//
// Run it after any change to index.html or app.js that adds or changes Tailwind classes; after any other change to a
// site file, run node build-sw.js. It uses the Tailwind version pinned in
// package-lock.json, installed once with: npm ci --ignore-scripts
const { execSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = __dirname;
const check = process.argv.includes('--check');
const cssPath = path.join(root, 'tailwind.css');
const tmpDir = check ? fs.mkdtempSync(path.join(os.tmpdir(), 'pf-css-')) : null;   // its own folder per run
const outFile = check ? path.join(tmpDir, 'tailwind.css') : cssPath;

// BROWSERSLIST_IGNORE_OLD_DATA hides a harmless "caniuse-lite is outdated" notice that would otherwise print on every build.
// Tailwind's progress notices go to stderr, so only show its output if the build actually fails.
const hashOf = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex').slice(0, 10);
let hash;
try {
  const cli = path.join(root, 'node_modules', 'tailwindcss', 'lib', 'cli.js');
  if (!fs.existsSync(cli)) throw new Error('Tailwind is not installed here. Run: npm ci --ignore-scripts');
  execSync(`"${process.execPath}" "${cli}" -c tailwind.config.js -i tailwind.input.css -o "${outFile}" --minify`,
    { cwd: root, stdio: 'pipe', env: { ...process.env, BROWSERSLIST_IGNORE_OLD_DATA: '1' } });
  hash = hashOf(outFile);
} catch (e) {
  console.error(String(e.stderr || e.message));
} finally {
  if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
}
if (!hash) process.exit(1);
if (check) {
  // The tailwind.css that is actually published must be what a fresh build gives.
  const onDisk = fs.existsSync(cssPath) ? hashOf(cssPath) : 'missing';
  if (onDisk !== hash) {
    console.error(`tailwind.css is out of date (tailwind.css is ${onDisk}, a fresh build is ${hash}). Run: node build-css.js`);
    process.exit(1);
  }
  console.log('tailwind.css is up to date (' + hash + ')');
} else {
  console.log(`built tailwind.css (${fs.statSync(outFile).size} bytes, ${hash})`);
  // Its stamp in index.html, and so the service worker's record of the page, change with it.
  require('./build-sw.js').build();
}
