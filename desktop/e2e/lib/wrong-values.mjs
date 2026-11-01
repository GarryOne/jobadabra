// Wrong values at an offline replay's end (spec docs/superpowers/specs/2026-10-14-wrong-values.md; owner, 14 Oct 2026, Discussion #650). Today a field filled with the wrong
// value counts as filled. Layer 1 "typed = decided": every field the app's /extension/answer reply filled holds THAT answer, read by lib/replay-truth.mjs (the replays' one reader).
// Layer 2 "decided = right": an answer resting on a saved contact fact holds the fake applicant's own value (yes/no facts need the question's direction: AI only, not here).
// The app's replies are kept in memory by lib/app-front.mjs (ai-calls.json holds no values). All data is the fake applicant's. Guard: e2e/test/wrong-values.test.mjs.
import {expectedAnswers, readTab, sameAnswer} from './replay-truth.mjs';

const bodyOf = reply => { try { return JSON.parse(reply.body); } catch { return null; } };

// replies: [{route, body}] -> the answers that were TYPED (use "fill"; a proposal is not), as replay-truth's item shape, plus the raw typed list.
export function itemOfReplies(replies = []) {
  const answers = [], picks = [];
  for (const reply of replies) {
    const body = bodyOf(reply);
    if (reply.route === '/extension/answer') answers.push(...(body?.answers || []).filter(one => one?.use === 'fill'));
    else if (reply.route === '/extension/pick-choice' && body) picks.push({answer: body});
  }
  return {answers, item: {ai: {'/extension/answer': [{answer: {answers}}], '/extension/pick-choice': picks}}};
}

const words = text => String(text || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().split(/[^\p{L}\p{N}@.+_-]+/u).map(word => word.replace(/^[.+_-]+|[.+_-]+$/g, '')).filter(Boolean);
const digits = text => String(text || '').replace(/\D/g, '');

// Layer 2. answers: typed answers ({field, value, fact}); contact: the fake applicant's. -> [line] (a value that differs from the applicant's own)
export function knownFailures(answers, contact = {}) {
  // location_forms: the fake applicant's own place in the languages forms use (14 Oct 2026: "Schweiz" for Switzerland was called wrong); applicant data, not a word list.
  const home = new Set(words([contact.location, contact.street, contact.postal_code, ...(contact.location_forms || [])].join(' ')));
  const own = new Set([...home, ...words([contact.first_name, contact.last_name, contact.full_name].join(' '))]);
  const out = [];
  for (const one of answers) {
    const value = String(one.value || '').trim();
    if (!value || !['contact', 'home_location'].includes(one.fact)) continue;
    // A choice control (radio, checkbox, select) holds one of the page's own options, often a yes/no ABOUT the fact, not the fact: layer 1 already checks it
    // holds the decided answer (14 Oct 2026: a yes/no radio citing home_location read "No" and was called wrong against the whole address).
    if (/^(radio|checkbox|select)[:[]/i.test(String(one.field || ''))) continue;
    let right = true, want = '';
    if (one.fact === 'contact' && /^\S+@\S+$/.test(value)) { want = contact.email; right = sameAnswer(contact.email, [value]) && value.toLowerCase() === String(contact.email).toLowerCase(); }
    else if (one.fact === 'contact' && /^[+\d][\d\s()./-]{6,}$/.test(value)) { want = contact.phone; right = digits(value).slice(-9) === digits(contact.phone).slice(-9); }
    else if (one.fact === 'contact' && /^(https?:\/\/|www\.)/i.test(value)) { want = contact.linkedin; right = value.replace(/\/+$/, '') === String(contact.linkedin).replace(/\/+$/, ''); }
    else { const pool = one.fact === 'home_location' ? home : own; want = [...pool].join(' '); right = words(value).every(word => pool.has(word)); }
    if (!right) out.push({field: one.field, held: value.slice(0, 60), answer: String(want).slice(0, 60), layer: 'known'});
  }
  return out;
}

// The whole check on the replay's last application tab. -> {checked, compared, wrong: [{field, held, answer, layer}]}
export async function wrongValues(page, replies, contact) {
  const {answers, item} = itemOfReplies(replies), expected = expectedAnswers(item);
  const tab = await readTab(page, [...expected.keys()]);
  const picks = item.ai['/extension/pick-choice'].map(one => String(one.answer?.choice || '').trim()).filter(Boolean);
  const wrong = [];
  let compared = 0;
  for (const [field, value] of expected) {
    const got = tab.read.get(field);
    if (got?.state === 'value') compared += 1;
    if (got?.state === 'value' && !sameAnswer(value, got.shown) && !picks.some(choice => sameAnswer(choice, got.shown))) wrong.push({field, held: String(got.shown[0] || '').slice(0, 60), answer: value.slice(0, 60), layer: 'typed'});
  }
  wrong.push(...knownFailures(answers, contact));
  return {checked: expected.size, compared, wrong};
}
