// "Needs your attention" proposes an answer for every way a form gets filled (owner, 8 Oct 2026: the 30 Sep rows proposed Claude's answer
// only from Claude's message; once Apply went through the extension they were bare "still empty" rows). The global rule: a new path into
// an existing screen keeps all its features, tested for each producer.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import {pickProposal} from '../renderer/proposal-pick.js';
import * as review from '../lib/review.js';
import {keysFor} from '../lib/contact-keys.js';

test('the proposed answer: what the fill proposed, else your detail, else the CV, else a box that keeps it; nothing known: no proposal', () => {
  const proposals = [{label: 'Formule d\'appel', value: 'Monsieur', key: ''}, {label: 'Numéro de téléphone', value: '', key: 'phone'}];
  assert.deepEqual(pickProposal({proposals, label: 'Formule d\'appel'}), {value: 'Monsieur', key: '', source: 'fill_tried', from: 'Proposed by the fill: the form did not take it'});
  // The AI's likely answer for you and this job (worker use: "propose"; kept through the app's review state): said to be one, to check.
  assert.equal(pickProposal({proposals: [{label: 'Disponible le week-end ?', value: 'Oui', key: '', guess: true}], label: 'Disponible le week-end ?'}).from,
    'Your most likely answer, from your profile and this job: check it');
  assert.equal(pickProposal({proposals, label: 'Numéro de téléphone', contact: {phone: '+41 79 1'}}).from, 'From your details');
  assert.deepEqual(pickProposal({proposals, label: 'Numéro de téléphone', cv: [{field: 'phone', value: '+41 79 2', sure: false}]}),
    {value: '+41 79 2', key: 'phone', source: 'cv', from: 'From your CV: check it'});
  assert.deepEqual(pickProposal({proposals, label: 'Numéro de téléphone'}), {value: '', key: 'phone', source: 'empty', from: 'Your phone: type it once, every form gets it'});
  // A label only Claude could read (lib/contact-keys.js): its key comes from there.
  assert.equal(pickProposal({label: 'Rue et numéro', key: 'street', cv: [{field: 'street', value: 'Rue du Lac 1', sure: true}]}).value, 'Rue du Lac 1');
  // A town only the Profile states (9 Oct 2026: Coop's "Localité" had an empty box): proposed from there, always to check.
  assert.deepEqual(pickProposal({label: 'Localité', key: 'location', cv: [{field: 'location', value: 'Nyon', sure: false, source: 'profile'}]}),
    {value: 'Nyon', key: 'location', source: 'profile', from: 'From your profile: check it'});
  assert.equal(pickProposal({label: 'Employment subscription'}), null);
});

test('the form\'s report keeps the proposals (cleaned) and "Use" reaches the form\'s panel as one fill command', () => {
  review._reset();
  const sessions = [{id: 's1', url: 'https://jobs.coop.ch/job/1/', company: 'Coop Suisse', status: 'done', startedAt: '2026-10-08T13:09:00Z'}];
  const page = {url: 'https://career2.successfactors.eu/careers?company=Coop#jobpilotto-fill', title: 'Coop', session: 's1', tab: 7, left: 2, total: 19,
    pending: ['Formule d\'appel', 'Rue et numéro'], proposals: [{label: 'Formule d\'appel', value: 'Monsieur'}, {label: 'Numéro de téléphone', key: 'phone'},
      {label: 'x', key: 'not-a-detail'}, {label: '', value: 'y'}]};
  review.report(sessions, page);
  assert.deepEqual(review.allStates().find(state => state.id === "s1").proposals,
    [{label: 'Formule d\'appel', value: 'Monsieur', key: '', guess: false, options: []}, {label: 'Numéro de téléphone', value: '', key: 'phone', guess: false, options: []}]);
  review.queueFill('s1', 'Rue et numéro', 'Rue du Lac 1');
  assert.deepEqual(review.report(sessions, page).commands, [{fill: {label: 'Rue et numéro', value: 'Rue du Lac 1'}}]);
  assert.deepEqual(review.report(sessions, page).commands, []);   // once
});

test('Claude reads which detail a label asks for, once per label, in any language; labels only', async () => {
  const files = {}, storage = {readText: name => files[name] ?? null, writeText: (name, text) => { files[name] = text; }};
  const sent = [], logged = [];
  const client = {messages: {create: async request => { sent.push(request); return {stop_reason: 'end_turn', content: [{type: 'text', text: JSON.stringify({items: [
    {label: 'rue et numéro', key: 'street'}, {label: 'localité', key: 'location'}, {label: 'indicatif de pays', key: 'none'}]})}]}; }}};
  const labels = ['Rue et numéro *', 'Localité', 'Indicatif de pays'];
  assert.deepEqual(await keysFor(storage, labels, {client, log: (...line) => logged.push(line)}), {'Rue et numéro *': 'street', 'Localité': 'location', 'Indicatif de pays': ''});
  assert.deepEqual(JSON.parse(sent[0].messages[0].content), ['rue et numéro', 'localité', 'indicatif de pays']);
  await keysFor(storage, labels, {client});
  assert.equal(sent.length, 1);                                         // kept
  assert.deepEqual(await keysFor(storage, ['Unknown'], {client: null}), {Unknown: ''});   // no AI: nothing guessed
  assert.match(logged[0][1], /2 of 3/);
});

test('every way the card is fed shows proposals: Claude\'s message (askRow) and the form\'s report (emptyRow)', () => {
  const needs = fs.readFileSync(new URL('../renderer/pages/session-needs.js', import.meta.url), 'utf8');
  assert.match(needs, /export function askRow[\s\S]*?input\.value = saved \|\| need\.suggested/);
  assert.match(needs, /export function emptyRow\(label, item\) \{\n  const proposal = proposalFor\(item, label\); if \(proposal\) return markKnockout\(proposedRow/);
});

test('Enter in an answer box presses its button, for every row with one (Use, Fill it in, Send)', () => {
  const sources = ['session-needs.js', 'need-proposal.js'].map(name => fs.readFileSync(new URL(`../renderer/pages/${name}`, import.meta.url), 'utf8')).join('\n');
  const buttons = [...sources.matchAll(/const (\w+) = smallButton\('(Use|Fill it in|Send)'/g)];
  assert.equal(buttons.length, 3);
  for (const [, name, text] of buttons) assert.match(sources, new RegExp(`submitOnEnter\\(input, ${name}\\)`), `${text}: Enter does nothing`);
  // The page module needs a DOM to import: the helper is run from its own source.
  const helper = sources.match(/export (function submitOnEnter[\s\S]*?\n\})/)[1];
  const submitOnEnter = new Function(`${helper}; return submitOnEnter;`)();
  const listeners = {}, input = {addEventListener: (type, run) => { listeners[type] = run; }};
  let clicks = 0; const button = {disabled: false, isConnected: true, click: () => clicks++};
  submitOnEnter(input, button);
  const press = (key, extra = {}) => listeners.keydown({key, preventDefault() {}, ...extra});
  press('Enter'); press('a'); press('Enter', {isComposing: true});
  button.disabled = true; press('Enter');
  assert.equal(clicks, 1);
});

test('a label is asked of Claude once, even when the page redraws while Claude is still answering (live twin, 8 Oct 2026: asked twice)', async () => {
  const {keyAsker} = await import('../renderer/proposal-pick.js');
  const sent = [];
  let answer;
  const asker = keyAsker(labels => { sent.push(labels); return new Promise(resolve => { answer = resolve; }); }, () => {}, 5);
  asker.request('Localité');
  await new Promise(resolve => setTimeout(resolve, 20));    // the batch went out; Claude is reading it
  asker.request('Localité'); asker.request('Localité');      // redraws meanwhile
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.deepEqual(sent, [['Localité']]);
  answer({Localité: 'location'});
  await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(asker.key('Localité'), 'location');
  asker.request('Localité');                                  // known now: never asked again
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(sent.length, 1);
});

test('the session page redraws when proposals arrive after its rows were drawn; a proposed row\'s box fills the row like its siblings', () => {
  const needs = fs.readFileSync(new URL('../renderer/pages/session-needs.js', import.meta.url), 'utf8');
  assert.match(needs, /JSON\.stringify\(before\?\.proposals \|\| \[\]\) !== JSON\.stringify\(state\.proposals \|\| \[\]\)/);   // 9 Oct 2026: 5 of 7 stayed bare "still empty"
  const css = fs.readFileSync(new URL('../renderer/style.css', import.meta.url), 'utf8');
  assert.match(css, /\.ss-need\.is-ask \.ss-ask-input \{ max-width: none/);   // "Use" ends at the right edge, where "Open in form" does
});

test('a knockout question\'s row is marked in every row kind: proposed, empty and asked (the AI\'s list or the shared pattern)', () => {
  const src = f => fs.readFileSync(new URL(f, import.meta.url), 'utf8');
  const needs = src('../renderer/pages/session-needs.js');
  assert.match(needs, /markKnockout\(proposedRow\(item, label, proposal\), item, label\)/);
  assert.match(needs, /return markKnockout\(li, item, label\)/);
  assert.match(needs, /return markKnockout\(li, item, need\.question\)/);
  const mark = src('../renderer/pages/need-knockout.js');
  assert.match(mark, /KNOCKOUT\.test\(label\) \|\| \(reviewStates\.get\(item\.id\)\?\.knockouts \|\| \[\]\)\.includes\(label\)/);   // the same test as "Before you submit"
  assert.match(src('../renderer/style.css'), /\.ss-need\.is-knockout \{[^}]*border-left: 4px solid var\(--warn\)/);
});

test('a pick made in a row\'s menu survives the redraws before Use (applyflows run 40526061842: "2 months" picked, Use read "" and said Write an answer first)', async () => {
  const {rowPicks} = await import('../renderer/proposal-pick.js');
  const picks = rowPicks(), key = 's1|Notice period';
  assert.equal(picks.start(key, ''), '');             // first draw: the proposal (none fits the menu)
  picks.note(key, '2 months');                        // the person picks
  assert.equal(picks.start(key, ''), '2 months');     // the redraw builds a new box: it starts from the pick, not the proposal
  assert.equal(picks.start(key, ''), '2 months');
  picks.forget(key);                                  // Use took it
  assert.equal(picks.start(key, 'x'), 'x');
  // The row writes every pick into that owner and starts from it (the box itself is rebuilt on each redraw).
  const row = fs.readFileSync(new URL('../renderer/pages/need-proposal.js', import.meta.url), 'utf8');
  assert.match(row, /input\.value = picks\.start\(key, /);
  assert.match(row, /addEventListener\('change', \(\) => picks\.note\(key, input\.value\)\)/);
});
