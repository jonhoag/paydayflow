// The Apps Script backend is two files that share one global scope: Code.js (sheet logic) and Passkeys.js
// (fingerprint sign-in). Both are gitignored. Tests load them as one script, like Apps Script does.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const BACKEND_FILES = ['Code.js', 'Passkeys.js'];

function readBackendSource() {
  return BACKEND_FILES.map(f => fs.readFileSync(path.join(ROOT, f), 'utf8')).join('\n');
}

module.exports = { readBackendSource, BACKEND_FILES };
