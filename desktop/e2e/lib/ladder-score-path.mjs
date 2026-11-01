// The model client of the live ladder score: the APP's own Claude Code adapter (lib/ai/claude-code-cli.js), so the score asks the way the app asks: the model alias,
// `--effort low`, the schema enforced natively with `--json-schema`, one repair on a mismatch. Before 11 Oct 2026 the score used its own CLI call (lib/model.mjs: the full
// model id, no effort, the schema pasted into the system prompt) and one Datadog sketch answered differently there and in the app. Guard: test/ladder-score-path.test.js.
// Never a key: the engine check (assertNoApiSpend in lib/ladder-score.mjs) runs before this client is made, and the adapter's `claude -p` bills the plan.
import {cliClient} from '../../lib/ai/claude-code-cli.js';
import {realClaude} from './real-claude.mjs';   // never a terminal's claude wrapper (e2e/test/replay/real-claude.test.mjs)

export const scoringClient = ({binary = realClaude() || 'claude', ...options} = {}) => cliClient(binary, {lane: 'page', ...options});   // the page lane: the extension's questions

// A fixture's stored answer says which path recorded it (`answer_path`: written by --record). Older ones have none: the scorer's own call.
export function answerPathNote(fixtures) {
  const answered = fixtures.filter(fixture => fixture.answer);
  const old = answered.filter(fixture => fixture.answer_path !== 'app');
  return old.length ? `note: ${old.length} of ${answered.length} stored answers were recorded on the old scorer path, not the app's; --record re-records them on the app's path (the offline gate replays them as they are)` : '';
}
