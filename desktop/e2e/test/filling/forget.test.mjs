import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {forgetFixtureJobs} from '../../lib/forget.mjs';

test('it forgets the fixture boards\' postings (and their scores) and nothing else', () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'forget-'));
  fs.mkdirSync(path.join(profile, 'data'));
  const database = path.join(profile, 'data', 'jobs.sqlite');
  execFileSync('python3', ['-c', `import sqlite3,sys
db = sqlite3.connect(sys.argv[1])
db.execute("CREATE TABLE jobs (id INTEGER PRIMARY KEY, url TEXT)")
db.execute("CREATE TABLE scores (id INTEGER PRIMARY KEY, job_id INTEGER)")
db.executemany("INSERT INTO jobs (id, url) VALUES (?, ?)", [(1, "https://boards.e2e.test/job/3002"), (2, "https://boards.e2e.test/job/3001"), (3, "https://example.com/real")])
db.executemany("INSERT INTO scores (job_id) VALUES (?)", [(1,), (3,)])
db.commit()`, database]);
  assert.equal(forgetFixtureJobs(profile), 2);
  const left = JSON.parse(execFileSync('python3', ['-c', `import sqlite3,sys,json
db = sqlite3.connect(sys.argv[1])
print(json.dumps({"jobs": [r[0] for r in db.execute("SELECT id FROM jobs")], "scores": [r[0] for r in db.execute("SELECT job_id FROM scores")]}))`, database], {encoding: 'utf8'}));
  assert.deepEqual(left, {jobs: [3], scores: [3]});
  assert.equal(forgetFixtureJobs(profile), 0, 'nothing left to forget');
});

test('a profile with no job store yet has nothing to forget', () => {
  assert.equal(forgetFixtureJobs(fs.mkdtempSync(path.join(os.tmpdir(), 'forget-'))), 0);
});
