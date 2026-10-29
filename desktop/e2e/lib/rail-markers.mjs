/* global document, requestAnimationFrame */
// The icon rail's badges and dots (owner, 17 Oct 2026): each sits inside its 48px button and clear of the icon. Runs in the e2e interactions suite (CI, real window) and test/rail-badges.test.js.
// Job: wait on state

/** Prepare the probe's rail mode (also at laptop zoom), then wait for that state and two frames before measuring. */
export async function waitForRail(page) {
  await page.evaluate(() => document.querySelector('.app').classList.add('rail'));
  await page.waitForFunction(() => {
    if (!document.querySelector('.app.rail')) return false;
    return new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve(!!document.querySelector('.app.rail')))));
  }, null, {timeout: 10000});
}

export const probe = () => {
  document.querySelector('.app').classList.add('rail');
  const set = (id, text) => { const n = document.getElementById(id); n.hidden = false; n.textContent = text; };
  set('nav-jobs-badge', '99+'); set('nav-applying-badge', '6');
  document.querySelectorAll('.nav .nav-dot').forEach(d => { d.hidden = false; });
  document.querySelectorAll('#nav-reports, #nav-interviews, #nav-employers').forEach(n => { n.hidden = false; });
  const box = e => { const r = e.getBoundingClientRect(); return {l: r.left, t: r.top, r: r.right, b: r.bottom}; };
  return [...document.querySelectorAll('.nav')].filter(n => n.offsetParent).flatMap(n => [...n.querySelectorAll('.nav-badge:not([hidden]), .nav-dot:not([hidden])')]
    .map(mark => ({view: n.dataset.view, button: box(n), icon: box(n.querySelector('.icon')), mark: box(mark)})));
};

// What is wrong with the measured markers, one sentence each (empty: all fine).
export function problems(marks) {
  if (marks.length < 6) return [`only ${marks.length} badges and dots found in the rail`];
  const out = [];
  for (const {view, button, icon, mark} of marks) {
    if (!(mark.l >= button.l && mark.r <= button.r && mark.t >= button.t && mark.b <= button.b)) out.push(`${view}: a marker sticks out of its button`);
    if (mark.l < icon.r && mark.r > icon.l && mark.t < icon.b && mark.b > icon.t) out.push(`${view}: a marker covers the icon`);
  }
  return out;
}
