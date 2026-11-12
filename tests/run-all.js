// Runs every automated check:  node tests/run-all.js  (or npm test)
//   --quick             Node checks only, even when PW_PATH is set (deploy-backend.ps1 uses this)
//   --require-private   fail if the backend checks are missing (deploy-backend.ps1 uses this too)
//   any other words     run only the suites whose names contain one of them, e.g. node tests/run-all.js screens spending
//   - the page's own checks: spending summary, page logic, tailwind.css and sw.js hash freshness, and in real Chrome
//     (playwright-core from PW_PATH, or from npm ci --ignore-scripts) the service worker and the screens
//   - the backend checks, listed in tests/private/suites.js. They need the private backend files, so they are kept
//     out of the public repo with them; where that folder is missing they are skipped, and the summary says so.
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const argv = process.argv.slice(2);
const quick = argv.includes('--quick');
const requirePrivate = argv.includes('--require-private');
const only = argv.filter(a => !a.startsWith('--')).map(a => a.toLowerCase());
const unknown = argv.filter(a => a.startsWith('--') && !['--quick', '--require-private'].includes(a));
if (unknown.length) { console.log('Not an option: ' + unknown.join(', ') + ' (options: --quick, --require-private)'); process.exit(1); }
const canDriveChrome = (() => { try { require.resolve(process.env.PW_PATH || 'playwright-core'); return true; } catch (e) { return false; } })();
const chrome = canDriveChrome && !quick;
const privateList = path.join(__dirname, 'private', 'suites.js');
// Each suite: [name, command (from the project root), needs real Chrome?].
const privateSuites = fs.existsSync(privateList) ? require(privateList) : null;
const publicSuites = [
  ['spending summary', ['tests/spending.test.js']],
  ['page logic', ['tests/page-logic.test.js']],
  ['tailwind.css is current', ['build-css.js', '--check']],
  ['?v= stamps and sw.js file hashes are current', ['build-sw.js', '--check']],
  ['service worker (real Chrome)', ['tests/sw.test.js'], true],
  ['screens and buttons (real Chrome)', ['tests/ui-flows.test.js'], true],
];
// Node checks first, then the real-Chrome ones (the backend's own end-to-end before the page's).
const all = [...publicSuites, ...(privateSuites || [])];
let suites = [...all.filter(s => !s[2]), ...(privateSuites || []).filter(s => s[2]), ...publicSuites.filter(s => s[2])];
if (only.length) {
  suites = suites.filter(([name]) => only.some(w => name.toLowerCase().includes(w)));
  if (!suites.length) { console.log('No suite is called anything like: ' + only.join(', ') + '\nSuites: ' + all.map(s => s[0]).join(' | ')); process.exit(1); }
}
if (!chrome && suites.some(s => s[2])) {
  suites = suites.filter(s => !s[2]);
  console.log(quick ? '(quick run: the real-Chrome tests are skipped)\n' : '(skipping the real-Chrome tests: run npm ci --ignore-scripts, or set PW_PATH to a playwright-core folder)\n');
  if (!suites.length) { console.log('Nothing left to run: the suites named need real Chrome.'); process.exit(1); }
}

let failed = 0;
for (const [name, args] of suites) {
  const r = spawnSync(process.execPath, args, { cwd: root, encoding: 'utf8' });
  const tail = (r.stdout || '').trim().split('\n').slice(-1)[0];
  const ok = r.status === 0;
  if (!ok) failed++;
  console.log((ok ? 'PASS  ' : 'FAIL  ') + name + '  ' + tail);
  if (!ok) console.log((r.stdout || '') + (r.stderr || ''));
}
const hook = path.join(root, '.git', 'hooks', 'pre-push');
const hookCopy = path.join(__dirname, 'private', 'pre-push');
if (privateSuites && fs.existsSync(hookCopy) && !(fs.existsSync(hook) && fs.readFileSync(hook, 'utf8') === fs.readFileSync(hookCopy, 'utf8'))) {
  console.log('\n!! The private-data push check is not installed (or is out of date): cp tests/private/pre-push .git/hooks/pre-push');
}
if (!privateSuites) {
  console.log('\n!! The backend checks (tests/private) are not on this computer, so they did not run.');
  if (requirePrivate) failed++;
}
console.log(failed ? `\n${failed} suite(s) failed` : '\nAll suites passed');
process.exit(failed ? 1 : 0);
