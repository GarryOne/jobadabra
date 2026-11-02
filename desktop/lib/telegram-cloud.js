// "Telegram buttons, always on": the user's own small Cloudflare Worker (free plan) runs the
// Telegram bot (app-core/src, bundled into shared/bot-worker.js by scripts/stage.mjs) and answers button taps
// and commands by starting runs in their private GitHub repo (Always on). The app
// deploys it with a Cloudflare API token the user creates, points their bot's webhook at it, and stops its own
// long polling (a bot has one listener: a webhook or getUpdates, never both). Turning it off reverses that.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

import {MODELS} from './pipeline.js';
import {api as telegramApi} from './telegram.js';

export const SCRIPT = 'job-pilotto-bot';
const API = 'https://api.cloudflare.com/client/v4';
const BUNDLE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'shared', 'bot-worker.js');
// A token with exactly what this needs, prefilled on Cloudflare's "Create token" page.
export const TOKEN_URL = 'https://dash.cloudflare.com/profile/api-tokens?name=Jobadabra%20Telegram&permissionGroupKeys=' +
  encodeURIComponent(JSON.stringify([{key: 'workers_scripts', type: 'edit'}, {key: 'account_settings', type: 'read'}]));

async function cloudflare(token, method, route, body, fetcher = globalThis.fetch) {
  const response = await fetcher(`${API}${route}`, {method, headers: {Authorization: `Bearer ${token}`,
    ...(body && !(body instanceof FormData) ? {'Content-Type': 'application/json'} : {})},
  body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined});
  const data = await response.json().catch(() => ({}));
  if (!data.success) {
    const why = (data.errors || []).map(e => e.message).join('; ') || `HTTP ${response.status}`;
    throw Object.assign(new Error(`Cloudflare: ${why}`), {status: response.status, codes: (data.errors || []).map(e => e.code)});
  }
  return data.result;
}

// What turning it on needs first, as one message for the user (or '' when ready).
export function missing(storage) {
  const settings = storage.settings();
  if (!storage.secret('TELEGRAM_BOT_TOKEN') || !settings.telegramChatId) return 'Connect your Telegram bot first (Settings → Connections).';
  if (!settings.cloud?.repo || !storage.secret('GITHUB_TOKEN')) return 'Turn on Always on first: the buttons start runs there, even when your Mac is off.';
  return '';
}

// The Worker's settings: plain values and secrets, from the app's own (nothing else leaves this computer).
export function bindings(storage, webhookSecret) {
  const settings = storage.settings();
  const plain = {OWNER_CHAT_ID: String(settings.telegramChatId), GITHUB_REPO: settings.cloud.repo, WORKFLOW_FILE: 'daily.yml',
    JOBADABRA_KIT_MODEL: MODELS.kit, ...Object.fromEntries(Object.entries(settings.notionIds || {}).filter(([, v]) => v))};
  const secret = {TELEGRAM_BOT_TOKEN: storage.secret('TELEGRAM_BOT_TOKEN'), WEBHOOK_SECRET: webhookSecret,
    GITHUB_TOKEN: storage.secret('GITHUB_TOKEN'), NOTION_TOKEN: storage.secret('NOTION_TOKEN'),
    ANTHROPIC_API_KEY: storage.secret('ANTHROPIC_API_KEY')};
  return [
    ...Object.entries(plain).map(([name, text]) => ({type: 'plain_text', name, text})),
    ...Object.entries(secret).filter(([, text]) => text).map(([name, text]) => ({type: 'secret_text', name, text})),
  ];
}

// Deploy (or update) the Worker, give it a workers.dev address, point the bot's webhook at it.
export async function turnOn(storage, token, {fetcher, telegram = telegramApi, bundle = () => fs.readFileSync(BUNDLE, 'utf8'),
  random = () => crypto.randomBytes(24).toString('hex')} = {}) {
  const need = missing(storage);
  if (need) return {ok: false, error: need};
  token = String(token || storage.secret('CLOUDFLARE_API_TOKEN') || '').trim();
  if (!token) return {ok: false, error: 'Paste your Cloudflare API token first.'};
  const cf = (method, route, body) => cloudflare(token, method, route, body, fetcher);
  try {
    const [account] = await cf('GET', '/accounts');
    if (!account) return {ok: false, error: 'This Cloudflare token sees no account. Create it with "Account Settings: Read" too.'};
    let subdomain;
    try { subdomain = (await cf('GET', `/accounts/${account.id}/workers/subdomain`)).subdomain; } catch {}
    if (!subdomain) subdomain = (await cf('PUT', `/accounts/${account.id}/workers/subdomain`, {subdomain: `jobadabra-${random().slice(0, 6)}`})).subdomain;
    const webhookSecret = random();
    const form = new FormData();
    form.append('metadata', new Blob([JSON.stringify({main_module: 'index.js', compatibility_date: '2026-09-01',
      bindings: bindings(storage, webhookSecret)})], {type: 'application/json'}));
    form.append('index.js', new Blob([bundle()], {type: 'application/javascript+module'}), 'index.js');
    await cf('PUT', `/accounts/${account.id}/workers/scripts/${SCRIPT}`, form);
    await cf('POST', `/accounts/${account.id}/workers/scripts/${SCRIPT}/subdomain`, {enabled: true, previews_enabled: false});
    const url = `https://${SCRIPT}.${subdomain}.workers.dev`;
    await telegram(storage.secret('TELEGRAM_BOT_TOKEN'), 'setWebhook', {url: `${url}/telegram`, secret_token: webhookSecret,
      allowed_updates: ['message', 'callback_query']});
    storage.setSecret('CLOUDFLARE_API_TOKEN', token);
    storage.saveSettings({telegramCloud: {url, account: account.id, at: new Date().toISOString(), deployed: fingerprint(storage, bundle())}});
    return {ok: true, url};
  } catch (error) {
    const hint = error.status === 403 || error.codes?.includes(10000)
      ? ' The token needs "Workers Scripts: Edit" and "Account Settings: Read": create it with the link above.' : '';
    return {ok: false, error: `${error.message}.${hint}`};
  }
}

// What the deployed Worker should be: its code and its settings (models, Notion IDs, keys), without the webhook secret, which
// changes at each deploy. A SHA-256, kept on this Mac only.
export function fingerprint(storage, code) {
  const settings = bindings(storage, '').filter(binding => binding.name !== 'WEBHOOK_SECRET');
  return crypto.createHash('sha256').update(code).update(JSON.stringify(settings)).digest('hex');
}

// At each app start: the Worker in the user's Cloudflare account is redeployed when this app ships other bot code or its settings
// changed (8 Oct 2026: before, it kept the code and models of the day it was turned on, forever). -> null when nothing was to do,
// else turnOn's result.
export async function refresh(storage, {fetcher, telegram = telegramApi, bundle = () => fs.readFileSync(BUNDLE, 'utf8')} = {}) {
  const deployed = storage.settings().telegramCloud;
  if (!deployed || missing(storage) || !storage.secret('CLOUDFLARE_API_TOKEN')) return null;
  let code;
  try { code = bundle(); } catch { return null; }   // a source checkout that never staged the bundle: nothing to compare
  if (deployed.deployed === fingerprint(storage, code)) return null;
  return turnOn(storage, '', {fetcher, telegram, bundle: () => code});
}

// Back to the app answering Telegram itself: webhook off, Worker deleted, token forgotten.
export async function turnOff(storage, {fetcher, telegram = telegramApi} = {}) {
  const {account} = storage.settings().telegramCloud || {};
  const token = storage.secret('CLOUDFLARE_API_TOKEN');
  const bot = storage.secret('TELEGRAM_BOT_TOKEN');
  if (bot) await telegram(bot, 'deleteWebhook', {}).catch(() => {});
  if (account && token) await cloudflare(token, 'DELETE', `/accounts/${account}/workers/scripts/${SCRIPT}?force=true`, null, fetcher).catch(() => {});
  storage.setSecret('CLOUDFLARE_API_TOKEN', '');
  storage.saveSettings({telegramCloud: null});
  return {ok: true};
}
