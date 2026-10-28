// Standard answers as sections of questions (Settings → Profile → Standard answers), from the page's outline on any store: a section per
// heading; a question per table row [Question | Answer] or per "Question: answer" line ("**Question:** answer" on this Mac); any other line of a
// section is a note. A value that starts with ❓ is NOT SET: the ❓ is data (lib/questions.js lists those as "Answer once"), never shown; the
// words after it are the hint. Each item knows the change that writes it back (one cell, or one line with its own label kept). No DOM:
// guarded by test/answers-model.test.js. A question's kind mark ("[pick one: Mr | Mrs]", question-kind.js) is read into .mark and kept on every write.
import {splitMark, withMark} from './question-kind.js';

const UNSET = /^\s*❓\s*/;
const ASKED = /\s*\(asked by ([^)]*)\)\s*$/;
// "**Question:** answer", "**Question?** answer", "Question: answer", "Question — answer": the label part kept as written.
const LABELLED = /^(\*\*(.+?)\*\*:?|([^:|]{1,90}?)(?::| —))(?:\s+|$)(.*)$/;
const LONG = /^(.{91,}):\s+([^:]{1,80})$/;
const plain = text => String(text).replace(/\*\*/g, '').replace(/[\s:*]+$/, '').replace(/^[\s*]+/, '').trim();

// "❓ to confirm — leave blank" → {open: true, hint: 'leave blank'}; "❓ (asked by Acme)" → {open, asked: 'Acme'}; "Leave blank" → {open: false}.
// An empty answer is not set either (owner, 18 Oct 2026: his "How to pronounce your name" was left empty); "… (guess)" is an answer not yet confirmed: the
// value without the mark, .guess (an older kit wrote it; the row says "Unconfirmed" until it is saved again).
const GUESS = /\s*\(guess\)\.?\s*$/i;
// A learning's state (PR B2, owner 28 Oct 2026: New / Confirmed / Two answers; lib/learnings.js writes it): "… (new)" a form fill taught it, "… (two answers:
// other)" a later form was given another answer; confirmed has no mark. Any save of the row writes it without one (changeFor): saving is confirming.
const NEW = /\s*\(new\)\.?\s*$/i, TWO = /\s*\(two answers:\s*([^()]*)\)\s*$/i;
export const STATES = ['new', 'guess', 'conflict'];
/** "Yes" + 'new' → "Yes (new)"; + 'conflict', other → "Yes (two answers: No)" (the other answer's brackets dropped: the mark has none inside); '' → "Yes". */
export function withState(value, state = '', other = '') {
  const text = String(value ?? '').trim();
  if (state === 'conflict') return `${text} (two answers: ${String(other ?? '').replace(/[()]/g, '').replace(/\s+/g, ' ').trim()})`;
  return state === 'new' || state === 'guess' ? `${text} (${state})` : text;
}
export function valueOf(raw) {
  const text = String(raw ?? '').trim();
  if (!text) return {open: true, optional: false, value: '', hint: '', asked: ''};
  if (TWO.test(text)) return {open: false, optional: false, state: 'conflict', other: text.match(TWO)[1].trim(), value: text.replace(TWO, '').trim(), hint: '', asked: ''};
  if (NEW.test(text)) return {open: false, optional: false, state: 'new', value: text.replace(NEW, '').trim(), hint: '', asked: ''};
  if (GUESS.test(text)) return {open: false, optional: false, guess: true, state: 'guess', value: text.replace(GUESS, '').trim(), hint: '', asked: ''};
  if (!UNSET.test(text)) return {open: false, optional: false, value: text, hint: '', asked: ''};
  const asked = text.match(ASKED)?.[1] || '';
  const hint = text.replace(UNSET, '').replace(ASKED, '').replace(/^\(|\)$/g, '').replace(/^(to confirm|optional)\s*[—:-]?\s*/i, '').trim();
  // "❓ optional": the drafting AI found nothing in the CV for it (GitHub, a portfolio): it stays on the page but is not "missing".
  return {open: true, optional: /^\s*❓\s*optional\b/i.test(text), value: '', hint, asked};
}

// "**Notice:** 3 months" → {head: '**Notice:**', question: 'Notice', raw: '3 months'}; a line with no label → null.
export function labelledLine(text) {
  const match = String(text).match(LABELLED);
  if (match && plain(match[2] || match[3])) return {head: match[1], question: plain(match[2] || match[3]), raw: match[4].replace(/^:\s*/, '')};   // "Q: : A": the label's own colon
  // A form's own question can be long (owner's screenshot, 17 Oct 2026: 120-character questions showed as prose): "<question>: <short answer>", the
  // answer after the last ": " with no colon in it, is still a question; a long sentence with no such ending stays a note.
  const long = String(text).match(LONG);
  return long ? {head: `${long[1]}:`, question: plain(long[1]), raw: long[2]} : null;
}
const markOf = split => (split.marked ? {kind: split.kind, options: split.options, ...(split.list ? {list: split.list} : {}), ...(split.constraints ? {constraints: true} : {})} : null);
function lineItem(item) {
  const split = splitMark(item.text), line = labelledLine(split.text);
  if (!line) return {id: item.id, kind: 'note', question: '', ...valueOf(item.text), text: item.text, mark: null};
  return {id: item.id, kind: 'line', head: line.head, question: line.question, ...valueOf(line.raw), text: item.text, mark: markOf(split)};
}

// → [{title, after: the id a new question of this section is inserted after, items: [{id, kind: 'cell' | 'line' | 'note', question, value, open, hint, asked}]}]
export function sections(items) {
  const out = [];
  let current = null;
  const section = title => { current = {title, items: []}; out.push(current); return current; };
  const walk = (list, top = true) => {
    for (const item of list || []) {
      if (/^heading_/.test(item.type)) { section(plain(item.text) || item.text).after = item.id; continue; }
      const into = current || section('');
      if (top) into.after = item.id;   // where a question added to this section goes
      if (item.type === 'table') {
        for (const row of (item.rows || []).slice(item.header ? 1 : 0)) {
          const [question = '', answer = ''] = row.cells;
          const split = splitMark(question);
          if (split.text.trim()) into.items.push({id: row.id, kind: 'cell', question: plain(split.text.replace(/❓/g, '')), was: answer, cell: question, mark: markOf(split), ...valueOf(answer)});
        }
      } else if (item.text?.trim()) into.items.push(lineItem(item));
      if (item.children) walk(item.children, false);
    }
  };
  walk(items);
  return out.filter(each => each.items.length);
}

// The change that writes `value` for an item (an empty value makes it not set again: ❓ back where the answer goes). format: the kind to keep on a line
// (default its own mark); a table row keeps its mark in its question cell (kindChange).
export function changeFor(item, value, format = item.mark) {
  const text = String(value ?? '').replace(/\s*\n\s*/g, ' ').trim();
  if (item.kind === 'cell') return {op: 'cell', id: item.id, index: 1, value: text || '❓', was: item.was};
  if (item.kind === 'line') return {op: 'text', id: item.id, value: withMark(`${item.head} ${text || '❓'}`, format), was: item.text};
  return {op: 'text', id: item.id, value: text, was: item.text};
}
// A table row's new kind, written in its question cell (a line's kind goes with its answer: changeFor(item, value, format)).
export const kindChange = (item, format) => ({op: 'cell', id: item.id, index: 0, value: withMark(item.cell ?? item.question, format), was: item.cell ?? item.question});
// A question added by the person: a "Question: answer" line at the end of its section (after its last block), or of the page.
export const lineFor = (question, value) => `${String(question).replace(/[\s:]+$/, '').trim()}: ${String(value || '').trim() || '❓'}`;

export const matches = (item, {query = '', attention = false} = {}) => (!attention || item.open)
  && (!query || [item.question, item.value, item.hint].some(part => String(part || '').toLowerCase().includes(query.toLowerCase())));
// Shown text never carries the ❓ mark (owner, 16 Oct 2026): a sentence that mentions it says "not set".
export const shown = text => String(text ?? '').replace(/\s*❓\s*/g, ' not set ').replace(/\s+/g, ' ').trim();
