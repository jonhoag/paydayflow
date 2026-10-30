// Local stand-in for "GitHub Pages + Apps Script": serves the real index.html (pointed at /exec on this server)
// and runs the real Code.js behind POST /exec with fake Sheets/Properties/Cache. Used by the end-to-end test,
// and handy for trying the fingerprint flow on your own PC:  node tests/dev-backend.js 8124
// Passkey constants are pointed at localhost; Google's token check accepts any token beginning "e2e.".
const http = require('http');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { makeEnv, CLIENT_ID, EMAIL } = require('./mock-apps-script');

const root = path.resolve(__dirname, '..');
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.json': 'application/json', '.css': 'text/css' };

function startDevBackend(port) {
  const origin = 'http://localhost:' + port;
  const env = makeEnv({
    transformCode: code => {
      const out = code
        .replace("const PASSKEY_RP_ID = 'jonhoag.co.uk';", "const PASSKEY_RP_ID = 'localhost';")
        .replace("const PASSKEY_ORIGINS = ['https://jonhoag.co.uk'];", "const PASSKEY_ORIGINS = ['" + origin + "'];");
      if (out === code) throw new Error('could not point the passkey constants at localhost');
      return out;
    },
    // any token starting "e2e." counts as a valid Google sign-in for the owner
    googleTokens: new Proxy({}, { get: (_, t) => (typeof t === 'string' && t.startsWith('e2e.') ? env_().defaultTokeninfo() : undefined) }),
  });
  const env_ = () => env;
  const doPost = vm.runInContext('doPost', env.sandbox);
  const requestLog = [];

  // The real page, pointed at this server, without the external Google script, plus a stand-in for Google sign-in.
  const page = () => {
    let html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
    html = html.replace(/const APPS_SCRIPT_EXEC_URL = '[^']*';/, "const APPS_SCRIPT_EXEC_URL = '/exec';");
    html = html.replace(/<script src="https:\/\/accounts\.google\.com[^>]*><\/script>/, '');
    const mock = '<script>window.google = { accounts: { id: { initialize: c => { window.__gsiCallback = c.callback; }, renderButton: () => {}, prompt: () => {}, disableAutoSelect: () => {} } } };</script>';
    return html.replace(/<head>/i, '<head>' + mock);
  };

  const server = http.createServer((req, res) => {
    const url = req.url.split('?')[0];
    const json = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
    if (req.method === 'POST' && url === '/exec') {
      let body = '';
      req.on('data', d => { body += d; });
      req.on('end', () => {
        let parsed = {};
        try { parsed = JSON.parse(body); } catch (e) {}
        const out = doPost({ postData: { contents: body } });
        const reply = JSON.parse(out.content);
        requestLog.push({ action: parsed.action, auth: parsed.session ? 'session' : parsed.idToken ? 'google' : 'none', ok: reply.ok, error: reply.error });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(out.content);
      });
      return;
    }
    // test controls
    if (url === '/__admin/state') return json(200, { requests: requestLog, passkeys: JSON.parse(env.props['PF_PASSKEYS'] || '{}'), clockOffsetMs: env.clock.offsetMs });
    if (url === '/__admin/advance') { env.clock.offsetMs += Number(new URL(req.url, origin).searchParams.get('ms') || 0); return json(200, { clockOffsetMs: env.clock.offsetMs }); }
    if (url === '/__admin/wipe-passkeys') { delete env.props['PF_PASSKEYS']; return json(200, { ok: true }); }
    if (url === '/__admin/clear-log') { requestLog.length = 0; return json(200, { ok: true }); }
    if (url === '/__admin/token') {
      const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
      return json(200, { token: 'e2e.' + b64({ email: EMAIL, aud: CLIENT_ID, exp: Math.floor(Date.now() / 1000) + 3000 }) + '.sig' });
    }
    if (url === '/' || url === '/index.html') { res.writeHead(200, { 'Content-Type': types['.html'], 'Cache-Control': 'no-store' }); return res.end(page()); }
    const file = path.resolve(root, url.replace(/^\/+/, ''));
    if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise(resolve => server.listen(port, () => resolve({ server, env, origin })));
}

module.exports = { startDevBackend };
if (require.main === module) {
  const port = Number(process.argv[2] || 8124);
  startDevBackend(port).then(({ origin }) => console.log('Dev backend + page on ' + origin + '  (sign in via the page; Google is simulated)'));
}
