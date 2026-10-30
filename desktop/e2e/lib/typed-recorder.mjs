// Observe transient text values on an attached hidden form without changing a value.
// Job: wait on state
/* global document, HTMLInputElement, HTMLTextAreaElement, MutationObserver */

// Invariant: installation never assigns a field value or dispatches an event; it delegates each observed write unchanged.
function snapshotTyped() {
  const text = item => (item instanceof HTMLInputElement || item instanceof HTMLTextAreaElement) && !['hidden', 'submit', 'button', 'checkbox', 'radio', 'file'].includes(item.type);
  if (!globalThis.__readTyped) {
    const filled = [];
    const record = (item, value = item.value) => { if (text(item) && value) filled.push((item.name || item.id) + '=' + value); };
    for (const type of [HTMLInputElement, HTMLTextAreaElement]) {
      const descriptor = Object.getOwnPropertyDescriptor(type.prototype, 'value');
      Object.defineProperty(type.prototype, 'value', {...descriptor, set(value) { descriptor.set.call(this, value); record(this); }});
    }
    for (const event of ['input', 'change']) document.addEventListener(event, event => record(event.target), true);
    new MutationObserver(changes => { for (const change of changes) { record(change.target, change.oldValue); record(change.target); } })
      .observe(document, {subtree: true, attributes: true, attributeFilter: ['value'], attributeOldValue: true});
    globalThis.__readTyped = {installed: true, filled};
  }
  for (const item of document.querySelectorAll('input,textarea')) {
    if (text(item) && item.value) globalThis.__readTyped.filled.push((item.name || item.id) + '=' + item.value);
  }
  return globalThis.__readTyped;
}

/** Install once and read retained text writes since attachment, including an installation acknowledgement; not a page-creation proof. */
export const TYPED_SNAPSHOT = `(${snapshotTyped.toString()})()`;

/** Require both positive controls before accepting the absence of retained text writes. */
export function assertReadUntyped(seen) {
  if (seen.expired) throw new Error('the form observer reached its hang cap before the read stopped: the check proved nothing');
  if (seen.samples < 1) throw new Error('the hidden form page was never seen open: the "nothing was filled" check proved nothing');
  if (seen.installed < 1) throw new Error('the typed-value recorder was never installed: the check proved nothing');
  if (seen.filled.length) throw new Error(`the read typed into the form: ${seen.filled.join(', ')}`);
}
