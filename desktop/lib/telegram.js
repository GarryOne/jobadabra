// Telegram from the desktop app: the user's own bot (made with @BotFather), no webhook, no Cloudflare.
// The app long-polls Telegram for button taps and commands while it runs, and handles them with the
// Worker's own code (app-core/src/index.js handleUpdate); its "dispatch" runs the pipeline locally.
import {handleAdd, handleCommand, handleUpdate} from '../shared/app-core/index.js';
import * as github from './github.js';
import * as pipeline from './pipeline.js';
import * as notionGate from './notion-gate.js';
import {telegramStore} from './store/telegram-store.js';

// The end-to-end tests' fake Bot API (desktop/e2e/lib/telegram-fake.mjs), honoured only in a test run.
export const BASE = process.env.JOBADABRA_E2E && process.env.JOBADABRA_E2E_TELEGRAM_BASE_URL ? process.env.JOBADABRA_E2E_TELEGRAM_BASE_URL.replace(/\/$/, '') : 'https://api.telegram.org';
export async function api(token, method, body = {}, fetcher = globalThis.fetch) {
  const response = await fetcher(`${BASE}/bot${token}/${method}`, {
    method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!data.ok) throw Object.assign(new Error(data.description || `Telegram ${response.status}`), {code: data.error_code});
  return data.result;
}

// Wait (up to `seconds`) for the user to press Start in their bot; returns the chat to send to.
export async function pair(token, seconds = 120, fetcher) {
  const bot = await api(token, 'getMe', {}, fetcher);
  let offset;
  const until = Date.now() + seconds * 1000;
  while (Date.now() < until) {
    let updates;
    try {
      updates = await api(token, 'getUpdates', {timeout: 20, ...(offset ? {offset} : {})}, fetcher);
    } catch (error) {
      if (error.code === 409) throw new Error('This bot is already connected to a server (a webhook). Create a new bot for the app with @BotFather.');
      throw error;
    }
    for (const update of updates) {
      offset = update.update_id + 1;
      const message = update.message;
      if (message?.chat?.type === 'private' && /^\/start\b/.test(message.text || '')) {
        await api(token, 'getUpdates', {offset, timeout: 0}, fetcher); // don't handle this /start again later
        await api(token, 'sendMessage', {chat_id: message.chat.id, parse_mode: 'HTML',
          text: '✈️ <b>Jobadabra is connected.</b> New matches arrive here after each search. Send /help for commands.'}, fetcher);
        return {chatId: String(message.chat.id), username: bot.username};
      }
    }
  }
  throw new Error(`No Start received. Open t.me/${bot.username}, press Start, then try again.`);
}

// Inputs from a button or command -> the pipeline, in the background (Telegram gets its reply now).
export function localDispatch(storage, onLine = () => {}) {
  return async (inputs, workflow) => {
    if (workflow === 'mail.yml') {  // tracked like a scheduled check, so the activity bar shows it
      pipeline.checkMail(storage, onLine, 'you').catch(error => onLine(`Gmail check failed: ${error.message}`));
      return;
    }
    // Searching and the one-off jobs are tracked, so the app's Recent activity shows them and their result.
    const failed = error => onLine(`Telegram action failed: ${error.message}`);
    if (workflow === 'scout.yml') { pipeline.scout(storage, onLine, 'you', inputs.batch || null).catch(failed); return; }
    if (inputs.mode === 'run') { pipeline.refresh(storage, onLine, 'run', 'you').catch(failed); return; }
    if (pipeline.TASKS[inputs.mode]) { pipeline.task(storage, inputs.mode, pipeline.dailyArgs(storage, inputs), onLine).catch(failed); return; }
    const args = pipeline.dailyArgs(storage, inputs);
    const crawl = inputs.mode === 'scheduled';
    const task = () => pipeline.run(storage, args, onLine);
    (crawl ? pipeline.serial(task) : task()).catch(failed);
  };
}

export function telegramEnv(storage, onLine, note = () => {}) {
  const settings = storage.settings();
  // Notion only when it is the store (lib/store); with the data on this Mac the bot reads and writes it through env.store.
  const onNotion = notionGate.onNotion(storage);
  const ids = onNotion ? settings.notionIds || {} : {};
  return {
    ...(!onNotion ? {store: telegramStore(storage)} : {}),
    TELEGRAM_BOT_TOKEN: storage.secret('TELEGRAM_BOT_TOKEN'),
    OWNER_CHAT_ID: settings.telegramChatId,
    NOTION_TOKEN: onNotion ? storage.secret('NOTION_TOKEN') : '',
    NOTION_APPLICATIONS_DB: ids.NOTION_APPLICATIONS_DB || '',
    NOTION_EVENTS_DB: ids.NOTION_EVENTS_DB || '',
    NOTION_CRON_RUNS_DB: ids.NOTION_CRON_RUNS_DB || '',  // /status and the app's Status: the runs in Notion
    // With Always on, runs happen in the user's GitHub repo.
    dispatch: settings.cloud?.repo ? github.cloudDispatch(storage, onLine, {note}) : localDispatch(storage, onLine),
    status: () => {
      const s = storage.settings();
      if (s.cloud?.repo) return `☁️ Always on: Jobadabra runs from your GitHub repo ${s.cloud.repo} on your schedule, even with your computer off.`;
      return s.lastSearchAt ? `🖥️ Last search from the Jobadabra app: ${new Date(s.lastSearchAt).toLocaleString()}` +
        `${s.lastSearchOk === false ? ' (with problems)' : ''}. Next one on your schedule while the app is open.` : '🖥️ No search yet.';
    },
  };
}

// Long polling: runs while the app is open. stop() ends it (e.g. when the token changes).
export function startPolling(storage, onLine = () => {}, fetcher, note = () => {}) {
  let running = true;
  (async () => {
    let offset = storage.settings().telegramOffset;
    while (running) {
      const token = storage.secret('TELEGRAM_BOT_TOKEN');
      if (!token || !storage.settings().telegramChatId) return;
      if (storage.settings().telegramCloud) return;  // the user's Cloudflare Worker answers instead (telegram-cloud.js)
      try {
        const updates = await api(token, 'getUpdates', {timeout: 50, ...(offset ? {offset} : {})}, fetcher);
        for (const update of updates) {
          offset = update.update_id + 1;
          storage.saveSettings({telegramOffset: offset});
          await handleUpdate(telegramEnv(storage, onLine, note), update);
        }
      } catch (error) {
        onLine(`Telegram: ${error.message}`);
        await new Promise(resolve => setTimeout(resolve, 15000)); // offline or Telegram hiccup: retry later
      }
    }
  })();
  return {stop: () => { running = false; }};
}

// The Telegram commands, run from the app's buttons. The reply goes to Telegram when it's connected
// (same message as typing the command), and back to the window as plain text either way.
export const plainText = html => String(html || '').replace(/<br\s*\/?>/g, '\n').replace(/<[^>]+>/g, '')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');

export async function runCommand(storage, name, arg = '', onLine = () => {}, fetcher, note = () => {}) {
  const env = telegramEnv(storage, onLine, note);
  const answer = name === 'add' ? await handleAdd(env, `/add ${arg}`) : await handleCommand(env, {name, arg});
  const {text, keyboard} = typeof answer === 'string' ? {text: answer} : answer;
  if (env.TELEGRAM_BOT_TOKEN && env.OWNER_CHAT_ID) {
    await api(env.TELEGRAM_BOT_TOKEN, 'sendMessage', {chat_id: env.OWNER_CHAT_ID, text, parse_mode: 'HTML',
      disable_web_page_preview: true, ...(keyboard ? {reply_markup: keyboard} : {})}, fetcher).catch(error => onLine(`Telegram: ${error.message}`));
  }
  const telegram = !!(env.TELEGRAM_BOT_TOKEN && env.OWNER_CHAT_ID);
  return {text: telegram ? plainText(text) : inApp(plainText(text)), telegram};
}
// The bot's replies promise a Telegram message; without Telegram the result shows in the app instead.
export const inApp = text => text
  .replace('Sending the current list in about a minute.', "Preparing today's list; it shows here in about a minute.")
  .replace('The digest arrives in about 3 minutes.', 'New jobs show in the Jobs list in about 3 minutes.')
  .replace(/\barrives in about a minute/, 'shows here in about a minute');
