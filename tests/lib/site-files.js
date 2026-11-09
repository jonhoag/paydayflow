// Shared by the local test servers. They listen on this computer only (HOST), and they serve only the website's own
// files and the test page: never the private backend, notes or settings that sit in the same folder, and nothing
// outside it.
const fs = require('fs');
const path = require('path');
const { publishedBytes, siteFiles } = require('../../build-sw');

const root = path.resolve(__dirname, '..', '..');
const HOST = '127.0.0.1';
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.png': 'image/png', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8' };
// The website's own files (the one list, in build-sw.js), sw.js, and the test page.
const SITE = new Set([...siteFiles(root), 'sw.js', 'tests/harness.html']);

// The path a request asks for (the page itself for "/"), or null if it can't be read.
function siteRel(url) {
  try { return decodeURIComponent(String(url).split('?')[0]).replace(/^\/+/, '') || 'index.html'; } catch (e) { return null; }
}
// The file a request asks for, or null if it isn't one of the site's files.
function siteFile(url) {
  const rel = siteRel(url);
  if (!rel || !SITE.has(rel)) return null;
  const file = path.join(root, rel);
  return fs.existsSync(file) && fs.statSync(file).isFile() ? file : null;
}

// Answers a request with the site file it asks for (as published, so the service worker's hashes match), or a 404.
function sendSiteFile(req, res) {
  const file = siteFile(req.url);
  if (!file) { res.writeHead(404); return res.end('Not found'); }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  res.end(publishedBytes(file));
}

module.exports = { root, HOST, TYPES, siteRel, siteFile, sendSiteFile, publishedBytes };
