// Names the side-by-side preview after the session that made it, so the owner can tell whose image is open (docs/rules/desktop-ui.md). Guarded by test/preview-name.test.js.
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

// The session's short name, from the lookup that tags PR titles (tools/session-name.sh); '?' when unknown or there is no bash.
export function sessionShortName() {
  const run = spawnSync('bash', ['-c', 'source "$1"; session_name', 'x', path.join(repo, 'tools', 'session-name.sh')], {encoding: 'utf8'});
  const who = run.status === 0 ? run.stdout.trim() : '';
  return who && who !== '?' ? who.replace(/^jobadabra-/, '') : '?';
}

// `out` with "<short>-" in front of the file NAME (never the folder), unless it already starts with it; an unknown session leaves it as given.
export function previewPath(out, short) {
  if (!short || short === '?') return {path: out, named: false};
  const name = path.basename(out);
  if (name.startsWith(`${short}-`)) return {path: out, named: true};
  return {path: path.join(path.dirname(out), `${short}-${name}`), named: true};
}
