// Recent activity: the few-jobs help boxes beside the run card (coverage actions, Explain with AI).
// Split out of activity.js as a pure move. Guarded by the tests that read the activity-*.js sources (desktop/test/activity-source.js) and the e2e activity suites.
import {ai} from '../ai-name.js';
import {el} from '../components.js';
import {icon} from '../icons.js';
import {wand} from '../magic.js';
import {adviceEvent, fewJobsGroups, runAction} from '../coverage-actions.js';
import {openSetting} from './settings.js';
import {openView} from './nav.js';
import {reviewSuggestion} from './strategy.js';
import {keepPress, setPress, pressedButton, pressWhile} from './activity-visits.js';
import {openActivity} from './activity-panel.js';
import {startSearch} from './jobs.js';
import {sayRefused} from './startup.js';

// A jobs check with few new jobs: why, and what would bring more, as buttons on the card itself (owner, 6 Oct 2026). The actions come from the
// coverage answer (renderer/coverage-actions.js), least effort first; "Explain with AI" asks Claude only when clicked (src/ai/few_jobs.py).
// Asked once per run and kept: the panel redraws every second while open, and a box rebuilt empty then filled made the chips flash, with a
// Python start each time (6 Oct 2026). A redraw paints from here at once; so does an "Explain with AI" answer already given.
const fewJobsHelp = new Map();   // run id -> {actions: Promise<actions>, explained: {why, first_steps} | null}

export function withFewJobsHelp(runId) {
  // Owner mockup, 7 Oct 2026 (replacing the groups of the same day): two cards beside the run card. Employer coverage (numbers, the one
  // recommended action, the schedule folded), then other ways to broaden the search (a row each: what it is, its action), Explain with AI last.
  if (!fewJobsHelp.has(runId)) {
    fewJobsHelp.set(runId, {groups: window.pilot.searchCoverage().then(result => fewJobsGroups(result?.coverage)).catch(() => null), explained: null, asking: null, done: null});
  }
  const kept = fewJobsHelp.get(runId);
  const box = el('div', 'run-card-help');
  // A card's head: its icon, title and line, and an optional link on the right.
  const card = (glyph, title, sub, link = null) => {
    const part = el('section', 'ap-card few-card'), head = el('div', 'few-head'), words = el('div', '');
    words.append(el('h3', '', title), el('p', 'muted', sub));
    head.append(icon(glyph), words, ...(link ? [link] : []));
    part.append(head);
    return part;
  };
  const rows = items => { const list = el('ul', 'item-rows'); list.append(...items); return list; };
  const row = (glyph, name, sub, button, title = '') => {
    const line = el('li', '');
    const words = el('div', 'item-words');
    words.append(el('b', '', name), ...(Array.isArray(sub) ? sub : [sub]).map(text => el('span', 'muted', text)));
    if (title) line.title = title;
    button.classList.add('item-action');
    line.append(...(glyph ? [icon(glyph)] : []), words, button);
    return line;
  };
  // Its buttons go through the page's one mechanism (keepPress), keyed by this run: a redraw keeps them busy or done.
  const keepButton = (key, button) => keepPress(`few:${runId}:${key}`, button);
  const busyWhile = (key, work) => pressWhile(`few:${runId}:${key}`, '', work);
  const markDone = (key, text) => setPress(`few:${runId}:${key}`, {done: true, text});
  const onScreen = key => pressedButton(`few:${runId}:${key}`);
  // A job source opens its panel in Settings; a word (role, place, filter) opens its suggestion on Strategy, where the change is previewed
  // before it is made (taken here = followed there).
  const act = (action, button) => {
    adviceEvent('shown', action.kind, 'few-jobs', {source: action.value});
    keepButton(action.label, button);
    button.addEventListener('click', async () => {
      adviceEvent('taken', action.kind, 'few-jobs', {source: action.value});
      openActivity(false);
      if (action.row?.review) { reviewSuggestion(action.row.review); return; }
      await busyWhile(action.label, () => runAction(action, {pilot: window.pilot, openSetting})).catch(error => ({ok: false, error: error.message}));
    });
    return button;
  };
  const answer = el('div', 'muted small few-answer');
  const showAnswer = result => answer.replaceChildren(el('p', '', result.why), ...(result.first_steps || []).map((step, i) => el('p', '', `${i + 1}. ${step}`)));
  // The card redraws while a run is going: the pending question lives in `kept`, so a redraw keeps the spinner and the answer lands in the
  // card that is on screen, not in one already replaced.
  const showAsking = () => {
    const line = el('p', 'run-card-asking');
    line.append(el('span', 'spinner small'), ai('{AI} is reading this search\'s counts…'));
    answer.replaceChildren(line);
  };
  const explain = el('button', 'link with-icon', icon('sparkle'));
  explain.append('Understand these results with AI →');
  explain.title = ai('{AI} reads the counts of this search (never your CV) and says why it found few jobs, and what to do first');
  keepButton('explain', explain);
  const settle = result => {
    if (!result?.ok) { answer.textContent = result?.error || ai('{AI} could not answer now.'); return; }
    showAnswer(result);
  };
  if (kept.explained) showAnswer(kept.explained);
  else if (kept.asking) { showAsking(); kept.asking.then(settle); }
  explain.addEventListener('click', () => {
    adviceEvent('taken', 'explain', 'few-jobs');
    showAsking();
    kept.asking = busyWhile('explain', () => window.pilot.explainCoverage()).catch(error => ({ok: false, error: error.message})).then(result => {
      kept.asking = null;
      if (result?.ok) kept.explained = result;
      return result;
    });
    kept.asking.then(settle);
  });
  const why = el('div', 'few-explain');
  why.append(explain);
  const strategy = el('button', 'link', 'Review strategy ↗');
  strategy.type = 'button';
  strategy.addEventListener('click', () => { openActivity(false); openView('strategy'); });
  const paint = groups => {
    const parts = [];
    // One plain action in place of the employer numbers and schedule (owner, 24 Oct 2026); those live in Reports.
    if (groups?.employers) {
      const further = el('button', 'secondary item-action', 'Look further');
      further.type = 'button';
      further.addEventListener('click', () => { adviceEvent('taken', 'employer', 'few-jobs'); startSearch({employers: true}); });
      adviceEvent('shown', 'employer', 'few-jobs');
      const coverage = card('file', 'Find more employers', 'Searches for employers with jobs for you', further);
      parts.push(coverage);
    }
    const broaden = card('bulb', 'Other ways to broaden your search', 'Optional changes to your search and sources', strategy);
    const items = [];
    for (const action of groups?.words || []) {
      const button = Object.assign(el('button', 'secondary', action.row.button), {type: 'button', title: action.title});
      items.push(row(action.row.glyph, action.row.title, action.row.sub, act(action, button), action.title));
    }
    for (const source of groups?.sources || []) {
      items.push(row(source.id === 'serpapi' ? 'search' : 'link', source.name, source.sub,
        act({kind: 'source', label: `Set up ${source.name}`, value: source.id}, Object.assign(el('button', 'secondary', 'Set up'), {type: 'button'})), source.title));
    }
    if (groups?.visits?.length) {
      // One row, handed to Find jobs using your browser (owner, 7 Oct 2026: "pass them to Find jobs using your browser"): the extension reads them all in Chrome, a few at a time.
      const names = groups.siteNames;
      const shown = names.slice(0, 2).join(' · ') + (names.length > 2 ? ` and ${names.length - 2} more` : '');
      adviceEvent('shown', 'visit', 'few-jobs');
      // Why (#2350, Gitar): a site read starts AI work in Chrome, so its button carries the wand (test/wand-cursor.test.js).
      const read = wand(Object.assign(el('button', 'secondary', 'Read them in Chrome'), {type: 'button', title: 'Opens them in your Chrome, two at a time; the Jobadabra extension filters and reads each, then your next check scores the jobs'}));
      keepButton('read-sites', read);
      read.addEventListener('click', async () => {
        const result = await busyWhile('read-sites', () => window.pilot.visitsRun({urls: groups.visits.map(site => site.url), atOnce: 2, filter: true})).catch(error => ({text: error.message}));
        if (result?.started) { adviceEvent('taken', 'visit', 'few-jobs'); markDone('read-sites', '✓ Reading in Chrome'); return; }
        onScreen('read-sites').title = result?.text || read.title;
        sayRefused('Reading did not start', {ok: false, error: result?.text || result?.error || 'Try again.'}, {place: {activity: true}});   // said, not only in the button's tooltip (renderer/refusal.js)
      });
      items.push(row('external', 'Browse sites manually', [`${names.length} site${names.length === 1 ? '' : 's'} need${names.length === 1 ? 's' : ''} to be opened in Chrome`, shown], read));
    }
    broaden.append(items.length ? rows(items) : el('p', 'muted small', 'Nothing obvious to change yet.'), why, answer);
    parts.push(broaden);
    box.replaceChildren(...parts);
  };
  const waiting = card('bulb', 'Other ways to broaden your search', 'Optional changes to your search and sources', strategy);
  waiting.append(why, answer);
  box.append(waiting);
  if (kept.ready !== undefined) paint(kept.ready); else kept.groups.then(groups => { kept.ready = groups; paint(groups); });
  return box;
}
