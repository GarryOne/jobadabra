// The CV and cover-letter IPC (moved out of main.js, 8 Oct 2026): the CV match on a job, which CV a job uses, the base CV's status and
// check, viewing it, the cover letter's draft, approval and PDF, and the CV folder. main.js passes in the services they share.
// Guards: the cv, cv-check, cover-letter and match-check tests in desktop/test.
import * as atUpload from './cv-import-at-upload.js';
import * as claudeCode from './claude-code.js';
import * as contactDetails from './contact.js';
import * as cvCheck from './cv-check.js';
import * as cvLook from './cv-look.js';
import * as cvlib from './cv.js';
import * as demo from './demo.js';
import * as files from './files.js';
import {availableLetter} from './letter-availability.js';
import * as letters from './cover-letter.js';
import * as matchCheck from './match-check.js';
import * as pipeline from './pipeline.js';
import * as server from './server.js';
import * as strategy from './strategy.js';
import fs from 'node:fs';
import path from 'node:path';
import {log as appLog} from './log.js';
import {configForPrompt} from './config-text.js';
import {restartFormsOf} from './tailored-restart.js';
import {writePrivate} from './private-file.js';

export function registerCvAndLettersHandlers(ctx) {
  const {BrowserWindow, DEMO, cvOf, handleImportant, ipcMain, keepLook, openTailoredCv, printPdf, shell, storage, tailorCv, tailoring} = ctx;
  // CV match (Jobs ⋯ and the session card): this job's posting against the CV, on request. The last answer is kept per job for the CV it was made with.
  ipcMain.handle('matchSaved', (_, code) => { if (DEMO) return demo.matchSaved; const cv = cvlib.baseCv(storage); return cv ? matchCheck.saved(storage, String(code), cv) : null; });
  ipcMain.handle('matchCheck', async (_, code) => {
    const key = storage.secret('ANTHROPIC_API_KEY'), ai = claudeCode.client(storage);
    if (!key && !ai) return {ok: false, error: 'Choose your AI in Settings → Connections → AI first.'};
    try {
      let cost = 0;
      if (!cvlib.baseCv(storage)) {
        if (!fs.existsSync(storage.path('cv.pdf'))) return {ok: false, error: 'Add your CV (PDF or Word) in Settings first.'};
        cost += (await atUpload.ensure(storage, {client: ai, key, look: keepLook})).usd || 0;
      }
      const job = await pipeline.posting(storage, String(code));
      if (!job.ok) return {ok: false, error: job.error};
      const cv = cvlib.baseCv(storage), {profile} = await strategy.profileTexts(storage).catch(() => ({profile: ''}));
      const result = await matchCheck.check(storage, key, {job, cv, profile, client: ai});
      appLog('cv', 'match check', {grade: result.grade, musts: result.musts.length, knockouts: result.knockouts.length, usd: result.usd});
      return {ok: true, ...matchCheck.save(storage, String(code), cv, job, {...result, usd: Math.round((result.usd + cost) * 100) / 100})};
    } catch (error) { return {ok: false, error: error.message}; }
  });
  ipcMain.handle('cvOf', (_, url, given = false) => ({...cvOf(String(url || '')), coverLetterStatus: availableLetter(storage, String(url || ''), {given: given === true}).status}));   // the session card: tailored for this job already, or being tailored now
  // Every "Tailor my CV" in the window (the session page, where the form panel's "Tailor in Jobadabra" sends the person; Jobs; the job drawer): while it runs the form's panel says
  // "Tailoring in Jobadabra…" (cvOf → the review poll); when it is done, the job's open form starts again so the tailored CV is attached from the start (lib/tailored-restart.js).
  // Why (27 Oct 2026, owner): the panel no longer starts tailoring itself; "the extension is not that smart to adapt on the fly and replace the general CV with the tailored one".
  ipcMain.handle('tailorCv', async (_, code, name, url) => {
    const keys = [...new Set([].concat(url || []).filter(Boolean).map(server.pageKey))];   // the job's posting and its form session's address (cvOf is asked by either)
    for (const key of keys) tailoring.add(key);
    try {
      const result = await tailorCv(code, name);
      const restarted = result?.ok ? restartFormsOf(storage, code) : [];
      if (restarted.length) appLog('cv', 'tailored CV ready: the job\'s open form starts again with it', {code, forms: restarted.length});
      return result;
    } finally { for (const key of keys) tailoring.delete(key); }
  });
  // A job's code (the Jobs list) or its posting address (a Tailor CVs card knows only the link).
  ipcMain.handle('openTailoredCv', (_, which) => openTailoredCv(/^https?:/.test(String(which)) ? cvlib.forUrl(storage, String(which))?.job?.code : which));
  // The base CV the tailoring starts from: import it from the CV PDF (again), see it, or edit its files.
  // CV check (Profile → CV): how a parser reads the uploaded PDF (free), then one AI review of what it says (a few cents). A cache of the PDF: cv/check.json.
  // billing: how the content review would be paid now (the plan's allowance or an API), for the card's cost line.
  const billingNow = () => claudeCode.client(storage)?.billing || (storage.secret('ANTHROPIC_API_KEY') ? 'api' : '');
  ipcMain.handle('cvCheckStatus', () => (DEMO ? {...demo.cvCheck, billing: 'api'} : {...(cvCheck.saved(storage) || {}), billing: billingNow()}));
  ipcMain.handle('cvCheckRun', async () => {
    if (!fs.existsSync(storage.path('cv.pdf'))) return {ok: false, error: 'Add your CV (PDF or Word) in Settings first.'};
    let probe;
    try {
      probe = await cvLook.probeWindow(BrowserWindow, storage.path('cv.pdf'));
      const result = cvCheck.withSections(cvCheck.analyse(await probe.scan()), cvCheck.saved(storage)?.ai?.sections);   // headings the review found in any language
      appLog('cv', 'parser check', {score: result.score, pages: result.pages, issues: result.checks.filter(c => c.status !== 'pass').map(c => c.id)});
      return {ok: true, ...cvCheck.save(storage, {ats: result}), billing: billingNow()};
    } catch (error) { return {ok: false, error: `The CV could not be read: ${error.message}`}; } finally { probe?.close(); }
  });
  ipcMain.handle('cvCheckAi', async () => {
    const key = storage.secret('ANTHROPIC_API_KEY'), ai = claudeCode.client(storage);
    if (!key && !ai) return {ok: false, error: 'Choose your AI in Settings → Connections → AI first.'};
    const ats = cvCheck.saved(storage)?.ats;
    if (!ats) return {ok: false, error: 'Check the CV first.'};
    try {
      const {profile} = await strategy.profileTexts(storage).catch(() => ({profile: ''}));
      const result = await cvCheck.review(storage, key, ats.text, {client: ai, profile});
      appLog('cv', 'content review', {score: result.score, fixes: result.fixes.length, usd: result.usd});
      return {ok: true, ...cvCheck.save(storage, {ai: result, ats: cvCheck.withSections(ats, result.sections)}), billing: billingNow()};
    } catch (error) { return {ok: false, error: error.message}; }
  });
  // file: the uploaded PDF's size and when it was set (the CV tab's document row); none when there is no PDF.
  const fileOf = () => { try { return {size: fs.statSync(storage.path('cv.pdf')).size, addedAt: storage.settings().cvAddedAt || ''}; } catch { return null; } };
  ipcMain.handle('cvStatus', () => ({base: !!cvlib.baseCv(storage), custom: fs.existsSync(path.join(cvlib.dir(storage), 'style.css')) || cvlib.baseCv(storage)?.look === 'rich',
    file: DEMO ? demo.cvFile : fileOf()}));
  handleImportant('importCv', 'Saving your CV', async () => {
    const key = storage.secret('ANTHROPIC_API_KEY'), ai = claudeCode.client(storage);
    if (!key && !ai) return {ok: false, error: 'Choose your AI in Settings → Connections → AI first.'};
    if (!fs.existsSync(storage.path('cv.pdf'))) return {ok: false, error: 'Add your CV (PDF or Word) first.'};
    try { return {ok: true, usd: (await atUpload.ensure(storage, {client: ai, key, look: keepLook, force: true})).usd || 0}; } catch (error) { return {ok: false, error: error.message}; }
  });
  ipcMain.handle('viewBaseCv', async () => {
    const base = cvlib.baseCv(storage);
    if (!base) return {ok: false, error: 'No base CV yet.'};
    const {pdf, overflow} = await printPdf(cvlib.writeHtml(storage, base, 'base.html'));
    const target = path.join(cvlib.dir(storage), 'base.pdf');
    writePrivate(target, pdf);
    shell.openPath(target);
    return {ok: true, overflow};
  });
  // The general cover letter (Settings → Profile → Cover letter): drafted from the CV + Profile + standard answers,
  // reviewed by the user, approved -> PDF. See lib/cover-letter.js.
  ipcMain.handle('coverLetter', () => letters.status(storage));
  ipcMain.handle('coverLetterDraft', async (_, feedback = '') => {
    if (DEMO) return {ok: false, error: demo.TEXT}; // demo setup must never reach an account or paid model

    const key = storage.secret('ANTHROPIC_API_KEY'), ai = claudeCode.client(storage);
    if (!key && !ai) return {ok: false, error: 'Choose your AI in Settings → Connections → AI first.'};
    try {
      if (!cvlib.baseCv(storage)) {
        if (!fs.existsSync(storage.path('cv.pdf'))) return {ok: false, error: 'Add your CV (PDF or Word) first.'};
        await atUpload.ensure(storage, {client: ai, key, look: keepLook});
      }
      const {profile, answers} = await strategy.profileTexts(storage);
      const contact = await contactDetails.read(storage).catch(() => ({}));
      const result = await letters.generate(storage, {apiKey: key, client: ai, profile, answers, feedback: String(feedback).slice(0, 1000),
        preferences: configForPrompt(storage, 'search.json'), name: contact.full_name || [contact.first_name, contact.last_name].filter(Boolean).join(' '), paidBy: letters.paidByOf({key, client: ai})});
      appLog('cover-letter', `drafted${feedback ? ' with feedback' : ''}`, {words: result.text.split(/\s+/).length, usd: result.usd});
      return {ok: true, ...letters.status(storage)};
    } catch (error) { return {ok: false, error: error.message}; }
  });
  ipcMain.handle('coverLetterSave', (_, text) => {
    try { letters.edit(storage, text); appLog('cover-letter', 'edited by the user; back to draft'); return {ok: true, ...letters.status(storage)}; } catch (error) { return {ok: false, error: error.message}; }
  });
  ipcMain.handle('coverLetterApprove', async (_, text) => {
    try {
      if (typeof text === 'string') letters.edit(storage, text);
      const record = letters.load(storage);
      if (!record?.text) return {ok: false, error: 'Write or generate a letter first.'};
      const contact = await contactDetails.read(storage).catch(() => ({}));
      fs.mkdirSync(letters.dir(storage), {recursive: true});
      const page = path.join(letters.dir(storage), 'letter.html');
      writePrivate(page, letters.html(record.text, contact, cvlib.baseCv(storage)));
      letters.approve(storage, (await printPdf(page)).pdf);
      appLog('cover-letter', 'approved; PDF written for form uploads', {words: record.text.split(/\s+/).length});
      // Notion too (the source of truth): best effort, the PDF is on this Mac either way.
      files.coverLetterToProfile(storage, letters.pdfPath(storage)).then(caption => caption && appLog('cover-letter', 'PDF saved to the Notion Profile', {caption}))   // about Notion
        .catch(error => appLog('cover-letter', `not saved to Notion: ${error.message}`));
      return {ok: true, ...letters.status(storage)};
    } catch (error) { return {ok: false, error: error.message}; }
  });
  ipcMain.handle('coverLetterOpen', () => (fs.existsSync(letters.pdfPath(storage)) ? shell.openPath(letters.pdfPath(storage)) : ''));
  ipcMain.handle('showCvFolder', () => { fs.mkdirSync(cvlib.dir(storage), {recursive: true}); return shell.openPath(cvlib.dir(storage)); });
}
