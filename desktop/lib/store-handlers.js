// Settings → Data & backup → "Your data": where the person's data lives (lib/store), choosing this Mac while trying, and
// "Move my data to Notion" (spec P4, lib/store-move.js). The window reads capabilities and a label, never an
// adapter's name. Guarded by test/store-handlers.test.js.
import * as notionGate from './notion-gate.js';
import * as engine from './store/engine.js';
import * as store from './store/index.js';
import {moveToNotion} from './store-move.js';

// Whether the data may live on this Mac. On since the engine's store callers are done (bridges 0, test/bridge-registry.test.js and
// tests/test_store_readiness.py); JOBADABRA_STORE_CHOICE=0 turns it off (the old "Notion only" app, for a bisect).
export const STORE_CHOICE = process.env.JOBADABRA_STORE_CHOICE !== '0';

// At start, an install with no store yet gets its home once (spec D2, D7): a connected Notion stays Notion, with no change for the
// person; anything else (a new install) is this Mac, with nothing to set up. Written, never re-derived: connecting Notion later
// (for Always on) does not move the data; "Move my data to Notion" does (D3). Returns the store chosen now, or null.
export function settleStore(storage, {choice = STORE_CHOICE, log = () => {}} = {}) {
  if (!choice || storage.settings().store) return null;
  const home = notionGate.connected(storage) ? 'notion' : 'sqlite';
  storage.saveSettings({store: home});
  log('store', 'chosen', {store: home, from: home === 'notion' ? 'Notion already connected' : 'new install', decidedBy: 'first start'});   // about Notion
  return home;
}

// {label, caps, trying, tracking, choice}: what the card shows. tracking is the gate's own answer (lib/notion-gate.js): the window locks pages
// and keeps them from reading by it, so Notion chosen but not connected is gated there too (#410).
export function storeState(storage, {choice = STORE_CHOICE} = {}) {
  const opened = store.openStore(storage);
  return {label: opened.label, caps: [...opened.caps], trying: store.trying(storage), tracking: notionGate.tracking(storage), notionConnected: notionGate.connected(storage), choice};
}

// "Start using Notion" (spec D3, owner 9 Oct 2026): Notion connected while this Mac's store is still empty switches the store to Notion at once,
// with nothing to move; with data, the store stays and "Move my data to Notion" is the way. Empty is read from the store's contents, never
// from a flag: no job (a kit lives on its job), event, interview or agent run. The texts the setup wrote (profile, answers, form knowledge)
// and the search's matches are not counted: the connect itself carries them to Notion (lib/migrate.js, pipeline.syncMatches).
export const DATA_ENTITIES = ['applications', 'events', 'interviews', 'agent_runs'];
export async function hasData(storage, {call = engine.call} = {}) {
  for (const entity of DATA_ENTITIES) if ((await call(storage, entity, 'list')).length) return true;
  return false;
}
export async function startOnNotionIfEmpty(storage, {call = engine.call, log = () => {}} = {}) {
  if (storage.settings().store !== 'sqlite') return false;
  if (await hasData(storage, {call})) return false;
  storage.saveSettings({store: 'notion'});
  log('store', 'chosen', {store: 'notion', from: 'this Mac, still empty', decidedBy: 'Notion connected'});   // about Notion
  return true;
}

export function registerStoreHandlers({ipcMain, storage, DEMO, log, choice = STORE_CHOICE, toWindow = () => {}, move = moveToNotion}) {
  ipcMain.handle('storeState', () => storeState(storage, {choice}));
  // Trying → this Mac: the one switch made by hand. Leaving a store is the move (one-way, spec D3/D4), never this.
  ipcMain.handle('keepOnThisMac', () => {
    if (!choice) return {ok: false, error: 'Choosing where your data lives is not available yet.'};
    if (DEMO) return {ok: true, store: storeState(storage, {choice})};
    if (!store.trying(storage)) return {ok: false, error: 'Your data already has a home: it can only move to Notion.'};   // about Notion
    storage.saveSettings({store: 'sqlite'});
    log('store', 'chosen', {store: 'sqlite', from: 'trying'});
    return {ok: true, store: storeState(storage, {choice})};
  });
  // "Move my data to Notion" (spec P4, lib/store-move.js): progress goes to the window as 'storeMoveProgress' {entity, done, total}.
  let moving = null;
  ipcMain.handle('moveToNotion', async () => {
    if (DEMO) return {ok: false, error: 'Demo mode: nothing moves.'};
    if (moving) return moving;   // one move at a time: a second press waits for the first
    moving = move(storage, {log, onProgress: progress => toWindow('storeMoveProgress', progress)})
      .then(result => (result.ok ? {...result, store: storeState(storage, {choice})} : result))
      .finally(() => { moving = null; });
    return moving;
  });
}
