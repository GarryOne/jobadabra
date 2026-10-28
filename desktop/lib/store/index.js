// Where the user's data lives, for what the desktop reads and writes itself (its text pages and run history). The only place that picks
// an adapter: `openStore(storage)`. Everything else the app tracks is an engine command, which opens the same store from
// JOB_PILOTTO_STORE (lib/pipeline-env.js). Spec: docs/superpowers/specs/2026-10-09-store-adapters.md. Guarded by
// desktop/test/store-contract.test.js.
//
// A page (`store.page('profile' | 'answers' | 'knowledge')`): blocks(), outline(), text(), write(markdown), setText(block, text),
// remove(block, {ifUnchanged}) → false when its full text/cells changed (Notion restores a raced archive), append(lines),
// insertAfter(id, lines, {parent}), appendHeading(text) → id, setCell(row, index, text).
// Several removes on one page: last block first (this Mac's ids are line numbers).
// Runs (`store.runs`, Recent activity): list({size}) → activity records or null, close(link, reason) → bool, detail(link).
import * as notionGate from '../notion-gate.js';
import * as notionStore from './notion.js';
import * as sqliteStore from './sqlite.js';

export {CLOUD, FILES, LINKS} from './caps.js';
export const TEXTS = ['profile', 'answers', 'knowledge', 'portrait'];
const ADAPTERS = {[notionStore.NAME]: notionStore, [sqliteStore.NAME]: sqliteStore};
export const NAMES = Object.keys(ADAPTERS);

// The active store: settings.store when the person chose one; else Notion, as before 9 Oct 2026 (connected: no change; not yet
// connected: "trying", where tracking asks to connect). This Mac only once chosen (settings.store = 'sqlite').
export const chosen = storage => storage.settings().store || notionStore.NAME;

// "Trying" (Notion later, 3 Oct 2026): no store chosen and no Notion, so tracking still asks to connect Notion
// (lib/notion-gate.js) and the text pages say "Connect Notion first". Choosing this Mac (settings.store = 'sqlite') ends it.
export const trying = storage => !storage.settings().store && !notionGate.connected(storage);

export function openStore(storage, {fetcher, cache} = {}) {
  const name = chosen(storage);
  const adapter = ADAPTERS[name];
  if (!adapter) throw new Error(`No store called "${name}" (known: ${NAMES.join(', ')})`);
  return adapter.open(storage, {fetcher, cache});
}
