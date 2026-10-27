// One derived cover-letter availability decision for setup, the review queue and application delivery; existing records remain the only owners.
import fs from 'node:fs';
import * as letters from './cover-letter.js';
import * as jobLetter from './job-letter.js';
import * as cv from './cv.js';

const gap = (state, reason, action) => ({state, ready: false, reason, action, target: 'letter'});

/** Select text and PDF from one usable record. Tailored wins; base use always requires the person's fallback choice. */
export function availableLetter(storage, url = '', {given = false} = {}) {
  if (given === true) return {status: {state: 'ready', ready: true, source: 'form', reason: '', action: '', target: 'letter'}, text: '', file: null};
  const base = letters.status(storage), tailored = url ? cv.forUrl(storage, url) : null;
  const job = tailored ? jobLetter.load(storage, tailored.job.code) : null;
  let record = null, file = '', name = '', source = '';
  // Why (2026-10-27, owner): both forms use one selected record; approval never silently opts the base into fallback use.
  if (job?.text?.trim() && !letters.hasGap(job.text) && jobLetter.hasPdf(storage, tailored.job.code)) {
    record = job; file = jobLetter.pdfPath(storage, tailored.job.code); name = jobLetter.finalName(storage, tailored); source = 'tailored';
  } else if (base.state === 'approved' && base.text.trim() && !letters.hasGap(base.text) && letters.fallbackOn(storage.settings()) && base.pdf) {
    record = base; file = letters.pdfPath(storage); name = 'Cover letter.pdf'; source = 'base';
  }
  if (record) {
    try {
      return {status: {state: 'ready', ready: true, source, reason: '', action: '', target: 'letter'}, text: record.text,
        file: {name, type: 'application/pdf', data: fs.readFileSync(file).toString('base64'), tailored: source === 'tailored'}};
    } catch { return {status: gap('unavailable', 'The cover-letter PDF could not be read. Review it and make the PDF again.', 'Review cover letter'), text: '', file: null}; }
  }
  const status = base.text && letters.hasGap(base.text) ? gap('invalid', 'The cover letter still has placeholders to complete.', 'Complete cover letter')
    : base.state === 'draft' ? gap('draft', 'Your cover letter is a draft and needs your review and approval.', 'Review cover letter')
    : base.state === 'approved' && !base.pdf ? gap('unavailable', 'The approved cover-letter PDF is missing. Make it again.', 'Review cover letter')
    : base.state === 'approved' && !letters.fallbackOn(storage.settings()) ? gap('disabled', 'The base letter is approved, but use as a fallback is off. Choose it or prepare this job’s letter.', 'Set cover letter')
    : job?.text ? gap('unavailable', 'This job’s cover letter needs a complete text and PDF. Review its preparation kit.', 'Review cover letter')
    : gap('missing', 'No usable cover letter has been created. Create and review it before applying.', 'Create cover letter');
  return {status, text: '', file: null};
}

/** The single derived setup action, removed automatically when an approved fallback is usable; never saved as an answer. */
export function letterQuestion(storage) {
  const {status} = availableLetter(storage);
  return status.ready ? null : {key: 'setup:cover-letter', question: 'Set up your cover letter', company: '', priority: 'HIGH PRIORITY', weight: 1e13,
    hint: status.reason, setup: {kind: 'cover-letter', ...status}};
}
