// The Pro plan's words and numbers for the window (Settings → Plan, the sidebar counter, ⌘K), kept free of the DOM so a test can read them
// (private spec jobadabra-lab:docs/specs/2026-10-16-pro-plan.md §4, owner decisions 16 Oct 2026): the AI credit is a bar and a percent, never dollars or "applications left";
// "one-time payment, no subscription", never "lifetime"; the own key is the way out when the credit runs low. Prices come from the site's offers (/api/pro/status), never from here.
export const OWN_KEY = 'Your own key is unlimited and saves your AI credit.';
export const NO_CREDIT = 'Your own AI key is unlimited. Add AI credit to use our AI.';
const EVERYTHING = ['Unlimited applications, no time limit', 'Your own AI key: unlimited, nothing counted', 'Add AI credit anytime with a one-time top-up', '14-day refund, any reason'];
export const ALWAYS_ON = 'Always on: new matches every morning, even when your Mac is off';
// What each package says it includes (the prices come from the site's offers, never from here).
export const PACKAGE_INCLUDES = {pro: [...EVERYTHING, ALWAYS_ON], 'pro-ai': ['Everything in Pro', 'AI credit for a whole job search, no setup', ALWAYS_ON]};
export const INCLUDED = EVERYTHING;   // the waitlist card's list (pages/plan-waitlist.js)
export const TOPUP_NOTE = 'Top-ups are one-time, VAT is included in the price. Each adds credit worth what you pay, used at our AI prices; the bar shows what is left.';
// The euro amount an offer adds, as the site says it (offers[].creditEur; 24 Oct 2026: €1 of credit = €1 at our AI prices, so a top-up adds what it costs). '' when the site did not send it (an older site).
export const creditWords = offer => (offer?.creditEur > 0 ? `€${offer.creditEur} of AI credit` : '');
export const NOTES = {
  30: 'Your AI credit is under 30%. Add credit anytime, or use your own AI key: it is unlimited and saves your credit.',
  10: 'Your AI credit is under 10%. Add credit anytime, or use your own AI key: it is unlimited and saves your credit.',
  0: 'Your AI credit is used up. Add credit, or use your own AI key in Settings → Connections → AI (your own key is unlimited).',
};
export const NO_CREDIT_BLOCK = 'Our AI needs AI credit. Add credit, or use your own AI key in Settings → Connections → AI (your own key is unlimited).';

const euro = value => `€${value}`;
const offerOf = (plan, id) => (plan.offers || []).find(offer => offer.id === id);
// The site's offers as the card shows them: {kind (the checkout kind), name, price, list, included, button}.
const packageCard = offer => ({kind: offer.id, name: offer.name, price: euro(offer.price), list: offer.list ? euro(offer.list) : null, button: 'Pay securely with Stripe',
  included: (PACKAGE_INCLUDES[offer.id] || []).map(text => (creditWords(offer) && text === PACKAGE_INCLUDES['pro-ai'][1] ? `${creditWords(offer)}, no setup` : text))});

// What the Plan card shows for the site's answer: null when the plan is off (nothing about Pro is on screen) or the site offered nothing.
export function planView(plan = {}) {
  if (!['test', 'live'].includes(plan.mode)) return null;
  const base = {mode: plan.mode, title: plan.plan === 'pro' ? 'Your plan' : 'Upgrade your plan'};   // Free is the card above ("Your plan"); this one only offers more, so no second Free pill
  if (plan.plan !== 'pro') {
    const packages = ['pro', 'pro-ai'].map(id => offerOf(plan, id)).filter(Boolean).map(packageCard);
    return packages.length ? {...base, kind: 'upgrade', pill: '', packages} : null;
  }
  const topups = (plan.offers || []).filter(offer => offer.id.startsWith('topup')).map(offer => ({kind: offer.id, price: euro(offer.price), adds: creditWords(offer)}));
  const upgrade = plan.package === 'pro' && offerOf(plan, 'upgrade') ? {kind: 'upgrade', price: euro(offerOf(plan, 'upgrade').price), name: offerOf(plan, 'upgrade').name} : null;
  if (plan.hasCredit === false) return {...base, kind: 'pro', pill: plan.package === 'pro-ai' ? 'Pro + AI' : 'Pro', hasCredit: false, label: 'Pro: no application limit', note: NO_CREDIT, upgrade, topups};
  const percent = Math.max(0, Math.min(100, plan.creditPercent ?? 0));
  return {...base, kind: 'pro', pill: plan.package === 'pro-ai' ? 'Pro + AI' : 'Pro', hasCredit: true, percent, label: `AI credit: ${percent}% left`, tone: (plan.warn ?? 99) <= 10 ? 'bad' : 'info', note: NOTES[plan.warn] || OWN_KEY, warn: plan.warn ?? null, upgrade, topups};
}

// The warning to say once per step (30, 10, then 0): which steps were already said, and what to say now. -> {say: 30 | 10 | 0 | null, said: [...]}
export function warnNow(warn, said = []) {
  if (warn == null) return {say: null, said: []};   // above 30% again: the steps are new next time
  return said.includes(warn) ? {say: null, said} : {say: warn, said: [...said, warn]};
}

// "I have Pro": what to say for the site's refusal of a code.
const WORDS = {
  expired: 'That code has expired. Ask for a new one.', locked: 'Too many tries. Ask for a new code.', other: 'This computer already belongs to another Pro account.',
};
export const signinWords = answer => answer.error === 'wrong' ? `That code is not right. ${answer.left} ${answer.left === 1 ? 'try' : 'tries'} left.` : WORDS[answer.error] || answer.error || 'That did not work. Try again.';

