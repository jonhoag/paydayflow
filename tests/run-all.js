// Runs every automated check:  node tests/run-all.js
//   --quick             Node checks only, even when PW_PATH is set (deploy-backend.ps1 uses this)
//   --require-private   fail if the backend checks are missing (deploy-backend.ps1 uses this too)
//   - the page's own checks: spending summary, tailwind.css freshness, and in real Chrome (playwright-core from
//     PW_PATH, or from npm ci --ignore-scripts) the service worker and the screens
//   - the backend checks, listed in tests/private/suites.js. They need the private backend files, so they are kept
//     out of the public repo with them; where that folder is missing they are skipped, and the summary says so.
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const quick = process.argv.includes('--quick');
const requirePrivate = process.argv.includes('--require-private');
const canDriveChrome = (() => { try { require.resolve(process.env.PW_PATH || 'playwright-core'); return true; } catch (e) { return false; } })();
const chrome = canDriveChrome && !quick;
const privateList = path.join(__dirname, 'private', 'suites.js');
const privateSuites = fs.existsSync(privateList) ? require(privateList) : null;
const backend = (privateSuites || []).filter(s => !s[2]);

const suites = [
  ...backend.slice(0, 1),
  ['spending summary', ['tests/spending.test.js']],
  ...backend.slice(1),
  ['tailwind.css is current', ['build-css.js', '--check']],
];
if (chrome) {
  suites.push(...(privateSuites || []).filter(s => s[2]));
  suites.push(['service worker (real Chrome)', ['tests/sw.test.js']]);
  suites.push(['screens and buttons (real Chrome)', ['tests/ui-flows.test.js']]);
} else if (quick) console.log('(quick run: the real-Chrome tests are skipped)\n');
else console.log('(skipping the real-Chrome tests: run npm ci --ignore-scripts, or set PW_PATH to a playwright-core folder)\n');

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
