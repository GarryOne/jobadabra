// A judge (Haiku 5.5) for what a feature wrote: it reads the rows and says, per item, whether they make sense for a stated person. Pure functions here (build the request,
// validate the answer, apply the verdict); `judge` makes the one call. The judge never runs inside the app under test.
import {modelFetch} from './model.mjs';
export const MODEL = process.env.E2E_JUDGE_MODEL || 'claude-haiku-5-5';   // Haiku in every suite (owner, 27 Oct 2026: the quality judge too; was Sonnet there since 7 Oct)

export const SYSTEM = `You are a strict reviewer of what a job-search tool wrote down for one person. You get the person and a list of items the tool wrote (each with its facts).
For EACH item decide whether it makes sense for THIS person, using only the facts shown. An item makes no sense when its facts contradict each other, a field is empty or says
"undefined"/"null", it is about the wrong kind of work or the wrong place for the person, or its explanation would mislead them.
Reply with ONE JSON object and nothing else: {"items":[{"name":"<exactly the item's name>","makes_sense":true|false,"reason":"<one short sentence>"}]}`;

export function buildRequest({person, items, model = MODEL}) {
  return {model, max_tokens: 1500, system: SYSTEM,   // no temperature: claude-sonnet-5-5 rejects it
    messages: [{role: 'user', content: `The person: ${person}\n\nThe items the tool wrote:\n${JSON.stringify(items, null, 1)}`}]};
}

// -> [{name, makes_sense, reason}] in the fixed shape; anything else is dropped (a reply we cannot read is never a pass).
export function parseVerdicts(text) {
  let data;
  try { data = JSON.parse(String(text).slice(String(text).indexOf('{'), String(text).lastIndexOf('}') + 1)); } catch { return []; }
  return (Array.isArray(data?.items) ? data.items : []).filter(item => item && typeof item.name === 'string' && typeof item.makes_sense === 'boolean')
    .map(item => ({name: item.name, makes_sense: item.makes_sense, reason: typeof item.reason === 'string' ? item.reason.trim().slice(0, 300) : ''}));
}

// -> the problems: an item the judge rejected, or one it never answered about.
export function problems(names, verdicts) {
  const out = [];
  for (const name of names) {
    const verdict = verdicts.find(item => item.name === name);
    if (!verdict) out.push(`the judge gave no verdict on ${name}`);
    else if (!verdict.makes_sense) out.push(`${name}: ${verdict.reason || 'the judge says it makes no sense'}`);
  }
  return out;
}

export async function judge({key, person, items, fetchImpl = modelFetch}) {
  const response = await fetchImpl('https://api.anthropic.com/v1/messages', {method: 'POST',
    headers: {'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json'}, body: JSON.stringify(buildRequest({person, items}))});
  const data = await response.json();
  if (!response.ok) throw new Error(`the judge request was rejected (${response.status}): ${data.error?.message || 'no reason given'}`);
  return parseVerdicts((data.content || []).map(part => part.text || '').join(''));
}
