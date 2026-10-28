// Work eligibility journey (#2322), registered by journeys.test.js so the shared scenario file stays within its size limit: a form's right-to-work and
// sponsorship questions are answered from Nationality and the zones, never asked of the person. Fictional applicant.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createStorage} from '../lib/storage.js';

// Owner, 28 Oct 2026: "ask as less as possible the user and … conclude as much as possible, by ourselves".
test('scenario: a Romanian national is never asked "authorised to work in Germany?" or "sponsorship for Berlin?"; the US one stays asked', async () => {
  const {openStore} = await import('../lib/store/index.js');
  const {factsOf} = await import('../lib/base-facts.js');
  const {split} = await import('../lib/question-verdicts.js');
  const storage = createStorage(fs.mkdtempSync(path.join(os.tmpdir(), 'jp-eligibility-journey-')), {encrypt: v => v, decrypt: v => v});
  storage.saveSettings({store: 'sqlite', telemetry: false});
  await openStore(storage).page('profile').write('## 🛂 Work eligibility\n- Nationality: Romania\n- United States: ❓ yes, freely / yes, with a permit / no, needs sponsorship [per country]\n');
  const asked = {'Are you legally authorised to work in Germany?': ['work_right', 'DE'], 'Will you require visa sponsorship to work in Berlin?': ['sponsorship', 'DE'],
    'Are you authorised to work in the United States?': ['work_right', 'US']};
  const client = {messages: {create: async () => ({content: [{type: 'text', text: JSON.stringify({verdicts: Object.entries(asked).map(([label, [asks, country]]) => (
    {label, verdict: 'reusable', covered_by: '', value: '', topic: '', fact: '', asks, country}))})}]})}};
  const rows = Object.keys(asked).map(question => ({question}));
  const {shown} = await split(storage, rows, {facts: await factsOf(storage), ai: {client}});
  assert.deepEqual(shown.map(row => row.question), ['Are you authorised to work in the United States?'], 'the EU questions are answered from the zone your nationality opens');
  const kept = Object.values(storage.settings().questionVerdicts);
  assert.deepEqual(kept.filter(entry => entry.reuse === 'details').map(entry => [entry.fact, entry.proposal]).sort(), [['EU / EEA + Switzerland', 'No'], ['EU / EEA + Switzerland', 'Yes']]);
});
