// The AI code review files only findings that meet its proof bar (file, line, a scenario, the failing test), each once, on the UI loop's board.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {fileReview, placed, reviewBody, reviewId, wellFormed} from '../../code-review-file.mjs';

const good = {file: 'src/telegram.py', line: 60, kind: 'crash', severity: 'medium', title: 'os.uname crashes on Windows', scenario: 'Windows: focus remind --send calls keychain_token -> AttributeError, the reminder never runs', test: 'patch sys.platform win32 and os.uname absent; keychain_token() returns None'};

test('only well-formed findings pass: a file, a line, a known kind, a scenario and a test; at most five', () => {
  assert.equal(wellFormed([good]).length, 1);
  for (const bad of [{...good, line: '60'}, {...good, kind: 'style'}, {...good, scenario: 'bad'}, {...good, test: ''}, {...good, file: ''}, null]) assert.equal(wellFormed([bad]).length, 0, JSON.stringify(bad));
  assert.equal(wellFormed(Array(9).fill(good)).length, 5);
  assert.deepEqual(wellFormed('not a list'), []);
});

test('a finding is filed once, with its labels and a body that links the line and names the failing test', () => {
  const calls = [];
  let existing = [];
  const gh = args => { calls.push(args); if (args[0] === 'issue' && args[1] === 'list') return JSON.stringify(existing); return ''; };
  const first = fileReview({findings: [good], range: 'a..b', runUrl: 'https://x/runs/1', repo: 'o/r', sha: 'abcdef1234', gh, lines: () => 200});
  assert.deepEqual(first.filed, [reviewId(good)]);
  const created = calls.find(args => args[1] === 'create' && args[0] === 'issue');
  assert.equal(created[created.indexOf('--title') + 1], '[auto-ui] src: os.uname crashes on Windows');
  assert.match(created[created.indexOf('--label') + 1], /auto-ui,fp:code-review-[0-9a-f]{10},source:code-review,kind:crash,severity:medium,view:src/);
  existing = [{number: 1, labels: [{name: `fp:${reviewId(good)}`}]}];
  assert.deepEqual(fileReview({findings: [good], range: 'a..b', runUrl: 'u', gh, lines: () => 200}).filed, [], 'never twice');
  const body = reviewBody(good, {range: 'a..b', runUrl: 'https://x/runs/1', repo: 'o/r', sha: 'abcdef1234'});
  assert.match(body, /^🟠 \*\*MEDIUM\*\* · crash · found by the AI code review/);
  assert.match(body, /\[`src\/telegram\.py:60`\]\(https:\/\/github\.com\/o\/r\/blob\/abcdef1234\/src\/telegram\.py#L60\)/);
  assert.match(body, /Build tested: main @ abcdef1 \(code review of a\.\.b\)/, 'the commit is readable by the Finder (version label, closing rules)');
  assert.match(body, /### The test that would fail\npatch sys\.platform/);
});

// #109 cited job_alerts.py:453 in a 155-line file: the link pointed nowhere.
test('the cited file must exist; a line past its end is filed without the line, marked not verified', () => {
  const lines = file => ({'src/a.py': 155}[file] || 0);
  assert.deepEqual(placed([{...good, file: 'src/a.py', line: 40}], lines).map(item => item.line), [40]);
  assert.deepEqual(placed([{...good, file: 'src/a.py', line: 453}], lines).map(item => item.line), [null]);
  assert.deepEqual(placed([{...good, file: 'src/missing.py', line: 3}], lines), [], 'a file that does not exist is not filed');
  const body = reviewBody({...good, line: null}, {range: 'a..b', runUrl: 'u', repo: 'o/r', sha: 'abcdef1234'});
  assert.match(body, /\[`src\/telegram\.py \(line not verified\)`\]\(https:\/\/github\.com\/o\/r\/blob\/abcdef1234\/src\/telegram\.py\)/);
});
