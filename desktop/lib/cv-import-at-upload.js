// Setting the CV and reading it once: every path that picks a CV goes through setCv, which puts the file in place and, in the
// background, imports it into cv/cv.json (the facts the form AI, Tailor and the match read). The same file is never read twice
// (cv/import.json holds the hash of the PDF cv.json came from); a failure is logged and toasted, never blocks the upload; Tailor
// and the cover letter call ensure() too, so a missed import is retried there and two imports at once share one call (a CV set while one runs is read after it).
// Guarded by test/cv-import-at-upload.test.js (it also fails when a new caller bypasses these functions).
import * as cvChange from './cv-change.js';
import * as cvlib from './cv.js';
import {writePrivate} from './private-file.js';
import path from 'node:path';
import fs from 'node:fs';
import {log} from './log.js';

const inflight = new Map();   // the CV folder -> the running import

// -> {skipped} | {cv, usd}. force: the explicit "import again". atUpload: a new file was just set, so a cv.json of unknown origin is not trusted.
export function ensure(storage, {client = null, key = '', look = null, force = false, atUpload = false} = {}) {
  if (!fs.existsSync(storage.path('cv.pdf'))) return Promise.resolve({skipped: 'no CV'});
  const folder = cvlib.dir(storage);
  // An import already running read the PDF that was there when it started: if another CV was set meanwhile, that one is read next (issue #355).
  if (inflight.has(folder)) return inflight.get(folder).then(result => (cvlib.importedFrom(storage) === cvlib.pdfHash(storage) ? result : ensure(storage, {client, key, look, atUpload})));
  const from = cvlib.importedFrom(storage);
  if (!force && cvlib.baseCv(storage) && (from ? from === cvlib.pdfHash(storage) : !atUpload)) return Promise.resolve({skipped: 'already imported'});
  const run = cvlib.importPdf(storage, key, client, {look}).finally(() => inflight.delete(folder));
  inflight.set(folder, run);
  return run;
}

// The CV picked by the person (Settings, onboarding, Activity and the Actions card all call chooseCv). -> {name, review, done}: the upload is
// finished when this returns; done settles when the background import has (it never rejects).
export function setCv(storage, file, name, {client = null, key = '', look = null, toast = () => {}, now = new Date()} = {}) {
  const set = cvChange.replace(storage, file, name, now);
  const state = (value, extra = {}) => storage.saveSettings({cvImport: {state: value, at: new Date().toISOString(), ...extra}});
  if (!client && !key) { state('waiting-for-ai'); return {...set, done: Promise.resolve()}; }
  state('running');
  const done = ensure(storage, {client, key, look, atUpload: true}).then(result => {
    state('done');
    log('cv', 'CV read at upload', result.skipped ? {skipped: result.skipped} : {usd: result.usd});
  }).catch(error => {
    const message = String(error?.message || error).slice(0, 200);
    state('failed', {error: message});
    log('cv', 'CV not read at upload', {error: message});
    toast({title: 'CV not read yet', body: 'Your CV is saved. It will be read again when you tailor a CV.', target: {card: 'cv'}});
  });
  return {...set, done};
}

// A CV the app built (lib/cv-build.js): the PDF becomes the main CV and cv.json is written with that PDF's hash, so the import never reads it again.
export function setBuiltCv(storage, file, name, cv, now = new Date()) {
  const set = cvChange.replace(storage, file, name, now);
  fs.mkdirSync(cvlib.dir(storage), {recursive: true});
  writePrivate(path.join(cvlib.dir(storage), 'cv.json'), JSON.stringify(cv, null, 2) + '\n');
  writePrivate(path.join(cvlib.dir(storage), 'import.json'), JSON.stringify({pdf: cvlib.pdfHash(storage)}) + '\n');
  return set;
}
