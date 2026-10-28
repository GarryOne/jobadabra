// Every prompt that writes the applicant's details into a form or a document carries the identity rule (owner, 11 Oct 2026): a `claude -p` on the
// person's plan knows their Claude account e-mail, and a form asking a name or e-mail the profile does not give got it (a different address than the
// one they apply with; in tests, the owner's). 12 Oct 2026: with no profile sent, the model typed the account holder's country and city too, so the rule names
// every detail of a person's identity and place. The rule, word for word, in each; a prompt of this kind added without it belongs in this list, and a copy of
// an older wording anywhere fails the second test. The answer step also has a code floor (worker/src/answer-facts.js floorUngrounded).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';

const RULE = 'Use only the applicant details given here; never a name, e-mail address, phone number, country, city, street address or other location from any other context (such as an account you are signed in with): when a detail is not given, leave it empty.';
const PROMPTS = {
  'worker/src/extension.js': 'form answers', 'src/ai/kit.py': 'kit answers', 'src/ai/apply_batch.py': 'Apply with Claude',
  'desktop/lib/claude-session.js': 'Claude takeover', 'desktop/lib/contact-from-cv.js': 'details from the CV',
  'desktop/lib/cover-letter.js': 'cover letter', 'desktop/lib/job-letter.js': 'job cover letter', 'desktop/lib/cv.js': 'CV import and tailoring (2 prompts)',
  'desktop/lib/strategy.js': 'strategy draft (Profile, contact details, search places)', 'desktop/lib/match-check.js': 'CV match and eligibility',
  'src/ai/apply_run.py': 'Apply with Codex',
};

test('every prompt that writes applicant details carries the identity rule, word for word', () => {
  for (const [file, what] of Object.entries(PROMPTS)) {
    const text = fs.readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8').replace(/\\'/g, "'");
    assert.ok(text.includes(RULE), `${file} (${what}) lacks the identity rule`);
  }
  assert.equal(fs.readFileSync(new URL('../../desktop/lib/cv.js', import.meta.url), 'utf8').split(RULE).length - 1, 2, 'both CV prompts');
  assert.match(fs.readFileSync(new URL('../../desktop/lib/claude-session.js', import.meta.url), 'utf8'), /return `\$\{identity\}Use the apply-to-job skill/, 'the takeover prompt sends it');
});

// Any prompt that carries the rule's opening carries all of it: an older or partial copy (one that names only name, e-mail and phone) fails here.
test('no prompt carries an older or partial wording of the identity rule', () => {
  const root = new URL('../../', import.meta.url), opening = 'Use only the applicant details given here';
  const walk = dir => fs.readdirSync(new URL(dir, root), {withFileTypes: true}).flatMap(entry => (entry.isDirectory() ? walk(`${dir}${entry.name}/`) : /\.(js|mjs|py)$/.test(entry.name) ? [`${dir}${entry.name}`] : []));
  const files = ['desktop/lib/', 'src/ai/', 'worker/src/', 'extension/'].flatMap(walk);
  for (const file of files) {
    const text = fs.readFileSync(new URL(file, root), 'utf8').replace(/\\'/g, "'");
    assert.equal(text.split(opening).length, text.split(RULE).length, `${file}: a copy of the identity rule that is not the current wording`);
  }
  for (const file of Object.keys(PROMPTS)) assert.ok(files.includes(file), `${file} is scanned`);
});
