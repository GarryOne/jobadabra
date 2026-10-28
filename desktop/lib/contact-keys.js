// Which contact detail a form field asks for ("Rue et numéro" → street, "Numéro postal d'acheminement" → postal_code, "Formule d'appel"
// → salutation), decided by Claude from the label alone, in any language, once per label and kept (contact-label-keys.json). The
// extension's own label list knows a few words per detail; the session page's rows ask here for the labels it doesn't know
// (owner, 8 Oct 2026: meaning comes from AI, never from keyword lists). Claude sees form labels only, never your details or CV.
// Learning is shared (owner, 8 Oct 2026: "reuse learning from one installation to another"): the order is this Mac's cache, then the
// shared label meanings (the alias pack, lib/aliases.js), then Claude; each answer Claude gives goes back as a proposal (the wording and
// the field name only, never a value: the proposal channel, lib/recipes.js proposal), so the next install needs no call.
// Guarded by test/contact-keys.test.js.
import {LABELS} from './contact.js';
import {aliasKey, cleanLabel} from '../shared/alias-schema.js';
import {inFlight} from './in-flight.js';

export const MODEL = 'claude-haiku-5-5';
export const FILE = 'contact-label-keys.json';
const KEYS = Object.keys(LABELS).filter(key => key !== 'full_name');
const norm = label => String(label || '').replace(/\s+/g, ' ').replace(/^[\s*]+|[\s*:]+$/g, '').trim().toLowerCase().slice(0, 120);   // a required star before or after the words

const INSTRUCTIONS = `For each label of a job application form field, say which of the applicant's contact details it asks for, or "none".
Details: ${KEYS.map(key => `${key} (${LABELS[key]})`).join(', ')}. location is the town or city. salutation is how to address them (Mr/Ms, Monsieur/Madame).
A label asking for something else (a country code, a consent, a question about the job) is "none". Labels may be in any language.`;
const SCHEMA = {type: 'object', additionalProperties: false, required: ['items'], properties: {items: {type: 'array', items: {type: 'object',
  additionalProperties: false, required: ['label', 'key'], properties: {label: {type: 'string'}, key: {type: 'string', enum: [...KEYS, 'none']}}}}}};

const readKept = storage => { try { return JSON.parse(storage.readText(FILE) || '{}') || {}; } catch { return {}; } };

// labels → {label: key|''} for every label: kept answers at once, one Claude call for the rest (when there is AI).
const once = inFlight();
export function keysFor(storage, labels, options = {}) {   // the same labels asked twice at once (two pages, two windows): one call
  const key = [...new Set((labels || []).map(norm).filter(Boolean))].sort().join('\n');
  // The paid call is shared; each caller then reads its own wording from the answers it saved (keys are by the caller's labels).
  return once(key, () => keysForNow(storage, labels, options)).then(() => keysForNow(storage, labels, {...options, client: null}));
}
async function keysForNow(storage, labels, {client, log = () => {}, aliases = [], propose = () => {}} = {}) {
  const kept = readKept(storage), wanted = [...new Set((labels || []).map(norm).filter(Boolean))].slice(0, 40);
  for (const label of wanted) if (!(label in kept) && aliasKey(label, aliases)) kept[label] = aliasKey(label, aliases);   // another install's answer
  const unknown = wanted.filter(label => !(label in kept));
  if (unknown.length && client) {
    const started = Date.now();
    try {
      const response = await client.messages.create({model: MODEL, max_tokens: 8000, system: INSTRUCTIONS,
        messages: [{role: 'user', content: JSON.stringify(unknown)}], output_config: {format: {type: 'json_schema', schema: SCHEMA}}});
      if (response.stop_reason === 'max_tokens') throw new Error('answer cut short');
      const items = JSON.parse(response.content?.find(block => block.type === 'text')?.text || '{}').items || [];
      for (const label of unknown) {
        const key = items.find(item => norm(item.label) === label)?.key;
        if (key) kept[label] = KEYS.includes(key) ? key : '';
      }
      storage.writeText(FILE, JSON.stringify(kept));
      propose(unknown.filter(label => kept[label]).map(label => ({key: kept[label], phrase: cleanLabel(label)})).filter(item => item.phrase));
      log('profile', `form labels read as contact details: ${unknown.filter(label => kept[label]).length} of ${unknown.length}`,
        {keys: unknown.map(label => kept[label] || 'none'), ms: Date.now() - started});
    } catch (error) { log('profile', `form labels not read: ${String(error?.message || error).slice(0, 160)}`, {labels: unknown.length}); }
  }
  return Object.fromEntries((labels || []).map(label => [label, kept[norm(label)] || '']));
}
