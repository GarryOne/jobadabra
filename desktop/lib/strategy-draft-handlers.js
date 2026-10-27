// The strategy draft's IPC (moved out of main.js, 8 Oct 2026): drafting a Strategy from the CV, the cached draft and the edits kept on it, how a rebuild
// would change the search, and saving it to Notion with its progress. main.js passes in the services they share. Guards: the strategy, draft
// and save-progress tests in desktop/test.
import {afterWrite} from './shared-read.js';
import {aiNameOf, aiText} from './ai/names.js';
import * as claudeCode from './claude-code.js';
import * as contactDetails from './contact.js';
import * as notion from './notion.js';   // Notion-only: an accepted strategy written to the Notion Profile/answers/settings pages when Notion is the store
import * as notionGate from './notion-gate.js';
import * as pipeline from './pipeline.js';
import * as strategy from './strategy.js';
import fs from 'node:fs';
import {log as appLog} from './log.js';
import {demoPath} from './demo.js';
import {aiClient} from './confirmation.js';
import {contactSaved} from './server-contact.js';
import {detailsFromCvAtSetup, detailsNote} from './details-at-setup.js';

export function registerStrategyDraftHandlers(ctx) {
  const writeHandle = (channel, fn) => ipcMain.handle(channel, afterWrite(fn));   // a finished write closes the running reads' join (shared-read.js)
  const {DEMO, here, ipcMain, storage, syncCv, toWindow, trackSetup} = ctx;
  ipcMain.handle('draftStrategy', async (_, answers) => {
    storage.saveSettings({questionnaire: {...storage.settings().questionnaire, ...answers}});  // the note (older fields kept)
    const send = progress => toWindow('draftProgress', progress);
    // Demo mode: the fictional draft in demo/draft.json after a short pretend run; no AI is called.
    if (DEMO) {
      const demo = JSON.parse(fs.readFileSync(demoPath(here, 'draft.json'), 'utf8')).draft;
      demo.profile_markdown = strategy.withNote(demo.profile_markdown, answers);
      send({part: 'Proposing your goals', percent: 20, notes: [aiText(storage, 'Sent your CV to {AI} (demo: nothing is sent)'), aiText(storage, '{AI} read your CV')]});
      await new Promise(resolve => setTimeout(resolve, Number(process.env.JOB_PILOTTO_DEMO_STRATEGY_DELAY) || 300));
      return demo;
    }
    const kb = Math.round(fs.statSync(storage.path('cv.pdf')).size / 1024);
    const sent = `Sent your CV (${kb} KB)${answers.anything_else ? ' and your note' : ''} to ${aiNameOf(storage)} (${aiText(storage, '{AI:main}')})`;
    // Before Claude writes anything it reads the CV (about 25 s): the bar moves by time, up to 10%.
    const started = Date.now();
    let writing = false;
    const reading = setInterval(() => !writing && send({part: aiText(storage, '{AI} is reading your CV'), notes: [sent, aiText(storage, '{AI} is reading your CV…')],
      percent: Math.min(strategy.READING - 1, Math.round((Date.now() - started) / 25000 * strategy.READING))}), 1000);
    send({part: aiText(storage, 'Sending your CV to {AI}'), percent: 0, notes: [sent]});
    let draft;
    try {
      draft = await strategy.draft(storage, answers, storage.secret('ANTHROPIC_API_KEY'), claudeCode.client(storage),
        progress => { writing = true; send({...progress, notes: [sent, aiText(storage, '{AI} read your CV'), ...progress.notes]}); });
    } finally { clearInterval(reading); }
    send({part: 'Checking the draft', percent: 99, notes: ['Checking the draft (valid settings, nothing missing)…']});
    // Kept so reopening the wizard shows it again instead of paying for a new draft.
    storage.writeText('draft.json', JSON.stringify({answers, draft, cv: cvFingerprint(), at: new Date().toISOString()}));
    return draft;
  });
  // The saved draft, and whether it was made from the CV there is now (a replaced CV makes it out of date).
  const cvFingerprint = () => { try { const stat = fs.statSync(storage.path('cv.pdf')); return `${stat.size}-${Math.round(stat.mtimeMs)}`; } catch { return ''; } };
  ipcMain.handle('cachedDraft', () => {
    try { const cached = JSON.parse(storage.readText('draft.json')); return {...cached, cvChanged: !!cached.cv && cached.cv !== cvFingerprint()}; } catch { return null; }
  });
  ipcMain.handle('cacheDraftEdits', (_, edits) => {
    try {
      const cached = JSON.parse(storage.readText('draft.json'));
      storage.writeText('draft.json', JSON.stringify({...cached, draft: {...cached.draft, ...edits}}));
    } catch {}
    return true;
  });
  // One save at a time: a second click while Notion is being written joins the running save.
  let saving = null;
  // Rebuild from CV (setup done before): what the draft changes, grouped, with each group's impact and AI cost.
  ipcMain.handle('rebuildImpact', async (_, draft) => {
    try {
      const readJson = name => { try { return JSON.parse(storage.readText(`config/${name}`) || '{}'); } catch { return {}; } };
      const [{profile, answers}, facts] = await Promise.all([strategy.profileTexts(storage),
        pipeline.run(storage, ['src.desktop', 'strategy']).then(({stdout}) => JSON.parse(stdout.trim().split('\n').pop())).catch(() => ({counts: {}}))]);
      const groups = strategy.rebuildGroups({search: readJson('search.json'), preferences: readJson('preferences.json'), profile, answers},
        draft, {scored: facts.scored || 0, kits: facts.counts?.kits || 0});
      return {ok: true, groups};
    } catch (error) { return {ok: false, error: error.message}; }
  });
  // parts: the review's accepted groups (search, filters, profile, answers); null = everything (first setup).
  // After a save that took the Profile: the details the draft left empty, from one CV read (lib/details-at-setup.js), as the save window's last step (owner, 27 Oct 2026:
  // "Step in the save window"). At most DETAILS_WAIT_MS: a slower read finishes in the background and the window closes without its count.
  const DETAILS_WAIT_MS = 30000;
  const detailsAfter = async result => {
    if (!result?.ok) return result;
    if (DEMO) { toWindow('saveProgress', {step: 'details', finished: true, note: detailsNote({saved: Array(5).fill(''), left: Array(2).fill('')})}); return result; }   // demo: fictional counts, no AI
    toWindow('saveProgress', {step: 'details'});
    const read = detailsFromCvAtSetup(storage, {client: aiClient(storage), log: appLog, contactSaved: saved => contactSaved(storage, saved)}).catch(() => ({saved: [], left: []}));
    const done = await Promise.race([read, new Promise(resolve => setTimeout(() => resolve(null), DETAILS_WAIT_MS))]);
    toWindow('saveProgress', {step: 'details', finished: true, note: done ? detailsNote(done) : 'still reading: they appear in Your details shortly'});
    return result;
  };
  writeHandle('saveStrategy', (_, draft, parts = null) => {
    const take = part => !parts || parts.includes(part);
    saving ||= (async () => {
      const token = storage.secret('NOTION_TOKEN'), ids = storage.settings().notionIds || {};
      // Progress for the save window: each step starts, advances (blocks written) and finishes.
      const step = (name, extra = {}) => toWindow('saveProgress', {step: name, ...extra});
      // The daily target asked in the wizard goes with the search settings.
      const perDay = storage.settings().questionnaire?.applications_per_day;
      const accepted = () => ({search: take('search') ? draft.search : null,
        preferences: !parts ? {...draft.preferences, daily_applications_target: strategy.clampTarget(perDay)} : take('filters') ? draft.preferences : null});
      // Trying (no Notion yet, lib/notion-gate.js): the strategy is kept on this Mac, and lib/migrate.js moves it into
      // Notion when it is connected. Contact details are a section of the Profile text, as in Notion.
      if (!notionGate.notionInUse(storage)) {
        const backup = strategy.keepLocally(storage, draft, parts);   // the search settings, then the Profile with its contact section and the answers
        step('local', {finished: true});
        appLog('notion', 'strategy kept on this Mac', {parts: parts || 'all', backup: !!backup});
        for (const name of ['profile', 'answers', 'search']) step(name, {finished: true});
        { const before = storage.settings(); storage.saveSettings({setupDone: true}); trackSetup({setupDone: true}, before); }
        return {ok: true, local: true};
      }
      // Replacing a strategy that was set up before: keep a copy of the current one in Notion first.
      if (storage.settings().setupDone) {
        step('snapshot');
        const when = new Date().toLocaleString('en-GB', {day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'});
        await notion.snapshotStrategy(token, ids, when);
        step('snapshot', {finished: true});
      }
      // ⚙️ Search settings is the source of truth: read it first, so edits made there since the last search are not overwritten by the cached copy.
      if (ids.NOTION_SEARCH_SETTINGS_PAGE) await pipeline.run(storage, ['src.notion.search_settings', 'sync']);
      strategy.save(storage, accepted());
      step('local', {finished: true});
      const report = page => (done, total) => step(page, {done, total});
      // Contact details are a section of the Profile page: what's there stays, the CV's non-empty values win.
      const known = await contactDetails.read(storage).catch(() => ({}));
      const merged = {...known, ...Object.fromEntries(Object.entries(draft.contact || {}).filter(([, value]) => value))};
      const profile = draft.profile_markdown.trim() + (Object.keys(merged).length ? `\n\n${contactDetails.markdown(merged)}\n` : '\n');
      step('profile');
      if (take('profile')) await notion.writePage(token, ids.NOTION_PROFILE_PAGE_ID, profile, undefined, report('profile'));
      step('profile', {finished: true});
      step('answers');
      if (take('answers')) await notion.writePage(token, ids.NOTION_ANSWERS_PAGE_ID, draft.answers_markdown, undefined, report('answers'));
      step('answers', {finished: true});
      strategy.dropLocalCopies(storage);  // Notion has them now
      step('search');
      if (take('search') || take('filters')) await strategy.publishSearchSettings(storage, {run: pipeline.run, ensurePage: notion.ensurePage, writePage: notion.writePage});
      step('search', {finished: true});
      { const before = storage.settings(); storage.saveSettings({setupDone: true}); trackSetup({setupDone: true}, before); }
      syncCv();  // the CV to the Profile page (Notion keeps every version)
      return {ok: true};
    })().then(result => (take('profile') ? detailsAfter(result) : result)).catch(error => ({ok: false, error: `Couldn't write to Notion: ${error.message}`})).finally(() => { saving = null; });
    return saving;
  });
}
