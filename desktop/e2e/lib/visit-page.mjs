// The "read the jobs on this page" rig shared by the visitread e2e step and test/visit-read: the extension's page functions as a page runs them, a fixture server, a Chromium.
// Job: run the backbone
// Reaches: ../fixtures/visits/ ../../../extension/visit.js ../../../extension/visit-page.js
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import {chromium} from 'playwright-core';
// Why (c27, 1 Nov 2026, area folders): tests under desktop/integration cannot resolve this folder's own playwright-core, so they take chromium from here.
export {chromium};

export const repo = path.resolve(import.meta.dirname, '..', '..', '..');
export const fixtures = path.join(import.meta.dirname, '..', 'fixtures', 'visits');
// The page functions as the extension injects them: their own source, nothing re-written for the test (split over two files since 25ed270).
const source = ['visit.js', 'visit-page.js'].map(file => fs.readFileSync(path.join(repo, 'extension', file), 'utf8')).join('\n');
/** The source of one exported page function of extension/visit.js or visit-page.js, as plain `function name(...)`. @param {string} name @returns {string} */
export const fn = name => { const match = new RegExp(`export (?:async )?function ${name}\\([^)]*\\) \\{[\\s\\S]*?\\n\\}\\n`).exec(source); if (!match) throw new Error(`${name} not found in extension/visit.js or visit-page.js`); return match[0].replace('export ', ''); };
/** The source of one page function as an anonymous `function (...)`, to wrap as `(source)(args)` and run in a page; throws when the function is not in visit.js or visit-page.js. @param {string} name @returns {string} */
export const anonymous = name => fn(name).replace(`function ${name}`, 'function');
/** Run a page function inside the page and return what it answered. */
export const call = (page, name) => page.evaluate(`(${anonymous(name)})()`);
/** Run a page function with one JSON argument inside the page. */
export const callWith = (page, name, argument) => page.evaluate(`(${anonymous(name)})(${JSON.stringify(argument)})`);

/** Serve fixtures/visits on a free local port. @returns {Promise<{server: import('node:http').Server, base: string}>} */
export async function serveFixtures() {
  const server = http.createServer((req, res) => {
    const file = path.join(fixtures, path.basename(req.url.split('?')[0]) || 'list-1.html');
    if (!fs.existsSync(file)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, {'Content-Type': 'text/html; charset=utf-8'});
    res.end(fs.readFileSync(file));
  });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  return {server, base: `http://127.0.0.1:${server.address().port}`};
}

/** The full Chromium in its new headless mode, as the extension suites run it: CI installs that one, not the separate headless shell. */
export const launchChromium = () => chromium.launch({headless: false, args: [...(process.env.E2E_HEADED ? [] : ['--headless=new'])]});
