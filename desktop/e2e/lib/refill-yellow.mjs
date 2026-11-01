// The refill's yellow state (owner, 17 Oct 2026): rows whose live site moved need a re-record; they are listed, never a red run. Merges the groups' --report files, words the one Telegram message, tells whether the set changed. Guard: e2e/test/refill-yellow.test.mjs.
import {alertHtml} from './telegram-html.mjs';

// ([group report: {published, rerecord: [{row, why}], hard}]) -> {published: n, rerecord: [{row, why}] sorted by row}
export function merge(reports) {
  const rerecord = new Map();
  let published = 0;
  for (const one of reports.filter(Boolean)) { published += (one.published || []).length; for (const {row, why} of one.rerecord || []) rerecord.set(row, why); }
  return {published, rerecord: [...rerecord].map(([row, why]) => ({row, why})).sort((a, b) => a.row.localeCompare(b.row))};
}

// Same rows as the run before: no new alert (a merge does not re-tell what the owner knows). previous: that run's merged answer, or null.
export const sameSet = (now, previous) => !!previous && now.rerecord.map(one => one.row).join('\n') === (previous.rerecord || []).map(one => one.row).join('\n');

const short = why => String(why).replace(/\s+/g, ' ').replace(/\(asks answered.*$/, '').trim().slice(0, 110);

// -> the summary line, as in the job log
export const line = merged => `🟡 Refill: ${merged.published} published, ${merged.rerecord.length} need a re-record: ${merged.rerecord.map(one => `${one.row} (${short(one.why)})`).join('; ')}`;

// -> a Telegram message (lib/telegram-html.mjs); run: the run's URL
export const message = (merged, run) => alertHtml({icon: '🟡', title: 'Replay refill', verdict: `${merged.published} published, ${merged.rerecord.length} need a re-record`,
  bullets: merged.rerecord.map(one => ({label: one.row, parts: [short(one.why)]})), links: [{text: 'Open run', url: run}]});
