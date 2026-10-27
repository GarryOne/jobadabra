// Automatically organize legacy unplaced and newly saved lines through the existing AI seam, preserving exact sources until their destinations read back.
import {createHash} from 'node:crypto';
import {openStore} from './store/index.js';
import {itemsOf, judge, saveCopy, unsureKey} from './profile-move.js';
import {contexts, destinations, headingIn} from './profile-destinations.js';
import * as clarity from './answer-clarity.js';
import {log} from './log.js';

const running = new Map(), retried = new Map(), DAY = 24 * 3600 * 1000;
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const contentKey = line => unsureKey({...line, page: ''});
const sourceKey = line => JSON.stringify([line.page, line.context, contentKey(line)]);
const lineText = line => line.label ? `${line.label}: ${line.value}` : line.value;
const ownLines = (outline, page) => {
  const paths = contexts(outline);
  return itemsOf(outline, page, {includeOwned: true}).map(line => ({...line, context: paths.get(line.id.slice(page.length + 1)) || []}));
};
const read = async opened => Object.fromEntries(await Promise.all(['profile', 'answers'].map(async page => [page, await opened.page(page).outline()])));
const linesOf = outlines => Object.entries(outlines).flatMap(([page, outline]) => ownLines(outline, page));

/** Join concurrent reads. The in-memory retry timer holds only a digest/deadline, never a second source of applicant data. */
export function organize(storage, options = {}) {
  const key = storage.dir;
  if (running.has(key)) return running.get(key);
  const task = route(storage, options).finally(() => { if (running.get(key) === task) running.delete(key); });
  running.set(key, task);
  return task;
}
async function route(storage, {fetcher, ai = {}, now = new Date(), copy = saveCopy, fresh = []} = {}) {
  const pending = storage.settings().profileUnsure || [], empty = {judged: 0, moved: 0, unclear: 0};
  if (!(ai.client || ai.apiKey) || (!pending.length && !fresh.length)) return empty;
  const stamp = digest(pending), retry = retried.get(storage.dir);
  if (!fresh.length && retry?.stamp === stamp && now.getTime() < retry.after) return empty;
  const opened = openStore(storage, {fetcher, cache: false}), outlines = await read(opened);
  const wanted = new Set(pending.map(unsureKey)), freshIds = new Set(fresh.map(line => line.id));
  const candidates = linesOf(outlines).filter(line => wanted.has(unsureKey(line)) || freshIds.has(line.id));
  if (!candidates.length) return empty;
  const catalogue = destinations(outlines), byId = new Map(catalogue.map(each => [each.id, each]));
  const judged = await judge(candidates, ai, {destinations: catalogue});
  // The person may have edited a line while the model answered. A stale decision must never recreate that previous value.
  const current = linesOf(await read(opened)), live = new Set(current.map(sourceKey));
  const chosen = new Map(), incompatible = new Set(), handled = new Set();
  for (const line of candidates) {
    const said = judged.get(line.id), identity = sourceKey(line);
    if (!live.has(identity)) continue;
    if (said?.home === 'stay' || line.home) { handled.add(identity); continue; }
    if (!byId.has(said?.home)) continue;
    if (chosen.has(identity) && chosen.get(identity).home !== said.home) incompatible.add(identity);
    chosen.set(identity, {line, home: said.home});
  }
  for (const identity of incompatible) chosen.delete(identity);
  const groups = new Map();
  for (const [identity, {line, home}] of chosen) {
    const destination = byId.get(home);
    if (destination.page === line.page && JSON.stringify(destination.path) === JSON.stringify(line.context)) { handled.add(identity); continue; }
    const key = `${home}\n${contentKey(line)}`;
    if (!groups.has(key)) groups.set(key, {destination, line, sources: new Set()});
    groups.get(key).sources.add(identity);
  }
  if (groups.size) await copy(storage, {fetcher, now});
  let moved = 0;
  const removeExact = async (page, identity) => {
    const outline = await opened.page(page).outline();
    const line = ownLines(outline, page).find(each => sourceKey(each) === identity);
    if (!line) return false;
    const id = line.id.slice(page.length + 1), block = outline.flatMap(each => each.rows || [each]).find(each => each.id === id);
    return opened.page(page).remove(block, {ifUnchanged: true});
  };
  // Each move reads its source again after backup/heading IO, verifies the destination, then conditionally removes only unchanged originals.
  for (const {destination, line, sources} of groups.values()) {
    const page = opened.page(destination.page);
    const liveSources = async () => linesOf(await read(opened)).filter(each => sources.has(sourceKey(each)));
    if (!(await liveSources()).length) continue;
    let outline = await page.outline(), heading = headingIn(outline, destination);
    if (!heading && !destination.canonical) throw Error('The saved-line destination changed; originals were kept');
    if (!heading) { await page.appendHeading(destination.heading); outline = await page.outline(); heading = headingIn(outline, destination); }
    if (!heading) throw Error('The saved-line heading did not save; originals were kept');
    if (!(await liveSources()).length) continue;
    const target = {...line, page: destination.page, context: destination.path}, targetKey = sourceKey(target);
    const existed = ownLines(outline, destination.page).some(each => sourceKey(each) === targetKey);
    if (!existed) await page.insertAfter(heading.id, [lineText(line)]);
    const targetExists = async () => ownLines(await page.outline(), destination.page).some(each => sourceKey(each) === targetKey);
    if (!await targetExists()) throw Error('The saved-line destination did not read back; originals were kept');
    let removed = 0;
    // Re-read after every removal: Markdown IDs are line numbers and a person can edit Notion between requests.
    for (const identity of sources) {
      if (identity === targetKey) continue;
      let original;
      while ((original = (await liveSources()).find(each => sourceKey(each) === identity))) {
        if (!await targetExists()) throw Error('The saved-line destination changed; remaining originals were kept');
        if (!await removeExact(original.page, identity)) break;
        removed++;
      }
    }
    if (!removed && !existed) await removeExact(destination.page, targetKey);   // discard only our unchanged stale copy, never a person's edit
    if (removed || existed) {
      moved++;
      for (const identity of sources) if (!(await liveSources()).some(each => sourceKey(each) === identity)) handled.add(identity);
    }
  }
  const tracked = new Map(pending.map(entry => [unsureKey(entry), entry]));
  for (const line of candidates) if (!tracked.has(unsureKey(line))) tracked.set(unsureKey(line), {page: line.page, label: line.label, value: line.value});
  const remaining = [...tracked.values()].filter(entry => {
    const matches = candidates.filter(line => unsureKey(line) === unsureKey(entry));
    return !matches.length || matches.some(line => !handled.has(sourceKey(line)));
  });
  storage.saveSettings({profileUnsure: remaining});
  clarity.record(storage, candidates, judged, {now, present: linesOf(await read(opened))});
  retried.set(storage.dir, {stamp: digest(remaining), after: now.getTime() + DAY});
  log('profile', 'unplaced lines organized from validated AI destinations', {requestedBy: 'saved questions read', sources: candidates.length, moved, remaining: remaining.length, stale: candidates.filter(line => !live.has(sourceKey(line))).length});
  return {judged: candidates.length, moved, unclear: candidates.filter(line => clarity.UNCLEAR[judged.get(line.id)?.clarity]).length};
}
