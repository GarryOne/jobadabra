// A salary asked in another currency or period than the saved target is converted by the code, never by the AI (owner, 15 Oct 2026): a daily ECB reference rate
// (cached per day, a fixed table when it cannot be fetched), a clean figure (a year to the nearest 1,000, a month to the nearest 100), in the field's own format.
// The AI only reads the question (answer-facts.js FACT_RULE: pay_asks); an unclear period or gross/net stays a proposal. Guarded by worker/test/pay-convert.test.js.
const ECB_DAILY = 'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml';
// Units of each currency for 1 EUR, 15 Oct 2026: the offline fallback only (a figure rounded to 1,000 hides a few percent of drift).
export const FALLBACK_PER_EUR = { EUR: 1, CHF: 0.93, USD: 1.08, GBP: 0.85, SEK: 11.5, NOK: 11.7, DKK: 7.46, PLN: 4.3, CZK: 25.0, HUF: 395, CAD: 1.47, AUD: 1.65, JPY: 162, INR: 90, SGD: 1.45 };

let cached = null;   // {day, rates, source}
export async function ratesToday({ fetchFn = globalThis.fetch, now = Date.now() } = {}) {
  const day = new Date(now).toISOString().slice(0, 10);
  if (cached?.day === day) return cached;
  let rates = null;
  try {
    const xml = await (await fetchFn(ECB_DAILY, { signal: AbortSignal.timeout(3000) })).text();
    const found = Object.fromEntries([...xml.matchAll(/currency='([A-Z]{3})'\s+rate='([0-9.]+)'/g)].map((m) => [m[1], Number(m[2])]).filter(([, r]) => r > 0));
    if (Object.keys(found).length > 5) rates = { EUR: 1, ...found };
  } catch { /* offline or blocked: the fixed table */ }
  cached = { day, rates: rates || FALLBACK_PER_EUR, source: rates ? 'ecb' : 'fallback' };
  return cached;
}
export const forgetRatesForTests = () => { cached = null; };

const round = (n, per) => { const step = per === 'month' ? 100 : 1000; return Math.round(n / step) * step; };

// -> the converted figure as the field wants it, or null when it cannot be done safely (the answer stays a proposal).
export function convertPay(ask, field, { rates }) {
  const ok = (code) => /^[A-Z]{3}$/.test(code || '') && rates[code] > 0;
  if (!ask || !(ask.amount > 0) || !ok(ask.currency) || !ok(ask.asked_currency)) return null;
  if (!['year', 'month'].includes(ask.per) || !['year', 'month'].includes(ask.asked_per) || ask.basis_clear !== true) return null;
  let value = ask.amount / rates[ask.currency] * rates[ask.asked_currency];
  if (ask.per !== ask.asked_per) value = ask.per === 'year' ? value / 12 : value * 12;
  const figure = round(value, ask.asked_per);
  return String(field?.type || '') === 'number' ? String(figure) : `${ask.asked_currency} ${figure}`;
}

// A figure for a number box; in a text box the value names the ISO currency it is in (a bare figure there could be read in the job country's).
const saysCurrency = (a, ask, field) => String(field?.type || '') === 'number' || (/^[A-Z]{3}$/.test(ask.currency || '') && new RegExp(`\\b${ask.currency}\\b`, 'i').test(String(a.value || '')));

// Sets (typed) each answer a pay_ask converts; one it cannot convert is kept as a proposal.
// A salary the AI typed without listing it in pay_asks (so without saying which currency and period the form asks) is only proposed: a figure in the wrong currency
// is worse than an empty box.
export async function applyPay(answers, asks, fields, env = {}) {
  const list = (Array.isArray(asks) ? asks : []).filter((ask) => answers.some((a) => a.field === ask.field));
  const unlisted = (a) => a.fact === 'salary' && a.use === 'fill' && !list.some((ask) => ask.field === a.field);
  if (!list.length) return answers.map((a) => (unlisted(a) ? { ...a, use: 'propose' } : a));
  const today = await ratesToday(env);
  const byId = Object.fromEntries(fields.map((f) => [f.field, f]));
  return answers.map((a) => {
    const ask = list.find((x) => x.field === a.field);
    if (unlisted(a)) return { ...a, use: 'propose' };
    if (!ask) return a;
    // Why (#2203): listed = a salary answer, whatever fact the AI named. In the stated target's own currency and period it is the stated target: typed, also when the AI held it as a proposal
    // (27 Oct 2026, fair round form 106: "salary expectations? A range is fine." left empty 3 of 3), as long as a text box's value says its currency.
    if (ask.currency === ask.asked_currency && ask.per === ask.asked_per) return { ...a, fact: 'salary', ...(saysCurrency(a, ask, byId[a.field]) ? { use: 'fill' } : {}) };
    const value = convertPay(ask, byId[a.field], today);
    return value ? { ...a, value, use: 'fill', fact: 'salary', converted: { from: ask.currency, to: ask.asked_currency, rates: today.source } } : { ...a, use: 'propose' };
  });
}
