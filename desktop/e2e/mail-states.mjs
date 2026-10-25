// Every state of a Gmail check's card in ONE visible demo window: Recent activity lists one Gmail check run per state, newest
// first, so you click through them like real runs (owner, 6 Oct 2026). node e2e/mail-states.mjs  ·  Ctrl+C closes it.
// The states are fixtures/mail-states.json; demo data only, nothing reported.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {DESKTOP, E2E, launch} from './lib/app.mjs';
import {openRunsList} from './lib/runs-list.mjs';

process.env.E2E_HIDDEN ??= '0';   // the point is to look: shown, unless asked otherwise
const {states, focus} = JSON.parse(fs.readFileSync(path.join(E2E, 'fixtures', 'mail-states.json'), 'utf8'));

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-mail-states-'));
for (const file of fs.readdirSync(path.join(DESKTOP, 'demo'))) if (file !== 'jobs.json') fs.copyFileSync(path.join(DESKTOP, 'demo', file), path.join(profile, file));
// One run per state, a minute apart (the first state on top), named in its trigger line so the list says which is which.
const now = Date.now();
const runs = states.map((state, i) => {
  const at = new Date(now - (i + 1) * 60000).toISOString();
  return {id: now - i, trigger: 'you', startedAt: at, endedAt: at, log: [], ...state.run};
});
fs.writeFileSync(path.join(profile, 'runs.json'), JSON.stringify(runs, null, 1));
// Focus holds the open "which job?" and the answered one, so both question states draw as they do for a person.
const focusFile = path.join(profile, 'focus.json');
const demoFocus = JSON.parse(fs.readFileSync(focusFile, 'utf8'));
fs.writeFileSync(focusFile, JSON.stringify({...demoFocus, items: [...focus.open, ...demoFocus.items], answered_questions: focus.answered}, null, 1));

// Demo mode reads Focus from the app's demo/focus.json unless told otherwise: without this the question states drew as answered.
const session = await launch({profile, env: {JOB_PILOTTO_DEMO: '1', JOB_PILOTTO_DEMO_FOCUS: focusFile}});
await session.page.waitForSelector('.nav[data-view=focus]:not([hidden])', {timeout: 30000});
await session.app.evaluate(({BrowserWindow}) => {
  const win = BrowserWindow.getAllWindows()[0];
  win.setBounds({x: 40, y: 40, width: 1400, height: 940});
  win.setTitle('Gmail check · every state');
  win.show();
  win.focus();
});
await openRunsList(session.page);
// MAIL_STATES_SHOTS=<folder>: click each state and save the panel, to check them without looking (then the window stays open).
if (process.env.MAIL_STATES_SHOTS) {
  fs.mkdirSync(process.env.MAIL_STATES_SHOTS, {recursive: true});
  const rows = session.page.locator('#activity-recent li:not(.recent-group) button');
  for (let i = 0; i < states.length; i++) {
    await rows.nth(i).click();
    await session.page.waitForTimeout(600);
    await session.page.locator('#actions-runs').screenshot({path: path.join(process.env.MAIL_STATES_SHOTS, `${String(i + 1).padStart(2, '0')}.png`)});
  }
  // The open question's button opens the job picker in a popup (not Focus): click it and keep a picture of the dialog.
  const asking = states.findIndex(state => state.name.startsWith('7 emails'));
  await rows.nth(asking).click();
  await session.page.waitForTimeout(500);
  await session.page.click('.mail-question-go');
  await session.page.waitForSelector('#reassign-dialog[open]', {timeout: 5000});
  await session.page.screenshot({path: path.join(process.env.MAIL_STATES_SHOTS, 'popup.png')});
  await session.page.keyboard.press('Escape');
  console.log(`Saved ${states.length} pictures in ${process.env.MAIL_STATES_SHOTS}`);
}
console.log(states.map((state, i) => `  ${i + 1}. ${state.name}`).join('\n'));
console.log('One window open: Recent activity lists one Gmail check per state, in this order. Ctrl+C closes it.');
const close = async () => { await session.app.close().catch(() => {}); fs.rmSync(profile, {recursive: true, force: true}); process.exit(0); };
process.on('SIGINT', close);
process.on('SIGTERM', close);
await new Promise(() => {});
