// A saved local copy of /admin/form-filling/lab's ?json for the session tools (needs-fix-causes, needs-fix-order): fetched at most every 15 minutes, `--refresh` forces a fetch
// (every live fetch costs the site's D1 budget, 11 Oct 2026). The owner key comes from the Keychain (job-pilotto.site.api_key), never printed. Guard: test/needs-fix-causes.test.js.
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const SITE = 'https://www.jobpilotto.top/admin/form-filling/lab?json';
export const MAX_AGE_MS = 15 * 60000;
export const COPY = path.join(os.tmpdir(), 'job-pilotto-applying-page.json');

// -> the page's data: the saved copy when it is younger than maxAge (and refresh is false), else a fresh GET saved to the copy. fetchLive and file are injectable for tests.
export function pageJson({caller = 'page-copy', refresh = false, maxAge = MAX_AGE_MS, file = COPY, now = Date.now(), fetchLive = () => liveJson(caller)} = {}) {
  try {
    if (!refresh && now - fs.statSync(file).mtimeMs < maxAge) return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch { /* no usable copy: fetch */ }
  const json = fetchLive();
  try { fs.writeFileSync(file, JSON.stringify(json)); } catch { /* the copy is a convenience */ }
  return json;
}

function liveJson(caller) {   // X-Caller names this tool in the Worker's logs (workers/www/d1-meter.js)
  const key = execFileSync('security', ['find-generic-password', '-s', 'job-pilotto.site.api_key', '-w'], {encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore']}).trim();   // never printed
  return JSON.parse(execFileSync('curl', ['-s', '--fail', '--max-time', '30', '-H', `Authorization: Bearer ${key}`, '-H', `X-Caller: ${caller}`, SITE], {encoding: 'utf8', maxBuffer: 64 << 20}));
}
