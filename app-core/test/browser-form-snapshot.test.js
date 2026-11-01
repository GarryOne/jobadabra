import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// Minimal element: enough of the DOM for tools/browser-form-snapshot.js.
function el({ tag = 'INPUT', type = 'text', id = '', label = '', value = '', checked = false, role = null,
              required = false, chosen = [], visible = true, options = [] } = {}) {
  const element = {
    tagName: tag, type, id, name: id, value, checked, required, fieldset: null,
    labels: label ? [{ textContent: label }] : [], files: [],
    selectedOptions: options.map((text) => ({ text })),
    getAttribute: (name) => (name === 'role' ? role : null),
    getClientRects: () => (visible ? [1] : []),
    closest(selector) {
      if (selector === 'fieldset') return element.fieldset;
      if (selector.includes('container') && role === 'combobox') {
        return { querySelectorAll: () => chosen.map((textContent) => ({ textContent })) };
      }
      return null;
    },
  };
  return element;
}

test('snapshot reads text, react-select, radio, checkbox group and select values', () => {
  const remoteYes = el({ type: 'radio', label: 'Yes', checked: true });
  const remoteNo = el({ type: 'radio', label: 'No' });
  const aws = el({ type: 'checkbox', label: 'AWS', checked: true });
  const gcp = el({ type: 'checkbox', label: 'GCP', checked: true });
  const fieldset = (legend, members) => ({ querySelector: () => ({ textContent: legend }),
                                           querySelectorAll: () => members.filter((e) => e.checked) });
  remoteYes.fieldset = remoteNo.fieldset = fieldset('Open to remote?', [remoteYes, remoteNo]);
  aws.fieldset = gcp.fieldset = fieldset('Clouds you used', [aws, gcp]);
  const elements = [
    el({ id: 'first_name', label: 'First Name*', value: 'Sam', required: true }),
    el({ tag: 'TEXTAREA', type: 'textarea', id: 'q1', label: 'Why us?', value: 'Because.' }),
    el({ id: 'country', label: 'Country', role: 'combobox', value: 'swi', chosen: ['Switzerland'] }),
    el({ type: 'hidden', id: 'token', value: 'secret' }),
    el({ id: 'offscreen', label: 'Hidden', value: 'x', visible: false }),
    el({ tag: 'SELECT', type: 'select-one', id: 'notice', label: 'Notice', options: ['1 month'] }),
    remoteYes, remoteNo, aws, gcp,
    el({ type: 'checkbox', id: 'consent', label: 'I agree to the privacy policy', checked: false }),
  ];
  const document = { querySelectorAll: () => elements, getElementById: () => null };
  const code = fs.readFileSync(new URL('../../tools/browser-form-snapshot.js', import.meta.url), 'utf8');
  const result = JSON.parse(vm.runInNewContext(code, {
    document, location: { href: 'https://job-boards.greenhouse.io/acme/jobs/1' },
    getComputedStyle: () => ({ visibility: 'visible' }),
  }));
  const byLabel = Object.fromEntries(result.fields.map((f) => [f.label, f]));
  assert.equal(byLabel['First Name'].value, 'Sam');
  assert.equal(byLabel['First Name'].required, true);
  assert.equal(byLabel['Why us?'].value, 'Because.');
  assert.equal(byLabel.Country.value, 'Switzerland');  // the chosen option, not the search box text
  assert.equal(byLabel.Notice.value, '1 month');
  assert.equal(byLabel['Open to remote?'].value, 'Yes');
  assert.equal(byLabel['Clouds you used'].value, 'AWS; GCP');
  assert.equal(byLabel['I agree to the privacy policy'].value, 'no');
  assert.ok(!('token' in byLabel) && !('Hidden' in byLabel));
  assert.equal(result.url, 'https://job-boards.greenhouse.io/acme/jobs/1');
});
