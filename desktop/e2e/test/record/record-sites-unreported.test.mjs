// A run whose last fill never reported (lib/record-sites.mjs parseLive): the count of an earlier page is not the form's. HelloFresh's Electron leg, 12 Oct 2026: the posting
// page's "1 filled, 6 left" was scored for a form that showed 4 of 5 filled, because the form page's fill had not returned when the watch ended.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {parseLive, shortfall} from '../../lib/record-sites.mjs';

const at = (time, text) => `      log 2026-10-12T${time}Z [extension] ${text}`;
const POSTING_FILL = [
  at('09:41:39.045', 'fill: page kind: posting {"by":"ai","confidence":0.9,"host":"careers.hellofresh.com","ms":6553,"version":"0.9.229"}'),
  at('09:41:39.080', 'fill: pressed the Apply button {"host":"careers.hellofresh.com","label":"Apply Now","tag":"a","version":"0.9.229"}'),
  at('09:41:39.719', 'fill: after the press: a form came {"host":"careers.hellofresh.com","label":"Apply Now","version":"0.9.229"}'),
  at('09:41:39.720', 'fill: filling {"host":"careers.hellofresh.com","job":"/global/en/job/6190849","page":"/global/en/job/6190849","version":"0.9.229"}'),
];
const POSTING_REPORT = [
  at('09:41:46.295', 'fill: filled the form {"aiEligible":false,"forced":"check off","ineligible":false,"url":"https://careers.hellofresh.com/global/en/job/6190849?gh_jid=","version":"0.9.229"}'),
  at('09:41:46.295', 'fill: fields: 1 filled, 6 left {"fields":[{"label":"Enter Job Title or Location","type":"text","outcome":"left"'),
];
const FORM_FILL = [
  at('09:41:48.423', 'page kind: form {"shape":"careers.hellofresh.com/global/en/apply|f8+","by":"ai","rung":2,"confidence":0.93,"usd":0,"frames":0}'),
  at('09:41:48.453', 'fill: filling {"host":"careers.hellofresh.com","job":"/global/en/apply","page":"/global/en/apply","version":"0.9.229"}'),
  at('09:41:49.282', 'fill: first fields filled {"fields":4,"version":"0.9.229","waiting":2}'),
];
const FORM_REPORT = [
  at('09:40:23.243', 'fill: filled the form {"aiEligible":true,"forced":"","ineligible":false,"url":"https://careers.hellofresh.com/global/en/apply?jobSeqNo=HELL","version":"0.9.229"}'),
  at('09:40:23.243', 'fill: fields: 5 filled, 3 left {"fields":[{"label":"Enter Job Title or Location","type":"text","outcome":"left"'),
];
const run = lines => ['  live +  0s: Apply pressed on https://careers.hellofresh.com/global/en/job/6190849?gh_jid=6190849', ...lines].join('\n');

test('the Electron leg: the form page\'s fill never reported, so no count is scored and the run says so', () => {
  const result = parseLive(run([...POSTING_FILL, ...POSTING_REPORT, ...FORM_FILL]));
  assert.equal(result.reached, 'form');
  assert.equal(result.filled, null, 'not the posting page\'s 1');
  assert.equal(result.left, null);
  assert.equal(result.fillUnreported, '/global/en/apply');
  assert.ok(result.errors.some(line => /form fill did not report: \/global\/en\/apply/.test(line)), result.errors.join('; '));
  assert.equal(shortfall(result), null, 'no count, no "under half"');
});

test('the plain leg: the form page\'s fill started before the posting page reported, and its own report is the count', () => {
  const result = parseLive(run([...POSTING_FILL, FORM_FILL[0], FORM_FILL[1], ...POSTING_REPORT, FORM_FILL[2], ...FORM_REPORT]));
  assert.deepEqual([result.reached, result.filled, result.left, result.fillUnreported], ['form', 5, 3, undefined]);
});

test('every way a fill ends closes it: the report, an eligibility stop, a hold; one fill of the same page pending again keeps that page\'s count', () => {
  const ends = {
    report: FORM_REPORT,
    'eligibility stop': [at('09:40:23.243', 'fill: did not fill: the AI judged you ineligible {"url":"https://careers.hellofresh.com/global/en/apply?jobSeqNo=HELL","ineligible":true}')],
    hold: [at('09:40:23.243', 'fill: held: a dialog covers the form {"host":"careers.hellofresh.com","version":"0.9.229"}')],
  };
  for (const [name, end] of Object.entries(ends)) assert.equal(parseLive(run([...POSTING_FILL, ...POSTING_REPORT, ...FORM_FILL, ...end])).fillUnreported, undefined, name);
  const again = parseLive(run([...POSTING_FILL, ...POSTING_REPORT, ...FORM_FILL, ...FORM_REPORT, FORM_FILL[1]]));   // the same page filled once more (fields appeared): its count stands
  assert.deepEqual([again.filled, again.fillUnreported], [5, undefined]);
});

// HelloFresh, 11 Oct 2026: the posting page's fill never reported (the page moved on to the form), and the form's own report came after it: the form's count stands.
test('a fill left open on an earlier page, before the counted report, does not void the count', () => {
  const result = parseLive(run([...POSTING_FILL, ...FORM_FILL, ...FORM_REPORT]));
  assert.deepEqual([result.filled, result.left, result.fillUnreported], [5, 3, undefined]);
});
