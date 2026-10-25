// The one rule for showing an AI cost. Off for everyone (owner, 25 Oct 2026: "I don't foresee much users using the API Key"; the figure is only tokens × our price table, never a bill).
// If it ever comes back, it is for the user's own API key only, never Free AI or a plan: flip SHOWN here and COSTS_SHOWN in lib/ai/names.js.
// Every dollar amount the window draws goes through costText/costVisible; test/ai-cost.test.js fails on a file that draws one without importing this.
// The engine is injected (pages/shared.js, like ai-name.js), so pure view modules and their tests need no window.
let engineOf = () => null;
export const setCostEngine = fn => { engineOf = fn; };
// engine: 'api' | 'openai' | 'cli' | 'codex' | 'free' | null, as ai-engine-view.js chosen() names it.
let shown = false;   // SHOWN: no engine sees a cost today; setCostsShown lets a test (or the day it returns) switch the API-key rule on
export const setCostsShown = on => { shown = !!on; };
export const costVisible = (engine = engineOf()) => shown && (engine === 'api' || engine === 'openai');
export const dollars = usd => `$${usd < 0.01 ? Number(usd).toFixed(3) : Number(usd).toFixed(2)}`;
// A measured amount as text, or '' when this user may not see costs or none was spent. make: how the line wraps it ("AI $0.03", "Done ($0.03)").
export const costText = (usd, make = dollars, engine = engineOf()) => (costVisible(engine) && usd > 0 ? make(usd) : '');
