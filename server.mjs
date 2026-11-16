/* Minimal zero-dependency static server for testing the PWA locally.
   Usage: node server.mjs [port]
   Then open http://localhost:4173 (desktop) or http://<your-lan-ip>:4173 (phone).
   Note: installability on iOS requires HTTPS (or localhost). See README.md. */

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { networkInterfaces } from 'node:os';

const root = resolve(process.cwd());
const port = Number(process.argv[2]) || 4173;

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
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host}`);
    let pathname = decodeURIComponent(url.pathname);
    if (pathname.endsWith('/')) pathname += 'index.html';

    const filePath = normalize(join(root, pathname));
    if (!filePath.startsWith(root + sep) && filePath !== root) {
      response.writeHead(403).end('Forbidden');
      return;
    }

    const info = await stat(filePath).catch(() => null);
    if (!info || !info.isFile()) {
      response.writeHead(404, { 'content-type': 'text/plain' }).end('Not found');
      return;
    }

    const body = await readFile(filePath);
    const ext = extname(filePath).toLowerCase();
    const type = filePath.endsWith('manifest.json')
      ? 'application/manifest+json; charset=utf-8'
      : MIME[ext] || 'application/octet-stream';
    response.writeHead(200, {
      'content-type': type,
      'cache-control': 'no-store',
      'service-worker-allowed': '/',
      'x-content-type-options': 'nosniff',
    });
    response.end(body);
  } catch (err) {
    console.error(err);
    response.writeHead(500).end('Server error');
  }
});

server.listen(port, '0.0.0.0', () => {
  const lan = Object.values(networkInterfaces())
    .flat()
    .filter((iface) => iface && iface.family === 'IPv4' && !iface.internal)
    .map((iface) => `http://${iface.address}:${port}`);

  console.log(`Wave Focus PWA running at http://localhost:${port}`);
  if (lan.length) console.log(`On your phone (same Wi-Fi): ${lan.join('  ')}`);
  console.log('Open DevTools → Application → Manifest / Service Workers to inspect the install.');
});
