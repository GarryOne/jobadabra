// Where the persona search tapes (src/search_tape.py) are kept between runs, for the Lab Job Search's CI replay (owner, 18 Oct 2026; PR 2). A tape holds third parties' pages, so
// this public repo keeps none: each candidate's folder is packed, encrypted the way the pool's network records are (desktop/e2e/records-publish.mjs: AES key wrapped with
// desktop/e2e/net-record.pub.pem, only the owner's Keychain key and the NET_RECORD_KEY secret open it) and put on the release `search-tapes` of the PRIVATE repo jobadabra-lab
// as a new pair of assets beside the older ones; a fetch takes the newest pair of a candidate. Never --clobber: an older tape stays until the owner deletes it.
//   node tools/persona-search/tape-store.mjs publish <candidate> <tape folder>     (the Mac: gh login; the folder holds web.jsonl, ai.jsonl, bodies/, draft.json)
//   node tools/persona-search/tape-store.mjs publish-debug <candidate> <tape folder>   (a failed heal keeps its new tape on the release `search-tapes-debug`, newest 5 only; fetch-debug brings the newest of a candidate back for an offline replay)
//   node tools/persona-search/tape-store.mjs fetch <candidate> <out folder>        (CI: NET_RECORD_KEY, GH_TOKEN or NET_RECORDS_READ_TOKEN; the Mac: Keychain jobadabra.capture.key)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';

export const TAG = 'search-tapes', DEBUG_TAG = 'search-tapes-debug', DEBUG_KEEP = 5, REPO = process.env.NET_RECORDS_REPO || 'GarryOne/jobadabra-lab';
const here = path.dirname(new URL(import.meta.url).pathname), PUB = path.join(here, '..', '..', 'desktop', 'e2e', 'net-record.pub.pem');

// One tape's two assets, named by candidate and when it was published.
export const assetNames = (candidate, date = new Date()) => {
  const stamp = date.toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z';
  return {bundle: `search-tape-${candidate}-${stamp}.tgz.enc`, key: `search-tape-${candidate}-${stamp}.k.enc`};
};
// The pairs a debug release must drop to keep only its newest `keep` (a failed heal's tape, kept encrypted so its replay can be debugged on the Mac, 19 Oct 2026): the asset names to delete.
export function oldDebugAssets(names, keep = DEBUG_KEEP) {
  const pairs = {};
  for (const name of names) { const found = /^search-tape-[a-z0-9-]+-(\d{8}T\d{6}Z)\.(tgz|k)\.enc$/.exec(name); if (found) (pairs[found[1]] ||= []).push(name); }
  return Object.keys(pairs).sort().slice(0, Math.max(0, Object.keys(pairs).length - keep)).flatMap(stamp => pairs[stamp]);
}
// The newest complete pair (bundle + key) of a candidate among a release's asset names, or null. The candidate is matched exactly: "sre" never finds "sre-2".
export function newestPair(candidate, names) {
  const mine = new RegExp(`^search-tape-${candidate.replace(/[^a-z0-9-]/g, '')}-(\\d{8}T\\d{6}Z)\\.(tgz|k)\\.enc$`);
  const stamps = {};
  for (const name of names) { const found = mine.exec(name); if (found) (stamps[found[1]] ||= new Set()).add(found[2]); }
  const stamp = Object.keys(stamps).filter(one => stamps[one].has('tgz') && stamps[one].has('k')).sort().at(-1);
  return stamp ? {bundle: `search-tape-${candidate}-${stamp}.tgz.enc`, key: `search-tape-${candidate}-${stamp}.k.enc`} : null;
}

// What a replay could not find on the tape, from the tape folder's report.jsonl (src/search_tape.py writes one line per process): {ai, web} summed over the replay lines.
// An AI request the tape lacks is the change asking a question nobody recorded an answer for: the measurement is not valid, the row says so (FAILED) instead of showing thin numbers.
export function replayMisses(reportText) {
  const total = {ai: 0, web: 0, webTape: 0};
  for (const line of String(reportText || '').split('\n').filter(Boolean)) {
    let entry; try { entry = JSON.parse(line); } catch { continue; }
    if (entry.mode === 'replay') { total.ai += entry.ai_missing || 0; total.web += entry.web_missing || 0; total.webTape += entry.web_tape || 0; }
  }
  return total;
}

// The sentence that makes a replay's row "Tape stale" (or '' when the tape covers the build): any AI request the tape lacks (that step got no answer), or more than 2 % of the
// web requests (a few odd ones are noise; a changed search asks for dozens). Written for the Lab page; the numbers are shown but never judged.
export const STALE_WEB_SHARE = 0.02;
export function staleNote({ai, web, webTape}) {
  if (!ai && !(web > STALE_WEB_SHARE * (web + webTape))) return '';
  return `Tape stale (${ai} AI and ${web} web requests not recorded)`;
}

const run = (cmd, args, options = {}) => execFileSync(cmd, args, {stdio: ['ignore', 'pipe', 'inherit'], maxBuffer: 1 << 28, ...options});
const gh = (args, token) => run('gh', args, {env: {...process.env, ...(token ? {GH_TOKEN: token} : {})}});

export function publish(candidate, folder, tag = TAG) {
  if (!fs.existsSync(path.join(folder, 'web.jsonl'))) throw new Error(`${folder} is not a tape (no web.jsonl)`);
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-tape-')), {bundle, key} = assetNames(candidate);
  try {
    run('tar', ['czf', path.join(work, 'tape.tgz'), '-C', folder, '.']);
    run('openssl', ['rand', '-hex', '-out', path.join(work, 'k'), '32']);
    run('openssl', ['enc', '-aes-256-cbc', '-pbkdf2', '-salt', '-in', path.join(work, 'tape.tgz'), '-out', path.join(work, bundle), '-pass', `file:${path.join(work, 'k')}`]);
    run('openssl', ['pkeyutl', '-encrypt', '-pubin', '-inkey', PUB, '-pkeyopt', 'rsa_padding_mode:oaep', '-in', path.join(work, 'k'), '-out', path.join(work, key)]);
    const title = tag === DEBUG_TAG ? 'Persona search tapes of failed heals (encrypted, newest 5)' : 'Persona search tapes (encrypted)';
    try { gh(['release', 'view', tag, '-R', REPO]); } catch { gh(['release', 'create', tag, '-R', REPO, '--prerelease', '--title', title, '--notes', 'Encrypted tapes for the Lab Job Search replay (tools/persona-search/tape-store.mjs). Not an app build.']); }
    gh(['release', 'upload', tag, '-R', REPO, path.join(work, bundle)]);
    gh(['release', 'upload', tag, '-R', REPO, path.join(work, key)]);   // the key last: a bundle without its key is ignored by newestPair
    console.log(`tape-store: ${candidate} published as ${bundle}${tag === DEBUG_TAG ? ` on ${tag}` : ''}`);
    if (tag === DEBUG_TAG) {   // only the newest few stay: a tape is tens of megabytes
      const names = JSON.parse(gh(['release', 'view', tag, '-R', REPO, '--json', 'assets']).toString()).assets.map(asset => asset.name);
      for (const old of oldDebugAssets(names)) gh(['release', 'delete-asset', tag, old, '-R', REPO, '--yes']);
    }
  } finally { fs.rmSync(work, {recursive: true, force: true}); }
}

export function fetch(candidate, out, tag = TAG) {
  const token = process.env.NET_RECORDS_READ_TOKEN || '';
  const names = JSON.parse(gh(['release', 'view', tag, '-R', REPO, '--json', 'assets'], token).toString()).assets.map(asset => asset.name);
  const pair = newestPair(candidate, names);
  if (!pair) throw new Error(`no tape for ${candidate} on ${REPO} release ${tag}`);
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-tape-'));
  try {
    gh(['release', 'download', tag, '-R', REPO, '--pattern', pair.bundle, '--pattern', pair.key, '--dir', work], token);
    const pem = path.join(work, 'key.pem');
    const secret = process.env.NET_RECORD_KEY || (process.platform === 'darwin' ? run('security', ['find-generic-password', '-s', 'jobadabra.capture.key', '-w']).toString().trim() : '');
    if (!secret) throw new Error('no NET_RECORD_KEY');
    fs.writeFileSync(pem, Buffer.from(secret, 'base64'), {mode: 0o600});
    run('openssl', ['pkeyutl', '-decrypt', '-inkey', pem, '-pkeyopt', 'rsa_padding_mode:oaep', '-in', path.join(work, pair.key), '-out', path.join(work, 'k')]);
    fs.mkdirSync(out, {recursive: true});
    run('bash', ['-c', `openssl enc -d -aes-256-cbc -pbkdf2 -in "${path.join(work, pair.bundle)}" -pass "file:${path.join(work, 'k')}" | tar xz -C "${out}"`]);
    console.log(`tape-store: ${candidate} = ${pair.bundle} in ${out}`);
  } finally { fs.rmSync(work, {recursive: true, force: true}); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  const [action, candidate, folder] = process.argv.slice(2);
  if (!['publish', 'fetch', 'publish-debug', 'fetch-debug'].includes(action) || !/^[a-z0-9-]{1,40}$/.test(candidate || '') || !folder) { console.error('usage: node tools/persona-search/tape-store.mjs publish|fetch|publish-debug|fetch-debug <candidate> <folder>'); process.exit(2); }
  (action.startsWith('publish') ? publish : fetch)(candidate, path.resolve(folder), action.endsWith('-debug') ? DEBUG_TAG : TAG);
}
