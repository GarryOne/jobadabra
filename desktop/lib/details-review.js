// The unclear fields of Your details as review items (owner, 18 Oct 2026; since 28 Oct 2026 the "Fill your details" drawer, owner: "only missing Your details facts",
// superseding "One queue for all"; a line of the Profile or answers page goes to "What we learned", lib/question-lists.js): "Which is right?" (two copies of a fact
// disagree, lib/profile-move.js openConflicts), "Where does this go?" (the move's AI answered "unsure"), a kind to check (a typed line kept as written: the
// "Check" chip of renderer/fact-line.js, one rule: needsCheck) and a ❓ on the Profile that nothing asked. Each item has the queue's shape ({key, question,
// format, hint, value}) plus .details {kind, source, where, fact (the label it is scored by)}; lib/question-lists.js openShown sorts them into the two drawers the Jobs cards,
// the drawers and the Profile tabs count. answer() saves into the item's home: a Your details section, else the line's own place on the Profile. Guarded by test/details-review.test.js.
import {openStore} from './store/index.js';
import * as sections from './profile-sections.js';
import {itemsOf, openConflicts, resolve, unsureKey} from './profile-move.js';
import * as formats from './question-formats.js';
import {HOME_NAMES, homeOf, writeHome} from './answer-home.js';
import {formatFor} from '../renderer/question-kind.js';
import {KEEP_AS_IS, keyOf} from '../renderer/question-filter.js';
import {needsCheck} from '../renderer/question-values.js';
import * as missingFacts from './missing-facts.js';
import * as factAsks from './fact-asks.js';
import {PARTS, splitNote} from '../renderer/experience-profile-model.js';
import * as clarity from './answer-clarity.js';
import * as contactReview from './contact-review.js';
import * as contactDetails from './contact.js';
import * as cvQueue from './cv-queue.js';
import {folded} from './eligibility-older.js';
import {eligibilityOf, zoneOfLabel} from '../renderer/work-eligibility.js';
import {anthropicApi} from './ai/anthropic-api.js';
import {log} from './log.js';
import {organize} from './profile-routing.js';

export const PREFIX = 'details:';
export const KINDS = ['which', 'check', 'open', 'unclear', 'missing', 'contact', 'cvcheck'];
export const KEEP = 'Keep where it is';
export {KEEP_AS_IS};   // an unclear answer the person keeps: never asked again for that value
const SOURCES = {which: 'Two copies disagree', where: 'Not sure where it belongs', check: 'Saved as you wrote it', open: 'Not answered yet', unclear: 'Unclear', missing: 'Not filled in yet', contact: 'Needed by every form', cvcheck: 'Read from your CV'};
const PAGES = {profile: 'Profile', answers: 'What we learned'};   // the answers page's tab name since 28 Oct 2026 (owner)
const plain = text => String(text || '').replace(/\*\*/g, '').replace(/\s+/g, ' ').trim();
const same = text => plain(text).toLowerCase();
const asked = value => /^❓/.test(plain(value));
// The ids of the lines under a Profile part that has its own screen of answers (CV gaps' ✓ / ✕, the surveys, Experience): their ❓ is asked there, not here.
function ownedElsewhere(outline) {
  const ids = new Set();
  let level = 0;
  for (const entry of outline) {
    if (/^heading_/.test(entry.type || '')) {
      const depth = Number(entry.type.slice(-1)) || 1;
      if (!(level && depth > level)) level = Object.values(PARTS).some(part => part.match.test(splitNote(entry.text).title)) ? depth : 0;
    } else if (level) [entry, ...(entry.rows || [])].forEach(each => ids.add(each.id));
  }
  return ids;
}
// A page's answered lines outside Your details and outside the parts with their own screen: the lines the AI judges and an unclear one is asked from.
const answered = (outline, page, owned = new Set()) => itemsOf(outline, page).filter(each => !each.home && !owned.has(each.id.slice(page.length + 1)));
// A ❓ that stands for the answer ("Industries: ❓ to confirm"), not one inside an answer ("SRE; ❓ DevOps?").
const isAsk = (label, text) => /^❓/.test(plain(text).slice(plain(label).length).replace(/^[\s|:—–-]+/, ''));
const hintOf = text => plain(text).split('❓').slice(1).join(' ').replace(/^[\s|:—–-]+/, '').replace(/^(to confirm|optional)\b\s*[—:-]?\s*/i, '').trim();
const choice = options => ({kind: 'single', list: '', options, constraints: false, control: 'single'});
const keyFor = (kind, ref) => `${PREFIX}${kind}:${JSON.stringify(ref)}`;
export const isDetailsKey = key => String(key || '').startsWith(PREFIX);
function parse(key) {
  const rest = String(key).slice(PREFIX.length), at = rest.indexOf(':');
  try { return {kind: rest.slice(0, at), ref: JSON.parse(rest.slice(at + 1))}; } catch { return {kind: '', ref: {}}; }
}
const item = (kind, ref, fields) => ({key: keyFor(kind, ref), company: '', hint: '', ...fields, details: {kind, source: SOURCES[kind], ...fields.details}});

// The queue items, as the pages are now (a line gone from its page is not asked). Reads the Profile, and the answers page only when a choice is there.
export async function pending(storage, {fetcher, now = new Date(), ai = {}} = {}) {
  const opened = openStore(storage, {fetcher}), kept = formats.kept(storage);
  const found = await sections.read(storage, fetcher);
  const outlines = {profile: await opened.page('profile').outline()};
  const outline = async page => (outlines[page] ||= await opened.page(page).outline());
  const out = [];
  const client = ai.client || (ai.apiKey ? anthropicApi(ai.apiKey) : null);
  await cvQueue.readOnce(storage, {client}).catch(() => false);   // an install set up before the CV read: once per CV file
  // Why (28 Oct 2026, owner, #2322): a zone your nationality opens is answered ("conclude as much as possible, by ourselves"), so it is never asked.
  const eligibility = eligibilityOf(found.eligibility), concluded = eligibility.rows.map(row => row.label);
  // A zone still asked (the template's ❓) waits for Nationality and is never asked once Nationality answers it, like the catalogue's zones (lib/missing-facts.js).
  const zoneWaits = line => line.kind === 'per_country' && zoneOfLabel(line.label) && (!eligibility.nationality || concluded.includes(line.label));
  const have = [...Object.values(found).flat().map(line => line.label), ...concluded, ...itemsOf(outlines.profile, 'profile', {withOpen: true}).map(each => each.label)];
  // Every question about a fact is worded by the queue's one question writer (lib/queue-wording.js), never typed: the contact fields and the base facts.
  const emptyKeys = await contactReview.emptyKeys(storage, {fetcher}).catch(() => []);
  const words = {contact: await contactReview.wordsFor(storage, emptyKeys, {client, have}).catch(() => new Map()), facts: await missingFacts.wording(storage, {client}).catch(() => new Map())};
  const proposedFrom = await cvQueue.items(storage, {fetcher, client, have, words, never: storage.settings().missingFacts?.never || []}).catch(() => []);   // what the CV states or implies, to check
  const cvFields = new Set(proposedFrom.map(each => parse(each.key).ref.contact).filter(Boolean));   // a field the CV proposes is asked there, once
  for (const each of await contactReview.asks(storage, emptyKeys, {client, have, except: cvFields}).catch(() => [])) {   // generated from what is missing, weighted by importance
    out.push(item('contact', {field: each.field}, {question: each.question, format: contactReview.format, hint: each.hint, details: {where: 'Your details → Contact details', fact: contactDetails.LABELS[each.field], weight: contactReview.weightOf(each.importance)}}));
  }
  const conflicts = await openConflicts(storage, {fetcher}).catch(() => []);
  for (const conflict of conflicts) {
    const values = [...new Map(conflict.choices.map(each => [same(each.value), each.value])).values()];
    out.push(item('which', {topic: conflict.topic}, {question: `${conflict.topic.replace(/^./, letter => letter.toUpperCase())}: which is right?`, format: choice(values),
      hint: conflict.choices.map(each => `${each.value} on your ${PAGES[each.page] || each.page}`).join(' · '), details: {where: HOME_NAMES[conflict.home], fact: conflict.choices.find(each => each.label)?.label || conflict.topic}}));
  }
  const unclear = (line, ref, where, format) => {   // the AI's word on a saved answer (lib/answer-clarity.js): asked when it is not clear
    const said = clarity.UNCLEAR[clarity.verdictOf(storage, line)];
    if (said) out.push(item('unclear', ref, {question: line.label || line.value, format, value: line.value, details: {where, source: said, fact: line.label || line.value, line: `Saved: ${line.value}`}}));
  };
  for (const [home, lines] of Object.entries(found)) {
    for (const line of lines) {
      if (home === 'eligibility' && (folded(storage, line) || (asked(line.value) && zoneWaits(line)))) continue;   // an older eligibility line the zones answer: folded into them on Save, never asked (#2322)
      const format = formatFor({marked: line.kind ? {kind: line.kind} : null, kept: kept[keyOf(line.label)]});
      if (asked(line.value)) out.push(item('open', {home, label: line.label}, {question: line.label, format, hint: hintOf(line.value), details: {where: HOME_NAMES[home], fact: line.label}}));
      else if (needsCheck(format.kind, line.value)) out.push(item('check', {home, label: line.label, kind: format.kind}, {question: `${line.label}: make it exact`, format, value: line.value, details: {where: HOME_NAMES[home], fact: line.label}}));
      else unclear(line, {home, label: line.label, value: line.value}, HOME_NAMES[home], format);
    }
  }
  const owned = ownedElsewhere(outlines.profile);
  const askedAlready = new Set([...conflicts.flatMap(each => each.choices), ...storage.settings().profileUnsure || []].map(clarity.sigOf));
  for (const page of ['profile', 'answers']) {
    for (const line of answered(await outline(page), page, owned)) {
      if (askedAlready.has(clarity.sigOf(line))) continue;   // already asked as Which is right? / Where does this go?
      unclear(line, {page, label: line.label, value: line.value}, PAGES[page], formatFor({kept: kept[keyOf(line.label)]}));
    }
  }
  const asks = itemsOf(outlines.profile, 'profile', {withOpen: true})
    .filter(each => each.open && /\p{L}/u.test(each.label) && !each.label.includes('❓') && !owned.has(each.id.slice('profile:'.length)) && isAsk(each.label, each.key));
  for (const each of asks) {
    out.push(item('open', {page: 'profile', label: each.label}, {question: each.label, format: formatFor({kept: kept[keyOf(each.label)]}), hint: hintOf(each.key), details: {where: PAGES.profile, fact: each.label}}));
  }
  // The facts forms ask that nothing holds yet (lib/missing-facts.js): a few a day, the queue's most important first.
  const covered = await missingFacts.covered(storage, have, {ai});
  const proposed = new Set(proposedFrom.map(each => parse(each.key).ref.fact).filter(Boolean));   // a fact the CV proposes is asked there, not again as an empty one
  out.push(...proposedFrom);
  for (const fact of missingFacts.pick(storage, have, {now, covered, shares: factAsks.shares(storage), words: words.facts}).filter(each => !proposed.has(each.id))) {
    out.push(item('missing', {id: fact.id}, {question: fact.question, format: fact.format, hint: fact.hint, details: {where: HOME_NAMES[fact.home], fact: fact.label}}));
  }
  return out;
}

// A Your details line's value replaced (its kind and note kept); '' removes it. -> {ok, homeName, error}.
async function setLine(storage, home, label, value, {fetcher, save}) {
  const current = (await sections.read(storage, fetcher))[home] || [];
  await save(storage, home, current.map(line => (same(line.label) === same(label) ? {...line, value} : line)).filter(line => String(line.value).trim()), fetcher);
  const back = (await sections.read(storage, fetcher))[home] || [];
  const ok = value ? back.some(line => same(line.label) === same(label) && same(line.value) === same(value)) : !back.some(line => same(line.label) === same(label));
  return ok ? {ok: true, homeName: HOME_NAMES[home]} : {ok: false, error: 'It did not save; nothing else changed'};
}

// A line of a page outside Your details, found again by its words: {page, block (the outline entry or table row), item}.
async function lineOn(storage, page, test, {fetcher}) {
  const opened = openStore(storage, {fetcher}), outline = await opened.page(page).outline();
  const found = itemsOf(outline, page, {withOpen: true}).find(each => !each.home && test(each));
  if (!found) return null;
  const id = found.id.slice(page.length + 1);
  const block = outline.find(entry => entry.id === id) || outline.filter(entry => entry.type === 'table').flatMap(entry => entry.rows).find(row => row.id === id);
  return {page: opened.page(page), block, item: found, table: Boolean(block?.cells)};
}

// The person's answer to one item. value: the picked value (which), a section's heading or KEEP (where), the exact value (check), the answer (open; '' = no answer kept).
export async function answer(storage, key, value, {fetcher, ai = {}, save = sections.save} = {}) {
  const {kind, ref} = parse(key), text = String(value ?? '').trim();
  if (kind === 'which') {
    const conflict = (storage.settings().profileConflicts || []).find(each => each.topic === ref.topic);
    const pick = conflict ? conflict.choices.findIndex(each => same(each.value) === same(text)) : -1;
    if (pick < 0) return {ok: false, error: 'Pick one of the values'};
    const done = await resolve(storage, ref.topic, pick, {fetcher, save});
    return done.ok ? {...done, homeName: HOME_NAMES[conflict.home]} : done;
  }
  if (kind === 'where') {
    const pages = (ref.pages || [ref.page]).filter(page => PAGES[page]);   // legacy cached keys still name a single page
    const mine = each => pages.includes(each.page) && unsureKey({...each, page: ''}) === unsureKey({...ref, page: ''});
    const drop = () => storage.saveSettings({profileUnsure: (storage.settings().profileUnsure || []).filter(each => !mine(each))});
    if (text === KEEP || text === 'Keep on the Profile') {
      drop();
      log('profile', 'saved line kept at reviewed sources', {sources: pages, requestedBy: 'review choice'});
      return {ok: true, homeName: pages.map(page => PAGES[page]).join(' · ')};
    }
    const home = Object.keys(sections.SECTIONS).find(each => sections.SECTIONS[each] === text);
    if (!home) return {ok: false, error: 'Pick where it goes'};
    const label = ref.label || ref.value, target = {label, value: ref.value};
    const current = (await sections.read(storage, fetcher))[home] || [];
    // Why (2026-10-27, d9): choosing a home relocates an existing fact; it is not an edit that may replace a different value with the same label.
    if (!current.some(line => unsureKey(line) === unsureKey(target))) await save(storage, home, [...current, target], fetcher);
    if (!(await sections.read(storage, fetcher))[home]?.some(line => unsureKey(line) === unsureKey(target))) return {ok: false, error: 'It did not save; nothing else changed'};
    // Remove each exact source copy only after the destination read-back succeeded; reverse order keeps Markdown line IDs valid.
    const opened = openStore(storage, {fetcher});
    for (const page of pages) {
      const source = opened.page(page), lines = itemsOf(await source.outline(), page).filter(each => !each.home && mine(each));
      for (const line of lines.reverse()) await source.remove({id: line.id.slice(page.length + 1), text: line.check});
    }
    drop();
    log('profile', 'saved line moved after destination read-back', {sources: pages, home, requestedBy: 'review choice'});
    return {ok: true, homeName: HOME_NAMES[home]};
  }
  if (kind === 'unclear') return answerUnclear(storage, ref, text, {fetcher, save});
  if (kind === 'check') return text && !needsCheck(ref.kind || '', text) ? setLine(storage, ref.home, ref.label, text, {fetcher, save}) : {ok: false, error: 'Pick the parts first'};
  if (kind === 'open' && ref.home) return setLine(storage, ref.home, ref.label, text, {fetcher, save});
  if (kind === 'open') {
    const line = await lineOn(storage, ref.page, each => each.open && same(each.label) === same(ref.label), {fetcher});
    if (!line) return {ok: false, error: 'Already answered'};
    const home = text ? await homeOf(ref.label, text, ai) : '';
    if (home && !await writeHome(storage, home, ref.label, text, fetcher, save)) return {ok: false, error: 'It did not save; nothing else changed'};
    if (!text || home) { await line.page.remove({id: line.block.id, text: line.item.check}); return {ok: true, ...(home ? {homeName: HOME_NAMES[home]} : {})}; }
    // Its home is this Profile line (owner, 18 Oct 2026: "answer onto that line").
    if (line.table) await line.page.setCell(line.block, 1, text.slice(0, 1900));
    else await line.page.setText(line.block, `${ref.label}: ${text}`);
    return {ok: true, homeName: 'your Profile'};
  }
  if (kind === 'cvcheck') return cvQueue.answer(storage, ref, text, {fetcher, save});
  if (kind === 'contact') return contactReview.answer(storage, ref.field, text, {fetcher});
  if (kind === 'missing') {
    const fact = missingFacts.byId(ref.id);
    if (!fact) return {ok: false, error: 'That question is no longer open'};
    if (!text) { missingFacts.never(storage, fact.id); return {ok: true}; }   // "Don't keep": never asked again
    return await writeHome(storage, fact.home, fact.label, text, fetcher, save, fact.kind) ? {ok: true, homeName: HOME_NAMES[fact.home]} : {ok: false, error: 'It did not save; nothing else changed'};
  }
  return {ok: false, error: 'That question is no longer open'};
}

// An unclear answer: "Keep as is" closes it for that value; a new value replaces it on its line (a section's, or the Profile / answers page's own).
async function answerUnclear(storage, ref, text, {fetcher, save}) {
  if (!text) return {ok: false, error: 'Type the answer, or keep it as is'};
  if (text === KEEP_AS_IS) { clarity.keepAsIs(storage, ref); return {ok: true, homeName: ref.home ? HOME_NAMES[ref.home] : `your ${PAGES[ref.page] || ref.page}`}; }
  if (ref.home) return setLine(storage, ref.home, ref.label, text, {fetcher, save});
  const line = await lineOn(storage, ref.page, each => same(each.label) === same(ref.label) && same(each.value) === same(ref.value), {fetcher});
  if (!line) return {ok: false, error: 'That line changed; nothing was saved'};
  if (line.table) await line.page.setCell(line.block, 1, text.slice(0, 1900));
  else await line.page.setText(line.block, ref.label ? `${ref.label}: ${text}` : text);
  return {ok: true, homeName: `your ${PAGES[ref.page] || ref.page}`};
}

// The AI's word on each saved answer not judged yet (owner, 18 Oct 2026: "Every answered line, all 3 pages", "Once now + each save"): the Profile, the
// answers page and Your details; a line is judged once and again only when its value changes (lib/answer-clarity.js). The first pass on a Profile moved
// before automatic routing existed also organizes legacy unplaced lines. New/edited lines use the same context-aware destination judgment on each save;
// AI stay keeps a correctly placed line, unknown decisions keep originals for quiet retry. No AI: originals stay intact.
// -> {judged, queued, unclear}.
export async function judgeNew(storage, {fetcher, ai = {}, now = new Date(), copy} = {}) {
  if (!(ai.client || ai.apiKey)) return {judged: 0, queued: 0, unclear: 0};
  const opened = openStore(storage, {fetcher});
  const profile = await opened.page('profile').outline(), owned = ownedElsewhere(profile);
  const lines = [...itemsOf(profile, 'profile').filter(each => !owned.has(each.id.slice('profile:'.length))), ...itemsOf(await opened.page('answers').outline(), 'answers')];
  const fresh = clarity.unjudged(storage, lines, now);
  const organized = await organize(storage, {fetcher, ai, now, fresh, ...(copy ? {copy} : {})});
  if (!organized.judged) clarity.record(storage, [], new Map(), {now, present: lines});
  return {judged: organized.judged, queued: 0, unclear: organized.unclear};
}
