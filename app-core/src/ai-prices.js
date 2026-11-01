// What an AI call costs per million tokens, for the Worker's form answers: no SDK here, so the desktop tests can read it without the
// Worker's packages installed (9 Oct 2026: importing ai.js pulled @anthropic-ai/sdk into the desktop job, which has no app-core/node_modules).
// Kept equal to desktop/lib/ai/models.js priceOf by desktop/test/ai-contract.test.js.

// An OpenAI call injected by the desktop app is priced as its own model, everything else at the caller's Claude price.
export const OPENAI_PRICES = { 'gpt-6-luna': { input: 0.10, cachedInput: 0.01, output: 0.50 }, 'gpt-6.1-sol': { input: 2.00, cachedInput: 0.10, output: 10.00 } };
export const priceOf = (usage, claudePrice) => (usage?.provider === 'openai' ? OPENAI_PRICES[usage.model] || OPENAI_PRICES['gpt-6.1-sol'] : claudePrice);
