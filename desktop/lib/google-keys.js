// The Google sign-in (Gmail and Calendar, read-only) as the Python side saved it (src/sources/google.py KEYCHAIN),
// read from this Mac's Keychain so Always on can give the same sign-in to the user's GitHub repo. Never logged.
import {execFileSync} from 'node:child_process';
import {read} from './keychain.js';

export const GOOGLE_KEYCHAIN = {GOOGLE_CLIENT_ID: 'jobadabra.google.client-id', GOOGLE_CLIENT_SECRET: 'jobadabra.google.client-secret',
  GOOGLE_REFRESH_TOKEN: 'jobadabra.google.refresh-token'};

// Which of Gmail / Calendar the user allowed (src/sources/google_scopes.py): optional, an older sign-in has none and counts as both.
export const GOOGLE_SCOPES_KEYCHAIN = {GOOGLE_SCOPES: 'jobadabra.google.scopes'};

const keychain = service => read(service, {exec: execFileSync}) || '';   // a test run or a twin reads none of the owner's (lib/keychain.js)

// All three or nothing (a partial sign-in can't be used). macOS only for now: elsewhere {} (connect Google there).
export function googleSecrets(read = keychain, platform = process.platform) {
  if (platform !== 'darwin' && read === keychain) return {};
  const values = Object.fromEntries(Object.entries(GOOGLE_KEYCHAIN).map(([name, service]) => [name, read(service)]));
  if (!Object.values(values).every(Boolean)) return {};
  const scopes = read(GOOGLE_SCOPES_KEYCHAIN.GOOGLE_SCOPES);
  return scopes ? {...values, GOOGLE_SCOPES: scopes} : values;
}
