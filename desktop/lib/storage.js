// Everything the app keeps lives in the user's own folder (~/Library/Application Support/Jobadabra):
//   settings.json   choices that aren't secret (models, setup progress, Notion page ids)
//   secrets.json    API keys and tokens, each encrypted with a key held in the macOS Keychain
//   config/         the pipeline's search.json, preferences.json, sources.json, scout_seeds.json
//   profile.md, answers.md, cv.pdf, data/jobs.sqlite
import fs from 'node:fs';
import path from 'node:path';
import {twinSecret} from './twin.js';
import {writePrivate} from './private-file.js';

export const SECRET_NAMES = ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'NOTION_TOKEN', 'TELEGRAM_BOT_TOKEN', 'SERPAPI_API_KEY', 'BRAVE_SEARCH_API_KEY', 'ADZUNA_APP_ID', 'ADZUNA_APP_KEY', 'JOOBLE_API_KEY', 'EXTENSION_TOKEN', 'GITHUB_TOKEN', 'REPORT_TOKEN', 'CLOUDFLARE_API_TOKEN'];

export function createStorage(dir, crypto) {
  fs.mkdirSync(dir, {recursive: true});
  const file = name => path.join(dir, name);
  const readJson = (name, fallback) => {
    try { return JSON.parse(fs.readFileSync(file(name), 'utf8')); } catch { return fallback; }
  };
  const writeJson = (name, value) => writePrivate(file(name), JSON.stringify(value, null, 2) + '\n');
  // A secret this computer can no longer decrypt (6 Oct 2026: on Windows the app was killed soon after saving a key, Chromium's key file was never written,
  // and every start threw on decrypt: the window never appeared). It counts as missing, so the app opens and asks for it again; main.js logs which.
  const unreadable = new Set();
  const open = (name, sealed) => {
    try { const value = crypto.decrypt(sealed); unreadable.delete(name); return value; } catch { unreadable.add(name); return ''; }
  };

  return {
    dir,
    path: file,
    settings: () => readJson('settings.json', {}),
    saveSettings: patch => {
      const next = {...readJson('settings.json', {}), ...patch};
      writeJson('settings.json', next);
      return next;
    },
    setSecret(name, value) {
      if (!SECRET_NAMES.includes(name)) throw new Error(`Unknown secret ${name}`);
      const all = readJson('secrets.json', {});
      if (value) all[name] = crypto.encrypt(value); else delete all[name];
      writeJson('secrets.json', all);
      unreadable.delete(name);
    },
    secret(name) {
      const twin = twinSecret(name);   // a twin's Notion token comes from its environment, never the cloned folder (lib/twin.js)
      if (twin !== null) return twin;
      const sealed = readJson('secrets.json', {})[name];
      return sealed ? open(name, sealed) : '';
    },
    // Which secrets are set and usable, for the UI; never the values. One that cannot be decrypted shows as not set.
    secretsPresent: () => { const all = readJson('secrets.json', {}); return Object.fromEntries(SECRET_NAMES.map(name => [name, !!all[name] && !!open(name, all[name])])); },
    unreadableSecrets: () => [...unreadable],
    readText: name => { try { return fs.readFileSync(file(name), 'utf8'); } catch { return ''; } },
    writeText: (name, text) => {
      fs.mkdirSync(path.dirname(file(name)), {recursive: true});
      writePrivate(file(name), text);
    },
  };
}

// Electron's safeStorage wraps a key kept in the macOS Keychain; tests pass a stand-in.
export function safeStorageCrypto(safeStorage) {
  return {
    encrypt: value => safeStorage.encryptString(value).toString('base64'),
    decrypt: sealed => safeStorage.decryptString(Buffer.from(sealed, 'base64')),
  };
}
