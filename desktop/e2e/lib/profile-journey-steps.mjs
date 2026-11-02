// Job: run the backbone
/* global window */
// The Profile journey (J14, Tier 1; owner, 1 and 2 Nov 2026: "Working on the Profile… it will be one of the first things a user will do" · "the e2e Profile journey keeps only the thin path a user takes"):
// two steps on the running app, used by e2e/suites/settings.mjs. (1) The person's CV is checked in Profile → CV and the card shows its readability score. (2) A phone edited in Profile → Your details
// is, after the app is quit and started again, what the extension is handed for the next form (GET /extension/me, paired as the extension pairs). Everything below that path (what the checks flag,
// the experience editor, What we learned, the cover letter, score edge cases) is integration: integration/app/cv-check.test.js, integration/store/profile-detail-handoff.test.mjs, profile-experience-edit.test.mjs.
// Fake applicant data only; the app runs on a free port, never the owner's 47111.
import fs from 'node:fs';
import path from 'node:path';
import {FIXTURES} from './cvfixtures.mjs';
import {freePort} from './extension.mjs';
import {pollUntil, stepWait, waitForLogLine} from './wait-on-state.mjs';

// Why (2 Nov 2026, a8): the extension's id is its manifest key's (lib/server.js EXTENSION_IDS); importing server.js would load the whole app server into the runner.
const EXTENSION_ID = 'gpffoneapcfceflfmfgedkcfbommgcfk';
const PRODUCTION_PORT = 47111;   // the owner's own app (lib/server-listen.js DEFAULT_PORT): no step here starts or asks an app on it
const NEW_PHONE = '+41 79 555 99 88';

// Profile as a person opens it: the menu's Profile, then one of its tabs.
async function openProfile(ctx, tab) {
  await stepWait('the Profile menu item', timeout => ctx.page.getByRole('button', {name: 'Profile', exact: true}).click({timeout}));
  await stepWait(`the ${tab} tab`, timeout => ctx.page.getByRole('tab', {name: tab, exact: true}).click({timeout}));
}

// The plain CV, printed by the app's own Chromium (the same PDF a person's CV is): the file the CV check reads.
const printPlainCv = (ctx, target) => ctx.app.evaluate(async ({BrowserWindow}, html) => {
  const win = new BrowserWindow({show: false, width: 794, height: 1123});
  await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  const data = await win.webContents.printToPDF({pageSize: 'A4', printBackground: true, preferCSSPageSize: true});
  win.destroy();
  return data.toString('base64');
}, FIXTURES.good.html).then(base64 => fs.writeFileSync(target, Buffer.from(base64, 'base64')));

/**
 * Step 1: the CV in Profile → CV is checked with the card's own button and the card shows "Readability" with the score the app saved.
 * The CV file is the plain fixture CV and is put back afterwards. Throws naming the state the card showed when a wait ends.
 */
export async function profileCvStep(ctx) {
  const target = path.join(ctx.profile, 'cv.pdf'), original = fs.existsSync(target) ? fs.readFileSync(target) : null;
  try {
    await printPlainCv(ctx, target);
    await ctx.page.reload();   // the Profile page reads the CV file afresh
    await openProfile(ctx, 'CV');
    await stepWait('the CV check button', timeout => ctx.page.getByRole('button', {name: 'Check PDF readability'}).click({timeout}));
    await stepWait('the CV check to say it was checked', timeout => ctx.page.getByText(/^Checked /).waitFor({state: 'visible', timeout}));
    await stepWait('the Readability score tile', timeout => ctx.page.getByText('Readability', {exact: true}).first().waitFor({state: 'visible', timeout}));
    const saved = await ctx.page.evaluate(() => window.pilot.cvCheckStatus());
    const score = saved?.ats?.score;
    if (!Number.isInteger(score) || score < 1 || score > 100) throw new Error(`the CV check saved no score between 1 and 100 for the plain CV (saved: ${JSON.stringify(saved?.ats ?? null).slice(0, 200)})`);
    await stepWait(`the score ${score} on the card`, timeout => ctx.page.getByText(String(score), {exact: true}).first().waitFor({state: 'visible', timeout}));
  } finally { if (original) fs.writeFileSync(target, original); }
}

// GET /extension/me as the extension asks: paired on the app's own port with the extension's origin, then asked with its token.
async function handedToExtension(port) {
  const base = `http://127.0.0.1:${port}`;
  const pair = await fetch(`${base}/extension/pair`, {headers: {Origin: `chrome-extension://${EXTENSION_ID}`}});
  if (!pair.ok) throw new Error(`the app on port ${port} would not pair the extension (HTTP ${pair.status})`);
  const {token} = await pair.json();
  const me = await fetch(`${base}/extension/me`, {headers: {Authorization: `Bearer ${token}`}});
  if (!me.ok) throw new Error(`GET /extension/me answered HTTP ${me.status}`);
  return (await me.json()).contact || {};
}

/**
 * Step 2: a phone edited in Profile → Your details and saved with the Profile's save bar is what the extension is handed after the app is quit and started again.
 * The earlier phone is saved back afterwards. Throws naming the phone last handed when the wait ends.
 */
export async function profileDetailStep(ctx) {
  await waitForLogLine(ctx.profile, /startup moves finished/g, {what: 'the app\'s start-up move into the store'});
  const before = await ctx.page.evaluate(() => window.pilot.contact());
  await openProfile(ctx, 'Your details');
  await stepWait('Edit on the Contact card', timeout => ctx.page.getByRole('button', {name: 'Edit contact'}).click({timeout}));
  await stepWait('the Phone box', timeout => ctx.page.getByRole('textbox', {name: 'Phone', exact: true}).fill(NEW_PHONE, {timeout}));
  await stepWait('Save all changes on the save bar', timeout => ctx.page.getByRole('region', {name: 'Unsaved changes'}).getByRole('button', {name: 'Save all changes'}).click({timeout}));
  const {value: saved} = await pollUntil(() => ctx.page.evaluate(() => window.pilot.contact()), contact => contact?.phone === NEW_PHONE, {log: () => {}});
  if (saved?.phone !== NEW_PHONE) throw new Error(`the save bar did not save the phone: the Profile holds ${JSON.stringify(saved?.phone)}`);

  // The app is quit as a person quits it and started again on its own free port.
  const port = await freePort();
  if (port === PRODUCTION_PORT) throw new Error('the Profile step must never use the production port 47111');
  await ctx.relaunch({JOBADABRA_PORT: String(port)}, undefined, {how: 'quit'});
  const {value: setUp} = await pollUntil(() => ctx.page.evaluate(async () => (await window.pilot.state()).settings.setupDone === true), value => value, {log: () => {}});
  if (!setUp) throw new Error('after the restart the app is not set up again');
  const {value: handed} = await pollUntil(() => handedToExtension(port).then(contact => contact.phone, error => `(not asked yet: ${error.message})`), phone => phone === NEW_PHONE, {log: () => {}});
  try {
    if (handed !== NEW_PHONE) throw new Error(`after the restart the extension is handed the phone ${JSON.stringify(handed)}, not the one saved in Your details`);
  } finally {
    const restored = await ctx.page.evaluate(contact => window.pilot.saveContact(contact), before);
    if (!restored?.ok) throw new Error(`the earlier details could not be saved back: ${restored?.error}`);
  }
}
