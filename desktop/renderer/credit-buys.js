// What an AI credit amount buys, in applications: the one function every surface that names a credit amount uses (the plan card, top-up buttons, ⌘K, dialogs; the site reads this file too).
// Why (27 Oct 2026, owner): "whenever we mention 10e AI credit received, we should mention an approximate/average of real numbers what the user can do with that". Never typed per screen: change the numbers below, every surface follows.
// Measured 27 Oct 2026 (eval runs, Pro lane on Sonnet 5.5, token counts at list price $2/$10 per million): letter 0.033, CV tailoring 0.016, form answers 0.024 = $0.073 raw per application.
// TODO(AI): replace APPLICATION_RAW_USD by the live average of Pro's ai_calls (/admin/ai-cost) once real Sonnet calls exist (27 Oct 2026).
export const APPLICATION_RAW_USD = 0.073;
export const CREDIT_TO_RAW = 0.5;   // €1 of credit pays €0.50 of raw AI cost: a call takes 2x its raw cost from the credit (shared/pro-ai.js rawToCredit), the margin stays 50%
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
