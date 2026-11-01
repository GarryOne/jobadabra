// The replay's page clock (14 Oct 2026): the page sees the live run's DATE (Date, Date.now) flowing from the record's start, while its timers stay real,
// and the live run's TIME ZONE (zoneOf: a runner in UTC showed Databricks' OneTrust banner that the Zurich live run and the Mac replay never drew, 1/8 vs 8/8).
// Playwright's clock.install also fakes setTimeout/setInterval/requestAnimationFrame: Databricks' OneTrust banner then showed on the replay (never live) and every
// AI ask after it missed (0/8); with real timers it replays 8/8 as live. Guard: e2e/test/replay-date.test.mjs. Used by replay-net.mjs.

// The script the page runs first: Date shifted by a fixed offset (computed once in node, so time flows on across pages and frames), nothing else touched.
export function dateShiftScript({offset}) {
  const Real = Date;
  if (Real.__jpShifted) return;
  class Shifted extends Real {
    constructor(...args) { if (args.length === 0) super(Real.now() + offset); else super(...args); }
    static now() { return Real.now() + offset; }
  }
  Object.defineProperty(Shifted, '__jpShifted', {value: true});
  globalThis.Date = Shifted;
}

// Shifts every page and frame of the context to the record's start time (ms). -> the offset in ms.
export async function shiftDate(context, startMs, now = Date.now()) {
  const offset = Math.round(startMs - now);
  await context.addInitScript(dateShiftScript, {offset});
  return offset;
}

// The machine's own time zone (an IANA name), saved in each record by lib/live-row.mjs.
export const hereZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || '';
// The record's live time zone, or '' (a record made before 14 Oct 2026 from CI, or a value that is not an IANA name): replay-net.mjs sets TZ to it,
// so the browser, its pages and the extension read the live run's zone. -> 'Europe/Zurich' | ''
export const zoneOf = record => (typeof record?.timezone === 'string' && /^[A-Za-z]+(?:\/[A-Za-z0-9_+-]+)*$/.test(record.timezone) ? record.timezone : '');
// A Mac record made before the zone was saved gets the publishing Mac's own (records-publish.mjs publishes this Mac's records only; the oldest have no
// "where" either): never a record marked 'ci'. -> the record, stamped or as it was
export const stampZone = (record, zone = hereZone()) => (record && !zoneOf(record) && record.where !== 'ci' && zone ? {...record, timezone: zone} : record);
