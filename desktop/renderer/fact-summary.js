// Your details' fact cards as a calm summary (owner, 21 Oct 2026: "ugly, too disorganized, too crowded"): at most two columns of a short label over a short value,
// lines that say the same thing joined into one, the first few lines with "Show all N", and ONE "N to check" count in the card's header instead of a mark on every
// cell. Shortening is by shape only (a common start, a clause, a length), never by words; the full saved words stay on hover, nothing is dropped or invented.
// Guarded by test/fact-summary.test.js.
import {el, pill} from './components.js';
import {shortLabel, valueAndNote} from './survey-rows.js';
import {splitPermit} from './question-values.js';
import {NATIONALITY, STATUS_NAMES, ZONES, eligibilityOf, isOldAsked, isRowName, zoneOfLabel} from './work-eligibility.js';

export const SHOWN = 4;   // lines before "Show all N"
const VALUE_MAX = 48;

const trimLabel = text => text.trim().replace(/\?\s*$/, '').replace(/^the\s+/i, '').trim();
// The value's first clause (valueAndNote), cut at a word past VALUE_MAX; whether anything was cut says the full words go on hover.
export function shortValue(text) {
  const head = valueAndNote(String(text || '')).value;
  if (head.length <= VALUE_MAX) return head;
  const at = head.lastIndexOf(' ', VALUE_MAX);
  return `${head.slice(0, at > 20 ? at : VALUE_MAX).replace(/[\s,;:—–-]+$/, '')}…`;
}
// The words two labels start with (whole words, at least two), '' when they share none.
function sharedStart(labels) {
  const words = labels.map(label => label.split(/\s+/));
  let n = 0;
  while (words.every(each => each[n] !== undefined && each[n].toLowerCase() === words[0][n].toLowerCase())) n++;
  return n >= 2 && words.every(each => each.length > n) ? words[0].slice(0, n).join(' ') : '';
}

// lines: [{label, value, kind?, note?, check?}] -> [{label, value, title, check}]. Lines with the same value and the same first words join into one:
// "Authorised to work in the UK?" and "... the US?" with one answer read "UK · US", the answer once.
export function summaryLines(lines) {
  const rows = lines.filter(line => line.label && String(line.value ?? '').trim()).map(line => ({...line, key: String(line.value).trim().toLowerCase()}));
  const out = [], done = new Set();
  rows.forEach((row, at) => {
    if (done.has(at)) return;
    const same = rows.map((other, i) => [other, i]).filter(([other, i]) => !done.has(i) && other.key === row.key);
    const prefix = same.length > 1 ? sharedStart(same.map(([other]) => other.label)) : '';
    if (prefix) {
      same.forEach(([, i]) => done.add(i));
      out.push({label: same.map(([other]) => trimLabel(other.label.slice(prefix.length))).join(' · '), value: shortValue(row.value), title: `${same.map(([other]) => other.label).join('\n')}\n${row.value}`,
        check: same.some(([other]) => other.check)});
      return;
    }
    done.add(at);
    out.push({label: shortLabel(trimLabel(row.label), 34), value: shortValue(row.value), title: shortValue(row.value) === row.value && trimLabel(row.label) === shortLabel(trimLabel(row.label), 34) ? '' : `${row.label}\n${row.value}`, check: Boolean(row.check)});
  });
  return out;
}
export const checkCount = lines => summaryLines(lines).filter(line => line.check).length;

// The card's read view: a two-column grid of label over value; the rest folded behind "Show all N".
export function summaryView(lines, {shown = SHOWN} = {}) {
  const items = summaryLines(lines), box = el('div', 'fact-sum');
  const cell = line => { const node = el('div', 'fact-sum-cell'); node.append(el('span', 'fact-sum-label', line.label), el('span', 'fact-sum-value', line.value)); if (line.title) node.title = line.title; return node; };
  const grid = el('div', 'fact-sum-grid');
  grid.append(...items.slice(0, shown).map(cell));
  box.append(grid);
  if (items.length > shown) {
    const more = el('div', 'fact-sum-grid fact-sum-more'), toggle = Object.assign(el('button', 'link small', `Show all ${items.length}`), {type: 'button'});
    more.hidden = true;
    more.append(...items.slice(shown).map(cell));
    toggle.addEventListener('click', () => { more.hidden = !more.hidden; toggle.textContent = more.hidden ? `Show all ${items.length}` : 'Show fewer'; });
    box.append(more, toggle);
  }
  return box;
}

// Languages: one line of chips (English · B2), never a column each.
export function languagesView(lines, chipLine) {
  return chipLine(lines.filter(line => line.label && String(line.value ?? '').trim()).map(line => ({text: line.label, detail: String(line.value).trim()})));
}

// Work eligibility's read view (#2322): Nationality, then the three zones, each a chip with its status ("United Kingdom · Yes, freely"; a zone your nationality
// opens "· from your nationality"; one not set says so); then any other line (one saved before the zones) as a summary. -> {node, check} (check: the lines to look at, for the card's one count).
export function eligibilityView(lines, chipLine) {
  const detail = value => STATUS_NAMES[splitPermit(value).status] || shortValue(value);
  const {nationality, rows} = eligibilityOf(lines);
  const rest = lines.filter(line => line.label !== NATIONALITY && !(line.kind === 'per_country' && zoneOfLabel(line.label)) && String(line.value ?? '').trim() && !isOldAsked(line));
  const zoneChip = zone => {
    const row = rows.find(each => zoneOfLabel(each.label) === zone);
    if (!row) return {text: zone.label, detail: 'Not set', tone: 'warn'};
    return {text: zone.label, detail: row.from === 'nationality' ? 'Yes, freely · from your nationality' : detail(row.value)};
  };
  const box = el('div', 'fact-eligibility');
  const head = (words, node) => { const part = el('div', 'fact-eligibility-part'); part.append(el('span', 'fact-sum-label', words), node); return part; };
  box.append(head('Nationality', nationality?.length ? chipLine(nationality) : pill('Not set', 'warn')),
    head('Where you may work', chipLine(ZONES.map(zoneChip))));
  if (rest.length) box.append(summaryView(rest));
  const earlier = lines.some(line => line.earlier);
  if (earlier) box.append(el('p', 'muted small', 'Filled from your earlier answers: check them, then Save. The older lines are folded in, with Undo.'));
  return {node: box, check: lines.filter(line => line.check || line.earlier || (line.kind === 'per_country' && line.label && !isRowName(line.label) && !isOldAsked(line))).length};
}

// The one count of lines to check, in the card's title: "2 to check" (a pill), none when nothing is unclear.
export function checkBadge(count) {
  return count ? pill(`${count} to check`, 'warn', {title: 'Saved as you wrote it: Edit to pick the parts that make each one exact'}) : null;
}
