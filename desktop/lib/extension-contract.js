// The one list of every message between the Chrome extension and the app (routes, request fields, answer fields, events) and validate() for fakes; guard: test/extension-contract.test.js.
//
// Type words: string number boolean array object any; a trailing ? makes a field optional. `open: true` = the extension spreads more keys of a page sketch into the body, so
// extra keys are allowed (the listed ones still are the only ones the app reads). `unread` = sent by the extension, read by no app handler (said, not hidden).
// `readIn` = extension files besides the caller that read the answer. `by: 'worker'` = served by app-core/src/extension.js (the same code runs in the app, desktop/shared/app-core, and on a Cloudflare Worker).
// Why (1 Nov 2026, owner: "let's start a session to implement it", JOB-172): contracts existed for IPC, store, AI engines, ladder and Notion but not for this seam, so a field renamed
// on one side passed every lower test and failed only in a beta. Rule: a message is added or changed HERE first; the test fails on the side that was not changed.

const L = name => `desktop/lib/${name}`;
const SKETCH = 'a page sketch (lib/page-kind.js sketchBody): controls, headings, buttons, url... read by the AI, not field by field';

/** Routes by path. handles: the app (or worker) files that read the request and build the answer. */
export const routes = {
  '/extension/pair': {auth: 'origin', method: 'GET', handles: [L('server-routes.js')], response: {url: 'string', token: 'string'}},
  '/extension/tabs': {auth: 'token', handles: [L('server.js'), L('ext-server-handlers.js'), L('review.js'), L('visits.js')],
    request: {urls: 'array', ids: 'array?', boot: 'string?', browser: 'string?', worker: 'string?', reading: 'array?', sessions: 'array?', version: 'string?', owned: 'boolean?'},
    response: {ok: 'boolean', latest: 'string?', build: 'object?', reread: 'array?'}},
  '/extension/event': {auth: 'token', handles: [L('server.js'), L('ext-server-handlers.js'), L('apply-handlers.js')], request: {type: 'string'}, open: 'per type: see `events`', response: {ok: 'boolean'}},
  '/extension/ticket': {auth: 'token', handles: [L('server-routes.js'), L('server-env.js')], request: {ticket: 'string', job: 'string'}, response: {ok: 'boolean', error: 'string?'}},
  '/extension/open': {auth: 'token', handles: [L('server-routes.js'), L('ext-server-handlers.js')], request: {session: 'string'}, response: {ok: 'boolean'}},
  '/extension/join': {auth: 'token', handles: [L('server-routes.js'), L('ext-server-handlers.js'), L('review.js')], request: {tabs: 'array'}, response: {arm: 'array?'}},
  '/extension/focus': {auth: 'token', handles: [L('server-routes.js'), L('review.js')], request: {url: 'string', title: 'string?', found: 'boolean', job: 'string?', session: 'string?', boot: 'string?'}, response: {ok: 'boolean'}},
  '/extension/learned': {auth: 'token', handles: [L('server-routes.js'), L('learned.js')], request: {host: 'string', job: 'string?', items: 'array'}, response: {ok: 'boolean'}},
  '/extension/remember': {auth: 'token', handles: [L('server-routes.js'), L('learned.js')], request: {labels: 'array', host: 'string?'}, response: {remember: 'object'}},
  '/extension/recipes': {auth: 'token', handles: [L('server-routes.js'), L('ext-server-handlers.js')], request: {fingerprints: 'array'}, response: {recipes: 'any'}},
  '/extension/aliases': {auth: 'token', handles: [L('server-routes.js'), L('ext-server-handlers.js')], request: {}, response: {aliases: 'any'}},
  '/extension/controls': {auth: 'token', open: true, handles: [L('server-routes.js'), L('ext-server-handlers.js')],
    request: {host: 'string', items: 'array', trace: 'array?', aliasUse: 'any?', filled: 'any?', required: 'number?', starred: 'number?', uploads: 'array?', corrections: 'any?', flow: 'any?'}, response: {ok: 'boolean'}},
  '/extension/misses': {auth: 'token', handles: [L('server-routes.js'), L('ext-server-handlers.js'), L('misses.js')], request: {host: 'string', items: 'array'}, response: {ok: 'boolean'}},
  '/extension/review': {auth: 'token', open: true, handles: [L('server-routes.js'), L('ext-server-handlers.js'), L('review.js')],
    request: {tab: 'number?', boot: 'string?', job: 'string?', session: 'string?', role: 'string?'}, readIn: ['extension/panel-markup.js', 'extension/panel-report.js', 'extension/review.js'], response: {matched: 'any?', stop: 'any?', theme: 'string?'}},
  '/extension/page-kind': {auth: 'token', open: SKETCH, handles: [L('server-routes.js'), L('server-pages.js'), L('ladder/rung2-sketch.js')],
    request: {url: 'string', fresh: 'boolean?', digest: 'boolean?', noEffect: 'array?', candidates: 'array?', forget: 'boolean?', reason: 'string?', kind: 'string?', why: 'string?', controls: 'array?'},
    response: {role: 'string?', kind: 'string?', confidence: 'number?', error: 'string?'}},
  '/extension/escalate': {auth: 'token', handles: [L('server-routes.js'), L('server-pages.js'), L('ladder/rung4-picture.js')], request: {url: 'string', kind: 'string?', sketch: 'object?', image: 'string?', reason: 'string?', feedback: 'any?'},
    response: {action: 'string?', control: 'any?', why: 'string?', by: 'string?', usd: 'number?', value: 'any?', option: 'any?', detail: 'any?'}},
  '/extension/account-judge': {auth: 'token', handles: [L('server-routes.js'), L('server-pages.js')],
    request: {phase: 'string', sketch: 'object?', background: 'any?', label: 'string?', message: 'string?', tried: 'array?', verdicts: 'array?', results: 'array?'},
    response: {answer: 'string?', counts: 'any?', step: 'string?', blockedKind: 'string?', needs: 'string?', format: 'any?', verdicts: 'any?', repairs: 'any?'}},
  '/extension/pick-choice': {auth: 'token', handles: [L('server-routes.js'), L('server-pages.js')],
    request: {label: 'string', value: 'string?', options: 'array', searchable: 'boolean?', tried: 'array?', consent: 'boolean?', forget: 'boolean?'}, response: {choice: 'string?'}},
  '/extension/dismiss-popup': {auth: 'token', open: true, handles: [L('server-routes.js'), L('server-pages.js')], request: {text: 'string', buttons: 'array', forget: 'boolean?'}, response: {button: 'string?'}},
  '/extension/pick-upload': {auth: 'token', handles: [L('server-routes.js'), L('server-pages.js')], request: {titles: 'array'}, response: {title: 'string?'}},
  '/extension/confirmation': {auth: 'token', handles: [L('server-routes.js'), L('server-pages.js')],
    request: {job: 'string?', page: 'string', title: 'string?', headings: 'any?', text: 'string?', inputs: 'any?', background: 'any?'},
    response: {confirmation: 'boolean', manual: 'boolean?', reason: 'string?', error: 'string?', ok: 'boolean?'}},
  '/extension/site-password': {auth: 'origin', handles: [L('server-routes.js'), L('ext-server-handlers.js')], request: {host: 'string', peek: 'boolean?', session: 'string?', job: 'string?', url: 'string?', boot: 'string?'},
    response: {ok: 'boolean', password: 'string?', mode: 'string?', email: 'string?', automation: 'string?', session: 'string?'}},
  '/extension/account-code': {auth: 'origin', open: true, handles: [L('server-routes.js'), L('ext-server-handlers.js'), L('account-confirm.js')], request: {host: 'string', needs: 'string?'},
    unread: ['needs'], response: {code: 'string?', why: 'string?'}},
  '/extension/visit-read': {auth: 'token', handles: [L('server-routes.js'), L('ext-server-handlers.js'), L('visits.js'), 'src/desktop.py', 'src/sources/visits_read.py'],
    request: {session: 'string?', ticket: 'string?', url: 'string', title: 'string?', html: 'string', cards: 'any?', knownList: 'any?', place: 'string?'}, response: {ok: 'boolean', error: 'string?', jobs: 'any?', added: 'any?', name: 'string?', placed: 'any?', in_places: 'any?'}},
  '/extension/visit-filters': {auth: 'token', handles: [L('server-routes.js'), L('ext-server-handlers.js'), L('visits.js')], request: {url: 'string', title: 'string?', controls: 'array?', ticket: 'string?'}, response: {ok: 'boolean', error: 'string?', steps: 'any?'}},
  '/extension/visit-understand': {auth: 'token', open: 'an outline of the page', handles: [L('ext-server-handlers.js'), L('visits.js')], request: {ticket: 'string?'}, response: {}},
  '/extension/visit-unblock': {auth: 'token', open: 'a page', handles: [L('ext-server-handlers.js'), L('visits.js')], request: {ticket: 'string?'}, response: {}},
  '/extension/visit-recipe': {auth: 'token', handles: [L('ext-server-handlers.js'), L('visits.js')], request: {url: 'string', forget: 'boolean?', missed: 'boolean?'}, response: {recipe: 'any?', forgot: 'any?'}},
  '/extension/visit-jobpage': {auth: 'token', handles: [L('ext-server-handlers.js'), L('visits.js')], request: {url: 'string', html: 'string', ticket: 'string?'}, response: {}},
  '/extension/visit-done': {auth: 'token', open: true, handles: [L('ext-server-handlers.js'), L('visits.js')], request: {url: 'string', ticket: 'string?', jobs: 'number?', pages: 'number?', stopped: 'any?'}, response: {}},
  '/extension/visit-waiting': {auth: 'token', handles: [L('ext-server-handlers.js'), L('visits.js')], request: {url: 'string', ticket: 'string?', why: 'string'}, response: {}},
  '/extension/visit-state': {auth: 'token', handles: [L('ext-server-handlers.js'), L('visits.js')], request: {ticket: 'string', words: 'string'}, response: {}},
  '/extension/posting': {auth: 'token', open: 'a posting page', handles: [L('ext-server-handlers.js'), L('visits.js')], request: {ticket: 'string?'}, response: {saved: 'any?'}},
  '/extension/background-apply': {auth: 'token', open: true, handles: [L('apply-handlers.js'), L('background-apply-controller.js')], request: {owner: 'string?', session: 'string?', action: 'string?'},
    response: {ok: 'boolean?', jobs: 'any?', closes: 'any?', handoffs: 'any?', checks: 'any?'}},
  '/extension/linkedin-session': {auth: 'token', handles: [L('linkedin-handlers.js')], request: {cookies: 'array'}, response: {}},
  '/extension/linkedin-pending': {auth: 'token', handles: [L('linkedin-handlers.js')], request: {}, response: {revoke: 'boolean', refresh: 'boolean'}},
  '/extension/linkedin-refresh': {auth: 'token', handles: [L('linkedin-handlers.js')], request: {cookies: 'array?', held: 'boolean?'}, response: {}},
  '/extension/ready-handoff': {auth: 'token', handles: [L('ready-handlers.js')], request: {url: 'string'}, response: {handoff: 'any?'}},
  '/extension/report-form': {auth: 'token', open: 'action: state | submit | ...', handles: [L('report-handlers.js')], request: {}, response: {enabled: 'boolean?', ok: 'boolean?'}},
  '/extension/refused-queue': {auth: 'token', handles: [L('refused-reads-handlers.js'), L('refused-reads.js')], request: {allowed: 'boolean', incognito: 'boolean'}, response: {on: 'any?', sites: 'any?', openDetails: 'any?', showCheck: 'any?', pending: 'any?'}},
  '/extension/refused-pending': {auth: 'token', handles: [L('refused-reads-handlers.js'), L('refused-reads.js')], request: {}, response: {pending: 'any', openDetails: 'any?', showCheck: 'any?'}},
  '/extension/refused-judge': {auth: 'token', open: 'a fetched page', handles: [L('refused-reads-handlers.js')], request: {}, response: {}},
  '/extension/refused-outcome': {auth: 'token', open: true, handles: [L('refused-reads-handlers.js'), L('refused-reads.js')], request: {url: 'string?', status: 'number?', html: 'string?', step: 'string?'}, response: {stop: 'any?'}},
  '/extension/refused-done': {auth: 'token', handles: [L('refused-reads-handlers.js')], request: {}, response: {}},
  // Served by app-core/src/extension.js (in the app too: desktop/lib/server.js handleExtension).
  '/extension/me': {auth: 'token', by: 'worker', method: 'GET', handles: [L('server-contact.js')], request: {url: 'string'}, response: {contact: 'any?', resume: 'any?', acceptConsents: 'boolean?'}},
  '/extension/kit': {auth: 'token', by: 'worker', method: 'GET', handles: ['app-core/src/extension.js'], request: {url: 'string'}, response: {kit: 'any?', job: 'any?'}},
  '/extension/answer': {auth: 'token', by: 'worker', open: true, readIn: ['extension/fill-tab-finish.js', 'extension/fill-tab-inputs.js'], handles: ['app-core/src/extension.js'], request: {url: 'string', fields: 'array', page_text: 'string?', test: 'boolean?'}, response: {answers: 'array?', eligible: 'boolean?', error: 'string?'}},
  '/extension/review-answer': {auth: 'token', by: 'worker', handles: ['app-core/src/extension.js'], request: {url: 'string', question: 'string', text: 'string'}, response: {ok: 'boolean?', error: 'string?'}},
  '/extension/run': {auth: 'token', by: 'worker', open: 'a run record (fill-tab-finish.js runBody)', handles: ['app-core/src/extension.js'], request: {url: 'string?', update: 'string?'}, response: {url: 'string?', id: 'string?'}},
  '/extension/applied': {auth: 'token', by: 'worker', calledBy: 'the daily workflow (apply mode), by URL: no sender in extension/', handles: ['app-core/src/extension.js'], request: {url: 'string', why: 'string?', evidence: 'object?'}, response: {}},
  '/extension/log': {auth: 'token', by: 'worker', handles: ['app-core/src/extension.js'], request: {entries: 'array'}, response: {ok: 'boolean', kept: 'number'}},
};

/** Events the extension reports through POST /extension/event: type -> its fields (besides `type`). One row per `event.type === '...'` in the app. */
export const events = {
  'fill-started': {url: 'string'},
  'fill-done': {url: 'string', filled: 'number', left: 'number'},
  'stuck': {url: 'string', host: 'string', why: 'string', needs: 'string?', accountStep: 'string?', tab: 'number', session: 'string?', boot: 'string?', page: 'string?'},
  'account-pressed': {host: 'string', url: 'string?', job: 'string?', state: 'string', session: 'string?', boot: 'string?'},
  'account-fact': {fact: 'string', text: 'string?', host: 'string?', url: 'string?', job: 'string?', session: 'string?', boot: 'string?'},
  'ai-failed': {url: 'string?', host: 'string', why: 'string'},
  'take-over': {url: 'string', page: 'string?', host: 'string?', consent: 'boolean?'},
  'claude-auto': {on: 'boolean'},
  'page': {page: 'string', session: 'string?', tab: 'number'},
  'stopped': {reason: 'string'},
  'started': {tab: 'number', who: 'string?'},
};

const typeOk = (word, value) => word === 'any' || (word === 'array' ? Array.isArray(value) : word === 'object' ? !!value && typeof value === 'object' && !Array.isArray(value) : typeof value === word);

/** -> [message] of everything wrong with `value` against a fields table {name: 'type' | 'type?'}; open allows keys the table does not list. [] = valid. */
export function check(fields, value, {open = false, what = 'message'} = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [`${what} is not an object`];
  const problems = [];
  for (const [name, spec] of Object.entries(fields)) {
    const optional = spec.endsWith('?'), word = spec.replace('?', '');
    if (value[name] === undefined) { if (!optional) problems.push(`${what} is missing ${name}`); continue; }
    if (!typeOk(word, value[name])) problems.push(`${what} field ${name} should be ${word}`);
  }
  if (!open) for (const name of Object.keys(value)) if (!(name in fields)) problems.push(`${what} has unknown field ${name}`);
  return problems;
}

/** -> [message] for a request body to `route` (for an event, its type's table decides). */
export function validateRequest(route, body) {
  const entry = routes[route];
  if (!entry) return [`unknown route ${route}`];
  if (route !== '/extension/event') return check(entry.request || {}, body, {open: !!entry.open, what: `${route} request`});
  const fields = events[body?.type];
  return fields ? check({type: 'string', ...fields}, body, {what: `event ${body.type}`}) : [`unknown event type ${body?.type}`];
}

/** -> [message] for the answer of `route`. Answers may carry more than is listed (the extension reads only what is listed), so only listed fields are judged. */
export function validateResponse(route, body) {
  const entry = routes[route];
  return entry ? check(entry.response || {}, body, {open: true, what: `${route} response`}) : [`unknown route ${route}`];
}
