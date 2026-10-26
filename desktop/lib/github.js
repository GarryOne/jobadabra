// Always on: the user's own private GitHub repo runs the searches on a
// schedule. Least privilege: Jobadabra is a GitHub App the user installs on that one repository
// ("Only select repositories"), so the app can't see or touch any other repo. The user creates the repo
// from the public starter template, installs the app on it, and approves a sign-in code; the app then
// commits the schedule and search settings, and stores their keys as encrypted repository secrets. Each run executes the public
// engine (GarryOne/jobadabra) with those secrets, so logs and data stay in the user's private repo.
import {FREE_BASE, TRIAL_KEY, isFreeKey} from './ai-free.js';
import * as ai from './ai/index.js';
import * as poolShare from './pool-share.js';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import path from 'node:path';

import {cadence, crons, withSchedule} from './cadence.js';
import {MODELS, REPO} from './pipeline.js';
import {tar} from './tar.js';
import {channelsOf} from './notify-channel.js';
import {pinned, resolveEngineRepo} from './engine-repo.js';
export {setEngineRef, resolveEngineRepo, currentEngineRepo, ENGINE_REPO} from './engine-repo.js';

// The Jobadabra GitHub App (public identifiers; device flow needs no client secret). Its permissions,
// on the one repository it's installed on: Actions, Contents, Secrets, Variables and Workflows (write).
export const CLIENT_ID = process.env.JOB_PILOTTO_GITHUB_CLIENT_ID || 'Iv23liEIBvK1hG0oejDr';
export const APP_SLUG = process.env.JOB_PILOTTO_GITHUB_APP || 'jobadabra';   // renamed from job-pilotto on 26 Oct 2026: the old address answers 404
// New repos are named jobadabra-personal-always-on (owner, 24 Oct 2026); repos made before keep job-pilotto-private and are still found.
export const REPO_NAME = 'jobadabra-personal-always-on';
export const REPO_NAMES = [REPO_NAME, 'job-pilotto-private'];
export const STARTER = 'GarryOne/job-pilotto-starter';
// Step 1: a new private repo from the starter template. Step 2: install the app on it only.
export const CREATE_URL = `https://github.com/new?template_name=${STARTER.split('/')[1]}&template_owner=${STARTER.split('/')[0]}&name=${REPO_NAME}&visibility=private`;
export const INSTALL_URL = `https://github.com/apps/${APP_SLUG}/installations/new`;
const API = 'https://api.github.com';

// Keys the cloud runs need (secrets), and what the app's own runs set (variables): same values as pipelineEnv.
export const SECRET_NAMES = ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'NOTION_TOKEN', 'TELEGRAM_BOT_TOKEN', 'SERPAPI_API_KEY', 'BRAVE_SEARCH_API_KEY', 'ADZUNA_APP_ID', 'ADZUNA_APP_KEY', 'JOOBLE_API_KEY'];
// Secrets kept outside the app's own store, e.g. the Google sign-in (the Python side keeps it in the Keychain):
// main.js sets the reader; they go to the repo with the rest, so a Gmail check on GitHub can sign in.
let extraSecrets = () => ({});
export const setExtraSecrets = read => { extraSecrets = read; };
const MODEL_VARIABLES = {
  JOB_PILOTTO_ENRICH_MODEL: 'enrich', JOB_PILOTTO_SCORE_MODEL: 'score', JOB_PILOTTO_KIT_MODEL: 'kit',
  JOB_PILOTTO_INSIGHT_MODEL: 'insight', JOB_PILOTTO_MAIL_MODEL: 'enrich', JOB_PILOTTO_SMALL_MODEL: 'small',
};
const CONFIG_FILES = ['search.json', 'preferences.json'];

// libsodium's ESM build is broken; its CommonJS build works everywhere.
const sodium = createRequire(import.meta.url)('libsodium-wrappers');

async function form(url, body, fetcher) {
  const response = await fetcher(url, {method: 'POST', headers: {Accept: 'application/json', 'Content-Type': 'application/json'},
    body: JSON.stringify(body)});
  return response.json();
}

// Step 1 of the sign-in: a code for the user to enter at github.com/login/device.
export async function startSignIn(fetcher = globalThis.fetch) {
  const data = await form('https://github.com/login/device/code', {client_id: CLIENT_ID}, fetcher);
  if (!data.device_code) throw new Error(data.error_description || 'GitHub did not start the sign-in');
  return {deviceCode: data.device_code, userCode: data.user_code, url: data.verification_uri,
    interval: data.interval || 5, expiresIn: data.expires_in || 900};
}

// Step 2: wait until the user approves; returns the access token.
export async function finishSignIn(start, {fetcher = globalThis.fetch, sleep = ms => new Promise(r => setTimeout(r, ms))} = {}) {
  let interval = start.interval;
  const until = Date.now() + start.expiresIn * 1000;
  while (Date.now() < until) {
    await sleep(interval * 1000);
    const data = await form('https://github.com/login/oauth/access_token', {client_id: CLIENT_ID, device_code: start.deviceCode,
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code'}, fetcher);
    if (data.access_token) return data.access_token;
    if (data.error === 'slow_down') interval = data.interval || interval + 5;
    else if (data.error !== 'authorization_pending') throw new Error(data.error_description || data.error || 'GitHub sign-in failed');
  }
  throw new Error('The GitHub code expired. Start again.');
}

export function client(token, fetcher = globalThis.fetch) {
  return async function api(method, route, body) {
    const response = await fetcher(`${API}${route}`, {
      method, body: body === undefined ? undefined : JSON.stringify(body),
      headers: {Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'job-pilotto-desktop', ...(body === undefined ? {} : {'Content-Type': 'application/json'})},
    });
    if (response.status === 204) return null;
    const data = await response.json().catch(() => null);
    if (!response.ok) throw Object.assign(new Error(data?.message || `GitHub ${response.status}`), {status: response.status});
    return data;
  };
}

// The repo the user installed the app on: the one with one of our names (REPO_NAMES), else the only one.
// Throws needsRepo when there's none yet, so the app can show the two setup steps.
export async function findRepo(api, chosen = '') {
  const {login} = await api('GET', '/user');
  const {installations = []} = await api('GET', '/user/installations?per_page=100');
  const repos = [];
  for (const installation of installations) {
    const {repositories = []} = await api('GET', `/user/installations/${installation.id}/repositories?per_page=100`);
    repos.push(...repositories);
  }
  const repo = repos.find(r => r.full_name === chosen) || repos.find(r => REPO_NAMES.includes(r.name)) || (repos.length === 1 ? repos[0] : null);
  if (!repo && repos.length > 1) {
    throw Object.assign(new Error('Choose which repository Jobadabra should use.'),
      {needsChoice: true, repos: repos.filter(r => r.private).map(r => r.full_name)});
  }
  if (!repo) throw Object.assign(new Error(installations.length
    ? `Jobadabra can't see a repository called ${REPO_NAME}. Add it to the app's repositories, then check again.`
    : 'Create your private repository and install Jobadabra on it, then check again.'), {needsRepo: true});
  if (!repo.private) throw new Error(`${repo.full_name} is public. Make it private in its Settings, then check again.`);
  return {login, repo: repo.full_name, created: false, createdAt: repo.created_at || ''};
}

// Create or update one file on the default branch; unchanged content is left alone.
export async function putFile(api, repo, file, content, message) {
  let sha;
  try {
    const current = await api('GET', `/repos/${repo}/contents/${file}`);
    if (Buffer.from(current.content || '', 'base64').toString() === content) return false;
    sha = current.sha;
  } catch (error) {
    if (error.status !== 404) throw error;
  }
  await api('PUT', `/repos/${repo}/contents/${file}`, {message, content: Buffer.from(content).toString('base64'), ...(sha ? {sha} : {})});
  return true;
}

export async function setSecrets(api, repo, secrets) {
  if (!Object.keys(secrets).length) return;
  await sodium.ready;
  const {key, key_id} = await api('GET', `/repos/${repo}/actions/secrets/public-key`);
  const publicKey = sodium.from_base64(key, sodium.base64_variants.ORIGINAL);
  for (const [name, value] of Object.entries(secrets)) {
    const sealed = sodium.to_base64(sodium.crypto_box_seal(value, publicKey), sodium.base64_variants.ORIGINAL);
    await api('PUT', `/repos/${repo}/actions/secrets/${name}`, {encrypted_value: sealed, key_id});
  }
}

export async function removeSecrets(api, repo, names) {
  for (const name of names) {
    try { await api('DELETE', `/repos/${repo}/actions/secrets/${name}`); } catch (error) { if (error.status !== 404) throw error; }
  }
}

// A sign-out on this Mac (Gmail disconnected) reaches the repo too, or Always on would go on reading the mail.
export async function removeRepoSecrets(storage, names, {fetcher} = {}) {
  const {repo} = storage.settings().cloud || {};
  if (!repo || !storage.secret('GITHUB_TOKEN')) return false;
  await removeSecrets(client(storage.secret('GITHUB_TOKEN'), fetcher), repo, names);
  return true;
}

export async function removeVariables(api, repo, names) {
  for (const name of names) {
    try { await api('DELETE', `/repos/${repo}/actions/variables/${name}`); } catch (error) { if (error.status !== 404) throw error; }
  }
}

export async function setVariables(api, repo, variables) {
  for (const [name, value] of Object.entries(variables)) {
    try {
      await api('POST', `/repos/${repo}/actions/variables`, {name, value});
    } catch (error) {
      if (error.status !== 409) throw error;
      await api('PATCH', `/repos/${repo}/actions/variables/${name}`, {name, value});
    }
  }
}

// What goes to the repo: the scheduled workflows, the user's search settings, keys and Notion IDs.
export function payload(storage, templatesDir = path.join(REPO, 'templates', 'github-actions')) {
  const files = {};
  const schedule = crons(storage.settings());  // how often, as the user chose (Settings → How often)
  for (const name of fs.readdirSync(templatesDir).filter(name => name.endsWith('.yml'))) {
    files[`.github/workflows/${name}`] = pinned(withSchedule(fs.readFileSync(path.join(templatesDir, name), 'utf8'), schedule[name]));
  }
  files['README.md'] = fs.readFileSync(path.join(templatesDir, 'README.md'), 'utf8');
  for (const name of CONFIG_FILES) {
    const text = storage.readText(`config/${name}`);
    if (text) files[`config/${name}`] = text;
  }
  const settings = storage.settings();
  const secrets = Object.fromEntries(SECRET_NAMES.map(name => [name, storage.secret(name)]).filter(([, value]) => value));
  for (const [name, value] of Object.entries(extraSecrets() || {})) if (value) secrets[name] = value;
  // Free AI (JPF1.<install>.<token>) goes to the repo too, so Always on scores and drafts on the SAME install lane as the app: its day, month and $2 trial budgets
  // are shared (16 Oct 2026: before, a Free AI user's runs had no AI at all). The older credit key (JP1.…) never goes.
  const free = /^JPF1\./.test(secrets.ANTHROPIC_API_KEY || '');
  if (isFreeKey(secrets.ANTHROPIC_API_KEY) && !free) delete secrets.ANTHROPIC_API_KEY;
  // The free trial (src/trial.py): the install's key tells the website who asks; a license key lifts the wall as in the app.
  const trialKey = free ? secrets.ANTHROPIC_API_KEY : storage.secret(TRIAL_KEY);
  if (trialKey) secrets.JOB_PILOTTO_TRIAL_KEY = trialKey;
  if (settings.license?.key) secrets.JOB_PILOTTO_LICENSE_KEY = settings.license.key;
  if (settings.telegramChatId) secrets.TELEGRAM_CHAT_ID = String(settings.telegramChatId);
  const variables = Object.fromEntries(Object.entries(settings.notionIds || {}).filter(([, value]) => value));
  const removed = [];
  if (free) variables.JOB_PILOTTO_AI_BASE_URL = FREE_BASE; else removed.push('JOB_PILOTTO_AI_BASE_URL');
  // How the person wants to be told: the workflows' --send and src/notify.py follow it. Unset = Telegram only, so it is set for e-mail AND for Telegram turned off (26 Oct 2026: GitHub kept messaging the bot).
  const notify = channelsOf(storage), telegramOff = Array.isArray(storage.settings().notifyBy) && !notify.includes('telegram');
  if (notify.includes('email') || telegramOff) variables.JOB_PILOTTO_NOTIFY = notify.join(','); else removed.push('JOB_PILOTTO_NOTIFY');
  if (settings.firstRunAt) variables.JOB_PILOTTO_FIRST_RUN = settings.firstRunAt; else removed.push('JOB_PILOTTO_FIRST_RUN');
  // The engine GitHub runs use (never a CLI there): the chosen family's API engine, on its own key (lib/ai/index.js alwaysOnEngine).
  // 'api' is the workflows' default, so it is only set for OpenAI (and removed otherwise, so a switch back to Claude takes effect).
  const engine = ai.alwaysOnEngine(settings, ai.keysOf(storage));
  if (engine === 'openai') variables.JOB_PILOTTO_AI_ENGINE = engine; else removed.push('JOB_PILOTTO_AI_ENGINE');
  if (secrets[ai.ENGINES[engine].key]) {
    for (const [name, stage] of Object.entries(MODEL_VARIABLES)) variables[name] = MODELS[stage];
    const {insights, kits} = cadence(settings);
    if (insights === 'off') { delete variables.JOB_PILOTTO_INSIGHT_MODEL; removed.push('JOB_PILOTTO_INSIGHT_MODEL'); }
    if (kits > 0) variables.JOB_PILOTTO_AUTO_KIT_MAX = String(kits); else removed.push('JOB_PILOTTO_AUTO_KIT_MAX');
  }
  // "Help the pool grow" (opt-in): Always-on runs follow the same choice.
  const share = poolShare.variables(storage);
  if (share) Object.assign(variables, share); else removed.push(...poolShare.NAMES);
  return {files, secrets, variables, removed};
}


// A repo older than this wasn't made in the setup that is running now.
const REUSED_AFTER = 30 * 60 * 1000;

// Everything in one go; safe to run again (after a key or setting changes).
export async function connect(storage, token, {fetcher, onStep = () => {}, repo: chosen = ''} = {}) {
  const api = client(token, fetcher);
  onStep('Finding your private repository…');
  const {login, repo, created, createdAt} = await findRepo(api, chosen);
  // A repository from an earlier setup (not the one just made, not the one already in use): say it's being reused.
  const existing = storage.settings().cloud?.repo !== repo && createdAt && Date.now() - Date.parse(createdAt) > REUSED_AFTER
    ? {createdAt} : null;
  if (existing) onStep(`Found your repository ${repo} (created ${new Date(createdAt).toLocaleDateString('en-GB', {day: 'numeric', month: 'short', year: 'numeric'})}): using it…`);
  const {files, secrets, variables, removed} = payload(storage);
  onStep('Adding the schedules and your search settings…');
  for (const [file, content] of Object.entries(files)) await putFile(api, repo, file, content, `Jobadabra: ${file}`);
  onStep('Storing your keys as encrypted secrets…');
  await setSecrets(api, repo, secrets);
  await setVariables(api, repo, variables);
  await removeVariables(api, repo, removed);
  await setWorkflows(api, repo, true);  // turned off earlier: GitHub kept the files but stopped their schedules
  storage.saveSettings({cloud: {repo, login, since: storage.settings().cloud?.since || new Date().toISOString(), updatedAt: new Date().toISOString(),
    synced: fingerprint({secrets, variables, removed})}});
  return {repo, created, existing, secrets: Object.keys(secrets), variables: Object.keys(variables)};
}

// Always on is GitHub's schedule. Turning it off must stop the workflows there, or both the Mac and GitHub keep running the same
// jobs (6 Oct 2026: a Gmail check still ran on GitHub with Always on off). The files stay; only the schedule is paused.
// One failing workflow does not stop the others: the result lists what could not be switched.
export async function setWorkflows(api, repo, enabled, templatesDir = path.join(REPO, 'templates', 'github-actions')) {
  const failed = [];
  for (const file of fs.readdirSync(templatesDir).filter(name => name.endsWith('.yml'))) {
    try { await api('PUT', `/repos/${repo}/actions/workflows/${file}/${enabled ? 'enable' : 'disable'}`); }
    catch (error) { failed.push(`${file}: ${error.message}`); }
  }
  return failed;
}

export function pauseWorkflows(storage, {fetcher} = {}) {
  const {repo} = storage.settings().cloud || {};
  const token = storage.secret('GITHUB_TOKEN');
  return repo && token ? setWorkflows(client(token, fetcher), repo, false) : Promise.resolve([]);
}

// Who wants to know a run was just started there (the app shows "Starting on GitHub…" until its row appears).
const dispatched = new Set();
export const onDispatch = listener => dispatched.add(listener);

// workflow_dispatch answers 204 with no run id. The run is the newest workflow_dispatch created after `since`.
function actionsApi(storage, fetcher) {
  const {repo} = storage.settings().cloud || {};
  const token = storage.secret('GITHUB_TOKEN');
  if (!repo || !token) return null;
  return {repo, api: client(token, fetcher)};
}

const asRun = run => ({id: run.id, html_url: run.html_url, status: run.status || '', conclusion: run.conclusion || '',
  createdAt: run.created_at});

export async function dispatchedRuns(storage, {workflow, since = 0, fetcher} = {}) {
  const gh = actionsApi(storage, fetcher);
  if (!gh || !workflow) return [];
  const data = await gh.api('GET', `/repos/${gh.repo}/actions/workflows/${encodeURIComponent(workflow)}/runs?event=workflow_dispatch&per_page=10`);
  return (data?.workflow_runs || [])
    .filter(run => Number.isFinite(Date.parse(run.created_at)) && Date.parse(run.created_at) >= since)
    .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at))
    .map(asRun);
}

export async function runJobs(storage, runId, {fetcher} = {}) {
  const gh = actionsApi(storage, fetcher);
  if (!gh || !runId) return [];
  const data = await gh.api('GET', `/repos/${gh.repo}/actions/runs/${runId}/jobs?per_page=20`);
  return data?.jobs || [];
}

export async function workflowRun(storage, runId, {fetcher} = {}) {
  const gh = actionsApi(storage, fetcher);
  if (!gh || !runId) return null;
  return asRun(await gh.api('GET', `/repos/${gh.repo}/actions/runs/${runId}`));
}

// Stop on a run in GitHub (Actions banner, Recent activity): GitHub cancels it, which ends the engine there (SIGINT, then SIGTERM),
// and the engine closes its Notion row as stopped (src/notion/cron_runs.py). 202 Accepted: GitHub does it in a few seconds.
export const runIdOf = url => /\/actions\/runs\/(\d+)/.exec(String(url || ''))?.[1] || null;
export async function cancelRun(storage, runId, {fetcher} = {}) {
  const gh = actionsApi(storage, fetcher);
  if (!gh) throw new Error('GitHub is not connected');
  if (!runId) throw new Error('GitHub has not listed this run yet: try again in a few seconds');
  await gh.api('POST', `/repos/${gh.repo}/actions/runs/${runId}/cancel`);
}

// The link to open: the job that is actually running, else the workflow run.
export function runLink(run, jobs = []) {
  const job = (jobs || []).find(item => item.status === 'in_progress')
    || (jobs || []).find(item => item.status === 'queued')
    || (jobs || [])[0];
  return {id: run?.id, url: job?.html_url || run?.html_url || run?.url || '',
    runUrl: run?.html_url || run?.url || '', jobId: job?.id || null,
    status: job?.status || run?.status || '', conclusion: run?.conclusion || ''};
}

// A fingerprint of what the repo should hold besides its files (secrets, variables, variables to remove): GitHub never shows
// a secret back, so this tells "already sent" from "changed since". A SHA-256 of high-entropy keys, kept on this Mac only.
export function fingerprint({secrets, variables, removed}) {
  const sorted = object => Object.fromEntries(Object.entries(object).sort(([a], [b]) => a.localeCompare(b)));
  return createHash('sha256').update(JSON.stringify([sorted(secrets), sorted(variables), [...removed].sort()])).digest('hex');
}

// Our workflow files that this app no longer ships (a template removed or renamed): their first line is ours, and the user's own
// workflows are left alone. -> [{path, sha}]
export async function retiredWorkflows(api, repo, files) {
  let listed;
  try { listed = await api('GET', `/repos/${repo}/contents/.github/workflows`); }
  catch (error) { if (error.status === 404) return []; throw error; }
  const retired = [];
  for (const entry of Array.isArray(listed) ? listed : []) {   // a folder lists; anything else has nothing to retire
    if (entry.type !== 'file' || !/\.ya?ml$/.test(entry.name) || files[entry.path]) continue;
    const current = await api('GET', `/repos/${repo}/contents/${entry.path}`);
    if (Buffer.from(current.content || '', 'base64').toString().match(/^# (Job Pilotto|Jobadabra)/)) retired.push({path: entry.path, sha: current.sha});
  }
  return retired;
}

// The whole repo in step with this app, at every start and after a key or setting changes: the workflow files (pinned to this
// app's release), retired ones deleted, and the secrets and variables (models included) sent again whenever they changed.
// Before 8 Oct 2026 secrets and variables were sent only when Always on was turned on, so a new default model never reached a repo.
// -> what changed, by name only (never a value).
export async function updateRepo(storage, {fetcher} = {}) {
  const cloud = storage.settings().cloud || {};
  if (!cloud.repo || !storage.secret('GITHUB_TOKEN')) return [];
  const api = client(storage.secret('GITHUB_TOKEN'), fetcher);
  await resolveEngineRepo(fetcher);   // the workflow files name the engine as GitHub names it now
  const {files, secrets, variables, removed} = payload(storage);
  const changed = [];
  for (const [file, content] of Object.entries(files)) {
    if (await putFile(api, cloud.repo, file, content, `Jobadabra: ${file}`)) changed.push(file);
  }
  for (const {path: file, sha} of await retiredWorkflows(api, cloud.repo, files)) {
    await api('DELETE', `/repos/${cloud.repo}/contents/${file}`, {message: `Jobadabra: ${file} is no longer used`, sha});
    changed.push(`removed ${file}`);
  }
  const digest = fingerprint({secrets, variables, removed});
  if (digest !== cloud.synced) {
    await setSecrets(api, cloud.repo, secrets);
    await setVariables(api, cloud.repo, variables);
    await removeVariables(api, cloud.repo, removed);
    storage.saveSettings({cloud: {...storage.settings().cloud, synced: digest, updatedAt: new Date().toISOString()}});
    changed.push(...Object.keys(secrets).map(name => `secret ${name}`), ...Object.keys(variables).map(name => `variable ${name}`));
  }
  return changed;
}

// Telegram buttons and the app's Actions start a run in the user's repo instead of on this Mac. `note` receives one
// line per attempt for the app's own log (lib/log.js, wired in main.js): a dispatch is the one action that spends
// money and time elsewhere, and until now it left no trace on this Mac — two runs 38 s apart for one interview could
// not be told apart afterwards (1 Oct 2026). `why` names what asked for it, so the log answers "who started this?".
export function cloudDispatch(storage, onLine = () => {}, {fetcher, note = () => {}} = {}) {
  return async (inputs, workflow = 'daily.yml', why = '') => {
    const {repo} = storage.settings().cloud;
    const clean = Object.fromEntries(Object.entries(inputs || {}).filter(([, v]) => v !== undefined && v !== null && v !== '')
      .map(([k, v]) => [k, String(v)]));
    const name = workflow.replace(/\.yml$/, '');
    // What identifies this dispatch: who asked, the workflow, its mode, and a short digest of the inputs. Never their
    // values — a Telegram action can carry the user's own words, and the log holds no personal data. Two runs for the
    // same interview carry the same digest, which is exactly what makes a duplicate visible.
    const tag = `#${createHash('sha1').update(JSON.stringify(clean)).digest('hex').slice(0, 8)}`;
    const what = `${why || 'unknown caller'} → ${name}${clean.mode ? ` (${clean.mode})` : ''} ${tag} in ${repo}`;
    note(`start ${what}`);  // written before the request, so a dispatch that hangs is still on the record
    try {
      await client(storage.secret('GITHUB_TOKEN'), fetcher)('POST', `/repos/${repo}/actions/workflows/${workflow}/dispatches`,
        {ref: 'main', inputs: clean});
      onLine(`Started ${name}${clean.mode ? ` (${clean.mode})` : ''} in ${repo}.`);
      note(`sent ${what}`);
      dispatched.forEach(listener => listener({workflow, inputs: clean}));
      return {ok: true, workflow, repo, inputs: clean};
    } catch (error) {
      onLine(`Could not start the run in ${repo}: ${error.message}`);
      note(`failed ${what}: ${error.message}`);
      return {ok: false, error: error.message, workflow, repo, inputs: clean};
    }
  };
}

// The job list shown in the app comes from the latest cloud run's database (its jobs-db artifact).
export async function syncDatabase(storage, {fetcher = globalThis.fetch, unzip} = {}) {
  const {repo} = storage.settings().cloud || {};
  if (!repo) return false;
  const api = client(storage.secret('GITHUB_TOKEN'), fetcher);
  const {artifacts} = await api('GET', `/repos/${repo}/actions/artifacts?name=job-pilotto-jobs-db&per_page=1`);
  const latest = artifacts?.find(artifact => !artifact.expired);
  if (!latest || latest.id === storage.settings().cloud.artifactId) return false;
  const response = await fetcher(latest.archive_download_url, {headers: {Authorization: `Bearer ${storage.secret('GITHUB_TOKEN')}`}});
  if (!response.ok) throw new Error(`Could not download the job database (${response.status})`);
  const zip = storage.path('data/jobs-db.zip');
  fs.mkdirSync(path.dirname(zip), {recursive: true});
  fs.writeFileSync(zip, Buffer.from(await response.arrayBuffer()));
  await (unzip || unzipFile)(zip, storage.path('data'));
  fs.rmSync(zip, {force: true});
  storage.saveSettings({cloud: {...storage.settings().cloud, artifactId: latest.id, syncedAt: new Date().toISOString()}});
  return true;
}

async function unzipFile(zip, dir) {
  const {execFile} = await import('node:child_process');
  // Windows 10+ ships bsdtar, which also reads zip files.
  const [command, args] = process.platform === 'win32' ? [tar(), ['-xf', zip, '-C', dir]] : ['/usr/bin/unzip', ['-o', zip, '-d', dir]];
  await new Promise((resolve, reject) => execFile(command, args, error => error ? reject(error) : resolve()));
}
