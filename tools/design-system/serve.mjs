// Builds the design-system page from the repository and serves it on localhost (owner, 18 Oct 2026: "for now local is enough"); opens the browser.
//   npm run design-system (in desktop/)      node tools/design-system/serve.mjs [--port 4310] [--no-open]
// A plain file server over the built folder (desktop/.design-system); ES modules need http, not file://. Nothing leaves the machine.
import {execFile} from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {ROOT, build} from './build.mjs';

const TYPES = {'.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.zip': 'application/zip'};
// A file server over a built folder on 127.0.0.1; port 0 picks a free one. Resolves to the server once it listens.
export function serve(out, port = 0) {
  const server = http.createServer((request, response) => {
    const wanted = decodeURIComponent(new URL(request.url, 'http://x').pathname);
    const file = path.join(out, wanted.endsWith('/') ? `${wanted}index.html` : wanted);
    if (!file.startsWith(out) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { response.writeHead(404); response.end('Not found'); return; }
    const headers = {'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store'};
    if (file.endsWith('.zip')) headers['Content-Disposition'] = 'attachment; filename="jobadabra-design-system.zip"';
    response.writeHead(200, headers);
    fs.createReadStream(file).pipe(response);
  });
  return new Promise(resolve => server.listen(port, '127.0.0.1', () => resolve(server)));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const arg = name => { const at = process.argv.indexOf(`--${name}`); return at > 0 ? process.argv[at + 1] : undefined; };
  const out = path.join(ROOT, 'desktop/.design-system');
  const files = build({out});
  console.log(`design-system: built ${files.length} files into ${path.relative(ROOT, out)}`);
  const server = await serve(out, Number(arg('port') || 4310));
  const url = `http://127.0.0.1:${server.address().port}/`;
  console.log(`design-system: ${url}  (Ctrl+C stops it)`);
  if (!process.argv.includes('--no-open')) execFile(process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'explorer' : 'xdg-open', [url], () => {});
}
