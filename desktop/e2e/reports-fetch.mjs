// Fetches the "Report this form" reports waiting on the site, decrypts them on THIS Mac (the Worker cannot read them: only the owner's private key opens them), and writes each as a pool record
// the offline loop already reads (<records dir>/reported-<id>-<site>/record.json + bodies/<hash>, source "person"), then marks it fetched. By hand, on the owner's say, never a schedule. Next:
// `node records-publish.mjs <records dir>` adds them to the private release so the PR replay and /admin/form-filling/lab see them (spec docs/superpowers/specs/2026-10-15-report-this-form.md §5).
//   node reports-fetch.mjs <records dir> [--dry]
// Keys (Keychain, never printed): job-pilotto.site.api_key (the scripts' key for the site), job-pilotto.capture.key (the private key; PEM, or base64 of it as in the NET_RECORD_KEY secret).
// Env overrides for tests: JP_SITE, JP_ADMIN_KEY, JP_PRIVATE_KEY. Guard: test/reports-fetch.test.mjs.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import {execFileSync} from 'node:child_process';

const SITE = process.env.JP_SITE || 'https://www.jobpilotto.top';
const keychain = service => { try { return execFileSync('security', ['find-generic-password', '-a', 'job-pilotto', '-s', service, '-w'], {encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore']}).trim(); } catch { return ''; } };
const pemOf = value => (value.includes('BEGIN') ? value : Buffer.from(value, 'base64').toString('utf8'));

// iv(12) + tag(16) + ciphertext, the AES key wrapped (RSA-OAEP, SHA-256) -> {record, bodies: {hash: base64}} (the format of desktop/lib/report-upload.js)
export function decryptBundle(body, wrapped, privatePem) {
  const key = crypto.privateDecrypt({key: privatePem, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256'}, Buffer.from(wrapped, 'base64'));
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, body.subarray(0, 12));
  decipher.setAuthTag(body.subarray(12, 28));
  return JSON.parse(zlib.gunzipSync(Buffer.concat([decipher.update(body.subarray(28)), decipher.final()])));
}

// A trace that crossed a sign-in page has segments (`seg`, a gap between them: the sign-in page itself is never recorded). The replay starts at the first page after the last gap, so no account is ever
// needed: `entries` is that last segment, `earlier` keeps the pages before it for whoever fixes the step (spec docs/superpowers/specs/2026-10-16-report-from-the-trace.md §6). -> the record
export function segmented(record) {
  const last = Math.max(0, ...(record.entries || []).map(entry => entry.seg || 0));
  if (!last) return {...record, entries: (record.entries || []).map(({seg, ...entry}) => entry)};
  const strip = ({seg, ...entry}) => entry, mine = (record.entries || []).filter(entry => (entry.seg || 0) === last);
  return {...record, entries: mine.map(strip), earlier: record.entries.filter(entry => (entry.seg || 0) !== last).map(strip)};
}

// One bundle as a pool record folder. -> the folder
export function writeRecord(dir, {record: whole, bodies}) {
  const record = segmented(whole);
  const safe = String(record.name).replace(/[^\w.-]+/g, '-').slice(0, 80), into = path.join(dir, safe);
  fs.mkdirSync(path.join(into, 'bodies'), {recursive: true});
  for (const [hash, base64] of Object.entries(bodies || {})) if (/^[0-9a-f]{64}$/.test(hash)) fs.writeFileSync(path.join(into, 'bodies', hash), Buffer.from(base64, 'base64'));
  fs.writeFileSync(path.join(into, 'record.json'), JSON.stringify(record));
  return into;
}

export async function fetchReports({dir, dry = false, fetcher = fetch, site = SITE, adminKey, privatePem, say = console.log}) {
  const auth = {Authorization: `Bearer ${adminKey}`};
  const list = await (await fetcher(`${site}/api/report-form`, {headers: auth})).json();
  if (!list.ok) throw new Error(`the site refused the list: ${list.error || 'no reason'}`);
  const done = [];
  for (const report of list.reports) {
    if (dry) { say(`reports-fetch: would fetch ${report.id} (${report.requests} requests, ${report.bytes} bytes)`); continue; }
    const response = await fetcher(`${site}/api/report-form/${report.id}`, {headers: auth});
    if (!response.ok) { say(`reports-fetch: ${report.id}: ${response.status}, skipped`); continue; }
    let bundle;
    try { bundle = decryptBundle(Buffer.from(await response.arrayBuffer()), response.headers.get('X-Report-Key') || '', privatePem); } catch { say(`reports-fetch: ${report.id}: could not be opened with this key, skipped`); continue; }
    const into = writeRecord(dir, bundle);
    await fetcher(`${site}/api/report-form/${report.id}?status=fetched`, {method: 'POST', headers: auth});
    say(`reports-fetch: ${report.id} -> ${path.basename(into)}`);
    done.push(into);
  }
  say(`reports-fetch: ${done.length} of ${list.reports.length} report(s) written to ${dir}`);
  return done;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  const [dir] = process.argv.slice(2).filter(arg => !arg.startsWith('--'));
  if (!dir) { console.error('usage: node reports-fetch.mjs <records dir> [--dry]'); process.exit(2); }
  const adminKey = process.env.JP_ADMIN_KEY || keychain('job-pilotto.site.api_key'), privateKey = process.env.JP_PRIVATE_KEY || keychain('job-pilotto.capture.key');
  if (!adminKey || !privateKey) { console.error('reports-fetch: the Keychain items job-pilotto.site.api_key and job-pilotto.capture.key are needed'); process.exit(2); }
  await fetchReports({dir, dry: process.argv.includes('--dry'), adminKey, privatePem: pemOf(privateKey)});
}
