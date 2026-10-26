// Every suite or helper that runs the engine's Python itself does it isolated (lib/python.mjs): UTF-8 on Windows too (7 Oct 2026: the pool suite stopped on
// Windows at "'charmap' codec can't decode byte 0x8f"), and never with the shell's environment (9 Oct 2026: personas and employers passed the whole
// process.env, tokens and HOME included, to the engine, which could then follow the app set up on this computer).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {assertIsolated, pythonEnv} from '../lib/python.mjs';
import {evalEnv} from '../suites/mailreading.mjs';

test('the engine runs with UTF-8 mode on, and a suite\'s own variables win', () => {
  assert.equal(pythonEnv().PYTHONUTF8, '1');
  assert.equal(pythonEnv({JOB_PILOTTO_DATA_DIR: '/tmp/x'}).JOB_PILOTTO_DATA_DIR, '/tmp/x');
});

test('no token or key from the shell, no app-following, no .env, and HOME is a temp folder', () => {
  const saved = {...process.env};
  try {
    Object.assign(process.env, {NOTION_TOKEN: 'secret_x', ANTHROPIC_API_KEY: 'sk-x', E2E_NOTION_TOKEN_FOCUS: 'secret_y', GOOGLE_REFRESH_TOKEN: 'r'});
    const env = pythonEnv();
    for (const name of ['NOTION_TOKEN', 'ANTHROPIC_API_KEY', 'E2E_NOTION_TOKEN_FOCUS', 'GOOGLE_REFRESH_TOKEN']) assert.equal(env[name], undefined, `${name} reached the engine`);
    assert.deepEqual([env.JOB_PILOTTO_FOLLOW_APP, env.JOB_PILOTTO_NO_DOTENV], ['0', '1']);
    assert.ok(env.HOME.startsWith(os.tmpdir()) || env.HOME.startsWith(fs.realpathSync(os.tmpdir())), `HOME is ${env.HOME}`);
    assert.notEqual(env.HOME, os.homedir());
  } finally { for (const name of Object.keys(process.env)) if (!(name in saved)) delete process.env[name]; Object.assign(process.env, saved); }
});

test('a key the caller names gets through; a CLI step keeps this computer\'s HOME; anything else is refused', () => {
  assert.equal(pythonEnv({ANTHROPIC_API_KEY: 'sk-test'}).ANTHROPIC_API_KEY, 'sk-test');
  const cli = pythonEnv({}, {realHome: true});
  assert.equal(cli.HOME, os.homedir());
  for (const name of ['JOB_PILOTTO_DATA_DIR', 'JOB_PILOTTO_CONFIG_DIR']) assert.ok(cli[name].startsWith(os.tmpdir()) || cli[name].startsWith(fs.realpathSync(os.tmpdir())), `${name} with the real HOME is ${cli[name]}`);
  assert.throws(() => pythonEnv({JOB_PILOTTO_DATA_DIR: path.join(os.homedir(), 'job-pilotto', 'data')}, {realHome: true}), /DATA_DIR is not a temp folder/, 'the real HOME never comes with the person\'s own data');
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-python-env-'));
  assert.equal(pythonEnv({}, {home: profile}).HOME, profile);
  assert.throws(() => pythonEnv({}, {home: os.homedir()}), /HOME is not a temp folder/);
  assert.throws(() => pythonEnv({JOB_PILOTTO_FOLLOW_APP: '1'}), /FOLLOW_APP is not 0/);
  assert.throws(() => assertIsolated({JOB_PILOTTO_FOLLOW_APP: '0', JOB_PILOTTO_NO_DOTENV: '1', HOME: profile, NOTION_TOKEN: 'x'}), /carries NOTION_TOKEN/);
});

// The class: every Python the e2e code starts (python() or a bare python3/python) passes an explicit env, and no file that starts one spreads process.env.
test('every engine spawn in suites/ and lib/ is isolated', () => {
  const spawns = [];
  for (const dir of ['suites', 'lib']) {
    const folder = new URL(`../${dir}/`, import.meta.url);
    for (const file of fs.readdirSync(folder).filter(name => name.endsWith('.mjs'))) {
      const source = fs.readFileSync(new URL(file, folder), 'utf8');
      if (`${dir}/${file}` === 'lib/python.mjs') continue;   // the one place that defines them
      assert.doesNotMatch(source, /const python = \(\)/, `${dir}/${file} defines its own python(): import it from lib/python.mjs`);
      const lines = source.split('\n').filter(text => /(execFile|execFileSync|spawn|spawnSync)\((python\(\)|'python3?'|process\.env\.E2E_PYTHON)/.test(text));
      if (!lines.length) continue;
      for (const line of lines) {
        spawns.push(`${dir}/${file}`);
        const at = source.indexOf(line), call = source.slice(at, at + 600);
        assert.match(call, /\benv(: |,|\})/, `${dir}/${file} starts Python without an explicit env: ${line.trim().slice(0, 100)}`);
      }
      assert.doesNotMatch(source, /\.\.\.process\.env\b/, `${dir}/${file} starts Python and spreads process.env: use pythonEnv (lib/python.mjs)`);
    }
  }
  const files = new Set(spawns);
  for (const known of ['suites/personas.mjs', 'suites/employers.mjs', 'suites/pool.mjs', 'suites/mailreading.mjs', 'suites/visitread.mjs', 'lib/forget.mjs', 'lib/store-call.mjs']) {
    assert.ok(files.has(known), `the check no longer sees ${known} start Python: ${[...files].join(', ')}`);
  }
});

// mailreading calls the real model, so it is not run to prove this (AI spend needs the owner's OK): its env is checked here instead, per engine.
test('mailreading\'s eval env: only its own key, no shell token, temp data; the real HOME only for a CLI', () => {
  const saved = {...process.env};
  try {
    Object.assign(process.env, {NOTION_TOKEN: 'secret_x', E2E_NOTION_TOKEN: 'secret_y', TELEGRAM_BOT_TOKEN: 't', E2E_OPENAI_KEY: 'sk-openai-test'});
    const tmp = folder => folder.startsWith(os.tmpdir()) || folder.startsWith(fs.realpathSync(os.tmpdir()));
    const leaks = env => Object.keys(env).filter(name => /NOTION|TELEGRAM/.test(name));
    const cli = evalEnv({engine: 'cli', key: 'sk-dummy'});
    assert.deepEqual(leaks(cli), []);
    assert.equal(cli.ANTHROPIC_API_KEY, 'sk-dummy', 'the eval\'s own key, named by the suite, and nothing else');
    assert.equal(cli.HOME, os.homedir(), 'the CLI finds its sign-in');
    assert.ok(tmp(cli.JOB_PILOTTO_DATA_DIR) && tmp(cli.JOB_PILOTTO_CONFIG_DIR), 'its data and config are temp');
    const api = evalEnv({engine: 'api', key: 'sk-dummy'}, 'http://127.0.0.1:9999');
    assert.deepEqual([api.ANTHROPIC_API_KEY, api.ANTHROPIC_BASE_URL, api.OPENAI_API_KEY], ['sk-dummy', 'http://127.0.0.1:9999', undefined]);
    assert.ok(tmp(api.HOME), 'the API engine runs with a temp HOME');
    assert.deepEqual(leaks(api), []);
    assert.equal(cli.JOB_PILOTTO_FOLLOW_APP, '0');
  } finally { for (const name of Object.keys(process.env)) if (!(name in saved)) delete process.env[name]; Object.assign(process.env, saved); }
});

test('a coverage run hands the Python step map\'s recorder to the engine it runs; otherwise no PYTHONPATH gets through', () => {
  const saved = {...process.env};
  try {
    Object.assign(process.env, {PYTHONPATH: '/somewhere'});
    delete process.env.E2E_PY_COVERAGE_DIR;
    assert.deepEqual([pythonEnv().PYTHONPATH, pythonEnv().E2E_PY_COVERAGE_DIR], [undefined, undefined]);
    Object.assign(process.env, {E2E_PY_COVERAGE_DIR: '/tmp/pycov-x', PYTHONPATH: '/repo/desktop/e2e/lib/pycov'});
    const env = pythonEnv();
    assert.deepEqual([env.E2E_PY_COVERAGE_DIR, env.PYTHONPATH], ['/tmp/pycov-x', '/repo/desktop/e2e/lib/pycov']);
    assert.equal(env.E2E_PY_COVERAGE_ROOT, path.resolve(import.meta.dirname, '..', '..', '..'), 'src/ lines are named from the repo, whatever folder the step runs in');
  } finally { for (const name of Object.keys(process.env)) if (!(name in saved)) delete process.env[name]; Object.assign(process.env, saved); }
});
