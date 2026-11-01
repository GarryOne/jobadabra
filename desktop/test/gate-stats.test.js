// The push-gate counts for /admin/operations/agent-coding (tools/gate-stats.mjs) and the once-a-day upload (tools/gate-stats-upload.mjs): classes, no text leaves, the stamp, best effort.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import {byDay, classOf, parseHookLog, parseLog, stoppedAs} from '../../tools/gate-stats.mjs';
import {upload} from '../../tools/gate-stats-upload.mjs';

const LOG = `# 2026-10-30T10:00:00Z push gate total=40s branch=secret-branch-name
1 0 file size
2 1 spec proof
30 0 desktop (clean checkout)
# 2026-10-30T10:01:00Z heavy lock run=5s wait=0s exit=0 what=e2e-smoke class=proof branch=other-branch
# 2026-10-31T09:00:00Z push gate total=90s SLOW branch=another
3 0 file size
80 1 python (clean checkout)
1 1 spec proof
# 2026-10-31T11:00:00Z push gate total=10s branch=x
1 0 workflow paths ci.yml
2 0 file size
# 2026-10-31T12:00:00Z push gate total=20s branch=y
5 1 some unknown check
# 2026-09-01T12:00:00Z push gate total=99s branch=old
1 1 file size
`;
const now = new Date('2026-11-01T12:00:00Z');

test('a push is form when only form checks failed, real when a suite did, other for anything else, null when none', () => {
  const [a, b, c, d] = parseLog(LOG);
  assert.equal(stoppedAs(a), 'form');
  assert.equal(stoppedAs(b), 'real');
  assert.equal(stoppedAs(c), null);
  assert.equal(stoppedAs(d), 'other');
  assert.deepEqual([classOf('file size'), classOf('journey gate'), classOf('x')], ['form', 'real', 'other']);
});

test('per day: pushes, stopped by class with their seconds, per check runs/stops/seconds; lock lines are not pushes; old days are dropped', () => {
  const days = byDay(parseLog(LOG), {now});
  assert.deepEqual(days.map(day => day.day), ['2026-10-30', '2026-10-31']);
  const last = days[1];
  assert.equal(last.pushes, 3);
  assert.deepEqual(last.stopped, {form: 0, real: 1, other: 1});
  assert.deepEqual(last.stoppedSecs, {form: 0, real: 90, other: 20});
  assert.deepEqual(last.steps['file size'], {runs: 2, fails: 0, secs: 5, cls: 'form'});
  assert.ok(last.steps['workflow paths'], 'the workflow name is cut off the label');
  assert.equal(days[0].steps['spec proof'].fails, 1);
});

test('nothing but counts, seconds and check labels is in what is sent: no branch name', () => {
  assert.ok(!JSON.stringify(byDay(parseLog(LOG), {now})).includes('branch'));
  assert.ok(!JSON.stringify(byDay(parseLog(LOG), {now})).includes('secret'));
});

const seams = (extra = {}) => {
  const state = {stamps: {}, sent: []};
  return {state, args: {log: '/log', stampFile: '/stamp', now, read: path => (path === '/log' ? LOG : state.stamps[path] || ''), has: path => path === '/log' || path in state.stamps, key: async () => 'k',
    send: async (body, key) => { state.sent.push({body, key}); return 200; }, writeStamp: (file, text) => { state.stamps[file] = text; }, ...extra}};
};

test('it sends once a day: the stamp is written after an ok answer, and a second call the same day sends nothing', async () => {
  const {state, args} = seams();
  assert.equal(await upload(args), 'sent');
  assert.equal(JSON.parse(state.sent[0].body).kind, 'gate');
  assert.equal(state.sent[0].key, 'k');
  assert.equal(await upload(args), 'done-today');
  assert.equal(state.sent.length, 1);
  assert.equal(await upload({...args, force: true}), 'sent');
});

test('a refusal, a dead network, no key or no log never throws and leaves no stamp, so the next ship tries again', async () => {
  for (const [extra, want] of [[{send: async () => 404}, 'refused: 404'], [{send: async () => null}, 'failed'], [{key: async () => ''}, 'no-key'], [{has: () => false}, 'no-log']]) {
    const {state, args} = seams(extra);
    assert.equal(await upload(args), want);
    assert.deepEqual(state.stamps, {});
  }
});

test('GATE_STATS_UPLOAD=0 turns it off', async () => {
  process.env.GATE_STATS_UPLOAD = '0';
  try { assert.equal(await upload(seams().args), 'off'); } finally { delete process.env.GATE_STATS_UPLOAD; }
});

test('ship.sh runs the uploader as its very last step, only when asked to, and never lets it change the exit code', () => {
  const ship = readFileSync(new URL('../../tools/ship.sh', import.meta.url), 'utf8');
  assert.match(ship, /trap 'code=\$\?;.*; gate_stats_tail' EXIT/s);
  assert.match(ship, /gate_stats_tail\(\) \{.*GATE_STATS_UPLOAD:-1.*gate-stats-upload\.mjs.*\|\| true/s);
  assert.match(ship, /ship_watch_start "\$review_n".*; gate_stats_tail' EXIT/s, 'the watcher is started before the upload, never after');
});

// Owner's yes, 1 Nov 2026 (layer 0 of the SDLC tab): the agent's hooks log "<date> <label>" per block (~/.claude/hooks/count-blocks.sh); only the four known labels are counted and no other text can leave.
test('hook blocks are counted per day by their four fixed labels; any other line or label is ignored; a day with only blocks still gets a card', () => {
  const blocks = parseHookLog('2026-10-31 session-cap\n2026-10-31 session-cap\n2026-11-01 foreground-long-run\n2026-11-01 some-secret-text here\n2026-11-01 unknown-hook\nnot a line\n');
  assert.equal(blocks.length, 3);
  const days = byDay(parseLog(LOG), {now, hooks: blocks});
  assert.deepEqual(days.find(day => day.day === '2026-10-31').hooks, {'session-cap': 2});
  assert.deepEqual(days.find(day => day.day === '2026-11-01').hooks, {'foreground-long-run': 1});
  assert.equal(days.find(day => day.day === '2026-11-01').pushes, 0);
  assert.ok(!JSON.stringify(days).includes('secret'));
});

test('the upload sends the hook counts with the gate days, and a missing hook log changes nothing', async () => {
  const {state, args} = seams({hookLog: '/hooks', has: path => path === '/log' || path === '/hooks', read: path => (path === '/log' ? LOG : '2026-10-31 background-tee\n')});
  assert.equal(await upload(args), 'sent');
  assert.deepEqual(JSON.parse(state.sent[0].body).days.find(day => day.day === '2026-10-31').hooks, {'background-tee': 1});
  const plain = seams({hookLog: '/none'});
  assert.equal(await upload(plain.args), 'sent');
  assert.ok(!JSON.parse(plain.state.sent[0].body).days.some(day => day.hooks));
});
