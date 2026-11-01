// The job list comes from the cloud run's jobs-db artifact: a repo whose last run was before the rename to Jobadabra still holds the old artifact name, and it must still be found.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import * as github from '../lib/github.js';
import {createStorage} from '../lib/storage.js';

const storageWithRepo = () => {
  const storage = createStorage(fs.mkdtempSync(path.join(os.tmpdir(), 'jp-sync-')), {encrypt: s => s, decrypt: s => s});
  storage.saveSettings({cloud: {repo: 'me/jobadabra-private'}});
  storage.setSecret('GITHUB_TOKEN', 'ghu_x');
  return storage;
};
// A fake GitHub holding artifacts by name; every artifact listing asked for is recorded.
const fakeGithub = held => {
  const asked = [];
  const fetcher = async url => {
    const target = new URL(url);
    if (target.pathname.endsWith('/actions/artifacts')) {
      const name = target.searchParams.get('name');
      asked.push(name);
      return new Response(JSON.stringify({artifacts: held[name] ? [{id: held[name], expired: false, archive_download_url: `https://api.github.test/zip/${held[name]}`}] : []}), {status: 200});
    }
    return new Response(Buffer.from('zip'), {status: 200});
  };
  return {asked, fetcher};
};

test('the job list is read from the Jobadabra artifact, else from the one an older run uploaded', async () => {
  const unzip = async () => {};
  const both = fakeGithub({'jobadabra-jobs-db': 2, 'job-pilotto-jobs-db': 1});
  assert.equal(await github.syncDatabase(storageWithRepo(), {fetcher: both.fetcher, unzip}), true);
  assert.deepEqual(both.asked, ['jobadabra-jobs-db'], 'the new name answers: the old one is not asked');
  const older = fakeGithub({'job-pilotto-jobs-db': 1});
  const storage = storageWithRepo();
  assert.equal(await github.syncDatabase(storage, {fetcher: older.fetcher, unzip}), true, 'only the old artifact exists: still found');
  assert.deepEqual(older.asked, ['jobadabra-jobs-db', 'job-pilotto-jobs-db']);
  assert.equal(storage.settings().cloud.artifactId, 1);
});
