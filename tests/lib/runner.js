// Shared by the real-Chrome tests: the browser, a runner that records each check and prints the summary, and the
// "away and back" helper. playwright-core comes from PW_PATH (a local folder) or from this repo's node_modules.
const CHROME = process.env.CHROME_PATH || 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe';
const { chromium } = require(process.env.PW_PATH || 'playwright-core');

const launchChrome = () => chromium.launch({ executablePath: CHROME, headless: true });

// step(name, fn) runs one check and records whether it passed (with the first lines of the error if not); a failed
// check never stops the run. finish() prints every result and the count, and exits 1 if any failed.
// onFail(name) runs after a failed check, e.g. to save a screenshot.
function makeSteps({ onFail } = {}) {
  const results = [];
  async function step(name, fn) {
    try { await fn(); results.push([true, name]); } catch (e) {
      results.push([false, name + '\n      ' + String(e.message).split('\n').slice(0, 4).join('\n      ')]);
      if (onFail) await onFail(name);
    }
  }
  function finish() {
    const failed = results.filter(([ok]) => !ok).length;
    results.forEach(([ok, name]) => console.log((ok ? '  PASS  ' : '  FAIL  ') + name));
    console.log(`\n${results.length - failed}/${results.length} passed`);
    process.exit(failed ? 1 : 0);
  }
  return { step, finish };
}

// The app goes to the background for `ms` and comes back (the page's clock jumps by `ms` while it is hidden).
const awayAndBack = (page, ms) => page.evaluate(away => {
  const realNow = Date.now;
  const vis = s => { Object.defineProperty(document, 'visibilityState', { value: s, configurable: true }); document.dispatchEvent(new Event('visibilitychange')); };
  vis('hidden');
  Date.now = () => realNow() + away;
  try { vis('visible'); } finally { Date.now = realNow; }
}, ms);

module.exports = { CHROME, launchChrome, makeSteps, awayAndBack };
