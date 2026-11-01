// Which applicant the e2e apps hold, as a short hash (no text): desktop/demo/draft.json, seeded by the Electron run (lib/seed.mjs fastSeed) and the plain-node app
// (lib/offline-app-child.mjs, since 9f6ff67). Every capture records it (lib/replay-candidate.mjs saveCandidate, lib/live-row.mjs); a row replay (row.mjs) names a
// capture made with another seed or none: its fill asks carry another profile, so they miss the row's kept answers. Guard: test/filling/applicant-seed.test.mjs.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {CONTACT} from './apply-fixtures.mjs';

export const SEED_FILE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'demo', 'draft.json');
export const OLD_SEED = 'captured with an older applicant seed: fill asks will miss; re-capture the row live (npm run record-sites -- --only "<row>") before trusting its fill';

// The grown applicant (applicants/grown.json): the thin one plus the recurring questions answered once, as a real user grows their data. JP_APPLICANT=grown
// picks it everywhere an app is seeded (seed.mjs, offline-app-child.mjs, answer-reask.mjs); thin stays the default so the pool and the recorded cases stay comparable.
export const GROWN_FILE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'applicants', 'grown.json');
export const APPLICANTS = ['thin', 'grown'];

// -> the draft the app is seeded with. A replaced line that is not in the thin draft is an error (the thin one changed under the overlay), never a silent no-op.
export function applicantDraft({which = process.env.JP_APPLICANT || 'thin', file = SEED_FILE, grownFile = GROWN_FILE} = {}) {
  if (!APPLICANTS.includes(which)) throw new Error(`JP_APPLICANT=${which}: one of ${APPLICANTS.join(', ')}`);
  const {draft} = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (which === 'thin') return draft;
  const grown = JSON.parse(fs.readFileSync(grownFile, 'utf8'));
  let profile = draft.profile_markdown, answers = draft.answers_markdown;
  for (const [from, to] of grown.replace || []) {
    if (!profile.includes(from) && !answers.includes(from)) throw new Error(`grown applicant: "${from}" is not in the thin draft any more`);
    profile = profile.replace(from, to); answers = answers.replace(from, to);
  }
  return {...draft, profile_markdown: profile, answers_markdown: `${answers.trimEnd()}\n\n${grown.answers_append || ''}`};
}

// The parts of the applicant an AI ask carries (the contact details the live row saves, apply-fixtures.mjs CONTACT; the Profile, the standard answers, the search and its preferences, the imported CV). -> 12 hex characters
export function seedVersion(file = SEED_FILE, which = undefined) {
  const draft = applicantDraft({file, which});
  const cvJson = fs.readFileSync(new URL('../fixtures/cv.json', import.meta.url), 'utf8');   // the CV's jobs and schools ride in every fill ask (<cv_facts>)
  return crypto.createHash('sha256').update(JSON.stringify([draft.profile_markdown, draft.answers_markdown, draft.search, draft.preferences, cvJson, CONTACT])).digest('hex').slice(0, 12);
}

// -> '' when the capture in caseDir was made with this seed, else OLD_SEED (a capture from before the seed was recorded has none).
export function seedNote(caseDir, current = seedVersion()) {
  let item = null;
  try { item = JSON.parse(fs.readFileSync(path.join(caseDir, 'case.json'), 'utf8')); } catch { /* no case: the replay says so itself */ }
  return item && item.seed !== current ? OLD_SEED : '';
}

// The imported CV (cv/cv.json, hand-made from fixtures/cv.pdf), as the app's import keeps it: the fill's <cv_facts> read it. Both apps that fill a live row seed it here
// (the plain-node app, lib/offline-app-child.mjs; the Electron live leg, lib/apply-live.mjs): 12 Oct 2026, HelloFresh's Electron leg filled without it.
// E2E_NO_IMPORTED_CV (the control: an app whose CV was never imported) and E2E_IMPORT_VIA_UPLOAD (the app's own import makes it) seed nothing. -> seeded?
export function seedImportedCv(dir, env = process.env) {
  if (env.E2E_NO_IMPORTED_CV || env.E2E_IMPORT_VIA_UPLOAD) return false;
  fs.mkdirSync(path.join(dir, 'cv'), {recursive: true});
  fs.copyFileSync(new URL('../fixtures/cv.json', import.meta.url), path.join(dir, 'cv', 'cv.json'));
  return true;
}
