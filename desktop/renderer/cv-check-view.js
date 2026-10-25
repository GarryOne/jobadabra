// Profile → CV: the CV check card (owner review fix 8, mockup 08, 18 Oct 2026). Two score rings (readability, content), the recommended fixes first with a
// priority chip and their fix behind "View details", then three folds (passed checks, score breakdown with what works and the missing terms, extracted
// text), then the two actions with their cost line. The header says when and on which CV the result was made (a result belongs to one PDF: lib/cv-check.js
// drops it when the PDF changes). A folded card says "Mostly readable · 3 issues · 2 content suggestions". Moved here from pages/profile.js;
// model: cv-check-model.js. Guarded by test/cv-check-model.test.js and test/cv-check-view.test.js.
import {el, pill} from './components.js';
import {costText} from './ai-cost.js';
import {icon} from './icons.js';
import {costLine, fixesOf, passedOf, scoreTone, summaryOf} from './cv-check-model.js';

const $ = id => document.getElementById(id);
const TONE = {high: 'bad', medium: 'warn', low: 'neutral'};
const LABEL = {high: 'High', medium: 'Medium', low: 'Low'};
let last = null;   // the result shown, with how a review would be paid now
export const lastCheck = () => last;

// A score as a ring filled to its value, the number inside, its name and meaning beside it.
function scoreTile(kind, score, title, meaning) {
  const tile = el('div', 'cvc-tile');
  const ring = el('span', `cvc-ring tone-${scoreTone(kind, score)}`);
  ring.style.setProperty('--p', String(score));
  ring.append(el('b', '', String(score)));
  const words = el('div');
  const line = el('div', 'cvc-tile-score');
  line.append(el('b', '', String(score)), el('span', 'muted small', ' / 100'));
  words.append(el('span', 'cvc-tile-title', title), line, el('span', 'muted small', meaning));
  tile.append(ring, words);
  return tile;
}
function emptyTile(title, meaning) {
  const tile = el('div', 'cvc-tile is-empty');
  const words = el('div');
  words.append(el('span', 'cvc-tile-title', title), el('span', 'muted small', meaning));
  tile.append(el('span', 'cvc-ring'), words);
  return tile;
}

// One fix: its priority, what to change and why; "View details" opens the concrete change and says which check found it.
function fixRow(fix) {
  const row = el('details', 'cvc-fixline');
  const head = el('summary');
  const words = el('div', 'cvc-fix-words');
  words.append(el('b', '', fix.title), el('span', 'muted small', fix.issue));
  head.append(pill(LABEL[fix.priority], TONE[fix.priority]), words, el('span', 'cvc-more small', 'View details'), icon('chevron', 'icon cvc-chevron'));
  const body = el('div', 'cvc-fix-body');
  if (fix.suggestion) body.append(el('span', 'cvc-fix', `Fix: ${fix.suggestion}`));
  body.append(el('span', 'muted small', fix.from === 'content' ? 'From the content review' : 'From the readability check'));
  row.append(head, body);
  return row;
}

function fold(glyph, title, count, children) {
  const box = el('details', 'cvc-fold');
  const head = el('summary');
  head.append(icon(glyph), el('b', '', title), ...(count === '' ? [] : [el('span', 'muted', `· ${count}`)]), icon('chevron', 'icon cvc-chevron'));
  box.append(head, ...children);
  return box;
}
const part = (title, text) => { const row = el('div', 'cvc-comp'); row.append(el('b', '', title), el('span', 'muted small', text)); return row; };

// data: lib/cv-check.js's saved result (or null) plus `billing`; cvName: the CV's file name, said in the header.
// Beside the scores (mockup 08), never a line of its own: what kind of score this is.
const assessmentNote = () => { const note = el('p', 'cvc-note muted small'); note.append(icon('info'), "App assessment, not an employer's score (they do not publish one)."); return note; };

export function showCvCheck(data, {cvName = '', when = at => at} = {}) {
  last = data;
  const ats = data?.ats, ai = data?.ai, card = $('setting-cvcheck');
  card.dataset.summary = summaryOf(data);   // what the folded card says (profile-fold.js)
  $('cvc-state').textContent = ats ? `Checked ${when(data.at)} · ${cvName || 'current CV'}` : 'Not checked yet';
  $('cvc-state').classList.toggle('is-off', !ats);   // no green dot before a check
  $('cvc-scores').hidden = !ats;
  $('cvc-scores').replaceChildren(...(ats ? [scoreTile('readability', ats.score, 'Readability', 'How easily your CV can be read and parsed.'),
    ai ? scoreTile('content', ai.score, 'Content', 'How well it presents your experience and skills.') : emptyTile('Content', 'Not reviewed yet: Review CV content below.'),
    assessmentNote()] : []));
  const fixes = fixesOf(data);
  $('cvc-fixes').hidden = !ats;
  $('cvc-fixes').replaceChildren(...(ats ? [el('h4', '', 'Recommended fixes'),
    ...(fixes.length ? fixes.map(fixRow) : [el('p', 'muted small', 'Nothing to fix: every check passed.')])] : []));
  const folds = [];
  if (ats) {
    const passed = passedOf(data);
    if (passed.length) {
      const list = el('ul', 'cvc-checks');
      list.append(...passed.map(check => { const row = el('li', 'cvc-check is-pass'), body = el('div'); body.append(el('b', '', check.label), el('span', 'muted small', check.detail)); row.append(el('span', 'cvc-mark', '✓'), body); return row; }));
      folds.push(fold('check-circle', 'Passed checks', passed.length, [list]));
    }
    const parts = [part(`Readability · ${ats.score}`, `${ats.verdict} · ${ats.pages} page${ats.pages === 1 ? '' : 's'}`)];
    if (ai) {
      parts.push(...ai.components.map(item => part(`${item.name} · ${item.score}`, item.note)));
      if (ai.strengths.length) parts.push(part('Working well', ai.strengths.join(' · ')));
      if (ai.missing_keywords.length) parts.push(part('Terms the target roles ask for that the CV never states', `${ai.missing_keywords.join(', ')}. Add one only if it is true.`));
      const spent = ai.billing !== 'subscription' && costText(ai.usd);
      if (spent) parts.push(part('Cost of this review', spent));
    }
    folds.push(fold('chart', 'Score breakdown', '', parts));
    const text = el('pre', 'cvc-pre', ats.text);
    folds.push(fold('file-text', 'Extracted text', '', [el('p', 'muted small', 'What a parser reads, in order.'), text]));
  }
  $('cvc-folds').hidden = !folds.length;
  $('cvc-folds').replaceChildren(...folds);
  $('cvc-ai-run').disabled = !ats;
  $('cvc-ai-run').title = ats ? '' : 'Check PDF readability first: the review reads what the parser read.';
  $('cvc-run-cost').textContent = costLine('readability');
  $('cvc-ai-cost').textContent = ats ? costLine('content', {billing: data?.billing, ai}) : 'Runs after the readability check';
}

// An action pressed: its label says what it does meanwhile, then the card is drawn from the answer. options(): showCvCheck's options plus say(text, tone),
// the page's message line (pages/core.js message, passed in so this file loads without the page).
export async function cvCheckAction(button, working, run, options) {
  const label = button.querySelector('span') || button, was = label.textContent;
  button.disabled = true;
  label.textContent = working;
  options().say('');
  const result = await run().catch(error => ({ok: false, error: error.message}));
  button.disabled = false;
  label.textContent = was;
  if (!result.ok) { options().say(result.error, 'error'); return; }
  showCvCheck(result, options());
}
