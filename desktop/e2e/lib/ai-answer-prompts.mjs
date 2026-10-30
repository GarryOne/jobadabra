// Fingerprint data-free engine instructions freshly captured from the checkout's real offline senders.
// Job: serve stored answers
// Invariants: semantic keys stay unchanged; arrays retain order; no model, cache metadata or applicant values enter a contract.
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {canonical, hash, requestParts} from './ai-answers-engine-items.mjs';
import {python, pythonEnv} from './python.mjs';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
let current;
function contract(body, template) {
  const {system, user, schema: rawSchema} = requestParts(body), schema = structuredClone(rawSchema);
  // Why (JOB-44, 30 Oct 2026, owner): decide task/choices/schema remain semantic context; only its generic instruction layout belongs to the family.
  if (template.family === 'app.decide' && schema?.properties?.results?.items?.properties?.answer?.enum) schema.properties.results.items.properties.answer.enum = ['{allowedAnswers}'];
  const escaped = template.user.replace(/[.*+?^$()|[\]\\]/g, '\\$&').replace(/\{\w+\}/g, '[\\s\\S]+?');
  return {action: template.action, system, user: new RegExp(`^${escaped}$`).test(user) ? template.user : '{unrecognized framing}', items: template.items, schema};
}

/** Capture current contracts offline; root supports isolated source-edit regression tests. Never read a committed prompt manifest. */
export function capturePrompts(root = ROOT) {
  const entries = JSON.parse(execFileSync(python(), [fileURLToPath(new URL('../../../tools/ai-format-python-capture.py', import.meta.url)), '--prompts', root],
    {encoding: 'utf8', maxBuffer: 4 * 1024 * 1024, env: pythonEnv({PYTHONDONTWRITEBYTECODE: '1'})}));
  const result = {};
  for (const {kind, variant, action, request, userTemplate, itemTemplates} of entries) {
    if (!request || !action) throw new Error(`Uncaptured prompt: ${kind}`);
    const name = variant || (kind === 'app.title' ? 'sort' : kind === 'app.visit' ? 'keep' : 'default');
    const template = {family: kind, action, user: userTemplate, items: itemTemplates};
    const value = contract(request, template);
    if (value.user !== userTemplate) throw new Error(`Uncaptured framing: ${kind}`);
    (result[kind] ??= {})[name] = value;
  }
  if (Object.keys(result).length !== 9 || Object.keys(result['app.title']).length !== 2 || Object.keys(result['app.visit']).length !== 2) throw new Error('Incomplete fixed prompt capture');
  return Object.fromEntries(Object.entries(result).sort().map(([family, variants]) => [family, Object.fromEntries(Object.entries(variants).sort())]));
}

/** Hash each family's sorted named variants, preserving all schema prose and array order. */
export const familyHashes = contracts => Object.fromEntries(Object.entries(contracts).map(([family, variants]) => [family, hash(canonical(variants))]));

/** Identify a fixed family by the sender's step (x-jp-action or prompt_cache_key) and compare its wire contract with the freshly captured variants. */
export function promptOf(body, contracts = (current ??= capturePrompts()), action = '') {
  if (!contracts || Object.keys(contracts).length !== 9 || !contracts['app.title']?.sort || !contracts['app.title']?.recheck || !contracts['app.visit']?.keep || !contracts['app.visit']?.leave) throw new Error('Incomplete fixed prompt capture');
  const {system, schema} = requestParts(body), properties = schema?.properties || {};
  const roots = {locations: 'app.place', fit: 'app.title', keep: 'app.visit', visa: 'app.visa', vague: 'app.placeVague', jobs: 'app.placeReading'};
  const hint = Object.keys(roots).find(key => Object.hasOwn(properties, key));
  const familyHint = hint ? roots[hint] : properties.places ? (properties.places.items?.properties?.word ? 'app.places' : 'app.geo')
    : properties.results?.items?.properties?.answer ? 'app.decide' : undefined;
  for (const [family, variants] of Object.entries(contracts)) {
    // Why (JOB-44, Gitar on #2606): a schema root is shared with unrelated senders (job_alerts' jobs, web_search's keep); only the family's own step claims it, so a reworded system still refuses.
    const candidates = Object.entries(variants).filter(([, value]) => value.action === action && (family === familyHint || system.startsWith(value.system.split('.')[0])));
    if (!candidates.length) continue;
    const exact = candidates.find(([, value]) => canonical(value) === canonical(contract(body, {...value, family})));
    const selected = candidates.find(([, value]) => value.system === system) || candidates[0], wire = contract(body, {...selected[1], family});
    // Why (JOB-44, 30 Oct 2026, owner): an unused variant edit invalidates the whole family; arbitrary wire edits must also refuse.
    return {family, hash: exact ? hash(variants) : hash({variants, wire})};
  }
  return undefined;
}
