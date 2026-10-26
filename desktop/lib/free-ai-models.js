// Which Workers AI model answers which AI step of the Free engine, and what a call costs us (USD per million tokens, Cloudflare list prices).
// The names here come from tools/free-ai-eval.mjs (private spec jobadabra-lab:docs/specs/2026-10-16-free-workers-ai.md "Quality"), not from a shortlist.
export const SMALL = '@cf/qwen/qwen3-30b-a3b-fp8';
export const STRONG = '@cf/zai-org/glm-5.3-flash';   // needs the Workers Paid plan; until it is on, STRONG_ON=off keeps these steps on SMALL
export const OSS = '@cf/openai/gpt-oss-120b';   // measured 16 Oct 2026 (tools/free-ai-writing-eval.mjs): clearly better than SMALL at the rejection review only
const PRICES = {[SMALL]: [0.0509, 0.335], [STRONG]: [0.15, 0.5], [OSS]: [0.35, 0.75]};

// Steps that read a page, a mail or a job (short, structured answers) run on the small model; writing a CV, a kit, a strategy or an answer for a form runs on the stronger one.
export const STRONG_STEPS = new Set(['kit', 'prep', 'insight', 'interview', 'opportunity', 'review', 'tailor', 'cover_letter', 'job_cover_letter', 'answer', 'answer_review']);

// Every other step reads or judges (a score, job facts, a mail, a title, a decision): it answers at temperature 0 (owner, 26 Oct 2026: "Reading + judging steps").
// Measured 26 Oct 2026 (690 draws on CI's quality fixtures): at the model's default 0.6, 26% of score texts invented a fact; at 0, 11%. Writing keeps the default.
// Guard: desktop/test/free-ai-temperature.test.js.
export const temperatureFor = action => (STRONG_STEPS.has(String(action ?? '')) ? undefined : 0);

// Per step (owner, 16 Oct 2026: "Yes, that step only"): the rejection review ('review') runs on gpt-oss-120b, every other step on SMALL (or STRONG when STRONG_ON). STEP_MODELS=off puts it back on SMALL.
export const STEP_MODELS = {review: OSS};
export const modelFor = (action, env = {}) => (env.STEP_MODELS !== 'off' && STEP_MODELS[String(action)]) || (STRONG_STEPS.has(String(action)) && env.STRONG_ON === 'on' ? STRONG : SMALL);

export function costUsd(model, usage = {}) {
  const [input, output] = PRICES[model] || [0.5, 1.5];   // an unknown model is charged like a dear one so it can never dodge the daily line
  return ((usage.input_tokens || 0) * input + (usage.output_tokens || 0) * output) / 1e6;
}

// The Workers Free plan answers up to 10,000 neurons a day (resets 00:00 UTC); 1 neuron = $0.000011, so a call's neurons follow from its cost. Past it Cloudflare refuses until the next day.
export const FREE_NEURONS_PER_DAY = 10_000;
export const NEURON_USD = 0.000011;
export const neuronsOf = usd => usd / NEURON_USD;
