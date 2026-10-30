// Regenerates tailwind.css from the class names used in index.html and stamps index.html with the file's
// content hash (tailwind.css?v=HASH) so browsers can cache it safely.
//
//   node build-css.js           build tailwind.css and update the hash in index.html
//   node build-css.js --check   exit 1 if tailwind.css is out of date (does not change any files)
//
// Run it after any change to index.html that adds or changes Tailwind classes.
const { execSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = __dirname;
const check = process.argv.includes('--check');
const outFile = check ? path.join(os.tmpdir(), 'pf-tailwind-check.css') : path.join(root, 'tailwind.css');

// BROWSERSLIST_IGNORE_OLD_DATA hides a harmless "caniuse-lite is outdated" notice that would otherwise print on every build.
execSync(`npx --yes tailwindcss@3.4.17 -c tailwind.config.js -i tailwind.input.css -o "${outFile}" --minify`,
  { cwd: root, stdio: ['ignore', 'ignore', 'inherit'], env: { ...process.env, BROWSERSLIST_IGNORE_OLD_DATA: '1' } });

const hash = crypto.createHash('sha256').update(fs.readFileSync(outFile)).digest('hex').slice(0, 10);
const htmlPath = path.join(root, 'index.html');
const html = fs.readFileSync(htmlPath, 'utf8');
const linkRe = /href="tailwind\.css(\?v=[0-9a-f]*)?"/;
if (!linkRe.test(html)) throw new Error('index.html has no tailwind.css link');

if (check) {
  const current = (html.match(linkRe)[1] || '').replace('?v=', '');
  if (current !== hash) {
    console.error(`tailwind.css is out of date (index.html says ${current || 'no hash'}, current build is ${hash}). Run: node build-css.js`);
    process.exit(1);
  }
  console.log('tailwind.css is up to date (' + hash + ')');
} else {
  fs.writeFileSync(htmlPath, html.replace(linkRe, `href="tailwind.css?v=${hash}"`));
  console.log(`built tailwind.css (${fs.statSync(outFile).size} bytes, v=${hash})`);
}
