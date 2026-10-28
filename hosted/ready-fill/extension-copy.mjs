// The night's copy of extension/ for Ready to send (private spec jobadabra-lab:docs/specs/2026-10-17-ready-to-send.md, floors): its app address is the stand-in's port, any site is allowed (a fresh Chromium has not pressed Allow),
// and the account form's button is never pressed (phase 1 makes no account on the server). extension/ itself is never edited. Guard: desktop/test/ready-fill.test.js (fails when a patched line moved).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const APP_ADDRESS = 'http://127.0.0.1:47111';   // extension/flow.js APP
export const ACCOUNT_PRESS = "if (move === 'fill-press' && !(await alreadyTried(tab, submitKey))) {";
export const HELD_PRESS = "if (move === 'fill-press') decide('fill', 'HELD for the night: no account is made on the server', {host});\n  if (false && move === 'fill-press' && !(await alreadyTried(tab, submitKey))) {";

// Pure: the text of account-step.js with the press held. Throws when the line is gone: a copy that silently pressed the button would make an account.
export function holdAccountPress(text) {
  if (!text.includes(ACCOUNT_PRESS)) throw new Error('extension/account-step.js no longer contains the press guard: update ready-fill/extension-copy.mjs (the night must not press the account button)');
  return text.replace(ACCOUNT_PRESS, HELD_PRESS);
}
export function pointAtStandIn(text, port) {
  if (!text.includes(APP_ADDRESS)) throw new Error(`extension/flow.js no longer contains ${APP_ADDRESS}: update ready-fill/extension-copy.mjs`);
  return text.replaceAll(APP_ADDRESS, `http://127.0.0.1:${port}`);
}

// -> the folder of the copy.
export function copyForNight(port, from, into = '', {owned = false} = {}) {
  const dir = into || path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'jp-night-ext-')), 'extension');
  fs.cpSync(from, dir, {recursive: true});
  const edit = (file, change) => { const target = path.join(dir, file); fs.writeFileSync(target, change(fs.readFileSync(target, 'utf8'))); };
  edit('flow.js', text => pointAtStandIn(text, port));
  edit('account-step.js', holdAccountPress);
  edit('manifest.json', text => { const manifest = JSON.parse(text); manifest.host_permissions = [...new Set([...(manifest.host_permissions || []), 'https://*/*'])]; return JSON.stringify(manifest, null, 2); });
  if (owned) {
    fs.writeFileSync(path.join(dir, 'owned-bootstrap.js'), '// Owned background browser: suppress first-install setup windows.\nglobalThis.__jobPilottoBackgroundOwned = true;\n');
    fs.writeFileSync(path.join(dir, 'background-owned.js'), "// Reuse the actual extension worker after the owned-browser flag is installed.\nimport './owned-bootstrap.js';\nimport './background.js';\n");
    edit('manifest.json', text => { const manifest = JSON.parse(text); manifest.background.service_worker = 'background-owned.js'; return JSON.stringify(manifest, null, 2); });
  }
  // Why (2026-10-28, owner screenshot): an app on the default port 47111 has nothing to rewrite, so the address is meant to stay; the check only guards a copy pointed elsewhere.
  const left = Number(port) === 47111 ? [] : fs.readdirSync(dir).filter(file => file.endsWith('.js') && fs.readFileSync(path.join(dir, file), 'utf8').includes('127.0.0.1:47111'));
  if (left.length) throw new Error(`the night's extension still mentions 127.0.0.1:47111 in ${left.join(', ')}`);
  return dir;
}
