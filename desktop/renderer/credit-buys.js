// What an AI credit amount buys, in applications: the one function every surface that names a credit amount uses (the plan card, top-up buttons, ⌘K, dialogs; the site reads this file too).
// Why (27 Oct 2026, owner): "whenever we mention 10e AI credit received, we should mention an approximate/average of real numbers what the user can do with that". Never typed per screen: change the numbers below, every surface follows.
// Measured 27 Oct 2026 on Sonnet 5.5 (the Pro lane's model), by `node tools/free-ai-writing-eval.mjs --more-letters --features letter --free-claude sonnet --no-judge` (15 letters) and
// `--form-steps --features answers,tailor` (5 each): the mean tokens of one call, in/out. A priced call is tokens x Anthropic's list price ($2 in, $10 out per million).
// An application = the letter + the CV tailoring + the form answers.
export const MEASURED_TOKENS = {letter: [6061, 2084], tailor: [4266, 743], answers: [8271, 739]};
const SONNET_USD_PER_M = [2, 10];
// TODO(AI): replace by the live average of Pro's ai_calls (/admin/ai-cost) once real Sonnet calls exist (27 Oct 2026).
export const APPLICATION_RAW_USD = Object.values(MEASURED_TOKENS).reduce((sum, [input, output]) => sum + (input * SONNET_USD_PER_M[0] + output * SONNET_USD_PER_M[1]) / 1e6, 0);
// €1 of credit pays €0.50 of raw AI cost: a call takes 2x its raw cost from the credit and the margin stays 50% (owner, 24 Oct 2026: "for every 10e AI credit ... €0.50 of REAL cost";
// the site's shared/pro-packages.js CREDIT_PER_COST, jobadabra-web; "€1 at our AI prices" in the plan text means those prices, which are 2x raw).
export const CREDIT_TO_RAW = 0.5;
export const EUR_USD = 1.16;
const MARGIN = 0.9;   // a real prompt can run longer than an eval one: promise 10% less than measured
const STEP = 5;   // "about 70", never "about 71"

/**
 * How many applications a credit amount buys, rounded down to a multiple of 5 with a 10% margin.
 * @param {number} creditEur the euro amount of AI credit
 * @returns {number} 0 when the amount is not positive
 */
export const applicationsFor = creditEur => (creditEur > 0 ? Math.floor((creditEur * CREDIT_TO_RAW * EUR_USD / APPLICATION_RAW_USD) * MARGIN / STEP) * STEP : 0);

/** "about 70 applications" for an amount, '' when it buys none. */
export const buysWords = creditEur => (applicationsFor(creditEur) > 0 ? `about ${applicationsFor(creditEur)} applications` : '');

/** " (about 70 applications)" to append to an amount, '' when it buys none: callers never print empty parentheses. */
export const buysSuffix = creditEur => (buysWords(creditEur) ? ` (${buysWords(creditEur)})` : '');
