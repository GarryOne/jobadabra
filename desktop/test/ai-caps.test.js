// A Free AI line reached stops every AI start and opens the top-up dialog (owner, 26 Oct 2026: "show this popup whenever, on every action that requires AI and their cap
// is reached ... before they reached 60 days or 20 applications"): lib/ai-caps.js asks the site before a press, after a run and on a refused call; app-allowance refuses;
// the API engine stops a call on a known line; every start handler asks the site first. Only fake keys and a fake site.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import {createAiCaps} from '../lib/ai-caps.js';
import {createAppAllowance} from '../lib/app-allowance.js';
import {createPlan} from '../lib/plan.js';
import {AnthropicApi} from '../lib/ai/anthropic-api.js';
import {onRefused, setGate} from '../lib/ai/refusals.js';

const storage = (settings = {}) => { let s = settings; return {settings: () => s, saveSettings: p => { s = {...s, ...p}; }, secret: () => '', setSecret() {}}; };
const DAY_LINE = {lane: 'free', capped: 'day', message: "You reached today's Free AI use.", resetsAt: new Date(Date.now() + 3600000).toISOString()};
const site = answers => { const plan = {asked: 0, caps: async () => { plan.asked += 1; return answers.shift() ?? null; }}; return plan; };

test('the plan asks GET /api/ai/caps with the install key; a site without the route or offline is no answer', async () => {
  const seen = [];
  const fetcher = async (url, init) => { seen.push({url: String(url), init}); return String(url).endsWith('/install-token') ? Response.json({ok: true, token: 'tk'}) : Response.json({ok: true, ...DAY_LINE}); };
  assert.deepEqual(await createPlan(storage({telemetryId: 'inst-1'}), {fetcher}).caps(), {lane: 'free', capped: 'day', message: DAY_LINE.message, resetsAt: DAY_LINE.resetsAt});
  assert.equal(seen.at(-1).init.headers['x-api-key'], 'JPF1.inst-1.tk');
  assert.match(seen.at(-1).url, /\/api\/ai\/caps$/);
  assert.equal(await createPlan(storage(), {fetcher: async url => (String(url).endsWith('/install-token') ? Response.json({ok: true, token: 'tk'}) : new Response('', {status: 404}))}).caps(), null);
  assert.equal(await createPlan(storage(), {fetcher: async () => { throw new Error('offline'); }}).caps(), null);
});

test('a line holds until its reset; a press asks at most once a minute and quietly; a run\'s end tells the window', async () => {
  let now = Date.now();
  const plan = site([DAY_LINE, DAY_LINE, {lane: 'free', capped: null}]), told = [];
  const caps = createAiCaps({getStorage: () => storage({aiFree: true}), getPlan: () => plan, now: () => now, onCapped: cap => told.push(cap.capped)});
  assert.equal((await caps.check({quiet: true})).capped, 'day');
  assert.deepEqual(told, [], 'a press says it itself (its refusal opens the dialog)');
  await caps.check({quiet: true});
  assert.equal(plan.asked, 1, 'asked again only after a minute');
  now += 61_000;
  caps.forget(); await caps.check();
  assert.deepEqual(told, ['day'], 'found in the background: the window is told');
  now += 61_000;
  assert.equal(await caps.check(), null, 'open again');
  const own = createAiCaps({getStorage: () => storage({aiEngine: 'api'}), getPlan: () => site([DAY_LINE])});
  assert.equal(await own.check(), null, 'an own key has no Free line');
  now = Date.parse(DAY_LINE.resetsAt) + 1;
  const reset = createAiCaps({getStorage: () => storage({aiFree: true}), getPlan: () => site([DAY_LINE]), now: () => now - 7_200_000});
  await reset.check();
  assert.equal(reset.known().capped, 'day');
});

test('a reached line refuses every new AI start with its words; Check mail too, never for the trial\'s end', async () => {
  const st = storage({aiFree: true}), sent = [];
  const out = createAppAllowance({DEMO: false, getLicense: () => ({state: () => ({licensed: false, used: 3, limit: 20, daysLeft: 40, ended: false})}), log() {}, getStorage: () => st, getTelemetry: () => null, toWindow: (...args) => sent.push(args)});
  out.getPlan().caps = async () => DAY_LINE;
  assert.equal(out.allowanceBlock(), null, 'nothing known yet');
  const refused = await out.allowanceGate();
  assert.deepEqual([refused.ok, refused.credit, refused.cap, refused.resetsAt, refused.error], [false, true, 'day', DAY_LINE.resetsAt, DAY_LINE.message]);
  assert.equal((await out.aiGate()).cap, 'day');
  const trialOver = createAppAllowance({DEMO: false, getLicense: () => ({state: () => ({licensed: false, used: 25, limit: 20, daysLeft: 0, ended: true})}), log() {}, getStorage: () => st, getTelemetry: () => null, toWindow() {}});
  trialOver.getPlan().caps = async () => null;
  assert.equal(await trialOver.aiGate(), null, 'Check mail still runs after the trial');
  assert.equal((await trialOver.allowanceGate()).allowance, true);
});

test('the API engine stops a call on a known line before it goes out, and hears a refused one', async () => {
  const heard = [], stop = onRefused(event => heard.push(event));
  let calls = 0;
  const sdk = key => ({apiKey: key, messages: {create: async () => { calls += 1; throw Object.assign(new Error('rate'), {status: 429}); }}});
  try {
    setGate(() => ({capped: 'day', message: DAY_LINE.message}));
    await assert.rejects(new AnthropicApi({sdk: sdk('JPF1.inst.tk')}).complete({params: {}}), error => error.aiLimit && error.final && error.message === DAY_LINE.message);
    assert.equal(calls, 0, 'nothing sent');
    assert.equal(heard[0].cap.capped, 'day', 'the window is told (the dialog)');
    await assert.rejects(new AnthropicApi({sdk: sdk('sk-ant-own')}).complete({params: {}}), /rate/);
    assert.equal(calls, 1, 'an own key is never stopped by a Free line');
    assert.equal(heard.at(-1).status, 429, 'a refused call is heard');
  } finally { stop(); setGate(null); }
});

// The class: every IPC handler that refuses a new start asks the site first (await), and main hands those handlers the asking gate. (lib/visits-handlers.js checks the
// allowance only mid-run, before scoring what was read: the sync known line is right there.)
test('every start handler awaits the gate, and main passes allowanceGate / aiGate to them', () => {
  const read = file => fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
  let handlers = 0;
  const starts = ['jobs', 'job-actions', 'kit', 'apply'];
  const gated = fs.readdirSync(new URL('../lib/', import.meta.url)).filter(name => name.endsWith('-handlers.js') && /\ballowanceBlock\(\)|\baiGate\(\)/.test(read(`lib/${name}`)));
  assert.deepEqual(gated.filter(name => !starts.includes(name.replace('-handlers.js', ''))), ['visits-handlers.js'], 'a new file that refuses starts: add it to starts and pass it allowanceGate in main');
  for (const file of starts.map(name => `lib/${name}-handlers.js`)) {
    for (const [part, , name] of read(file).matchAll(/^( *)ipcMain\.handle\('(\w+)'[\s\S]*?(?=\n\1(?![\s}])|(?![\s\S]))/gm)) {
      for (const call of part.matchAll(/(await )?\b(allowanceBlock|aiGate)\(\)/g)) { handlers += 1; assert.ok(call[1], `${file} ${name}: await ${call[2]}() so it asks the site where Free AI stands`); }
    }
  }
  assert.ok(handlers >= 6, `the scan reads the handlers (positive control): ${handlers}`);
  const main = read('main.js');
  for (const register of ['registerJobsHandlers', 'registerJobActionsHandlers', 'registerKitHandlers', 'registerApplyHandlers']) {
    assert.match(main.split(`${register}({`)[1].split('\n')[0], /allowanceBlock: allowanceGate/, `${register} gets the asking gate`);
  }
  assert.match(main, /registerJobsHandlers\(\{[^\n]*\baiGate\b/);
  assert.match(main, /watchAiCaps\(\)/, 'main listens for runs and refused calls');
  assert.match(read('lib/jobs-handlers.js'), /'checkMail', async \(\) => \(await aiGate\(\)\)/);
});
