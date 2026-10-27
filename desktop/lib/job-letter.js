// A job's own cover letter, made together with its tailored CV (Tailor CV + cover letter): the kit's letter when the job has one, else drafted
// here from the tailored CV and the posting; kept as text and as a PDF in the CV's design. The extension gets the PDF for an upload slot
// (server-contact.js me()); the approved base letter is the automatic fallback when this tailored letter is unusable. Guarded by desktop/test/job-letter.test.js.
//
//   cover-letter/jobs/<job code>.json  {job, text, source: 'kit' | 'ai' | 'you', createdAt, model, usd, tokens, warnings}
//   cover-letter/jobs/<job code>.pdf   always matches the text (an edit remakes it at once)
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {nameOfClient} from './ai/names.js';
import {anthropicApi} from './ai/anthropic-api.js';
import {baseCv, dir as cvDir, MODEL, style, usd} from './cv.js';
import {writePrivate} from './private-file.js';
import {DEFAULT_CSS, FONTS} from '../cv/template.js';
import {WRITING_RULES} from '../shared/worker/writing-rules.js';

const safeCode = code => String(code).replace(/[^a-z0-9]/gi, '');
export const dir = storage => storage.path('cover-letter/jobs');
const file = (storage, code, ext) => path.join(dir(storage), `${safeCode(code)}.${ext}`);
export const pdfPath = (storage, code) => file(storage, code, 'pdf');
export const load = (storage, code) => { try { return JSON.parse(fs.readFileSync(file(storage, code, 'json'), 'utf8')); } catch { return null; } };
export const hasPdf = (storage, code) => !!code && fs.existsSync(pdfPath(storage, code));

// What the window shows for a job: the text, where it came from, whether its PDF is there.
export const status = (storage, code) => {
  const record = load(storage, code);
  return {text: record?.text || '', source: record?.source || 'none', createdAt: record?.createdAt || '', usd: record?.usd || 0, warnings: record?.warnings || [], pdf: hasPdf(storage, code)};
};

export function save(storage, code, record, pdf) {
  fs.mkdirSync(dir(storage), {recursive: true});
  writePrivate(file(storage, code, 'json'), JSON.stringify(record, null, 2) + '\n');
  writePrivate(file(storage, code, 'pdf'), pdf);
}

// The name a form shows for it, like the CV's: Letter_<Name>_<Company>.pdf.
export function finalName(storage, record) {
  const word = text => String(text || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  return ['Letter', word(baseCv(storage)?.name), word(record?.job?.company)].filter(Boolean).join('_').slice(0, 90) + '.pdf';
}

const SCHEMA = {type: 'object', additionalProperties: false, required: ['letter'], properties: {letter: {type: 'string'}}};
const INSTRUCTIONS = `You write a cover letter for one job, for a job seeker whose CV was just tailored to that posting.
Use only the applicant details given here; never a name, e-mail address, phone number, country, city, street address or other location from any other context (such as an account you are signed in with): when a detail is not given, leave it empty.
- Voice and style: the candidate's own, as the standard answers show it (follow their "Cover letter style" when there is one): direct and personal, first person, plain words. No taglines, no buzzwords, no "I am writing to apply", no flattery of the employer, no closing clichés.
- Length: 150-200 words, 3 short paragraphs separated by a blank line: why this role fits what they do best, one or two concrete things from the tailored CV that prove it (with its real numbers), what they bring next.
- Name the company and the role once, naturally. Start with "Dear Hiring Team," and end with "Kind regards," then the name.
- Hard rules: use only facts from the tailored CV and the facts the Profile states as confirmed; never use anything marked ❓; never add a tool, employer, number, certification or responsibility that isn't there; never inflate scope. Write in the language of the posting.
- Plain text only, no markdown, no placeholders like [Company].
If feedback is given, revise the previous letter accordingly.`;

const numbers = text => String(text || '').match(/\d+(?:[.,]\d+)*/g) || [];

// The text for a job: `kitLetter` (the job's kit has one) is used as it is, free; else one AI call from the tailored CV + the posting.
export async function draft(storage, {job, cv, kitLetter = '', profile = '', answers = '', preferences = '', feedback = '', previous = '', name = '', apiKey, client = null}) {
  let text = String(kitLetter || '').trim(), cost = 0, tokens = {input: 0, output: 0}, source = 'kit';
  if (!text || feedback) {
    const anthropic = client || anthropicApi(apiKey);
    const response = await anthropic.messages.create({
      model: MODEL, max_tokens: 3000, system: `${INSTRUCTIONS}\n\n${WRITING_RULES}`,
      messages: [{role: 'user', content: `<tailored_cv>\n${JSON.stringify(cv, null, 1)}\n</tailored_cv>\n\n<profile>\n${profile.slice(0, 40000)}\n</profile>\n\n` +
        `<standard_answers>\n${answers.slice(0, 20000)}\n</standard_answers>\n\n` + (preferences ? `<search_preferences>\n${preferences.slice(0, 4000)}\n</search_preferences>\n\n` : '') +
        `<posting>\n${job.title} at ${job.company}${job.location ? ` (${job.location})` : ''}\n\n${(job.description || '(no description stored: write to the title)').slice(0, 30000)}\n</posting>\n\n` +
        `<candidate_name>${name || cv.name || ''}</candidate_name>` +
        (feedback && previous ? `\n\n<previous_letter>\n${previous}\n</previous_letter>\n<feedback>${feedback}</feedback>` : '')}],
      output_config: {format: {type: 'json_schema', schema: SCHEMA}},
    }, {headers: {'x-jp-action': 'job_cover_letter'}});
    if (response.stop_reason === 'refusal') throw new Error(`${nameOfClient(anthropic)} declined to write this letter`);
    if (response.stop_reason === 'max_tokens') throw new Error('The letter was cut off; try again');
    text = JSON.parse(response.content.find(block => block.type === 'text').text).letter.trim();
    cost = usd(response.usage);
    tokens = {input: response.usage?.input_tokens || 0, output: response.usage?.output_tokens || 0};
    source = 'ai';
  }
  if (!text) throw new Error('The letter came back empty; try again');
  // A figure the CV and the Profile never gave is flagged, as the tailored CV's are.
  const known = new Set(numbers(`${JSON.stringify(cv)} ${profile} ${job.title} ${job.company}`));
  const warnings = [...new Set(numbers(text).filter(n => !known.has(n)))].map(n => `The letter says ${n}, which your CV and Profile don't: check it.`);
  return {text, usd: cost, tokens, source, warnings, model: MODEL};
}

// ---------- the PDF page: the CV's design (its own style.css, else the default look and Inter), a letter on one A4 sheet ----------
const escape = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
export function html(storage, text, contact = {}, cv = null) {
  const name = contact.full_name || [contact.first_name, contact.last_name].filter(Boolean).join(' ') || cv?.name || '';
  const line = [contact.email, contact.phone, contact.location || cv?.location].filter(Boolean).map(escape).join(' · ');
  const body = String(text).split(/\n{2,}/).map(p => `<p>${escape(p.trim()).replace(/\n/g, '<br>')}</p>`).join('');
  const look = style(storage) || DEFAULT_CSS;
  return `<!doctype html><html><head><meta charset="utf-8"><base href="${pathToFileURL(cvDir(storage) + path.sep).href}"><title>Cover letter${name ? ` · ${escape(name)}` : ''}</title><style>${FONTS}
@page { size: A4; margin: 0 } * { box-sizing: border-box; margin: 0; padding: 0 } body { font-family: Inter, sans-serif; -webkit-print-color-adjust: exact }
${look}
@page { size: A4; margin: 0 } body { padding: 22mm; font-size: 10.5pt; line-height: 1.5 } .head { margin-bottom: 18pt; border-bottom: 0.75pt solid #d8d8d8; padding-bottom: 8pt }
.letter p + p { margin-top: 10pt }</style></head><body><div class="head"><div class="name">${escape(name)}</div><div class="loc">${line}</div></div><div class="letter">${body}</div></body></html>`;
}
