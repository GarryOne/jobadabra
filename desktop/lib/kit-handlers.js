// The application kit and tailored CVs' IPC (moved out of main.js, 8 Oct 2026): drafting a job's kit (questions, answers, cover letter) onto
// its Notion row, tailoring a CV for a job or for the top matches. It hands back prepareKitFor and tailorCv for the groups that use them
// (apply, the CV handlers). main.js passes in the services they share. Guards: the kit, tailor and apply tests in desktop/test.
import * as apply from './apply.js';
import * as atUpload from './cv-import-at-upload.js';
import * as claudeCode from './claude-code.js';
import * as cvlib from './cv.js';
import * as inPlace from './cv-inplace-run.js';
import * as experience from './experience.js';
import * as files from './files.js';
import * as storeFiles from './store/files.js';
import * as notionGate from './notion-gate.js';
import {registerJobLetterHandlers} from './job-letter-handlers.js';
import * as pipeline from './pipeline.js';
import {registerReadyHandlers} from './ready-handlers.js';
import * as strategy from './strategy.js';
import fs from 'node:fs';
import {log as appLog} from './log.js';
import {currentDocx} from './cv-docx.js';
import {makeDocx} from './cv-docx-tailor.js';
import {findOffice} from './office.js';

export function registerKitHandlers(ctx) {
  const {DEMO, allowanceBlock, app, cloud, dispatchCloud, ipcMain, keepLook, log, needsNotion, notify, openTailoredCv, pageImages, powerMonitor, printPdf, readCvPdf, renderDocx, shell, storage, track} = ctx;
  registerReadyHandlers({ipcMain, notify, shell, storage, app, powerMonitor, prepare: {kit: (code, name) => prepareKitFor(code, name, {quiet: true}), cv: (code, name) => tailorCv(code, name, {show: false, quiet: true})}});   // Ready to send (the owner's install only): the card beside Tailor on Actions, its calls in lib/ready-handlers.js
  const {makeFor: makeJobLetter} = registerJobLetterHandlers({DEMO, ipcMain, printPdf, shell, storage});   // the job's own cover letter, made after its CV
  // The application kit: the form's questions (read from the ATS), an answer for each and a cover letter,
  // saved on the job's Notion Applications row (Stage Kit ready). Apply needs one.
  const prepareKitFor = async (code, name = 'this job', {quiet = false} = {}) => {
    const gate = needsNotion('prepare');
    if (gate) return gate;
    const blocked = await allowanceBlock();
    if (blocked) return blocked;
    // With Always on, background jobs run in the user's GitHub repo: Recent activity
    // shows it starting, its progress and its result (its ⏱️ Search runs row); the job's row updates from Notion.
    if (cloud()) {
      const started = await dispatchCloud(`Application kit (${name})`, {mode: 'prepare', job: code});
      return started.ok ? {ok: true, cloud: true} : {ok: false, error: started.error};
    }
    // Quietly: the result comes as a notification (and the row's Apply), not as log output.
    const lines = [];
    const {code: exit} = await pipeline.run(storage, pipeline.dailyArgs(storage, {mode: 'prepare', job: code}), line => lines.push(line),
      pipeline.triggerEnv('you'));
    const ineligible = lines.map(line => line.replace(/<[^>]+>/g, '')).find(line => line.includes('Not eligible:'));
    if (quiet) { if (exit === 0) track('kit_prepared', {}); return {ok: exit === 0}; }  // an Apply batch: it reports once at the end
    if (exit !== 0) notify('Kit not prepared', `${name}: ${lines.filter(Boolean).slice(-1)[0] || 'something went wrong'}`, {view: 'jobs', job: code}, 'bad');
    else notify('Application kit ready ✓', ineligible ? `${name}. ${ineligible.trim()}` : `${name}. Press Apply to fill the form.`, {view: 'jobs', job: code}, 'good');
    if (exit === 0) track('kit_prepared', {});
    return {ok: exit === 0, ineligible: ineligible || ''};
  };
  ipcMain.handle('prepareKit', (_, code, name) => prepareKitFor(code, name));
  // Tailored CV for one job: base CV (imported from the CV PDF the first time) + the posting -> Claude ->
  // checked -> PDF. A fixed-page design that overflows gets one second try with that feedback.
  const tailorCv = async (code, name = 'this job', {show = true, quiet = false} = {}) => {
    const key = storage.secret('ANTHROPIC_API_KEY'), ai = claudeCode.client(storage);
    if (!key && !ai) return {ok: false, error: 'Choose your AI in Settings → Connections → AI first.'};
    try {
      let cost = 0;
      if (!cvlib.baseCv(storage)) {
        if (!fs.existsSync(storage.path('cv.pdf'))) return {ok: false, error: 'Add your CV (PDF or Word) in Settings first.'};
        cost += (await atUpload.ensure(storage, {client: ai, key, look: keepLook})).usd || 0;
      }
      const job = await pipeline.posting(storage, code);
      if (!job.ok) return {ok: false, error: job.error};
      const main = cvlib.baseCv(storage), base = experience.withExtras(storage, main);   // the main CV + the bank's extra bullets (same jobs and dates)
      const {profile} = await strategy.profileTexts(storage);
      // The person's own PDF edited in place when it can be (same design, fonts and pages); otherwise today's template.
      const own = readCvPdf ? await inPlace.prepare(storage, base, readCvPdf) : {why: 'no PDF reader'};
      if (own.why) appLog('cv', 'tailored CV from the template', {code, why: own.why});
      let feedback = '', result, applied, printed, edited = null;
      for (let attempt = 0; attempt < 2; attempt++) {
        const answer = await cvlib.tailor(storage, job, key, {client: ai, feedback, profile, base, room: own.room});
        cost += answer.usd;
        result = answer.result;
        applied = cvlib.applyTailoring(base, result, `${profile} ${experience.knownText(storage, main)}`);
        if (own.doc) {
          // A Word CV: its own .docx edited and drawn again (lib/cv-docx-tailor.js); else, or when that fails, its PDF edited in place.
          const docx = renderDocx && currentDocx(storage);
          edited = docx ? await makeDocx(storage, docx, applied, base, {readPdf: readCvPdf, renderDocx, soffice: findOffice(storage.path('office'))}) : null;
          if (edited?.why) appLog('cv', 'Word CV not edited, its PDF is', {code, why: edited.why});
          if (!edited || edited.why) edited = await inPlace.make(own, base, applied, {cacheDir: storage.path('fonts')});
          if (!edited.why) { applied = {...applied, warnings: edited.warnings, review: edited.review}; printed = {pdf: edited.pdf, overflow: []}; break; }
          appLog('cv', 'tailored CV from the template', {code, why: edited.why});
          edited = null;
        }
        printed = await printPdf(cvlib.writeHtml(storage, applied.cv, `${code}.html`));
        if (!printed.overflow.length) break;
        feedback = `Your last version didn't fit on page ${printed.overflow.join(', ')}: make the bullets on that page shorter or drop one, so it fits.`;
        if (attempt === 1) applied.warnings.push(`Page ${printed.overflow.join(', ')} is too full and its end is cut off: tailor again, or shorten it by hand.`);
      }
      const record = {job: {code, title: job.title, company: job.company, url: job.url}, createdAt: new Date().toISOString(),
        model: cvlib.MODEL, usd: Math.round(cost * 100) / 100, changes: result.changes, warnings: applied.warnings, cv: applied.cv, review: applied.review, result,
        ...(edited ? {inPlace: edited.inPlace} : {})};
      cvlib.save(storage, code, record, printed.pdf);
      if (edited) try { cvlib.savePages(storage, code, await pageImages(cvlib.pdfPath(storage, code), edited.inPlace.pages.length)); }
      catch (error) { appLog('cv', 'review pages not drawn', {code, error: error.message}); }
      // The job's cover letter with it (kit's or drafted from this CV); a failure leaves the CV standing and is said in the notification.
      const {answers} = await strategy.profileTexts(storage);
      const letter = await makeJobLetter({...job, code}, applied.cv, {profile, answers});
      cost += letter.usd || 0;
      // Notion too, on the job's Applications row (the PDF isn't only on this Mac); no row yet -> said below.
      // With the data on this Mac (lib/store) the PDF is kept here only, and nothing is said about Notion.
      const notionStore = notionGate.notionInUse(storage);
      const fileName = `CV · ${job.company} · ${job.title}.pdf`.replace(/[/\\:]/g, '-');
      let inNotion = false, kept = false;
      if (notionStore) try {
        inNotion = await files.tailoredToApplication(storage.secret('NOTION_TOKEN'), storage.settings().notionIds?.NOTION_APPLICATIONS_DB,
          job.url, cvlib.pdfPath(storage, code), fileName);
      } catch (error) { console.error(`Tailored CV not saved to Notion: ${error.message}`); }
      // Any other store keeps it on the job itself (lib/store/files.js attachToJob), so the job page lists it and a move to Notion carries it.
      else try {
        kept = await storeFiles.attachToJob(storage, job.url, cvlib.pdfPath(storage, code), {name: fileName});
        appLog('cv', kept ? 'tailored CV kept on the job' : 'tailored CV not on a job yet', {code});
      } catch (error) { appLog('cv', 'tailored CV not kept on the job', {code, error: error.message}); }
      if (!quiet) notify('Tailored CV + cover letter ready ✓', `${name}: ${result.changes.length} changes${applied.warnings.length ? `, ${applied.warnings.length} to check` : ''}${letter.ok ? ', cover letter made' : `. The cover letter was not made: ${String(letter.error || '').slice(0, 80)}`}.`
        + (!notionStore ? '' : inNotion ? ' Saved in Notion too.' : ' On this Mac only: save the job (☆) to keep it in Notion.'), {view: 'jobs', job: code}, 'good');   // about Notion
      if (show) openTailoredCv(code);   // from the form's panel the window stays behind: the person is on the form, the notification says it is ready
      return {ok: true, usd: Math.round(cost * 100) / 100, letter: letter.ok};
    } catch (error) {
      if (!quiet) notify('CV not tailored', `${name}: ${error.message}`, {view: 'jobs', job: code}, 'bad');
      return {ok: false, error: error.message};
    }
  };
  // The window's 'tailorCv' is answered in cv-handlers.js: it also marks the job as being tailored for the form's panel and restarts the job's open form when done.
  // Tailor CVs for top matches (Actions): the best N open jobs without a tailored CV, one after another (about 1-2 minutes each),
  // so the form needs no wait for it. One notification at the end; each CV is listed on its job as 📄 Tailored CV to check.
  ipcMain.handle('tailorTop', async (_, count) => {
    const n = Math.max(1, Math.min(10, Number(count) || 5));
    const gate = needsNotion('tailor');
    if (gate) return gate;
    const blocked = await allowanceBlock();
    if (blocked) return blocked;
    appLog('cv', 'tailor top matches', {asked: n, by: 'you'});
    // A tracked task like a Jobs check: the banner, a live log, a row in Recent activity and the result line. Started, not awaited: the window follows it.
    pipeline.work(storage, 'tailor', log, async (tee, signal) => {
      let done = 0, failed = 0, usd = 0;
      const tailored = [];
      tee(`Finding your ${n} best matches without a tailored CV…`);   // reading the job list takes a few seconds: the banner is already up
      const jobs = (await pipeline.jobs(storage)).jobs;
      const picked = apply.pickUntailored(jobs, n);
      appLog('cv', 'tailor top matches picked', {asked: n, jobs: picked.length});
      if (!picked.length) {
        const none = apply.nothingToTailor(jobs);
        tee(none); tee('<<<message'); tee(none); tee('message>>>');
        return true;
      }
      tee(`Tailoring ${picked.length} CV${picked.length === 1 ? '' : 's'} for your best matches (1-2 minutes each)`);
      for (const [index, job] of picked.entries()) {
        if (signal?.aborted) break;   // Stop: the CV being written is finished (its AI call is paid for), no next one starts
        tee(`Tailoring ${index + 1} of ${picked.length}: ${job.title} · ${job.company}`);
        const result = await tailorCv(job.code, `${job.title} · ${job.company}`, {show: false, quiet: true});
        if (result.ok) { done++; usd += result.usd || 0; tailored.push(job); tee(`  ✓ ${job.title} · ${job.company}`); } else {
          failed++;
          tee(`  ✗ ${job.title} · ${job.company}: ${String(result.error || 'something went wrong').slice(0, 120)}`);
          appLog('cv', 'tailor top matches: one failed', {job: job.code, reason: String(result.error || '').slice(0, 80)});
        }
      }
      appLog('cv', 'tailor top matches done', {done, failed, usd: Math.round(usd * 100) / 100});
      const text = `Tailored ${done} of ${picked.length} CV${picked.length === 1 ? '' : 's'}${failed ? `, ${failed} failed` : ''}. Open each job's 📄 Tailored CV and cover letter to check them before you apply.`;
      tee(text);
      // The card (renderer/kits-ready.js reads this shape): the count, then each tailored job's title with its link, and its company.
      tee('<<<message');
      if (tailored.length) {
        tee('✂️ Tailored CVs + cover letters ready');
        tee(`${done} of ${picked.length} tailored${failed ? ` · ${failed} failed` : ''} · check each before you apply`);
        for (const job of tailored) { tee(''); tee(`${job.title} (${job.url})`); tee(job.company); }
      } else tee(text);
      tee('message>>>');
      return done > 0;
    }).catch(error => log(`Tailor CVs failed: ${error.message}`));
    return {ok: true, started: true, text: 'Tailoring started.'};
  });
  return {prepareKitFor, tailorCv};   // the groups that draft a kit or tailor a CV on the way (apply, the CV handlers) use these
}
