// The search settings' IPC (moved out of main.js, 8 Oct 2026): how well the search covers the roles and places, ideas, loosening and adding
// roles or places, tuning proposals and their application, editing targets and goals, stopping a task, and the strategy data. main.js passes
// in the services they share. Guards: the coverage, tuning and strategy tests in desktop/test.
import {aiText} from './ai/names.js';
import * as controlEvents from './control-events.js';
import * as github from './github.js';
import * as pipeline from './pipeline.js';
import * as strategy from './strategy.js';
import * as goals from './goals.js';
import {levelFollowsGoal} from './goal-level.js';
import * as benchmarkLib from './benchmarks.js';
import {settingsDepsFor} from './settings-deps.js';
import {registerLocationsHandlers} from './locations-handlers.js';
import {registerListMeaningsHandlers} from './list-meanings-handlers.js';
import * as viewCache from './view-cache.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {log as appLog} from './log.js';
import {sharedRead} from './shared-read.js';
import {demoPath} from './demo.js';

export function registerSearchTuningHandlers(ctx) {
  const {DEMO, activity, here, ipcMain, needsNotion, getRecipeReporter, storage, toWindow} = ctx;
  ipcMain.handle('benchmarkLines', (_, urls) => ({ok: true, lines: benchmarkLib.lines(storage, urls, controlEvents.boardName)}));
  ipcMain.handle('searchCoverage', async () => {
    if (DEMO) return {ok: true, coverage: JSON.parse(fs.readFileSync(demoPath(here, 'coverage.json'), 'utf8'))};   // the Strategy cards and the few-jobs buttons, shown
    // A test run can make the engine's answer as slow as it is on a real machine (a Python start over a big data folder): the card must not arrive late and push the page.
    if (process.env.JOB_PILOTTO_E2E && Number(process.env.JOB_PILOTTO_E2E_COVERAGE_MS) > 0) await new Promise(resolve => setTimeout(resolve, Number(process.env.JOB_PILOTTO_E2E_COVERAGE_MS)));
    const {code, stdout} = await pipeline.run(storage, ['src.desktop', 'coverage']);
    if (code !== 0) return {ok: false, error: 'Could not read the coverage (see the activity log)'};
    try { return {ok: true, coverage: JSON.parse(stdout.trim().split('\n').pop())}; } catch { return {ok: true, coverage: null}; }
  });
  // A Not true on role ideas, on Strategy or Focus: the engine keeps the words (src/ai/role_ideas.py put_aside), so neither offers them again.
  ipcMain.handle('roleIdeasAside', async (_, words = []) => {
    if (DEMO) return {ok: true};
    const file = path.join(os.tmpdir(), `jp-role-ideas-aside-${process.pid}-${Date.now()}.json`);
    fs.writeFileSync(file, JSON.stringify({words: (Array.isArray(words) ? words : []).map(String).slice(0, 60)}));
    try {
      const {code} = await pipeline.run(storage, ['src.desktop', 'role-ideas-aside', file]);
      return {ok: code === 0};
    } finally {
      fs.rmSync(file, {force: true});
    }
  });
  // Roles suggested from the Profile (src/ai/role_ideas.py: Sonnet at most once a day), counted in the titles of the user's places; a list an
  // older window set aside in its own storage is sent once more, and the engine keeps it.
  ipcMain.handle('roleIdeas', async (_, setAside = []) => {
    if (DEMO) {   // the ideas the demo Focus offers (tests/test_suggestions_search.py); a persona folder without them has none, not another person's
      let demo = {ideas: [], key: ''};
      try { demo = JSON.parse(fs.readFileSync(demoPath(here, 'role-ideas.json'), 'utf8')); } catch { /* no ideas for this persona */ }
      return {ok: true, key: demo.key, ideas: demo.ideas.filter(idea => !(setAside || []).includes(idea.word))};
    }
    const file = path.join(os.tmpdir(), `jp-role-ideas-${process.pid}-${Date.now()}.json`);
    fs.writeFileSync(file, JSON.stringify({set_aside: (Array.isArray(setAside) ? setAside : []).map(String).slice(0, 60)}));
    try {
      const {stdout} = await pipeline.run(storage, ['src.desktop', 'role-ideas', file]);
      const answer = JSON.parse(String(stdout).trim().split('\n').pop());
      appLog('strategy', 'role ideas', {count: answer.ideas?.length ?? 0, ok: !!answer.ok});
      return answer;
    } catch (error) {
      return {ok: false, ideas: [], error: error.message};
    } finally {
      fs.rmSync(file, {force: true});
    }
  });
  // "Your filters drop jobs": only what the engine's own coverage listed can be removed (never a word typed elsewhere).
  // "Explain with AI" on a jobs check with few new jobs: on the user's click only (src/ai/few_jobs.py; counts, never the CV).
  ipcMain.handle('explainCoverage', async () => {
    if (DEMO) return {ok: true, why: 'Demo data: your role words catch most postings in your places.', first_steps: []};
    const {code, stdout} = await pipeline.run(storage, ['src.desktop', 'explain-coverage']);
    if (code !== 0) return {ok: false, error: aiText(storage, '{AI} could not answer now (see the activity log)')};
    try { return {ok: true, ...JSON.parse(stdout.trim().split('\n').pop())}; } catch { return {ok: false, error: aiText(storage, '{AI}\'s answer could not be read')}; }
  });
  const settingsDeps = settingsDepsFor(toWindow);   // lib/settings-deps.js, shared with main.js
  registerLocationsHandlers({ipcMain, storage, DEMO, needsNotion, settingsDeps, log: appLog});   // Strategy → Which locations are right? (lib/locations-handlers.js)
  registerListMeaningsHandlers({ipcMain, storage, DEMO, log: appLog});   // Strategy's chips: one per meaning, typos flagged (lib/list-meanings-handlers.js)
  // Every change to the search (Strategy edits and suggestions, Tune) says "Your search changed · Refresh jobs" until a refresh applies it
  // (renderer/search-changed.js). 7 Oct 2026: only Edit did, so a role added from a suggestion left no next step.
  const markSearchChanged = result => {
    if ([result?.added, result?.removed, result?.changed].some(list => list?.length)) storage.saveSettings({searchChangedAt: new Date().toISOString()});
    return result;
  };
  ipcMain.handle('loosenSearch', async (_, asked = {}) => {
    if (DEMO) return {ok: true, removed: []};
    try {
      const {code, stdout} = await pipeline.run(storage, ['src.desktop', 'coverage']);
      if (code !== 0) throw new Error('Could not read the coverage (see the activity log)');
      const said = JSON.parse(stdout.trim().split('\n').pop()) || {};
      const listedWords = new Set((said.excluded || []).map(item => item.fragment)), listedLanguages = new Set((said.languages || []).map(item => item.language));
      const result = markSearchChanged(await strategy.loosen(storage, {excludes: (asked.excludes || []).filter(word => listedWords.has(word)),
        languages: (asked.languages || []).filter(language => listedLanguages.has(language))}, settingsDeps()));
      appLog('search', `filters loosened: ${result.removed.join(', ') || 'none'}`);
      return {ok: true, ...result};
    } catch (error) { return {ok: false, error: error.message}; }
  });
  ipcMain.handle('addRoles', async (_, terms) => {
    if (DEMO) return {ok: true, added: []};
    try {
      const result = markSearchChanged(await strategy.addRoles(storage, terms, settingsDeps()));
      appLog('search', `role terms added: ${result.added.join(', ') || 'none'}`);
      // Counted for the starter keyword pack: only words the card itself offered (a fixed vocabulary), with the search's coarse role and region.
      try {
        const summary = JSON.parse(storage.readText('data/coverage.json') || 'null');
        const offered = new Set((summary?.suggestions || []).map(item => String(item.term).toLowerCase()));
        for (const term of result.added) if (offered.has(term)) getRecipeReporter()?.termAccepted(term, summary.roles, summary.regions);
      } catch { /* ignore */ }
      return {ok: true, ...result};
    } catch (error) { return {ok: false, error: error.message}; }
  });
  // "Your places miss N matching roles": the names the card offered are looked up again in the engine's own verdict, so only an offered place
  // (a fixed list, src/coverage.py PLACE_OPTIONS) can ever be written into the search settings.
  ipcMain.handle('addPlaces', async (_, names) => {
    if (DEMO) return {ok: true, added: []};
    try {
      const {code, stdout} = await pipeline.run(storage, ['src.desktop', 'coverage']);
      if (code !== 0) throw new Error('Could not read the coverage (see the activity log)');
      const offered = (JSON.parse(stdout.trim().split('\n').pop())?.places?.options || []).filter(option => (Array.isArray(names) ? names : []).includes(option.place));
      const result = markSearchChanged(await strategy.addPlaces(storage, offered, settingsDeps()));
      appLog('search', `places added: ${result.added.join(', ') || 'none'}`, {offered: offered.length});
      return {ok: true, ...result};
    } catch (error) { return {ok: false, error: error.message}; }
  });
  // Tune my strategy (Actions): proposals from the user's own outcomes (src/tune.py, no AI); only the ticked ones are written,
  // and only ones the engine offers again at that moment (the window's ids pick from them, they never carry a change themselves).
  const tuneProposals = async () => {
    const {code, stdout} = await pipeline.run(storage, ['src.desktop', 'tune']);
    if (code !== 0) return {ok: false, error: 'Could not read your results (see the activity log)'};
    try { return JSON.parse(stdout.trim().split('\n').pop()); } catch { return {ok: false, error: 'Could not read your results (see the activity log)'}; }
  };
  ipcMain.handle('tuneProposals', async () => {
    if (DEMO) return {ok: true, proposals: [], basis: {jobs: 0, dismissed: 0, engaged: 0, interviews: 0, min_dismissed: 5}};
    const gate = needsNotion('tune');
    if (gate) return gate;
    const answer = await tuneProposals();
    appLog('strategy', 'tune proposals', {ok: !!answer.ok, proposals: answer.proposals?.length || 0, jobs: answer.basis?.jobs, dismissed: answer.basis?.dismissed});
    return answer;
  });
  // Strategy → What you're targeting → Edit: the lists edited in the app, written to ⚙️ Search settings (lib/strategy.js editLists).
  ipcMain.handle('editTargets', async (_, edits) => {
    if (DEMO) return {ok: true, changed: Object.keys(edits || {})};
    try {
      const result = markSearchChanged(await strategy.editLists(storage, edits, settingsDeps()));
      const asked = strategy.cleanEdits(edits);
      appLog('strategy', 'targets edited', {lists: result.changed.join(','), added: Object.values(asked).reduce((n, e) => n + (e.add?.length || 0), 0),
        removed: Object.values(asked).reduce((n, e) => n + (e.remove?.length || 0), 0), remote: asked.remote?.set || '', notion: !!storage.secret('NOTION_TOKEN')});
      return {ok: true, ...result};
    } catch (error) { appLog('strategy', 'targets not saved', {error: error.message}); return {ok: false, error: error.message}; }
  });
  // Stop on a running task (Actions banner, Recent activity): its commands end, what it saved is kept, the next run continues.
  ipcMain.handle('stopTask', async () => {
    const elsewhere = pipeline.running() ? null : activity().running;
    if (elsewhere?.githubRun) {
      const kind = elsewhere.kind || elsewhere.mode || '';
      try {
        await github.cancelRun(storage, elsewhere.githubRun);
        appLog('run', 'github run cancelled by you', {kind, run: elsewhere.githubRun});
        return {ok: true, kind, cloud: true};
      } catch (error) {
        appLog('run', 'github cancel refused', {kind, run: elsewhere.githubRun, error: error.message, status: error.status || 0});
        return {ok: false, error: `GitHub did not stop it: ${error.message}`};
      }
    }
    const result = pipeline.stopTask();
    appLog('run', result.ok ? 'stopped by you' : 'stop refused', {kind: result.kind || pipeline.running()?.kind || '', error: result.error || ''});
    return result;
  });
  // Remove a queued task (Recent activity's queued row, ⌘K): it never starts.
  ipcMain.handle('unqueueTask', (_, id) => {
    const result = pipeline.unqueue(storage, String(id || ''));
    appLog('run', result.ok ? 'removed from the queue by you' : 'unqueue refused', {kind: result.kind || '', id: String(id || ''), error: result.error || ''});
    return result;
  });
  // Strategy → Your goals: one goal corrected in the Profile (lib/goals.js). The fit scores follow it over the next searches.
  ipcMain.handle('editGoal', async (_, key, value) => {
    if (DEMO) return {ok: true, where: 'demo'};
    try {
      const result = await goals.setGoal(storage, key, value);
      appLog('strategy', 'goal corrected', {goal: key, where: result.where, length: String(value || '').trim().length});
      // Target level is the search's level too (owner, 18 Oct 2026: "Goals only").
      if (key === 'seniority') {
        const now = viewCache.recall(storage, 'strategy')?.result?.level ?? null;
        const level = await levelFollowsGoal(storage, value, now, {editLists: async (...args) => markSearchChanged(await strategy.editLists(...args)), deps: settingsDeps()});
        if (level.changed) appLog('strategy', 'search level follows the target level', {level: level.level});
        return {...result, level: level.level};
      }
      return result;
    } catch (error) { appLog('strategy', 'goal not saved', {goal: key, error: error.message}); return {ok: false, error: error.message}; }
  });
  ipcMain.handle('tuneApply', async (_, ids) => {
    if (DEMO) return {ok: true, changed: []};
    const gate = needsNotion('tune');
    if (gate) return gate;
    try {
      const fresh = await tuneProposals();
      if (!fresh.ok) return fresh;
      const {chosen, asked} = strategy.chooseOffered(fresh.proposals, ids);
      const result = markSearchChanged(await strategy.retune(storage, chosen, settingsDeps()));
      appLog('strategy', 'tune applied', {asked, applied: chosen.length, kinds: chosen.map(item => item.kind).join(',')});
      return {ok: true, ...result, missing: asked - chosen.length};
    } catch (error) { return {ok: false, error: error.message}; }
  });
  ipcMain.handle('strategyData', sharedRead('strategyData', async () => {
    // Demo mode: JOB_PILOTTO_DEMO_STRATEGY_DELAY ms first, to see (and screenshot) the loading state.
    if (DEMO && process.env.JOB_PILOTTO_DEMO_STRATEGY_DELAY) await new Promise(resolve => setTimeout(resolve, Number(process.env.JOB_PILOTTO_DEMO_STRATEGY_DELAY)));
    if (!DEMO) await strategy.oneRolesList(storage, settingsDeps()).then(merged => merged && appLog('strategy', 'roles and searches merged into one list')).catch(error => appLog('strategy', 'roles not merged', {error: error.message}));
    const {code, stdout} = await pipeline.run(storage, ['src.desktop', 'strategy']);
    if (code !== 0) return {ok: false, error: 'Could not read your strategy (see the activity log)'};
    const read = JSON.parse(stdout.trim().split('\n').pop());
    // A search level apart from the Target level (set before "Goals only", 18 Oct 2026) follows it once.
    if (!DEMO && read.goals?.seniority) {
      const level = await levelFollowsGoal(storage, read.goals.seniority, read.level || '', {editLists: async (...args) => markSearchChanged(await strategy.editLists(...args)), deps: settingsDeps()})
        .catch(error => { appLog('strategy', 'search level not synced', {error: error.message}); return {changed: false}; });
      if (level.changed) { appLog('strategy', 'search level follows the target level', {level: level.level}); read.level = level.level; }
    }
    return viewCache.remember(storage, 'strategy', {ok: true, ...read});
  }, {log: appLog}));
}
