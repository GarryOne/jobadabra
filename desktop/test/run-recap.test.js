// The Full-automation recap sorts a run's answers into learned / this job only from the writers' own verdicts (lib/run-recap.js).
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {recapOf} from '../lib/run-recap.js';
import {noteLearned, noteJobOnly} from '../lib/question-verdicts.js';

const memory = () => { let settings = {}; return {settings: () => settings, saveSettings: next => { settings = {...settings, ...next}; }}; };

test('learned, this job only and answered-only are told apart, per job', () => {
  const storage = memory(), url = 'https://acme.test/j/1';
  noteLearned(storage, [{label: 'Notice period', topic: 'Notice period'}], {url, company: 'Acme'});
  noteJobOnly(storage, ['Why Acme?'], {url});
  const answers = [{label: 'Notice period', value: '1 month'}, {label: 'Why Acme?', value: 'Mission'}, {label: 'Favourite colour', value: 'Blue'}, {label: 'Notice period', value: 'dup'}];
  const recap = recapOf(storage, {url, answers});
  assert.deepEqual(recap.answered.map(each => each.label), ['Notice period', 'Why Acme?', 'Favourite colour']);
  assert.deepEqual(recap.learned, [{label: 'Notice period', topic: 'Notice period'}]);
  assert.deepEqual(recap.jobOnly, [{label: 'Why Acme?'}]);
  assert.deepEqual(recapOf(storage, {url: 'https://other.test/j/2', answers}).learned, [], 'a learning taught by another job is not this run’s');
});
