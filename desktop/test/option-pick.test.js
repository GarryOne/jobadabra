// A menu's row proposes one of the form's own choices, picked by meaning by Claude (owner, 8 Oct 2026: "Monsieur" was typed into a
// Madam/Sir menu; "use AI to decide, not brute force or hard-coded"). Only the exact same text is taken without asking.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {pickOption} from '../lib/option-pick.js';
import {onChoices, pickProposal} from '../renderer/proposal-pick.js';

const memory = () => { const files = {}; return {readText: name => files[name] ?? null, writeText: (name, text) => { files[name] = text; }}; };
const claude = (choice, sent = []) => ({messages: {create: async request => { sent.push(request); return {stop_reason: 'end_turn', content: [{type: 'text', text: JSON.stringify({choice})}]}; }}});

test('Claude picks the choice that means the same, from the form\'s choices only, once per answer and choices', async () => {
  const storage = memory(), sent = [], logged = [];
  const ask = {label: 'Opening formula', value: 'Monsieur', options: ['Madam', 'Sir']};
  assert.deepEqual(await pickOption(storage, ask, {client: claude('Sir', sent), log: (...line) => logged.push(line)}), {choice: 'Sir', how: 'ai'});
  assert.deepEqual(sent[0].output_config.format.schema.properties.choice.enum, ['Madam', 'Sir', '']);   // a fixed answer: a choice, or none
  assert.deepEqual(JSON.parse(sent[0].messages[0].content), {question: 'Opening formula', answer: 'Monsieur', choices: ['Madam', 'Sir']});
  assert.deepEqual(await pickOption(storage, {...ask, options: ['Sir', 'Madam']}, {client: claude('Madam', sent)}), {choice: 'Sir', how: 'kept'});
  assert.equal(sent.length, 1);
  assert.ok(!JSON.stringify(logged).includes('Monsieur'));             // the log: counts, never the answer
});

test('the AI is told a placeholder choice ("No Selection", "Select...") means no answer: never picked, so never remembered (SuccessFactors Title, 15 Oct 2026)', async () => {
  const sent = [];
  const ask = {label: 'Title', value: 'Decline to self-identify', options: ['No Selection', 'Mr.', 'Ms.', 'Diverse']};
  assert.deepEqual(await pickOption(memory(), ask, {client: claude('', sent)}), {choice: '', how: 'ai'});
  assert.match(sent[0].system, /placeholder.*never return it/s, 'the instructions name the class: a choice that only says nothing is chosen yet');
  assert.deepEqual(sent[0].output_config.format.schema.properties.choice.enum, ['No Selection', 'Mr.', 'Ms.', 'Diverse', '']);
});

test('the AI is told an answer that is a value on an ordered scale (a level, a range) means the choice that holds it, in any language (fair round form 264401, 27 Oct 2026: "Level of Spanish")', async () => {
  const sent = [];
  const ask = {label: 'Level of Spanish', value: 'Native', options: ['Ninguna', 'Básico', 'Intermedio', 'Avanzado']};
  assert.deepEqual(await pickOption(memory(), ask, {client: claude('Avanzado', sent)}), {choice: 'Avanzado', how: 'ai'});
  assert.match(sent[0].system, /ordered scale.*holds it/s, 'the instructions name the class: a value on a scale, not only "means the same"');
  assert.match(sent[0].system, /not one returns ""/, 'and keep the guard: an answer that is no value on the scale picks nothing');
});

test('the same text needs no AI; a choice not on the form, or no AI, is none', async () => {
  const sent = [];
  assert.deepEqual(await pickOption(memory(), {value: 'sir', options: ['Madam', 'Sir']}, {client: claude('x', sent)}), {choice: 'Sir', how: 'same'});
  assert.equal(sent.length, 0);
  assert.deepEqual(await pickOption(memory(), {value: 'Monsieur', options: ['Madam', 'Sir']}, {client: claude('Mister')}), {choice: '', how: 'ai'});
  assert.deepEqual(await pickOption(memory(), {value: 'Monsieur', options: ['Madam', 'Sir']}, {client: null}), {choice: '', how: 'none'});
});

test('the row proposes the form\'s own choice: waiting while asked, the choice once known, "pick one" when none means the same', () => {
  const proposals = [{label: 'Opening formula', value: '', key: 'salutation', options: ['Madam', 'Sir']}];
  const proposal = pickProposal({proposals, label: 'Opening formula', contact: {salutation: 'Monsieur'}});
  assert.deepEqual(proposal.options, ['Madam', 'Sir']);
  assert.deepEqual([onChoices(proposal, undefined).value, onChoices(proposal, undefined).waiting], ['', true]);
  assert.equal(onChoices(proposal, 'Sir').value, 'Sir');
  assert.match(onChoices(proposal, '').from, /None of this form's choices means "Monsieur"/);
  assert.equal(onChoices({...proposal, value: 'sir'}, undefined).value, 'Sir');   // the same text: no question
});

test('a menu the form showed other choices for is armed again with the one that means the same, once', async () => {
  const {menuRearm} = await import('../lib/menu-rearm.js');
  const files = {}, storage = {readText: name => files[name] ?? null, writeText: (name, text) => { files[name] = text; }};
  const queued = [], sent = [];
  const listen = menuRearm({storage, client: () => claude('Monsieur', sent), queueFill: (...args) => queued.push(args)});
  const state = {id: 's1', proposals: [{label: 'Formule d\'appel', value: 'Sir', key: '', options: ['Madame', 'Monsieur']},
    {label: 'Indicatif', value: '+41', key: '', options: ['+41', '+33']}]};   // already one of the choices: left alone
  listen(state); listen(state);
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.deepEqual(queued, [['s1', 'Formule d\'appel', 'Monsieur']]);
  assert.equal(sent.length, 1);
});

test('a menu still empty after its re-arm is armed again with the remembered choice: every 10 s, at most 3 more times, no new AI call', async () => {
  // The live twin, 8 Oct 2026: "+41" asked, "Suisse" chosen and armed, then the fill (still running) armed "+41" again when it ended.
  const {menuRearm, GAP_MS, AGAIN} = await import('../lib/menu-rearm.js');
  const files = {}, storage = {readText: name => files[name] ?? null, writeText: (name, text) => { files[name] = text; }};
  const queued = [], sent = [], timers = [];
  const listen = menuRearm({storage, client: () => claude('Suisse', sent), queueFill: (...args) => queued.push(args), later: (fn, ms) => timers.push({fn, ms})});
  const state = {id: 's1', pending: ['Indicatif de pays'], proposals: [{label: 'Indicatif de pays', value: '+41', key: '', options: ['Suisse', 'France']}]};
  listen(state); listen(state);                   // the same state twice: one pick
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(queued.length, 1);
  assert.equal(timers[0].ms, GAP_MS);
  for (let i = 0; i < AGAIN + 3 && timers.length; i++) timers.shift().fn();   // the field stays empty: each check re-arms and schedules the next
  assert.equal(queued.length, 1 + AGAIN);         // bounded
  assert.ok(queued.every(([, , choice]) => choice === 'Suisse'));
  assert.equal(sent.length, 1);                   // Claude asked once
  const again = menuRearm({storage, client: () => claude('Suisse', sent), queueFill: (...args) => queued.push(args), later: (fn) => timers.push({fn})});
  const before = queued.length;
  again({...state, id: 's2'});
  await new Promise(resolve => setTimeout(resolve, 20));
  again({id: 's2', pending: [], proposals: state.proposals});   // picked meanwhile
  timers.shift().fn();
  assert.equal(queued.length, before + 1);        // no re-arm once filled
});

test('the same form reopened in a new tab gets its menu armed again (live twin, 8 Oct 2026: the reopened tab was never re-armed)', async () => {
  const {menuRearm} = await import('../lib/menu-rearm.js');
  const files = {}, storage = {readText: name => files[name] ?? null, writeText: (name, text) => { files[name] = text; }};
  const queued = [];
  const listen = menuRearm({storage, client: () => claude('Suisse'), queueFill: (...args) => queued.push(args), later: () => {}});
  const state = tab => ({id: 's1', tab, pending: ['Indicatif de pays'], proposals: [{label: 'Indicatif de pays', value: '+41', key: '', options: ['Suisse', 'France']}]});
  listen(state(101));
  await new Promise(resolve => setTimeout(resolve, 20));
  listen(state(101));                              // the same tab: handled
  listen(state(202));                              // reopened: a new tab
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(queued.length, 2);
});

// 10 Oct 2026 (spec step 5): the banner still shows the pressed button: the kept answer is forgotten and asked again.
test('a kept banner choice the page contradicted is forgotten, then asked again', async () => {
  const {pickOption, forgetOption} = await import('../lib/option-pick.js');
  const files = {}, storage = {readText: name => files[name] ?? null, writeText: (name, text) => { files[name] = text; }}, sent = [];
  const ask = {label: 'A cookie banner', value: 'Reject all cookies that are not necessary', options: ['OK', 'Cookie notice']};
  const ai = choice => ({messages: {create: async request => { sent.push(request); return {stop_reason: 'end_turn', content: [{type: 'text', text: JSON.stringify({choice})}]}; }}});
  assert.equal((await pickOption(storage, ask, {client: ai('Cookie notice')})).choice, 'Cookie notice');
  assert.equal(forgetOption(storage, ask), true);
  assert.deepEqual(await pickOption(storage, ask, {client: ai('OK')}), {choice: 'OK', how: 'ai'});
  assert.equal(sent.length, 2);
});

// Owner, 27 Oct 2026 (fair round form 102: Greenhouse's School list opens on its first 100 schools): "search, then Other".
test('a search box: the AI may name what to type, in order; never a search already typed; nothing kept; the catch-all rule only in this mode', async () => {
  const sent = [], storage = memory();
  const reply = said => ({messages: {create: async request => { sent.push(request); return {stop_reason: 'end_turn', content: [{type: 'text', text: JSON.stringify(said)}]}; }}});
  const ask = {label: 'School', value: 'Example University', options: ['Ash Valley College 1', 'Ash Valley College 2'], searchable: true, tried: ['Other']};
  const found = await pickOption(storage, ask, {client: reply({choice: '', searches: ['Example University', ' other ', 'x'.repeat(61), 'Example University']})});
  assert.deepEqual(found, {choice: '', how: 'ai', searches: ['Example University']}, 'deduplicated, at most 60 characters, never one already tried');
  assert.deepEqual(sent[0].output_config.format.schema.required, ['choice', 'searches']);
  assert.deepEqual(JSON.parse(sent[0].messages[0].content).tried, ['Other']);
  assert.match(sent[0].system, /search box[\s\S]*catch-all for answers it does not list/);
  assert.equal(storage.readText('option-picks.json'), null, 'a search box\'s pick is never kept: its list changes with each search');
  await pickOption(memory(), {label: 'Title', value: 'Mr', options: ['Mr.', 'Ms.']}, {client: reply({choice: 'Mr.'})});
  assert.doesNotMatch(sent[1].system, /catch-all/, 'an ordinary menu is not told about catch-alls or searches');
  assert.equal(sent[1].output_config.format.schema.properties.searches, undefined);
  assert.deepEqual(await pickOption(memory(), {label: 'School', value: 'Example University', options: [], searchable: true}, {client: reply({choice: '', searches: ['Other']})}),
    {choice: '', how: 'ai', searches: ['Other']}, 'a search that showed nothing still asks what to type next');
});
