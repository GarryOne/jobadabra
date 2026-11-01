// CV check: how well a hiring system can read the CV the person uploaded, before any tailoring.
// Two parts. The parser check is rules on the PDF's own text and layout (free, instant): modern hiring systems turn a CV into fields
// (name, contact, jobs, dates, skills) that recruiters search, so a CV they cannot read cleanly never turns up. The content review is one
// Claude call on the text a parser would get: keywords for the person's target roles, evidence, clarity. It is a readiness check, not a
// score from any real hiring system (they do not publish one). Only observed extraction problems cost points (no text, garbled characters, no contact
// details, no readable dates); layout alone (columns, pictures) is a note: no recruiter or admin we found shows it breaking a parse. Results are a cache of the PDF (cv/check.json), rebuilt on demand.
import {nameOfClient} from './ai/names.js';
import {priceOf} from './ai/models.js';
import {anthropicApi} from './ai/anthropic-api.js';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {writePrivate} from './private-file.js';

export const MODEL = process.env.JOBADABRA_MODEL_OVERRIDE || 'claude-sonnet-5-5';
const PRICE = {input: 2, output: 10};  // USD per million tokens
const usd = usage => (usage?.billing === 'subscription' ? 0 : Math.round(((usage?.input_tokens || 0) * priceOf(usage, PRICE).input + (usage?.output_tokens || 0) * priceOf(usage, PRICE).output) / 1e4) / 100);

// ---------- the text, in the order a parser reads it ----------
export function linesOf(pages) {
  const lines = [];
  for (const page of pages) {
    const items = [...page.text].sort((a, b) => a.y - b.y || a.x - b.x);
    let row = [], at = null;
    const flush = () => { if (row.length) lines.push(row.sort((a, b) => a.x - b.x).map(item => item.str).join(' ').replace(/\s+/g, ' ').trim()); row = []; };
    for (const item of items) { if (at === null || Math.abs(item.y - at) > 3) { flush(); at = item.y; } row.push(item); }
    flush();
  }
  return lines.filter(Boolean);
}

const HEADINGS = {
  experience: /^(professional |work )?(experience|employment|career history|work history)$/i,
  education: /^(education|studies|academic background|education and training)$/i,
  skills: /^(skills|technical skills|key skills|core skills|technologies)$/i,
};
// Month names in the languages CVs are written in, from the system's own date library (Intl), long and short, never a hand-written list
// (8 Oct 2026: "janv. 2024" and "März 2022" read as no dates at all). The English pattern of before stays in it: the same matches as before.
const LOCALES = ['en', 'de', 'fr', 'it', 'es', 'pt', 'nl', 'pl', 'sv', 'da', 'nb', 'fi', 'cs', 'sk', 'ro', 'hu', 'el', 'tr', 'hr', 'sl', 'lt', 'lv', 'et',
  'ca', 'ru', 'uk', 'bg', 'sr', 'ga', 'is'];
const monthNames = () => {
  const names = new Set();
  for (const locale of LOCALES) for (const month of ['long', 'short']) {
    try {
      const format = new Intl.DateTimeFormat(locale, {month});
      for (let m = 0; m < 12; m++) names.add(format.format(new Date(Date.UTC(2024, m, 15))).toLowerCase().replace(/\.$/, ''));
    } catch { /* a locale this system lacks */ }
  }
  return [...names].filter(name => /^\p{L}[\p{L}\p{M}]+$/u.test(name)).sort((a, b) => b.length - a.length).map(name => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
};
const MONTH = `(?:(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*|${monthNames().join('|')})\\.?`;
const DATE_STYLES = {
  'Month YYYY': new RegExp(`(?<!\\p{L})${MONTH}\\s+(?:19|20)\\d{2}\\b`, 'giu'),
  'MM/YYYY': /\b(?:0?[1-9]|1[0-2])\/(?:19|20)\d{2}\b/g,
  'YYYY only': /\b(?:19|20)\d{2}\s*[–-]\s*(?:(?:19|20)\d{2}|present|now|current)\b/gi,
};
const ODD_BULLETS = /[★☆◆◇✔✓➤►▶■□❖✦☑]/g;

const check = (id, label, status, detail, fix = '', penalty = 0) => ({id, label, status, detail, fix, penalty: status === 'pass' ? 0 : penalty});

// The English headings a parser surely knows, or, once the content review ran, the heading the AI saw playing that role in
// any language (8 Oct 2026: a French "Expérience professionnelle" failed as "no Experience heading"). An AI heading counts
// only when it is a line of the CV: it can name what is there, never invent it.
const ROLE_LABEL = {experience: 'Experience', education: 'Education', skills: 'Skills'};
function headingChecks(lines, sections = {}) {
  const line = name => lines.find(text => HEADINGS[name].test(text.trim()))
    || (sections?.[name] && lines.find(text => text.trim().toLowerCase() === sections[name].trim().toLowerCase()));
  const found = name => line(name) && !HEADINGS[name].test(line(name).trim()) ? `"${line(name).trim().slice(0, 40)}" is your ${ROLE_LABEL[name]} heading.` : '';
  const anyLanguage = ' In another language, run the content review: it reads headings in any language.';
  return [
    line('experience') ? check('experience', 'An "Experience" heading', 'pass', found('experience') || 'Parsers use it to find your jobs.')
      : check('experience', 'An "Experience" heading', 'fail', 'No heading a parser recognises for your jobs (Experience, Work experience, Employment).' + anyLanguage, 'Give your jobs a section heading such as "Experience" (or the usual word in your CV\'s language).', 20),
    line('education') ? check('education', 'An "Education" heading', 'pass', found('education') || 'Found.')
      : check('education', 'An "Education" heading', 'warn', 'No Education heading. Some systems leave the education field empty without one.' + anyLanguage, 'Add an Education section, even a short one.', 5),
    line('skills') ? check('skills', 'A "Skills" heading', 'pass', found('skills') || 'Found.')
      : check('skills', 'A "Skills" heading', 'warn', 'No Skills heading: skills inside job descriptions are found less reliably.' + anyLanguage, 'Add a Skills section with your main tools.', 5),
  ];
}
const scored = (checks, rest) => {
  const score = Math.max(0, 100 - checks.reduce((sum, item) => sum + item.penalty, 0));
  return {...rest, score, verdict: score >= 90 ? 'Easy for a parser' : score >= 75 ? 'Mostly readable' : 'Risky: a parser may lose parts', checks};
};
// The parser check again with the headings the content review found (ai.sections): same checks, the heading ones re-judged.
export function withSections(ats, sections) {
  if (!ats || !sections) return ats;
  const redone = headingChecks(ats.text.split('\n'), sections);
  return scored(ats.checks.map(item => redone.find(next => next.id === item.id) || item), ats);
}

// pages: what cv/pdf-probe.html's scan() returns. -> {score, verdict, checks, text}
export function analyse(pages) {
  const lines = linesOf(pages), text = lines.join('\n');
  const first = pages[0] || {width: 595, height: 842, images: [], text: []};
  const W = first.width, checks = [];

  // 1. Is there text at all?
  const chars = text.replace(/\s/g, '').length;
  checks.push(chars >= 400 ? check('text', 'Real, selectable text', 'pass', `${chars} characters of text a parser can read.`)
    : check('text', 'Real, selectable text', 'fail', 'The PDF has almost no text: it is probably a picture of a CV.', 'Export the CV as a text PDF from Word, Google Docs or Figma, not a scan or screenshot.', 40));

  // 2. Columns: parsers read a line left to right across the page, so two columns of sentences get mixed.
  let side = 0;
  for (const page of pages) {
    const rows = new Map();
    for (const item of page.text) if (item.str.length >= 25) { const key = Math.round(item.y / 3); rows.set(key, [...(rows.get(key) || []), item]); }
    for (const row of rows.values()) { row.sort((a, b) => a.x - b.x); if (row.some((a, i) => row.slice(i + 1).some(b => b.x > a.x + a.w + 5 && a.w > page.width * 0.2 && b.w > page.width * 0.2))) side++; }
  }
  checks.push(side < 4 ? check('columns', 'One column of text', 'pass', 'Sentences run down one column, in reading order.')
    : check('columns', 'One column of text', 'warn', `${side} lines have text side by side: some parsers read straight across and mix the two (reported by a scanner developer, not confirmed by recruiters).`,
      'Put experience in a single column; keep side panels to short labels. Copy the PDF into a text editor: if the order is wrong, so is a parser\'s.', 0));

  // 3. Contact details in the body text.
  const email = /[\w.+-]+@[\w-]+\.[\w.-]+/.test(text), phone = /\+?\d[\d\s().-]{7,}\d/.test(text);
  checks.push(email ? check('email', 'Email address as text', 'pass', 'Found in the body of the CV.')
    : check('email', 'Email address as text', 'fail', 'No email address in the text (it may be inside an image or only a link).', 'Write your email as plain text near the top.', 15));
  checks.push(phone ? check('phone', 'Phone number as text', 'pass', 'Found in the body of the CV.')
    : check('phone', 'Phone number as text', 'warn', 'No phone number in the text.', 'Add a phone number as plain text near the top.', 5));

  // 4. Standard section headings.
  checks.push(...headingChecks(lines));

  // 5. Dates in one readable style.
  let rest = text;   // each date counts once, in the first style that matches it ("Mar 2024 – Present" is not also "2024 – Present")
  const styles = Object.entries(DATE_STYLES).map(([name, re]) => { const found = rest.match(re) || []; rest = rest.replace(re, ' '); return [name, found.length]; }).filter(([, n]) => n);
  checks.push(!styles.length ? check('dates', 'Dates a parser can read', 'warn', 'No dates like "Mar 2024 – Present" found: tenure and recency cannot be worked out.', 'Write each role with month and year.', 10)
    : styles.length > 1 ? check('dates', 'Dates in one style', 'warn', `Mixed styles: ${styles.map(([name]) => name).join(', ')}. Some systems miscount your years of experience.`, 'Use one style everywhere, e.g. "Mar 2024 – Present".', 5)
    : check('dates', 'Dates in one style', 'pass', `All dates use "${styles[0][0]}".`));

  // 6. Pictures: parsers ignore them, so nothing that matters can live there.
  const seen = [];
  for (const page of pages) for (const image of page.images) if (image.w > 2 && !seen.some(o => Math.abs(o.x - image.x) < 1 && Math.abs(o.y - image.y) < 1 && Math.abs(o.w - image.w) < 1)) seen.push({...image, page: page.n});
  const photo = seen.some(image => image.page === 1 && image.w >= 20 && image.w <= 110 && Math.abs(image.w - image.h) < image.w * 0.2 && image.y < 140 && image.x > W / 2);
  const banner = seen.some(image => image.w >= W * 0.9);
  checks.push(!photo && !banner ? check('images', 'No decorative images', 'pass', seen.length ? 'Small icons only: harmless.' : 'No images.')
    : check('images', 'Pictures are ignored by parsers', 'warn', `${[photo ? 'a photo' : '', banner ? 'a full-width banner' : ''].filter(Boolean).join(' and ')}: a parser cannot read them, so keep nothing important in them.` +
      ' No recruiter we found reports a photo breaking a parse; it is a market habit (in the US, UK and Canada a photo is usually left out).', photo ? 'A photo is a choice, not a parse failure: keep it if your market expects one (Switzerland: optional), and keep a version without.' : 'Keep the banner decorative.', 0));

  // 7. Length.
  const n = pages.length;
  checks.push(n <= 2 ? check('length', 'Length', 'pass', `${n} page${n === 1 ? '' : 's'}.`)
    : n === 3 ? check('length', 'Length', 'warn', '3 pages. Recruiters spend about a minute on a first look; the top of page 1 has to carry it.', 'Trim to 2 pages, or make sure page 1 stands alone.', 5)
    : check('length', 'Length', 'fail', `${n} pages is long for most roles.`, 'Cut to 2 or 3 pages.', 10));

  // 8. Symbols that turn into garbage.
  const garbled = (text.match(/[-�]/g) || []).length, odd = (text.match(ODD_BULLETS) || []).length;
  checks.push(garbled ? check('symbols', 'Plain characters', 'warn', `${garbled} symbol(s) from an icon font: they can show up as boxes or gibberish.`, 'Use plain bullets (•) and real text instead of icon fonts.', 8)
    : odd >= 3 ? check('symbols', 'Plain bullets', 'warn', 'Unusual bullet symbols (stars, arrows, checkmarks) are not always parsed.', 'Use plain round bullets.', 4)
    : check('symbols', 'Plain characters', 'pass', 'Standard characters and bullets.'));

  // 9. Starts with the name.
  const top = lines[0] || '';
  checks.push(top && top.split(/\s+/).length <= 5 && !/[@\d]/.test(top) ? check('name', 'Starts with your name', 'pass', `"${top.slice(0, 40)}" comes first.`)
    : check('name', 'Starts with your name', 'warn', 'The first thing a parser reads is not a name.', 'Put your name alone on the first line.', 5));

  return scored(checks, {text: lines.join('\n'), pages: n});
}

// ---------- the content review (one Claude call) ----------
const string = {type: 'string'};
export const SCHEMA = {type: 'object', additionalProperties: false, required: ['score', 'components', 'strengths', 'fixes', 'missing_keywords', 'sections'], properties: {
  score: {type: 'integer'},
  components: {type: 'array', items: {type: 'object', additionalProperties: false, required: ['name', 'score', 'note'], properties: {name: string, score: {type: 'integer'}, note: string}}},
  strengths: {type: 'array', items: string},
  fixes: {type: 'array', items: {type: 'object', additionalProperties: false, required: ['where', 'issue', 'suggestion', 'impact'], properties: {
    where: string, issue: string, suggestion: string, impact: {type: 'string', enum: ['high', 'medium', 'low']}}}},
  missing_keywords: {type: 'array', items: string},
  sections: {type: 'object', additionalProperties: false, required: ['experience', 'education', 'skills'], properties: {experience: string, education: string, skills: string}}}};

const INSTRUCTIONS = `You review a CV the way a recruiter and a hiring system's keyword search meet it. The CV text is given in the order a parser reads it.
Score 0-100 overall and for four components: "Keywords for your target roles" (are the tools, methods and titles the target roles ask for stated plainly,
not implied), "Evidence" (results and numbers, not duties), "Clarity" (short bullets that start with what the person did, one idea each), "Seniority signal"
(scope, ownership and team size visible). Be calibrated: most CVs land between 55 and 85; 90+ only when nothing important is missing.
A summary that says nothing specific ("results-driven professional") is a readability point, not a reason for rejection; say what a specific one would name. Never claim a hiring system will reject the CV.
strengths: 2-4 short points. fixes: at most 8, most valuable first; where = the section or role it concerns, issue = what a reader or search would miss,
suggestion = a concrete change. impact high/medium/low.
Hard rules: use only what the CV says. Never suggest adding a tool, number, employer or responsibility the CV does not state; where a keyword is missing,
say "add it only if it is true". missing_keywords: up to 10 terms the target roles typically ask for that the CV never states. The target roles come from the
Profile excerpt when there is one, else from the CV itself. Keep every sentence short and plain.
sections: for experience, education and skills, the heading line that starts that section, copied exactly as the CV writes it
in whatever language ("Expérience professionnelle", "Formação"); "" when the CV has no such heading.`;

const plain = value => String(value || '').toLowerCase().replace(/[^\p{L}\p{N}+#.]+/gu, ' ').replace(/\s+/g, ' ').trim();
export const stated = (text, term) => { const p = plain(term); return p.length >= 2 && ` ${plain(text)} `.includes(` ${p} `); };

export async function review(storage, apiKey, text, {client = null, profile = ''} = {}) {
  const anthropic = client || anthropicApi(apiKey);
  const response = await anthropic.messages.create({
    model: MODEL, max_tokens: 6000, system: INSTRUCTIONS,
    messages: [{role: 'user', content: `<cv>\n${text.slice(0, 30000)}\n</cv>\n\n<profile>\n${(profile || '(none)').slice(0, 6000)}\n</profile>`}],
    output_config: {format: {type: 'json_schema', schema: SCHEMA}},
  }, {headers: {'x-jp-action': 'tailor'}});
  if (response.stop_reason === 'refusal') throw new Error(`${nameOfClient(anthropic)} declined to review this CV`);
  const result = JSON.parse(response.content.find(block => block.type === 'text').text);
  const clamp = value => Math.max(0, Math.min(100, Math.round(Number(value) || 0)));
  return {...result, score: clamp(result.score), components: result.components.map(item => ({...item, score: clamp(item.score)})),
    fixes: result.fixes.slice(0, 8), usd: usd(response.usage), billing: response.usage?.billing || anthropic.billing || 'api',   // how it was paid: the card's cost line
   
    missing_keywords: result.missing_keywords.filter(term => !stated(text, term)).slice(0, 10)};   // a term the CV already states is not missing
}

// ---------- the cache of the PDF's check (cv/check.json) ----------
const file = storage => path.join(storage.path('cv'), 'check.json');
export const hashOf = storage => { try { return crypto.createHash('sha256').update(fs.readFileSync(storage.path('cv.pdf'))).digest('hex').slice(0, 16); } catch { return ''; } };
export function saved(storage) {
  try {
    const data = JSON.parse(fs.readFileSync(file(storage), 'utf8'));
    return data.hash === hashOf(storage) ? data : null;   // another CV since: nothing carried over
  } catch { return null; }
}
export function save(storage, patch) {
  const current = saved(storage) || {hash: hashOf(storage)};
  const data = {...current, ...patch, hash: hashOf(storage), at: new Date().toISOString()};
  fs.mkdirSync(path.dirname(file(storage)), {recursive: true});
  writePrivate(file(storage), JSON.stringify(data, null, 1));
  return data;
}
