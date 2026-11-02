// The owner's own values, matched BEFORE a keystroke (owner, 14 Oct 2026: the plan-path claude -p knows the signed-in account's name, e-mail and place, and typed a city
// into a test form; the tripwire only sees it after, and a site may keep a typed draft). One list (the tripwire's: Map value -> kind) and one matcher serve both: the tripwire
// (desktop/e2e/lib/privacy-tripwire.mjs) reads what the page holds, answerForm (extension.js) withholds an answer that matches. TEST HARNESS ONLY: the list arrives from
// the e2e harness through JOBADABRA_E2E_OWNER_VALUES, honoured with JOBADABRA_E2E (desktop/lib/server-env.js); no value, no code path. Only kinds and field ids leave here.
// Guards: app-core/test/owner-guard.test.js, desktop/test/owner-guard-wiring.test.js.

export const plain = (text) => String(text || '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim();
const lastNine = (digits) => digits.slice(-9);
const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// typed: [{label, value}]; values: Map(value -> kind: email, phone, name, location, account). -> [{kind, label}] for each field holding one of them (one hit per field; never the value).
export function matchesOwner(typed, values) {
  const hits = [];
  for (const { label, value } of typed) {
    const text = String(value || '').toLowerCase(), digits = text.replace(/\D/g, '');
    if (!text.trim()) continue;
    for (const [owned, kind] of values) {
      const hit = kind === 'phone' ? digits.length >= 9 && owned.length >= 9 && lastNine(digits) === lastNine(owned)
        : kind === 'name' || kind === 'location' ? new RegExp(`(^|[^\\p{L}\\p{N}])${escape(plain(owned))}($|[^\\p{L}\\p{N}])`, 'u').test(plain(text))
          : text.includes(owned);
      if (hit) { hits.push({ kind, label: String(label || '').slice(0, 60) }); break; }
    }
  }
  return hits;
}

// The harness's list as it travels (a JSON array of [value, kind]) -> Map; anything else -> null (no guard).
export function parseOwnerValues(json) {
  try {
    const pairs = JSON.parse(json);
    const map = new Map(pairs.filter((p) => Array.isArray(p) && p[0] && p[1]).map(([value, kind]) => [String(value), String(kind)]));
    return map.size ? map : null;
  } catch { return null; }
}

// answers: [{field, value, ...}]; labelOf: field id -> label. -> {answers, withheld: [{field, kind}]}: a matching answer keeps its place with an empty value
// (nothing is typed; a field the AI answered with the owner's value is left empty). Never the value.
export function withholdOwner(answers, labelOf, values) {
  if (!values) return { answers, withheld: [] };
  const withheld = [];
  const kept = answers.map((a) => {
    if (a.value === '' || a.value == null) return a;
    const [hit] = matchesOwner([{ label: labelOf[a.field] || a.field, value: Array.isArray(a.value) ? a.value.join(' ') : a.value }], values);
    if (!hit) return a;
    withheld.push({ field: String(a.field).slice(0, 60), kind: hit.kind });
    return { ...a, value: '', use: 'propose', withheld: hit.kind };
  });
  return { answers: kept, withheld };
}
