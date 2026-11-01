// The verdicts of "Confirmed offline" (owner, 14 Oct 2026): a landed fix or a regression row judged from replays of ONE recording, never from a live run. Pure: no browser, no git.
// A replay counts only when it is on the recording (every ask the build makes answered, none extra, every site request served: replay-records.mjs isSame) and its CONTROL holds: the recording replayed on
// its own build comes out as live did (same asks, same outcome), so a difference later is the build's, not the replay's noise. Two agreeing replays are needed (owner, 11 Oct 2026:
// one clean run was luck). Anything else is "live": a fix that changes the route or the asks goes off the recording, and only a live run can say. Guard: e2e/test/verify-judge.test.mjs.
import {rank} from './record-sites.mjs';
import {onOwnAsks} from './own-asks.mjs';

export const VERDICTS = {confirmed: 'Confirmed offline', holds: 'Holds offline', notbetter: 'Not better offline', live: 'Needs a recording', ours: 'Our build', site: 'Site changed'};

// A replay record ({outcome, liveOutcome, live: {asks}, network}) -> on the recording (the replay-records.mjs isSame rule, stated again to keep this file pure).
export const onRecording = rec => !!(rec?.outcome && onOwnAsks(rec.network, rec.live?.asks));

// How outcome `a` compares with `b`: 1 further (a step later, more filled, fewer left), 0 the same, -1 less far, null when either side is missing.
export function compare(a, b) {
  if (!a || !b || rank(a.reached) < 0 || rank(b.reached) < 0) return null;
  if (rank(a.reached) !== rank(b.reached)) return rank(a.reached) > rank(b.reached) ? 1 : -1;
  const fill = (a.filled ?? 0) - (b.filled ?? 0), left = ((b.left ?? 0) - (b.slotsLeft ?? 0)) - ((a.left ?? 0) - (a.slotsLeft ?? 0));   // an optional upload slot left is not a left field (lib/upload-slots.mjs)
  if (fill < 0 || left < 0) return -1;
  return fill > 0 || left > 0 ? 1 : 0;
}

// The control: the recording replayed on its own build reproduces live (same asks, same outcome). -> '' or the reason it does not.
export function controlWhy(control) {
  if (!control) return 'the recording did not replay on its own build';
  if (!onRecording(control)) return 'the recording does not replay as live on its own build';
  return compare(control.outcome, control.liveOutcome) === 0 ? '' : 'its own build replays to another outcome than live';
}

// Two replays that agree and are both on the recording: -> {outcome, why}; why says what is wrong when not.
function agreed(runs) {
  const [a, b] = runs || [];
  if (!a || !b) return {why: 'fewer than two replays'};
  if (!onRecording(a) || !onRecording(b)) return {why: 'the build asks or fetches what the recording lacks'};
  return compare(a.outcome, b.outcome) === 0 ? {outcome: a.outcome} : {why: 'two replays disagree'};
}

// A fix landed at `landedAt`: the recording made before it is live's "before"; the build with the fix (main) replayed twice is "after".
// A recording made AFTER the fix (owner, 15 Oct 2026) has no live "before": `before` is the same recording replayed on the build just before the fix, and "after" must go further than it.
// {recordedAt, landedAt, control, runs (main's two replays), before (older build's replay, only for a recording after the fix)} -> {verdict, why}.
export function judgeFixed({recordedAt, landedAt, control, runs, before}) {
  if (!recordedAt) return {verdict: 'live', why: 'no recording of this row'};
  const after = Date.parse(recordedAt) >= Date.parse(landedAt);
  const bad = controlWhy(control);
  if (bad) return {verdict: 'live', why: bad};
  if (after && !onRecording(before)) {
    // The build before the fix replayed but asks or fetches what the recording lacks: the fix changes what the AI is asked, so before/after cannot be told offline. If today's build (main, twice) still matches live on the
    // recording, that is "Holds offline" (owner, 15 Oct 2026), apart from "Confirmed offline". A before that failed for any other reason (no replay, no outcome) never holds.
    if (before?.outcome) {
      const pair = agreed(runs);
      if (pair.outcome && compare(pair.outcome, control.liveOutcome) === 0) return {verdict: 'holds', why: "the fix changes what the AI is asked, so the build before it can't run on this recording; today's build still matches live"};
      // today's build is the one off: it asks something the kept answers lack (main's prompts moved since the recording), or its two replays differ, or it ends elsewhere than live: re-record on today's build
      return {verdict: 'live', why: pair.outcome ? "today's build ends elsewhere than live on this recording" : `today's build: ${pair.why}; re-record it on today's build`};
    }
    return {verdict: 'live', why: before ? 'the build before the fix gave no result on this recording' : 'the recording did not replay on the build before the fix'};
  }
  const pair = agreed(runs);
  if (!pair.outcome) return {verdict: 'live', why: pair.why};
  const base = after ? before.outcome : control.liveOutcome, against = compare(pair.outcome, base), what = after ? 'the build before the fix did on the same recording' : 'the live run did';
  if (against > 0) return {verdict: 'confirmed', why: `replay of the recording with the fix goes further than ${what} (${pair.outcome.reached}, ${pair.outcome.filled ?? '?'} filled)`};
  return {verdict: 'notbetter', why: against < 0 ? `replay with the fix goes less far than ${what}` : `replay with the fix ends where ${what}`};
}

// A row that got less far: `control` replays the NEWEST recording on its own build; `runs` the same recording on the older build that got further.
// {control, runs} -> {verdict: 'ours' | 'site' | 'live', why}.
export function judgeRegression({control, runs}) {
  const bad = controlWhy(control);
  if (bad) return {verdict: 'live', why: bad};
  const pair = agreed(runs);
  if (!pair.outcome) return {verdict: 'live', why: pair.why};
  const against = compare(pair.outcome, control.liveOutcome);
  if (against > 0) return {verdict: 'ours', why: 'the older extension gets further on the same recording'};
  return {verdict: 'site', why: 'the older extension stops where the newer one does on the same recording'};
}

// The build of a recording: its stamped extension version when the log has one, else the last main commit before it was made (the page says which).
// versions: [{version: '0.9.412', hash, at}] oldest first; commits: [{hash, at}] oldest first. -> {commit, by: 'version' | 'time'} or null.
export function buildOf({log = '', startMs, versions = [], commits = []}) {
  const stamped = String(log).match(/"version"\s*:\s*"(\d+\.\d+\.\d+)"/)?.[1], hit = stamped && versions.findIndex(item => item.version === stamped);
  if (stamped && hit >= 0) {
    const from = Date.parse(versions[hit].at), until = Math.min(startMs, hit + 1 < versions.length ? Date.parse(versions[hit + 1].at) : Infinity);
    const inside = commits.filter(item => Date.parse(item.at) >= from && Date.parse(item.at) <= until).at(-1);
    return {commit: (inside || versions[hit]).hash, by: 'version'};
  }
  const before = commits.filter(item => Date.parse(item.at) <= startMs).at(-1);
  return before ? {commit: before.hash, by: 'time'} : null;
}
