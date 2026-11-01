// A posting that is applied to some other way than a form (spec: docs/superpowers/specs/2026-10-10-non-form-outcomes.md). Step 1: by email.
// Decisions: that the page asks for the application by email, and which address, are the page-kind AI's (desktop/lib/page-kind.js apply_by); structure only
// FINDS what the AI is shown (the sentences and mailto links that carry an address: never the body); the floors live in the app (the named address must stand
// in what was found) and here: nothing is sent, opened or pressed, one report per tab and page (fill-flow.js already asks once per key).
// Invariants (flow core: read before editing; changing one is the owner's call, said in the commit; each names the test that guards it):
//  1. Only sentences (at most 3, 160 characters) and mailto links (at most 5 entries in all) that carry an address leave the page (desktop/test/page-kind.test.js caps; app-core/test/non-form.test.js).
//  2. The report is made only for an AI answer of apply_by email with its address; nothing else becomes an email outcome (app-core/test/non-form.test.js).

// The addresses on the page, found by structure: mailto links first, then the lines of visible text that contain one.
export function mailsOf(tabId) {
  return chrome.scripting.executeScript({target: {tabId}, func: () => {
    const mail = /[^\s@<>()]+@[^\s@<>()]+\.[a-z]{2,}/i;
    const links = [...document.querySelectorAll('a[href^="mailto:" i]')].map(el => el.getAttribute('href').split('?')[0].slice(0, 160)).filter(href => mail.test(href));
    const root = document.querySelector('main, article, [role="main"]') || document.body;   // the posting's own text first: a header, cookie or footer contact line must not crowd out the instruction
    const lines = String(root?.innerText || '').split('\n').map(line => line.replace(/\s+/g, ' ').trim()).filter(line => line && mail.test(line)).map(line => line.slice(0, 160));
    return [...new Set([...links, ...lines.slice(0, 3)])].slice(0, 5);
  }}).then(rows => rows?.[0]?.result || []).catch(() => []);
}

// -> {why, needs} for the app's stuck report when the AI said the posting is applied to by email, else null.
export function emailReport(kind) {
  return kind?.applyBy === 'email' && kind.applyEmail ? {why: 'email', needs: kind.applyEmail} : null;
}
