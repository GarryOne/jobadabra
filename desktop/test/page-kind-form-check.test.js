// A form with a robot check among its fields is a form (lib/ladder/rung2-sketch.js FORM_CHECK_RULE; Greenhouse, 27 Oct 2026: the form's own controls held
// "Confirm you are not a robot" beside a check frame, the ask said bot_check + other, and the page waited ~45 s "handed to the person"). The rule line goes ONLY
// to pages with visible frames AND their own form controls, so every other page is asked exactly as before (its stored ladder answers stay valid).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {pageKind, pageKindCache} from '../lib/page-kind.js';
import {FORM_CHECK_RULE} from '../lib/ladder/rung2-sketch.js';

const fake = calls => ({messages: {create: async request => { calls.push(request); return {stop_reason: 'end_turn', usage: {input_tokens: 600, output_tokens: 20},
  content: [{type: 'text', text: JSON.stringify({kind: 'form', confidence: 0.95, bot_check: false})}]}; }}});
const cacheIn = () => pageKindCache(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'jp-kind-')), 'page-kinds.json'));
const form = {url: 'https://jobs.example.com/acme/jobs/1', title: 'Engineer', headings: ['Apply for this job'], buttons: ['Submit application'],
  controls: [{type: 'text', label: 'First Name', required: true}, {type: 'text', label: 'Last Name', required: true}, {type: 'email', label: 'Email', required: true},
    {type: 'file', label: 'Resume/CV', required: true}, {type: 'textarea', label: 'Confirm you are not a robot', required: false}]};
const asked = async sketch => { const calls = []; await pageKind(fake(calls), sketch, cacheIn()); return calls[0].messages[0].content; };

test('a form with its own fields and a visible frame is told that a check among its fields is not in front of the page', async () => {
  const text = await asked({...form, frames: ['www.check.example']});
  assert.ok(text.includes(FORM_CHECK_RULE));
});

test('controls: no frame, or a frame with no form of its own, is asked exactly as before', async () => {
  assert.ok(!(await asked(form)).includes(FORM_CHECK_RULE));
  assert.ok(!(await asked({...form, controls: form.controls.slice(0, 1), frames: ['www.check.example']})).includes(FORM_CHECK_RULE));
});
