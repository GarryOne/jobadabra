// Job: run the backbone
/* global document, window */
// Settings → Data & backup → Automatic backup, end to end (Mac, Linux and Windows suites): "Back up now" writes a backup with no keys file into the
// folder the harness names (never the owner's iCloud Drive or Documents), "View backups" opens that folder, the app backs up once when it starts due and
// once on the weekly tick (no double run), and the backup file brings the user's files back through Import. Used by e2e/suites/settings.mjs.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {pollUntil} from './wait-on-state.mjs';
import {tar} from '../../lib/tar.js';
import {execFileSync} from 'node:child_process';
import {appLogLines, logCursor} from './app-log.mjs';

const MARKER = 'sk-e2e-backup-marker-7f3a91c2';
const slash = text => String(text).replace(/\\/g, '/');
const backupsIn = dir => fs.readdirSync(dir).filter(name => name.startsWith('Job Pilotto backup ') && name.endsWith('.tar.gz'));
const savedSince = (ctx, why) => logCursor(ctx.profile, new RegExp(`\\[data\\] backup saved${why ? `.*"decidedBy":"${why}"` : ''}`));
const ticksSince = ctx => logCursor(ctx.profile, /\[data\] backup not due.*"decidedBy":"weekly tick"/);
// Why (29 Oct 2026, st): main's calm p95 for the timer step is 20.2 s; 65 s catches hangs on slow runners.
const TIMER_CAP_MS = 65000;

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
  await page.waitForFunction(() => { const text = document.getElementById('backup-last')?.textContent; return text?.trim() && !/None yet/.test(text); }, null, {timeout: 60000});
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
  const {value: opened} = await pollUntil(() => ctx.app.evaluate(() => globalThis.openedPath), value => !!value, {capMs: 90000, log: () => {}});
  if (!opened) throw new Error('View backups opening its folder never finished');
  if (!opened || slash(path.resolve(opened)) !== slash(dir)) throw new Error(`View backups should open ${dir}, it opened ${opened}`);
}

// Due at the app's start -> one backup; the tick afterwards finds it done; a week later the tick backs up once more.
export async function backupTimerStep(ctx) {
  const dir = checkFolder(ctx);
  fs.rmSync(dir, {recursive: true, force: true});
  const initialAt = '';
  await ctx.page.evaluate(at => window.pilot.saveSettings({lastBackupAt: at}), initialAt);
  const saved = savedSince(ctx), startupSaved = savedSince(ctx, 'due at start');
  await ctx.relaunch({JOB_PILOTTO_E2E_BACKUP_TICK: '1500'});   // a tick every 1.5 s instead of every 6 hours
  const wait = async (test, what) => {
    try {
      const {value} = await pollUntil(test, value => !!value, {capMs: TIMER_CAP_MS, log: () => {}});
      if (!value) throw new Error(`${what} never finished`);
    } catch (error) {
      throw new Error(`${error.message}; the app said: ${appLogLines(ctx.profile).filter(line => /\[data\]|backup/i.test(line)).slice(-4).map(line => line.slice(0, 200)).join(' | ') || 'nothing about a backup'}`);
    }
  };
  await wait(() => startupSaved() > 0, 'a backup that was due when the app started');
  const startupTicks = ticksSince(ctx);
  await wait(() => startupTicks() >= 3, 'three tick decisions after the start-up backup');
  if (saved() !== 1) throw new Error(`a due backup should run once at start and not again on the ticks, it ran ${saved()} times`);
  if (backupsIn(dir).length !== 1) throw new Error(`one backup file expected after the start, found ${backupsIn(dir).length}`);
  const at = await ctx.page.evaluate(async () => (await window.pilot.backupStatus()).at);
  if (at === initialAt || !Number.isFinite(Date.parse(at))) throw new Error(`"Last backup" was not written by the start-up backup (${at})`);

  const weeklySaved = savedSince(ctx, 'weekly tick');
  const backdated = await ctx.page.evaluate(async week => {
    const at = new Date(Date.now() - week).toISOString();
    await window.pilot.saveSettings({lastBackupAt: at});
    return at;
  }, 8 * 24 * 3600 * 1000);
  await wait(() => weeklySaved() > 0, 'a backup a week old on the weekly tick');
  const weeklyTicks = ticksSince(ctx);
  await wait(() => weeklyTicks() >= 2, 'two tick decisions after the weekly backup');
  if (weeklySaved() !== 1 || saved() !== 2) throw new Error(`the weekly tick should back up once, it did ${weeklySaved()} times (${saved()} backups total)`);
  const fresh = await ctx.page.evaluate(async () => (await window.pilot.backupStatus()).at);
  if (fresh === backdated || !Number.isFinite(Date.parse(fresh))) throw new Error(`the tick's backup did not write "Last backup" (${fresh})`);
}

// A backup file left in the folder by "Back up now" (the file the restore step imports).
export async function makeBackupFile(ctx) {
  checkFolder(ctx);
  const done = await ctx.page.evaluate(() => window.pilot.backupNow());
  if (!done.ok) throw new Error(`Back up now failed: ${done.error}`);
  return done.file;
}
