// The insight card's reading of a run's message (renderer/insight-card.js): what the insight itself carries — its
// category, confidence, headline, evidence, action and the basis its numbers came from — and what it must never make
// up, namely the richer card's subtitle, numbers strip and source labels, which have no fields behind them yet.
import assert from 'node:assert/strict';
import {test} from 'node:test';

import * as card from '../renderer/insight-card.js';

// As Notion hands it back: the tags gone and, usually, the blank lines with them.
const MESSAGE = [
  '💡 Insight · Timing',
  '6 of 7 replies arrived within 0-2 days; no reply by day 3 likely means silence',
  '• Days to first reply across 6 replies: 0,1,1,1,1,2',
  '• 7 of 10 applications got a human reply, all fast',
  '👉 If no reply within 3 days of applying, treat it as a silent no.',
  'Confidence low · applications data, 10 applications',
].join('\n');

test('reads the fields the insight carries', () => {
  assert.deepEqual(card.parseInsight(MESSAGE), {
    category: 'Timing',
    headline: '6 of 7 replies arrived within 0-2 days; no reply by day 3 likely means silence',
    evidence: ['Days to first reply across 6 replies: 0,1,1,1,1,2', '7 of 10 applications got a human reply, all fast'],
    action: 'If no reply within 3 days of applying, treat it as a silent no.',
    confidence: 'low', basis: 'applications', sample: 10, sampleUnit: 'applications',
    subtitle: '', metrics: [], groups: [],
  });
});

test('the engine\'s blank lines, kept or lost, read the same', () => {
  const spaced = MESSAGE.split('\n').flatMap(line => [line, '']).join('\n');
  assert.deepEqual(card.parseInsight(spaced), card.parseInsight(MESSAGE));
});

test('the insight\'s optional parts are absent, never invented from the bullets', () => {
  // These bullets name a number and read like a labelled pair, and none of that makes them a measured figure or a
  // source: the strip and the groups stay empty until real structured data arrives.
  const parsed = card.parseInsight([
    '💡 Insight · Salary',
    'The advertised ceiling sits under your floor',
    '• Reported budget: EUR 100-150k per year',
    '• 9 of 15 disclosed salaries sit in the EUR 94-141k range',
    'Confidence low · applications data, 1 applications',
  ].join('\n'));
  assert.deepEqual(parsed.metrics, []);
  assert.deepEqual(parsed.groups, []);
  assert.equal(parsed.subtitle, '');
  assert.equal(parsed.evidence.length, 2);
});

test('optional parts are drawn exactly as given, and only when complete', () => {
  const parsed = card.parseInsight(MESSAGE, {
    subtitle: 'Huxley\'s Principal SRE opportunity may not meet your compensation expectations.',
    metrics: [{label: 'Reported budget', value: '€100–150k / year'}, {label: 'Reported scope', value: 'Hands-on senior SRE'},
      {label: 'No value'}, null],
    groups: [{title: 'Recruiter call · 30 Sep 2026', items: ['Budget reported at €100–150k per year.']}, {title: 'Empty', items: []}],
  });
  assert.equal(parsed.subtitle, 'Huxley\'s Principal SRE opportunity may not meet your compensation expectations.');
  assert.deepEqual(parsed.metrics, [{label: 'Reported budget', value: '€100–150k / year'}, {label: 'Reported scope', value: 'Hands-on senior SRE'}]);
  assert.deepEqual(parsed.groups, [{title: 'Recruiter call · 30 Sep 2026', items: ['Budget reported at €100–150k per year.']}]);
});

test('another run\'s message is not an insight', () => {
  for (const other of ['📊 Weekly report\nQuiet week: 2 applications\nYou sent 2 applications.',
    '🔎 Source scout · checked 12 · 🆕 7 new sources\n1. Northwind AI · Ashby · quality 61',
    '✈️ Jobadabra · 🆕 0 new · top 10 of 24\n24 open · 5 🇨🇭',
    'Insight sent: Salary — Huxley\'s role caps pay at EUR 100-150k/year.',
    '💡 Insight · Salary',  // a head with nothing under it is not a card
    '']) {
    assert.equal(card.parseInsight(other), null, other.slice(0, 40));
  }
});

test('older insights, whose wording varies, still read', () => {
  // A market-basis insight and one written before the footer named jobs rather than applications.
  const market = card.parseInsight('💡 <b>Insight · Skills</b>\n\n<b>Prometheus is in 3/3 of your eligible jobs</b>\n'
    + '• Prometheus: 3/3 eligible jobs (100%)\n\n👉 Add Prometheus work to the CV.\n\n'
    + '<i>Confidence medium · market data, 3 jobs</i>');
  assert.equal(market.category, 'Skills');
  assert.equal(market.headline, 'Prometheus is in 3/3 of your eligible jobs');
  assert.equal(market.basis, 'market');
  assert.equal(market.sampleUnit, 'jobs');
  assert.equal(market.confidence, 'medium');
});

test('the footer\'s wording comes from the fields, in the singular where it should be', () => {
  assert.equal(card.sampleWords(1, 'applications'), '1 application');
  assert.equal(card.sampleWords(10, 'applications'), '10 applications');
  assert.equal(card.sampleWords(1, 'jobs'), '1 job');
  assert.equal(card.sourceLine({basis: 'applications', sample: 1, sampleUnit: 'applications'}), 'Source: applications data · 1 application');
  assert.equal(card.sourceLine({basis: 'market', sample: 3, sampleUnit: 'jobs'}), 'Source: market data · 3 jobs');
  assert.equal(card.sourceLine({basis: '', sample: 0}), '');  // nothing to say: no line, not an empty one
});

test('the confidence pill wears the tone its level deserves', () => {
  assert.equal(card.confidenceTone('low'), 'warn');
  assert.equal(card.confidenceTone('medium'), 'neutral');
  assert.equal(card.confidenceTone('high'), 'good');
  assert.equal(card.confidenceTone(''), 'neutral');
  // The message spells the level in lower case; the pill reads "Low confidence", as the mockup has it.
  assert.equal(card.confidenceLabel('low'), 'Low confidence');
  assert.equal(card.confidenceLabel('HIGH'), 'High confidence');
});
