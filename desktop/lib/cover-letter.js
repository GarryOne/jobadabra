// The user's general cover letter (Settings → Profile → Cover letter): drafted once by the AI from the CV, the Profile and
// the standard answers, reviewed and approved by the user, then kept as text and as a PDF. A form that asks for a letter
// file gets it when no complete tailored letter exists; only approved, complete base letters with a PDF are usable.
//
//   cover-letter/letter.json  {text, status: 'draft' | 'approved', createdAt, approvedAt, model, usd, paidBy: 'credits' | 'api' | 'plan' | ''}
//   cover-letter/letter.pdf   only while approved: an edit makes it a draft again and removes the PDF
import {nameOfClient} from './ai/names.js';
import {priceOf} from './ai/models.js';
import {anthropicApi} from './ai/anthropic-api.js';
import fs from 'node:fs';
import path from 'node:path';
import {baseCv, MODEL} from './cv.js';
import {writePrivate} from './private-file.js';
import {WRITING_RULES} from '../shared/worker/writing-rules.js';

const PRICE = {input: 2, output: 10};  // USD per million tokens
// USD cost of one response's usage ({input_tokens, output_tokens, billing}), rounded to a cent; 0 on a subscription or without usage. Shared by the letter and the portrait.
export const usdOf = usage => (usage?.billing === 'subscription' ? 0 : Math.round(((usage?.input_tokens || 0) * priceOf(usage, PRICE).input + (usage?.output_tokens || 0) * priceOf(usage, PRICE).output) / 1e4) / 100);

export const dir = storage => storage.path('cover-letter');
const jsonPath = storage => path.join(dir(storage), 'letter.json');
export const pdfPath = storage => path.join(dir(storage), 'letter.pdf');

export const load = storage => { try { return JSON.parse(fs.readFileSync(jsonPath(storage), 'utf8')); } catch { return null; } };
function write(storage, record) {
  fs.mkdirSync(dir(storage), {recursive: true});
  writePrivate(jsonPath(storage), JSON.stringify(record, null, 2) + '\n');
  return record;
}

export const status = storage => {
  const record = load(storage);
  return {text: record?.text || '', state: record ? record.status : 'none', approvedAt: record?.approvedAt || '', createdAt: record?.createdAt || '',
    pdf: record?.status === 'approved' && fs.existsSync(pdfPath(storage)), usd: record?.usd || 0, paidBy: record?.paidBy || ''};
};

// Who pays for a draft (owner, 18 Oct 2026: said before and after it runs): a plan (Claude Code, Codex), the app's AI credits (Free AI JPF1.…, the
// founder credit JP1.…) or the person's own API account. '' when no AI is set up. The client wins over the key, as in generate().
export const paidByOf = ({key = '', client = null} = {}) => (client ? (client.billing === 'subscription' ? 'plan' : 'api') : /^JPF?1\./.test(key) ? 'credits' : key ? 'api' : '');

const SCHEMA = {type: 'object', additionalProperties: false, required: ['letter'], properties: {letter: {type: 'string'}}};

const INSTRUCTIONS = `You write a general-purpose cover letter for a job seeker, to be sent with applications to many different roles.
Use only the applicant details given here; never a name, e-mail address, phone number, country, city, street address or other location from any other context (such as an account you are signed in with): when a detail is not given, leave it empty.
It is built from their CV, their Profile (confirmed facts, preferences and what they look for) and their standard
application answers (which show how they write).
- Voice: the candidate's own, as the standard answers show it: direct and personal, first person, plain words. No taglines,
  no buzzwords, no "I am writing to apply", no flattery of the employer, no closing clichés.
- Length: 150-200 words, 3 short paragraphs separated by a blank line: who they are and what they do best, one or two concrete
  things from the CV that prove it (with its real numbers), what they are looking for next.
- General: do not name a company, a role or a hiring manager. Start with "Dear Hiring Team," and end with "Kind regards," then the name.
- Hard rules: use only facts from the CV and the facts the Profile states as confirmed; never use anything marked ❓; never add
  a tool, employer, number, certification or responsibility that isn't there; never inflate scope. Same language as the CV.
- Plain text only, no markdown, no placeholders like [Company].
If feedback is given, revise the previous letter accordingly.`;

const cvText = cv => JSON.stringify({name: cv.name, location: cv.location, summary: cv.summary, skills: cv.skills, languages: cv.languages,
  jobs: cv.jobs.map(job => ({company: job.company, roles: job.roles.map(r => ({title: r.title, period: r.period, bullets: r.bullets}))}))}, null, 1);

export async function generate(storage, {apiKey, client = null, profile = '', answers = '', preferences = '', feedback = '', name = '', paidBy = ''}) {
  const cv = baseCv(storage);
  if (!cv) throw new Error('Read your CV first (Preview CV or Read my CV PDF).');
  const previous = load(storage)?.text || '';
  const anthropic = client || anthropicApi(apiKey);
  const response = await anthropic.messages.create({
    model: MODEL, max_tokens: 3000, system: `${INSTRUCTIONS}\n\n${WRITING_RULES}`,
    messages: [{role: 'user', content: `<cv>\n${cvText(cv)}\n</cv>\n\n<profile>\n${profile.slice(0, 40000)}\n</profile>\n\n` +
      `<standard_answers>\n${answers.slice(0, 20000)}\n</standard_answers>\n\n` + (preferences ? `<search_preferences>\n${preferences.slice(0, 4000)}\n</search_preferences>\n\n` : '') +
      `<candidate_name>${name || cv.name || ''}</candidate_name>` +
      (feedback && previous ? `\n\n<previous_letter>\n${previous}\n</previous_letter>\n<feedback>${feedback}</feedback>` : '')}],
    output_config: {format: {type: 'json_schema', schema: SCHEMA}},
  }, {headers: {'x-jp-action': 'cover_letter'}});
  if (response.stop_reason === 'refusal') throw new Error(`${nameOfClient(anthropic)} declined to write this letter`);
  if (response.stop_reason === 'max_tokens') throw new Error('The letter was cut off; try again');
  const text = JSON.parse(response.content.find(block => block.type === 'text').text).letter.trim();
  if (!text) throw new Error('The letter came back empty; try again');
  const cost = usdOf(response.usage);
  write(storage, {text, status: 'draft', createdAt: new Date().toISOString(), model: MODEL, usd: cost, paidBy});
  fs.rmSync(pdfPath(storage), {force: true});
  return {text, usd: cost};
}

// The user's own edit: keeps the text, becomes a draft again (the approved PDF no longer matches it).
export function edit(storage, text) {
  const clean = String(text || '').replace(/\r\n/g, '\n').trim();
  if (!clean) throw new Error('The letter is empty.');
  const record = load(storage) || {createdAt: new Date().toISOString(), model: 'you', usd: 0};
  if (record.status === 'approved' && record.text === clean) return record;
  fs.rmSync(pdfPath(storage), {force: true});
  return write(storage, {...record, text: clean, status: 'draft', approvedAt: ''});
}

// A gap left to fill ("[Company]", "{name}"): a letter with one never goes to a form (owner, 18 Oct 2026). By shape: brackets around a short phrase, any language.
export const gapIn = text => String(text || '').match(/\[[^\]\n]{1,60}\]|\{[^}\n]{1,60}\}/)?.[0] || '';
export const hasGap = text => !!gapIn(text);
export function approve(storage, pdf) {
  const record = load(storage);
  if (!record?.text) throw new Error('No letter to approve yet.');
  if (hasGap(record.text)) throw new Error(`Fill in ${gapIn(record.text)} first, then approve.`);
  fs.mkdirSync(dir(storage), {recursive: true});
  writePrivate(pdfPath(storage), pdf);
  return write(storage, {...record, status: 'approved', approvedAt: new Date().toISOString()});
}

// ---------- the PDF page ----------
const escape = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// A plain A4 letter: the sender's name and contact line on top, then the text. `contact` is the Profile's details.
export function html(text, contact = {}, cv = null) {
  const name = contact.full_name || [contact.first_name, contact.last_name].filter(Boolean).join(' ') || cv?.name || '';
  const line = [contact.email, contact.phone, contact.location || cv?.location].filter(Boolean).map(escape).join(' · ');
  const body = String(text).split(/\n{2,}/).map(p => `<p>${escape(p.trim()).replace(/\n/g, '<br>')}</p>`).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><title>Cover letter${name ? ` · ${escape(name)}` : ''}</title><style>
    @page { size: A4; margin: 0 } * { box-sizing: border-box }
    body { margin: 0; padding: 22mm 22mm; font: 11pt/1.55 -apple-system, "Helvetica Neue", Arial, sans-serif; color: #1c2430 }
    header { border-bottom: 1px solid #c9d1db; padding-bottom: 10px; margin-bottom: 22px }
    h1 { font-size: 17pt; margin: 0 0 3px } .line { color: #5b6776; font-size: 9.5pt }
    p { margin: 0 0 12px }
  </style></head><body><header>${name ? `<h1>${escape(name)}</h1>` : ''}${line ? `<div class="line">${line}</div>` : ''}</header>${body}</body></html>`;
}
