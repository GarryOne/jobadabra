// Where a click on a notification (macOS / Windows) or an in-window pop-up leads (pure, no DOM: main.js checks a target, the window follows it). A target is plain data with fixed keys, checked here before
// it reaches the window, so what a notification carries can only ever open a page, a section, a run's result or a job's row, never run anything:
//   {view: 'jobs'}                      a page (the data-view names of index.html)
//   {view: 'settings', section: 'profile'}   a page's section
//   {run: 123}                          a finished task's result: Recent activity with that run selected
//   {activity: true}                    Recent activity, as it is
//   {view: 'jobs', job: 'abc123'}       a job's row on a page (its code, else its address), scrolled to and flashed
//   {view: 'sessions', session: 'a094bc8f'}   an application session's card, selected (owner, 8 Oct 2026: "Filling the application…" opened the list only)
//   {card: 'license'}                   a card by its id (setting-<id> or <id>, on any page): its page opens, it scrolls into view and glows (pages/settings.js openSetting)
// Every pop-up names its target, or one of NO_PLACE below (owner, 27 Oct 2026: "on clicking on any notification, it should forward/redirect us and
// highlight a specific section/screen/card"). test/toast-targets.test.js fails on a call with neither.
export const VIEWS = ['actions', 'calendar', 'focus', 'interviews', 'jobs', 'sessions', 'settings', 'strategy'];
export const SECTIONS = ['overview', 'profile', 'connections', 'automation', 'data', 'license', 'advanced', 'appearance'];
// Why a pop-up opens nothing: a string a click ignores (clean() keeps no string). Only these, so the reason is one of a few, said once.
export const NO_PLACE = Object.freeze({
  outside: 'about Chrome, a saved file or another app: nothing in this window shows it',
  done: 'a thank-you or a copy to the clipboard: nothing more to see',
  app: 'about the app itself (restart, update, quit): its button is the way on',
  itself: 'the pop-up is the detail (a row\'s Details): nothing else to open',
});

// A job's row on Jobs (its code, else its address): the place of every pop-up about one job.
export const jobPlace = job => ({view: 'jobs', job: job?.code || job?.url || ''});
// An application session's card on Applying: the place of every pop-up about one session.
export const sessionPlace = item => ({view: 'sessions', session: item?.id || ''});

// -> a safe copy of the target, or null when it says nothing the window can open.
export function clean(target) {
  if (!target || typeof target !== 'object') return null;
  const out = {};
  if (VIEWS.includes(target.view)) out.view = target.view;
  if (out.view === 'settings' && SECTIONS.includes(target.section)) out.section = target.section;
  if (Number.isFinite(Number(target.run)) && target.run !== null && target.run !== '') out.run = Number(target.run);
  if (target.activity === true) out.activity = true;
  if (typeof target.job === 'string' && target.job.trim()) out.job = target.job.trim().slice(0, 300);
  if (typeof target.session === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(target.session)) out.session = target.session;
  if (typeof target.card === 'string' && /^[a-z][a-z0-9-]{0,63}$/.test(target.card)) out.card = target.card;
  return Object.keys(out).length ? out : null;
}

// -> the steps the window takes, in order (pure, so the order is tested): 'run:123', 'activity', 'view:jobs', 'section:profile', 'job:abc', 'card:license'.
export function plan(target) {
  const t = clean(target);
  if (!t) return [];
  return [...(t.run !== undefined ? [`run:${t.run}`] : t.activity ? ['activity'] : []), ...(t.view ? [`view:${t.view}`] : []),
    ...(t.section ? [`section:${t.section}`] : []), ...(t.job ? [`job:${t.job}`] : []), ...(t.session ? [`session:${t.session}`] : []),
    ...(t.card ? [`card:${t.card}`] : [])];
}
