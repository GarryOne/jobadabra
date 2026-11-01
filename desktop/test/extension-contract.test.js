// Both sides of the extension <-> app seam are checked against desktop/lib/extension-contract.js: what the extension sends, what the app reads, what it answers, and the events.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {routes, events, check, validateRequest, validateResponse} from '../lib/extension-contract.js';
import {extensionCalls, extensionFiles, codeOf, readsWord} from './extension-scan.js';

const CONTRACT = 'desktop/lib/extension-contract.js';
const TABLES = ['extension/read-gen.js'];   // route names in lookup tables, not calls
const calls = extensionCalls(extensionFiles().filter(file => !TABLES.includes(file)));
const sentBy = route => [...new Set(calls.filter(c => c.route === route).map(c => c.file))];
const names = fields => Object.keys(fields || {});
const required = fields => names(fields).filter(name => !fields[name].endsWith('?'));
const literalsOf = (file, re) => [...codeOf(file).matchAll(re)].map(m => m[1]);

test('every route the extension calls is in the contract, and every contract route has a caller (or says who calls it)', () => {
  const sent = new Set(calls.map(c => c.route)), listed = new Set(Object.keys(routes));
  const unlisted = [...sent].filter(route => !listed.has(route)).map(route => `${route} (${sentBy(route).join(', ')})`);
  assert.deepEqual(unlisted, [], `the extension calls routes that ${CONTRACT} does not list`);
  const dead = [...listed].filter(route => !sent.has(route) && !routes[route].calledBy);
  assert.deepEqual(dead, [], `${CONTRACT} lists routes no extension file calls (name a calledBy, or remove them)`);
});

test('every route the app or worker serves is in the contract, and every contract route is served', () => {
  const served = new Set([
    ...literalsOf('desktop/lib/server-routes.js', /'(\/extension\/[a-z-]+)'/g),
    ...literalsOf('desktop/lib/server.js', /'(\/extension\/[a-z-]+)'/g),
    ...extensionFiles('desktop/lib').flatMap(file => literalsOf(file, /setVisitRoute\(\s*'(\/extension\/[a-z-]+)'/g)),
    ...literalsOf('worker/src/extension.js', /pathname === '(\/extension\/[a-z-]+)'/g),
  ]);
  const listed = new Set(Object.keys(routes));
  assert.deepEqual([...served].filter(route => !listed.has(route)), [], `the app serves routes that ${CONTRACT} does not list`);
  assert.deepEqual([...listed].filter(route => !served.has(route)), [], `${CONTRACT} lists routes the app does not serve`);
  for (const [route, entry] of Object.entries(routes)) for (const file of entry.handles) assert.ok(codeOf(file).length > 0, `${route}: handler file ${file} is empty or missing`);
});

test('what the extension sends: every key it builds in place is a listed field, and every required field is there', () => {
  const problems = [];
  for (const call of calls) {
    const entry = routes[call.route], where = `${call.file}:${call.line}`;
    if (!entry || !call.body || call.body.dynamic || call.route === '/extension/event') continue;
    const fields = entry.request || {};
    for (const key of call.body.keys) if (!(key in fields)) problems.push(`${call.route}: ${where} sends "${key}", which ${CONTRACT} does not list`);
    if (!call.body.spread) for (const key of required(fields)) if (!call.body.keys.includes(key)) problems.push(`${call.route}: ${where} does not send required "${key}" (${CONTRACT})`);
  }
  assert.deepEqual(problems, []);
});

test('every request field is built by an extension file and read by an app handler; an unread field says so', () => {
  const problems = [];
  for (const [route, entry] of Object.entries(routes)) {
    const senders = sentBy(route), unread = entry.unread || [];
    for (const field of names(entry.request)) {
      if (senders.length && !readsWord(senders, field)) problems.push(`${route}: no extension file (${senders.join(', ')}) sends "${field}" (${CONTRACT})`);
      const read = readsWord(entry.handles, field);
      if (!unread.includes(field) && !read) problems.push(`${route}: no app handler (${entry.handles.join(', ')}) reads "${field}" (${CONTRACT})`);
      if (unread.includes(field) && read) problems.push(`${route}: "${field}" is marked unread in ${CONTRACT} but ${entry.handles.join(', ')} reads it`);
    }
  }
  assert.deepEqual(problems, []);
});

test('every answer field is built by the app and read by the extension', () => {
  const problems = [];
  for (const [route, entry] of Object.entries(routes)) {
    const senders = sentBy(route), readers = [...senders, ...(entry.readIn || [])];
    for (const field of names(entry.response)) {
      if (!readsWord(entry.handles, field)) problems.push(`${route}: no app handler (${entry.handles.join(', ')}) answers "${field}" (${CONTRACT})`);
      if (senders.length && !readsWord(readers, field)) problems.push(`${route}: no extension file (${readers.join(', ')}) reads "${field}" (${CONTRACT})`);
    }
  }
  assert.deepEqual(problems, []);
});

test('events: the types the extension sends, the app dispatches and the contract lists are the same set, with the same fields', () => {
  const extTypes = new Map();   // type -> [{where, keys, spread}]
  const add = (type, where, keys, spread) => extTypes.set(type, [...(extTypes.get(type) || []), {where, keys, spread}]);
  for (const call of calls.filter(c => c.route === '/extension/event' && c.body && !c.body.dynamic)) {
    const type = /\btype:\s*'([\w-]+)'/.exec(call.body.text)?.[1];
    if (type) add(type, `${call.file}:${call.line}`, call.body.keys.filter(key => key !== 'type'), call.body.spread);
  }
  for (const file of extensionFiles()) for (const m of codeOf(file).matchAll(/\bevent\('([\w-]+)'(?:,\s*(\{[^}]*\}))?/g)) {
    add(m[1], file, ['url', ...(m[2] ? m[2].slice(1, -1).split(',').map(part => part.trim().split(':')[0]).filter(Boolean) : [])], false);
  }
  const appTypes = new Set(['desktop/lib/server.js'].flatMap(file => literalsOf(file, /event\.type === '([\w-]+)'/g)));
  assert.deepEqual([...extTypes.keys()].sort(), Object.keys(events).sort(), `event types the extension sends vs ${CONTRACT}`);
  assert.deepEqual([...appTypes].sort(), Object.keys(events).sort(), `event types the app handles (desktop/lib/server.js) vs ${CONTRACT}`);
  const handlers = ['desktop/lib/server.js', 'desktop/lib/ext-server-handlers.js', 'desktop/lib/apply-handlers.js', 'desktop/lib/page-step.js', 'desktop/lib/session-flow.js', 'desktop/lib/stop-all.js'];
  const problems = [];
  for (const [type, fields] of Object.entries(events)) {
    for (const sent of extTypes.get(type) || []) {
      for (const key of sent.keys) if (!(key in fields)) problems.push(`event ${type}: ${sent.where} sends "${key}", which ${CONTRACT} does not list`);
      if (!sent.spread) for (const key of required(fields)) if (!sent.keys.includes(key)) problems.push(`event ${type}: ${sent.where} does not send required "${key}" (${CONTRACT})`);
    }
    for (const field of names(fields)) if (!readsWord(handlers, field)) problems.push(`event ${type}: no app handler (${handlers.join(', ')}) reads "${field}" (${CONTRACT})`);
  }
  assert.deepEqual(problems, []);
});

// A valid sample for a type word, to build a fixture from the contract alone (a fake extension or fake app builds its messages the same way).
const sample = word => ({string: 's', number: 1, boolean: true, array: [], object: {}, any: 'x'})[word.replace('?', '')];
const fixture = fields => Object.fromEntries(Object.entries(fields).map(([name, spec]) => [name, sample(spec)]));

test('validate: a fixture built from the contract passes; a missing, extra or wrong-typed field is refused by name', () => {
  for (const [route, entry] of Object.entries(routes)) {
    if (route === '/extension/event') continue;
    const body = fixture(entry.request || {});
    assert.deepEqual(validateRequest(route, body), [], route);
    assert.deepEqual(validateResponse(route, fixture(entry.response || {})), [], route);
    for (const name of required(entry.request)) assert.match(validateRequest(route, {...body, [name]: undefined}).join(), new RegExp(`missing ${name}`), `${route} without ${name}`);
    for (const [name, spec] of Object.entries(entry.request || {})) if (spec.replace('?', '') !== 'any') assert.match(validateRequest(route, {...body, [name]: Symbol.iterator}).join(), new RegExp(`field ${name} should be`), `${route} ${name} wrong type`);
    if (!entry.open) assert.match(validateRequest(route, {...body, invented: 1}).join(), /unknown field invented/, `${route} extra field`);
    for (const name of required(entry.response)) assert.match(validateResponse(route, {...fixture(entry.response), [name]: undefined}).join(), new RegExp(`missing ${name}`), `${route} answer without ${name}`);
  }
  for (const [type, fields] of Object.entries(events)) {
    const body = {type, ...fixture(fields)};
    assert.deepEqual(validateRequest('/extension/event', body), [], type);
    assert.match(validateRequest('/extension/event', {...body, invented: 1}).join(), /unknown field invented/, type);
    for (const name of required(fields)) assert.match(validateRequest('/extension/event', {...body, [name]: undefined}).join(), new RegExp(`missing ${name}`), `${type} without ${name}`);
  }
  assert.match(validateRequest('/extension/event', {type: 'invented'}).join(), /unknown event type/);
  assert.match(validateRequest('/extension/nope', {}).join(), /unknown route/);
  assert.deepEqual(check({a: 'string'}, [], {}), ['message is not an object']);
});
