// A judge (Haiku 5.5) for the free text the app writes (a job's score reason, strengths and gaps): is it true to the posting and the candidate? Pure functions here
// (build the request, parse and rule on the verdict); judge() makes the call. The verdict has a fixed shape, so a rambling or broken reply can never pass as "fine".
// Job: serve stored answers
import {modelFetch} from './model.mjs';
export const JUDGE_MODEL = process.env.E2E_JUDGE_MODEL || 'claude-haiku-5-5';   // Haiku in every suite (owner, 27 Oct 2026: the quality judge too; was Sonnet there since 7 Oct)
const FLAGS = ['grounded', 'contradicts_posting', 'invents_facts', 'useful'];

export const SYSTEM = `You are a strict fact-checker for a job-search tool. You get a job POSTING, the FACTS the tool extracted from it (the scorer was given these too, so they count as grounded), the CANDIDATE's profile and a TEXT the tool wrote about how well the job fits the candidate.
Judge only the TEXT against the POSTING and the CANDIDATE:
- grounded: every claim in the text can be found in the posting, the extracted facts or the candidate's profile.
- contradicts_posting: the text says something the posting says the opposite of (a place, a seniority, a language rule, a work mode, a salary).
- invents_facts: the text states a fact (a figure, technology, requirement, benefit, employer detail) that is in none of the posting, the extracted facts and the profile. Reasonable judgement ("a strong match") is not a fact, and neither is correct common knowledge (rough geography, a currency conversion, simple arithmetic on the posting's own figures, what a role title usually means). A caveat that says something is not stated, unknown or unspecified ("visa sponsorship unspecified", "no salary stated") is not an invented fact: listing unknowns is wanted. A claim that is WRONG by common knowledge or arithmetic (a 2-hour trip called a short commute, a wrong percentage) is an invented fact.
- useful: a person deciding whether to apply learns something specific from it (not just "good fit").
Reply with ONE JSON object and nothing else: {"grounded":true|false,"contradicts_posting":true|false,"invents_facts":true|false,"useful":true|false,"why":"<one sentence of at most 30 words>"}`;

export function buildRequest({posting, profile, produced, facts = {}, model = JUDGE_MODEL}) {
  const text = Array.isArray(produced) ? produced.filter(Boolean).join('\n') : String(produced ?? '');
  return {
    model, max_tokens: 1000, system: SYSTEM,   // no temperature: claude-sonnet-5-5 rejects it
    messages: [{role: 'user', content: `POSTING\nTitle: ${posting.title}\n${posting.company ? `Company: ${posting.company}\n` : ''}Location: ${posting.location}\n${posting.description}\n\nEXTRACTED FACTS (stage 1)\n${Object.entries(facts).filter(([, value]) => value !== '' && value != null && !(Array.isArray(value) && !value.length)).map(([key, value]) => `${key}: ${Array.isArray(value) ? value.join(', ') : value}`).join('\n') || '(none)'}\n\nCANDIDATE\n${profile}\n\nTEXT THE TOOL WROTE\n${text}\n\nJudge the text.`}],
  };
}

// -> {grounded, contradicts_posting, invents_facts, useful, why}, or throws: a reply that is not exactly that shape is an error, not a pass.
export function parseVerdict(reply) {
  const raw = String(reply ?? '');
  let data;
  try { data = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1)); } catch { throw new Error(`the judge did not answer with JSON: ${raw.slice(0, 120)}`); }
  for (const flag of FLAGS) if (typeof data?.[flag] !== 'boolean') throw new Error(`the judge's verdict has no boolean "${flag}": ${raw.slice(0, 120)}`);
  if (typeof data.why !== 'string' || !data.why.trim()) throw new Error(`the judge's verdict has no "why": ${raw.slice(0, 120)}`);
  return {grounded: data.grounded, contradicts_posting: data.contradicts_posting, invents_facts: data.invents_facts, useful: data.useful, why: data.why.trim().slice(0, 300)};
}

// What fails the suite: an invented fact or a contradiction. (Ungrounded without either, and "not useful", are reported but do not fail: they are taste.)
export function failures(verdict) {
  return [verdict.invents_facts && 'invents facts', verdict.contradicts_posting && 'contradicts the posting'].filter(Boolean);
}

/** Judge score text, optionally identifying its stored question through the transport hint. */
export async function judge({key, posting, profile, produced, facts, question, fetchImpl = modelFetch}) {
  const ask = async () => {
    const response = await fetchImpl('https://api.anthropic.com/v1/messages', {method: 'POST',
      headers: {'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json'}, body: JSON.stringify(buildRequest({posting, profile, produced, facts})), hint: question});
    const data = await response.json();
    if (!response.ok) throw new Error(`the judge call failed (${response.status}): ${data?.error?.message || 'unknown'}`);
    return parseVerdict((data.content || []).map(part => part.text || '').join(''));
  };
  try { return await ask(); } catch (error) {
    if (/did not answer with JSON/.test(error.message)) return ask();   // a blank or cut-off reply happens; a second one is an error, never a pass
    throw error;
  }
}
