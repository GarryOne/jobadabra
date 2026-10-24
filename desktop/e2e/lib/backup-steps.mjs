/* global document, window */
// Settings → Data & backup → Automatic backup, end to end (Mac, Linux and Windows suites): "Back up now" writes a backup with no keys file into the
// folder the harness names (never the owner's iCloud Drive or Documents), "View backups" opens that folder, the app backs up once when it starts due and
// once on the weekly tick (no double run), and the backup file brings the user's files back through Import. Used by e2e/suites/settings.mjs.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {tar} from '../../lib/tar.js';
import {execFileSync} from 'node:child_process';
import {appLogLines} from './app-log.mjs';

const MARKER = 'sk-e2e-backup-marker-7f3a91c2';
const slash = text => String(text).replace(/\\/g, '/');
const backupsIn = dir => fs.readdirSync(dir).filter(name => name.startsWith('Job Pilotto backup ') && name.endsWith('.tar.gz'));
const saved = (ctx, why) => appLogLines(ctx.profile).filter(line => line.includes('[data] backup saved') && (!why || line.includes(`"decidedBy":"${why}"`))).length;

function checkFolder(ctx) {
  const dir = path.resolve(ctx.backupDir);
  if (!slash(dir).startsWith(slash(path.resolve(os.tmpdir())))) throw new Error(`the backup folder ${dir} is not under the temp folder: a test must never back up into the owner's folders`);
  return dir;
}

// Back up now -> one file in the folder -> nothing secret in it -> View backups opens the folder.
export async function backupNowStep(ctx) {
  const {page} = ctx, dir = checkFolder(ctx);
  fs.rmSync(dir, {recursive: true, force: true});
  await page.evaluate(marker => window.pilot.saveSecret('OPENAI_API_KEY', marker), MARKER);
  await page.click('.nav[data-view="settings"]:not([data-settings="profile"])');
  await page.click('[data-settings-go="data"]');
  await page.click('#backup-now');
  await page.waitForFunction(() => /Backed up ✓|Backup failed/.test(document.getElementById('data-message')?.textContent || ''), null, {timeout: 60000});
  const said = await page.locator('#data-message').textContent();
  if (!/Backed up ✓/.test(said)) throw new Error(`Back up now did not work: "${said}"`);
  const files = backupsIn(dir);
  if (files.length !== 1) throw new Error(`Back up now should leave one backup file in the folder, found ${files.length}: ${files.join(', ')}`);
  const file = path.join(dir, files[0]);
  // The message names the file, not its folder (the folder path has the person's name in it: pages/data.js savedLine, 21 Oct 2026).
  if (!said.includes(path.basename(file))) throw new Error(`the message does not name the file: "${said}"`);
  if (slash(said).includes(slash(dir))) throw new Error(`the message writes the folder path: "${said}"`);
  const last = await page.locator('#backup-last').textContent();
  if (/None yet/.test(last)) throw new Error('"Last backup" still says None yet after a backup');
  if (!(await page.locator('#backup-where').textContent()).trim()) throw new Error('the Location line is empty');

  // Unpacked here the way the product unpacks an import (lib/tar.js: Windows' own tar).
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-e2e-backup-open-'));
  execFileSync(tar(), ['-xzf', file, '-C', out]);
  const names = fs.readdirSync(out, {recursive: true}).map(slash);
  for (const left of ['keys.json', 'accounts.json']) if (names.some(name => name.split('/').pop() === left)) throw new Error(`the backup holds ${left}: keys must never be in it`);
  if (!names.some(name => /(^|\/)manifest\.json$/.test(name))) throw new Error('the backup has no manifest: it is not a Jobadabra export');
  const leaked = names.filter(name => fs.statSync(path.join(out, name)).isFile() && fs.readFileSync(path.join(out, name)).includes(MARKER));
  if (leaked.length) throw new Error(`a saved key's value is readable in the backup: ${leaked.join(', ')}`);
  fs.rmSync(out, {recursive: true, force: true});

  // View backups: the app asks the system to open that folder (stood in for: no Finder or Explorer window).
  await ctx.app.evaluate(({shell}) => { globalThis.openedPath = null; shell.openPath = async target => { globalThis.openedPath = target; return ''; }; });
  await page.click('#backup-show');
  let opened = null;
  for (let i = 0; i < 20 && !opened; i++) opened = await ctx.app.evaluate(() => globalThis.openedPath) || (await page.waitForTimeout(250), null);
  if (!opened || slash(path.resolve(opened)) !== slash(dir)) throw new Error(`View backups should open ${dir}, it opened ${opened}`);
}

// Due at the app's start -> one backup; the tick afterwards finds it done; a week later the tick backs up once more.
export async function backupTimerStep(ctx) {
  const dir = checkFolder(ctx);
  fs.rmSync(dir, {recursive: true, force: true});
  await ctx.page.evaluate(() => window.pilot.saveSettings({lastBackupAt: ''}));
  const before = saved(ctx);
  await ctx.relaunch({JOB_PILOTTO_E2E_BACKUP_TICK: '1500'});   // a tick every 1.5 s instead of every 6 hours
  const wait = async (test, what) => { for (let i = 0; i < 60; i++) { if (test()) return; await ctx.page.waitForTimeout(250); } throw new Error(`${what}; the app said: ${appLogLines(ctx.profile).filter(line => /\[data\]|backup/i.test(line)).slice(-4).map(line => line.slice(0, 200)).join(' | ') || 'nothing about a backup'}`); };   // a start that never backed up says why (Linux run 12, 24 Oct: the step's own log was overwritten by the later steps)
  await wait(() => saved(ctx, 'due at start') > 0, 'a backup that was due did not run when the app started');
  await ctx.page.waitForTimeout(5000);   // three ticks: none of them may back up again
  if (saved(ctx) - before !== 1) throw new Error(`a due backup should run once at start and not again on the ticks, it ran ${saved(ctx) - before} times`);
  if (backupsIn(dir).length !== 1) throw new Error(`one backup file expected after the start, found ${backupsIn(dir).length}`);
  const at = await ctx.page.evaluate(async () => (await window.pilot.backupStatus()).at);
  if (!at || Date.now() - Date.parse(at) > 120000) throw new Error(`"Last backup" was not written by the start-up backup (${at})`);

  await ctx.page.evaluate(week => window.pilot.saveSettings({lastBackupAt: new Date(Date.now() - week).toISOString()}), 8 * 24 * 3600 * 1000);
  await wait(() => saved(ctx, 'weekly tick') > 0, 'a backup a week old was not made on the weekly tick');
  await ctx.page.waitForTimeout(4000);
  if (saved(ctx, 'weekly tick') !== 1) throw new Error(`the weekly tick should back up once, it did ${saved(ctx, 'weekly tick')} times`);
  const fresh = await ctx.page.evaluate(async () => (await window.pilot.backupStatus()).at);
  if (Date.now() - Date.parse(fresh) > 120000) throw new Error(`the tick's backup did not write "Last backup" (${fresh})`);
}

// A backup file left in the folder by "Back up now" (the file the restore step imports).
export async function makeBackupFile(ctx) {
  checkFolder(ctx);
  const done = await ctx.page.evaluate(() => window.pilot.backupNow());
  if (!done.ok) throw new Error(`Back up now failed: ${done.error}`);
  return done.file;
}
