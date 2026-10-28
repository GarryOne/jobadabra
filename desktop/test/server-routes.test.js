// Characterize the local HTTP route order, access checks, replies and callback effects without live services.
import assert from 'node:assert/strict';
import {once} from 'node:events';
import http from 'node:http';
import {registerHooks} from 'node:module';
import {test} from 'node:test';

// Replace service boundaries before importing the server; the real HTTP listener and shared worker fallback remain.
const calls = [];
const state = {calls, cached: true, rejectJobs: false, failRender: false};
globalThis.__serverRouteTest = state;
const stubs = {
  'apply.js': `export const isFormOf = (a, b) => a === b + '/apply';`,
  'log.js': `export const log = (...args) => globalThis.__serverRouteTest.calls.push(['log', ...args]);`,
  'pipeline.js': `export const REPO = 'fixture'; export const jobs = async () => {
    const s = globalThis.__serverRouteTest; s.calls.push(['jobs']);
    if (s.rejectJobs) throw Error('jobs failed');
    return {jobs: [{url:'https://jobs.test/1', title:'Engineer', company:'Fixture'}]};
  };`,
  'view-cache.js': `export const recall = () => globalThis.__serverRouteTest.cached ? {result:{jobs:[{url:'https://jobs.test/1', title:'Engineer', company:'Fixture'}]}} : null;`,
  'build-state.js': `export const extensionBuild = () => ({version:'fixture'});`,
  'build-handlers.js': `export const packagedBuild = () => null;`,
  'server-contact.js': `export const kept = () => {}; export const contactSaved = () => {};
    export const me = async (_s, url) => ({contact:url});`,
  'server-env.js': `
    export const extensionToken = s => s.secret('EXTENSION_TOKEN');
    export const localEnv = s => ({EXTENSION_TOKEN: extensionToken(s)});
    const tickets = new Map();
    export const issueTicket = job => { const ticket = 'ticket-' + tickets.size; tickets.set(ticket,job); return ticket; };
    export const checkTicket = (ticket,job) => tickets.has(ticket) && tickets.get(ticket) === job;
    export const latestExtension = () => 'fixture'; export const developmentCopy = () => false;
    export const extensionChangedNote = () => ({}); export const newestExtensionFile = () => 0;
    export const noteExtensionId = id => globalThis.__serverRouteTest.calls.push(['extension-id',id]);
    export const staleExtension = () => ''; export const sessionSubmitted = () => {};
    export const APPLIED = []; export const appliedSessions = () => []; export const reconcileAppliedSessions = () => [];
  `,
  'server-pages.js': `
    export const pageKey = url => String(url || '').split('#')[0];
    export const sessionOfJob = url => url ? 'session-1' : '';
    export const markReportedConfirmations = async (_s, urls) => { globalThis.__serverRouteTest.calls.push(['confirmations',urls]); };
    ${['judgeConfirmation', 'decidePageKind', 'decideAccountJudge', 'decideEscalation', 'pickUploadSlot', 'pickChoice', 'pickPopup'].map(name => `export const ${name} = async (_s, payload) => ({by:'${name}',payload});`).join('\n')}
  `,
};
const lib = new URL('../lib/', import.meta.url).href;
registerHooks({load(url, context, next) {
  const name = url.slice(lib.length);
  if (url.startsWith(lib) && Object.hasOwn(stubs, name)) return {format: 'module', source: stubs[name], shortCircuit: true};
  return next(url, context);
}});

// Reserve a test port before importing PORT, so the owner's fixed port is never used.
const probe = http.createServer().listen(0, '127.0.0.1');
await once(probe, 'listening');
process.env.JOB_PILOTTO_PORT = String(probe.address().port);
await new Promise(resolve => probe.close(resolve));
const server = await import('../lib/server.js');
const pageRender = await import('../lib/page-render.js');
const hooks = await import('../lib/server-hooks.js');
const origin = 'chrome-extension://gpffoneapcfceflfmfgedkcfbommgcfk';
const foreign = 'https://foreign.test';
const token = 'route-token';
const storage = {secret: name => { assert.equal(name, 'EXTENSION_TOKEN'); return token; }};
const cors = {'content-type': 'application/json', 'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST, OPTIONS', 'access-control-allow-headers': 'Authorization, Content-Type'};
const jsonHeaders = {'content-type': 'application/json'};
const recordedHeaders = ['content-type', 'access-control-allow-origin', 'access-control-allow-methods', 'access-control-allow-headers', 'vary'];

// Send bytes through the actual server, including malformed JSON and methods browsers normally restrict.
function request(url, {method = 'POST', auth = token, from = origin, body = '{}', headers = {}} = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({host: '127.0.0.1', port: server.PORT, path: url, method,
      headers: {'Content-Length': Buffer.byteLength(body), ...(auth === null ? {} : {Authorization: `Bearer ${auth}`}), ...(from === null ? {} : {Origin: from}), ...headers}}, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve({status: res.statusCode,
        headers: Object.fromEntries(recordedHeaders.filter(key => res.headers[key] !== undefined).map(key => [key, res.headers[key]])),
        body: Buffer.concat(chunks).toString()}));
    });
    req.on('error', reject);
    req.end(body);
  });
}

// Compare the complete JSON body and all access-control headers, including absent ones.
function reply(actual, status, body, headers = cors) {
  assert.deepEqual(actual, {status, headers, body: body === undefined ? '' : JSON.stringify(body)});
}

test('every local route preserves its access, malformed-body, method and preflight contract', async t => {
  const running = server.start(storage);
  await once(running, 'listening');
  t.after(() => new Promise(resolve => running.close(resolve)));
  for (const [setter, name, answer] of [
    ['setOpenHandler', 'open', true], ['setJoinHandler', 'join', ['armed']], ['setFocusHandler', 'focus', {focused:true}],
    ['setLearnedHandler', 'learned'], ['setControlsHandler', 'controls'], ['setMissesHandler', 'misses'],
    ['setRememberHandler', 'remember', {field:false}], ['setRecipesHandler', 'recipes', {recipe:1}],
    ['setAliasesHandler', 'aliases', ['alias']], ['setVisitHandler', 'visit', {read:true}],
    ['setVisitFilters', 'filters', {filters:true}], ['setSitePasswordHandler', 'password', {password:'fake'}],
    ['setAccountCodeHandler', 'code', {code:'fake'}], ['setReviewHandler', 'review', {review:true}],
  ]) server[setter](payload => { calls.push([name,payload]); return answer; });
  server.setVisitRoute('/extension/visit-extra', payload => { calls.push(['extra',payload]); return {extra:true}; });
  server.setTabsHandler(payload => { calls.push(['tabs',payload]); return ['read-again']; });
  server.setRenderer(async (url, agent) => {
    calls.push(['render',url,agent]);
    if (state.failRender) throw Error('render failed');
    return {html:url,agent};
  });
  server.setSessionReporter((...args) => calls.push(['session',...args]));
  server.setNotifier((...args) => calls.push(['notify',...args]));
  for (const name of ['Stopped', 'Started', 'Page', 'Stuck', 'AccountPressed', 'TakeOver', 'ClaudeAuto', 'AccountFact', 'FormIssue']) {
    server[`set${name}Handler`](payload => calls.push([name,payload]));
  }

  const cases = [
    ['/extension/ticket', {ok:false,error:'Unknown or expired ticket'}, {ok:false,error:'Wrong token'}, 403],
    ['/extension/tabs', {ok:true,latest:'fixture',build:{version:'fixture'},reread:['read-again']}, {ok:false}],
    ['/extension/open', {ok:true}, {ok:false}], ['/extension/join', {ok:true,arm:['armed']}, {ok:false}],
    ['/extension/focus', {focused:true}, {ok:false}], ['/extension/learned', {ok:true}, {ok:false}],
    ['/extension/remember', {remember:{field:false}}, {error:'Wrong token'}],
    ['/extension/recipes', {recipes:{recipe:1}}, {error:'Wrong token'}],
    ['/extension/aliases', {aliases:['alias']}, {error:'Wrong token'}],
    ['/extension/controls', {ok:true}, {ok:false}], ['/extension/misses', {ok:true}, {ok:false}],
    ['/extension/visit-read', {read:true}, {ok:false,error:'Wrong token'}],
    ['/extension/visit-filters', {filters:true}, {ok:false,error:'Wrong token'}],
    ['/extension/visit-extra', {extra:true}, {ok:false,error:'Wrong token'}],
    ['/extension/site-password', {password:'fake'}, {error:'Wrong token'}],
    ['/extension/account-code', {code:'fake'}, {error:'Wrong token'}],
    ['/extension/review', {review:true}, {error:'Wrong token'}], ['/extension/event', {ok:true}, {ok:false}],
    ...Object.entries({'page-kind':'decidePageKind', 'pick-choice':'pickChoice', 'dismiss-popup':'pickPopup',
      'pick-upload':'pickUploadSlot', 'account-judge':'decideAccountJudge', escalate:'decideEscalation', confirmation:'judgeConfirmation'})
      .map(([route,by]) => [`/extension/${route}`, {by,payload:{}}, {ok:false,...(route === 'confirmation' ? {confirmation:false} : {kind:''}),error:'Wrong token'}]),
    ['/extension/me', {contact:''}, {error:'Wrong token: open the extension settings and Connect again'}],
    ['/extension/me?url=job', {contact:'job'}, {error:'Wrong token: open the extension settings and Connect again'}],
  ];
  for (const [url, good, bad, denied = 401] of cases) await t.test(url, async () => {
    const secret = ['/extension/site-password','/extension/account-code'].includes(url);
    const headers = {...cors, ...(secret ? {'access-control-allow-origin':origin,vary:'Origin'} : {}),
      ...(url.startsWith('/extension/me') ? {'access-control-allow-methods':'GET, OPTIONS'} : {})};
    for (const auth of ['wrong',null]) {
      const before = calls.length;
      reply(await request(url,{auth}),denied,bad,headers);
      assert.equal(calls.length,before,'unauthorized requests do not call handlers');
    }
    reply(await request(url),url === '/extension/ticket' ? 403 : 200,good,headers);
    const malformed = url === '/extension/tabs' ? {ok:true,latest:'fixture',build:{version:'fixture'}} : good;
    reply(await request(url,{body:'{' }),url === '/extension/ticket' ? 403 : 200,malformed,headers);
    reply(await request(url,{method:'DELETE'}),url === '/extension/ticket' ? 403 : 200,good,headers);
    reply(await request(url,{from:foreign}),url === '/extension/ticket' ? 403 : 200,good,headers);
    const {['content-type']: _type,...preflight} = headers;
    reply(await request(url,{method:'OPTIONS',auth:null}),204,undefined,preflight);
  });

  await t.test('the learned acknowledgment ends before the learned handler runs', async t => {
    const order = [], end = http.ServerResponse.prototype.end, learned = hooks.learnedHandler;
    // Observe the actual response boundary rather than inferring ordering from the client's eventual reply.
    t.mock.method(http.ServerResponse.prototype, 'end', function (...args) {
      order.push('end');
      return end.apply(this, args);
    });
    server.setLearnedHandler(payload => { order.push('learned'); return learned(payload); });
    t.after(() => server.setLearnedHandler(learned));
    reply(await request('/extension/learned'),200,{ok:true});
    assert.deepEqual(order,['end','learned']);
  });

  await t.test('pair only checks Origin, even for malformed bodies and wrong methods', async () => {
    for (const auth of [token,'wrong',null]) reply(await request('/extension/pair',{auth,body:'{',method:'DELETE'}),200,
      {url:`http://127.0.0.1:${server.PORT}`,token},{...jsonHeaders,'access-control-allow-origin':origin});
    for (const from of [foreign,null]) reply(await request('/extension/pair',{from}),403,{error:'Only the Jobadabra extension can pair'},jsonHeaders);
  });
  const launcher = {'x-job-pilotto':'launcher'};
  await t.test('render has its own key, method and no-Origin checks; errors retain the catch reply', async () => {
    for (const auth of [token,'wrong',null]) reply(await request('/engine/render',{auth,from:null,headers:{'x-job-pilotto-render':pageRender.TOKEN},body:'{"url":"page"}'}),200,{html:'page',agent:'JobPilotto browser'},jsonHeaders);
    for (const opts of [{headers:{}},{from:foreign},{method:'DELETE'}]) reply(await request('/engine/render',{
      from:null,headers:{'x-job-pilotto-render':pageRender.TOKEN},...opts}),403,{error:'Not allowed'},jsonHeaders);
    reply(await request('/engine/render',{from:null,headers:{'x-job-pilotto-render':pageRender.TOKEN},body:'{'}),200,{html:'',agent:'JobPilotto browser'},jsonHeaders);
    state.failRender = true;
    reply(await request('/engine/render',{from:null,headers:{'x-job-pilotto-render':pageRender.TOKEN}}),500,{error:'render failed'},jsonHeaders);
    state.failRender = false;
    server.setRenderer(null);
    reply(await request('/engine/render',{from:null,headers:{'x-job-pilotto-render':pageRender.TOKEN}}),403,{error:'Not allowed'},jsonHeaders);
  });
  await t.test('launcher routes ignore extension tokens and enforce local headers, Origin and method', async () => {
    for (const [url,body,bad] of [['/claude/ticket','{"job":"job"}',{error:'Not allowed'}],
      ['/claude/session?id=s&event=done','{"message":"hello","transcript_path":"file"}',{ok:false}],
      ['/claude/notify','message=hello&job=Engineer',{ok:false}]]) {
      for (const opts of [{headers:{}},{from:foreign},{method:'DELETE'}]) reply(await request(url,{from:null,headers:launcher,body,...opts}),403,bad,jsonHeaders);
      for (const auth of [token,'wrong',null]) {
        const result = await request(url,{from:null,headers:launcher,body,auth});
        if (url === '/claude/ticket') {
          assert.match(JSON.parse(result.body).ticket,/^ticket-\d+$/);
          assert.equal(result.status,200); assert.deepEqual(result.headers,jsonHeaders);
        } else reply(result,200,{ok:true},jsonHeaders);
      }
      reply(await request(url,{from:null,headers:launcher,body:'{'}),url.startsWith('/claude/session') ? 200 : 403,
        url.startsWith('/claude/session') ? {ok:true} : bad,jsonHeaders);
    }
    const issued = JSON.parse((await request('/claude/ticket',{from:null,headers:launcher,body:'{"job":"job"}'})).body).ticket;
    reply(await request('/extension/ticket',{body:JSON.stringify({ticket:issued,job:'job'})}),200,{ok:true});
    await request('/claude/session?id=s&event=done',{from:null,headers:launcher,body:'message=encoded'});
    assert.deepEqual(calls.at(-1),['session','s',{event:'done',message:'encoded',transcript:''}]);
  });
  await t.test('dynamic visits retain precedence over later routes but not earlier routes', async () => {
    server.setVisitRoute('/extension/me',() => ({shadow:true}));
    server.setVisitRoute('/extension/open',() => ({shadow:true}));
    reply(await request('/extension/me'),200,{shadow:true});
    reply(await request('/extension/me?url=job'),200,{contact:'job'},{...cors,'access-control-allow-methods':'GET, OPTIONS'});
    reply(await request('/extension/open'),200,{ok:true});
    delete hooks.visitMore['/extension/me']; delete hooks.visitMore['/extension/open'];
  });
  await t.test('unknown paths and near-matches keep the shared worker fallback', async () => {
    const headers = {...cors,'access-control-allow-methods':'GET, POST, OPTIONS'};
    for (const url of ['/unknown','/extension/me-extra','/claude/session','/extension/open?x=1']) {
      reply(await request(url),404,{error:'not found'},headers);
      for (const auth of ['wrong',null]) reply(await request(url,{auth}),401,{error:'unauthorized'},headers);
      reply(await request(url,{body:'{',method:'DELETE'}),404,{error:'not found'},headers);
    }
  });
  await t.test('event branches preserve callbacks, cached/fresh lookup and notifications', async () => {
    for (const [type,name] of [['stopped','Stopped'],['started','Started'],['page','Page'],['stuck','Stuck'],
      ['account-pressed','AccountPressed'],['take-over','TakeOver'],['claude-auto','ClaudeAuto'],['account-fact','AccountFact'],['ai-failed','FormIssue']]) {
      calls.length = 0;
      const event = {type,url:'https://jobs.test/1',host:'jobs.test',why:'failed'};
      reply(await request('/extension/event',{body:JSON.stringify(event)}),200,{ok:true});
      assert.equal(calls.at(-1)[0],name);
      if (type === 'take-over') assert.deepEqual(calls.at(-1)[1],{...event,job:{url:event.url,title:'Engineer',company:'Fixture'}});
      assert.ok(!calls.some(call => call[0] === 'jobs'),'cached job avoids the fresh read');
    }
    for (const [type,left,title,tone] of [['fill-started',0,'Filling the application…','info'],
      ['fill-done',0,'Form filled ✓','good'],['fill-done',2,'Form filled: a few things left for you','warn']]) {
      calls.length = 0;
      await request('/extension/event',{body:JSON.stringify({type,url:'https://jobs.test/1',filled:3,left})});
      assert.deepEqual(calls.at(-1),['notify',title,type === 'fill-started' ? 'Engineer · Fixture. Check every field before you submit.' :
        `Engineer · Fixture: 3 field(s) filled${left ? ', 2 left (listed on the page)' : ''}. Review, then submit.`,{view:'sessions',session:'session-1'},tone]);
    }
    state.cached = false;
    calls.length = 0;
    await request('/extension/event',{body:'{"type":"take-over","url":"https://jobs.test/1/apply"}'});
    assert.equal(calls[0][0],'jobs'); assert.equal(calls[1][1].job.company,'Fixture');
    state.rejectJobs = true;
    await request('/extension/event',{body:'{"type":"take-over","url":"missing"}'});
    assert.equal(calls.at(-1)[1].job,undefined);
  });
});
