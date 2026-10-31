// Runs every automated check:  node tests/run-all.js
//   - backend unit tests, passkey crypto, passkey flow, and the mutation check (all need only Node)
//   - the real-Chrome tests (end-to-end sign-in, service worker), if playwright-core is available (set PW_PATH)
//   - tailwind.css freshness
const { spawnSync } = require('child_process');
const path = require('path');

const suites = [
  ['backend tests', ['tests/backend.test.js']],
  ['spending summary', ['tests/spending.test.js']],
  ['passkey crypto', ['tests/passkey-crypto.test.js']],
  ['passkey flow', ['tests/passkey-flow.test.js']],
  ['mutation check', ['tests/mutation-check.js']],
  ['tailwind.css is current', ['build-css.js', '--check']],
];
if (process.env.PW_PATH) {
  suites.push(['real-Chrome end-to-end', ['tests/e2e-passkey.js']]);
  suites.push(['service worker (real Chrome)', ['tests/sw.test.js']]);
  suites.push(['screens and buttons (real Chrome)', ['tests/ui-flows.test.js']]);
} else console.log('(skipping the real-Chrome tests: set PW_PATH to a playwright-core folder to include them)\n');

let failed = 0;
for (const [name, args] of suites) {
  const r = spawnSync(process.execPath, args, { cwd: path.join(__dirname, '..'), encoding: 'utf8' });
  const tail = (r.stdout || '').trim().split('\n').slice(-1)[0];
  const ok = r.status === 0;
  if (!ok) failed++;
  console.log((ok ? 'PASS  ' : 'FAIL  ') + name + '  ' + tail);
  if (!ok) console.log((r.stdout || '') + (r.stderr || ''));
}
console.log(failed ? `\n${failed} suite(s) failed` : '\nAll suites passed');
process.exit(failed ? 1 : 0);
