// Build a CV with the AI (Setup → Your CV, Settings → Profile → CV): a short form's answers become a CV in the app's schema (cv/cv.json).
// The AI only writes words (a summary, one role's bullets, a skills line); every fact (employer, title, dates, place, school) comes from the
// person's answers in code, and a bullet holding a number the person never said is dropped. A built CV is saved as the main CV with its PDF and
// marked as already imported, so the PDF import never reads it a second time. Guarded by test/cv-build.test.js.
import {anthropicApi} from './ai/anthropic-api.js';
import {nameOfClient} from './ai/names.js';
import {MODEL, usd} from './cv.js';
import {setBuiltCv} from './cv-import-at-upload.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const MAX_JOBS = 8;
const text = value => String(value ?? '').trim();
const WRITE_SCHEMA = {type: 'object', additionalProperties: false, required: ['summary', 'roles', 'skills'], properties: {
  summary: {type: 'string'}, skills: {type: 'string'},
  roles: {type: 'array', items: {type: 'object', additionalProperties: false, required: ['index', 'bullets'], properties: {index: {type: 'integer'}, bullets: {type: 'array', items: {type: 'string'}}}}}}};

const INSTRUCTIONS = `You write the words of a person's CV from their own answers. For every job (numbered index) write 2 to 4 short, concrete bullets
from what they said they did, in the first person's voice without "I", each starting with a verb. Write a 2-sentence summary of who they are and
what they want next, and one line of skills from what they listed. Use only facts they gave: never invent an employer, a date, a tool, a number,
a result or a qualification. If a job has little detail, write fewer bullets rather than guess. Write in the language of their answers.`;

export function validAnswers(answers) {
  const jobs = (answers?.jobs || []).filter(j => text(j.company) || text(j.title));
  if (!text(answers?.name)) return {ok: false, error: 'Add your name.'};
  if (!jobs.length) return {ok: false, error: 'Add at least one job: an employer and your title.'};
  if (jobs.length > MAX_JOBS) return {ok: false, error: `Add up to ${MAX_JOBS} jobs; the rest can wait for the next version.`};
  if (jobs.some(j => !text(j.company) || !text(j.title))) return {ok: false, error: 'Each job needs an employer and your title.'};
  return {ok: true, jobs};
}

const numbersOf = value => String(value).match(/\d+(?:[.,]\d+)?/g) || [];
const period = (from, to) => [text(from), text(to) || (text(from) ? 'Present' : '')].filter(Boolean).join(' – ');

// answers + the AI's words -> the CV: facts from the answers, words from the AI; a bullet whose number was never given is dropped.
export function assemble(answers, written) {
  const {jobs} = validAnswers(answers);
  const given = new Set(numbersOf(JSON.stringify(answers)));
  const cv = {name: text(answers.name), jobs: [], education: (answers.education || []).filter(e => text(e.school)).map(e => ({school: text(e.school), degree: text(e.degree), period: text(e.period)}))};
  if (text(answers.location)) cv.location = text(answers.location);
  const summary = text(written?.summary);
  if (summary && numbersOf(summary).every(n => given.has(n))) cv.summary = summary;
  jobs.forEach((job, index) => {
    const wrote = (written?.roles || []).find(r => r.index === index)?.bullets || [];
    let bullets = wrote.map(text).filter(b => b && numbersOf(b).every(n => given.has(n)));
    if (!bullets.length && text(job.did)) bullets = [text(job.did)];
    cv.jobs.push({company: text(job.company), roles: [{title: text(job.title), period: period(job.from, job.to), place: text(job.place), bullets}]});
  });
  const skills = text(written?.skills) || text(answers.skills);
  if (skills) cv.skills = skills;
  if (text(answers.languages)) cv.languages = text(answers.languages);
  return cv;
}

export async function buildCv(answers, apiKey, client = null) {
  const checked = validAnswers(answers);
  if (!checked.ok) throw new Error(checked.error);
  const ai = client || anthropicApi(apiKey);
  const given = {target_role: text(answers.targetRole), years_of_experience: text(answers.years), skills: text(answers.skills),
    jobs: checked.jobs.map((j, index) => ({index, employer: text(j.company), title: text(j.title), from: text(j.from), to: text(j.to), what_they_did: text(j.did)}))};
  const response = await ai.messages.create({model: MODEL, max_tokens: 4000, system: INSTRUCTIONS,
    messages: [{role: 'user', content: JSON.stringify(given)}], output_config: {format: {type: 'json_schema', schema: WRITE_SCHEMA}}}, {headers: {'x-jp-action': 'tailor'}});
  if (response.stop_reason === 'refusal') throw new Error(`${nameOfClient(ai)} declined to write this CV`);
  const written = JSON.parse(response.content.find(block => block.type === 'text').text);
  return {cv: assemble(answers, written), usd: usd(response.usage)};
}

// The built CV (and its PDF) becomes the main CV; cv.json is written with the PDF's hash so the PDF import skips it.
export function saveBuilt(storage, cv, pdf, name, now = new Date()) {
  const temp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pilot-built-')), 'cv.pdf');
  fs.writeFileSync(temp, pdf);
  try {
    return setBuiltCv(storage, temp, name, cv, now);
  } finally { fs.rmSync(path.dirname(temp), {recursive: true, force: true}); }
}
