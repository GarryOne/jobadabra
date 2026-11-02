// What the extension runs INSIDE a page it reads (chrome.scripting.executeScript { func }): each function is self-contained (it is serialised
// and sent to the page, so it may use nothing outside itself). They read the job list, outline it for Claude, close consent banners, list
// and apply filter controls, find the way on to the next page. The visit itself (pages, pauses, progress) is visit.js.
// Guarded by desktop/test/extension-tab-pages.test.js, visits-run.test.js and local-server.test.js.

// Runs inside the page (chrome.scripting): self-contained. What a person sees: the page, and each job card's visible lines.
export function extractPage() {
  const CHALLENGE = /just a moment|attention required|verify you are human|captcha|are you a robot|unusual activity|security check/i;
  const JOB = /\/jobs?\/view\/|\/jobs?\/\d|\/job\/|viewjob|[?&]jk=|\/stellen?|\/offres?[-/]|\/emplois?\/|\/vacanc|\/positions?\/|jobid=|job_id=|\/jobs\/[\w-]+-\d+/i;
  const seen = new Set();
  const cards = [];
  for (const link of document.querySelectorAll('a[href]')) {
    const href = link.href.split('#')[0];
    if (!/^https?:/.test(href) || seen.has(href) || !JOB.test(href)) continue;
    seen.add(href);
    const box = link.closest('li, article, [data-job-id], [data-occludable-job-id], [class*="job-card"], [class*="jobCard"], [class*="JobCard"], [class*="result"]') || link.parentElement;
    const lines = (box?.innerText || link.innerText || '').split('\n').map(line => line.trim()).filter(Boolean).slice(0, 8);
    const title = (link.innerText || link.getAttribute('aria-label') || lines[0] || '').split('\n').map(line => line.trim()).find(Boolean) || '';
    if (title.length >= 3) cards.push({title: title.slice(0, 160), url: href, lines});
    if (cards.length >= 300) break;
  }
  const text = `${document.title} ${(document.body?.innerText || '').slice(0, 3000)}`;
  return {
    url: location.href, title: document.title.slice(0, 300), cards,
    html: document.documentElement.outerHTML.slice(0, 3_000_000),
    challenge: CHALLENGE.test(text) && cards.length === 0,
    login: /\/(login|signin|sign-in|authwall|checkpoint|uas\/login)\b/i.test(location.pathname),
    blank: (document.body?.innerText || '').trim().length < 40,   // nothing drawn yet (7 Oct 2026: LinkedIn stayed white)
  };
}

// Runs inside the page: a compact outline for Claude when no recipe or quick guess reads the list (owner, 7 Oct 2026: "intelligent enough to
// adapt on any website"). Job cards are repeated blocks on any site: groups of 3+ siblings with the same tag and class, each with a CSS path
// and a few samples (their text lines and links); plus the controls that look like paging. Never form values; text capped.
export function pageOutline() {
  // A block's lines: its visible text pieces in order (inline spans are separate lines; innerText would join them).
  const linesOf = node => {
    const out = [];
    const walk = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
    while (walk.nextNode()) {
      const text = walk.currentNode.textContent.replace(/\s+/g, ' ').trim();
      const parent = walk.currentNode.parentElement;
      if (text && parent && (parent.offsetParent !== null || parent.getClientRects().length > 0) && out.at(-1) !== text) out.push(text);
    }
    return out;
  };
  const visible = node => node.offsetParent !== null || node.getClientRects().length > 0;
  const path = node => {
    const parts = [];
    for (let at = node; at && at !== document.body && parts.length < 6; at = at.parentElement) {
      const cls = [...at.classList].filter(c => /^[a-zA-Z][\w-]{1,40}$/.test(c) && !/\d{3,}/.test(c)).slice(0, 2).map(c => `.${CSS.escape(c)}`).join('');
      parts.unshift(`${at.tagName.toLowerCase()}${cls}`);
    }
    return parts.join(' > ');
  };
  const signature = node => `${node.tagName}.${[...node.classList].filter(c => !/\d{3,}/.test(c)).sort().join('.')}`;
  const groups = [];
  const seen = new Set();
  for (const parent of document.querySelectorAll('body *')) {
    if (groups.length >= 12) break;
    const kids = [...parent.children].filter(visible);
    if (kids.length < 3) continue;
    const counts = {};
    for (const kid of kids) counts[signature(kid)] = (counts[signature(kid)] || 0) + 1;
    const [best, n] = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
    if (n < 3) continue;
    const items = kids.filter(kid => signature(kid) === best && (kid.innerText || '').trim().length > 8 && kid.querySelector('a[href]'));
    if (items.length < 3) continue;
    const selector = path(items[0]);
    if (seen.has(selector)) continue;
    seen.add(selector);
    groups.push({id: `g${groups.length + 1}`, selector, count: document.querySelectorAll(selector).length,
      samples: items.slice(0, 3).map(item => ({lines: linesOf(item).slice(0, 8).map(line => line.slice(0, 100)),
        links: [...item.querySelectorAll('a[href]')].slice(0, 3).map(link => ({text: (link.innerText || '').trim().slice(0, 80), href: link.getAttribute('href').slice(0, 160)}))}))});
  }
  // The controls Claude may name as the next page (src/ai/visit_reader.py checks its answer is one of them): the ones these words know first,
  // then the page's other short controls, so "Seguinte" or "Następna" can be chosen too; never one that applies, submits or signs in.
  const pager = [], others = [];
  for (const node of document.querySelectorAll('a[href], button, [role=button]')) {
    const label = (node.getAttribute('aria-label') || node.innerText || node.getAttribute('title') || '').replace(/\s+/g, ' ').trim();
    if (!label || label.length > 30 || !visible(node) || /apply|submit|sign ?in|sign ?up|log ?in|register|password/i.test(label)) continue;
    (/^\d{1,3}$|next|suiv|weiter|nächst|sigu|succ|more|plus|mehr|›|»|>|→/i.test(label) ? pager : others).push({label, kind: node.tagName === 'A' ? 'link' : 'button'});
  }
  pager.splice(25); pager.push(...others.slice(-Math.max(0, 25 - pager.length)));   // a pager sits near the end of the page: its last controls
  return {url: location.href, title: document.title.slice(0, 200), groups, pager};
}

// Runs inside the page: the jobs a recipe (from Claude, saved per site) reads: each block matching recipe.selector, its job link, and the
// lines it names for title, employer and place.
export function cardsByRecipe(recipe) {
  // A block's lines: its visible text pieces in order (inline spans are separate lines; innerText would join them).
  const linesOf = node => {
    const out = [];
    const walk = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
    while (walk.nextNode()) {
      const text = walk.currentNode.textContent.replace(/\s+/g, ' ').trim();
      const parent = walk.currentNode.parentElement;
      if (text && parent && (parent.offsetParent !== null || parent.getClientRects().length > 0) && out.at(-1) !== text) out.push(text);
    }
    return out;
  };
  const cards = [];
  const seen = new Set();
  for (const item of document.querySelectorAll(recipe.selector)) {
    const lines = linesOf(item);
    const links = [...item.querySelectorAll('a[href]')];
    const link = links[Math.min(recipe.link || 0, links.length - 1)] || item.closest('a[href]');
    if (!link) continue;
    const href = link.href.split('#')[0];
    const title = (recipe.title >= 0 ? lines[recipe.title] : link.innerText) || '';
    if (!title || seen.has(href)) continue;
    seen.add(href);
    const pick = index => (index >= 0 && lines[index] && lines[index] !== title ? lines[index] : '');
    cards.push({title: title.slice(0, 160), url: href, lines: [title, pick(recipe.company), pick(recipe.place)].filter(Boolean)});
    if (cards.length >= 300) break;
  }
  return cards;
}

// Runs inside the page: the next page by a recipe's paging: a control with that exact label, the page number after the current one, or scroll.
export function nextByRecipe(recipe) {
  const visible = node => node && (node.offsetParent !== null || node.getClientRects().length > 0) && !node.disabled && node.getAttribute('aria-disabled') !== 'true';
  const labels = node => [node.getAttribute('aria-label'), node.innerText, node.getAttribute('title')].map(text => (text || '').replace(/\s+/g, ' ').trim());
  const controls = [...document.querySelectorAll('a[href], button, [role=button]')].filter(visible);
  if (recipe.next === 'scroll') { const before = document.documentElement.scrollHeight; window.scrollTo(0, before); return before > window.innerHeight + 50 ? 'scroll' : 'none'; }
  if (recipe.next === 'number') {
    const current = document.querySelector('[aria-current="page"], [aria-current="true"]');
    const number = Number((current?.innerText || '').trim());
    const following = number && controls.find(node => (node.innerText || '').trim() === String(number + 1));
    if (following) { (globalThis.__jobadabraPress?.(following) || following.click()); return 'page number'; }
    return 'none';
  }
  const target = controls.find(node => labels(node).includes(recipe.next));
  if (target) { (globalThis.__jobadabraPress?.(target) || target.click()); return 'recipe'; }
  return 'none';
}

// Runs inside the page: a small banner while the extension reads it (owner: "otherwise a loading spinner/banner"), or none (text '').
// A cookie or consent banner over the page (owner, 7 Oct 2026: "the extension doesn't know to accept cookies"; Omega's 6 jobs sat behind one):
// closed the way a person would, choosing the least consent offered: "reject all" / "technical or necessary only" first, "accept" only when it
// is the one way on. Only a box that speaks of cookies or consent, never one with a password field. Runs in the page; returns the label pressed.
export function closeConsent(want = null) {   // want: {list: true} -> the box's button labels; {press: label} -> press that one (visit.js asks the app which)
  const visible = node => { const box = node.getBoundingClientRect(); const look = getComputedStyle(node); return box.width > 0 && box.height > 0 && look.visibility !== 'hidden' && look.display !== 'none'; };
  const words = node => (node.innerText || node.value || node.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim();
  // Also inside open shadow roots: a banner drawn by web components (Usercentrics: div#usercentrics-root) is invisible to document.querySelectorAll (Hornbach, 11 Oct 2026). Same walk as fill-flow.js pageSketchOf.
  const deep = selector => { const found = []; const walk = root => { found.push(...root.querySelectorAll(selector)); for (const el of root.querySelectorAll('*')) if (el.shadowRoot && !/^jobadabra/.test(el.id)) walk(el.shadowRoot); }; walk(document); return found; };
  const ABOUT = want?.cookiesOnly ? /cookie|traceurs|tracking/i : /cookie|consent|gdpr|privacy|datenschutz|confidentialit|traceurs|tracking/i;   // cookiesOnly: the application flow never touches a privacy or terms box
  // Inside a frame that is itself the consent message (Sourcepoint, TrustArc draw theirs in an iframe), the whole frame is the box.
  const framed = window !== window.top && ABOUT.test(document.body?.innerText || '') && !document.querySelector('input[type=password]') ? [document.body] : [];
  const boxes = [...framed, ...deep('[role=dialog], [aria-modal=true], dialog, [id*=cookie i], [class*=cookie i], [id*=consent i], [class*=consent i], [id*=onetrust i], [id*=didomi i], [id*=cmp i], [class*=cmp i]')]
    .filter(node => visible(node) && ABOUT.test(node.innerText || '') && !node.querySelector('input[type=password]')
      && !(want?.cookiesOnly && /(privacy|consent|data protection) statement|datenschutzerkl|déclaration de confidentialité/i.test((node.innerText || '').slice(0, 200))));   // cookiesOnly: a privacy statement of the form is no cookie banner (its Decline led to deleting an account, 15 Oct 2026)
  const least = /^(reject|decline|refuse|deny|necessary|essential|only necessary|use necessary|allow (technical|necessary|essential)|tout refuser|refuser|continuer sans accepter|nur (notwendige|erforderliche|technisch)|ablehnen|alle ablehnen|rifiuta|solo (necessari|tecnici))/i;
  const any = /^(accept|agree|allow all|got it|ok\b|okay|i understand|accepter|tout accepter|j'accepte|akzeptieren|alle akzeptieren|zustimmen|einverstanden|accetta|accetto)/i;
  // A link to another address, or one that opens a new tab, is no dismiss control (jobs.ch, 10 Oct 2026: "Cookie notice" opened a tab per press, each with the same banner): "#", script and same-page links stay.
  const leavesPage = node => { const link = node.closest && node.closest('a[href]'); if (!link) return false; if (/^(_blank|_top|_parent)$/i.test(link.getAttribute('target') || '')) return true; try { const to = new URL(link.href, location.href); return to.protocol !== 'javascript:' && to.href.split('#')[0] !== location.href.split('#')[0]; } catch { return true; } };   // the shared floor (app-core/test/popup-press-stays.test.js: the same text in popup-page.js, visit-page.js and on-top.js)
  const stays = node => !leavesPage(node);
  const buttonsOf = box => [...box.querySelectorAll('button, a, [role=button], input[type=button], input[type=submit]')].filter(node => visible(node) && stays(node) && words(node) && words(node).length < 60);
  if (want?.list) return [...new Set(boxes.flatMap(box => buttonsOf(box).map(words)))].slice(0, 20);
  if (want?.press) { const button = boxes.flatMap(buttonsOf).find(node => words(node) === want.press); if (button) (globalThis.__jobadabraPress?.(button) || button.click()); return button && !window.__jobadabraRefused ? words(button) : ''; }   // a press the floor refused (page/submit-press.js) is no press
  for (const pattern of [least, any]) {
    for (const box of boxes) {
      const button = [...box.querySelectorAll('button, a, [role=button], input[type=button], input[type=submit]')].find(node => visible(node) && stays(node) && pattern.test(words(node)) && words(node).length < 60);
      if (button) { (globalThis.__jobadabraPress?.(button) || button.click()); return window.__jobadabraRefused ? '' : words(button); }
    }
  }
  return '';
}

export function pageBanner(text) {
  let node = document.getElementById('jobadabra-reading');
  if (!text) { node?.remove(); return; }
  if (!node) {
    node = document.createElement('div');
    node.id = 'jobadabra-reading';
    node.setAttribute('role', 'status');
    node.style.cssText = 'position:fixed;z-index:2147483647;right:16px;bottom:16px;padding:10px 14px;border-radius:10px;background:#132439;color:#fff;'
      + 'font:600 13px/1.4 -apple-system,BlinkMacSystemFont,system-ui,sans-serif;box-shadow:0 6px 24px rgba(0,0,0,.25);pointer-events:none';
    document.documentElement.append(node);
  }
  node.textContent = text;
}

// Runs inside the page: its filter controls, for Claude to choose from (the app's src/ai/visit_filters.py). Labels and options only, never the
// page's other text. Each gets a data-jp-control id so the chosen steps find it again. Anything that applies, signs in, messages, saves,
// follows, pays or leaves the site is never listed (and applyFilters refuses it again).
export function collectControls() {
  const NEVER = /apply|postuler|bewerb|candidat|submit|envoyer|sign ?in|sign ?up|log ?in|connexion|anmeld|register|message|connect|follow|save|enregistr|speicher|alert|premium|upgrade|buy|subscribe|abonn|share|partager|report|delete|easy apply|candidature simplifi/i;
  const visible = node => node.offsetParent !== null || node.getClientRects().length > 0;
  const labelOf = node => (node.getAttribute('aria-label') || (node.id && document.querySelector(`label[for="${CSS.escape(node.id)}"]`)?.innerText)
    || node.closest('label')?.innerText || node.innerText || node.getAttribute('placeholder') || node.getAttribute('title') || node.name || '').replace(/\s+/g, ' ').trim().slice(0, 120);
  const out = [];
  const nodes = document.querySelectorAll('select, input[type=checkbox], input[type=radio], input[type=text], input[type=search], input:not([type]), '
    + 'button[aria-expanded], button[aria-haspopup], button[aria-pressed], [role=checkbox], [role=radio], [role=switch], [role=option], [role=menuitemcheckbox], [role=menuitemradio]');
  for (const node of nodes) {
    if (!visible(node) || node.disabled) continue;
    const label = labelOf(node);
    if (!label || NEVER.test(label) || node.closest('form[action*="login"], form[action*="apply"]')) continue;
    // A page-wide number: a second round (or the way-finder after it) never gives one id to two elements (7 Oct 2026: on Fust "w5" named
    // two links, and "Occasionen" was clicked for "Zu den offenen Stellen").
    const root = document.documentElement;
    const id = node.dataset.jpControl || `c${root.dataset.jpNext = Number(root.dataset.jpNext || 0) + 1}`;
    node.dataset.jpControl = id;
    const kind = node.tagName === 'SELECT' ? 'select' : node.tagName === 'INPUT' ? (['checkbox', 'radio'].includes(node.type) ? node.type : 'text') : (node.getAttribute('role') || 'button');
    out.push({id, kind, label, options: node.tagName === 'SELECT' ? [...node.options].map(option => option.text.trim()).slice(0, 12) : [],
      on: !!(node.checked || node.getAttribute('aria-checked') === 'true' || node.getAttribute('aria-pressed') === 'true' || node.getAttribute('aria-selected') === 'true')});
    if (out.length >= 60) break;   // a short list: Claude answers in seconds (LinkedIn's 150 took 130 s, 7 Oct 2026)
  }
  return out;
}

// Runs inside the page: the address of a job list drawn inside it by another site (an iframe: 7 Oct 2026, Manor's careers page shows
// live.solique.ch/manor/de/ and nothing else), when the page has no list of its own. The biggest visible frame from another host that is not a
// cookie banner, a map or a video; '' when none.
export function jobFrame() {
  const NOT = /consent|cookie|usercentrics|didomi|onetrust|cmp\.|privacy|google\.com\/maps|maps\.|youtube|vimeo|recaptcha|hcaptcha|doubleclick|facebook|twitter|linkedin\.com\/embed/i;
  const frames = [...document.querySelectorAll('iframe[src]')].map(frame => ({frame, box: frame.getBoundingClientRect()}))
    .filter(({frame, box}) => /^https:\/\//.test(frame.src) && new URL(frame.src).host !== location.host && !NOT.test(frame.src) && box.width >= 300 && box.height >= 200)
    .sort((a, b) => b.box.width * b.box.height - a.box.width * a.box.height);
  return frames[0]?.frame.src || '';
}

// Runs inside the page: its ways on when it shows no job list (buttons, links, search boxes, choices), for Claude to pick a way to the jobs
// (src/ai/visit_unblock.py), with the title and first lines of text. Nothing that applies, signs in, saves or pays is ever listed.
export function collectWays() {
  // Never a way to undo the place filter (7 Oct 2026: on Fust's list filtered to Geneva, Claude's way on was "Alles zurücksetzen"): an empty
  // filtered list is the answer, not a dead end.
  const RESET = /reset|zurücksetzen|r[ée]initialiser|clear (all|filters?)|alle löschen|effacer (tout|les filtres)|azzera/i;
  const NEVER = /apply|postuler|bewerb|candidat|submit|envoyer|sign ?in|sign ?up|log ?in|connexion|anmeld|register|message|connect|follow|save|enregistr|speicher|alert|premium|upgrade|buy|subscribe|abonn|share|partager|report|delete|easy apply|candidature simplifi|password|checkout|cart|panier|warenkorb/i;
  const visible = node => (node.offsetParent !== null || node.getClientRects().length > 0) && getComputedStyle(node).visibility !== 'hidden';
  const labelOf = node => (node.getAttribute('aria-label') || node.innerText || node.value || node.getAttribute('placeholder') || node.getAttribute('title') || node.name || '')
    .replace(/\s+/g, ' ').trim().slice(0, 120);
  const ways = [];
  for (const node of document.querySelectorAll('a[href], button, [role=button], input[type=search], input[type=text], input:not([type]), select')) {
    if (!visible(node) || node.disabled) continue;
    const label = labelOf(node);
    const href = node.tagName === 'A' ? node.href.split('#')[0] : '';
    // An address that is a page's template code, not a link (7 Oct 2026: DHL's "${getUrl(linkEle,"), is never offered.
    if ((!label && !href) || NEVER.test(label) || RESET.test(label) || /^(mailto|tel|javascript):|\$\{|\{\{|%7B/i.test(node.getAttribute('href') || '') || node.closest('form[action*="login"], form[action*="apply"]')) continue;
    if (href && ways.some(way => way.href === href)) continue;
    const root = document.documentElement;   // a page-wide number, as in collectControls: ids stay unique across rounds
    const id = node.dataset.jpControl || `w${root.dataset.jpNext = Number(root.dataset.jpNext || 0) + 1}`;
    node.dataset.jpControl = id;
    const kind = node.tagName === 'A' ? 'link' : node.tagName === 'SELECT' ? 'select' : node.tagName === 'INPUT' ? 'search box' : 'button';
    ways.push({id, kind, label, href, options: node.tagName === 'SELECT' ? [...node.options].map(option => option.text.trim()).slice(0, 15) : []});
    if (ways.length >= 120) break;
  }
  return {url: location.href, title: document.title.slice(0, 200), text: (document.body?.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 800), ways};
}

// Runs inside the page: the steps Claude chose, on the controls listed above only, refusing again anything that applies, signs in or leaves.
export async function applyFilters(steps) {
  const NEVER = /apply|postuler|bewerb|candidat|submit|envoyer|sign ?in|sign ?up|log ?in|connexion|anmeld|register|message|connect|follow|save|enregistr|speicher|alert|premium|upgrade|buy|subscribe|abonn|share|partager|report|delete|easy apply|candidature simplifi/i;
  // A box that suggests as you type (Tom Select, select2, an ARIA combobox) filters only once a suggestion is picked: typed text alone is
  // just its search (7 Oct 2026: Van Cleef's "Location = Geneva" was typed three times and 220 jobs worldwide were read; picked, 6).
  const plain = text => String(text || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
  const suggests = node => node.getAttribute('role') === 'combobox' || node.hasAttribute('aria-autocomplete') || node.hasAttribute('aria-controls');
  // A plain box may draw its own suggestions too (a home-made list under it): any box a place is typed into is watched for them, but only for
  // suggestions that appeared after the typing, so a link already on the page that names the place is never clicked.
  const OPTIONS = '[role=option], [role=listbox] li, .ts-dropdown .option, .select2-results__option, .ui-menu-item, .autocomplete-suggestion, '
    + '[class*=suggest] li, [class*=suggest] a, [class*=autocomplete] li, [class*=autocomplete] a';
  const shown = root => [...root.querySelectorAll(OPTIONS)]
    .filter(option => (option.offsetParent !== null || option.getClientRects().length > 0) && option.getAttribute('aria-disabled') !== 'true');
  const pickSuggestion = async (node, value, before, waitMs) => {
    const want = plain(value);
    // The place's stem too: the site may name it in its own language (8 Oct 2026: "geneva" typed on Decathlon's French site, which suggests
    // "Genève"; Kanton "Genève" on coopjobs, which says "Genf"). "genev" finds "Genève (GE)"; never shorter than 4 letters.
    const stem = want.slice(0, Math.max(4, want.length - 1));
    let retyped = false;
    for (let waited = 0; waited < waitMs; waited += 200) {   // suggestions often come after a pause or from the server
      await new Promise(done => setTimeout(done, 200));
      const list = document.getElementById(node.getAttribute('aria-controls') || node.getAttribute('aria-owns') || '');
      const options = shown(list || document).filter(option => !before.has(option) && plain(option.innerText || option.textContent));
      const text = item => plain(item.innerText || item.textContent);
      const option = options.find(item => text(item) === want) || options.find(item => text(item).startsWith(want)) || options.find(item => text(item).includes(want))
        || options.find(item => text(item).startsWith(stem)) || options.find(item => text(item).split(/[\s,(/-]+/).some(word => word.startsWith(stem)));
      // Nothing offered for the whole word halfway through: the stem typed instead, once (a site that knows only its own spelling).
      if (!option && !options.length && !retyped && stem !== want && waited >= waitMs / 2) {
        retyped = true;
        node.value = String(value).slice(0, stem.length);
        node.dispatchEvent(new Event('input', {bubbles: true}));
      }
      if (option && !globalThis.__jobadabraSubmitPress?.refused(option)) {   // the press floor (page/submit-press.js) holds for the suggestion click too
        globalThis.__jobadabraSubmitPress?.mark(option);
        for (const type of ['mousedown', 'mouseup', 'click']) option.dispatchEvent(new MouseEvent(type, {bubbles: true, cancelable: true}));
        return (option.innerText || option.textContent).replace(/\s+/g, ' ').trim().slice(0, 80);
      }
    }
    if (retyped) { node.value = value; node.dispatchEvent(new Event('input', {bubbles: true})); }   // nothing picked: the whole word back, searched as typed
    return '';
  };
  // Never Submit: the filter reader sends only a search-shaped form (a box or two and a select), never one that holds a password, a file, a free-text area, an e-mail or a phone box, or a pile of fields (an application).
  const searchSubmit = form => {
    if (!form || form.querySelector('input[type=password], input[type=file], textarea, input[type=email], input[type=tel]')) return;
    if ([...form.elements].filter(el => el.matches('input:not([type=hidden]):not([type=submit]):not([type=button]):not([type=image]):not([type=checkbox]):not([type=radio]), select')).length > 3) return;
    form.requestSubmit?.();
  };
  const done = [];
  for (const step of steps || []) {
    const node = document.querySelector(`[data-jp-control="${CSS.escape(String(step.control))}"]`);
    const label = node ? (node.getAttribute('aria-label') || node.innerText || node.getAttribute('placeholder') || '').trim() : '';
    if (!node || NEVER.test(label) || (node.tagName === 'A' && node.host && node.host !== location.host)) { done.push({control: step.control, ok: false}); continue; }
    if (step.action === 'select' && node.tagName === 'SELECT') {
      const option = [...node.options].find(item => item.text.trim() === step.value);
      if (!option) { done.push({control: step.control, ok: false}); continue; }
      node.value = option.value;
      node.dispatchEvent(new Event('change', {bubbles: true}));
    } else if (step.action === 'type' && node.tagName === 'INPUT') {
      const declared = suggests(node), before = new Set(shown(document));
      node.focus();
      node.value = step.value;
      node.dispatchEvent(new Event('input', {bubbles: true}));
      // The suggestion first, then the search: an Enter or submit before it sends the form without the place. A declared suggest box waits
      // up to 3 s; a plain one 1.6 s, and with no suggestion it is searched as typed (Enter), as before.
      const picked = await pickSuggestion(node, step.value, before, declared ? 3000 : 1600);
      if (declared || picked) {
        done.push({control: step.control, ok: true, picked, suggests: true});
        searchSubmit(node.form);
        continue;
      }
      node.dispatchEvent(new Event('change', {bubbles: true}));
      node.dispatchEvent(new KeyboardEvent('keydown', {key: 'Enter', bubbles: true}));
      searchSubmit(node.form);
    } else {
      (globalThis.__jobadabraPress?.(node) || node.click());
    }
    done.push({control: step.control, ok: true});
  }
  return done;
}

// Runs inside the page: the next page of the same list. A "next" link or button, else the next page number, else a "more jobs" button,
// else scroll to the end (lists that load as you scroll). Returns how it went on, or 'none'.
export function goNext() {
  const visible = node => node && node.offsetParent !== null && !node.disabled && node.getAttribute('aria-disabled') !== 'true'
    && !/\$\{|\{\{|%7B/i.test(node.getAttribute('href') || '');   // a link to template code (DHL's "${getUrl(") goes nowhere
  const labels = node => [node.innerText, node.getAttribute('aria-label'), node.getAttribute('title')].map(text => (text || '').trim()).filter(Boolean);
  const rel = document.querySelector('a[rel="next"], link[rel="next"]');
  if (rel?.href && rel.tagName === 'A' && visible(rel)) { (globalThis.__jobadabraPress?.(rel) || rel.click()); return 'next link'; }
  const NEXT = /^(next|suivant|weiter|nächste|siguiente|successivo|›|»|>)$|next page|page suivante|nächste seite/i;
  const controls = [...document.querySelectorAll('a, button, [role="button"]')].filter(visible);
  const next = controls.find(node => labels(node).some(text => NEXT.test(text)));
  if (next) { (globalThis.__jobadabraPress?.(next) || next.click()); return 'next button'; }
  const current = document.querySelector('[aria-current="page"], [aria-current="true"], .active > a, li.selected');
  const number = Number((current?.innerText || '').trim());
  if (number) {
    const following = controls.find(node => (node.innerText || '').trim() === String(number + 1));
    if (following) { (globalThis.__jobadabraPress?.(following) || following.click()); return 'page number'; }
  }
  const more = controls.find(node => labels(node).some(text => /^(see more jobs|show more|load more|more jobs|afficher plus|plus d'offres|mehr anzeigen|weitere jobs)/i.test(text)));
  if (more) { (globalThis.__jobadabraPress?.(more) || more.click()); return 'more button'; }
  const before = document.documentElement.scrollHeight;
  window.scrollTo(0, before);
  return before > window.innerHeight + 50 ? 'scroll' : 'none';
}

// The quick guess is kept only when it clearly looks like a job list; otherwise Claude reads the page's outline.
export function plausible(cards) {
  const titles = (cards || []).map(card => String(card.title || '').trim()).filter(Boolean);
  if (titles.length < 3 || new Set(titles).size < 3) return false;
  const sorted = titles.map(title => title.length).sort((a, b) => a - b);
  const middle = sorted[Math.floor(sorted.length / 2)];
  return middle >= 8 && middle <= 100 && titles.filter(title => /^\d+$|^(next|more|see all|apply)/i.test(title)).length < titles.length / 3;
}
