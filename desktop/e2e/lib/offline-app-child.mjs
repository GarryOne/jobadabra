// The app's own extension server (desktop/lib/server.js, the same decision modules a person's app runs) under plain node, for an offline row replay (speed-5x
// landing 2, owner 11 Oct 2026). Started by lib/offline-app.mjs in its own process: the server reads its port at import time, and this process's network is
// cut to loopback (guardNetwork) while the model is answered from the row's kept answers only (memo-only; `claude -p` only when the caller asks).
// Its folder holds the fake applicant only (fixtures/cv.pdf, the e2e applicant's strategy with the stand-in contact): never the person's data. Prints one JSON line when ready.
// Job: serve stored answers
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {guardNetwork} from './offline-guard.mjs';
import {realClaude} from './real-claude.mjs';
import {serveCommands} from './offline-app-commands.mjs';
import {seedImportedCv} from './applicant-seed.mjs';
import {watchRunner} from '../../lib/e2e-host.js';

const E2E = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = process.env.JOBADABRA_USER_DATA;
if (!dir || !process.env.JOBADABRA_E2E || !process.env.JOBADABRA_PORT) throw new Error('offline app: start it through lib/offline-app.mjs (e2e env, own folder, own port)');
watchRunner(() => process.exit(0));   // the harness that started it is gone (killed, crashed, timed out): end too, from the first line, as the Electron test app does (main.js)
guardNetwork();
// A positive control: the guard took effect in this process (an outward fetch is refused and named) before anything is served.
const guarded = await fetch('https://example.com/').then(() => false, error => /offline: example\.com/.test(String(error?.message || error)));
if (!guarded) throw new Error('offline app: the network guard did not take effect');

// The stand-in contact, as the profile's contact section a person's app keeps (lib/contact.js reads it).
const STAND_IN = {first_name: 'Test', last_name: 'Candidate', email: 'test.candidate@example.com', phone: '+41 00 000 00 00', location: 'Zurich, Switzerland',
  linkedin: 'https://www.linkedin.com/in/test-candidate-example'};

fs.mkdirSync(dir, {recursive: true});
fs.copyFileSync(path.join(E2E, 'fixtures', 'cv.pdf'), path.join(dir, 'cv.pdf'));
// The CV as the app's import keeps it (cv/cv.json, hand-made from cv.pdf, years included): the fill's <cv_facts> read it; a fill never imports (lib/server-env.js).
seedImportedCv(dir);   // E2E_NO_IMPORTED_CV: the control, an app whose CV was never imported (npm run cv-facts-cases must then miss)
const {logTo} = await import('../../lib/log.js');
logTo(path.join(dir, 'logs'));
const {createStorage} = await import('../../lib/storage.js');
const storage = createStorage(dir, {encrypt: value => value, decrypt: value => value});
// The Electron run's applicant (lib/seed.mjs fastSeed: the window's saveStrategy with demo/draft.json), kept through the same function, with the stand-in contact:
// a contact alone left the fill's AI a 250-character profile, and it judged the applicant ineligible where the Electron run filled (Teamtailor, 11 Oct 2026).
(await import('../../lib/pipeline-env.js')).ensureConfig(storage);   // the settings files as the app makes them at every start (main.js), before the applicant is kept
const draft = (await import('./applicant-seed.mjs')).applicantDraft();   // JP_APPLICANT=grown: the grown applicant
(await import('../../lib/strategy.js')).keepLocally(storage, {...draft, contact: STAND_IN});
// A CI runner (lib/offline-app.mjs api): the app's API engine on the key it was handed, through the harness's proxy on this computer (ANTHROPIC_BASE_URL); else the plan.
const apiKey = process.env.JOBADABRA_E2E_API_KEY || '';
delete process.env.JOBADABRA_E2E_API_KEY;
if (apiKey) storage.setSecret('ANTHROPIC_API_KEY', apiKey);
storage.saveSettings({aiEngine: apiKey ? 'api' : 'cli', ...(apiKey ? {} : {claudeCode: {path: realClaude()}}), store: 'sqlite', setupDone: true, cvName: 'cv.pdf', telemetry: false, shareEmployers: false});
if (process.env.E2E_IMPORT_VIA_UPLOAD) {   // the app's own upload path: setCv on the fake CV, cv.json made by the real import (plan path); npm run cv-facts-cases then reads it
  const uploaded = path.join(dir, 'picked-cv.pdf');
  fs.copyFileSync(path.join(E2E, 'fixtures', 'cv.pdf'), uploaded);
  const claudeCode = await import('../../lib/claude-code.js');
  await (await import('../../lib/cv-import-at-upload.js')).setCv(storage, uploaded, 'cv.pdf', {client: claudeCode.client(storage), key: ''}).done;
  if (!fs.existsSync(path.join(dir, 'cv', 'cv.json'))) throw new Error('offline app: the upload did not leave cv/cv.json');
}
const {start, PORT, EXTENSION_ID} = await import('../../lib/server.js');
const {extensionToken} = await import('../../lib/server-env.js');
if (String(PORT) !== process.env.JOBADABRA_PORT) throw new Error(`offline app: the server took port ${PORT}, not ${process.env.JOBADABRA_PORT}`);
(await import('../../lib/server-hooks.js')).setSitePasswordHandler((await import('./offline-site-password.mjs')).offlineSitePassword(storage, {email: async () => (await import('../../lib/contact.js')).read(storage)}));   // a seeded test account signs in; nothing is made (lib/offline-site-password.mjs)
if (process.env.JP_JOURNEY === '1' || process.env.JP_REVIEW === '1') {   // JP_REVIEW: only the panel's report reaches the review state (a harness run that accepts proposals: lib/proposals-to-use.mjs); the page step stays as in a plain replay   // a journey test (replay-net.mjs --journey): the card follows the page and the panel's report as the app's own handlers do (lib/page-step.js, ext-server-handlers.js setReviewHandler), so the sampler reads what the card shows
  const hooks = await import('../../lib/server-hooks.js'), review = await import('../../lib/review.js'), terminals = await import('../../lib/terminals.js');
  if (process.env.JP_JOURNEY === '1') hooks.setPageHandler((await import('../../lib/page-step.js')).pageStepHandler({terminals, review, appLog: (await import('../../lib/log.js')).log}));
  hooks.setReviewHandler(payload => { const report = review.report(terminals.list(), payload); return report.moved ? {...report, tab: review.tabOf(String(payload?.session || ''), String(payload?.boot || '')) || null} : report; });
}
const server = start(storage, error => console.error(`offline app: server error ${error?.message || error}`));
await new Promise(resolve => server.once('listening', resolve));
console.log(JSON.stringify({ready: true, guarded, port: PORT, token: extensionToken(storage), extensionId: EXTENSION_ID, dir}));
serveCommands(storage);   // the harness drives the app as its window would (lib/offline-app-commands.mjs)
process.on('SIGTERM', () => server.close(() => process.exit(0)));
