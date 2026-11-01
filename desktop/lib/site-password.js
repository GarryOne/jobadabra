// The user's one job-site password (src/ai/passwords.py makes it, Keychain item jobadabra.sites.password): Settings shows it,
// so they can sign in by hand too. Read straight from the Keychain, never through an engine run: a run's output goes to the log.
import {execFileSync} from 'node:child_process';
import * as keychain from './keychain.js';   // a test run or a twin: never the real Keychain the same way (lib/keychain.js)

export const SERVICE = 'jobadabra.sites.password';

// → the password, or null (none yet, or not a Mac: the Credential Manager is read by the engine only).
export function read(platform = process.platform, exec = execFileSync) {
  return keychain.read(SERVICE, {account: 'jobadabra', exec, platform});
}
