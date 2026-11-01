import assert from 'node:assert/strict';
import {test} from 'node:test';
import {pickCv} from '../lib/server-contact.js';

const files = {'/t.pdf': Buffer.from('T'), '/g.pdf': Buffer.from('G')};
const read = path => { if (!files[path]) throw Object.assign(new Error('ENOENT'), {code: 'ENOENT'}); return files[path]; };

test('a missing tailored CV falls back to the general one, and says so', () => {
  const said = [];
  const say = (area, message, fields) => said.push([message, fields.error]);
  const cv = pickCv({tailored: {path: '/missing.pdf', name: 'CV_X_Coop.pdf'}, general: {path: '/g.pdf', name: 'CV.pdf'}, url: 'https://jobs.coop.ch/x', read, say});
  assert.equal(cv.name, 'CV.pdf');
  assert.equal(cv.tailored, false);
  assert.equal(Buffer.from(cv.data, 'base64').toString(), 'G');
  assert.deepEqual(said, [['CV: the tailored CV could not be read, using the general one', 'ENOENT']]);
});

test('the tailored CV wins when it is there; no CV at all is said, never silent', () => {
  const quiet = [];
  assert.equal(pickCv({tailored: {path: '/t.pdf', name: 'CV_X_Coop.pdf'}, general: {path: '/g.pdf', name: 'CV.pdf'}, read, say: (...a) => quiet.push(a)}).tailored, true);
  assert.equal(quiet.length, 0);
  const said = [];
  assert.equal(pickCv({tailored: null, general: {path: '/none.pdf', name: 'CV.pdf'}, read, say: (area, message) => said.push(message)}), null);
  assert.deepEqual(said, ['CV: the general CV could not be read']);
});

// Owner, 9 Oct 2026: twin test fills on employers outside the owner's list send no CV and no cover letter while "twin-no-files" is there.
test('files are withheld only in a twin, and only while its twin-no-files marker exists', async () => {
  const {withholdFiles} = await import('../lib/server-contact.js');
  const fs = await import('node:fs'), os = await import('node:os'), path = await import('node:path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-twin-files-'));
  const storage = {path: name => path.join(dir, name)};
  assert.equal(withholdFiles(storage, {JOBADABRA_TWIN: '1'}), false);   // no marker: files go as usual
  fs.writeFileSync(storage.path('twin-no-files'), '');
  assert.equal(withholdFiles(storage, {JOBADABRA_TWIN: '1'}), true);
  assert.equal(withholdFiles(storage, {}), false);                         // a real install never withholds
});
