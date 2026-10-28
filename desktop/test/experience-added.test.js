// "Added by you" in the experience bank (lib/experience-added.js; Insights PR 2): a skill, a bullet for a main-CV role or a correction the person added after an insight.
// The main CV file is never changed; tailoring (withExtras, knownText) and About you's cv part carry them; each is visible and removable.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import * as cv from '../lib/cv.js';
import * as experience from '../lib/experience.js';
import * as added from '../lib/experience-added.js';
import {aboutYou} from '../lib/about-you.js';
import {createStorage} from '../lib/storage.js';

const tempStorage = () => createStorage(fs.mkdtempSync(path.join(os.tmpdir(), 'pilot-added-')), {encrypt: v => v, decrypt: v => v});
const MAIN = {name: 'Ada Example', summary: 'SRE with AWS.', skills: 'AWS, Terraform', jobs: [
  {company: 'Acme', roles: [{title: 'SRE', period: '2024 – Present', place: 'Zurich', bullets: ['Cut costs by **50%**.'], skills: 'AWS'}]}]};
const withMain = () => { const s = tempStorage(); fs.mkdirSync(cv.dir(s), {recursive: true}); fs.writeFileSync(path.join(cv.dir(s), 'cv.json'), JSON.stringify(MAIN)); return s; };
const key = experience.mainKey(MAIN);

test('a skill joins the copy tailoring reads, once; the main CV file stays as it was', () => {
  const s = withMain(), before = fs.readFileSync(path.join(cv.dir(s), 'cv.json'), 'utf8');
  added.addSkill(s, 'Spark'); added.addSkill(s, 'spark'); added.addSkill(s, 'aws');
  const merged = experience.withExtras(s, cv.baseCv(s));
  assert.equal(merged.skills, 'AWS, Terraform, Spark', 'Spark once; AWS was already there');
  assert.equal(fs.readFileSync(path.join(cv.dir(s), 'cv.json'), 'utf8'), before, 'the main CV is never edited (owner, 28 Oct 2026)');
});

test('a bullet lands on its role flagged extra and says where it came from; a role that is not there is refused', () => {
  const s = withMain();
  added.addBullet(s, MAIN, key, {mainJob: 0, mainRole: 0, text: 'Led the Spark migration for 2 TB of logs.'});
  const role = experience.withExtras(s, cv.baseCv(s)).jobs[0].roles[0];
  assert.deepEqual(role.bullets.slice(-1), ['Led the Spark migration for 2 TB of logs.']);
  assert.deepEqual(role.extra, [1]);
  assert.equal(role.extraFrom[1], added.NAME);
  assert.throws(() => added.addBullet(s, MAIN, key, {mainJob: 3, mainRole: 0, text: 'x'}), /not in your main CV/);
});

test('a bullet written for another main CV waits (left out, not deleted), a skill always applies', () => {
  const s = withMain();
  added.addBullet(s, MAIN, 'otherkey123', {mainJob: 0, mainRole: 0, text: 'Old shape bullet.'});
  assert.equal(experience.withExtras(s, cv.baseCv(s)).jobs[0].roles[0].bullets.length, 1);
  assert.equal(added.readAdded(s).length, 1, 'still there for the person to see and remove');
});

test('a correction is known text for tailoring and part of the cv About you hands out', () => {
  const s = withMain();
  added.addCorrection(s, 'Python: 3 years');
  assert.match(experience.knownText(s, cv.baseCv(s)), /Python: 3 years/);
  assert.deepEqual(experience.withExtras(s, cv.baseCv(s)).corrections, ['Python: 3 years']);
});

test('every kind reaches the insights reader\'s cv part (not a new reader)', async () => {
  const s = withMain();
  added.addSkill(s, 'Spark'); added.addCorrection(s, 'Python: 3 years');
  added.addBullet(s, MAIN, key, {mainJob: 0, mainRole: 0, text: 'Led the Spark migration.'});
  const part = (await aboutYou(s, 'insights')).parts.cv;
  assert.match(JSON.stringify(part), /Spark/);
  assert.match(JSON.stringify(part), /Python: 3 years/);
  assert.match(JSON.stringify(part), /Led the Spark migration/);
});

test('the window\'s view lists them and removing one takes it away; unreadable file means none', () => {
  const s = withMain(), skill = added.addSkill(s, 'Spark');
  assert.deepEqual(experience.view(s).added.map(item => [item.kind, item.text]), [['skill', 'Spark']]);
  assert.equal(added.removeAdded(s, skill.id), true);
  assert.equal(added.removeAdded(s, skill.id), false);
  assert.deepEqual(experience.view(s).added, []);
  fs.writeFileSync(path.join(cv.dir(s), 'added.json'), '{not json');
  assert.deepEqual(added.readAdded(s), []);
});
