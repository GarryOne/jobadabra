// "Added by you" in the experience bank (Insights PR 2, spec docs/superpowers/specs/2026-10-28-insights-with-actions-design.md): what the person added themselves
// after an insight: a skill, a bullet attached to a main-CV role, or a correction such as "Python: 3 years". Kept in cv/added.json beside the sources.
// The main CV file is never changed (owner, 28 Oct 2026): withExtras (experience.js) applies these to the copy tailoring reads, and About you's `cv` part carries them.
// Guarded by test/experience-added.test.js.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {dir} from './cv.js';
import {writePrivate} from './private-file.js';

export const NAME = 'Added by you';
export const MAX_ITEMS = 60;   // a person adds a handful of lines after insights; more is a loop, not a bank
const fileOf = storage => path.join(dir(storage), 'added.json');

/** The items [{id, kind: 'skill'|'bullet'|'correction', text, mainJob?, mainRole?, mainKey?, addedAt}], oldest first; [] when none or unreadable. */
export function readAdded(storage) {
  try {
    const items = JSON.parse(fs.readFileSync(fileOf(storage), 'utf8')).items;
    return Array.isArray(items) ? items.filter(item => item && typeof item.id === 'string' && typeof item.text === 'string') : [];
  } catch { return []; }
}

const save = (storage, items) => {
  fs.mkdirSync(dir(storage), {recursive: true});
  writePrivate(fileOf(storage), JSON.stringify({items}, null, 2) + '\n');
};
const clean = text => String(text || '').replace(/\s+/g, ' ').trim().slice(0, 400);

function add(storage, fields, now) {
  const items = readAdded(storage), text = clean(fields.text);
  if (!text) throw new Error('Nothing to add.');
  if (items.length >= MAX_ITEMS) throw new Error(`Up to ${MAX_ITEMS} lines added by you: remove one first.`);
  const same = items.find(item => item.kind === fields.kind && item.text.toLowerCase() === text.toLowerCase() && item.mainJob === fields.mainJob && item.mainRole === fields.mainRole);
  if (same) return same;
  const item = {id: crypto.randomBytes(4).toString('hex'), ...fields, text, addedAt: now.toISOString()};
  save(storage, [...items, item]);
  return item;
}

/** One skill the tailored CV may state (the main CV's skills line is not edited). Adding it twice keeps one. */
export const addSkill = (storage, skill, now = new Date()) => add(storage, {kind: 'skill', text: skill}, now);

/** A correction in the person's words ("Python: 3 years"); tailoring and the readers see it as written. */
export const addCorrection = (storage, text, now = new Date()) => add(storage, {kind: 'correction', text}, now);

/** A bullet for one role of the main CV (indexes into main.jobs[mainJob].roles[mainRole]); `key` is experience.js mainKey(main), which says the shape it was written against. */
export function addBullet(storage, main, key, {mainJob, mainRole, text}, now = new Date()) {
  if (!main?.jobs?.[mainJob]?.roles?.[mainRole]) throw new Error('That role is not in your main CV.');
  return add(storage, {kind: 'bullet', text, mainJob, mainRole, mainKey: key}, now);
}

/** Take one item away; false when there was none with that id. */
export function removeAdded(storage, id) {
  const items = readAdded(storage), kept = items.filter(item => item.id !== String(id));
  if (kept.length === items.length) return false;
  save(storage, kept);
  return true;
}

/**
 * Apply the items to a copy of the CV (mutates `out`): skills join `skills`, bullets join their role flagged `extra` (only while the main CV has the shape they were
 * written against), corrections go to `corrections`. Never invents a role; an item that no longer fits is left out, not deleted.
 */
export function applyAdded(out, items, key) {
  const have = new Set(String(out.skills || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean));
  const skills = items.filter(item => item.kind === 'skill' && !have.has(item.text.toLowerCase())).map(item => item.text);
  if (skills.length) out.skills = [out.skills, ...skills].filter(Boolean).join(', ');
  for (const item of items.filter(i => i.kind === 'bullet' && i.mainKey === key)) {
    const role = out.jobs[item.mainJob]?.roles[item.mainRole];
    if (!role || role.bullets.some(b => b.toLowerCase() === item.text.toLowerCase())) continue;
    role.extra ||= []; role.extraFrom ||= {};
    role.extra.push(role.bullets.length);
    role.extraFrom[role.bullets.length] = NAME;
    role.bullets.push(item.text);
  }
  const corrections = items.filter(item => item.kind === 'correction').map(item => item.text);
  if (corrections.length) out.corrections = corrections;
  return out;
}
