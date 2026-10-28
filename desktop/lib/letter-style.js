// The cover letter style ("Writing preferences" on Profile → Cover letter): rules such as "Never mention: salary", kept beside the letter in
// cover-letter/style.json {lines, updatedAt}. Why (PR B1b, owner 28 Oct 2026: "everything about the cover letter should be only in Cover Letter tab";
// "Beside the letter"): they were the "Cover letter style" section of the answers page. That section is still written there by the Strategy draft and the
// line organizer (lib/strategy.js, lib/profile-destinations.js): each read moves it into the file and off the page, so the file is the one home and no
// prompt changed. Letter writers get the rules back as that same section of the answers text (withStyle); the engine's kit reads the file by path
// (JOB_PILOTTO_LETTER_STYLE_FILE, src/ai/kit.py). Guarded by test/letter-style-file.test.js.
import fs from 'node:fs';
import path from 'node:path';
import {openStore} from './store/index.js';
import * as sqliteStore from './store/sqlite.js';
import {STYLE_HEADING, isStyle} from '../renderer/writing-preferences-model.js';
import {log} from './log.js';

export const FILE = 'cover-letter/style.json';
const clean = lines => [...new Set((lines || []).map(line => String(line || '').replace(/^[-*]\s+/, '').trim()).filter(Boolean))];

function fromFile(storage) {
  try { return clean(JSON.parse(fs.readFileSync(storage.path(FILE), 'utf8')).lines); } catch { return []; }
}

/** Writes the rules (temp file, then rename: a reader never sees half a file). -> the rules kept. */
export function save(storage, lines) {
  const kept = clean(lines), file = storage.path(FILE), temp = `${file}.${process.pid}.tmp`;
  fs.mkdirSync(path.dirname(file), {recursive: true});
  fs.writeFileSync(temp, JSON.stringify({lines: kept, updatedAt: new Date().toISOString()}, null, 1));
  fs.renameSync(temp, file);
  return kept;
}

/**
 * Saves an edit of the rules the editor was opened on (was): its lines, then every rule of the file now that the editor never showed. Why (Gitar on
 * #2328): a rule moved into the file while the editor was open (a letter's read of a section the Strategy draft or the organizer wrote) is kept; a
 * rule the editor showed and changed or removed leaves. -> the rules kept.
 */
export async function saveEdit(storage, lines, was = []) {
  const shown = new Set(clean(was)), next = clean(lines);
  return save(storage, [...next, ...(await read(storage)).filter(line => !shown.has(line))]);
}

// The "Cover letter style" heading and its lines on the answers page: [{block, lines}], last section first (removal order).
function sectionsOn(blocks) {
  const found = [];
  let current = null;
  for (const block of blocks) {
    if (block.type.startsWith('heading')) { current = isStyle(block.text) ? {heading: block, items: []} : null; if (current) found.push(current); continue; }
    if (current && /list_item|paragraph/.test(block.type) && block.text.trim()) current.items.push(block);
  }
  return found.reverse();
}

/**
 * The rules, after moving any "Cover letter style" section of the answers page into the file (invariant: once a read returns, the page holds no
 * such section that the file lacks). A store that cannot be read or edited leaves the page as it is and adds its lines to what is returned.
 * demo: the demo folder is the app's own committed files (lib/demo.js): read through this Mac's adapter, nothing moved, nothing written.
 */
export async function read(storage, {fetcher, demo = false} = {}) {
  const have = fromFile(storage);
  let page, found;
  try { page = (demo ? sqliteStore.open(storage) : openStore(storage, {fetcher})).page('answers'); found = sectionsOn(await page.blocks()); } catch { return have; }
  if (!found.length) return have;
  const moved = clean([...have, ...found.flatMap(section => section.items.map(block => block.text))]);
  if (demo) return moved;
  try {
    save(storage, moved);
    if (fromFile(storage).length !== moved.length) return moved;   // not kept: the page stays as it is
    for (const section of found) for (const block of [...section.items].reverse().concat(section.heading)) await page.remove(block);
    log('letter-style', `moved ${moved.length - have.length} rule(s) from the answers page beside the letter`);
  } catch (error) { log('letter-style', `the style section stays on the answers page: ${error.message}`); }
  return moved;
}

// The answers text without a "Cover letter style" section (one read before the move, or a store that could not be edited).
function withoutStyle(text) {
  let inStyle = false;
  return String(text || '').split('\n').filter(line => {
    const heading = line.match(/^#{1,6}\s+(.*)$/);
    if (heading) inStyle = isStyle(heading[1]);
    return !inStyle;
  }).join('\n').trimEnd();
}

/** The answers text a letter writer reads, with the rules as its one "Cover letter style" section (the prompts follow that section). */
export const withStyle = (answers, lines) => (clean(lines).length ? `${withoutStyle(answers)}\n\n## ${STYLE_HEADING}\n${clean(lines).map(line => `- ${line}`).join('\n')}` : withoutStyle(answers));
