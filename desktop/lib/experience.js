// The experience bank (Settings → Profile → Experience): what the candidate has done, beyond the one main CV.
// The main CV (cv/cv.json) stays the reference: its jobs, titles, dates and places are the only structure a tailored CV has.
// Extra sources (other CV versions as PDFs; LinkedIn later) only add facts. Each is kept as cv/sources/<id>.json (+ its PDF):
// the transcribed CV and one AI match against the main CV (which main role each role of the source describes, and which of its
// bullets state something the main role doesn't). The match is a meaning, so AI decides it with fixed integers the code validates.
// Tailoring reads the bank through withExtras (extra bullets appended to a matched role, flagged `extra`) and knownText (vocabulary).
// A cache of files on this Mac, like cv.json: rebuildable from the PDFs, which the weekly backup keeps. Guarded by test/experience.test.js.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {anthropicApi} from './ai/anthropic-api.js';
import {nameOfClient} from './ai/names.js';
import {baseCv, dir, MODEL, transcribePdf, usd} from './cv.js';
import {readExport} from './linkedin-export.js';
import {writePrivate} from './private-file.js';
import {applyAdded, readAdded} from './experience-added.js';

export const MAX_SOURCES = 8;       // a person has a handful of CV versions; more is a mistake, not a bank
export const MAX_EXTRA_PER_ROLE = 6;   // extra bullets offered to the tailor per role: the CV must stay as long as before

const sourcesDir = storage => path.join(dir(storage), 'sources');
const jsonOf = (storage, id) => path.join(sourcesDir(storage), `${id}.json`);
const safeId = id => String(id || '').replace(/[^a-z0-9]/gi, '');

// ---------- the AI match ----------
const MATCH_SCHEMA = {type: 'object', additionalProperties: false, required: ['roles'], properties: {roles: {type: 'array', items: {
  type: 'object', additionalProperties: false, required: ['source_role', 'main_job', 'main_role', 'new_bullets'],
  properties: {source_role: {type: 'integer'}, main_job: {type: 'integer'}, main_role: {type: 'integer'}, new_bullets: {type: 'array', items: {type: 'integer'}}}}}}};

const MATCH_INSTRUCTIONS = `You compare two versions of one person's CV. The main CV is the reference. For every role of the other version
(numbered source_role), say which role of the main CV it describes: the same employer (spelling, language or legal suffix may differ) and
the same time. Answer main_job and main_role with the main CV's indexes, or -1 and -1 when the main CV has no such role.
For a matched role, new_bullets lists the indexes of the source role's bullets that state a concrete fact (a tool, a scope, a result, a
responsibility) the main role's bullets do not already state. A bullet that only rewords one the main role has is not new. For an unmatched
role new_bullets is empty. Never invent anything: you only choose indexes.`;

const shape = cv => cv.jobs.map((job, j) => ({job: j, company: job.company, roles: job.roles.map((role, r) => ({role: r, title: role.title, period: role.period,
  bullets: role.bullets.map((text, index) => ({index, text}))}))}));
const flatRoles = cv => cv.jobs.flatMap((job, j) => job.roles.map((role, r) => ({job: j, role: r, company: job.company, title: role.title, period: role.period, bullets: role.bullets})));
export const mainKey = base => crypto.createHash('sha256').update(JSON.stringify(shape(base))).digest('hex').slice(0, 12);

// The answer checked: only real roles, one source role per main role (the first), real bullet indexes. What fails the check is "no match".
export function checkMatch(answer, main, source) {
  const flat = flatRoles(source), taken = new Set(), out = [];
  for (const item of answer?.roles || []) {
    const from = flat[item.source_role];
    const target = main.jobs[item.main_job]?.roles[item.main_role];
    if (!from || out.some(m => m.sourceRole === item.source_role)) continue;
    const key = `${item.main_job}:${item.main_role}`;
    const matched = !!target && !taken.has(key);
    if (matched) taken.add(key);
    const bullets = matched ? [...new Set(item.new_bullets)].filter(i => Number.isInteger(i) && i >= 0 && i < from.bullets.length) : [];
    out.push({sourceRole: item.source_role, mainJob: matched ? item.main_job : -1, mainRole: matched ? item.main_role : -1, newBullets: bullets});
  }
  for (let i = 0; i < flat.length; i++) if (!out.some(m => m.sourceRole === i)) out.push({sourceRole: i, mainJob: -1, mainRole: -1, newBullets: []});
  return out.sort((a, b) => a.sourceRole - b.sourceRole);
}

export async function matchAgainst(main, source, apiKey, client = null) {
  const ai = client || anthropicApi(apiKey);
  const flat = flatRoles(source).map((r, i) => ({source_role: i, company: r.company, title: r.title, period: r.period,
    bullets: r.bullets.map((text, index) => ({index, text}))}));
  const response = await ai.messages.create({
    model: MODEL, max_tokens: 8000, system: MATCH_INSTRUCTIONS,
    messages: [{role: 'user', content: `<main_cv>\n${JSON.stringify(shape(main), null, 1)}\n</main_cv>\n\n<other_version>\n${JSON.stringify(flat, null, 1)}\n</other_version>`}],
    output_config: {format: {type: 'json_schema', schema: MATCH_SCHEMA}},
  });
  if (response.stop_reason === 'refusal') throw new Error(`${nameOfClient(ai)} declined to compare these CVs`);
  if (response.stop_reason === 'max_tokens') throw new Error('The comparison was cut off; try again');
  return {match: checkMatch(JSON.parse(response.content.find(block => block.type === 'text').text), main, source), usd: usd(response.usage)};
}

// ---------- the sources ----------
export function list(storage) {
  let names = [];
  try { names = fs.readdirSync(sourcesDir(storage)).filter(name => name.endsWith('.json')); } catch { return []; }
  const sources = [];
  for (const name of names) { try { sources.push(JSON.parse(fs.readFileSync(path.join(sourcesDir(storage), name), 'utf8'))); } catch {} }
  return sources.sort((a, b) => String(a.addedAt).localeCompare(String(b.addedAt)));
}

const write = (storage, source) => {
  fs.mkdirSync(sourcesDir(storage), {recursive: true});
  writePrivate(jsonOf(storage, source.id), JSON.stringify(source, null, 2) + '\n');
};

// Add another CV version: kept as a file, read, compared with the main CV. Needs the main CV (cv/cv.json) to compare with.
export async function addCv(storage, file, name, {apiKey = '', client = null, now = new Date(), onStep = () => {}} = {}) {
  const main = baseCv(storage);
  if (!main) throw new Error('Read your main CV first: the other versions are compared with it.');
  if (list(storage).length >= MAX_SOURCES) throw new Error(`Up to ${MAX_SOURCES} extra CV versions: remove one first.`);
  const pdf = fs.readFileSync(file);
  const digest = crypto.createHash('sha256').update(pdf).digest('hex');
  const same = list(storage).find(s => s.digest === digest);
  if (same) throw new Error(`This file is already there as "${same.name}".`);
  onStep('reading');
  const read = await transcribePdf(pdf, apiKey, client);
  if (!read.cv.jobs.length) throw new Error('No work experience found in this CV.');
  onStep('comparing');
  const compared = await matchAgainst(main, read.cv, apiKey, client);
  const id = crypto.randomBytes(5).toString('hex');
  fs.mkdirSync(sourcesDir(storage), {recursive: true});
  fs.copyFileSync(file, path.join(sourcesDir(storage), `${id}.pdf`));
  const source = {id, kind: 'cv', name: String(name || 'CV').slice(0, 120), addedAt: now.toISOString(), digest, cv: read.cv,
    match: compared.match, mainKey: mainKey(main), usd: Math.round((read.usd + compared.usd) * 100) / 100};
  write(storage, source);
  return source;
}

// LinkedIn's data export (a .zip) or the profile's "Save to PDF": its positions, skills and education as one more source, compared with the main CV like a CV version.
// One LinkedIn source at a time: a new export replaces the old one (after the new one was read and matched). The ZIP itself is not kept.
export async function addLinkedin(storage, file, {apiKey = '', client = null, now = new Date(), onStep = () => {}} = {}) {
  const main = baseCv(storage);
  if (!main) throw new Error('Read your main CV first: LinkedIn is compared with it.');
  onStep('reading');
  // The profile's own "Save to PDF" is read like a CV (the AI); the data export (.zip) is read by structure.
  const fromPdf = /\.pdf$/i.test(file) ? await transcribePdf(fs.readFileSync(file), apiKey, client) : null;
  const cv = fromPdf ? fromPdf.cv : readExport(file);
  if (!cv.jobs.length) throw new Error('No positions found in this LinkedIn export.');
  onStep('comparing');
  const compared = await matchAgainst(main, cv, apiKey, client);
  compared.usd += fromPdf ? fromPdf.usd : 0;
  const old = list(storage).filter(s => s.kind === 'linkedin');
  const source = {id: crypto.randomBytes(5).toString('hex'), kind: 'linkedin', name: 'LinkedIn', addedAt: now.toISOString(),
    digest: crypto.createHash('sha256').update(JSON.stringify(cv)).digest('hex'), cv, match: compared.match, mainKey: mainKey(main), usd: Math.round(compared.usd * 100) / 100};
  write(storage, source);
  for (const s of old) remove(storage, s.id);
  return source;
}

export function remove(storage, id) {
  const clean = safeId(id);
  if (!clean || !fs.existsSync(jsonOf(storage, clean))) return false;
  for (const ext of ['json', 'pdf']) fs.rmSync(path.join(sourcesDir(storage), `${clean}.${ext}`), {force: true});
  return true;
}

// The main CV changed (replaced, re-read): the matches were made against another one. Match again, from the kept transcriptions.
export async function rematchStale(storage, {apiKey = '', client = null, onStep = () => {}} = {}) {
  const main = baseCv(storage);
  if (!main) return 0;
  let done = 0;
  for (const source of list(storage)) {
    if (source.mainKey === mainKey(main)) continue;
    onStep('comparing');
    source.match = (await matchAgainst(main, source.cv, apiKey, client)).match;
    source.mainKey = mainKey(main);
    write(storage, source);
    done++;
  }
  return done;
}

// ---------- what tailoring reads ----------
// The main CV with the extra sources' new bullets appended to the roles they match: role.extra = their indexes, role.extraFrom = where each came from.
// Same jobs, titles, dates and places as the main CV, always. Sources matched against another main CV are left out until matched again.
export function withExtras(storage, base, sources = list(storage)) {
  if (!base) return base;
  const out = structuredClone(base), key = mainKey(base);
  const extraSkills = new Set();
  const known = new Set(String(base.skills || '').split(',').map(s => s.trim().toLowerCase()));
  for (const source of sources) {
    if (source.mainKey !== key) continue;
    const flat = flatRoles(source.cv);
    for (const m of source.match) {
      const from = flat[m.sourceRole], role = out.jobs[m.mainJob]?.roles[m.mainRole];
      if (!from || !role) continue;
      role.extra ||= []; role.extraFrom ||= {};
      const have = new Set(role.bullets.map(b => b.toLowerCase()));
      for (const i of m.newBullets) {
        const text = from.bullets[i];
        if (!text || have.has(text.toLowerCase()) || role.extra.length >= MAX_EXTRA_PER_ROLE) continue;
        have.add(text.toLowerCase());
        role.extra.push(role.bullets.length);
        role.extraFrom[role.bullets.length] = source.name;
        role.bullets.push(text);
      }
    }
    for (const skill of String(source.cv.skills || '').split(',').map(s => s.trim()).filter(Boolean)) if (!known.has(skill.toLowerCase())) { known.add(skill.toLowerCase()); extraSkills.add(skill); }
  }
  for (const job of out.jobs) for (const role of job.roles) if (role.extra && !role.extra.length) { delete role.extra; delete role.extraFrom; }
  if (extraSkills.size) out.extraSkills = [...extraSkills].join(', ');
  return applyAdded(out, readAdded(storage), key);   // Why (Insights PR 2): what the person added after an insight joins the copy tailoring reads, never cv.json
}

// Everything the extra sources say, as plain words: the tailor's vocabulary check treats these as known.
export const knownText = (storage, base, sources = list(storage)) => [...sources.filter(s => !base || s.mainKey === mainKey(base)).map(s => JSON.stringify(s.cv)), JSON.stringify(readAdded(storage).map(item => item.text))].join(' ');

// ---------- what the window shows ----------
export function view(storage) {
  const main = baseCv(storage);
  const key = main ? mainKey(main) : '';
  const sources = list(storage);
  const merged = withExtras(storage, main, sources);
  const roles = (merged?.jobs || []).flatMap(job => job.roles.map(role => ({company: job.company, title: role.title, period: role.period, place: role.place || '',
    bullets: role.bullets.map((text, i) => ({text, from: role.extraFrom?.[i] || 'Main CV'}))})));
  return {
    main: main ? {name: main.name || '', roles: main.jobs.reduce((n, j) => n + j.roles.length, 0), skills: main.skills || ''} : null,
    sources: sources.map(s => {
      const flat = flatRoles(s.cv);
      return {id: s.id, kind: s.kind, name: s.name, addedAt: s.addedAt, stale: s.mainKey !== key, roles: flat.length,
        added: s.match.reduce((n, m) => n + m.newBullets.length, 0),
        onlyHere: s.match.filter(m => m.mainJob < 0).map(m => ({company: flat[m.sourceRole]?.company, title: flat[m.sourceRole]?.title, period: flat[m.sourceRole]?.period}))};
    }),
    roles, extraSkills: merged?.extraSkills || '', added: readAdded(storage).map(({id, kind, text, mainJob, mainRole}) => ({id, kind, text, ...(kind === 'bullet' ? {mainJob, mainRole} : {})})),
  };
}

// What a change did to the profile, from the view before and after it (an add, a removal, a match again): the details and technologies tailoring
// can draw on, and the roles found only in other versions. Nothing is stored: removing a source only stops offering what came from it, the main CV is never edited.
const words = text => String(text || '').split(',').map(w => w.trim()).filter(Boolean);
const gap = (from, to) => from.filter(w => !to.some(x => x.toLowerCase() === w.toLowerCase()));
const roleKey = r => [r.title, r.company, r.period].filter(Boolean).join(' · ');
const onlyHere = v => v.sources.filter(s => !s.stale).flatMap(s => s.onlyHere.map(roleKey));
const extras = v => v.roles.reduce((n, r) => n + r.bullets.filter(b => b.from !== 'Main CV').length, 0);
export function viewChanges(before, after) {
  const [skillsBefore, skillsAfter] = [words(before.extraSkills), words(after.extraSkills)];
  const [rolesBefore, rolesAfter] = [onlyHere(before), onlyHere(after)];
  return {details: extras(after) - extras(before), skillsAdded: gap(skillsAfter, skillsBefore), skillsRemoved: gap(skillsBefore, skillsAfter),
    newRoles: gap(rolesAfter, rolesBefore), goneRoles: gap(rolesBefore, rolesAfter)};
}
