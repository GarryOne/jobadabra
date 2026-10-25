// The daily health report names the engine an install runs on; Free AI is its own value so the admin counts it apart from real API keys (owner, 25 Oct 2026).
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {reportedEngine} from '../lib/ai/names.js';

const storage = (settings, key = '') => ({settings: () => settings, secret: () => key});

test('Free AI reports free, a key api, plans cli/codex, nothing none', () => {
  assert.equal(reportedEngine(storage({aiFree: true})), 'free');
  assert.equal(reportedEngine(storage({aiTrial: true})), 'free');
  assert.equal(reportedEngine(storage({aiEngine: 'api'}, 'sk-ant-x')), 'api');
  assert.equal(reportedEngine(storage({aiFree: true, aiEngine: 'cli'})), 'cli');
  assert.equal(reportedEngine(storage({aiEngine: 'openai'})), 'openai');
  assert.equal(reportedEngine(storage({aiEngine: 'codex'})), 'codex');
  assert.equal(reportedEngine(storage({})), 'none');
});
