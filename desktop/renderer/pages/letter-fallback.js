// Settings → Profile → Cover letter: the quiet switch "Use this approved base letter when a job has no tailored letter" (owner, 18 Oct 2026:
// approving a letter and using it in every form are two choices; off by default). The app is the source: /extension/me reads
// settings.letterFallback on every fill (lib/server-contact.js, lib/cover-letter.js fallbackOn). Guarded by test/letter-fallback.test.js.
export const fallbackOn = settings => settings?.letterFallback === true;

export async function init() {
  const box = document.getElementById('letter-fallback');
  if (!box) return;
  box.checked = fallbackOn((await window.pilot.state().catch(() => null))?.settings);
  box.addEventListener('change', async () => {
    await window.pilot.saveSettings({letterFallback: box.checked});
    document.dispatchEvent(new Event('letter-updated'));
  });
}
