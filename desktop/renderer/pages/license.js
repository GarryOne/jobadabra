// Settings → Plan: the free allowance ("12 of 20 free applications · 41 days left", one bar per number), also as a small counter in the sidebar, and the friendly
// dialog when the allowance ends (main asks for it, 'allowance' event). No key can be entered any more (17 Oct 2026: the free trial is open to everyone); an install
// that already holds one keeps it: it shows as Founder / Friend and can be removed here (lib/license.js still checks it).
import {$, message} from './core.js';
import {openSetting} from './settings.js';
import {chip} from '../license-chip.js';
import {endedLine} from '../plan-line.js';
import {showProCard} from './plan-waitlist.js';
import {initPlan} from './plan.js';
import {byStore} from '../store-words.js';

const KIND = {founder: 'Founder', friend: 'Friend', pass: 'Pass', pro: 'Pro'};

// The sidebar counter: "12 of 20 applications used" with a thin bar; a click opens Settings → Plan. Hidden for a licensed install.
function showChip(state) {
  const shown = chip(state);
  const button = $('allowance-chip');
  button.hidden = !shown;
  if (!shown) return;
  $('allowance-chip-plan').textContent = shown.plan;
  $('allowance-chip-text').textContent = shown.text;
  button.title = shown.title;
  button.dataset.tone = shown.tone;
  $('allowance-chip-fill').style.width = `${shown.percent}%`;
}

export function showLicense(state) {
  showChip(state);
  const {licensed, ended} = state;
  // Free is named and marked "Your plan" (17 Oct 2026, owner: it must be clear I'm on the free plan); the Pro card beside it is the offer.
  $('license-title').textContent = licensed ? 'Your allowance' : 'Free';
  $('license-pill').textContent = licensed ? (state.license.kind === 'pro' ? 'Pro' : `${KIND[state.license.kind]} key`) : ended ? 'Free period over' : 'Your plan';
  $('license-pill').className = `ui-pill tone-${licensed ? 'good' : ended ? 'warn' : 'good'}`;
  // Same count as the sidebar chip: applications USED, filling, red for the last 5.
  const shown = chip(state);
  $('license-used-label').textContent = licensed ? 'Applications sent' : 'Applications used';
  $('license-used').textContent = licensed ? `${state.used} · no limit` : `${shown.used} of ${state.limit}`;
  // A Pro's second number is its AI credit (owner, 27 Oct 2026): on our AI the credit left, a bar like the sidebar's; on its own AI a full bar, unlimited, and why.
  const pro = state.license?.kind === 'pro', ourAi = pro && !!state.pro?.ourAi;
  const noCredit = state.pro?.hasCredit === false || !state.pro?.creditPercent;
  $('license-days-label').textContent = pro ? 'AI credit' : licensed ? 'Licensed to' : 'Days left';
  $('license-days').textContent = pro ? (ourAi ? shown.text.replace(/^AI credit /, '') + ' left' : 'Unlimited · your own AI') : licensed ? state.license.name : `${state.daysLeft} of 60`;
  $('license-bar').hidden = licensed;
  $('license-days-bar').hidden = licensed && !pro;
  if (pro) {
    $('license-days-bar').firstElementChild.style.width = `${ourAi ? shown.percent : 100}%`;
    $('license-days-bar').dataset.tone = ourAi ? shown.tone : 'good';
  } else if (shown) {
    $('license-bar').firstElementChild.style.width = `${shown.percent}%`;
    $('license-bar').dataset.tone = shown.tone;
    // The days bar fills as the days are used; red when the last 5 are left, like the applications.
    const daysUsed = Math.max(0, Math.min(60, 60 - (state.daysLeft ?? 60)));
    $('license-days-bar').firstElementChild.style.width = `${Math.max(2, Math.round(daysUsed / 60 * 100))}%`;
    $('license-days-bar').dataset.tone = (state.daysLeft ?? 60) <= 5 ? 'bad' : 'info';
  }
  $('license-note').textContent = pro ? (!ourAi ? 'Unlimited: you use your own AI key, so nothing is counted.' : noCredit ? 'No AI credit left: top up, or add a promo code.' : 'No end date.')
    : licensed ? (state.license.until ? `Valid until ${state.license.until}.` : 'No end date.')
    : ended ? `New applications, kits and searches are paused. ${byStore('Tracking, Notion, export and your data keep working.', 'Tracking, export and your data keep working.')}`
      : '';   // the rule is the page's subtitle; the one line about Pro is below
  showProCard(state);   // the Pro card with the waitlist button, while Pro is off (pages/plan-waitlist.js)
  $('license-note').hidden = !$('license-note').textContent;
  $('setting-license-key').hidden = !licensed || state.license?.kind === 'pro';   // only an install that already holds a key; a Pro account has none
  $('license-holder').textContent = licensed ? `${state.license.name} · ${KIND[state.license.kind]} key${state.license.until ? ` · until ${state.license.until}` : ''}` : '';
  if (state.keyProblem) message('license-message', `Saved key: ${state.keyProblem}`, 'error');
}

export async function init() {
  const refresh = async () => showLicense(await window.pilot.license());
  await refresh();
  initPlan(refresh);   // the Plan card: Upgrade or the AI credit (pages/plan.js); it asks again so the counter and the line follow the site's answer
  $('allowance-chip').addEventListener('click', () => openSetting('license'));
  // The count moves as applications are sent: look again now and then, and when the window comes back to the front.
  setInterval(() => refresh().catch(() => {}), 10 * 60 * 1000);
  window.addEventListener('focus', () => refresh().catch(() => {}));
  document.querySelector('[data-settings-go="license"]').addEventListener('click', refresh);
  $('license-remove').addEventListener('click', async () => { message('license-message', ''); showLicense(await window.pilot.licenseRemove()); });
  // The allowance ended and something new was started: say so once, kindly, and point to the Plan page.
  window.pilot.onAllowance(state => {
    showLicense(state);
    $('allowance-plan').textContent = endedLine(state);
    if (!$('allowance-dialog').open) $('allowance-dialog').showModal();
  });
  $('allowance-settings').addEventListener('click', () => { $('allowance-dialog').close(); openSetting('license'); });
}
