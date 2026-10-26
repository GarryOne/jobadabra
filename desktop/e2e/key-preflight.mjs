// One check of the E2E AI key before a gate's whole matrix starts: a refused key or an empty credit balance stops the run with one line, not as ~60 red jobs (run 11, 23 Oct 2026).
// CI on Free AI (owner, 26 Oct 2026: "Let's just switch to Free AI"): with CI's Workers AI token set, the suites run on the relay, so the token is what is checked
// (Cloudflare's free verify call); the Claude and OpenAI keys become warnings, never a stop (the Claude smoke is parked until he funds Claude).
import fs from 'node:fs';
import {freeAiPlanned, freeToken, testKey} from './lib/engine.mjs';
import {checkKeyAccepted, checkOtherKeys} from './lib/key-check.mjs';
import {checkFreeToken} from './lib/free-ai-check.mjs';

const summary = line => { if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${line}\n`); };
const stop = (title, error) => { summary(`### ❌ ${title}, so no suite was started\n\n${error.message}`); console.error(`::error::${error.message}`); process.exit(1); };
if (freeAiPlanned()) {
  try { await checkFreeToken({token: freeToken()}); } catch (error) { stop('CI\'s Free AI token is refused', error); }
  console.log('preflight: CI runs on Free AI; its Workers AI token is active');
  await checkOtherKeys({engine: 'free'});   // the Claude and OpenAI keys: a warning each, never a stop
  process.exit(0);
}
const key = testKey(process.env, 'api');   // only lib/engine.mjs reads the key (test/no-local-key.test.mjs)
if (!key) { console.log('preflight: no test key here (a fork): nothing to check'); process.exit(0); }
try {
  await checkKeyAccepted({engine: 'api', key});
  await checkOtherKeys({engine: 'api'});   // the other family: a warning, never a stop
  console.log('preflight: the E2E AI key is accepted');
} catch (error) { stop('The E2E AI key is refused', error); }
