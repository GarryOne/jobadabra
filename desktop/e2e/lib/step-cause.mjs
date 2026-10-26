// One cause, many red steps (gate G3, owner's yes 26 Oct 2026): a failed step's note → its cause in one line, and the causes several steps share. Pure.
// Why: in beta 1 (25 Oct 2026) six cardstates steps failed on "locator.click: Timeout 30000ms exceeded." and every summary showed only that line, six times.
// The locator sat in a multi-line call log: all six clicked `#activity-recent li:not(.recent-group) button` (only .first()/.nth(n) differed), one cause that
// hid the five real failures beta 2 then showed, a 45-minute beta later. Now the summary says the cause once: "one cause, 6 steps: click on <locator>".
// Used by lib/runner.mjs (each failed result gets `cause`; the suite's end lists shared causes).
// Tests: test/step-cause.test.mjs

const ACTION = /^(?:[\w.]+\.)?(\w+): Timeout (\d+)\s?ms exceeded/;   // Playwright: "locator.click: Timeout 30000ms exceeded." / "page.waitForSelector: …"
const WAITING = /waiting for (locator\(.*|getBy\w+\(.*|frameLocator\(.*)$/m;
// The last state Playwright saw before giving up, in plain words.
const REASONS = [
  [/intercepts pointer events/, 'another element covers it'],
  [/element is not visible/, 'not visible'],
  [/element is not enabled/, 'disabled'],
  [/element is not stable/, 'still moving'],
  [/element is outside of the viewport/, 'outside the window'],
  [/locator resolved to/, ''],
];

// .first(), .last(), .nth(7) at the end pick one of the same set: the same cause.
const baseLocator = text => text.trim().replace(/ to be \w+$/, '').replace(/(?:\.(?:first|last)\(\)|\.nth\(\d+\))+$/, '');

// note (the runner's failed-step note, Playwright's call log included) → {key, text}. key: what steps share; text: one line for a person.
export function causeOf(note = '') {
  const text = String(note || '');
  const first = text.split('\n')[0].trim();
  if (/^not run: the suite was over its/.test(first)) return {key: 'budget', text: first};
  const action = ACTION.exec(first.replace(/^.*?: (?=[\w.]+: Timeout)/, ''));
  const waiting = WAITING.exec(text);
  if (action && waiting) {
    const locator = baseLocator(waiting[1]);
    const reason = REASONS.find(([pattern]) => pattern.test(text.slice(waiting.index)));
    const why = reason ? (reason[1] || 'found, never ready') : 'never found';
    return {key: `${action[1]} ${locator}`, text: `${action[1]} on ${locator}: ${why} (gave up after ${Math.round(Number(action[2]) / 1000)} s)`};
  }
  const whole = text.replace(/\s+/g, ' ').trim();   // any other failure: its own words, all of them (two asserts that differ after their first line are two causes)
  return {key: whole, text: whole};
}

// The causes two or more failed steps share, largest first: [{cause, steps: [names]}].
export function sharedCauses(results = []) {
  const groups = new Map();
  for (const result of results) {
    if (result.status !== 'failed') continue;
    const {key, text} = result.cause ? {key: result.cause.key, text: result.cause.text} : causeOf(result.note);
    if (!key) continue;
    const group = groups.get(key) || {cause: text, steps: []};
    group.steps.push(result.name);
    groups.set(key, group);
  }
  return [...groups.values()].filter(group => group.steps.length > 1).sort((a, b) => b.steps.length - a.steps.length);
}

// One line per shared cause, for the log.
export const sharedCauseLines = results => sharedCauses(results).map(({cause, steps}) =>
  `⚠ one cause, ${steps.length} steps: ${cause}. Fix it first: these steps stopped there, so their own checks never ran.`);
