// Publishes the extension to the Chrome Web Store when a release turns stable: reads the store's versions, uploads the store zip only when ours is newer, submits it for review.
// Usage (CI, extension-store-publish.yml): CWS_TOKEN=<access token> CWS_PUBLISHER_ID=… CWS_ITEM_ID=… node tools/webstore-publish.mjs check|publish
//   check    reads the store and says what a publish would do; changes nothing (the PR and by-hand runs).
//   publish  builds the store zip (tools/store-zip.mjs), uploads it, waits for the store to read it, submits it (DEFAULT_PUBLISH: live once review passes).
// API: Chrome Web Store API v2 (chromewebstore.googleapis.com). The token comes from GitHub OIDC → Google (no stored key) and is never printed.
// Guard: desktop/test/webstore-publish.test.js.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

export const API = 'https://chromewebstore.googleapis.com';
const IN_REVIEW = new Set(['PENDING_REVIEW', 'STAGED']);

// True when version a is above b, compared part by part as numbers ("0.9.625" > "0.9.99").
export function newer(a, b) {
  const x = String(a).split('.').map(Number), y = String(b).split('.').map(Number);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0);
  }
  return false;
}

const versionsOf = revision => (revision?.distributionChannels || []).map(c => c.crxVersion).filter(Boolean);
const highest = list => list.reduce((top, v) => (!top || newer(v, top) ? v : top), '');

// What the store holds, in one line's worth of facts. Pure.
export function storeState(status) {
  const submitted = status?.submittedItemRevisionStatus;
  return {published: highest(versionsOf(status?.publishedItemRevisionStatus)), submitted: highest(versionsOf(submitted)),
    submittedState: submitted?.state || '', takenDown: Boolean(status?.takenDown)};
}

// publish | skip (the store has it or newer) | wait (another version is in review: the next stable carries ours) | stop (needs a person). Pure.
export function decide(status, ours) {
  const s = storeState(status);
  if (s.takenDown) return {action: 'stop', why: 'the item is taken down in the Chrome Web Store: open the developer dashboard'};
  if (s.published && !newer(ours, s.published)) return {action: 'skip', why: `the store already has ${s.published}`};
  if (s.submitted && !newer(ours, s.submitted)) {
    if (s.submittedState === 'REJECTED') return {action: 'stop', why: `the store rejected ${s.submitted}: read the reason in the developer dashboard; a newer version can go then`};
    if (s.submittedState !== 'CANCELLED') return {action: 'skip', why: `${s.submitted} is already submitted (${s.submittedState})`};
  }
  if (s.submitted && IN_REVIEW.has(s.submittedState)) return {action: 'wait', why: `${s.submitted} is in review (${s.submittedState}); ${ours} goes with the next stable release once it is done`};
  return {action: 'publish', why: `${ours} is newer than the store's ${s.published || 'nothing'}`};
}

async function call(fetch, url, {token, method = 'GET', body, type = 'application/json'}) {
  const res = await fetch(url, {method, headers: {Authorization: `Bearer ${token}`, ...(body ? {'Content-Type': type} : {})}, body});
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Chrome Web Store ${method} ${url.replace(API, '')}: HTTP ${res.status}: ${json?.error?.message || 'no message'}`);
  return json;
}

const itemPath = ({publisher, item}) => `publishers/${publisher}/items/${item}`;
const fetchStatus = opts => call(opts.fetch, `${API}/v2/${itemPath(opts)}:fetchStatus`, opts);
const summary = (s, ours) => `store: published ${s.published || 'none'}${s.submitted ? `, submitted ${s.submitted} (${s.submittedState})` : ''}${s.takenDown ? ', TAKEN DOWN' : ''}; ours ${ours}`;

// Reads the store and says what a publish would do. Changes nothing.
export async function check({publisher, item, token, version, fetch = globalThis.fetch, log = console.log}) {
  const status = await fetchStatus({publisher, item, token, fetch});
  const verdict = decide(status, version);
  log(`${summary(storeState(status), version)} → would ${verdict.action}: ${verdict.why}`);
  return verdict;
}

// Uploads the zip and submits it, when decide() says so. pause(ms) is injectable for tests.
export async function publish({publisher, item, token, version, zip, fetch = globalThis.fetch, log = console.log,
  pause = ms => new Promise(resolve => setTimeout(resolve, ms))}) {
  const opts = {publisher, item, token, fetch};
  const verdict = decide(await fetchStatus(opts), version);
  log(`${verdict.action}: ${verdict.why}`);
  if (verdict.action === 'stop') throw new Error(verdict.why);
  if (verdict.action !== 'publish') return verdict;

  const uploaded = await call(fetch, `${API}/upload/v2/${itemPath(opts)}:upload`, {token, method: 'POST', body: zip, type: 'application/zip'});
  let state = uploaded.uploadState || '';
  for (let i = 0; /IN_PROGRESS$/.test(state) && i < 30; i++) {   // the store reads the zip in the background: up to ~5 minutes
    await pause(10_000);
    state = (await fetchStatus(opts)).lastAsyncUploadState || '';
  }
  if (state !== 'SUCCEEDED') throw new Error(`upload ${state || 'gave no state'}: the store did not take ${version} (look at the developer dashboard's Package tab)`);
  log(`uploaded ${version}`);

  const submitted = await call(fetch, `${API}/v2/${itemPath(opts)}:publish`, {token, method: 'POST', body: JSON.stringify({})});
  log(`submitted ${version}: ${submitted.state || 'no state'}${submitted.state === 'PENDING_REVIEW' ? ' (in review; Chrome updates every copy by itself once it is live)' : ''}`);
  for (const warning of submitted.warningInfo?.warnings || []) log(`store warning: ${warning.reason}: ${warning.description}`);
  return {...verdict, state: submitted.state};
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const mode = process.argv[2];
  const env = name => process.env[name] || (console.error(`${name} is not set`), process.exit(2));
  if (!['check', 'publish'].includes(mode)) { console.error('usage: node tools/webstore-publish.mjs check|publish'); process.exit(2); }
  const base = {publisher: env('CWS_PUBLISHER_ID'), item: env('CWS_ITEM_ID'), token: env('CWS_TOKEN')};
  const {build} = await import('./store-zip.mjs');
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'cws-')), 'jobadabra-extension.zip');
  const {version} = build(out);   // the same stamped version the app ships (desktop/scripts/extension-stamp.mjs)
  try {
    if (mode === 'check') await check({...base, version});
    else await publish({...base, version, zip: fs.readFileSync(out)});
  } catch (error) { console.error(error.message); process.exit(1); }
}
