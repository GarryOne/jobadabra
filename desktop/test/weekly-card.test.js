// The weekly report's card reading (renderer/weekly-card.js): the headline sentence, the paragraph under it, what
// worked, what to change and the one focus — and the Telegram link line, which belongs to Telegram, dropped.
import assert from 'node:assert/strict';
import {test} from 'node:test';

import * as weekly from '../renderer/weekly-card.js';

// As Notion hands it back: tags gone, and usually the blank lines with them.
const MESSAGE = [
  '📊 Weekly report',
  'Quiet week: 2 applications, no replies yet',
  'You sent 2 applications this week and heard back on one.',
  '✅ Worked',
  '• Applying within three days of a posting matched every interview.',
  '🔧 Change next week',
  '• Send more of the 31 already-drafted kits.',
  '• Prefer SRE and Platform titles over generic software listings.',
  '🎯 Five applications in Zurich',
  'Full report in Notion',
].join('\n');

test('reads the fields the report carries', () => {
  assert.deepEqual(weekly.parseWeekly(MESSAGE), {
    headline: 'Quiet week: 2 applications, no replies yet',
    finding: '',
    summary: 'You sent 2 applications this week and heard back on one.',
    worked: ['Applying within three days of a posting matched every interview.'],
    change: ['Send more of the 31 already-drafted kits.', 'Prefer SRE and Platform titles over generic software listings.'],
    focus: 'Five applications in Zurich',
  });
});

test('the engine\'s blank lines, kept or lost, read the same', () => {
  const spaced = MESSAGE.split('\n').flatMap(line => [line, '']).join('\n');
  assert.deepEqual(weekly.parseWeekly(spaced), weekly.parseWeekly(MESSAGE));
});

test('the tagged message an older report was sent with reads the same', () => {
  const tagged = ['📊 <b>Weekly report</b>', '', '<b>Quiet week: 2 applications, no replies yet</b>',
    'You sent 2 applications this week and heard back on one.', '', '✅ <b>Worked</b>',
    '• Applying within three days of a posting matched every interview.', '', '🔧 <b>Change next week</b>',
    '• Send more of the 31 already-drafted kits.', '• Prefer SRE and Platform titles over generic software listings.', '',
    '🎯 Five applications in Zurich', '', '<a href="https://notion.so/x">Full report in Notion</a>'].join('\n');
  assert.deepEqual(weekly.parseWeekly(tagged), weekly.parseWeekly(MESSAGE));
});

test('the link line belongs to Telegram, not to the card', () => {
  const parsed = weekly.parseWeekly(MESSAGE);
  assert.ok(!JSON.stringify(parsed).includes('Full report in Notion'));
  assert.equal(parsed.focus, 'Five applications in Zurich');  // and it does not bleed into the focus
});

test('a wrapped summary is one paragraph', () => {
  const parsed = weekly.parseWeekly(['📊 Weekly report', 'A quiet week', 'First half of the sentence,',
    'and the second half.', '🔧 Change next week', '• Apply sooner.'].join('\n'));
  assert.equal(parsed.summary, 'First half of the sentence, and the second half.');
  assert.deepEqual(parsed.worked, []);  // no ✅ Worked section: nothing to draw, not an empty list
});

test('another run\'s message is not a weekly report', () => {
  for (const other of ['💡 Insight · Timing\n6 of 7 replies arrived within 0-2 days\n• Days to first reply: 0,1,2',
    '🔎 Source scout · checked 12 · 🆕 7 new sources\n1. Northwind AI · Ashby · quality 61',
    '✈️ Jobadabra · 🆕 0 new · top 10 of 24\n24 open · 5 🇨🇭',
    'Weekly report sent: 9 applications sent this week.',
    '📊 Weekly report',  // a head with nothing under it is not a card
    '']) {
    assert.equal(weekly.parseWeekly(other), null, other.slice(0, 40));
  }
});

test('a report without a focus keeps its other parts', () => {
  const parsed = weekly.parseWeekly(['📊 Weekly report', 'A quiet week', 'Two sentences.',
    '🔧 Change next week', '• Apply sooner.'].join('\n'));
  assert.equal(parsed.focus, '');
  assert.deepEqual(parsed.change, ['Apply sooner.']);
});

test('a search review (the renamed report) reads its top finding', () => {
  const review = MESSAGE.replace('📊 Weekly report', '📊 Search analysis · last 7 days')
    .replace('Quiet week: 2 applications, no replies yet', 'Quiet week: 2 applications, no replies yet\n💡 Replies came only from jobs posted under 3 days ago (4 of 4)');
  const read = weekly.parseWeekly(review);
  assert.equal(read.finding, 'Replies came only from jobs posted under 3 days ago (4 of 4)');
  assert.equal(read.headline, 'Quiet week: 2 applications, no replies yet');
  assert.equal(read.summary, 'You sent 2 applications this week and heard back on one.');
});
