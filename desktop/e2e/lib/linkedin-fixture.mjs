// Job: run the backbone
// A stand-in for www.linkedin.com on the forms server (lib/forms.mjs HOSTS): a guest job list over two pages, a login page, a check page and a 429, switched per step.
// It records every request (path, status, whether li_at arrived, never the value), sets two cookies the way LinkedIn does (one for the whole site, one host-only), and answers /__cookies with the
// names of the cookies the browser sent, so a probe tab can show the app's browser holds none after a read. The host lives only here: product code names LinkedIn from its own search URLs.
// Guard: suites/linkedin.mjs (the steps).
export const HOST = 'www.linkedin.com';
/** Obviously fake values: the secret scan must neither drop nor flag them, and a leak is searched for by this word. */
export const FAKE_LI_AT = 'FAKE-LI-AT-e2e-not-a-session';
export const FAKE_JSESSIONID = '"ajax:FAKE-JSESSIONID-e2e"';
export const CASES = ['list', 'login', 'check', 'limited', 'hold'];   // hold: the list request is kept open until release(), so a Stop can come mid-read

const html = body => `<!doctype html><html><head><meta charset="utf-8"><title>LinkedIn</title></head><body>${body}</body></html>`;
const word = value => String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24) || 'search';

/** The cards of one list page: distinct titles (the extension's quick guess needs three), a /jobs/view/<id> link each, the employer and a place no fixture strategy fits. */
export function listPage(keywords, page) {
  const tag = word(keywords), count = page === 0 ? 4 : 3;   // page: 0, 1, 2 ...
  const cards = Array.from({length: count}, (_, n) => {
    const id = `${page + 1}${n + 1}${[...tag].reduce((sum, ch) => (sum * 31 + ch.charCodeAt(0)) % 100000, 7)}`;
    return {id, html: `<li class="base-search-card"><a href="/jobs/view/${id}">Role ${tag} number ${page + 1}-${n + 1}</a><div>Fixture Employer ${n + 1}</div><div>Nowhere-on-Earth</div></li>`};
  });
  // Every page has a Next link, as LinkedIn's list never ends: the app's page cap (3) stops the read. Why (31 Oct 2026): with no Next on the last page the extension asks the AI to
  // learn how to find one (extension/visit.js learn()), an AI question this no-AI suite must never cause.
  const next = `<nav><a href="?keywords=${encodeURIComponent(keywords)}&amp;start=${(page + 1) * 25}" aria-label="Next">Next</a></nav>`;
  return {ids: cards.map(card => card.id), body: html(`<ul class="jobs-search__results-list">${cards.map(card => card.html).join('')}</ul>${next}`)};
}

/** -> {route(next), setCase(name), reset(), release(), requests, served(), servedIds(), describe()}: wrap the forms server's handler with `route`. */
export function linkedinFixture() {
  let current = 'list';
  const requests = [], ids = new Set(), held = [];
  const entry = (req, url, status) => requests.push({case: current, path: `${url.pathname}${url.search}`, status, liAt: /(?:^|;\s*)li_at=/.test(String(req.headers.cookie || ''))});
  const route = next => (req, res) => {
    const url = new URL(req.url, 'https://x'), host = String(req.headers.host || '').split(':')[0];
    if (host !== HOST) { next(req, res); return; }
    const send = (status, body, headers = {}) => { entry(req, url, status); res.writeHead(status, {'content-type': 'text/html; charset=utf-8', ...headers}).end(body); };
    if (url.pathname === '/__cookies') { res.writeHead(200, {'content-type': 'application/json'}).end(JSON.stringify(String(req.headers.cookie || '').split(';').map(item => item.trim().split('=')[0]).filter(Boolean))); return; }
    // Why (31 Oct 2026, li 2b): a sign-in page with under 40 characters of text reads as "blank" to the extension (visit-page.js), which asks the person to open it; the real one has a paragraph, so this has one too.
    if (url.pathname === '/uas/login') { send(200, html('<h1>Sign in</h1><p>Stay updated on your professional world. Sign in to see jobs picked for you.</p><form action="/uas/login-submit"><input type="text" name="session_key"><input type="password" name="session_password"><button>Sign in</button></form>')); return; }
    if (current === 'login') { entry(req, url, 302); res.writeHead(302, {location: '/uas/login'}).end(); return; }
    if (current === 'hold') { entry(req, url, 0); held.push(res); return; }
    if (current === 'limited') { send(429, html('<p>Too many requests</p>')); return; }
    if (current === 'check') { send(200, html('<p>Verify you are human by completing the action below.</p>')); return; }
    if (url.pathname !== '/jobs/search/') { send(404, html('<p>Not found</p>')); return; }   // /favicon.ico must not be a list
    const keywords = url.searchParams.get('keywords') || '', page = Math.floor(Number(url.searchParams.get('start') || 0) / 25);
    const {ids: shown, body} = listPage(keywords, page);
    // Why (31 Oct 2026): the app's page cap (3) is applied after a page is reported, while the extension has already gone on to the next one (parked as JOB-158); that fourth request is served but is no job
    // the app may keep, so only pages 1-3 count as served: a job read from a fourth page would make the app's count exceed this one.
    if (page < 3) shown.forEach(id => ids.add(id));
    send(200, body, {'set-cookie': ['bcookie="v=2&fixture"; Domain=.linkedin.com; Path=/; Secure; SameSite=None', 'lidc="fixture"; Path=/; Secure; SameSite=None']});   // one site-wide cookie, one host-only
  };
  return {route, setCase: name => { if (!CASES.includes(name)) throw new Error(`unknown LinkedIn fixture case: ${name}`); current = name; }, reset: () => { requests.length = 0; ids.clear(); },
    release: () => { for (const res of held.splice(0)) { try { res.destroy(); } catch { /* gone */ } } },
    requests, served: () => ids.size, servedIds: () => [...ids],
    describe: () => requests.map(item => `${item.case} ${item.path} ${item.status} li_at:${item.liAt ? 'yes' : 'no'}`).join('\n  ') || '(no request reached the fixture)'};
}
