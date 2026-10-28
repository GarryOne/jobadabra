/* global document */
// What the storemove suite (suites/storemove.mjs) reads and drives: the seeded data's items on every screen, Settings → Your data, the native dialogs
// export and import open (Playwright cannot press an OS window), the move's own Python process (killed halfway), and what the Notion stand-in holds.
import {execFileSync} from 'node:child_process';
import {python, pythonEnv} from './python.mjs';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {openPanel, panelRows} from './activity-steps.mjs';
import {appLogLines} from './app-log.mjs';
import {goView} from './go-view.mjs';
import {showFilter} from './jobs-filter.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
// The seeded jobs and the match (lib/store_seed.py): every screen is read for these names only, so the app's own rows (a hint, an empty state) never count.
export const COMPANIES = ['Kestrel Labs', 'Huxley Systems', 'Marlow Freight', 'Orrin AG'];
export const TEXTS = {
  profile: '# Profile\n\nE2E storemove: a platform engineer in Zurich, on call for ten years.\n',
  answers: '# Standard answers\n\n- Notice period: three months (e2e storemove)\n',
  knowledge: '# Form knowledge\n\n- Workday forms ask for the notice period in weeks (e2e storemove)\n',
};
export const NOTION_PROFILE = 'E2E storemove: the Profile this Notion already had.';

// The app's store gets the seed through the engine's own store code, in this app's data folder (the script refuses any other).
export function seedStore(profile) {
  for (const [name, text] of Object.entries(TEXTS)) fs.writeFileSync(path.join(profile, `${name}.md`), text);
  const out = execFileSync(python(), [path.join(HERE, 'store_seed.py'), path.join(profile, 'data')], {encoding: 'utf8', env: pythonEnv({}, {home: profile})});
  return JSON.parse(out.trim().split('\n').pop());
}

const settled = (page, ms = 600) => page.waitForTimeout(ms);
async function named(page, selector, {timeout = 30000, want = 1, exact = false} = {}) {
  // Rows arrive once the store answered: wait for `want` of the seeded names (exactly `want` when the screen is known to hide some: a transient list that still shows them all
  // must not end the wait, 10 Oct 2026, Windows CI), then read them all.
  await page.waitForFunction(({selector, names, want, exact}) => {
    const rows = [...document.querySelectorAll(selector)];
    const shown = names.filter(name => rows.some(node => node.textContent.includes(name))).length;
    return rows.map(node => node.textContent).join('\n').split('\n').filter(Boolean).length && (exact ? shown === want : shown >= want);
  }, {selector, names: COMPANIES, want, exact}, {timeout}).catch(() => {});
  return page.evaluate(({selector, names}) => names.filter(name => [...document.querySelectorAll(selector)].some(node => node.textContent.includes(name))), {selector, names: COMPANIES});
}

// {jobs, focus, interviews, activity}: which seeded items each screen shows. Compared before and after a move or an import.
// jobs: how many seeded jobs the Jobs list is expected to show (4 unless a search has marked one not seen, which hides it): the wait is for exactly that many.
export async function screens(page, {jobs: expectedJobs = COMPANIES.length} = {}) {
  const go = async view => { await goView(page, view); await page.waitForSelector(`.view[data-view="${view}"]:not([hidden])`); await settled(page); };
  await go('jobs');
  await showFilter(page, 'everything');   // the default shows new matches only; All matches leaves applied jobs out (76d1cdd), Everything keeps the applications
  const jobs = await named(page, 'article.job-row', {want: expectedJobs, exact: true});
  await go('focus');
  const focus = await named(page, '#focus-list .focus-item, #focus-suggestions-list .focus-item', {timeout: 8000});   // Up next and Suggestions
  await go('interviews');
  // An interview's row also lists every job (its job picker): read the row's own title, not the names.
  await page.waitForFunction(() => [...document.querySelectorAll('#iv-saved tr[data-id]')].some(row => /first round/i.test(row.textContent)), null, {timeout: 30000}).catch(() => {});
  const interviews = await page.evaluate(() => [...document.querySelectorAll('#iv-saved tr[data-id]')].filter(row => /first round/i.test(row.textContent)).map(() => 'Huxley Systems: first round'));
  if (!interviews.length) console.log(`  interview rows: ${JSON.stringify(await page.evaluate(() => [...document.querySelectorAll('#iv-saved tr[data-id]')].map(row => row.innerText.replace(/\s+/g, ' ').slice(0, 160))))}`);
  await openPanel({page});
  await page.waitForFunction(() => [...document.querySelectorAll('#activity-recent .recent-row')].some(row => /4 emails/.test(row.textContent)), null, {timeout: 30000}).catch(() => {});
  const activity = (await panelRows(page)).filter(row => /Checked 4 emails|4 emails/.test(row.what)).map(row => row.what);
  await page.keyboard.press('Escape');
  return {jobs, focus, interviews, activity};
}
export function sameScreens(before, after) {
  const differ = Object.keys(before).filter(key => JSON.stringify([...before[key]].sort()) !== JSON.stringify([...after[key]].sort()));
  if (differ.length) throw new Error(`the screens differ: ${differ.map(key => `${key} was ${JSON.stringify(before[key])}, now ${JSON.stringify(after[key])}`).join('; ')}`);
}

export async function yourData(page) {
  await page.click('.nav[data-view="settings"]:not([data-settings="profile"])');   // the menu's Settings: its Profile hides the list of sections
  await page.click('[data-settings-go="data"]');
  await page.waitForSelector('#export-data', {state: 'visible', timeout: 10000});
}
export const storeMessage = page => page.evaluate(() => document.getElementById('store-message')?.textContent.trim() || '');
// "Move my data to Notion" (Settings → Your data) opens the connect prompt as "Move to Notion" with the move said up front (pages/notion-connect.js);
// its press runs the move and the result lands in the card's line. A prompt left open by a stopped move is pressed again as it is.
export async function pressMove(page, {timeout = 180000} = {}) {
  if (!await page.locator('#notion-connect-dialog').evaluate(dialog => dialog.open)) {
    await yourData(page);
    await page.click('#store-move');
  }
  await page.waitForSelector('#notion-connect-move', {state: 'visible', timeout: 10000});
  // Notion is connected (the step before connected it): the prompt reads the state as it opens and offers the move alone.
  const said = await page.waitForFunction(() => document.getElementById('notion-connect-go')?.textContent.trim() === 'Move to Notion', null, {timeout: 10000}).then(() => '', () => page.textContent('#notion-connect-go'));
  if (said) throw new Error(`the move's prompt says "${said.trim()}", not "Move to Notion"`);
  await page.evaluate(() => { document.getElementById('store-message').textContent = ''; });   // a stopped move's line from before must not count
  await page.click('#notion-connect-go');
  await page.waitForFunction(() => /Moved to Notion ✓|stopped before the end|Not moved/.test(document.getElementById('store-message')?.textContent || ''), null, {timeout});
  return storeMessage(page);
}
export const settingsOf = profile => JSON.parse(fs.readFileSync(path.join(profile, 'settings.json'), 'utf8'));

// The native dialogs, answered for the person: the next save dialog picks `file`, an "Import and restart?" question answers its second button, and a
// restart only exits (the suite starts the app again on the same folder, as a person's next start would).
export const answerSave = (app, file) => app.evaluate(({dialog}, filePath) => { dialog.showSaveDialog = async () => ({canceled: false, filePath}); }, file);
export const answerImport = (app, file) => app.evaluate(({app: electron, dialog}, filePath) => {
  dialog.showOpenDialog = async () => ({canceled: false, filePaths: [filePath]});
  dialog.showMessageBoxSync = () => 1;
  electron.relaunch = () => {};
}, file);

// The move's Python process (python -m src.stores.copy), found among this app's own descendants only (the engine may start under a wrapper):
// never a pattern kill, other sessions run copies too.
export function processRows(text, platform = process.platform) {
  if (platform === 'win32') {   // PowerShell's Get-CimInstance as JSON (there is no `ps -A` on Windows: 10 Oct 2026, the storemove suite failed there); one process is an object, not a list
    const list = [].concat(text.trim() ? JSON.parse(text) : []);
    return list.map(row => ({pid: Number(row.ProcessId), ppid: Number(row.ParentProcessId), command: row.CommandLine || ''}));
  }
  return text.split('\n').map(line => line.trim().match(/^(\d+)\s+(\d+)\s+(.*)$/)).filter(Boolean).map(([, pid, ppid, command]) => ({pid: Number(pid), ppid: Number(ppid), command}));
}
const processTable = () => processRows(process.platform === 'win32'
  ? execFileSync('powershell', ['-NoProfile', '-Command', 'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,CommandLine | ConvertTo-Json -Compress'], {encoding: 'utf8', maxBuffer: 20 * 1024 * 1024})
  : execFileSync('ps', ['-Ao', 'pid=,ppid=,command='], {encoding: 'utf8'}));
export function copyProcess(appPid) {
  const rows = processTable();
  const mine = new Set([appPid]);
  for (let grew = true; grew;) { grew = false; for (const row of rows) if (mine.has(row.ppid) && !mine.has(row.pid)) { mine.add(row.pid); grew = true; } }
  return rows.filter(row => row.pid !== appPid && mine.has(row.pid) && /-m src\.stores\.copy\b/.test(row.command)).map(row => row.pid);
}
// A second install's own log (lib/app-log.mjs: app.log and the day files it rolled into), the lines about data and restarts: evidence when its
// import does not go as planned.
export const logLines = (profile, pattern = /\[(data|window|store)\]|import/i) => {
  try { return appLogLines(profile).filter(line => pattern.test(line)).slice(-12); } catch { return []; }
};
export const journalOf = profile => { try { return JSON.parse(fs.readFileSync(path.join(profile, 'data', 'move-sqlite-to-notion.json'), 'utf8')); } catch { return {}; } };

// What the stand-in holds: rows per database (by a word of its title), file blocks, and a page's text.
export const rowsIn = (standIn, word) => standIn.dump().filter(item => item.object === 'database' && item.title.includes(word)).reduce((sum, db) => sum + db.rows, 0);
export const fileBlocks = standIn => [...standIn.objects.values()].filter(item => item.object === 'block' && ['file', 'image', 'pdf'].includes(item.type) && !item.archived).length;
// The rows of the stand-in's database whose title has `word`: title, Status, archived. For evidence when screens differ after a move (read from the stand-in itself:
// the engine's store call needs the app's token, and the second install's is not the suite's).
export function standInRows(standIn, word) {
  const plain = rich => (rich || []).map(part => part.plain_text ?? part.text?.content ?? '').join('');
  const bare = id => String(id || '').replace(/-/g, '');
  const all = [...standIn.objects.values()];
  const databases = new Set(all.filter(item => item.object === 'database' && plain(item.title).includes(word)).map(item => bare(item.id)));
  return all.filter(item => item.object === 'page' && databases.has(bare(item.parent?.database_id)))
    .map(page => ({title: plain(Object.values(page.properties || {}).find(property => property.type === 'title')?.title), status: page.properties?.Status?.select?.name ?? null, archived: !!page.archived}));
}
export function pageText(standIn, pageId) {
  const {body} = standIn.handle('GET', `blocks/${pageId}/children`, {}, new URLSearchParams());
  return (body.results || []).map(block => (block[block.type]?.rich_text || []).map(part => part.plain_text || part.text?.content || '').join('')).join('\n');
}
export function writeProfile(standIn, pageId, text) {
  const {status} = standIn.handle('PATCH', `blocks/${pageId}/children`, {children: [{object: 'block', type: 'paragraph', paragraph: {rich_text: [{type: 'text', text: {content: text}}]}}]}, new URLSearchParams());
  if (status !== 200) throw new Error(`the stand-in did not take the Profile text (${status})`);
}

// The engine searches the app started and ended (its app.log, as suites/notion-real.mjs reads them).
export function searches(profile) {
  let lines = [];
  try { lines = appLogLines(profile).filter(line => /\[run\] (start|end): python -m src daily/.test(line)); } catch { /* no log yet */ }
  return {started: lines.filter(line => /\[run\] start:/.test(line)).length, ended: lines.filter(line => /\[run\] end:/.test(line)).length};
}

// Connecting Notion starts the app's first search on this Mac's store; its full sync may mark a seeded match not seen, and the Jobs list then hides it
// (owner's rule, 7 Oct 2026). Not the move's doing: wait for that search (started after `mark`, a searches() taken before the connect) to end, then
// expect the jobs the store still shows: a match it marked not seen or dismissed leaves `before.jobs` (CI, 9 Oct 2026: Orrin AG, both stores; as mac-48's
// notion-real does). A search that never starts within startMs changes nothing. matches: the store's match list (ctx.data('matches', 'list')).
export async function afterFirstSearch(profile, mark, before, matches, {startMs = 60000, endMs = 240000, sleep = ms => new Promise(r => setTimeout(r, ms))} = {}) {
  const begun = Date.now();
  while (searches(profile).started <= mark.started) {
    if (Date.now() - begun > startMs) { console.log('  no search started after the connect: the expected screens stay as they were'); return before; }
    await sleep(1000);
  }
  while (searches(profile).ended < searches(profile).started) {
    if (Date.now() - begun > endMs) throw new Error(`the first search after the connect did not end within ${endMs / 1000} s`);
    await sleep(2000);
  }
  const list = await matches();
  const hidden = list.filter(match => /not seen|dismissed/i.test(match.status || '')).map(match => match.company);
  if (hidden.length) console.log(`  the first search marked ${JSON.stringify(hidden)} not seen: the Jobs list hides them, as it should`);
  return {...before, jobs: before.jobs.filter(company => !hidden.includes(company))};
}
