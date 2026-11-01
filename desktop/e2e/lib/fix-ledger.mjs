// The fix ledger of /admin/form-filling/lab's Fixed tab (site/src/applying-fixed.js): which pool row each landed fix is for, built from git (commit trailers "Pool-row:", "Rung:",
// "Fixture:" and the recorded cases a commit adds) plus desktop/e2e/pool-fixes.json for fixes that landed before the trailer. Also the claims held now (tools/claim-shape.mjs list).
// Computed, never typed: the status (landed, confirmed, back) is worked out on the site from the smoke runs. Only a site name, a short hash, a version, a rung and ids leave the Mac.
// Run: node desktop/e2e/lib/fix-ledger.mjs [--upload]   (the nightly smoke does the upload after its pool upload). Guard: e2e/test/fix-ledger.test.mjs.
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {list as listClaims} from '../../../tools/claim-shape.mjs';
import {poolRowNames, rowFor} from '../../../tools/pool-rows.mjs';
import {upload} from './applying-report.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
export const FIXES_FILE = path.join(ROOT, 'desktop', 'e2e', 'pool-fixes.json');
const LOCKS = new Set(['e2e-page', 'flow-core']);   // fixed-name locks of tools/claim-shape.mjs, not pool rows
export const POOL_ROW = /^Pool-row:[ \t]*(.*)$/gm;
const line = (message, key) => [...String(message).matchAll(new RegExp(`^${key}:[ \\t]*(.*)$`, 'gm'))].map(found => found[1].trim());
// The site name as the page shows it: never an address, a query string or a path.
export const cleanRow = value => { const name = String(value || '').trim(); return name && name.length <= 120 && !/[?=@]|:\/\/|https?:/i.test(name) ? name : ''; };

const defaultGit = (...args) => execFileSync('git', ['-C', ROOT, ...args], {encoding: 'utf8', maxBuffer: 64 << 20});
// A commit's facts never change, so each is read from git once per Mac (14 Oct 2026: 5 git calls per commit, one a ~1 s rev-list, made the smoke run look hung
// for minutes after its report). Keyed by the full hash; a missing or broken file only costs the git calls again.
const MEMO_FILE = path.join(os.tmpdir(), 'job-pilotto-fix-ledger-memo.json');
const readMemo = () => { try { return JSON.parse(fs.readFileSync(MEMO_FILE, 'utf8')); } catch { return {}; } };
const saveMemo = memo => { try { fs.writeFileSync(MEMO_FILE, JSON.stringify(memo)); } catch { /* best effort */ } };

// -> [{site, commit, extensionVersion, rung, landedAt, guard: ['recorded:<case>', 'fixture:<id>']}], newest last. git: (...args) => stdout, injectable for tests.
// pool: {names} of tools/pool-rows.mjs: a trailer that holds a row's capture-folder slug (e5e68c7) is sent as that row's name, so the Fixed tab has one row per site.
// memo: hash -> {message, when, version, cases}, kept in MEMO_FILE when git is the real one (tests pass their own git and get a fresh memo).
export function buildLedger({git = defaultGit, fixes = JSON.parse(fs.readFileSync(FIXES_FILE, 'utf8')).fixes, pool = poolRowNames(), memo = git === defaultGit ? readMemo() : {}} = {}) {
  const found = new Map();   // full hash -> site names
  for (const item of fixes) {
    let hash; try { hash = git('rev-parse', '--verify', '--quiet', `${item.commit}^{commit}`).trim(); } catch { hash = ''; }
    if (hash && cleanRow(item.site)) found.set(hash, [...new Set([...(found.get(hash) || []), cleanRow(item.site)])]);
  }
  for (const entry of git('log', '--format=%H%x00%B%x01', '--grep=^Pool-row:', '-E').split('\x01').map(text => text.trim()).filter(Boolean)) {
    const [hash, body] = entry.split('\0');
    const rows = line(body, 'Pool-row').map(cleanRow).filter(value => value && !/^none\b/i.test(value)).map(value => rowFor(value, pool.names) || value);   // "none <why>": not a fix
    if (rows.length) found.set(hash, [...new Set([...(found.get(hash) || []), ...rows])]);
  }
  const ledger = [];
  for (const [hash, sites] of found) {
    memo[hash] ||= facts(git, hash);
    const {message, when, version, cases} = memo[hash];
    const guard = [...new Set([...cases.map(name => `recorded:${name}`), ...line(message, 'Fixture').flatMap(value => (/^none\b/i.test(value) ? [] : value.split(/\s*,\s*/).filter(id => /^[a-z0-9][a-z0-9-]{0,79}$/i.test(id)).map(id => `fixture:${id}`)))])];
    const subject = cleanRow(message.split('\n')[0]) ? message.split('\n')[0].trim().slice(0, 120) : '';   // the PR's own build is matched to this fix by subject and row (the Fixed tab's matching of a PR's build to a fix)
    for (const site of sites) ledger.push({site, commit: hash.slice(0, 7), subject, extensionVersion: version, rung: line(message, 'Rung')[0] || '', landedAt: when, guard});
  }
  if (git === defaultGit) saveMemo(memo);
  return ledger.sort((a, b) => Date.parse(a.landedAt) - Date.parse(b.landedAt));
}

// One commit's facts from git: its message, date, the extension version its build stamped, the recorded cases it added.
function facts(git, hash) {
  const message = git('log', '-1', '--format=%B', hash), when = git('log', '-1', '--format=%cI', hash).trim();
  let version = ''; try { version = JSON.parse(git('show', `${hash}:extension/manifest.json`)).version || ''; } catch { /* a commit before the manifest */ }
  // Since 13 Oct 2026 the manifest holds the base ("0.9") and the build stamps the rest (desktop/scripts/extension-stamp.mjs): the same stamp here.
  if (/^\d+\.\d+$/.test(version)) { try { version = `${version}.${Number(git('rev-list', '--count', hash, '--', 'extension'))}`; } catch { /* the base alone */ } }
  const cases = git('show', '--name-only', '--diff-filter=A', '--format=', hash).split('\n').map(file => file.match(/^desktop\/e2e\/recorded\/([^/]+)\//)?.[1]).filter(Boolean);
  return {message, when, version, cases};
}

// The claims held now: names and since only (the session that holds one stays on the Mac).
export const claimRows = (held = listClaims()) => held.filter(item => !LOCKS.has(item.name) && !String(item.name).startsWith('flow-core') && cleanRow(item.name)).map(item => ({name: cleanRow(item.name), since: new Date(item.at).toISOString()}));

// -> one outcome line per upload. Never throws, so a smoke run never fails on it.
export async function uploadLedger(options = {}) {
  try {
    return [await upload('fixes', options.ledger || buildLedger(), options), await upload('claims', options.claims || claimRows(), options)].join('\n');
  } catch (error) { return `fix ledger: not sent (${String(error?.message || error).slice(0, 80)})`; }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--upload')) console.log(await uploadLedger());
  else console.log(JSON.stringify({fixes: buildLedger(), claims: claimRows()}, null, 1));
}
