/* global document */
// A row's pages shrunk for a case folder (npm run row-to-case; owner-approved 11 Oct 2026: real pages stay, fonts/images/scripts/tracking/queries go; sizes measured on three real captures, 84-168 KB):
// the CSS is cut to the rules some captured state uses (a selector that matches an element in ANY state of the page keeps its rule, so a dialog shown by a class in a later state survives), fonts,
// keyframes, imports and every url(...) are dropped, the sheets of one host become ONE stylesheet at <host>/__case/styles.css (linked from each page; the replay serves it like any sheet),
// data: images go from the markup. Text and structure are untouched. Guard: e2e/test/pool/row-case-shrink.test.mjs.
// pages: [{url, file, html}] (every state and frame), harCss: [css text of the run's cross-origin sheets]. -> {pages: [{url, file, html}], sheets: Map(<stylesheet address> -> css)}.

// Runs IN the page: the rules of every sheet (the page's own, plus `extra` texts) kept when their selector matches something here. -> [cssText]
function usedRules({extra, layoutOnly}) {
  for (const text of extra) { const style = document.createElement('style'); style.textContent = text; document.head.append(style); }
  const dynamic = /::?(?:hover|focus(?:-visible|-within)?|active|visited|link|before|after|placeholder|selection|first-line|first-letter|-[a-z-]+|backdrop|file-selector-button|marker|disabled|checked|invalid|valid|required|optional|not\(.*?\))/gi;
  const matches = selector => { try { return !!document.querySelector(selector.replace(dynamic, '')) || /(^|[\s,>+~])(?:html|body|:root|\*)(?![\w-])/.test(selector); } catch { return true; } };
  const keep = rules => rules.flatMap(rule => {
    const text = rule.cssText;
    if (/^@(font-face|keyframes|-webkit-keyframes|import|charset)\b/i.test(text)) return [];
    if (rule.cssRules && !rule.selectorText) { const inner = keep([...rule.cssRules]); return inner.length ? [`${text.slice(0, text.indexOf('{')).trim()} {\n${inner.join('\n')}\n}`] : []; }
    if (rule.selectorText && !matches(rule.selectorText)) return [];
    if (!layoutOnly || !rule.style) return [text];
    // Page budget (npm run row-to-case when the case is over its size warning): only what decides what is visible, where and how big stays of a rule; colours, fonts, backgrounds, borders' paint, shadows, animation go.
    const LAYOUT = /^(display|visibility|position|top|right|bottom|left|inset|z-index|float|clear|width|height|min-|max-|margin|padding|overflow|flex|grid|order|align|justify|gap|box-sizing|transform|content|opacity|clip|white-space|text-overflow|line-height|vertical-align|table|columns|writing-mode|pointer-events|border(-(top|right|bottom|left))?-(width|style)|border-width|border-style|border$)/;
    const kept = [];
    for (let at = 0; at < rule.style.length; at++) { const name = rule.style[at]; if (LAYOUT.test(name)) kept.push(`${name}: ${rule.style.getPropertyValue(name)}${rule.style.getPropertyPriority(name) ? ' !important' : ''}`); }
    return kept.length ? [`${rule.selectorText} { ${kept.join('; ')} }`] : [];
  });
  const out = [];
  for (const sheet of document.styleSheets) { try { out.push(...keep([...sheet.cssRules])); } catch { /* a sheet the page cannot read */ } }
  return out.map(text => text.replace(/url\([^)]*\)/gi, 'none'));
}

// Runs IN the page: the page cut to what a replay can press or fill (--stub-page): its title, and every link, button, form control, label and form (the outermost of each), in document order. -> html
function stubOf() {
  const pick = [...document.querySelectorAll('a[href], button, [role=button], input, select, textarea, label, form')];
  const top = pick.filter(el => !pick.some(other => other !== el && other.contains(el)));
  return `<!doctype html><html><head><title>${document.title.replace(/[<>&]/g, '')}</title></head><body>${top.map(el => el.outerHTML).join('\n')}</body></html>`;
}

export async function shrinkPages(chromium, pages, harCss = [], {exe, layoutOnly = false, stub = []} = {}) {   // stub: indexes of pages kept as their links, buttons and controls only   // layoutOnly: the page budget: rules cut to their layout and visibility declarations
  const browser = await chromium.launch({headless: true, ...(exe ? {executablePath: exe} : {})});
  const hosts = new Map();   // host -> Set of kept rule texts, in first-seen order
  try {
    const tab = await browser.newPage();
    for (const [at, one] of pages.entries()) {
      await tab.route('**/*', route => route.abort());   // nothing from the network: sheets come from the markup and harCss
      await tab.setContent(one.html, {waitUntil: 'domcontentloaded'});
      if (stub.includes(at)) { one.html = await tab.evaluate(stubOf); await tab.setContent(one.html, {waitUntil: 'domcontentloaded'}); }   // the rules are then those of the stub
      const rules = await tab.evaluate(usedRules, {extra: harCss, layoutOnly});
      const host = new URL(one.url).host, set = hosts.get(host) || new Set();
      for (const rule of rules) set.add(rule);
      hosts.set(host, set);
    }
  } finally { await browser.close(); }
  const sheetOf = url => `https://${new URL(url).host}/__case/styles.css`;
  const sheets = new Map([...hosts].map(([host, set]) => [`https://${host}/__case/styles.css`, [...set].join('\n')]));
  const shrunk = pages.map(one => {
    const html = one.html.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '').replace(/<link\b[^>]*rel=["']?stylesheet["']?[^>]*>/gi, '').replace(/\s(src|srcset)="data:[^"]*"/gi, '')
      .replace(/<\/head>/i, `<link rel="stylesheet" href="${sheetOf(one.url)}"></head>`);
    return {url: one.url, file: one.file, html};
  });
  return {pages: shrunk, sheets};
}
