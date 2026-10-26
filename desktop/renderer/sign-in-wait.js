// Owns: the "Cancel sign-in" state of a connect button that waits for a browser sign-in (Google, Notion): the same button cancels, never a second sign-in.
// Guarded by: test/sign-in-wait.test.js (behaviour, and every sign-in call in the renderer goes through it).

// Call once per button, BEFORE its own click listener (this one stops the click while a sign-in waits). Returns wait(start): runs start() with the
// button turned into Cancel; a press runs `cancel()` (the main process ends the wait, so start() returns and the button is as before).
export function signInWait(button, cancel) {
  let waiting = false;
  button.addEventListener('click', event => {
    if (!waiting) return;
    event.stopImmediatePropagation();
    cancel();
  });
  return async function wait(start) {
    if (waiting) return {ok: false, error: 'A sign-in is already waiting.'};
    waiting = true;
    const label = button.textContent;
    button.textContent = 'Cancel sign-in';
    button.disabled = false;
    button.setAttribute('aria-busy', 'true');   // the spinner sits inside the button (components.css), not on a line of its own
    try { return await start(); }
    finally { waiting = false; button.textContent = label; button.disabled = false; button.removeAttribute('aria-busy'); }
  };
}
