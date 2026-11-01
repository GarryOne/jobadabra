// Codex (the owner's plan, through the CI broker) as the asker of the live prompt-case sets: the same `run(model, input)` shape as free-ai-eval-claude.mjs's claudeRun, so evaluate() uses either.
// Why (1 Nov 2026, owner via mac-07: "Let the prompts being checked nightly and report"; the 28 Oct rule: scheduled AI runs on the Codex plan, never a paid API): the nightly replay
// (tools/prompt-cases-night.mjs) asks here; the PR re-ask (prompt-cases-live.mjs) stays on Haiku. The model id picks the broker tier (broker-client.mjs tierOf: haiku -> small).
// It catches prompt regressions, not model ones: Free AI users get qwen on Workers AI. Guard: desktop/test/prompt-cases-night.test.js.
import {askBroker} from '../desktop/e2e/lib/broker-client.mjs';

export const MODEL = 'claude-haiku-5-5';

/**
 * A case's request in Workers AI shape (system + user messages, response_format) -> the broker's Messages body.
 * @param {{messages: {role: string, content: string}[], response_format?: {json_schema?: {schema?: object}}}} input
 * @returns {object} {model, system, messages, output_config?}
 */
export function brokerBody(input) {
  const schema = input.response_format?.json_schema?.schema;
  return {model: MODEL, max_tokens: 1024,
    system: input.messages.filter(m => m.role === 'system').map(m => m.content).join('\n\n'),
    messages: input.messages.filter(m => m.role !== 'system').map(m => ({role: m.role, content: m.content})),
    ...(schema ? {output_config: {format: {type: 'json_schema', schema}}} : {})};
}

/**
 * run(name, input) -> an answer in the shape evaluate() reads. A refusal throws an Error with `.capped` (the broker's budget or login said no: stop asking) or `.broker` (any other failure).
 * @param {{ask?: Function, env?: object, onCall?: Function}} options ask: the broker call (injectable); onCall: told once per attempted call
 */
export const codexRun = ({ask = askBroker, env = process.env, onCall = () => {}} = {}) => async (_name, input) => {
  onCall();
  const answer = await ask(brokerBody(input), {env});
  if (!answer.ok) throw Object.assign(new Error(`${answer.status}: ${answer.detail}`), answer.status === 'capped' ? {capped: true} : {broker: true});
  const usage = answer.message.usage || {};
  return {choices: [{message: {content: answer.message.content.map(part => part.text ?? '').join('')}, finish_reason: 'stop'}], model: answer.model,
    usage: {prompt_tokens: usage.input_tokens || 0, completion_tokens: usage.output_tokens || 0}};
};
