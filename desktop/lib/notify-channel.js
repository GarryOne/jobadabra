// How the person wants to be told (Settings → Automation → Notifications, "Tell me by"): e-mail, app notifications, Telegram, any mix. Owns the choice (settings.notifyBy),
// the address kept on our site (GET/PUT /api/account/email, site/src/account-email.js), the env the engine reads (JOB_PILOTTO_NOTIFY, src/notify.py), and the one e-mail the app itself sends.
// Guards: test/notify-channel.test.js, test/telegram-send.test.js.
import {FREE_BASE, TRIAL_KEY} from './ai-free.js';

const BASE = FREE_BASE.replace(/\/api\/ai$/, '');
export const CHANNELS = ['email', 'app', 'telegram'];

export const telegramReady = storage => !!(storage.secret('TELEGRAM_BOT_TOKEN') && storage.settings().telegramChatId);
export const installKey = storage => storage.secret(TRIAL_KEY) || (/^JPF1\./.test(storage.secret('ANTHROPIC_API_KEY') || '') ? storage.secret('ANTHROPIC_API_KEY') : '');
export const emailOf = storage => String(storage.settings().notifyEmail || '');

// The chosen channels. Unset = what the person already has: e-mail when an address was given, Telegram when it is connected, and the app always.
// An explicit choice wins, but a channel that is not set up (no address, no bot) is dropped: nothing is promised that cannot be sent.
export function channelsOf(storage) {
  const chosen = storage.settings().notifyBy;
  const wanted = Array.isArray(chosen) ? chosen.filter(name => CHANNELS.includes(name)) : [...(emailOf(storage) ? ['email'] : []), ...(telegramReady(storage) ? ['telegram'] : []), 'app'];
  return wanted.filter(name => (name === 'email' ? !!emailOf(storage) : name === 'telegram' ? telegramReady(storage) : true));
}

// A run is asked to deliver (--send) when it has somewhere to deliver to besides the app's own window.
export const deliveryReady = storage => channelsOf(storage).some(name => name === 'email' || name === 'telegram');

// What the engine and the Always on repo are told (src/notify.py reads JOB_PILOTTO_NOTIFY; the key identifies the install to the site).
export function notifyEnv(storage) {
  const channels = channelsOf(storage);
  return {JOB_PILOTTO_NOTIFY: channels.join(','), ...(channels.includes('email') && installKey(storage) ? {JOB_PILOTTO_TRIAL_KEY: installKey(storage)} : {})};
}

const WORDS = {
  taken: 'That address already has a Jobadabra account. Use another address, or sign in with it once Pro is out.',
  pro: 'That account is a Pro account; its address changes through Pro sign-in.',
  unauthorized: 'This install could not be recognised by the website. Try again in a minute.',
};
async function call(storage, method, path, body, fetcher) {
  const key = installKey(storage);
  if (!key) return {ok: false, error: 'No install key yet: open the app online once, then try again.'};
  try {
    const response = await fetcher(`${BASE}${path}`, {method, headers: {'x-api-key': key, ...(body ? {'content-type': 'application/json'} : {})}, ...(body ? {body: JSON.stringify(body)} : {})});
    const answer = await response.json().catch(() => ({}));
    return answer.ok ? answer : {ok: false, error: WORDS[answer.error] || answer.error || 'The website did not accept it.'};
  } catch { return {ok: false, error: 'The website could not be reached. Try again when you are online.'}; }
}

// What the window shows: the choice, the address and whether it is confirmed (asked of the site; the cached address when offline).
export async function state(storage, fetcher = globalThis.fetch) {
  const settings = storage.settings(), site = await call(storage, 'GET', '/api/account/email', null, fetcher);
  if (site.ok && site.email && site.email !== settings.notifyEmail) storage.saveSettings({notifyEmail: site.email});
  return {by: channelsOf(storage), chosen: Array.isArray(settings.notifyBy) ? settings.notifyBy : null, telegram: telegramReady(storage), email: site.ok ? site.email || '' : emailOf(storage),
    confirmed: !!site.confirmed, sending: site.ok && typeof site.sending === 'boolean' ? site.sending : null, serviceOff: !!site.serviceOff, cadence: site.ok ? site.cadence || 'daily' : settings.notifyCadence || 'daily', marketing: site.ok ? !!site.marketing : settings.notifyMarketing !== false, reached: !!site.ok};
}

// Saves the choice. A changed address or opt-in goes to the site first; the choice is kept only if it was accepted.
export async function save(storage, {by, email, marketing, cadence}, fetcher = globalThis.fetch) {
  const clean = String(email || '').trim().toLowerCase();
  if (Array.isArray(by) && by.includes('email') && !clean && !emailOf(storage)) return {ok: false, error: 'Enter your email address to be told by email.'};
  const digest = ['daily', 'weekly'].includes(cadence) ? cadence : null;   // how often the digest of everything but new matches comes
  if (clean && (clean !== emailOf(storage) || typeof marketing === 'boolean' || digest)) {
    const site = await call(storage, 'PUT', '/api/account/email', {email: clean, ...(typeof marketing === 'boolean' ? {marketing} : {}), ...(digest ? {cadence: digest} : {})}, fetcher);
    if (!site.ok) return site;
    storage.saveSettings({notifyEmail: clean, ...(typeof marketing === 'boolean' ? {notifyMarketing: marketing} : {}), ...(digest ? {notifyCadence: digest} : {})});
  }
  if (Array.isArray(by)) storage.saveSettings({notifyBy: by.filter(name => CHANNELS.includes(name))});
  return {ok: true};
}

// One message the app itself sends (not an engine run): by the chosen channels' e-mail form. Plain text in, never throws. It joins the digest (kind 'activity'), never a mail of its own. -> true when the site took it.
export async function sendEmail(storage, {subject, text}, fetcher = globalThis.fetch) {
  if (!channelsOf(storage).includes('email')) return false;
  const escape = value => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return (await call(storage, 'POST', '/api/notify/email', {subject, html: `<b>${escape(subject)}</b>\n${escape(text)}`, kind: 'activity'}, fetcher)).ok === true;
}
