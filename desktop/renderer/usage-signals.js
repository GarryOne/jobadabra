// Usage signals for the PostHog funnel: seconds spent on a screen (with input vs idle) and which named control was clicked, where. Numbers and fixed words only, never text. Guarded by test/usage-signals.test.js.
export const IDLE_AFTER_S = 60;   // no input for this long: the screen is open but nobody is using it
const CONTROL = /^[a-z][a-z0-9_-]{0,29}$/;
const NAME_ATTRS = ['data-command', 'data-palette', 'data-view', 'data-settings-go'];
const TYPING = 'input, textarea, select, [contenteditable=""], [contenteditable="true"]';

// The control's own name (a data attribute or id from the page's markup), never its label or content: the first ancestor (4 up) that has one in the fixed shape.
export function controlName(target) {
  if (!target?.closest || target.closest(TYPING)) return null;
  for (let el = target, depth = 0; el && depth < 5; el = el.parentElement, depth++) {
    for (const attr of NAME_ATTRS) { const value = el.getAttribute?.(attr); if (value && CONTROL.test(value)) return value; }
    if (el.id && CONTROL.test(el.id)) return el.id;
  }
  return null;
}

export function createUsage({send, now = Date.now, idleAfterS = IDLE_AFTER_S, minGapMs = 300}) {
  let view = null, active = 0, idle = 0, lastInput = now(), lastClick = -Infinity;
  const flush = () => {
    if (view && active + idle >= 1) send({kind: 'screen_time', page: view, active, idle});
    active = 0; idle = 0;
  };
  return {
    input: () => { lastInput = now(); },
    tick(present = true) { if (!present) return; if (now() - lastInput < idleAfterS * 1000) active += 1; else idle += 1; },
    viewChanged(name) { flush(); view = name; },
    flush,
    click({control, x, y, width, height}) {
      if (!view || !control || !width || !height || now() - lastClick < minGapMs) return false;
      lastClick = now();
      send({kind: 'ui_click', page: view, control, x: Math.max(0, Math.min(100, Math.round(x / width * 100))), y: Math.max(0, Math.min(100, Math.round(y / height * 100)))});
      return true;
    },
  };
}

// In the window: one second tick while it is visible and focused, input and clicks from the page, flush when the screen changes or the window hides.
export const usage = createUsage({send: payload => { try { window.pilot?.usage?.(payload)?.catch?.(() => {}); } catch { /* the bridge is not there (gallery, tests): skip */ } }});
if (typeof document !== 'undefined' && typeof window !== 'undefined') {
  for (const type of ['keydown', 'pointerdown', 'pointermove', 'wheel']) document.addEventListener(type, usage.input, {capture: true, passive: true});
  document.addEventListener('click', event => usage.click({control: controlName(event.target), x: event.clientX, y: event.clientY, width: window.innerWidth, height: window.innerHeight}), {capture: true, passive: true});
  // Why (30 Oct 2026, a8; nightly 40994891378): a stub DOM never defined hasFocus, so the first tick threw while the test was running; the interval lived for the whole process and kept it alive after tests, so tolerate missing hasFocus, unref in Node and stop on pagehide.
  const timer = setInterval(() => usage.tick(!document.hidden && typeof document.hasFocus === 'function' && document.hasFocus()), 1000);
  timer?.unref?.();
  document.addEventListener('visibilitychange', () => { if (document.hidden) usage.flush(); });
  window.addEventListener('pagehide', () => { clearInterval(timer); usage.flush(); });
}
