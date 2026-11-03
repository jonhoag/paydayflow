// Tiny static server for local testing: node tests/serve.js [port]   (this computer only; site files only)
const http = require('http');
const { HOST, sendSiteFile } = require('./lib/site-files');

const port = Number(process.argv[2] || 8123);
http.createServer(sendSiteFile).listen(port, HOST, () => console.log('Serving the site on http://localhost:' + port));
