// Free AI's reading and judging steps answer at temperature 0; its writing steps keep the model's default (owner, 26 Oct 2026: "Reading + judging steps").
// Measured 26 Oct 2026 (690 draws, sketch "Free AI score stability"): at the default 0.6, 26% of score texts invented a fact; at 0, 11%.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {STRONG_STEPS, temperatureFor} from '../lib/free-ai-models.js';
import {toWorkersAi} from '../lib/free-ai-translate.js';

const noPdf = async () => '';
const ask = {max_tokens: 100, messages: [{role: 'user', content: 'Score this job.'}]};
// Every step name the engine sends (src/ai/providers/anthropic_api.py ACTIONS) and the app's own; '' = a step that sends none.
const READING = ['enrich', 'score', 'mail', 'inbox', 'added', 'import', 'scout', 'decide', 'web_search', ''];
const WRITING = ['kit', 'prep', 'insight', 'interview', 'opportunity', 'review', 'tailor', 'cover_letter', 'job_cover_letter', 'answer', 'answer_review'];

test('every reading or judging step asks at temperature 0', async () => {
  for (const action of READING) {
    assert.equal(temperatureFor(action), 0, action);
    assert.equal((await toWorkersAi(ask, noPdf, action)).temperature, 0, action);
  }
});

test('every writing step keeps the model default (no temperature sent)', async () => {
  for (const action of WRITING) {
    assert.ok(STRONG_STEPS.has(action), `${action} is a writing step`);
    assert.equal(temperatureFor(action), undefined, action);
    assert.equal('temperature' in await toWorkersAi(ask, noPdf, action), false, action);
  }
});

test("a caller's own temperature wins", async () => {
  assert.equal((await toWorkersAi({...ask, temperature: 0.7}, noPdf, 'score')).temperature, 0.7);
  assert.equal((await toWorkersAi({...ask, temperature: 0.3}, noPdf, 'tailor')).temperature, 0.3);
});
