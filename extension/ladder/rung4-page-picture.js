// What the closer look takes of a page (spec: docs/superpowers/specs/2026-10-08-ai-escalation.md): the typed values are hidden BEFORE the screenshot and shown again right after, so labels and
// layout reach the model and the person's name, email and answers do not. Injected into the page (each export stands alone). Guard: app-core/test/page-picture.test.js.
// The style's id is written inside each function: an injected function carries no module scope (14 Oct 2026: a module const threw in the page, so pictures kept the values).

// Every input's, textarea's and select's text becomes transparent (and a password's dots), selected options too; nothing is changed, nothing is stored.
export function hideValues() {
  const id = 'jobadabra-hide-values';
  if (document.getElementById(id)) return true;
  const style = document.createElement('style');
  style.id = id;
  style.textContent = 'input, textarea, select, option { color: transparent !important; text-shadow: none !important; -webkit-text-fill-color: transparent !important; caret-color: transparent !important; } input::placeholder, textarea::placeholder { color: transparent !important; } #jobadabra-fill-overlay { display: none !important; } #jobadabra-review-host { visibility: hidden !important; }';
  (document.head || document.documentElement).append(style);
  return true;
}
export function showValues() {
  document.getElementById('jobadabra-hide-values')?.remove();
  return true;
}
