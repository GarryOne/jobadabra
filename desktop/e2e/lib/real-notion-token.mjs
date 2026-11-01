// The app's own current Notion token, for the twin's one-way sync only (owner, 17 Oct 2026): read from the real secrets.json the way the app does (lib/storage.js), handed to the copy tool through the child's environment alone.
// Never printed, logged, written to a file or put in argv. Runs under Electron (real-notion-token-main.mjs: safeStorage works only there). Guarded by test/real-notion-token.test.mjs.
import {spawnSync} from 'node:child_process';
import {createStorage, safeStorageCrypto} from '../../lib/storage.js';

export const TOKEN_VAR = 'JP_TWIN_SOURCE_NOTION_TOKEN';

// The token, or throws a plain sentence (no fallback to any other copy of a token).
export function appToken(folder, safeStorage) {
  if (!safeStorage.isEncryptionAvailable()) throw new Error('the app\'s Notion token cannot be decrypted here: macOS safeStorage is not available');
  const token = createStorage(folder, safeStorageCrypto(safeStorage)).secret('NOTION_TOKEN');   // '' when missing or not decryptable
  if (!token) throw new Error(`the app's own Notion token cannot be read from ${folder}/secrets.json (missing, or this process may not use the app's key: allow the Keychain prompt once)`);
  return token;
}

// Runs command (argv) with the token in its environment only; returns its exit status.
export function runWithAppToken({folder, safeStorage, command, env = process.env, spawn = spawnSync}) {
  const token = appToken(folder, safeStorage);
  const result = spawn(command[0], command.slice(1), {env: {...env, [TOKEN_VAR]: token}, stdio: ['ignore', 'ignore', 'inherit']});
  return result.status ?? 1;
}
