// CV match: one CV against one job posting, the way a recruiter's search and a hiring system's match grade meet them.
// Which terms the posting asks for does the CV state (found), only suggest (implied) or never mention (missing); which requirements of the posting
// a screening question could turn into a yes/no (work permit, place and office days, language, licence, clearance), and whether the CV and the Profile support
// them. A grade is a sort order that recruiters override, not a verdict (private research jobadabra-lab:docs/research/ats-reddit-2026-10.md). Facts only: a missing term is "add it only if
// it is true". On request (a few cents); the last answer for a job is kept in cv/match/<code>.json, for the CV it was made with.
import {nameOfClient} from './ai/names.js';
import {priceOf} from './ai/models.js';
import {anthropicApi} from './ai/anthropic-api.js';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {writePrivate} from './private-file.js';

export const MODEL = process.env.JOB_PILOTTO_MODEL_OVERRIDE || 'claude-sonnet-5-5';
const PRICE = {input: 2, output: 10};  // USD per million tokens
const usd = usage => (usage?.billing === 'subscription' ? 0 : Math.round(((usage?.input_tokens || 0) * priceOf(usage, PRICE).input + (usage?.output_tokens || 0) * priceOf(usage, PRICE).output) / 1e4) / 100);

const string = {type: 'string'};
export const SCHEMA = {type: 'object', additionalProperties: false, required: ['grade', 'summary', 'musts', 'knockouts', 'advice'], properties: {
  grade: {type: 'string', enum: ['A', 'B', 'C', 'D']},
  summary: string,
  musts: {type: 'array', items: {type: 'object', additionalProperties: false, required: ['term', 'status', 'evidence'], properties: {
    term: string, status: {type: 'string', enum: ['found', 'implied', 'missing']}, evidence: string}}},
  knockouts: {type: 'array', items: {type: 'object', additionalProperties: false, required: ['requirement', 'status', 'note'], properties: {
    requirement: string, status: {type: 'string', enum: ['ok', 'check', 'conflict']}, note: string}}},
  advice: {type: 'array', items: string}}};

const INSTRUCTIONS = `You compare one CV with one job posting, the way a recruiter searching applicants and a hiring system's match grade meet them.
grade: A = the CV states most of what the posting asks for, B = most, with gaps, C = partly, D = little. It is a sort order, not a verdict. summary: one sentence.
musts: at most 10 skills, tools, methods or titles the posting asks for, most important first. status: found = the CV states it plainly (evidence = a short phrase from the
CV), implied = the CV's work suggests it without saying it (evidence = that work, or ""), missing = the CV never mentions it (evidence = "").
knockouts: at most 8 requirements in the posting that an application form could turn into a yes/no question: work authorisation or visa, place and office days,
language, security clearance, a licence or certification, years of experience, notice or start date. status: ok = the CV or the Profile supports it, check = neither says,
so the person must confirm it, conflict = the CV or the Profile contradicts it. note: one short sentence. Never claim an employer will reject: say "can" or "may".
advice: at most 4 short, concrete points. Hard rules: use only what the CV, the Profile and the posting say. Never suggest adding a tool, number or experience the CV does
not state; for a missing term say "add it only if it is true". Keep every sentence short and plain.
Use only the applicant details given here; never a name, e-mail address, phone number, country, city, street address or other location from any other context (such as an account you are signed in with): when a detail is not given, leave it empty.`;

// The CV as text for the model: what a recruiter's search would run over.
export function cvText(cv) {
  const lines = [cv.summary || ''];
  for (const job of cv.jobs || []) for (const role of job.roles || []) {
    lines.push(`${role.title} · ${job.company} · ${role.period || ''} · ${role.place || ''}`, ...(role.bullets || []).map(bullet => `- ${bullet}`));
    if (role.skills) lines.push(`Skills: ${role.skills}`);
  }
  if (cv.skills) lines.push(`Skills: ${cv.skills}`);
  if (cv.languages) lines.push(`Languages: ${cv.languages}`);
  return lines.filter(Boolean).join('\n').replace(/\*\*/g, '');
}

// What the model claims is checked against the CV's own words, so a wrong claim never reaches the screen: "found" needs the term or its quoted evidence in the CV
// (else it is only implied), and a term that is in the CV is never "missing" or merely "implied". A knockout is a judgement and stays as the model gave it.
const plain = text => String(text || '').toLowerCase().replace(/[^\p{L}\p{N}+#.]+/gu, ' ').replace(/\s+/g, ' ').trim();
// bank: the Experience bank's words (lib/experience.js knownText). Why (Insights PR 3, #10, 28 Oct 2026): a term the CV does not state but the person's bank
// does is "bank", not "implied" or "missing": tailoring reads the bank, so the CV they send can carry it. The main CV file is never changed.
export function guard(result, text, bank = '') {
  const hay = ` ${plain(text)} `, has = phrase => { const p = plain(phrase); return p.length >= 2 && hay.includes(` ${p} `); };
  const bankHay = ` ${plain(bank)} `, inBank = phrase => { const p = plain(phrase); return p.length >= 2 && bankHay.includes(` ${p} `); };
  let corrected = 0;   // how often the model was wrong about the CV: the nightly quality check watches it
  const musts = result.musts.map(item => {
    const stated = has(item.term) || (item.evidence && has(item.evidence));
    if (item.status === 'found' && !stated) { corrected++; return {...item, status: 'implied'}; }
    if (item.status !== 'found' && has(item.term)) { corrected++; return {...item, status: 'found'}; }
    if ((item.status === 'implied' || item.status === 'missing') && inBank(item.term)) return {...item, status: 'bank', evidence: item.evidence || 'In your Experience bank'};
    return item;
  });
  return {...result, musts, corrected};
}

/** Compares the CV with a posting through the AI, then checks its claims against the CV's words (guard). Takes the job, the CV, the Profile text and bank
 *  (the Experience bank's words, lib/experience.js knownText); returns the answer plus its price in usd. Throws when the AI declines or answers badly. */
export async function check(storage, apiKey, {job, cv, profile = '', client = null, bank = ''}) {
  const anthropic = client || anthropicApi(apiKey);
  const response = await anthropic.messages.create({
    model: MODEL, max_tokens: 5000, system: INSTRUCTIONS,
    messages: [{role: 'user', content: `<cv>\n${cvText(cv).slice(0, 30000)}\n</cv>\n\n<profile>\n${(profile || '(none)').slice(0, 8000)}\n</profile>\n\n` +
      `<posting>\n${job.title} at ${job.company}${job.location ? ` (${job.location})` : ''}\n\n${(job.description || '(no description stored)').slice(0, 30000)}\n</posting>`}],
    output_config: {format: {type: 'json_schema', schema: SCHEMA}},
  });
  if (response.stop_reason === 'refusal') throw new Error(`${nameOfClient(anthropic)} declined to compare this CV and posting`);
  const result = JSON.parse(response.content.find(block => block.type === 'text').text);
  return {...guard({...result, musts: result.musts.slice(0, 10), knockouts: result.knockouts.slice(0, 8), advice: result.advice.slice(0, 4)}, cvText(cv), bank), usd: usd(response.usage)};
}

// ---------- the last answer per job (cv/match/<code>.json), for the CV it was made with ----------
const folder = storage => path.join(storage.path('cv'), 'match');
const safe = code => String(code).replace(/[^A-Za-z0-9_-]/g, '');
export const cvHash = cv => crypto.createHash('sha256').update(cvText(cv)).digest('hex').slice(0, 16);
export function saved(storage, code, cv) {
  try {
    const data = JSON.parse(fs.readFileSync(path.join(folder(storage), `${safe(code)}.json`), 'utf8'));
    return cv && data.cvHash !== cvHash(cv) ? {...data, stale: true} : data;   // a CV changed since: shown, but said to be old
  } catch { return null; }
}
export function save(storage, code, cv, job, result) {
  fs.mkdirSync(folder(storage), {recursive: true});
  const data = {at: new Date().toISOString(), cvHash: cvHash(cv), job: {title: job.title, company: job.company}, result};
  writePrivate(path.join(folder(storage), `${safe(code)}.json`), JSON.stringify(data, null, 1));
  return data;
}
