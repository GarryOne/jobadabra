// Collapsed form sections, opened before the form is read (owner, 9 Oct 2026; live: SuccessFactors draws "Informations sur le profil" and
// "Informations propres au poste" collapsed, their fields not shown until opened, so the fill saw an almost empty page, judged "no form on this
// page" and filled nothing). Found by STRUCTURE only, in any language: a button (or role=button) with aria-expanded="false" that is a disclosure
// (it sits in a heading, or names a region with aria-controls), and a closed <details>. Never a popup or menu (aria-haspopup, combobox, menuitem,
// tab, switch), never inside navigation, a header, a footer or a dialog, never a link, never a submit control or anything that holds one, never a
// toggle with no form control on the page at all. At most 20 a round, each once, a few rounds (a section can hold sections). Only the count is
// logged, never a label. Hybrid fill move 3 (owner, 26 Oct 2026; widget zoo collapsed-section-1: an accordion head with no heading and no aria-controls, its body hidden right
// after it): a head whose next sibling is its hidden body is a disclosure too; it is LOOKED INTO: the next round closes it again when its body drew nothing to fill, so a
// toggle that only shows words is left as the page had it. Called by fill-flow.js consider (before the page is judged) and flow.js fillTab (before the form is read).
// Guard: worker/test/page-sections.test.js; e2e step "a form with collapsed sections".
import {decide} from './log.js';

// Runs IN the page (injected by executeScript: no imports, nothing from this file's scope). → how many it opened.
export function openClosedSections() {
  const MAX = 20;
  if (!document.querySelector('input:not([type=hidden]), select, textarea, [role=radiogroup], [role=combobox], form')) return 0;   // nothing to fill here: leave the page alone
  const fenced = el => !!el.closest('nav, header, footer, dialog, [role=navigation], [role=banner], [role=contentinfo], [role=menu], [role=menubar], [role=listbox], [role=dialog], [role=alertdialog], [role=tablist]');
  const submits = el => el.matches('[type=submit], input[type=image]') || !!el.querySelector('[type=submit], input[type=image]');
  const heading = el => !!el.closest('h1, h2, h3, h4, h5, h6, [role=heading]');
  const FIELD = 'input:not([type=hidden]), select, textarea, [role=radiogroup], [role=radio], [role=checkbox], [role=combobox], [role=listbox]';
  const bodyAfter = el => (next => (next && (next.hidden || next.getClientRects().length === 0) ? next : null))(el.nextElementSibling);
  // Looked into in an earlier round: kept open when its body drew something to fill, else closed again.
  for (const el of document.querySelectorAll('[data-jobpilotto-opened="look"]')) {
    el.setAttribute('data-jobpilotto-opened', 'looked');
    if (el.getAttribute('aria-expanded') === 'true' && !el.nextElementSibling?.querySelector(FIELD)) (globalThis.__jobPilottoPress?.(el) || el.click());
  }
  let opened = 0;
  for (const el of document.querySelectorAll('button[aria-expanded="false"], [role=button][aria-expanded="false"]')) {
    if (opened >= MAX) break;
    if (el.hasAttribute('data-jobpilotto-opened') || el.disabled || el.getAttribute('aria-disabled') === 'true' || el.getClientRects().length === 0) continue;
    const haspopup = el.getAttribute('aria-haspopup');
    if ((haspopup && haspopup !== 'false') || ['combobox', 'menuitem', 'tab', 'switch', 'option', 'checkbox', 'radio'].includes(el.getAttribute('role') || '')) continue;
    if (el.tagName === 'A' || fenced(el) || submits(el)) continue;
    const controlled = (el.getAttribute('aria-controls') || '').split(/\s+/).map(id => (id ? document.getElementById(id) : null)).filter(Boolean);
    if (controlled.some(region => region.querySelector('[type=submit], input[type=image]'))) continue;
    const look = !heading(el) && controlled.length === 0;
    if (look && !bodyAfter(el)) continue;   // not a disclosure: a button that happens to say "expanded false"
    el.setAttribute('data-jobpilotto-opened', look ? 'look' : '1');
    (globalThis.__jobPilottoPress?.(el) || el.click());
    opened++;
  }
  for (const details of document.querySelectorAll('details:not([open])')) {
    if (opened >= MAX) break;
    if (fenced(details) || details.querySelector('[type=submit], input[type=image]')) continue;
    details.open = true;
    opened++;
  }
  return opened;
}

// → how many sections were opened in all (0 when the page has none closed). Never throws.
export async function expandSections(tab, wait = ms => new Promise(resolve => setTimeout(resolve, ms))) {
  let total = 0;
  for (let round = 0; round < 3; round++) {
    const rows = await chrome.scripting.executeScript({target: {tabId: tab.id}, func: openClosedSections}).catch(() => null);
    const n = Number(rows?.[0]?.result) || 0;
    if (!n) break;
    total += n;
    await wait(700);   // the sections draw their fields (and any inner sections) after the click
  }
  if (total) { let host = ''; try { host = new URL(tab.url).hostname; } catch { /* no address */ } decide('fill', 'opened collapsed sections', {host, count: total}); }
  return total;
}
