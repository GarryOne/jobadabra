// Settings → Profile → Your details' fact sections over IPC (lib/profile-sections.js): read them (the facts move in on the first open and again
// when new fact answers wait: lib/profile-move.js moveDue, copy and backup first), save them with Contact, and the owner's pick for "Which is right?". Registered by
// lib/contact-handlers.js. Guarded by test/details-facts.test.js and test/ipc.test.js.
import * as sections from './profile-sections.js';
import {move, moveDue, openConflicts, resolve} from './profile-move.js';
import {judgeNew} from './details-review.js';
import {claudeAi} from './question-ai.js';
import * as kinds from './details-kinds.js';
import * as notes from './details-notes.js';
import * as surveys from './survey-move.js';
import {list} from './set-aside.js';
import {beforeSave, undoFold} from './eligibility-older.js';
import {settle} from './eligibility-settle.js';
import {suggest as suggestZones} from './zone-suggest.js';

// Demo mode: fictional lines (the screenshots), one "Which is right?".
const DEMO_FACTS = {eligibility: [{label: 'Nationality', value: 'United Kingdom'}, {label: 'EU / EEA + Switzerland', value: 'yes, with a permit', kind: 'per_country'},
    {label: 'United States', value: 'no, needs sponsorship', kind: 'per_country'}],
  availability: [{label: 'Target', value: '10000 CHF/month net', kind: 'salary', note: 'Treat as a target, not a posted field.'},
    {label: 'Salary expectation, UK', value: '120000 GBP/year', kind: 'salary', note: 'Minimum · Confirmed 26 Sep 2026.'},
    {label: 'Notice period', value: '1 month, ends at month-end', kind: 'duration', note: 'For a start-date field, give a concrete date.'},
    {label: 'Salary expectation, Switzerland', value: '140000 CHF/year', kind: 'salary'}, {label: 'Salary expectation, Germany', value: '105000 EUR/year', kind: 'salary'},
    {label: 'Salary expectation, US', value: '150000 USD/year', kind: 'salary'}, {label: 'Earliest start date', value: '1 January 2027'},
    {label: 'Open to remote work?', value: 'Yes. Remote roles: CHF 140,000, EUR 105,000, GBP 120,000, USD 150,000 per year, depending on the employer\'s country.'}],
  languages: [{label: 'English', value: 'B2', kind: 'language'}, {label: 'Romanian', value: 'native', kind: 'language'}, {label: 'Russian', value: 'B1', kind: 'language'},
    {label: 'Languages I can work in (note)', value: 'No French, German or Italian.'}]};
// What the AI read in the older lines (lib/eligibility-older.js): fictional, for the screenshots.
const DEMO_OLDER = [];
const DEMO_WHICH = [{home: 'availability', topic: 'notice period', choices: [{label: 'Notice period', value: '2 months', page: 'profile'}, {label: 'Notice period / earliest start', value: '3 months', page: 'answers'}]}];
const empty = () => Object.fromEntries(Object.keys(sections.SECTIONS).map(key => [key, []]));

// ai/copy: a test passes its own.
export function registerDetailsFactsHandlers({ipcMain, storage, DEMO, connected, needsNotion, log, ai = () => claudeAi(storage), copy}) {
  const tidied = () => {
    const {detailsTidy: lines, surveyTidy: survey, eligibilityFold: fold} = storage.settings(), live = [lines, survey, fold].filter(done => done && !done.undone);
    return live.length ? {changed: live.reduce((sum, done) => sum + done.changed, 0), eligibility: fold && !fold.undone ? fold.changed : 0, at: live.map(done => done.at).sort().at(-1)} : null;
  };
  // One open at a time: the moves read, change and read back the same lines, so a second open in the middle (a slow Notion open takes ~45 s) saw the first's
  // lines as "did not save" and rolled them back (owner's app.log, 17 Oct 2026). A second open gets the first's answer.
  let opening = null;
  const open = async () => {
    if (DEMO) return {ok: true, sections: storage.settings().demoFacts || DEMO_FACTS, older: storage.settings().demoOlder || DEMO_OLDER, conflicts: storage.settings().demoWhich ?? DEMO_WHICH, setAside: storage.settings().demoSetAside || []};
    if (!connected()) return {ok: true, sections: empty(), conflicts: [], setAside: []};
    let error = '', changed = 0;
    const started = Date.now();
    if (moveDue(storage.settings())) {
      try {
        const {moved, conflicts} = await move(storage, {ai: ai(), ...(copy ? {copy} : {})});   // Why (B2c): a test's copy reaches the move too, never the real backup folder
        log('profile', 'facts moved into Your details', {moved, conflicts: conflicts.length});   // counts, never a value
      } catch (failed) { error = failed.message; log('profile', 'the facts move stopped', {error: failed.message}); }
    }
    try {
      const tidy = await kinds.tidy(storage, {ai: ai(), ...(copy ? {copy} : {})}).catch(failed => { error = error || failed.message; log('profile', 'the kinds tidy stopped', {error: failed.message}); return {changed: 0}; });
      const split = await notes.split(storage, {ai: ai(), ...(copy ? {copy} : {})}).catch(failed => { error = error || failed.message; log('profile', 'the notes split stopped', {error: failed.message}); return {changed: 0}; });
      if (split.changed) log('profile', 'long Your details lines got a note for the AI', {changed: split.changed});   // a count, never a value
      const moved = await surveys.migrate(storage, {ai: ai(), ...(copy ? {copy} : {})}).catch(failed => { error = error || failed.message; log('profile', 'the survey move stopped', {error: failed.message}); return {changed: 0}; });
      if (!moved.changed && moved.reason && moved.reason !== 'no-ai') log('profile', 'survey answers not moved', {reason: moved.reason});   // a reason word, never a value
      if (moved.changed) log('profile', 'survey answers got their lists', {changed: moved.changed});   // a count, never a value
      if (tidy.changed) log('profile', 'Your details lines got their kinds', {changed: tidy.changed});   // a count, never a value
      changed = (tidy.changed || 0) + (split.changed || 0) + (moved.changed || 0);
      // The AI's word on each answer not judged yet, after the tidy and split changed what they change (lib/details-review.js judgeNew): unclear ones are queued.
      const judged = await judgeNew(storage, {ai: ai()}).catch(failed => { log('profile', 'the answers check stopped', {error: failed.message}); return {judged: 0}; });
      if (judged.judged) log('profile', 'answers checked', {judged: judged.judged, unclear: judged.unclear, unsure: judged.queued});   // counts, never a value
      // Why (owner, 28 Oct 2026, "Save them automatically", reversing #2322's and #2346's drafts): what the AI concludes about Work eligibility is saved now, a backup first and an Undo after.
      const concluded = await settle(storage, {ai: ai(), ...(copy ? {copy} : {})}).catch(failed => { log('profile', 'the eligibility conclusion stopped', {error: failed.message}); return 0; });
      if (concluded) log('profile', 'Work eligibility concluded', {concluded});   // a count, never a value
      changed += concluded;
      const found = await sections.read(storage);
      if (changed || Date.now() - started > 2000) log('profile', 'Your details settled', {ms: Date.now() - started, changed});   // (only when something moved or it was slow) timing and a count, never a value
      return {ok: !error, error, changed, sections: found, formats: await kinds.formatsOf(storage, found, ai()), tidied: tidied(), conflicts: await openConflicts(storage).catch(() => storage.settings().profileConflicts || []), setAside: list(storage).filter(each => each.source === 'profile')};
    } catch (failed) { return {ok: false, error: failed.message, sections: empty(), conflicts: [], setAside: []}; }
  };
  ipcMain.handle('detailsFacts', () => opening ||= open().finally(() => { opening = null; }));
  // The fast read the screen paints first (owner's app.log 18 Oct 2026: one open waited 3 min 10 s on four AI and Notion steps in a row, and the survey card never redrew when they
  // finished): the saved lines as they are now, no AI, no move. `settling` says the moves are still to come: the screen then asks 'detailsFacts' and redraws with its answer.
  // The status to preselect per zone for a nationality outside Europe and the US (lib/zone-suggest.js); a suggestion is a draft the screen shows, never saved here.
  ipcMain.handle('zoneSuggestions', async (_event, names) => (DEMO ? {} : suggestZones(storage, names, {ai: ai()}).catch(() => ({}))));
  ipcMain.handle('detailsFactsNow', async () => {
    if (DEMO || !connected()) return {...await open(), settling: false};
    try { return {ok: true, sections: await sections.read(storage), formats: {}, tidied: tidied(), conflicts: [], setAside: [], settling: true}; } catch (failed) { return {ok: false, error: failed.message, sections: empty(), conflicts: [], setAside: []}; }
  });
  ipcMain.handle('undoDetailsTidy', async () => {
    if (DEMO) return {ok: true};
    const gate = needsNotion('profile');
    if (gate) return gate;
    // Why (28 Oct 2026, #2322 review): one after the other, the fold first; the fold and the kinds both write Work eligibility, and in parallel the last one won.
    const tried = undo => undo().catch(failed => ({ok: false, error: failed.message}));
    const fold = await tried(() => undoFold(storage)), lines = await tried(() => kinds.undo(storage)), survey = await tried(() => surveys.undo(storage));
    return lines.ok || survey.ok || fold.ok ? {ok: true} : lines;
  });
  ipcMain.handle('saveDetailsFacts', async (_, facts) => {
    const gate = needsNotion('profile');
    if (gate) return gate;
    try {
      // Older eligibility lines folded into Nationality and the zones (#2322): a backup first, Undo after.
      if (Array.isArray(facts?.eligibility)) await beforeSave(storage, facts.eligibility, copy ? {copy} : {});
      for (const key of Object.keys(sections.SECTIONS)) if (Array.isArray(facts?.[key])) await sections.save(storage, key, facts[key].map(line => ({label: String(line?.label || ''), value: String(line?.value || ''), ...(kinds.COMPOSITE_KINDS.includes(line?.kind) ? {kind: line.kind} : {}), ...(String(line?.note || '').trim() ? {note: String(line.note)} : {})})));
      return {ok: true};
    } catch (error) { return {ok: false, error: error.message}; }
  });
  ipcMain.handle('resolveDetailsConflict', async (_, topic, pick) => {
    if (DEMO) return {ok: true};
    const gate = needsNotion('profile');
    return gate || resolve(storage, String(topic || ''), Number(pick)).catch(error => ({ok: false, error: error.message}));
  });
}
