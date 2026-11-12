// Shared by the real-Chrome tests: the browser, the step counter (tests/lib/steps.js), and the
// "away and back" helper. playwright-core comes from PW_PATH (a local folder) or from this repo's node_modules.
// Chrome: CHROME_PATH, else where it usually is on Windows, macOS or Linux.
const CHROME = process.env.CHROME_PATH || {
  win32: 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  darwin: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
}[process.platform] || '/usr/bin/google-chrome';
const { chromium } = require(process.env.PW_PATH || 'playwright-core');
const { makeSteps } = require('./steps');   // shared with the Node-only tests

const launchChrome = (opts = {}) => chromium.launch({ executablePath: CHROME, headless: true, ...opts });

// The app goes to the background for `ms` and comes back (the page's clock jumps by `ms` while it is hidden).
const awayAndBack = (page, ms) => page.evaluate(away => {
  const realNow = Date.now;
  const vis = s => { Object.defineProperty(document, 'visibilityState', { value: s, configurable: true }); document.dispatchEvent(new Event('visibilitychange')); };
  vis('hidden');
  Date.now = () => realNow() + away;
  try { vis('visible'); } finally { Date.now = realNow; }
}, ms);

module.exports = { launchChrome, makeSteps, awayAndBack };
