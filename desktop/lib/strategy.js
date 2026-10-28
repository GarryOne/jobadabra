// Strategy builder: CV (PDF) + an optional note from the user -> proposed goals, a draft Profile, standard answers
// and search settings, in one Claude call. Nothing is saved until the user reviews (and corrects) the draft.
import {nameOfClient} from './ai/names.js';
import {priceOf} from './ai/models.js';
import {anthropicApi} from './ai/anthropic-api.js';
import fs from 'node:fs';
import path from 'node:path';
import {wordsOf} from './strategy-rebuild.js';
export {DEFAULT_TARGET, ROLE_TERM, SEARCH_SETTINGS_TITLE, addPlaces, addRoles, applyTune, chooseOffered, clampTarget, dailyTarget, dropLocalCopies, forgetPageCopy, keepLocally, loosen, oneRolesList, profileTexts, publishSearchSettings, retune, save, saveLocal, setDailyTarget, tuned} from './strategy-settings.js';
export {EDITABLE_LISTS, applyEdits, cleanEdits, editLists, edited} from './strategy-edit.js';
export {SCORES_PER_SEARCH, SCORE_USD, rebuildGroups, wordsOf} from './strategy-rebuild.js';
import {REPO} from './pipeline.js';
import {askAgainNote, emptyParts} from './strategy-empty.js';
import {withDerived} from './target-roles.js';

export const MODEL = process.env.JOB_PILOTTO_MODEL_OVERRIDE || 'claude-sonnet-5-5';   // the override is for the end-to-end journey (desktop/e2e): every step on Haiku
const PRICE = {input: 2, output: 10}; // USD per million tokens, claude-sonnet-5-5

// Contact details typed into application forms (the Chrome extension's fields), read from the CV.
export const CONTACT_FIELDS = ['first_name', 'last_name', 'full_name', 'email', 'phone', 'location', 'linkedin', 'github', 'website'];
const list = {type: 'array', items: {type: 'string'}};
const object = (properties) => ({type: 'object', additionalProperties: false, required: Object.keys(properties), properties});
// The goals the review shows as tiles (roles and places are the search lists): proposed from the CV, corrected by the user.
export const GOALS = {seniority: 'Target level', work_mode: 'Work mode', minimum_salary: 'Minimum salary', languages: 'Languages you work in'};
export const DRAFT_SCHEMA = object({
  summary: {type: 'string'},
  goals: object(Object.fromEntries(Object.keys(GOALS).map(key => [key, {type: 'string'}]))),
  profile_markdown: {type: 'string'},
  answers_markdown: {type: 'string'},
  open_questions: list,
  search: object({
    target_roles: list, level: list, title_exclude_keywords: list, board_discovery_keywords: list,
    quality_stack_keywords: list,
    locations: object({top_tier: list, country_wide: list, abroad: list}),
    remote_excluded_regions: list,
    google_jobs: object({
      queries: list, country: {type: 'string'},
      locations: {type: 'array', items: object({location: {type: 'string'}, language: {type: 'string'}})},
    }),
  }),
  preferences: object({disqualifying_languages: list, excluded_companies: list, work_rights: list}),
  contact: object(Object.fromEntries(CONTACT_FIELDS.map(field => [field, {type: 'string'}]))),
});

// Remote jobs open only to other parts of the world are not for this user (a friend in Romania was shown "Remote (United States | Canada)"
// roles, 2 Oct 2026, because the drafted list was short). Whatever the AI proposes, these regions are skipped unless the user's own places
// are in them. Regex fragments, as in config/search.json.
export const DEFAULT_REMOTE_EXCLUDED = ['\\busa?\\b', '\\bunited\\ states\\b', 'u\\.s\\.', '\\bcanada\\b', '\\bnorth\\ america\\b', '\\blatam\\b',
  '\\blatin\\ america\\b', '\\bapac\\b', '\\basia\\b', '\\bindia\\b', '\\baustralia\\b', '\\bbrazil\\b', '\\bmexico\\b', '\\bamericas\\b'];
export function withRemoteDefaults(search = {}) {
  const places = Object.values(search.locations || {}).flat().map(String).join(' | ');
  // A region is the user's own when their places are in it: "latam" for someone in Brazil, "north america" for someone in the US.
  const IN_REGION = {latam: /brazil|mexico|argentina|chile|colombia|peru|uruguay/, 'latin america': /brazil|mexico|argentina|chile|colombia|peru|uruguay/,
    'north america': /united states|usa|\bus\b|canada|mexico/, americas: /united states|usa|\bus\b|canada|mexico|brazil|argentina|chile|colombia/,
    apac: /australia|india|japan|singapore|new zealand/, asia: /india|japan|singapore/,
    'usa?': /united states|\busa?\b/, 'u.s.': /united states|\busa?\b/, 'united states': /united states|\busa?\b/};
  const mine = fragment => {
    const words = fragment.replace(/\\b|\\/g, '').toLowerCase();
    if (IN_REGION[words]?.test(places.toLowerCase())) return true;
    try { return new RegExp(fragment, 'i').test(places); } catch { return false; }
  };
  const have = new Set((search.remote_excluded_regions || []).map(String));
  const added = DEFAULT_REMOTE_EXCLUDED.filter(fragment => !have.has(fragment) && !mine(fragment));
  return added.length ? {...search, remote_excluded_regions: [...(search.remote_excluded_regions || []), ...added]} : search;
}

export function userNote(answers = {}) {
  const note = String(answers.anything_else || '').trim();
  return note ? `<note_from_user>\n${note}\n</note_from_user>\n\n` : '<note_from_user>(none: propose everything from the CV)</note_from_user>\n\n';
}

// The note the user wrote before building ("What should the AI know about what you want?"), kept at the end of the
// drafted Profile, so Notion has it (the source of truth; settings.questionnaire is only the field's unsent draft).
// A section already there (a regenerated draft) is replaced; no note, no section.
export const NOTE_HEADING = '# What I told the AI';
export function withNote(profile, answers = {}) {
  const note = String(answers.anything_else || '').trim();
  const lines = String(profile || '').split('\n');
  const start = lines.findIndex(line => line.trim() === NOTE_HEADING);
  let kept = lines;
  if (start >= 0) {
    const end = lines.findIndex((line, i) => i > start && /^#\s/.test(line));
    kept = [...lines.slice(0, start), ...(end >= 0 ? lines.slice(end) : [])];
  }
  const body = kept.join('\n').trimEnd();
  if (!note) return body ? `${body}\n` : '';
  const text = note.split('\n').map(line => line.trimEnd()).join('\n');
  return `${body}\n\n${NOTE_HEADING}\n\n${text}\n`;
}

function template() {
  const text = fs.readFileSync(path.join(REPO, 'docs', 'notion-profile-template.md'), 'utf8');
  return text.slice(text.indexOf('## 👤'));
}

export const INSTRUCTIONS = `You set up Jobadabra, a job-search assistant, for a new user from their CV and, if they wrote one, a short note. They did not fill in a questionnaire: you propose what they are looking for from the CV, and they correct it in a review before anything is saved.

First decide their goals from the CV (the note wins where it says something):
- Target roles: their current role family at their current level, plus close titles the CV clearly supports.
- Level: the seniority their experience shows (e.g. "Senior", "Staff / Principal").
- Places: where they live now (from the CV), then the rest of that country, then remote in their region; abroad only if the CV shows moves or the note asks.
- Work mode: "On-site, hybrid or remote" unless the CV or note says otherwise.
- Minimum salary: a realistic floor for that level and market, in the local currency, a year, ending with "(estimate)". Never present it as their own figure.
- Languages they can work in, with level, from the CV. A language the CV and note don't mention is unknown, not one they can't work in: ask it (❓), never rule jobs out for it.
- Companies to skip: their current employer.

Write:
0. goals: those proposals in a few words each (seniority, work_mode, minimum_salary, languages). The same values go into the Profile below.
1. profile_markdown: the user's Profile, following the "Profile — CV and Preferences" template's headings. Facts only from the CV and the note, plus the goals above (keep the template's row names "Work mode", "Languages I can work in", "Minimum seniority" and the Compensation line "Minimum acceptable:", so the user's corrections land in the right place). Keep its "🛂 Work eligibility", "💶 Availability & compensation" and "🗣️ Languages" headings and their line labels as written: each fact goes on its one line there, nowhere else. Work eligibility: Nationality is the countries of citizenship by their English names ("Romania, Moldova"); the three zone lines (EU / EEA + Switzerland, United Kingdom, United States) keep their "[per country]" mark and get a status only when the CV or note states a permit or visa for that zone ("yes, with a permit"), else ❓ (the app concludes the zones a nationality opens itself); never a line about a city. No contact or links section: the app writes those itself, from the "contact" field. Mark anything else unknown (work permit, notice period…) with ❓ (the app treats ❓ as "ask the user", never as a fact).
2. answers_markdown: their standard application answers, following the "Application Answers" template, same rule for ❓. Include a short "Cover letter style" section inferred from how the CV is written.
3. search: what the job crawler looks for. Values in title_exclude_keywords, board_discovery_keywords, quality_stack_keywords, locations and remote_excluded_regions are case-insensitive regex fragments in the style of the example (e.g. "z[uü]rich", "\\\\bsre\\\\b", "platform engineer", "registered nurse", "\\\\bhr\\\\b"). level is one word for the seniority they are looking for, "junior", "mid", "senior" or "lead" (from the Level goal above), or an empty list when the CV does not make it clear: it skips postings whose title plainly names another level, so leave it empty rather than guess. locations.top_tier and country_wide may use a region word instead of a list of towns when it fits ("Switzerland", "Romandie", "Deutschschweiz", "Ticino", "Greater Zurich", "Basel region", "Lake Geneva", "Central Switzerland", "Eastern Switzerland", "Mittelland"). Whatever their profession, take the role titles and the skills, tools, systems and certifications from their own CV, not from IT: quality_stack_keywords are the ones that make a job a better match for them ("sql" for an analyst, "bls" for a nurse, "datev" for an accountant). target_roles (6 to 10) are the job titles they look for, most important first, each a real job title alone, one to three words, in the language job ads in their places use (e.g. "lkw fahrer", "site reliability engineer", "comptable"), with no seniority level, no town, no contract or hours words and no regex: every title is matched against posting titles, and the first five are also typed into job boards' search boxes, where a longer phrase makes boards return fewer jobs or unrelated ones (the board's own place field and the crawler's level and place filters do the narrowing). Do not list a short form or spelling of a title as a title of its own. google_jobs.queries are plain search phrases (3 to 6). locations.top_tier holds the cities they want most, country_wide the rest of that country, abroad other cities they'd move to. remote_excluded_regions lists regions whose "remote" jobs exclude them. google_jobs.locations uses SerpApi canonical names ("Zurich,Zurich,Switzerland") with the place's own language code ("de" for Zurich, "fr" for Geneva, "en" for London).
4. preferences.disqualifying_languages: only languages the CV or note says they can't work in; [] when neither says (a language missing from the CV is not one of them). excluded_companies: companies to skip (their current employer, and any the note names). work_rights: where they can work without a visa, from their citizenship or permits in the CV or note: their own country (a country name, lower case), and \"eu\" when they are an EU citizen; [] when the CV does not say. Never assume it from where they live now.
5. summary: at most 2 short sentences to the user, addressing them as "you" (never by name, never "I've set up"), saying what you'll search for and what they should check. open_questions: what they should still answer, short.
Leave out template rows and links that don't fit their kind of work instead of marking them ❓ (e.g. GitHub, On-call and "IC only, or tech lead" for someone outside software); ask with ❓ only what changes which jobs fit them or what a form needs from them. A link the CV does not show but that could still fit them (GitHub, a portfolio) stays as "❓ optional" so it is not counted as missing.
6. contact: the user's contact details exactly as written in the CV (city for location; full URLs for LinkedIn, GitHub and website). first_name and last_name: the applicant's own name from the CV's heading or contact block, copied even when it is the same as the name of an account you are signed in with; never empty when the CV shows a name. Empty string for anything the CV doesn't show; never guess.
Use only the applicant details given here; never a name, e-mail address, phone number, country, city, street address or other location from any other context (such as an account you are signed in with): when a detail is not given, leave it empty.`;

// The draft streams in, in schema order; progress is how much of it has arrived and which part is being
// written. The expected length starts at a typical draft and then follows this user's last one.
const PARTS = [['"summary"', 'Writing the summary'], ['"goals"', 'Proposing your goals'], ['"profile_markdown"', 'Writing your Profile'],
  ['"answers_markdown"', 'Writing your standard answers'], ['"open_questions"', 'Listing what to check'],
  ['"search"', 'Choosing search settings'], ['"preferences"', 'Setting filters']];

// The bar: 0-10% while Claude reads the CV (main.js ticks it by time), then each part of the answer has its
// share, in the fixed order Claude writes them; inside a part, its length so far against its usual length
// (learned from the user's last draft: settings.draftSections).
export const SECTIONS = [['summary', 3, 400], ['goals', 2, 250], ['profile_markdown', 40, 15000], ['answers_markdown', 20, 9000],
  ['open_questions', 3, 500], ['search', 17, 3500], ['preferences', 3, 300], ['contact', 2, 300]];
export const READING = 10;
export function sectionLengths(text) {
  const at = SECTIONS.map(([key]) => text.indexOf(`"${key}"`));
  return Object.fromEntries(SECTIONS.map(([key], i) => [key, at[i] < 0 ? 0 : (at.slice(i + 1).find(n => n > at[i]) ?? text.length) - at[i]]));
}
export function progress(text, typical = {}) {
  let part = 'Reading your CV';
  for (const [key, label] of PARTS) if (text.includes(key)) part = label;
  const lengths = sectionLengths(text);
  let percent = text.length ? READING : 0;
  const started = SECTIONS.filter(([key]) => lengths[key]);
  started.forEach(([key, share, usual], i) => {
    // A finished part (the next one has started) counts in full; only the one being written is estimated.
    percent += i < started.length - 1 ? share : share * Math.min(0.95, lengths[key] / (typical[key] || usual));
  });
  return {part, percent: Math.min(99, Math.round(percent)), chars: text.length, notes: notes(text)};
}

// What Claude has written so far, as short lines for the screen ("Profile: Hard constraints", "Roles: site
// reliability, platform engineer"), read from the JSON it streams. Only finished pieces are shown.
const unescape = s => s.replace(/\\n/g, ' ').replace(/\\"/g, '"').replace(/\\u00e9/g, 'é').trim();
export function notes(text) {
  const out = [];
  const region = (key, next) => {
    const start = text.indexOf(`"${key}"`);
    if (start < 0) return null;
    const end = next.map(k => text.indexOf(`"${k}"`, start + 1)).filter(i => i > 0).sort((a, b) => a - b)[0];
    return {body: text.slice(start, end ?? text.length), done: end !== undefined};
  };
  const summary = text.match(/"summary"\s*:\s*"((?:[^"\\]|\\.)*)"/);
  if (summary) out.push(`Summary: ${unescape(summary[1]).slice(0, 140)}`);
  const goals = text.match(/"goals"\s*:\s*\{((?:[^}"]|"(?:[^"\\]|\\.)*")*)\}/);
  if (goals) {
    const values = Object.keys(GOALS).map(key => (goals[1].match(new RegExp(`"${key}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"`)) || [])[1]).filter(Boolean);
    out.push(`Proposed goals: ${values.map(unescape).join(' · ')}`);
  }
  for (const [key, label, next] of [['profile_markdown', 'Profile', ['answers_markdown']], ['answers_markdown', 'Standard answers', ['open_questions', 'search']]]) {
    const piece = region(key, next);
    if (!piece) continue;
    const headings = [...piece.body.matchAll(/(?:\\n|: ?")#{1,3} ([^\\"]{2,70})(?=\\n)/g)].map(m => m[1].trim());
    for (const heading of headings) out.push(`${label}: ${heading}`);
    if (piece.done) out.push(`${label} written`);
  }
  const questions = text.match(/"open_questions"\s*:\s*\[((?:[^\]"]|"(?:[^"\\]|\\.)*")*)\]/);
  if (questions) out.push(`Things for you to check: ${(questions[1].match(/"(?:[^"\\]|\\.)*"/g) || []).length}`);
  const list = key => {
    const m = text.match(new RegExp(`"${key}"\\s*:\\s*\\[((?:[^\\]"]|"(?:[^"\\\\]|\\\\.)*")*)\\]`));
    return m ? (m[1].match(/"((?:[^"\\]|\\.)*)"/g) || []).map(s => s.slice(1, -1).replace(/\\\\b/g, '').replace(/\\\\/g, '').replace(/\[[a-z]([^\]])\]/g, '$1')) : null;
  };
  const roles = list('target_roles');
  if (roles) out.push(`Target roles: ${roles.slice(0, 6).join(', ')}${roles.length > 6 ? '…' : ''}`);
  const places = list('top_tier');
  if (places) out.push(`Best places: ${places.slice(0, 5).join(', ')}${places.length > 5 ? '…' : ''}`);
  const languages = list('disqualifying_languages');
  if (languages) out.push(languages.length ? `Jobs requiring ${languages.join(', ')} will be hidden` : 'No language filter');
  if (/"contact"\s*:\s*\{[^}]*"email"\s*:\s*"[^"]+"/.test(text)) out.push('Contact details found in your CV');
  return out;
}

// answers: {anything_else} from the wizard's strategy step (optional; older drafts had a whole questionnaire).
// A rebuild (setup done before): what the user already chose or confirmed, from the search settings' cache. 7 Oct 2026: a rebuild from a
// CV that names no permit proposed to delete the user's Swiss B permit and EU citizenship, and asked "❓ country" with Geneva in the search.
export function knownFacts(storage) {
  if (!storage.settings().setupDone) return null;
  const read = name => { try { return JSON.parse(storage.readText(name) || '{}'); } catch { return {}; } };
  const search = read('config/search.json'), prefs = read('config/preferences.json');
  const places = search.locations || {};
  return {places: [...(places.top_tier || []), ...(places.country_wide || []), ...(places.abroad || [])].map(wordsOf).filter(Boolean),
    work_rights: prefs.work_rights || [], disqualifying_languages: prefs.disqualifying_languages || []};
}
function knownText(known) {
  if (!known) return '';
  return `<current_settings>\nThe user chose or confirmed these before: use them in the Profile (Countries, Home base, Nationality, Languages) instead of ❓, `
    + 'and keep them in search and preferences unless the CV or note says otherwise.\n'
    + `Places: ${known.places.join(', ') || 'none'}\nWork rights (no visa needed): ${known.work_rights.map(wordsOf).join(', ') || 'none'}\n`
    + `Languages that rule a job out: ${known.disqualifying_languages.join(', ') || 'none'}\n</current_settings>\n\n`;
}
// What a rebuild may change in the filters by itself: never drop a work right and never add a language that rules jobs out (both would
// hide jobs on a guess). The user still removes or adds either in the review's lists.
export function keepKnown(preferences = {}, known = null) {
  if (!known) return preferences;
  const lower = list => new Set((list || []).map(item => String(item).toLowerCase()));
  const had = lower(known.disqualifying_languages), rights = lower(preferences.work_rights);
  return {...preferences,
    work_rights: [...(preferences.work_rights || []), ...known.work_rights.filter(right => !rights.has(String(right).toLowerCase()))],
    disqualifying_languages: (preferences.disqualifying_languages || []).filter(language => had.has(String(language).toLowerCase()))};
}
// A "GitHub: ❓" line (Profile bullet or answers row) when the CV shows no GitHub: a question that doesn't apply to most trades.
export const withoutUnknownGithub = (markdown, contact = {}) => (contact?.github || typeof markdown !== 'string' ? markdown
  : markdown.split('\n').filter(line => !/^\s*(?:[-*]\s*)?\|?\s*GitHub\s*(?::|\|)\s*❓\s*\|?\s*$/i.test(line)).join('\n'));

export async function draft(storage, answers, apiKey, client = null, onProgress = null) {
  const cv = fs.readFileSync(storage.path('cv.pdf'));
  const known = knownFacts(storage);
  const example = fs.readFileSync(path.join(REPO, 'config', 'search.example.json'), 'utf8');
  const anthropic = client || anthropicApi(apiKey);
  const request = {
    model: MODEL,
    max_tokens: 16000,
    system: INSTRUCTIONS,
    messages: [{role: 'user', content: [
      {type: 'document', source: {type: 'base64', media_type: 'application/pdf', data: cv.toString('base64')}},
      {type: 'text', text: `${userNote(answers)}${knownText(known)}<templates>\n${template()}\n</templates>\n\n<example_search_settings>\n${example}\n</example_search_settings>`},
    ]}],
    output_config: {format: {type: 'json_schema', schema: DRAFT_SCHEMA}},
  };
  const typical = storage.settings().draftSections || {};
  const ask = async note => {
    const asked = note ? {...request, messages: [{...request.messages[0], content: [...request.messages[0].content, {type: 'text', text: note}]}]} : request;
    let response;
    if (onProgress && anthropic.messages.stream) {
      const stream = anthropic.messages.stream(asked);
      stream.on('text', (_, snapshot) => onProgress(progress(snapshot, typical)));
      response = await stream.finalMessage();
    } else {
      response = await anthropic.messages.create(asked);
    }
    if (response.stop_reason === 'refusal') throw new Error(`${nameOfClient(anthropic)} declined to read this CV`);
    if (response.stop_reason === 'max_tokens') throw new Error('The draft was cut off; try again');
    const text = response.content.find(block => block.type === 'text').text;
    return {response, text, result: JSON.parse(text)};
  };
  let {response, text, result} = await ask('');
  const empty = emptyParts(result);
  if (empty.length) {   // never kept as sure: asked again once, naming the parts; still empty, refused
    const first = response.usage || {};
    ({response, text, result} = await ask(askAgainNote(empty)));
    const usage = response.usage || {};   // both calls are paid for
    response = {...response, usage: {...usage, input_tokens: (usage.input_tokens || 0) + (first.input_tokens || 0), output_tokens: (usage.output_tokens || 0) + (first.output_tokens || 0)}};
    const still = emptyParts(result);
    if (still.length) throw new Error(`The draft came back without ${still.join(', ')}; try again`);
  }
  if (typeof result.profile_markdown === 'string') result.profile_markdown = withNote(withoutUnknownGithub(result.profile_markdown, result.contact), answers);
  result.answers_markdown = withoutUnknownGithub(result.answers_markdown, result.contact);
  if (result.preferences) result.preferences = keepKnown(result.preferences, known);
  if (result.search) result.search = withDerived(withRemoteDefaults(result.search));   // target_roles (titles) -> the stored list, role_keywords and the job board searches
  storage.saveSettings({draftSections: sectionLengths(text)});  // the next draft's bar follows this one's parts
  const usage = response.usage || {};
  result.usd = usage.billing === 'subscription' ? 0 : Math.round(((usage.input_tokens || 0) * priceOf(usage, PRICE).input + (usage.output_tokens || 0) * priceOf(usage, PRICE).output) / 1e4) / 100;
  return result;
}

