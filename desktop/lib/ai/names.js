// The name of the AI the user chose, for the texts the main process sends to the window, toasts and dialogs: "Claude" (Anthropic API
// key, Claude Code), "OpenAI" or "Codex", and its model per tier. Texts write {AI} and {AI:big|main|small} and pass through aiText(storage,
// text). The window's twin is renderer/ai-name.js (test/ai-name.test.js keeps the two equal).
import {chosen} from './index.js';
import {isOn, isFreeKey} from '../ai-free.js';

export const NAMES = {api: 'Claude', cli: 'Claude', openai: 'OpenAI', codex: 'Codex', free: 'Free AI'};
export const MODELS = {
  claude: {small: 'Claude Haiku', main: 'Claude Sonnet', big: 'Claude Opus'},
  openai: {small: 'GPT-6 Luna', main: 'GPT-6.1 Sol', big: 'GPT-6.1 Sol'},
  free: {small: 'Free AI', main: 'Free AI', big: 'Free AI'},
  none: {small: 'AI', main: 'AI', big: 'AI'},
};
const familyOf = engine => (engine === 'openai' || engine === 'codex' ? 'openai' : 'claude');
const modelsOf = engine => (engine === 'free' || engine === 'none' ? engine : familyOf(engine));

export const engineOf = storage => chosen(storage?.settings?.() || {}, {ANTHROPIC_API_KEY: storage?.secret?.('ANTHROPIC_API_KEY')}) || 'api';
// The name's key: Free AI is the 'api' engine pointed at our relay (settings.aiFree / aiTrial): named 'free', never 'Claude'.
const nameKey = storage => {
  const settings = storage?.settings?.() || {};
  const engine = chosen(settings, {ANTHROPIC_API_KEY: storage?.secret?.('ANTHROPIC_API_KEY')});
  if (!engine) return isOn(settings) ? 'free' : 'none';   // nothing chosen, no key: "AI"
  return engine === 'api' && isOn(settings) ? 'free' : engine;
};
// May this user see an AI cost? Nobody today (owner, 25 Oct 2026); if it returns, only on their own API key. The window's twin is renderer/ai-cost.js costVisible.
export const COSTS_SHOWN = false;
export const costVisible = (storage, shown = COSTS_SHOWN) => shown && ['api', 'openai'].includes(nameKey(storage));
// The engine as the daily health report names it: our relay (the in-house API) is 'free' on the trial and 'pro' once the Pro plan is bought, never 'api'; nothing chosen is 'none'.
export const reportedEngine = (storage, plan = 'free') => { const key = nameKey(storage); return key === 'free' && plan === 'pro' ? 'pro' : key; };
export function aiText(storage, text) {
  const engine = nameKey(storage), family = modelsOf(engine);
  return String(text).replace(/\{AI(?::(small|main|big))?\}/g, (_, tier) => (tier ? MODELS[family][tier] : NAMES[engine] || 'AI'));
}
export const aiNameOf = storage => NAMES[nameKey(storage)] || 'AI';
// The name of the engine that answered (an adapter's .engine; a client on Free AI's own key answers as Free AI; the raw Anthropic SDK has none: Claude).
export const nameOfClient = client => NAMES[client?.engine === 'api' && isFreeKey(client.sdk?.apiKey) ? 'free' : client?.engine || 'api'] || 'AI';
export const familyOfEngine = familyOf;
// Claude-only features (Apply / Read / Take over with Claude: Claude Code driving Chrome) exist only with a Claude engine: the main process's twin of
// the window's claudeFeatures() (renderer/ai-name.js). With OpenAI or Codex chosen nothing offers or starts Claude (owner, 9 Oct 2026).
export const claudeFamily = storage => familyOf(engineOf(storage)) === 'claude';
