// The screenshot review on Free AI (owner, 26 Oct 2026: "Can't we have a free model (cloudflare workers AI) ... that does 70-80% of claude quality?"): three readers
// and one merge, all Workers AI over Cloudflare's REST API with CI's own token (CI_FREE_AI_CF_TOKEN + CI_FREE_AI_CF_ACCOUNT_ID, never production's; docs/rules/why.md).
//   1. Mistral Small answers a 10-point checklist on the picture;   2. Llama 4 Scout and   3. GLM Flash each write down what the screen shows, and gpt-oss-120b runs
//   the same checklist on that text;   4. gpt-oss-120b merges the three lists: joins duplicates, drops what a person judged by design (the page's lessons) or what
//   quotes nothing from the screen, keeps at most 4, in the product's finding shape (lib/vision.mjs parseFindings).
// Measured 26 Oct 2026 on the 48 screenshots people had judged (37 real bugs, 11 by design), held-out 18: 79% of the real bugs seen again (11/14) at 85% precision,
// 3.6 findings a screen, $0.0076 a screen; Claude Sonnet cost $0.0096 a screen (run 40152010902). One Scout call, the earlier setup: 29% at $0.0012.
// Each part was tried alone and dropped for less: the checklist on Scout (14%), on GLM (unparsable), picture tiles (50%), gpt-oss-20b as the judge (29-43%).
// The answer comes back in Claude's message shape, so review-ui.mjs reads both alike. Guarded by test/review-free.test.mjs; tuned with review-eval.mjs.
import crypto from 'node:crypto';
import {expectedFor} from './vision.mjs';

export const MODELS = {check: '@cf/mistralai/mistral-small-3.1-24b-instruct', describe: ['@cf/meta/llama-4-scout-17b-16e-instruct', '@cf/zai-org/glm-5.3-flash'], judge: '@cf/openai/gpt-oss-120b'};
// USD per million tokens (Cloudflare Workers AI pricing, Oct 2026: neurons per million tokens x $0.011 per 1000 neurons).
export const FREE_PRICES = {'@cf/meta/llama-4-scout-17b-16e-instruct': {input: 0.27, output: 0.85}, '@cf/mistralai/mistral-small-3.1-24b-instruct': {input: 0.351, output: 0.555},
  '@cf/zai-org/glm-5.3-flash': {input: 0.15, output: 0.5}, '@cf/openai/gpt-oss-120b': {input: 0.35, output: 0.75}};
const API = process.env.E2E_REVIEW_FREE_URL || 'https://api.cloudflare.com/client/v4';   // a test points this at a fake

export const CHECKS = [
  ['contradiction', 'Two parts of the screen state opposite things about the same item (a pill vs its own text, a header vs a card, a toast vs the detail, a step list vs the run status, a green "nothing new" vs a failed run).'],
  ['count-mismatch', 'A number or count disagrees with another number, with the items actually listed, or with the FACTS (for example "6 recent" with 3 rows, "Applying 10" beside "Applying 0").'],
  ['facts-contradiction', 'Something on screen claims a state the FACTS deny (a service shown as working or checking while it is not connected, results claimed while the app holds 0 jobs, a red error telling you to switch to what is already chosen).'],
  ['raw-technical', 'Raw technical text is shown to the person: an error class or code (ProgrammingError, HTTPError, AiLimit, HTTP 502), HTML, JSON, a stack trace, an internal name or id, or text formatted for another app (a chat message pasted raw).'],
  ['no-reason-or-fix', 'A failure, warning or error that gives no plain reason, or no way to fix it (no button, link or next step), or a vague reason ("stopped unexpectedly", "couldn\'t load").'],
  ['cut-off', 'Text or an icon cut off, sliced or truncated so the meaning is lost (a chip showing only "E…", a headline ending in "…", a box cutting its text in half, an icon half outside its rail).'],
  ['broken-layout', 'Layout broken: a missing cell or day in a grid, stray scrollbars, a list squeezed into a tiny box while space is free, overlapping elements.'],
  ['empty-or-placeholder', 'Dashes, "❓", "–" or an empty heading where data should be, or an empty section offered with a link as if it had content.'],
  ['duplicated-or-inconsistent', 'The same message shown twice, or two lines describing the same rule differently.'],
  ['missing-key-info', 'A list row or card lacks what a person needs to act (no time, no outcome, no reason) where the page shows it elsewhere.'],
];
export const CHECK_SYSTEM = `You check ONE screenshot of the Jobadabra desktop app (a job-search app) for real bugs a person would hit. Test data is made up (company names, round numbers, today's dates, a "not connected" Notion, Gmail or AI key are normal): never report the data itself.
A toast, tooltip, spinner or a text ticker caught mid-scroll is never a bug. Go through EVERY check below and answer each one:
${CHECKS.map(([id, text], i) => `${i + 1}. ${id}: ${text}`).join('\n')}
Reply with ONE JSON object: {"checks":[{"id":"<check id>","answer":"yes|no","where":"<the element>","evidence":"<quote the exact words or numbers you see, both sides of a contradiction>"}]} with all ${CHECKS.length} checks in order. Answer "yes" only with evidence you can quote from the screen (or the FACTS); otherwise "no".`;
export const DESCRIBE = 'Read this screenshot of a desktop app and write down, region by region (sidebar, header, each card or panel, bottom bar, any toast), EVERYTHING it shows or claims: every heading, status pill and its colour, every number with its label, every warning or error text word for word, every button and link, list rows with what each says, and any text or icon that is visibly cut off, clipped, overlapping, missing or empty. Plain text, no judgement.';
export const MERGE_SYSTEM = `Several reviewers looked at ONE screenshot of the Jobadabra desktop app (a job-search app; test data is made up) and listed possible bugs. You decide which to report to the developers.
1. Join findings about the same problem into one.
2. Drop a finding when: a person already judged the same thing BY DESIGN (listed below the findings, when any); it is about the made-up data itself; it quotes no words, numbers or visible element from the screen; it calls a toast, tooltip, spinner or a cut-off sidebar label in a narrow rail a bug; or it only says something "could be clearer".
3. Keep at most 4, the ones a user would most surely hit, strongest first: two parts of the screen saying opposite things, counts that disagree, raw technical errors, broken or cut-off layout, a failure with no reason or fix.
Reply with ONE JSON object (an empty list is fine): {"findings":[{"severity":"high|medium","kind":"wrong-result|error-shown|layout|text|consistency|empty-state|functionality","title":"<8 words>","detail":"<what is wrong and where, quoting the screen>","impact":"<one sentence: what the person loses, gets wrong or has to do because of this>","suggestion":"<the smallest fix, in plain words>"}]}
severity: high when the app is wrong or stops the person (a wrong status or count, a raw error, a dead end), else medium. kind: wrong-result when it contradicts itself or the FACTS, error-shown for raw technical text, layout for cut-off or broken layout.`;
// The name the review cache and the logs know this reviewer by: any prompt or model change is a new question, so no old answer is reused for it.
export const FREE_MODEL = `free-ai:${crypto.createHash('sha256').update(JSON.stringify([MODELS, CHECK_SYSTEM, DESCRIBE, MERGE_SYSTEM])).digest('hex').slice(0, 10)}`;

export function freeCost(model, usage = {}) {
  const price = FREE_PRICES[model];
  return price ? ((Number(usage.prompt_tokens) || 0) * price.input + (Number(usage.completion_tokens) || 0) * price.output) / 1e6 : null;
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
// One Workers AI call. Both answer shapes (result.response; OpenAI-style result.choices), thinking stripped; a busy service (429/5xx) is asked twice more.
// -> {ok: true, text, usage, usd, cut} or {ok: false, status, detail}.
export async function runModel(model, messages, {max = 4000, json = false, token = process.env.CI_FREE_AI_CF_TOKEN, account = process.env.CI_FREE_AI_CF_ACCOUNT_ID, fetchImpl = fetch, waitMs = 3000} = {}) {
  if (!token || !account) return {ok: false, status: 'no-token', detail: 'CI_FREE_AI_CF_TOKEN or CI_FREE_AI_CF_ACCOUNT_ID is not set'};
  let last = {ok: false, status: 0, detail: 'no answer'};
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt) await sleep(waitMs);
    const response = await fetchImpl(`${API}/accounts/${account}/ai/run/${model}`, {method: 'POST', headers: {authorization: `Bearer ${token}`, 'content-type': 'application/json'},
      body: JSON.stringify({messages, max_tokens: max, temperature: 0, ...(json ? {response_format: {type: 'json_object'}} : {})}), signal: AbortSignal.timeout(180000)}).catch(error => error);
    if (response instanceof Error) { last = {ok: false, status: 0, detail: `no answer: ${response.message}`}; continue; }
    const body = await response.json().catch(() => ({}));
    if (!response.ok || body.success === false) {
      last = {ok: false, status: response.status, detail: JSON.stringify(body.errors || body).slice(0, 300)};
      if (response.status === 429 || response.status >= 500) continue;
      return last;
    }
    const result = body.result || {}, usage = result.usage || {}, said = result.response ?? result.choices?.[0]?.message?.content ?? '';
    const text = (typeof said === 'string' ? said : JSON.stringify(said)).replace(/<think>[\s\S]*?<\/think>/g, '').trim();   // a model may hand back the JSON already parsed
    const cut = result.choices?.[0]?.finish_reason === 'length' || (Number(usage.completion_tokens) || 0) >= max;
    return {ok: true, text, usage, usd: freeCost(model, usage) || 0, cut};
  }
  return last;
}

// A checklist answer -> [{title, detail}] for the checks answered yes with evidence; tolerant of the shapes the models use ({id, answer}, {type, findings}).
export function checksToFindings(text) {
  let data;
  try { data = JSON.parse(String(text).slice(String(text).indexOf('{'), String(text).lastIndexOf('}') + 1)); } catch { return []; }
  const found = [];
  for (const check of Array.isArray(data?.checks) ? data.checks : []) {
    const id = check.id || check.check || check.type || check.name || '', answer = String(check.answer ?? check.result ?? check.found ?? '').toLowerCase();
    const said = [check.evidence, check.detail, check.details, ...(Array.isArray(check.findings) ? check.findings : [check.findings])].filter(v => typeof v === 'string' && v.trim()).join(' | ');
    if ((['yes', 'true'].includes(answer) || (!answer && said.length > 8)) && said.length > 8) found.push({title: `${id}: ${check.where || ''}`.slice(0, 100), detail: said.slice(0, 600)});
  }
  return found;
}

const picture = pngBase64 => ({type: 'image_url', image_url: {url: `data:image/png;base64,${pngBase64}`}});
const pageText = (view, facts) => `Page: ${view}\nExpected to show: ${expectedFor(view)}\n${facts ? `\nFACTS about the app's state when this was taken:\n${JSON.stringify(facts, null, 1)}\n` : ''}`;

// One page: the three readers at once, then the merge. -> {ok: true, message (Claude's shape), usd, readers: [{name, findings, failed?}]} or {ok: false, status, detail}.
// A reader that fails is named and the others still count; all three failing, or the merge failing, leaves the page not reviewed.
export async function reviewFree({view, pngBase64, facts = null, lessons = ''}, opts = {}) {
  const page = pageText(view, facts), calls = [];
  const ask = async (model, messages, max) => { const answer = await runModel(model, messages, {...opts, max}); calls.push({model, answer}); return answer; };
  const checklist = async () => { const a = await ask(MODELS.check, [{role: 'system', content: CHECK_SYSTEM}, {role: 'user', content: [picture(pngBase64), {type: 'text', text: `${page}\nGo through every check.`}]}], 4000); return a.ok ? {findings: checksToFindings(a.text)} : {failed: a}; };
  const described = async model => {
    const d = await ask(model, [{role: 'user', content: [picture(pngBase64), {type: 'text', text: DESCRIBE}]}], 4000);
    if (!d.ok || !d.text) return {failed: d.ok ? {status: 'empty', detail: 'an empty description'} : d};
    const j = await ask(MODELS.judge, [{role: 'system', content: CHECK_SYSTEM.replace('check ONE screenshot', 'check the written-down content of ONE screenshot')},
      {role: 'user', content: `${page}\nWHAT THE SCREEN SHOWS (read from the screenshot):\n${d.text}\n\nGo through every check.`}], 4000);
    return j.ok ? {findings: checksToFindings(j.text)} : {failed: j};
  };
  const names = [`checklist (${MODELS.check})`, ...MODELS.describe.map(model => `described (${model})`)];
  const readers = (await Promise.all([checklist(), ...MODELS.describe.map(described)])).map((reader, i) => ({name: names[i], ...reader}));
  const cost = () => calls.reduce((sum, call) => sum + (call.answer.usd || 0), 0);
  const tokens = () => ({input_tokens: calls.reduce((sum, call) => sum + (Number(call.answer.usage?.prompt_tokens) || 0), 0), output_tokens: calls.reduce((sum, call) => sum + (Number(call.answer.usage?.completion_tokens) || 0), 0)});
  const working = readers.filter(reader => !reader.failed);
  if (!working.length) return {ok: false, status: readers[0].failed.status, detail: `every reader failed: ${readers[0].failed.detail}`, usd: cost()};
  const all = working.flatMap(reader => reader.findings);
  let text = '{"findings":[]}', cut = false;
  if (all.length) {
    const merged = await ask(MODELS.judge, [{role: 'system', content: MERGE_SYSTEM},
      {role: 'user', content: `${page}\nFINDINGS:\n${all.map((f, i) => `${i + 1}. ${f.title}: ${f.detail}`).join('\n')}${lessons ? `\n\n${lessons}` : ''}`}], 5000);
    if (!merged.ok) return {ok: false, status: merged.status, detail: `the merge failed: ${merged.detail}`, usd: cost()};
    ({text, cut} = merged);
  }
  return {ok: true, usd: cost(), readers, message: {content: [{type: 'text', text}], stop_reason: cut ? 'max_tokens' : 'end_turn', usage: tokens()}};
}
