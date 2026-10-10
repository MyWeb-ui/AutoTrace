#!/usr/bin/env node
/* Server lokal tanpa dependensi: file statis + /api/trace (handler yang sama dengan Vercel).
   Jalankan: node dev-server.js [port]   lalu buka http://localhost:3000 */
'use strict';
const http = require('http'), fs = require('fs'), path = require('path');
const handler = require('./api/trace.js');
const ROOT = __dirname, PORT = +process.argv[2] || +process.env.PORT || 3000;
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.xml': 'application/xml', '.ico': 'image/x-icon' };

http.createServer((req, res) => {
  const u = new URL(req.url, 'http://localhost');
  if (u.pathname === '/api/trace') return handler(req, res);
  let f = path.normalize(path.join(ROOT, decodeURIComponent(u.pathname === '/' ? '/index.html' : u.pathname)));
  if (!f.startsWith(ROOT + path.sep) || /(^|[\\/])(\.|node_modules|tests|tools)/.test(path.relative(ROOT, f))) { res.statusCode = 403; return res.end('Forbidden'); }
  fs.readFile(f, (err, buf) => {
    if (err) { res.statusCode = 404; return res.end('Not found'); }
    res.setHeader('Content-Type', TYPES[path.extname(f)] || 'application/octet-stream');
    res.setHeader('Cache-Control', 'no-store');
    res.end(buf);
  });
}).listen(PORT, () => console.log('Auto Trace jalan di http://localhost:' + PORT));
