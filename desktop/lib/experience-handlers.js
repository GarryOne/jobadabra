// The experience bank's IPC (Settings → Profile → Experience): what the window shows, adding another CV version, removing one, matching
// again after the main CV changed. The data and the AI match are lib/experience.js; guarded by test/experience.test.js.
import * as claudeCode from './claude-code.js';
import * as added from './experience-added.js';
import * as experience from './experience.js';
import * as linkedinOAuth from './linkedin-oauth.js';
import fs from 'node:fs';
import path from 'node:path';
import {log as appLog} from './log.js';

// Demo mode (look-around, screenshots): a made-up bank, nothing read from disk.
const DEMO_VIEW = {main: {name: 'Ada Example', roles: 2, skills: 'AWS, Terraform'},
  sources: [{id: 'demo1', kind: 'cv', name: 'Data and ML CV', addedAt: '2026-10-08T09:00:00Z', stale: false, roles: 3, added: 2,
    onlyHere: [{company: 'Gamma', title: 'Data Engineer', period: '2018 – 2019'}]}],
  roles: [{company: 'Acme', title: 'Site Reliability Engineer', period: '2024 – Present', place: 'Zurich', bullets: [
    {text: 'Cut monitoring costs by **50%** with Datadog.', from: 'Main CV'}, {text: 'Built Spark pipelines for 2 TB of logs a day.', from: 'Data and ML CV'}]},
    {company: 'Beta', title: 'Developer', period: '2020 – 2023', place: 'Remote', bullets: [{text: 'Built APIs in Node.js.', from: 'Main CV'}]}],
  extraSkills: 'CI/CD, Spark', added: [{id: 'demo1', kind: 'skill', text: 'Kafka'}, {id: 'demo2', kind: 'correction', text: 'Python: 3 years'}]};

export function registerExperienceHandlers({DEMO, dialog, getWindow, ipcMain, shell, storage}) {
  const ai = () => ({apiKey: storage.secret('ANTHROPIC_API_KEY'), client: claudeCode.client(storage)});
  const noAi = () => { const {apiKey, client} = ai(); return !apiKey && !client; };
  ipcMain.handle('experienceGet', () => (DEMO ? DEMO_VIEW : experience.view(storage)));
  // The window is told each step as it happens ('experienceStep'), so a minute of reading is never a silent wait.
  const step = (what, extra = {}) => { const win = getWindow(); if (win && !win.isDestroyed()) win.webContents.send('experienceStep', {what, ...extra}); };
  const withChanges = (before, ok = true, extra = {}) => { const view = experience.view(storage); return {ok, ...view, changes: experience.viewChanges(before, view), ...extra}; };
  ipcMain.handle('experienceAddCv', async () => {
    if (noAi()) return {ok: false, error: 'Choose your AI in Settings → Connections → AI first.'};
    if (!experience.view(storage).main) return {ok: false, error: 'Read your main CV first (CV → Read my CV PDF): other versions are compared with it.'};
    const picked = await dialog.showOpenDialog(getWindow(), {title: 'Choose other versions of your CV', filters: [{name: 'PDF', extensions: ['pdf']}], properties: ['openFile', 'multiSelections']});
    if (picked.canceled || !picked.filePaths.length) return {ok: false, cancelled: true};
    const before = experience.view(storage), results = [];
    for (const [index, file] of picked.filePaths.entries()) {
      const name = path.basename(file).replace(/\.pdf$/i, ''), where = {name, index: index + 1, total: picked.filePaths.length};
      try {
        if (!fs.statSync(file).isFile()) throw new Error('That is not a file.');
        const source = await experience.addCv(storage, file, name, {...ai(), onStep: what => step(what, where)});
        appLog('experience', 'CV version added', {id: source.id, roles: source.cv.jobs.length, matched: source.match.filter(m => m.mainJob >= 0).length,
          extraBullets: source.match.reduce((n, m) => n + m.newBullets.length, 0), usd: source.usd});
        results.push({name, ok: true});
        step('done', where);
      } catch (error) { results.push({name, ok: false, error: error.message}); step('failed', {...where, error: error.message}); }
    }
    const ok = results.some(r => r.ok);
    return withChanges(before, ok, {results, ...(ok ? {} : {error: results.map(r => `${r.name}: ${r.error}`).join(' ')})});
  });
  ipcMain.handle('experienceAddLinkedin', async () => {
    if (noAi()) return {ok: false, error: 'Choose your AI in Settings → Connections → AI first.'};
    if (!experience.view(storage).main) return {ok: false, error: 'Read your main CV first (CV → Read my CV PDF): LinkedIn is compared with it.'};
    const picked = await dialog.showOpenDialog(getWindow(), {title: 'Choose the .zip LinkedIn sent you, or your profile saved as PDF', filters: [{name: 'LinkedIn data (.zip) or profile (.pdf)', extensions: ['zip', 'pdf']}], properties: ['openFile']});
    if (picked.canceled || !picked.filePaths[0]) return {ok: false, cancelled: true};
    try {
      const before = experience.view(storage);
      const source = await experience.addLinkedin(storage, picked.filePaths[0], {...ai(), onStep: what => step(what, {name: 'LinkedIn', index: 1, total: 1})});
      appLog('experience', 'LinkedIn export added', {id: source.id, roles: source.cv.jobs.reduce((n, j) => n + j.roles.length, 0), matched: source.match.filter(m => m.mainJob >= 0).length,
        extraBullets: source.match.reduce((n, m) => n + m.newBullets.length, 0), skills: source.cv.skills ? source.cv.skills.split(',').length : 0, usd: source.usd});
      return withChanges(before);
    } catch (error) { return {ok: false, error: error.message}; }
  });
  ipcMain.handle('experienceRemove', (_, id) => {
    const before = experience.view(storage);
    const ok = experience.remove(storage, id);
    if (ok) appLog('experience', 'source removed', {id: String(id)});
    return withChanges(before, ok, {removed: before.sources.find(s => s.id === String(id))?.name || ''});
  });
  // "Use in my CVs" (Insights PR 2, renderer/skill-entries.js): the skills become "Added by you" entries; the main CV file is never edited.
  ipcMain.handle('experienceAddSkills', (_, skills) => {
    const before = experience.view(storage), list = (Array.isArray(skills) ? skills : []).map(skill => String(skill || '').trim()).filter(Boolean).slice(0, 10);
    if (!list.length) return {ok: false, error: 'No skills to add.'};
    if (DEMO) return {ok: true, ...before};
    try { for (const skill of list) added.addSkill(storage, skill); } catch (error) { return {ok: false, error: error.message}; }
    appLog('experience', 'skills added by you', {count: list.length});
    return withChanges(before);
  });
  ipcMain.handle('experienceRemoveAdded', (_, id) => withChanges(experience.view(storage), added.removeAdded(storage, id)));
  ipcMain.handle('experienceRematch', async () => {
    if (noAi()) return {ok: false, error: 'Choose your AI in Settings → Connections → AI first.'};
    try {
      const before = experience.view(storage);
      const done = await experience.rematchStale(storage, {...ai(), onStep: what => step(what, {name: 'your other versions', index: 1, total: 1})});
      appLog('experience', 'matched again', {sources: done});
      return withChanges(before);
    } catch (error) { return {ok: false, error: error.message}; }
  });
  // Connect with LinkedIn (identity only: name, email, LinkedIn id). The app keeps who it is, never a token (lib/linkedin-oauth.js).
  ipcMain.handle('linkedinStatus', () => (DEMO ? null : storage.settings().linkedin || null));
  ipcMain.handle('linkedinConnect', async () => {
    if (DEMO) return {ok: false, error: 'Not available in the demo.'};
    const signedIn = await linkedinOAuth.connect(url => shell.openExternal(url));
    if (!signedIn.ok) return signedIn;
    const connection = linkedinOAuth.kept(signedIn);
    storage.saveSettings({linkedin: connection});
    appLog('linkedin', 'connected');   // that it happened, never who
    return {ok: true, ...connection};
  });
  ipcMain.handle('linkedinDisconnect', () => { linkedinOAuth.cancel(); storage.saveSettings({linkedin: null}); appLog('linkedin', 'disconnected'); return {ok: true}; });
}
