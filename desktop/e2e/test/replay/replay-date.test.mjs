// The replay's page clock (lib/replay-date.mjs): the page's Date reads the record's time and flows on; timers are never replaced (a fake setTimeout changed
// Databricks' cookie banner, 14 Oct 2026). Pure: the init script runs in a fresh vm context.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import vm from 'node:vm';
import {dateShiftScript, hereZone, shiftDate, stampZone, zoneOf} from '../../lib/replay-date.mjs';

test('Date reads the record\'s time and flows on; a date with arguments is untouched; timers are the real ones', async () => {
  const sandbox = {setTimeout, Date};
  vm.createContext(sandbox);
  sandbox.globalThis = sandbox;
  const start = Date.parse('2026-10-13T22:13:30Z'), offset = start - Date.now();
  vm.runInContext(`(${dateShiftScript})(${JSON.stringify({offset})})`, sandbox);
  const first = vm.runInContext('Date.now()', sandbox);
  assert.ok(Math.abs(first - start) < 1000, 'now is the record\'s start');
  assert.ok(Math.abs(vm.runInContext('new Date().getTime()', sandbox) - start) < 1000);
  assert.equal(vm.runInContext('new Date(0).getTime()', sandbox), 0, 'an explicit date is kept');
  assert.equal(vm.runInContext('new Date() instanceof Date', sandbox), true);
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.ok(vm.runInContext('Date.now()', sandbox) >= first + 25, 'time flows on');
  assert.equal(sandbox.setTimeout, setTimeout, 'timers are never replaced');
  vm.runInContext(`(${dateShiftScript})(${JSON.stringify({offset: 99999999})})`, sandbox);
  assert.ok(Math.abs(vm.runInContext('Date.now()', sandbox) - start) < 1000, 'a second run (another frame script) does not shift twice');
});

test('shiftDate adds one init script with a fixed offset; replay-net uses it unless asked for fake timers', async () => {
  const added = [];
  const offset = await shiftDate({addInitScript: async (fn, arg) => added.push([fn, arg])}, 5000, 1000);
  assert.equal(offset, 4000);
  assert.deepEqual(added[0][1], {offset: 4000});
  const replay = fs.readFileSync(new URL('../../replay-net.mjs', import.meta.url), 'utf8');
  assert.match(replay, /shiftDate\(run\.context, record\.startMs\)/);
  assert.match(replay, /FAKE_TIMERS \? .*clock\.install/);
});

test('the replay runs in the live run\'s time zone: saved in the record, set as TZ before the browser starts, stamped on old Mac records at publish', () => {
  // 14 Oct 2026: the runner (UTC) showed Databricks' OneTrust banner the Zurich live run never drew (1/8); TZ=UTC on the Mac reproduced it, Zurich 8/8.
  assert.equal(zoneOf({timezone: 'Europe/Zurich'}), 'Europe/Zurich');
  assert.equal(zoneOf({timezone: 'America/Argentina/Buenos_Aires'}), 'America/Argentina/Buenos_Aires');
  for (const bad of [undefined, '', 'Europe/Zurich; rm -rf', 42]) assert.equal(zoneOf({timezone: bad}), '', String(bad));
  assert.match(hereZone(), /^[A-Za-z]/);
  assert.deepEqual(stampZone({where: 'mac', name: 'x'}, 'Europe/Zurich'), {where: 'mac', name: 'x', timezone: 'Europe/Zurich'});
  assert.deepEqual(stampZone({name: 'old'}, 'Europe/Zurich'), {name: 'old', timezone: 'Europe/Zurich'}, 'the oldest Mac records have no "where"');
  const ci = {where: 'ci'}, kept = {where: 'mac', timezone: 'Asia/Tokyo'};
  assert.equal(stampZone(ci, 'Europe/Zurich'), ci, 'a CI record is not stamped with this Mac\'s zone');
  assert.equal(stampZone(kept, 'Europe/Zurich'), kept, 'a saved zone is kept');
  const read = file => fs.readFileSync(new URL(file, import.meta.url), 'utf8');
  const replay = read('../../replay-net.mjs');
  assert.ok(replay.indexOf('process.env.TZ = zoneOf(record)') > 0 && replay.indexOf('process.env.TZ = zoneOf(record)') < replay.indexOf('startRealExtension('), 'TZ is set before the browser starts');
  assert.match(read('../../lib/live-row.mjs'), /timezone: hereZone\(\)/);
  assert.match(replay, /startRealExtension\(\{\.\.\.options, offline: true, timezoneId: zoneOf\(record\)\}\)/, 'the browser\'s own zone setting too (TZ alone did not reach the runner\'s page)');
  assert.match(replay, /pageSees: seen/);
  assert.match(read('../../lib/real-extension.mjs'), /\.\.\.\(timezoneId \? \{timezoneId\} : \{\}\)/);
  assert.match(read('../../records-publish.mjs'), /stampZone\(record\)/);
});
