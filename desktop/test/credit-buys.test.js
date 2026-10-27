// What a credit amount buys: the one function (renderer/credit-buys.js) and every surface that names an amount (owner, 27 Oct 2026).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {APPLICATION_RAW_USD, applicationsFor, buysSuffix, buysWords} from '../renderer/credit-buys.js';

const here = path.dirname(fileURLToPath(import.meta.url));

test('an amount buys a margin-reduced, 5-rounded number of applications from the measured cost', () => {
  assert.deepEqual([5, 10, 20].map(applicationsFor), [35, 70, 140]);
  assert.equal(buysWords(10), 'about 70 applications');
  assert.equal(buysSuffix(10), ' (about 70 applications)');
  assert.equal(buysWords(0.5), ''); assert.equal(buysSuffix(0.5), '', 'a small amount adds no empty parentheses');
  assert.ok(Math.abs(APPLICATION_RAW_USD - 0.0729) < 0.0005, 'the measured tokens price to $0.073 per application');
  assert.equal(buysWords(0), ''); assert.equal(buysWords(undefined), '');
  assert.ok(applicationsFor(10) * APPLICATION_RAW_USD < 10 * 0.5 * 1.16, 'never promises more than the raw cost the credit pays for');
});

test('every renderer text that names a credit amount gets it from the shared words', () => {
  const files = [];
  const walk = dir => fs.readdirSync(dir, {withFileTypes: true}).forEach(entry => (entry.isDirectory() ? walk(path.join(dir, entry.name)) : /\.js$/.test(entry.name) && files.push(path.join(dir, entry.name))));
  walk(path.join(here, '../renderer'));
  for (const file of files.filter(f => !f.endsWith('credit-buys.js'))) {
    const code = fs.readFileSync(file, 'utf8').replace(/\/\/.*$/gm, '');
    for (const line of code.split('\n').filter(l => /[€$]\$?\{[^}]*(credit|creditEur)[^}]*\}\s*(of )?(AI )?credit/i.test(l))) assert.match(line, /buysWords|buysSuffix|creditWords/, `${path.basename(file)}: a credit amount without what it buys: ${line.trim().slice(0, 90)}`);
  }
});

test('a small promo amount reads without empty parentheses', async () => {
  const {creditWords, redeemWords} = await import('../renderer/plan-view.js');
  assert.equal(creditWords({creditEur: 0.5}), '€0.5 of AI credit');
  assert.equal(redeemWords({ok: true, credit: 0.5}), '€0.5 of AI credit added.');
});
