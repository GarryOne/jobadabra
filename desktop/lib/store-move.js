// "Move my data to Notion" (spec P4, docs/superpowers/specs/2026-10-09-store-adapters.md): the person's data goes from the store on this Mac
// to their Notion, once, in one direction. The engine copies every entity (src/stores/copy.py: resumable, a job matched by its URL, a text
// Notion already has wins); only when the copy finished does the store switch to Notion, and this Mac's files go to an archive folder
// (one copy in use). A copy that stops changes nothing: the next try goes on where it stopped. Guarded by test/store-move.test.js.
import fs from 'node:fs';
import path from 'node:path';
import * as notion from './notion.js';   // Notion-only: the move's Notion side (Move my data to Notion)
import * as notionGate from './notion-gate.js';
import * as pipelineRun from './pipeline-run.js';
import * as schema from './schema.js';
import * as strategy from './strategy-settings.js';
import * as inFlight from './engine-runs-in-flight.js';
import {ensureKnowledgePage} from './store/notion.js';

export const PROGRESS = /^moving (\w+) (\d+)\/(\d+)$/;
// What stays on this Mac after the move, out of use: the SQLite store, its files and the move's journal, the three texts.
export const ARCHIVED = ['data/tracker.sqlite', 'data/tracker.sqlite-wal', 'data/tracker.sqlite-shm', 'data/files', 'data/texts',
  'data/move-sqlite-to-notion.json', 'profile.md', 'answers.md', 'knowledge.md'];
export const STOPPED = 'The move stopped before the end. Nothing changed: your data is still on this Mac. Try again: it goes on where it stopped.';

const stamp = now => now.toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 13);

// -> {ok, moved: {entity: count}, kept: [texts Notion already had], archive} | notionGate.needs('move') | {ok: false, error}
export async function moveToNotion(storage, {run = pipelineRun.run, publish = strategy.publishSearchSettings, onProgress = () => {},
  log = () => {}, now = new Date(), knowledgePage = ensureKnowledgePage, repair = schema.repair} = {}) {
  if (storage.settings().store !== 'sqlite') return {ok: false, error: 'Your data is not on this Mac: there is nothing to move.'};
  if (!notionGate.connected(storage)) return notionGate.needs('move');   // the window connects, then runs the move again
  log('store', 'move started', {to: 'notion'});
  // The workspace's databases and columns first (config/notion_schema.json): on this Mac's store migrate.js runs nothing, so a workspace
  // connected for the move is repaired here, as a Notion user's is at each start.
  const fixed = await repair(storage.secret('NOTION_TOKEN'), storage.settings().notionIds || {});
  if (fixed?.ids) storage.saveSettings({notionIds: fixed.ids});
  // The Knowledge page is made on its first write; the copy writes texts whole into existing pages, so it must be there first.
  if (storage.readText('knowledge.md').trim()) await knowledgePage(storage);
  // A workspace the connect just built holds only the template's text on its Profile and answers pages: this Mac's are written over it.
  const texts = storage.settings().storeTextsWin ? ['--source-texts-win'] : [];
  const {code, stdout} = await run(storage, ['src.stores.copy', '--from', 'sqlite', '--to', 'notion', ...texts], line => {
    const step = PROGRESS.exec(String(line).trim());
    if (step) onProgress({entity: step[1], done: Number(step[2]), total: Number(step[3])});
  });
  let moved = null;
  try { moved = JSON.parse(String(stdout || '').trim().split('\n').pop()).moved; } catch {}
  if (code !== 0 || !moved) {
    log('store', 'move stopped', {code});
    return {ok: false, error: STOPPED};
  }
  // ⚙️ Search settings: their home stays config/*.json; with Notion they are also its readable page (as at a connect).
  await publish(storage, {run, ensurePage: notion.ensurePage, writePage: notion.writePage});
  const archive = storage.path(path.join('backup', `moved-to-notion-${stamp(now)}`));
  // Why (1 Nov 2026, night run 41253960704): a refresh the window started during the move still held the sqlite store and opened a new empty one after the archive.
  // The store switches first, so every run spawned from now on gets Notion; the runs already running end before their files go (lib/engine-runs-in-flight.js).
  storage.saveSettings({store: 'notion', storeMovedAt: now.toISOString(), storeArchive: archive, storeTextsWin: undefined});
  await inFlight.settled();
  for (const name of ARCHIVED) {
    const from = storage.path(name);
    if (!fs.existsSync(from)) continue;
    fs.mkdirSync(path.dirname(path.join(archive, name)), {recursive: true});
    fs.renameSync(from, path.join(archive, name));
  }
  const {kept = [], ...counts} = moved;
  log('store', 'moved', {to: 'notion', ...counts, kept: kept.length});
  return {ok: true, moved: counts, kept, archive};
}
