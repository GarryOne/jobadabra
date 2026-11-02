// Apply needs the Chrome extension (it fills the form): with none installed the app asks to install it first instead of opening a tab nobody fills.
import * as extensionInstall from './extension-install.js';
import * as pipeline from './pipeline.js';
import * as server from './server.js';
import path from 'node:path';

export const EXTENSION_REASONS = {
  absent: 'Jobadabra fills the application form through its Chrome extension, and it is not installed yet.',
  off: 'Jobadabra fills the application form through its Chrome extension, and it is turned off in your browser.',
};

// {ok: false, needsExtension: true, state, error} when a form tab would open with nothing to fill it; null when it may go on.
// An extension that has reported to this app is never blocked, and a failed read of the browser profiles never blocks either.
export function check({find = extensionInstall.installed, seen = server.extensionSeen, folder = path.join(pipeline.REPO, 'extension')} = {}) {
  try {
    if (seen()) return null;
    const copies = find({folder});
    if (copies.some(copy => copy.enabled)) return null;
    const state = copies.length ? 'off' : 'absent';
    return {ok: false, needsExtension: true, state, text: EXTENSION_REASONS[state], error: `${EXTENSION_REASONS[state]} Install it first, then press Apply again.`};
  } catch { return null; }
}

// What the app's handlers call (main.js passes it in): the e2e harness has its own browser profile and no installed copy to find.
export const extensionGate = () => (process.env.JOBADABRA_E2E ? null : check());
