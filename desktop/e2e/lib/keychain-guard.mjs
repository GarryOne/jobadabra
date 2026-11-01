// The owner's real Keychain is never touched by a test run (owner, 8-9 Oct 2026: a local run changed the shared job-site password and left fixture-host
// items; desktop/lib/keychain.js now keeps test runs in their own file). This is the run's own proof: the Jobadabra items' attributes (service name and
// modification date, never a secret) before the suite and after it; any item added, removed or modified fails the run. A Mac outside CI only (CI has none).
// Guard: test/keychain-guard.test.mjs.
import {execFileSync} from 'node:child_process';

// `security dump-keychain` text (attributes only, no -d) -> Map service -> modification date, for the job-pilotto.* items.
export function parseItems(text) {
  const items = new Map();
  for (const block of String(text || '').split(/^keychain: /m)) {
    const service = /"svce"<blob>="(job-pilotto\.[^"]*)"/.exec(block)?.[1];
    if (!service) continue;
    const modified = /"mdat"<timedate>=0x[0-9A-F]+\s+"(\d{14}Z)/.exec(block)?.[1] || '';
    items.set(service, modified);
  }
  return items;
}

// What changed between two snapshots, as lines a person can act on (names and dates only).
export function keychainChanges(before, after) {
  const changes = [];
  for (const [service, modified] of after) {
    if (!before.has(service)) changes.push(`${service}: added (${modified})`);
    else if (before.get(service) !== modified) changes.push(`${service}: modified (${before.get(service)} -> ${modified})`);
  }
  for (const service of before.keys()) if (!after.has(service)) changes.push(`${service}: removed`);
  return changes;
}

export const guarded = (env = process.env, platform = process.platform) => platform === 'darwin' && !env.CI && !env.GITHUB_ACTIONS;
export function snapshot({env = process.env, platform = process.platform, exec = execFileSync} = {}) {
  if (!guarded(env, platform)) return null;
  try { return parseItems(exec('security', ['dump-keychain'], {encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024})); } catch { return null; }
}
