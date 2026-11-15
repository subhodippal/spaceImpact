#!/usr/bin/env node
// Mono Strike local server: static files, no dependencies.
// Listens on all network interfaces so phones on the same Wi-Fi can play.
//
//   node server.js              -> port 8080 (or the next free one)
//   node server.js -p 8005      (also: --port 8005, --port=8005)
//   PORT=8005 node server.js

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const ROOT = __dirname;
// Port: -p 8005 | --port 8005 | --port=8005 | -p=8005 | PORT=8005 env | default 8080
function parsePort(argv) {
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-p' || a === '--port') return argv[i + 1];
    const m = a.match(/^(?:-p|--port)=(.+)$/);
    if (m) return m[1];
    if (a === '-h' || a === '--help') {
      console.log('Usage: node server.js [-p PORT]\n  -p, --port PORT   port to listen on (default 8080, or $PORT)\n  HOST=127.0.0.1    env var to restrict to this computer only');
      process.exit(0);
    }
  }
  return process.env.PORT;
}
const rawPort = parsePort(process.argv.slice(2));
const START_PORT = rawPort === undefined ? 8080 : Number(rawPort);
if (!Number.isInteger(START_PORT) || START_PORT < 1 || START_PORT > 65535) {
  console.error(`Invalid port "${rawPort}". Use a number between 1 and 65535, e.g. node server.js -p 8005`);
  process.exit(1);
}
const HOST = process.env.HOST || '0.0.0.0';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/plain; charset=utf-8'
};

// Files that should never be served to the browser.
const BLOCKED = new Set(['server.js', 'package.json', 'package-lock.json']);

function send(res, status, body, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', ...headers });
  res.end(body);
}

const server = http.createServer((req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method Not Allowed');

  let urlPath;
  try { urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname); }
  catch { return send(res, 400, 'Bad Request'); }

  let file = path.normalize(path.join(ROOT, urlPath));
  // Block path traversal and hidden files.
  if (!file.startsWith(ROOT) || path.relative(ROOT, file).split(path.sep).some((p) => p.startsWith('.'))) {
    return send(res, 403, 'Forbidden');
  }
  if (BLOCKED.has(path.relative(ROOT, file))) return send(res, 404, 'Not Found');

  fs.stat(file, (err, st) => {
    if (!err && st.isDirectory()) { file = path.join(file, 'index.html'); }
    fs.stat(file, (err2, st2) => {
      if (err2 || !st2.isFile()) return send(res, 404, 'Not Found');
      const ext = path.extname(file).toLowerCase();
      const headers = {
        'Content-Type': MIME[ext] || 'application/octet-stream',
        'Content-Length': st2.size,
        // Always fresh during local development; the service worker handles offline caching.
        'Cache-Control': 'no-cache'
      };
      if (path.basename(file) === 'sw.js') headers['Service-Worker-Allowed'] = './';
      res.writeHead(200, headers);
      if (req.method === 'HEAD') return res.end();
      fs.createReadStream(file).pipe(res);
      log(req, 200);
    });
  });
});

function log(req, status) {
  if (process.env.QUIET) return;
  const t = new Date().toTimeString().slice(0, 8);
  console.log(`${t}  ${status}  ${req.socket.remoteAddress?.replace('::ffff:', '')}  ${req.url}`);
}

function lanAddresses() {
  const out = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    for (const a of list || []) {
      if (a.family === 'IPv4' && !a.internal) out.push({ name, address: a.address });
    }
  }
  return out;
}

function listen(port, attemptsLeft = 10) {
  const onError = (err) => {
    server.removeListener('listening', onListening);
    if (err.code === 'EADDRINUSE' && attemptsLeft > 0 && port < 65535) {
      console.log(`Port ${port} is busy, trying ${port + 1}…`);
      listen(port + 1, attemptsLeft - 1);
    } else if (err.code === 'EADDRINUSE') {
      console.error(`Ports up to ${port} are busy. Pick another one, e.g. node server.js -p 9000`);
      process.exit(1);
    } else if (err.code === 'EACCES') {
      console.error(`No permission to use port ${port} (ports below 1024 need admin rights). Try node server.js -p 8005`);
      process.exit(1);
    } else {
      console.error(err.message);
      process.exit(1);
    }
  };
  const onListening = () => {
    server.removeListener('error', onError);
    const lan = lanAddresses();
    console.log('\n  MONO STRIKE is running\n');
    console.log(`  On this computer:  http://localhost:${port}`);
    if (HOST === '0.0.0.0' && lan.length) {
      console.log('  On your phone (same Wi-Fi):');
      for (const { name, address } of lan) console.log(`                     http://${address}:${port}   (${name})`);
    } else if (HOST === '0.0.0.0') {
      console.log('  No network interface found: connect to Wi-Fi to play from a phone.');
    }
    console.log('\n  Note: install/offline (PWA) needs HTTPS or localhost; the LAN address');
    console.log('  plays fine but the browser will not offer "Install". See README.\n');
    console.log('  Press Ctrl+C to stop.\n');
  };
  server.once('error', onError);
  server.once('listening', onListening);
  server.listen(port, HOST);
}

listen(START_PORT);
