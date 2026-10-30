// Strategy's chip lists read once by the AI (owner, 17 Oct 2026: "One chip per meaning" and "Did you mean…" flags): which entries of a list mean the
// same thing (USA / US / United States; Switzerland / Schweiz / Suisse) and which look misspelt ("Accountanting"). A fixed answer the code checks:
// every entry it names must be one it was given, an entry is in one group at most, a suggestion differs from the entry. Display only: the lists are
// never changed here (a "Fix" goes through editTargets like any edit). Cached by the lists' contents, so it is asked again only when a list
// changes. Guarded by test/list-meanings.test.js.
import crypto from 'node:crypto';
import {anthropicApi} from './ai/anthropic-api.js';

export const MODEL = 'claude-haiku-5-5';
// The chip lists shown on Strategy (roles are grouped by family elsewhere; search phrases are shown as written).
export const LISTS = ['places', 'country', 'rights', 'stack', 'titleSkip', 'skip', 'remoteSkip', 'finders'];
const SCHEMA = {type: 'object', additionalProperties: false, required: ['lists'], properties: {lists: {type: 'array', items: {
  type: 'object', additionalProperties: false, required: ['name', 'groups', 'typos'], properties: {
    name: {type: 'string'},
    groups: {type: 'array', items: {type: 'object', additionalProperties: false, required: ['main', 'others'], properties: {main: {type: 'string'}, others: {type: 'array', items: {type: 'string'}}}}},
    typos: {type: 'array', items: {type: 'object', additionalProperties: false, required: ['entry', 'suggestion'], properties: {entry: {type: 'string'}, suggestion: {type: 'string'}}}}}}}}};
const INSTRUCTIONS = `You read the lists of a job seeker's search settings (places, skills, job titles to skip, companies to skip, regions, search words), in any language.
For each list:
- groups: entries of THAT list that mean the same thing: the same place, company, region or word in another language, spelling or abbreviation
  ("USA", "US", "United States"; "Switzerland", "Schweiz", "Suisse"; "Developer", "Entwickler"). main = the clearest entry, others = the rest.
  Different places in one country are NOT the same ("Zurich" and "Basel"); a company and another company are not the same unless one is the other's
  short name. Leave entries that have no twin out of groups.
- typos: entries that look misspelt, with the word they most likely meant ("Accountanting" -> "Accounting"). Never a correct word in another language.
Copy every entry exactly as given.`;

const bare = text => String(text).normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();
export const keyOf = lists => crypto.createHash('sha1').update(JSON.stringify(LISTS.map(name => [name, lists?.[name] || []]))).digest('hex');

// One list's answer checked against its entries -> {groups, typos}; anything it was not given is dropped, never trusted.
function checked(answer, labels) {
  const known = new Map(labels.map(label => [bare(label), label])), used = new Set();
  const groups = [];
  for (const group of answer?.groups || []) {
    const members = [group.main, ...(group.others || [])].map(name => known.get(bare(name)));
    if (members.some(member => !member)) continue;
    const unique = [...new Set(members)];
    if (unique.length < 2 || unique.some(member => used.has(member))) continue;
    unique.forEach(member => used.add(member));
    groups.push({main: unique[0], others: unique.slice(1)});
  }
  const typos = (answer?.typos || []).map(typo => ({entry: known.get(bare(typo.entry)), suggestion: String(typo.suggestion || '').trim()}))
    .filter(typo => typo.entry && typo.suggestion && typo.suggestion.length <= 60 && bare(typo.suggestion) !== bare(typo.entry));
  return {groups, typos};
}

// lists: {name: [labels]} -> {name: {groups, typos}} for the lists it read; {} with no AI or a mangled answer (the chips show as they are).
export async function judgeLists(lists, {client = null, apiKey = ''} = {}) {
  const ai = client || (apiKey ? anthropicApi(apiKey) : null);
  const asked = LISTS.filter(name => (lists?.[name] || []).length > 1);
  if (!ai || !asked.length) return {};
  const content = asked.map(name => `${name}: ${JSON.stringify(lists[name])}`).join('\n');
  const response = await ai.messages.create({model: MODEL, max_tokens: 3000, system: INSTRUCTIONS, messages: [{role: 'user', content}],
    output_config: {format: {type: 'json_schema', schema: SCHEMA}, effort: 'low'}}, {headers: {'x-jp-action': 'list_meanings'}});   // Why (30 Oct 2026, ap; Gitar on #2546): every desktop sender names its step like this; the e2e answer table and Free AI's cost report key on it
  let answer;
  try { answer = JSON.parse(response.content?.find(block => block.type === 'text')?.text || ''); } catch { return {}; }
  const out = {};
  for (const each of answer?.lists || []) if (asked.includes(each.name)) out[each.name] = checked(each, lists[each.name]);
  return out;
}

// The cached answer for these lists, else one call (kept when it answered). -> {meanings, key}.
export async function meaningsFor(storage, lists, ai) {
  const key = keyOf(lists), kept = storage.settings().listMeanings;
  if (kept?.key === key) return {meanings: kept.meanings, key};
  const meanings = await judgeLists(lists, ai);
  if (Object.keys(meanings).length) storage.saveSettings({listMeanings: {key, meanings}});
  return {meanings, key};
}
