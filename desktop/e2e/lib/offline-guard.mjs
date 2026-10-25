// The e2e env of an app server under test, and a guard that keeps it on this computer (speed-5x landing 1, owner 11 Oct 2026: a prototype of the app's own server
// under plain node reached the live site for the alias pack). offlineEnv: the journey's env (no telemetry, no pool sharing: lib/telemetry.js reads JOB_PILOTTO_E2E),
// its own data folder, no Anthropic key (a Mac uses the plan path), never the twin. guardNetwork: fetch, http and https refuse any host but loopback, and name it.
// The AI is the one exception by design: `claude -p` is its own process (the plan path), not this process's network. Guard: e2e/test/offline-guard.test.mjs.
import http from 'node:http';
import https from 'node:https';
import path from 'node:path';
import {ownerGuardEnv} from './owner-guard-env.mjs';
import {everyRealDataFolder} from '../../lib/app-identity.js';
import {withoutWrappers} from './real-claude.mjs';   // never a terminal's claude wrapper (e2e/test/real-claude.test.mjs)

const REALS = everyRealDataFolder();
const DROPPED = ['REPLAY_REFILL_ANTHROPIC_KEY', 'ANTHROPIC_API_KEY', 'ANTHROPIC_BASE_URL', 'OPENAI_API_KEY', 'JOB_PILOTTO_TWIN', 'JOB_PILOTTO_PORT'];

export function offlineEnv(dir, parent = process.env) {
  if (REALS.some(real => (path.resolve(dir) + path.sep).startsWith(path.resolve(real) + path.sep))) throw new Error(`refusing the app's real folder for a test app: ${dir}`);
  const env = Object.fromEntries(Object.entries(parent).filter(([name]) => !DROPPED.includes(name)));
  return withoutWrappers({...env, JOB_PILOTTO_E2E: '1', ...ownerGuardEnv(), JOB_PILOTTO_USER_DATA: dir, JOB_PILOTTO_NO_DOTENV: '1'});
}

const LOOPBACK = /^(127\.\d+\.\d+\.\d+|localhost|::1|\[::1\])$/i;
const hostOf = target => {
  if (typeof target === 'string' || target instanceof URL) { try { return new URL(String(target)).hostname; } catch { return ''; } }
  if (target && typeof target === 'object') return String(target.hostname || target.host || target.url || '').replace(/:\d+$/, '').replace(/^https?:\/\/([^/:]+).*$/, '$1');
  return '';
};

// -> {refused: [host], restore()}. Patches this process only.
export function guardNetwork() {
  const refused = [], saved = {fetch: globalThis.fetch, httpRequest: http.request, httpGet: http.get, httpsRequest: https.request, httpsGet: https.get};
  const check = target => {
    const host = hostOf(target?.url && typeof target.url === 'string' ? target.url : target);
    if (host && LOOPBACK.test(host)) return;
    refused.push(host || '(unknown host)');
    throw new Error(`offline: ${host || '(unknown host)'} is outside this computer (a test app must not reach the network)`);
  };
  globalThis.fetch = async function offlineFetch(input, init) { check(input); return saved.fetch(input, init); };
  http.request = (target, ...rest) => { check(target); return saved.httpRequest(target, ...rest); };
  http.get = (target, ...rest) => { check(target); return saved.httpGet(target, ...rest); };
  https.request = (target, ...rest) => { check(target); return saved.httpsRequest(target, ...rest); };
  https.get = (target, ...rest) => { check(target); return saved.httpsGet(target, ...rest); };
  return {refused, restore() { globalThis.fetch = saved.fetch; http.request = saved.httpRequest; http.get = saved.httpGet; https.request = saved.httpsRequest; https.get = saved.httpsGet; }};
}
