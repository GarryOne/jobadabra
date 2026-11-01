// The Worker's AI client: the Anthropic SDK on the Worker's own ANTHROPIC_API_KEY (the Cloudflare deploy stays Anthropic-only). The desktop
// app injects its own client instead (lib/ai/index.js: whatever engine the user chose), so this is used only when none is given.
import Anthropic from '@anthropic-ai/sdk';

// Workers need the global fetch bound at call time (not captured at import), hence the wrapper.
export const anthropicClient = apiKey => new Anthropic({ apiKey, fetch: (...args) => globalThis.fetch(...args) });

// Prices live in ai-prices.js (no SDK there: the desktop tests read them); re-exported for the Worker's callers.
export { OPENAI_PRICES, priceOf } from './ai-prices.js';
