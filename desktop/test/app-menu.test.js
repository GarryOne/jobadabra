import test from 'node:test';
import assert from 'node:assert/strict';
import {CHANNEL_LABELS, answer, template} from '../lib/app-menu.js';

test('Mac: Check for Updates… right under About; standard menus kept', () => {
  const click = () => {};
  const menu = template({name: 'Jobadabra', mac: true, checkForUpdates: click});
  assert.equal(menu[0].label, 'Jobadabra');
  assert.equal(menu[0].submenu[0].role, 'about');
  assert.deepEqual(menu[0].submenu[1], {label: 'Check for Updates…', click});
  assert.ok(menu[0].submenu.some(item => item.role === 'quit'));
  for (const role of ['viewMenu', 'windowMenu']) assert.ok(menu.some(item => item.role === role), role);
  assert.ok(menu.some(item => item.label === 'Edit'));
});

test('Windows: no app menu; Check for Updates… in Help', () => {
  const menu = template({name: 'Jobadabra', mac: false, checkForUpdates: () => {}});
  assert.ok(!menu.some(item => item.label === 'Job Pilotto'));
  assert.ok(menu.at(-1).submenu.some(item => item.label === 'Check for Updates…'));
});

// Update Channel sits right under Check for Updates… on both platforms: Stable / Beta / Test builds, the current one checked.
test('Update Channel: three radio items under Check for Updates…, on Mac and Windows', () => {
  const picked = [];
  for (const mac of [true, false]) {
    const menu = template({name: 'Jobadabra', mac, checkForUpdates: () => {}, channel: 'beta', pickChannel: id => picked.push(id)});
    const list = (mac ? menu[0] : menu.at(-1)).submenu;
    const at = list.findIndex(item => item.label === 'Check for Updates…');
    const channel = list[at + 1];
    assert.equal(channel.label, 'Update Channel');
    assert.deepEqual(channel.submenu.map(item => [item.type, item.checked]), [['radio', false], ['radio', true], ['radio', false]]);
    assert.deepEqual(channel.submenu.map(item => item.label), Object.values(CHANNEL_LABELS));
    channel.submenu[2].click();
  }
  assert.deepEqual(picked, ['test', 'test']);
});

test('from source there is no Update Channel (nothing to install)', () => {
  const labels = template({name: 'Jobadabra', mac: true, checkForUpdates: () => {}})[0].submenu.map(item => item.label || '');
  assert.ok(labels.includes('Check for Updates…'));
  assert.ok(!labels.includes('Update Channel'));
});

test('the answer: up to date, an update to install, or why the check failed', () => {
  assert.equal(answer({ok: true, offer: null}, '0.5.65').message, 'You\'re up to date');
  const offer = answer({ok: true, offer: {version: '0.5.66'}}, '0.5.65');
  assert.equal(offer.install, true);
  assert.deepEqual(offer.buttons, ['Update now', 'Later']);
  assert.match(answer({ok: false, text: 'offline'}, 'x').detail, /offline/);
});

test('Help → Send Feedback… on both platforms', () => {
  const send = () => {};
  for (const mac of [true, false]) {
    const help = template({name: 'Jobadabra', mac, checkForUpdates: () => {}, sendFeedback: send}).at(-1);
    assert.deepEqual(help.submenu[0], {label: 'Send Feedback…', click: send});
  }
});

test('from source (npm start): no update is offered, the menu says to git pull', () => {
  const shown = answer({ok: true, offer: null, fromSource: true}, '0.5.0');
  assert.match(shown.message, /from source/);
  assert.ok(!shown.install);
});

test('Edit keeps copy/paste and adds Find… (⌘F), Find Next (⌘G) and Find Previous (⇧⌘G)', () => {
  const calls = [];
  const menu = template({name: 'Jobadabra', mac: true, checkForUpdates: () => {}, find: what => calls.push(what)});
  const edit = menu.find(item => item.label === 'Edit').submenu;
  for (const role of ['undo', 'redo', 'cut', 'copy', 'paste', 'selectAll']) assert.ok(edit.some(item => item.role === role), role);
  const find = label => edit.find(item => item.label === label);
  assert.deepEqual(['Find…', 'Find Next', 'Find Previous'].map(label => find(label).accelerator), ['CmdOrCtrl+F', 'CmdOrCtrl+G', 'Shift+CmdOrCtrl+G']);
  find('Find…').click(); find('Find Next').click(); find('Find Previous').click();
  assert.deepEqual(calls, ['open', 'next', 'previous']);
});
