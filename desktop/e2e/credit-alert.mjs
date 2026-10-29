// Tells the owner on Telegram ("Jobadabra · CI alerts") the moment an AI provider says its credit is gone, instead of a job failing in a log nobody reads.
//   node credit-alert.mjs <anthropic|openai|codex> "<the failure's own words>"      (CI_ALERTS_TELEGRAM_BOT_TOKEN + _CHAT_ID, GITHUB_* from the runner; a text that is no credit message sends nothing)
// Why (29 Oct 2026, owner: "when the AI balance/credit is 0 please send me a telegram notification. This is blind to me"): Anthropic's credit ran out on 22 Oct and only the product brain's own
// "failed" message reached him; the AI code review and the Sentry fixer failed for days with "Credit balance is too low" and told nobody. Called by tools/claude-failure-reason.py (every claude-code-action
// workflow) and by the Codex steps when the broker is capped. Guard: test/credit-alert.test.mjs.
// Job: report health
import path from 'node:path';
import {alertHtml} from './lib/telegram-html.mjs';
import {send} from './ci-alert.mjs';

/** The providers' own wordings of an empty balance: Anthropic "Credit balance is too low", OpenAI "insufficient_quota" / "exceeded your current quota". */
const CREDIT_OUT = /credit balance is too low|insufficient[_ ]quota|exceeded your current quota|plans and billing/i;
export const isCreditOut = text => CREDIT_OUT.test(String(text || ''));

const ADVICE = {
  anthropic: 'Top up the Anthropic credit, or move the job to the Codex plan (the broker).',
  openai: 'Top up the OpenAI credit, or move the job to the Codex plan (the broker).',
  codex: "The Codex plan's budget for CI is used up: it frees itself at the weekly reset (the broker's /health says when), or raise the broker's share.",
};

/** The Telegram message: which provider, which workflow and run, the one next action. */
export function creditMessage({provider, text = '', env = process.env}) {
  const run = env.GITHUB_RUN_ID && env.GITHUB_REPOSITORY ? `${env.GITHUB_SERVER_URL || 'https://github.com'}/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}` : '';
  return alertHtml({icon: '🔴', title: 'AI credit is 0', verdict: `${provider}: jobs that use it fail until it is back`,
    bullets: [{label: 'Workflow', parts: [env.GITHUB_WORKFLOW || 'unknown']}, {label: 'It said', parts: [String(text).slice(0, 200)]}, {label: 'Do', parts: [ADVICE[provider] || ADVICE.anthropic]}],
    links: run ? [{text: 'Open the run', url: run}] : []});
}

/** Sends the alert when `text` is a credit message (or the caller says the provider is capped: always = true). Returns the line to print; never throws, never prints the token. */
export async function alertCreditOut({provider, text, always = false, env = process.env, fetcher = fetch}) {
  if (!always && !isCreditOut(text)) return 'credit-alert: not a credit message, nothing sent';
  return send(creditMessage({provider, text, env}), env, fetcher);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  const [provider = 'anthropic', text = ''] = process.argv.slice(2);
  console.log(await alertCreditOut({provider, text}));
}
