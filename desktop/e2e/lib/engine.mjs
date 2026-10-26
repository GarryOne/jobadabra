// Which AI engine the app under test uses (the app's own "AI engine" setting: its API key, or the user's Claude Code on this Mac).
import {execFileSync} from 'node:child_process';
import {withoutWrappers} from './real-claude.mjs';   // never a terminal's claude wrapper (e2e/test/real-claude.test.mjs)

// A saved key that is never valid: with the CLI engine chosen the key is not used, and a step that needs the API engine (the AI proxy answering 429, 500, a delay)
// switches to it without spending a real key's credit, because the proxy answers or delays before anything reaches Anthropic.
export const DUMMY_KEY = 'sk-ant-api03-e2e-local-not-a-real-key-0000000000000000000000000000000000000000000000';

const claudeInstalled = () => { try { execFileSync('claude', ['--version'], {env: withoutWrappers(), stdio: 'ignore', timeout: 20000}); return true; } catch { return false; } };

// THE RULE (owner, 5 Oct 2026): the e2e key is for CI only. On a Mac no suite loads, reads or spends an Anthropic key: the app under test and every judge use this Mac's
// Claude Code (the plan, a fixed price). A step that needs the proxy in front of the app (a refusal, a delay) runs on the API engine with DUMMY_KEY, so it costs nothing.
export const isCi = (env = process.env) => !!env.CI;
export const testKey = (env = process.env, engine = 'api', family = '') => !isCi(env) ? '' : family === 'free' ? env.E2E_FREE_AI_KEY || '' : env[liveKeyName(env, engine)] || '';   // a live run's own key when it has one (liveKeyName)
export const appKey = (key, env = process.env) => isCi(env) ? key : DUMMY_KEY;

// The app's models under test. CI forces every step onto one cheap model (Haiku) to save credit; a Mac has no per-token cost, so the app uses its own production models
// (Haiku for the first pass, Sonnet for scoring and strategy): closer to what ships (owner, 5 Oct 2026).
export const appModelEnv = (env = process.env) => isCi(env) ? {JOB_PILOTTO_MODEL_OVERRIDE: 'claude-haiku-5-5'} : {};

// Which AI family the app under test runs on (owner, 9 Oct 2026: "make sure the OpenAI/Codex integration works well and produces good results"): CI ALTERNATES
// per run, by GitHub's run number (odd: OpenAI, even: Claude), so both families are tested every other run at today's cost; the report names the family.
// E2E_AI_FAMILY=claude|openai pins one. Without the OpenAI test key (E2E_OPENAI_KEY) an OpenAI turn runs on Claude and says so. A Mac: Claude unless pinned.
export function pickFamily(env = process.env) {
  const pinned = env.E2E_AI_FAMILY;
  if (pinned && !['claude', 'openai', 'free', 'rotate'].includes(pinned)) throw new Error(`E2E_AI_FAMILY must be claude, openai, free or rotate, not "${pinned}"`);
  if (pinned === 'free' && !isCi(env)) throw new Error('E2E_AI_FAMILY=free is for CI only: the relay runs on the runner with CI\'s own Workers AI token');
  if (pinned === 'claude' || pinned === 'openai' || pinned === 'free') return pinned;
  if (freeAi(env)) return 'free';   // CI on Free AI (below): every run, both run parities
  if (!isCi(env) && pinned !== 'rotate') return 'claude';
  const turn = Number(env.GITHUB_RUN_NUMBER || 0) % 2 === 1 ? 'openai' : 'claude';
  if (turn === 'openai' && isCi(env) && !env.E2E_OPENAI_KEY) {
    console.log('  AI family: OpenAI\'s turn, but no E2E_OPENAI_KEY secret: this run uses Claude.');
    return 'claude';
  }
  return turn;
}

// CI on Free AI (owner, 26 Oct 2026, CI's Anthropic credit out: "Let's just switch to Free AI (CloudFlare workers AI). I don't want to top up anymore"): the site's own
// Free AI handler runs on the runner (.github/actions/free-ai-relay, CI's own Workers AI token, never production's /api/ai) and hands the suite its URL and a throwaway
// JPF1 key. With it up, the app under test runs on Free AI (the 'api' engine with a JPF1 key, as desktop/lib/ai-free.js does for users) and the judges ask it too.
// freeAiPlanned: the token is set, so the jobs will start the relay (key-preflight.mjs checks the token instead of the Claude key). Never on a Mac.
export const freeAi = (env = process.env) => isCi(env) && !!env.E2E_FREE_AI_URL && !!env.E2E_FREE_AI_KEY;
export const freeAiPlanned = (env = process.env) => isCi(env) && !!env.CI_FREE_AI_CF_TOKEN;
export const freeToken = (env = process.env) => (isCi(env) ? env.CI_FREE_AI_CF_TOKEN || '' : '');
// The judges' family: Free AI while the relay is up; E2E_JUDGE_FAMILY=claude puts them back on Claude (the owner's switch, for when he funds Claude again).
export function judgeFamily(env = process.env) {
  const pinned = env.E2E_JUDGE_FAMILY;
  if (pinned && !['claude', 'free'].includes(pinned)) throw new Error(`E2E_JUDGE_FAMILY must be claude or free, not "${pinned}"`);
  return pinned === 'claude' || !freeAi(env) ? 'claude' : 'free';
}
// 'api' | 'cli' | 'openai' | 'codex'. CI: the family's API key, as it ships to users. A Mac: the family's own CLI (Claude Code, Codex), always. A suite may pin 'api' (its
// steps are answered by the Anthropic-shaped AI proxy), which on a Mac runs with the placeholder key, whatever the family. E2E_AI_ENGINE forces one engine; an API engine is
// refused on a Mac. family: the test code's own calls (the judges, lib/model.mjs) pass 'claude', so both families are judged by the same model.
export function pickEngine({env = process.env, suiteEngine = '', installed = claudeInstalled, family = pickFamily(env)} = {}) {
  const chosen = env.E2E_AI_ENGINE;
  if (chosen && !['api', 'cli', 'openai', 'codex'].includes(chosen)) throw new Error(`E2E_AI_ENGINE must be api, cli, openai or codex, not "${chosen}"`);
  if (isCi(env)) return chosen === 'cli' || chosen === 'codex' ? chosen : chosen || (family === 'openai' ? 'openai' : 'api');
  if (chosen === 'api' || chosen === 'openai') throw new Error(`E2E_AI_ENGINE=${chosen} is for CI only: on a Mac the e2e never uses an API key (it uses Claude Code or Codex)`);
  if (suiteEngine === 'api') return 'api';
  if (chosen === 'codex' || family === 'openai') return 'codex';   // the user's own Codex (their ChatGPT plan): Verify says if it is not signed in
  if (!installed()) throw new Error('Claude Code is not installed or not on the PATH: the e2e on a Mac runs on it (it never uses an Anthropic key). Install it and sign in with `claude`.');
  return 'cli';
}
// The family of an engine, and the CI secret its API key comes from.
export const familyOf = engine => (engine === 'openai' || engine === 'codex' ? 'openai' : 'claude');
export const keySecret = engine => (familyOf(engine) === 'openai' ? 'E2E_OPENAI_KEY' : 'E2E_ANTHROPIC_KEY');
export const familySecret = (family, engine = 'api') => (family === 'free' ? 'E2E_FREE_AI_KEY' : keySecret(engine));
// Live runs on real sites ask on their own Anthropic keys, so each one's cost shows apart in the Console and on /admin/ai-cost (owner, 12 Oct 2026): a CI recording
// run by hand (JOB_PILOTTO_VISIT_KIND=hand) on LIVE_POOL_ANTHROPIC_KEY; until the owner has set one, the Tests key. -> the NAME
// the key comes from (for the job log), never its value. The one place that picks it (e2e/test/no-local-key.test.mjs).
export const LIVE_KEYS = {hand: 'LIVE_POOL_ANTHROPIC_KEY'};
export const liveKeyName = (env = process.env, engine = 'api') => { const own = familyOf(engine) === 'claude' ? LIVE_KEYS[env.JOB_PILOTTO_VISIT_KIND] : ''; return own && env[own] ? own : keySecret(engine); };
export const appSecretName = engine => (familyOf(engine) === 'openai' ? 'OPENAI_API_KEY' : 'ANTHROPIC_API_KEY');

// The applyflows suite's engine (npm run live / flows / the pool's smoke). A live run on a real site asks the AI things no proxy answer covers (which popup button, which
// upload slot, a picture), so it runs on this Mac's Claude Code, never the proxy with its placeholder key (that key answered those asks with 401, 11 Oct 2026).
// Only the offline matrix uses the proxy; LIVE_ENGINE=api forces it for a live run, LIVE_ENGINE=cli for the matrix.
export const flowsEngine = (env = process.env) => (env.LIVE_ENGINE ? (env.LIVE_ENGINE === 'cli' ? 'cli' : 'api') : env.LIVE ? 'cli' : 'api');
