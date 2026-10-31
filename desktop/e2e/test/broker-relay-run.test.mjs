// The central scout's AI on the Codex plan (lib/broker-relay-serve.mjs, broker-relay-run.mjs): the relay answers on 127.0.0.1 only, caps a run, stops at the first budget "no", and a run with failed calls says so.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {startRelay} from '../lib/broker-relay-serve.mjs';
import {childEnv, outcomeOf, runBehindRelay} from '../broker-relay-run.mjs';

const ok = text => ({status: 200, contentType: 'application/json', body: Buffer.from(JSON.stringify({type: 'message', content: [{type: 'text', text}]})), counted: ''});
const no = (status, message) => ({status, contentType: 'application/json', body: Buffer.from(JSON.stringify({type: 'error', error: {type: 'api_error', message}}))});
const post = (relay, body = {model: 'claude-haiku-5-5', messages: []}) => fetch(`${relay.url}/v1/messages`, {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify(body)});

test('the relay listens on 127.0.0.1 only, answers /v1/messages through the broker and nothing else', async () => {
  const relay = await startRelay({answer: async () => ok('hi')});
  try {
    assert.equal(relay.address().address, '127.0.0.1');
    const answer = await post(relay);
    assert.equal(answer.status, 200);
    assert.equal((await answer.json()).content[0].text, 'hi');
    assert.equal((await fetch(`${relay.url}/v1/other`, {method: 'POST', body: '{}'})).status, 404);
    assert.deepEqual([relay.stats.calls, relay.stats.ok, relay.stats.failed], [1, 1, 0]);
  } finally { await relay.close(); }
});

test('past the run\'s cap a call is refused 429 without asking the broker: the item waits, nothing is defaulted', async () => {
  let asked = 0;
  const relay = await startRelay({cap: 2, answer: async () => { asked++; return ok('x'); }});
  try {
    for (let i = 0; i < 4; i++) await post(relay);
    assert.equal(asked, 2);
    const over = await post(relay);
    assert.equal(over.status, 429);
    assert.match((await over.json()).error.message, /AI limit reached: this run's cap of 2 calls/);
    assert.equal(relay.stats.capHit, 3);
    assert.equal(relay.stats.failed, 0, 'a cap reached by design is not a failure');
  } finally { await relay.close(); }
});

test('the broker\'s first budget "no" latches: 429 "AI limit reached" to the engine, then every call is answered at once without the broker', async () => {
  let asked = 0;
  const relay = await startRelay({answer: async () => { asked++; return no(503, 'ai-capped: the Codex broker said no (budget:week 88%); it answers from saved replies'); }});
  try {
    const first = await post(relay);
    assert.equal(first.status, 429);
    assert.match((await first.json()).error.message, /^AI limit reached: the Codex broker said no \(budget:week 88%\)/);
    for (let i = 0; i < 5; i++) assert.equal((await post(relay)).status, 429);
    assert.equal(asked, 1, '1,417 failed calls one by one (run 41192760002) become one');
    assert.equal(relay.stats.failed, 6);
  } finally { await relay.close(); }
});

test('the command gets the relay address, a dummy key and the cap as its limit, and no other AI address or key', () => {
  const env = childEnv({PATH: '/bin', ANTHROPIC_API_KEY: 'sk-real', ANTHROPIC_BASE_URL: 'https://api.anthropic.com', OPENAI_API_KEY: 'sk-o'}, 'http://127.0.0.1:5', 40);
  assert.equal(env.JOB_PILOTTO_AI_BASE_URL, 'http://127.0.0.1:5');
  assert.equal(env.ANTHROPIC_API_KEY, 'codex-relay-local');
  assert.equal(env.JOB_PILOTTO_CENTRAL_MAX_CALLS, '40');
  assert.equal(env.ANTHROPIC_BASE_URL, undefined);
  assert.equal(env.OPENAI_API_KEY, undefined);
  assert.doesNotMatch(JSON.stringify(env), /sk-real|api\.anthropic\.com/);
});

test('a run whose calls fail stays green but says so: warning, summary line, ai-capped.json for the one alert, skipped=true', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'relay-run-'));
  const env = {...process.env, GITHUB_OUTPUT: path.join(dir, 'out'), GITHUB_STEP_SUMMARY: path.join(dir, 'summary')};
  const caller = "const b=JSON.stringify({model:'m',messages:[]});(async()=>{for(let i=0;i<3;i++)await fetch(process.env.JOB_PILOTTO_AI_BASE_URL+'/v1/messages',{method:'POST',body:b});})()";
  const logged = [];
  const log = console.log;
  console.log = (...args) => { logged.push(args.join(' ')); };
  let code;
  try { code = await runBehindRelay({job: 'central-scout', cap: 40, argv: [process.execPath, '-e', caller], env, dir: path.join(dir, 'notes'), answer: async () => no(503, 'ai-capped: the Codex broker said no (budget:week 90%)')}); }
  finally { console.log = log; }
  assert.equal(code, 0, 'the scout still publishes its index');
  assert.ok(logged.some(line => /::warning title=AI skipped \(central-scout\)::AI skipped\/failed: 3 AI calls failed or were refused \(the Codex broker said no \(budget:week 90%25\)\)/.test(line)), logged.join('\n'));
  assert.match(fs.readFileSync(path.join(dir, 'out'), 'utf8'), /skipped=true/);
  assert.match(fs.readFileSync(path.join(dir, 'summary'), 'utf8'), /AI skipped\/failed \(central-scout\)/);
  assert.match(fs.readFileSync(path.join(dir, 'notes', 'ai-capped.json'), 'utf8'), /central-scout: AI skipped\/failed/);
});

test('a run whose calls all answer says nothing is skipped and leaves no note', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'relay-run-'));
  const env = {...process.env, GITHUB_OUTPUT: path.join(dir, 'out')};
  const caller = "(async()=>{const r=await fetch(process.env.JOB_PILOTTO_AI_BASE_URL+'/v1/messages',{method:'POST',body:'{}'});process.exit(r.status===200?0:3)})()";
  const log = console.log;
  console.log = () => {};
  let code;
  try { code = await runBehindRelay({job: 'central-scout', argv: [process.execPath, '-e', caller], env, dir: path.join(dir, 'notes'), answer: async () => ok('fine')}); }
  finally { console.log = log; }
  assert.equal(code, 0);
  assert.equal(fs.existsSync(path.join(dir, 'out')), false);
  assert.equal(outcomeOf({calls: 1, ok: 1, failed: 0, capHit: 0, latched: '', reasons: []}, 'x').why, '');
});

test('the scout step holds no Anthropic secret and no address off this machine; its AI runs behind the relay on the 40-call cap', () => {
  const text = fs.readFileSync(new URL('../../../.github/workflows/central-scout.yml', import.meta.url), 'utf8').replace(/^\s*#.*$/gm, '').replace(/\s#.*$/gm, '');
  assert.doesNotMatch(text, /ANTHROPIC|anthropic/, 'no key, no base URL');
  assert.match(text, /id-token: write/);
  assert.match(text, /CENTRAL_AI_CAP: '40'/);
  assert.match(text, /broker-relay-run\.mjs --job central-scout --cap "\$CENTRAL_AI_CAP" -- python -m src scout/);
  assert.match(text, /steps\.scout\.outputs\.skipped == 'true'/);
});
