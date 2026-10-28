// The job's own cover letter's IPC and the step Tailor CV + cover letter runs after the CV: make the letter (kit's or drafted), print it as a PDF in the
// CV's design, keep it, put it on the job beside the CV. Edit remakes the PDF at once; Write again drafts anew. Guards: desktop/test/job-letter.test.js.
import * as claudeCode from './claude-code.js';
import * as contactDetails from './contact.js';
import * as cvlib from './cv.js';
import * as demo from './demo.js';
import * as jobLetter from './job-letter.js';
import * as jobPages from './job-page-handlers.js';
import * as pipeline from './pipeline.js';
import * as storeFiles from './store/files.js';
import * as strategy from './strategy.js';
import fs from 'node:fs';
import path from 'node:path';
import {configForPrompt} from './config-text.js';
import {log as appLog} from './log.js';
import {writePrivate} from './private-file.js';
import * as letterStyle from './letter-style.js';

export function registerJobLetterHandlers({DEMO, ipcMain, printPdf, shell, storage}) {
  const codeOf = which => (/^https?:/.test(String(which)) ? cvlib.forUrl(storage, String(which))?.job?.code : which);
  // The PDF from the text, the CV's design; kept with the record. `job` {code, title, company, url}.
  async function keep(job, record) {
    const contact = await contactDetails.read(storage).catch(() => ({}));
    fs.mkdirSync(jobLetter.dir(storage), {recursive: true});
    const page = path.join(jobLetter.dir(storage), `${String(job.code).replace(/[^a-z0-9]/gi, '')}.html`);
    writePrivate(page, jobLetter.html(storage, record.text, contact, cvlib.baseCv(storage)));
    const printed = await printPdf(page);
    fs.rmSync(page, {force: true});
    jobLetter.save(storage, job.code, record, printed.pdf);
    // On the job like the tailored CV (any store keeps it there; Notion keeps the CV only). No row yet: it is here only.
    await storeFiles.attachToJob(storage, job.url, jobLetter.pdfPath(storage, job.code), {name: jobLetter.finalName(storage, record)}).catch(error =>
      appLog('cover-letter', 'job letter not kept on the job', {code: job.code, error: error.message}));
  }
  // After the tailored CV: the kit's letter when the job has one, else drafted from the tailored CV. -> {ok, usd, source} (never throws: the CV stands alone).
  async function makeFor(job, tailoredCv, {profile, answers, feedback = '', previous = ''} = {}) {
    try {
      let kitLetter = '';
      if (!feedback) kitLetter = (await jobPages.jobPage(storage, job.url).catch(() => null))?.kit?.cover_letter || '';
      const contact = await contactDetails.read(storage).catch(() => ({}));
      const made = await jobLetter.draft(storage, {job, cv: tailoredCv, kitLetter, profile, answers: letterStyle.withStyle(answers, await letterStyle.read(storage)), feedback, previous,
        preferences: configForPrompt(storage, 'search.json'), name: contact.full_name || [contact.first_name, contact.last_name].filter(Boolean).join(' '),
        apiKey: storage.secret('ANTHROPIC_API_KEY'), client: claudeCode.client(storage)});
      await keep(job, {job: {code: job.code, title: job.title, company: job.company, url: job.url}, text: made.text, source: made.source, createdAt: new Date().toISOString(),
        model: made.model, usd: made.usd, tokens: made.tokens, warnings: made.warnings});
      appLog('cover-letter', `job letter ${made.source === 'kit' ? 'from the kit' : 'drafted'}`, {code: job.code, usd: made.usd, tokens: made.tokens});
      return {ok: true, usd: made.usd, source: made.source};
    } catch (error) {
      appLog('cover-letter', 'job letter not made', {code: job.code, error: String(error.message).slice(0, 120)});
      return {ok: false, error: error.message, usd: 0};
    }
  }
  ipcMain.handle('jobLetter', (_, which) => (DEMO ? demo.jobLetter : jobLetter.status(storage, codeOf(which))));
  ipcMain.handle('jobLetterOpen', (_, which) => { const code = codeOf(which); return jobLetter.hasPdf(storage, code) ? shell.openPath(jobLetter.pdfPath(storage, code)) : ''; });
  // The person's own edit: the text and its PDF are remade together, no AI call.
  ipcMain.handle('jobLetterSave', async (_, which, text) => {
    try {
      const code = codeOf(which), record = jobLetter.load(storage, code), clean = String(text || '').replace(/\r\n/g, '\n').trim();
      if (!record) return {ok: false, error: 'This job has no letter yet: tailor it first.'};
      if (!clean) return {ok: false, error: 'The letter is empty.'};
      await keep(record.job, {...record, text: clean, source: 'you', warnings: []});
      appLog('cover-letter', 'job letter edited; PDF remade', {code});
      return {ok: true, ...jobLetter.status(storage, code)};
    } catch (error) { return {ok: false, error: error.message}; }
  });
  // Write again: a new draft from the tailored CV (and the person's feedback, if any).
  ipcMain.handle('jobLetterAgain', async (_, which, feedback = '') => {
    const code = codeOf(which), record = jobLetter.load(storage, code), tailored = cvlib.load(storage, code);
    if (!record || !tailored) return {ok: false, error: 'Tailor the CV for this job first.'};
    const {profile, answers} = await strategy.profileTexts(storage);
    const job = await pipeline.posting(storage, code);
    if (!job.ok) return {ok: false, error: job.error};
    const result = await makeFor({...record.job, description: job.description, location: job.location}, tailored.cv,
      {profile, answers, feedback: String(feedback || 'Write it again, fresh.').slice(0, 1000), previous: record.text});
    return result.ok ? {ok: true, ...jobLetter.status(storage, code)} : result;
  });
  return {makeFor};
}
