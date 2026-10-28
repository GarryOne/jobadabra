// Tailored CVs. The base CV is data (cv/cv.json in the user's folder: summary, jobs, bullets, skills, links),
// made once from the CV PDF (importPdf) or by hand; cv/template.js turns it into HTML and Chromium prints the PDF.
// Tailoring one job = one Claude call that may rewrite the summary, reorder, reword or drop bullets and reorder
// skills, using only facts already in the CV (or confirmed in the Profile). The code then checks the result:
// same jobs, titles, dates and places; no number that wasn't there; unknown terms flagged for review.
//
//   cv/cv.json, cv/assets/ (photo, logos), cv/style.css (optional own design)
//   cv/tailored/<job code>.json (the tailored data, what changed and why) and .pdf
import {nameOfClient} from './ai/names.js';
import {priceOf} from './ai/models.js';
import {anthropicApi} from './ai/anthropic-api.js';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {isFormOf} from './apply.js';
import {render} from '../cv/template.js';
import {pagesDocument} from './cv-inplace-review.js';
import {writePrivate} from './private-file.js';

export const MODEL = process.env.JOB_PILOTTO_MODEL_OVERRIDE || 'claude-sonnet-5-5';   // the override: the end-to-end journey (desktop/e2e)
const PRICE = {input: 2, output: 10};  // USD per million tokens
export const usd = usage => (usage?.billing === 'subscription' ? 0 : Math.round(((usage?.input_tokens || 0) * priceOf(usage, PRICE).input + (usage?.output_tokens || 0) * priceOf(usage, PRICE).output) / 1e4) / 100);  // Claude Code: the user's plan, $0

const string = {type: 'string'};
const list = {type: 'array', items: string};
const object = properties => ({type: 'object', additionalProperties: false, required: Object.keys(properties), properties});

export const dir = storage => storage.path('cv');
const tailoredDir = storage => path.join(dir(storage), 'tailored');
export const baseCv = storage => { try { return JSON.parse(fs.readFileSync(path.join(dir(storage), 'cv.json'), 'utf8')); } catch { return null; } };
export const style = storage => { try { return fs.readFileSync(path.join(dir(storage), 'style.css'), 'utf8'); } catch { return ''; } };

// ---------- import: CV PDF -> cv.json ----------
export const IMPORT_SCHEMA = object({
  name: string, location: string, summary: string,
  links: {type: 'array', items: object({text: string, href: string})},
  jobs: {type: 'array', items: object({company: string, href: string, roles: {type: 'array', items: object({
    title: string, period: string, place: string, intro: string, bullets: list, skills: string})}})},
  education: {type: 'array', items: object({school: string, degree: string, period: string})},
  skills: string, languages: string,
});

const IMPORT_INSTRUCTIONS = `Transcribe this CV into the JSON schema, verbatim: same words, same order, nothing added, fixed or
Use only the applicant details given here; never a name, e-mail address, phone number, country, city, street address or other location from any other context (such as an account you are signed in with): when a detail is not given, leave it empty.
summarised. One entry in jobs per employer, most recent first; several positions at one employer are several roles.
period like "Mar 2024 – Present"; place is the city/country or "Remote"; intro is a one-line description written above
the bullets ("" if none); skills is a role's own "Skills:" line ("" if none). Top-level skills/languages only if the CV has
such sections. links: phone, email and profile URLs shown in the header (href as tel:, mailto: or https://). Keep the CV's
bold figures as **bold**. Use "" for anything the CV doesn't show.`;

// A CV PDF transcribed into the schema (no files written): the main CV's import and the extra versions (lib/experience.js) read it alike.
export async function transcribePdf(pdf, apiKey, client = null) {
  const anthropic = client || anthropicApi(apiKey);
  const response = await anthropic.messages.create({
    model: MODEL, max_tokens: 16000, system: IMPORT_INSTRUCTIONS,
    messages: [{role: 'user', content: [
      {type: 'document', source: {type: 'base64', media_type: 'application/pdf', data: pdf.toString('base64')}},
      {type: 'text', text: 'Transcribe this CV.'}]}],
    output_config: {format: {type: 'json_schema', schema: IMPORT_SCHEMA}},
  }, {headers: {'x-jp-action': 'tailor'}});
  if (response.stop_reason === 'refusal') throw new Error(`${nameOfClient(anthropic)} declined to read this CV`);
  const data = JSON.parse(response.content.find(block => block.type === 'text').text);
  const clean = {...data, jobs: data.jobs.map(({href, ...job}) => ({...job, ...(href ? {href} : {}),
    roles: job.roles.map(({intro, skills, ...r}) => ({...r, ...(intro ? {intro} : {}), ...(skills ? {skills} : {})}))}))};
  for (const key of ['skills', 'languages', 'location', 'summary']) if (!clean[key]) delete clean[key];
  return {cv: clean, usd: usd(response.usage)};
}

const hashOf = bytes => crypto.createHash('sha256').update(bytes).digest('hex').slice(0, 16);
export const pdfHash = storage => { try { return hashOf(fs.readFileSync(storage.path('cv.pdf'))); } catch { return ''; } };
export const importedFrom = storage => { try { return JSON.parse(fs.readFileSync(path.join(dir(storage), 'import.json'), 'utf8')).pdf || ''; } catch { return ''; } };

// look: async cv => cv, keeps the PDF's photo, icons, logos and page breaks (lib/cv-look.js; needs a window, so main.js passes it). A failure there keeps the plain CV.
export async function importPdf(storage, apiKey, client = null, {look = null} = {}) {
  const bytes = fs.readFileSync(storage.path('cv.pdf'));   // the hash below is of these bytes: a PDF swapped in while the AI reads must not be named as this cv.json's source
  const {cv: clean, usd: cost} = await transcribePdf(bytes, apiKey, client);
  let kept = clean;
  if (look) { try { kept = await look(clean); } catch (error) { console.error(`CV look not kept: ${error.message}`); } }
  fs.mkdirSync(dir(storage), {recursive: true});
  writePrivate(path.join(dir(storage), 'cv.json'), JSON.stringify(kept, null, 2) + '\n');
  writePrivate(path.join(dir(storage), 'import.json'), JSON.stringify({pdf: hashOf(bytes)}) + '\n');   // which PDF cv.json was read from (lib/cv-import-at-upload.js)
  return {cv: kept, usd: cost};
}

// ---------- tailoring ----------
export const TAILOR_SCHEMA = object({
  summary: string,
  jobs: {type: 'array', items: object({company: string, roles: {type: 'array', items: object({
    title: string,
    bullets: {type: 'array', items: object({source: {type: 'integer'}, text: string})},
    skills: string,
  })}})},
  changes: {type: 'array', items: object({where: string, change: string, why: string})},
});

const TAILOR_INSTRUCTIONS = `You tailor a candidate's CV to one job posting. The CV is given as JSON; every bullet has an index.
Use only the applicant details given here; never a name, e-mail address, phone number, country, city, street address or other location from any other context (such as an account you are signed in with): when a detail is not given, leave it empty.
Return the same jobs and roles, in the same order, with the same company and title strings. For each role you may:
- reorder bullets so the ones most relevant to the posting come first (keep each bullet's "source" index),
- reword a bullet to use the posting's vocabulary where it describes the same work (e.g. "incident management" when the
  bullet is about incidents), keeping it about as long or shorter,
- drop at most 2 bullets per role that are irrelevant to this posting,
- reorder the role's skills line (same items; "" if the role has none).
Rewrite the summary (2–3 sentences, similar length) to lead with what this posting asks for, keeping the CV's own
role title at its start (e.g. "Site Reliability Engineer …"): the candidate's identity doesn't change per job.
Rewording changes emphasis and vocabulary, never claims: don't replace a concrete detail with an outcome the CV doesn't
state (e.g. "reduced alert noise", "improved signal quality", "at scale"), and prefer the smallest edit that works.
Bullets flagged "extra" come from other versions of the same person's CV: they are real facts the main CV doesn't list. Use one
only where it answers the posting better than a main bullet, instead of that bullet (the role must not get longer), and leave the
others out; they never count as dropped. "extra_skills" are real skills from those versions: the summary may name one the posting
asks for, a role's skills line never gains one.
<about_you> holds what the candidate told us: details (confirmed facts), strategy (what they look for) and learned (answers they gave on forms). A learned answer may
shape the summary only where it answers the posting (e.g. a stated way of working the posting asks for); never put one in a role's bullets or skills, and never invent anything from it.
Hard rules: use only facts from the CV and the facts in <about_you>; never use anything unknown or still a question, never
add a tool, technology, certification, number, employer or responsibility that isn't there, never change numbers (keep
**bold** figures), never inflate scope ("led" only where the CV says led). Same language as the CV. The result must fit
the same pages: don't make the CV longer.
changes: 3–8 short items for the candidate: where (e.g. "Summary", "Acme · Data Engineer"), what changed, and why
(which part of the posting it answers).`;

// When the tailored CV is the person's own PDF edited in place (lib/cv-inplace.js): each text is re-set on its own lines.
const IN_PLACE_RULES = `
This CV keeps its own design: each text is re-set on the lines it has now, so nothing can grow past them. Keep every bullet of
every role (drop none; reorder and reword only). The summary and each bullet carry "max_chars": the new wording must not be longer.
When the CV carries "summary_paragraphs_max_chars", its summary is set in paragraphs and list lines (one per line, a list line starting
with "- "): keep the same number of lines in the same order, separated by line breaks, each line within its own entry.`;

// The CV as the model sees it: bullets numbered per role. room (in place): the characters each text may take (cv-inplace roomOf);
// the extra bullets are left out then, since the person's own page has no lines for them.
const numbered = (cv, room = null) => ({summary: cv.summary || '', ...(room?.summary ? {summary_max_chars: room.summary} : {}),
  ...(room?.summaryParts ? {summary_paragraphs_max_chars: room.summaryParts} : {}),
  jobs: cv.jobs.map((job, j) => ({company: job.company, roles: job.roles.map((r, ri) => ({
    title: r.title, period: r.period, ...(r.intro ? {intro: r.intro} : {}),
    bullets: r.bullets.map((text, index) => ({index, text, ...(r.extra?.includes(index) ? {extra: true} : {}),
      ...(room?.jobs?.[j]?.[ri]?.[index] ? {max_chars: room.jobs[j][ri][index]} : {})}))
      .filter(b => !(room && b.extra)),
    skills: r.skills || ''}))})),
  ...(cv.skills ? {skills: cv.skills} : {}), ...(cv.extraSkills ? {extra_skills: cv.extraSkills} : {})});

// What the candidate told us, as this prompt takes it: the About you bundle of CV tailoring (lib/about-you.js: details and strategy without salary, learnings
// without sensitive ones, conflicts or pay) minus the CV, which the prompt already carries numbered. about: a bundle (tests); else read here, lazily
// (about-you.js imports this file). A part that could not be read is named, never filled from anywhere else.
async function aboutText(storage, about) {
  const bundle = about || await import('./about-you.js').then(mod => mod.aboutYou(storage, 'cv_tailor')).catch(() => null);
  if (!bundle) return '(not available this time)';
  const parts = {...bundle.parts};
  delete parts.cv;
  return JSON.stringify(parts).slice(0, 40000) + (bundle.lacked.filter(name => name !== 'cv').length ? `\n(not available this time: ${bundle.lacked.filter(name => name !== 'cv').join(', ')})` : '');
}

// base: the main CV with the experience bank's extra bullets (lib/experience.js withExtras); the main CV itself when none.
// room: set when the PDF will be edited in place (no drops, a length limit per text).
// about: the About you bundle of CV tailoring (tests pass one); else read from this Mac.
export async function tailor(storage, posting, apiKey, {client = null, feedback = '', base = null, room = null, about = null} = {}) {
  const cv = base || baseCv(storage);
  if (!cv) throw new Error('No base CV yet');
  const anthropic = client || anthropicApi(apiKey);
  const response = await anthropic.messages.create({
    model: MODEL, max_tokens: 12000, system: TAILOR_INSTRUCTIONS + (room ? IN_PLACE_RULES : ''),
    messages: [{role: 'user', content: `<cv>\n${JSON.stringify(numbered(cv, room), null, 1)}\n</cv>\n\n<about_you>\n${await aboutText(storage, about)}\n</about_you>\n\n` +
      `<posting>\n${posting.title} at ${posting.company}${posting.location ? ` (${posting.location})` : ''}\n\n${(posting.description || '(no description stored: tailor to the title)').slice(0, 30000)}\n</posting>` +
      (feedback ? `\n\n<feedback>${feedback}</feedback>` : '')}],
    output_config: {format: {type: 'json_schema', schema: TAILOR_SCHEMA}},
  }, {headers: {'x-jp-action': 'tailor'}});
  if (response.stop_reason === 'refusal') throw new Error(`${nameOfClient(anthropic)} declined to tailor this CV`);
  if (response.stop_reason === 'max_tokens') throw new Error('The tailored CV was cut off; try again');
  return {result: JSON.parse(response.content.find(block => block.type === 'text').text), usd: usd(response.usage)};
}

// ---------- checks and diff ----------
const plain = text => String(text || '').replace(/\*\*/g, '');
const numbers = text => plain(text).match(/\d+(?:[.,]\d+)*/g) || [];
const words = text => new Set(plain(text).toLowerCase().split(/[^\p{L}\p{N}+#.]+/u).map(w => w.replace(/\.+$/, '')).filter(Boolean));
// Tool- or product-like words (capital inside or after the first letter, or digits): must already be known.
const terms = text => [...new Set(plain(text).split(/[^\p{L}\p{N}+#./-]+/u).map(w => w.replace(/[.,-]+$/, ''))
  .filter(w => w.length > 1 && /[A-Z0-9]/.test(w.slice(1)) && !/^\d+$/.test(w)))];
const setOf = line => new Set(String(line || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean));
const sameSet = (a, b) => a.size === b.size && [...a].every(x => b.has(x));

const escape = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
// Words with their **bold** state resolved: [{word, bold}], "**" markers removed.
function tokens(text) {
  let inside = false;
  return String(text || '').split(/\s+/).filter(Boolean).map(raw => {
    const bold = inside || raw.startsWith('**');
    if ((raw.match(/\*\*/g) || []).length % 2) inside = !inside;
    return {word: raw.replace(/\*\*/g, ''), bold};
  });
}
const wordsHtml = list => list.map(t => t.bold ? `<b>${escape(t.word)}</b>` : escape(t.word)).join(' ');

// Word-level diff as HTML: removed words first (<del>), then what replaced them (<ins>); bold kept.
// A mostly rewritten text reads better whole: the new text, with the old one underneath ("Before: …").
export function wordDiff(before, after) {
  const a = tokens(before), b = tokens(after);
  const table = Array.from({length: a.length + 1}, () => new Array(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--)
    table[i][j] = a[i].word === b[j].word ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
  if (table[0][0] < 0.5 * Math.max(a.length, b.length))
    return `${wordsHtml(b)}<span class="before">Before: ${wordsHtml(a)}</span>`;
  const ops = [];
  let i = 0, j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i].word === b[j].word) { ops.push(['=', b[j]]); i++; j++; }
    else if (i < a.length && (j >= b.length || table[i + 1][j] >= table[i][j + 1])) { ops.push(['-', a[i]]); i++; }
    else { ops.push(['+', b[j]]); j++; }
  }
  // Consecutive words of one kind become one <del>/<ins>; a replacement reads "old new".
  const parts = [];
  for (const [op, token] of ops) {
    const last = parts[parts.length - 1];
    if (last && last.op === op) last.tokens.push(token); else parts.push({op, tokens: [token]});
  }
  return parts.map(({op, tokens: list}) => op === '=' ? wordsHtml(list) : `<${op === '-' ? 'del' : 'ins'}>${wordsHtml(list)}</${op === '-' ? 'del' : 'ins'}>`).join(' ');
}

// The model's answer applied to the base CV, after the checks. Returns the tailored CV, the same CV with
// review marks, and warnings (what was refused or needs a look).
export function applyTailoring(base, result, known = '') {
  const warnings = [];
  const vocabulary = words(JSON.stringify(base) + ' ' + known);
  const cvNumbers = new Set(numbers(JSON.stringify(base)));
  const unknownTerms = (text, where) => {
    // Known when the word, or each part of a compound like "50K/month" or "AWS-based", is already in the CV.
    const known = term => vocabulary.has(term.toLowerCase()) || term.split(/[/-]/).every(part => !part || vocabulary.has(part.toLowerCase()) || /^\d/.test(part));
    const unknown = terms(text).filter(term => !known(term));
    if (unknown.length) warnings.push(`${where}: new term${unknown.length > 1 ? 's' : ''} ${unknown.map(t => `"${t}"`).join(', ')}; check it is true`);
  };
  if (result.jobs.length !== base.jobs.length) throw new Error('The tailored CV changed the list of jobs');
  const cv = structuredClone(base), review = structuredClone(base);
  delete cv.extraSkills; delete review.extraSkills;

  let summary = result.summary?.trim() || base.summary || '';
  if (numbers(summary).some(n => !cvNumbers.has(n))) { warnings.push('Summary: a new number appeared; kept your original summary'); summary = base.summary || ''; }
  else unknownTerms(summary, 'Summary');
  cv.summary = summary;
  review.summary = summary;
  if (plain(summary) !== plain(base.summary)) { review.summaryMark = true; review.summaryDiff = wordDiff(base.summary, summary); }

  base.jobs.forEach((job, j) => {
    const got = result.jobs[j];
    if (got.company.trim().toLowerCase() !== job.company.trim().toLowerCase() || got.roles.length !== job.roles.length)
      throw new Error(`The tailored CV changed the jobs (${job.company})`);
    job.roles.forEach((role, r) => {
      const where = `${job.company} · ${role.title}`;
      const seen = new Set();
      const bullets = [];
      for (const item of got.roles[r].bullets) {
        const original = role.bullets[item.source];
        if (original === undefined || seen.has(item.source)) continue;
        seen.add(item.source);
        let text = item.text.trim() || original;
        if (numbers(text).some(n => !numbers(original).includes(n))) {
          warnings.push(`${where}: a reworded bullet changed a number; kept the original wording`);
          text = original;
        } else if (text !== original) unknownTerms(text, where);
        bullets.push({text, source: item.source, original});
      }
      // Dropping is allowed (at most 2); losing more means the answer was incomplete: keep the rest in order.
      const dropped = role.bullets.map((text, index) => ({text, index})).filter(b => !seen.has(b.index) && !role.extra?.includes(b.index));   // an extra bullet left out is not a drop
      if (dropped.length > 2) {
        warnings.push(`${where}: ${dropped.length} bullets were left out; kept all but 2`);
        for (const b of dropped.slice(0, dropped.length - 2)) bullets.push({text: b.text, source: b.index, original: b.text});
        dropped.splice(0, dropped.length - 2);
      }
      let skills = got.roles[r].skills?.trim() || '';
      if (role.skills && !sameSet(setOf(skills), setOf(role.skills))) {
        if (skills) warnings.push(`${where}: skills line changed its items; kept the original`);
        skills = role.skills;
      }
      const tailoredRole = cv.jobs[j].roles[r];
      delete tailoredRole.extra; delete tailoredRole.extraFrom;
      tailoredRole.bullets = bullets.map(b => b.text);
      if (role.skills) tailoredRole.skills = skills;
      const marked = review.jobs[j].roles[r];
      delete marked.extra; delete marked.extraFrom;
      marked.bullets = bullets.map((b, position) => ({text: b.text, from: b.source,
        // Moved up: now above a bullet that used to come before it (not just shifted by a dropped one).
        mark: role.extra?.includes(b.source) ? 'added' : plain(b.text) !== plain(b.original) ? 'reworded' : bullets.slice(position + 1).some(later => later.source < b.source) ? 'moved' : 'kept',
        ...(role.extra?.includes(b.source) ? {addedFrom: role.extraFrom?.[b.source]} : {}),
        diff: plain(b.text) !== plain(b.original) ? wordDiff(b.original, b.text) : ''}));
      marked.dropped = dropped.map(b => b.text);
      if (role.skills) { marked.skills = skills; if (skills !== role.skills) { marked.skillsMark = true; marked.skillsDiff = escape(skills); } }
    });
  });
  return {cv, review, warnings};
}

// ---------- files ----------
const safeCode = code => String(code).replace(/[^a-z0-9]/gi, '');
const file = (storage, code, ext) => path.join(tailoredDir(storage), `${safeCode(code)}.${ext}`);
export const exists = (storage, code) => fs.existsSync(file(storage, code, 'pdf'));
export const load = (storage, code) => { try { return JSON.parse(fs.readFileSync(file(storage, code, 'json'), 'utf8')); } catch { return null; } };
export const pdfPath = (storage, code) => file(storage, code, 'pdf');
// The pages of an in-place tailored CV as pictures, for its review (lib/cv-inplace-review.js).
const pageFile = (storage, code, n) => file(storage, code, `p${n}.png`);
export function savePages(storage, code, pngs) { pngs.forEach((png, i) => writePrivate(pageFile(storage, code, i + 1), Buffer.from(png, 'base64'))); }

// The HTML for a CV (tailored, base or review), written next to the user's assets so images resolve.
export function writeHtml(storage, cv, name, {review = false} = {}) {
  fs.mkdirSync(tailoredDir(storage), {recursive: true});
  const target = path.join(tailoredDir(storage), name);
  writePrivate(target, render(cv, {style: style(storage), review, base: pathToFileURL(dir(storage) + path.sep).href}));
  return target;
}

export function save(storage, code, record, pdf) {
  fs.mkdirSync(tailoredDir(storage), {recursive: true});
  writePrivate(file(storage, code, 'json'), JSON.stringify(record, null, 2) + '\n');
  writePrivate(file(storage, code, 'pdf'), pdf);
}

// The tailored CV for a job page, if there is one (the extension uploads it instead of the base CV).
const pageKey = url => String(url || '').split('#')[0].replace(/\/+$/, '');
// A job with no posting link of its own (a recruiter's message, a LinkedIn chat: its "URL" is the conversation) can't be matched by page. The
// employer's form is then recognised by the company's name in its address (careers.kestrel.com, boards.greenhouse.io/kestrel/...).
const NO_POSTING_LINK = /mail\.google|linkedin\.com\/messaging|jobpilotto\.(?:workers\.dev|top)\/lead/;
const slug = text => String(text || '').toLowerCase().replace(/[^a-z0-9]/g, '');
export function forUrl(storage, url) {
  const key = pageKey(url);
  if (!key) return null;
  let names = [];
  try { names = fs.readdirSync(tailoredDir(storage)).filter(n => n.endsWith('.json')); } catch { return null; }
  const address = slug(key.replace(/^https?:\/\//, '')), ours = [];
  for (const name of names) {
    try {
      const record = JSON.parse(fs.readFileSync(path.join(tailoredDir(storage), name), 'utf8'));
      if (!fs.existsSync(file(storage, record.job.code, 'pdf'))) continue;
      // The posting, or its form: Ashby, Lever and Workable open the application at <posting>/application (or /apply), another address.
      if (pageKey(record.job?.url) === key || isFormOf(key, record.job?.url)) return record;
      if (NO_POSTING_LINK.test(record.job?.url || '') && slug(record.job?.company).length >= 4 && address.includes(slug(record.job.company))) ours.push(record);
    } catch {}
  }
  // One candidate only: two tailored CVs for the same employer would be a guess, so the base CV goes (never the wrong one).
  return ours.length === 1 ? ours[0] : null;
}

// The review page: the tailored CV with its changes marked, the reasons, and a switch to see it clean.
// The clean PDF under a name a person can send: CV_<Name>_<Company>.pdf, next to the internal <code>.pdf (rewritten from it each time).
export function finalName(storage, record) {
  const word = text => String(text || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  return ['CV', word(baseCv(storage)?.name), word(record.job?.company)].filter(Boolean).join('_').slice(0, 90) + '.pdf';
}
export function finalCopy(storage, record) {
  const target = path.join(tailoredDir(storage), finalName(storage, record));
  fs.copyFileSync(pdfPath(storage, record.job.code), target);
  return target;
}

export function reviewPage(storage, record) {
  // Marks are recomputed from the model's answer when it's kept, so older reviews get later diff improvements.
  const base = baseCv(storage);
  let marked = record.review, warnings = record.warnings;
  if (record.result && base) try {
    marked = applyTailoring(base, record.result).review;  // the warnings stay those made at tailoring time (with the Profile)
  } catch {}
  // In place: the real tailored pages with the changed lines boxed; otherwise the template with its marks.
  const pages = record.inPlace?.pages?.map((_, i) => pageFile(storage, record.job.code, i + 1));
  const cvHtml = pages?.every(f => fs.existsSync(f)) ? pagesDocument(record, pages.map(f => pathToFileURL(f).href))
    : render(marked, {style: style(storage), review: true, base: pathToFileURL(dir(storage) + path.sep).href});
  const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const changes = record.changes.map(c => `<li><b>${esc(c.where)}</b>: ${esc(c.change)}<div class="why">${esc(c.why)}</div></li>`).join('');
  const warningList = warnings.map(w => `<li>⚠️ ${esc(w)}</li>`).join('');
  let final = null;
  try { final = finalCopy(storage, record); } catch {}
  const panel = `<aside id="jp-panel">
    ${final ? `<div class="jp-final"><div class="jp-final-h">Final CV: send this one</div>
      <div class="jp-final-name">${esc(path.basename(final))}</div>
      <div class="jp-actions"><a href="${esc(pathToFileURL(final).href)}" target="_blank">Open</a>
        <a href="jobpilotto-cv:reveal">Show in Finder</a> <a href="jobpilotto-cv:copy">Copy path</a></div>
      <div class="jp-note">Clean: no highlights or notes. The page on the right is only a preview of what changed.</div></div>` : ''}
    <div class="jp-title">Preview of changes · ${esc(record.job.title)} · ${esc(record.job.company)}</div>
    <div class="jp-meta">${new Date(record.createdAt).toLocaleString()} · ${esc(record.model)}</div>
    <div class="jp-actions"><label><input type="checkbox" id="jp-clean"> Hide highlights</label></div>
    <div class="jp-legend"><span class="k-rew">reworded</span> <span class="k-ins">added</span> <span class="k-del">removed</span> <span class="k-mov">moved up</span></div>
    ${warningList ? `<ul class="jp-warn">${warningList}</ul>` : ''}
    <div class="jp-h">What changed and why</div><ul class="jp-changes">${changes}</ul></aside>`;
  const css = `<style>
    body.review { background: #e9edf2; display: flex; flex-direction: column; align-items: center; gap: 18px; padding: 18px 18px 18px 360px; }
    body.review .page { background: #fff; box-shadow: 0 2px 14px #0002; }
    body.review .page:not(.fixed) { width: 595pt; padding: 16mm; }
    #jp-panel { position: fixed; left: 0; top: 0; bottom: 0; width: 340px; overflow: auto; background: #132439; color: #e8eef6;
      font: 13px/1.45 -apple-system, system-ui, sans-serif; padding: 18px; box-sizing: border-box; }
    #jp-panel .jp-final { background: #1d3a2c; border: 1px solid #3f8f63; border-radius: 8px; padding: 10px 12px; margin-bottom: 16px; }
    #jp-panel .jp-final-h { font-weight: 700; font-size: 14px; } #jp-panel .jp-final-name { font-size: 12px; margin: 4px 0 8px; word-break: break-all; }
    #jp-panel .jp-note { color: #9fb2c8; font-size: 12px; }
    #jp-panel .jp-title { font-weight: 700; font-size: 15px; } #jp-panel .jp-meta { color: #9fb2c8; font-size: 12px; margin: 4px 0 12px; }
    #jp-panel .jp-actions { display: flex; gap: 14px; align-items: center; margin-bottom: 10px; }
    #jp-panel a { color: #ffb27a; } #jp-panel label { cursor: pointer; }
    #jp-panel .jp-legend span { display: inline-block; padding: 1px 6px; border-radius: 4px; margin: 2px 2px 0 0; font-size: 12px; color: #222; }
    .k-rew { background: #fff4c2; } .k-ins { background: #c9f3d2; } .k-del { background: #ffe0dc; text-decoration: line-through; } .k-mov { background: #d6e8ff; }
    #jp-panel .jp-h { font-weight: 700; margin: 16px 0 6px; } #jp-panel ul { list-style: none; } #jp-panel li { margin: 0 0 9px; }
    #jp-panel .why { color: #9fb2c8; font-size: 12px; } #jp-panel .jp-warn li { color: #ffd27a; }
    @media print { #jp-panel { display: none; } }</style>
    <script>addEventListener('DOMContentLoaded', () => document.getElementById('jp-clean').addEventListener('change', e => document.body.classList.toggle('clean', e.target.checked)));</script>`;
  const html = cvHtml.replace('</head>', `${css}</head>`).replace(/(<body[^>]*>)/, `$1${panel}`);
  fs.mkdirSync(tailoredDir(storage), {recursive: true});
  const target = file(storage, record.job.code, 'review.html');
  writePrivate(target, html);
  return target;
}
