// Where the app under test keeps the person's data in a run (spec docs/superpowers/specs/2026-10-09-store-adapters.md, P7: every suite runs with
// NO Notion token). 'sqlite': this Mac's store (settings.store = 'sqlite'), no Notion at all. 'standin': the Notion store on the in-memory
// Notion (lib/notion-fake.mjs), fresh per run. 'notion': the real test workspace with a token, only for a suite that pins it (`export const
// store = 'notion'`, the release gate's notion-real). Guarded by test/store.test.mjs.
import {isCi} from './engine.mjs';

export const STORES = ['sqlite', 'standin', 'notion'];

// E2E_STORE pins one; E2E_NOTION_STANDIN=1 is the older name for 'standin'. CI alternates by run number on bit 1, so it is independent of the AI
// family (bit 0, lib/engine.mjs pickFamily): runs 0,1 sqlite, 2,3 stand-in, and every family meets every store. A Mac with nothing pinned:
// this Mac's store, what a new install gets (E2E_STORE=standin for a suite's Notion path).
export function pickStore({env = process.env, suiteStore = ''} = {}) {
  if (suiteStore) {
    if (!STORES.includes(suiteStore)) throw new Error(`a suite's store must be ${STORES.join(', ')}, not "${suiteStore}"`);
    return suiteStore;
  }
  const pinned = env.E2E_STORE || (env.E2E_NOTION_STANDIN === '1' ? 'standin' : '');
  if (pinned && !['sqlite', 'standin', 'alternate'].includes(pinned)) throw new Error(`E2E_STORE must be sqlite, standin or alternate, not "${pinned}" (the real workspace is only for a suite that pins it)`);
  if (pinned && pinned !== 'alternate') return pinned;
  if (!isCi(env) && pinned !== 'alternate') return 'sqlite';
  return (Number(env.GITHUB_RUN_NUMBER || 0) >> 1) & 1 ? 'standin' : 'sqlite';
}

// The settings a fresh profile starts with for that store, always written: with the store choice on, a profile with none is given one at
// start (lib/store-handlers.js settleStore: this Mac unless Notion is already connected), so a Notion run must say so.
export const storeSettings = store => ({store: store === 'sqlite' ? 'sqlite' : 'notion'});

// Where Notion's requests end for a store (the fault proxy's far side, lib/notion-proxy.mjs): the stand-in when there is one, real Notion only for the real
// workspace (or a suite with no store: notion = false), and a dead local port on this Mac's store, so a stray request fails instead of leaving the computer.
export function notionFarSide({store, standIn = ''}) {
  if (standIn) return standIn;
  if (store === 'notion' || !store) return 'https://api.notion.com';
  return 'http://127.0.0.1:9';
}

// The Notion token a run uses: the stand-in's own, none on this Mac's store, and one from the environment only on the real workspace (or a suite with no store).
// A real token in the environment (the Keychain's, run-all.mjs) never reaches a run off the real workspace (9 Oct 2026: on SQLite it did, and the setup tried to connect).
export function runToken({store, standIn = null, light = false, fromEnv = () => ''}) {
  if (light) return '';
  if (standIn) return standIn.token;
  if (store && store !== 'notion') return '';
  return fromEnv();
}
