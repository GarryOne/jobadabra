// The Always on and Telegram IPC (moved out of main.js, 8 Oct 2026): connecting and turning off Always on (the user's GitHub repo), the Telegram buttons
// in the cloud, and connecting or disconnecting the Telegram bot. main.js passes in the services they share. Guards: the github, telegram and
// cloud tests in desktop/test.
import * as aiFree from './ai-free.js';
import * as github from './github.js';
import * as telegram from './telegram.js';
import * as telegramCloud from './telegram-cloud.js';
import {cleanSecret} from './secrets.js';
import {log as appLog} from './log.js';
import {registerHostedHandlers} from './hosted-handlers.js';

export function registerCloudHandlers(ctx) {
  const {DEMO, cloud, dialog, handleImportant, ipcMain, needsNotion, restartTelegram, shell, storage, toWindow, getWindow} = ctx;
  registerHostedHandlers({DEMO, dialog, getWindow, ipcMain, storage, toWindow});   // hosted Always on: daily searches on our servers (lib/hosted-handlers.js)
  // Always on: sign in to GitHub (code approved in the browser), then set up
  // the user's private repo. Also re-run after a key or setting changes ("Update").
  handleImportant('cloudConnect', 'Setting up Always on', async (_, chosen = '') => {
    if (DEMO) return {ok: true, repo: storage.settings().cloud?.repo || 'alexmorgan/jobadabra-personal-always-on', existing: null,
      secrets: ['ANTHROPIC_API_KEY', 'NOTION_TOKEN', 'TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID'], variables: []};  // never the real GitHub
    const gate = needsNotion('cloud');
    if (gate) return gate;
    try {
      let token = storage.secret('GITHUB_TOKEN');
      if (!token) {
        const start = await github.startSignIn();
        toWindow('cloudStep', {code: start.userCode, url: start.url});
        shell.openExternal(start.url);
        token = await github.finishSignIn(start);
        storage.setSecret('GITHUB_TOKEN', token);
      }
      await aiFree.ensureTrialKey(storage);   // the install's key for the free trial's status, sent with the secrets (src/trial.py)
      const result = await github.connect(storage, token, {repo: chosen, onStep: text => toWindow('cloudStep', {text})});
      return {ok: true, ...result};
    } catch (error) {
      if (error.status === 401) storage.setSecret('GITHUB_TOKEN', '');  // revoked: sign in again next time
      return {ok: false, error: error.message, ...(error.needsRepo ? {needsRepo: true, createUrl: await github.createUrl(undefined, token), installUrl: github.INSTALL_URL} : {}),
        ...(error.needsChoice ? {needsChoice: true, repos: error.repos} : {})};
    }
  });
  const turnCloudOff = async () => {
    if (storage.settings().telegramCloud) await telegramCloud.turnOff(storage);  // its buttons start runs there
    const repo = storage.settings().cloud?.repo;
    const failed = await github.pauseWorkflows(storage).catch(error => [error.message]);  // before the repo is forgotten
    appLog('dispatch', 'always on off: schedules paused', {repo, failed: failed.length, ...(failed.length ? {why: failed.join('; ').slice(0, 200)} : {})});
    storage.saveSettings({cloud: null}); restartTelegram();
  };
  handleImportant('cloudOff', 'Turning off Always on', async () => { await turnCloudOff(); return true; });
  // Choosing "While app is open" in the run-mode control *is* turning Always on off, so say what changes first: the
  // schedule moves back to this Mac, and the GitHub repository stays where it is.
  handleImportant('cloudTurnOffConfirmed', 'Turning off Always on', async () => {
    const repo = storage.settings().cloud?.repo;
    if (!repo) return {ok: true, already: true};
    const {response} = await dialog.showMessageBox(getWindow() && !getWindow().isDestroyed() ? getWindow() : undefined,
      {type: 'question', buttons: ['Turn Always on off', 'Cancel'], defaultId: 1, cancelId: 1, message: 'Turn Always on off?',
        detail: `Scheduled searches, kits, insights and mail checks run on this Mac while Jobadabra is open. Your repository ${repo} stays on GitHub.`});
    if (response !== 0) return {ok: false, cancelled: true};
    await turnCloudOff();
    return {ok: true};
  });
  // Telegram buttons, always on: the user's own Cloudflare Worker (lib/telegram-cloud.js).
  handleImportant('telegramCloudOn', 'Setting up the Telegram buttons', async (_, token) => { const gate = needsNotion('telegramCloud'); if (gate) return gate; const result = await telegramCloud.turnOn(storage, token); restartTelegram(); return result; });
  handleImportant('telegramCloudOff', 'Turning off the Telegram buttons', async () => { const result = await telegramCloud.turnOff(storage); restartTelegram(); return result; });
  // Settings → Connections → ⋯ → Disconnect Telegram (owner, 7 Oct 2026, after Gmail's): the bot token and chat are forgotten, the Telegram
  // buttons' Worker goes (it answers for this bot), the app stops listening, and with Always on the repo's two Telegram secrets go too.
  // The bot itself stays in Telegram (@BotFather → /deletebot removes it). Logged, never the token.
  handleImportant('telegramDisconnect', 'Disconnecting Telegram', async () => {
    if (DEMO) return {ok: false, error: 'Demo mode: Telegram is not changed.'};
    const bot = storage.settings().telegramBot || '', buttons = !!storage.settings().telegramCloud;
    if (buttons) await telegramCloud.turnOff(storage);
    storage.setSecret('TELEGRAM_BOT_TOKEN', '');
    storage.saveSettings({telegramChatId: null, telegramBot: null, telegramOffset: null});
    restartTelegram();
    let inRepo = false;
    if (cloud()) inRepo = await github.removeRepoSecrets(storage, ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID']).catch(error => { appLog('connections', 'Telegram secrets not removed from GitHub', {error: error.message}); return 'failed'; });
    appLog('connections', 'Telegram disconnected', {from: 'settings', buttonsOff: buttons, github: inRepo});
    return {ok: true, bot, github: inRepo};
  });
  // Telegram: check the bot token, wait for the user to press Start, then listen for taps and commands.
  handleImportant('telegramConnect', 'Connecting Telegram', async (_, pasted) => {
    const gate = needsNotion('telegram');
    if (gate) return gate;
    const {value: token, error} = cleanSecret(pasted);
    if (error) return {ok: false, error};
    // A new bot: the old one's Worker goes (pairing needs getUpdates, which a webhook blocks); turn it on again after.
    if (storage.settings().telegramCloud) await telegramCloud.turnOff(storage);
    try {
      const bot = await telegram.api(token, 'getMe');
      toWindow('telegramWaiting', bot.username);
      const {chatId} = await telegram.pair(token);
      storage.setSecret('TELEGRAM_BOT_TOKEN', token);
      storage.saveSettings({telegramChatId: chatId, telegramBot: bot.username, telegramOffset: null});
      restartTelegram();
      return {ok: true, username: bot.username};
    } catch (error) {
      return {ok: false, error: error.code === 401 ? 'Telegram rejected this token. Copy it again from @BotFather.' : error.message};
    }
  });
}
