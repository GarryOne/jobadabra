// Strategy, the "What you're targeting" lists edited in the app: which lists, cleaning the edits, applying them, editLists.
// Re-exported by strategy.js. Guarded by desktop/test/strategy-edit-loading.test.js and strategy-targets.test.js.
import {ADD_ROLES_ATTEMPTS, escapeRegex, publishSearchSettings} from './strategy-settings.js';
import {editTitles, titlesOf} from './target-roles.js';

// The Strategy page's "What you're targeting", edited in the app (owner, 7 Oct 2026: "Edit preferences" opened the Profile page, where
// the places shown on the card are not, and he wants to edit here, not in Notion). A fixed set of lists; the window sends, per list,
// the stored fragments to remove and the words to add. Same loop as retune(): sync the page, change the cache, publish, check it stayed.
// Each list: [settings file, path in it, stored as written (plain) or as a match fragment]. The search phrases and the languages that hide a
// job are plain text; the rest are match fragments (owner, 7 Oct 2026: the Strategy page shows and edits everything the setup review has).
// roles is the one list of titles (lib/target-roles.js: the first five also searched on job boards): plain titles, kept as target_roles.
export const EDITABLE_LISTS = {roles: ['search', ['target_roles'], true, 'roles'], places: ['search', ['locations', 'top_tier']], country: ['search', ['locations', 'country_wide']],
  abroad: ['search', ['locations', 'abroad']], searchOverride: ['search', ['locations', 'search_override']], stack: ['search', ['quality_stack_keywords']],
  languages: ['preferences', ['disqualifying_languages'], true], rights: ['preferences', ['work_rights']],
  // What only the ⚙️ Search settings page had (P8, 9 Oct 2026): every store edits them here. A Google Jobs place is stored as
  // {location, language} and edited as "Location · language", as the page writes it (src/notion/search_settings.py 'place').
  skip: ['preferences', ['excluded_companies'], true], titleSkip: ['search', ['title_exclude_keywords']], remoteSkip: ['search', ['remote_excluded_regions']], finders: ['search', ['board_discovery_keywords']],
  gqueries: ['search', ['google_jobs', 'queries'], true], gplaces: ['search', ['google_jobs', 'locations'], true, 'place']};
// One value each, set rather than added to: the level the search keeps to ('' = any) and the digest's minimum fit score.
export const LEVELS = ['', 'junior', 'mid', 'senior', 'lead'];
// Relocation (Locations, 17 Oct 2026) is a value of its own: "no" and "not specified" are answers, not missing data (the places abroad stay).
const RELOCATION = ['yes', 'no', 'unspecified'];
const SCALARS = {
  relocation: {valid: value => RELOCATION.includes(value), apply: (next, value) => { next.search.locations.relocation = [value]; },
    read: files => [files.search?.locations?.relocation].flat().filter(Boolean)[0] || ''},
  level: {valid: value => LEVELS.includes(value), apply: (next, value) => { next.search.level = value ? [value] : []; },
    read: files => [files.search?.level].flat().filter(Boolean)[0] || ''},
  minScore: {valid: value => Number.isInteger(value) && value >= 0 && value <= 100, apply: (next, value) => { next.preferences.digest_min_score = value; },
    read: files => files.preferences?.digest_min_score},
};
const placeText = place => (place && typeof place === 'object' ? [place.location, place.language].filter(Boolean).join(' · ') : String(place ?? ''));
const placeOf = text => { const [location, language] = String(text).split(' · ').map(part => part.trim()); return {location, ...(language ? {language} : {})}; };
const FILES = {search: 'config/search.json', preferences: 'config/preferences.json'};
const listAt = (data, path) => (path.length === 1 ? data[path[0]] : data[path[0]]?.[path[1]]) || [];
// A list as text entries (a place as "Location · language"), and back to how its file keeps it.
const textsAt = (data, name) => name === 'roles' ? titlesOf(data) : listAt(data, EDITABLE_LISTS[name][1]).map(EDITABLE_LISTS[name][3] === 'place' ? placeText : String);
const stored = (name, list) => (EDITABLE_LISTS[name][3] === 'place' ? list.map(placeOf) : list);
const lowerSet = list => new Set(list.map(item => String(item).toLowerCase()));
// edits: {list: {add, remove}}, and remote: {set: 'Yes' | 'No'} (the search settings' "Remote jobs").
export function cleanEdits(edits) {
  const out = {};
  for (const [name, edit] of Object.entries(edits && typeof edits === 'object' ? edits : {})) {
    if (name === 'remote') { if (['Yes', 'No'].includes(edit?.set)) out.remote = {set: edit.set}; continue; }
    if (SCALARS[name]) { if (edit && SCALARS[name].valid(edit.set)) out[name] = {set: edit.set}; continue; }
    if (!EDITABLE_LISTS[name] || !edit || typeof edit !== 'object') continue;
    const plain = EDITABLE_LISTS[name][2];
    // A match word typed as "word" (Strategy's "Whole word only" group, renderer/match-groups.js) is stored as \bword\b.
    const whole = word => !plain && /^".*"$/s.test(word);
    const add = [...new Set((Array.isArray(edit.add) ? edit.add : []).map(word => String(word).trim()).map(word => (plain ? word : word.toLowerCase()))
      .map(word => ({word: whole(word) ? word.slice(1, -1).trim() : word, whole: whole(word)}))
      .filter(({word}) => word.length >= 2 && word.length <= 60 && !/[\n\r]/.test(word))
      .map(({word, whole}) => (plain ? word : whole ? `\\b${escapeRegex(word)}\\b` : escapeRegex(word))))].slice(0, 20);
    const remove = (Array.isArray(edit.remove) ? edit.remove : []).map(String).filter(Boolean).slice(0, 100);
    if (add.length || remove.length) out[name] = {add, remove};
  }
  return out;
}
// files: {search, preferences} as parsed; returns the same shape with the edits applied (the inputs are not changed).
export function applyEdits(files, edits) {
  const google = files.search?.google_jobs || edits.gqueries || edits.gplaces ? {google_jobs: {...files.search?.google_jobs}} : {};   // never an empty one added
  const next = {search: {...files.search, locations: {...files.search?.locations}, ...google}, preferences: {...files.preferences}};
  for (const [name, edit] of Object.entries(edits)) {
    if (name === 'remote') { next.search.remote_jobs = [edit.set]; continue; }
    if (SCALARS[name]) { SCALARS[name].apply(next, edit.set); continue; }
    if (name === 'roles') { next.search = editTitles(next.search, edit); continue; }
    const [file, path] = EDITABLE_LISTS[name], gone = lowerSet(edit.remove), data = next[file];
    const kept = textsAt(data, name).filter(item => !gone.has(String(item).toLowerCase()));
    const have = lowerSet(kept);
    const list = stored(name, [...kept, ...edit.add.filter(item => !have.has(item.toLowerCase()))]);
    if (path.length === 1) data[path[0]] = list; else data[path[0]][path[1]] = list;
  }
  return next;
}
export const edited = (files, edits) => Object.entries(edits).every(([name, edit]) => {
  if (name === 'remote') return (files.search?.remote_jobs || [])[0] === edit.set;
  if (SCALARS[name]) return SCALARS[name].read(files) === edit.set;
  const [file] = EDITABLE_LISTS[name], have = lowerSet(textsAt(files[file] || {}, name));
  return edit.add.every(item => have.has(item.toLowerCase())) && edit.remove.every(item => !have.has(item.toLowerCase()));
});
const readFiles = storage => Object.fromEntries(Object.entries(FILES).map(([name, file]) => [name, JSON.parse(storage.readText(file) || '{}')]));
export async function editLists(storage, asked, {run, ensurePage, writePage, wait = ms => new Promise(resolve => setTimeout(resolve, ms))}) {
  const edits = cleanEdits(asked);
  if (!Object.keys(edits).length) return {changed: []};
  for (let attempt = 0; attempt < ADD_ROLES_ATTEMPTS; attempt++) {
    if (attempt) await wait(2000 * attempt);
    await run(storage, ['src.notion.search_settings', 'sync']);
    const before = Object.fromEntries(Object.values(FILES).map(file => [file, storage.readText(file)]));
    const files = readFiles(storage);
    if (edited(files, edits)) return {changed: Object.keys(edits)};
    const next = applyEdits(files, edits);
    for (const [name, file] of Object.entries(FILES)) {
      if (JSON.stringify(next[name]) !== JSON.stringify(files[name])) storage.writeText(file, JSON.stringify(next[name], null, 2) + '\n');
    }
    // A role in another field redraws the words drawn from the old one (board words, stack, Google Jobs searches: src/field_redraft.py).
    if (edits.roles) await run(storage, ['src.field_redraft', 'apply']).catch(() => null);
    try {
      await publishSearchSettings(storage, {run, ensurePage, writePage});
      if (edited(readFiles(storage), edits)) return {changed: Object.keys(edits)};
    } catch (error) {
      for (const [file, text] of Object.entries(before)) if (text != null && storage.readText(file) !== text) storage.writeText(file, text);
      throw error;
    }
  }
  throw new Error('A search changed your settings while they were being saved. Try again.');
}

