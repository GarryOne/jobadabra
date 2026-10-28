// Answer once is an inbox (owner, 17 Oct 2026): each answer goes to its one home. A fact of Your details (right to work, notice, the salary you
// state, a language) becomes a line of that section (lib/profile-sections.js); anything else stays a standard answer (lib/questions.js). The AI
// picks only the home (lib/profile-move.js judge, the move's own words), never the value; no AI or a failed call: it stays a standard answer.
// A line already there with the same label is replaced (the newer answer wins: you just typed it). Guarded by test/answer-home.test.js.
import * as sections from './profile-sections.js';
import {judge} from './profile-move.js';
import {COMPOSITE} from '../renderer/question-kind.js';

const same = text => String(text || '').replace(/\*\*/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
export const HOME_NAMES = Object.fromEntries(Object.entries(sections.SECTIONS).map(([key, heading]) => [key, `Your details → ${heading}`]));

// -> a section key, or '' (a standard answer).
export async function homeOf(question, value, ai = {}) {
  if (!question || !value || !(ai.client || ai.apiKey)) return '';
  try {
    const home = (await judge([{id: 'q', label: question, value}], ai)).get('q')?.home;
    return sections.SECTIONS[home] ? home : '';
  } catch { return ''; }
}

// Writes the line into its section and reads it back. -> true when it is there (then the caller may remove the open question), false otherwise.
// kind: the line's own kind for a base fact that has one (a zone's status is "[per country]", #2322); '' for words.
export async function writeHome(storage, home, question, value, fetcher, save = sections.save, kind = '') {
  const current = (await sections.read(storage, fetcher))[home] || [];
  const kept = current.filter(line => same(line.label) !== same(question));
  await save(storage, home, [...kept, {label: question, value, ...(COMPOSITE.includes(kind) ? {kind} : {})}], fetcher);
  return ((await sections.read(storage, fetcher))[home] || []).some(line => same(line.label) === same(question) && same(line.value) === same(value));
}
