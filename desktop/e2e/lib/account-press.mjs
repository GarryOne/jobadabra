// What a sign-in step says when the site never saw the extension's press: the wait, the boxes, and the extension's own slow calls and press line.
// Job: run the backbone

const SLOW_OR_PRESS = /slow push|account button: pressed|account judge|account judgment|site password given/;

/**
 * -> the failure text for a press the site did not see within the step's clock.
 * Why (a8, 1 Nov 2026, runs 41262512109 and 41263356357): "never pressed" was printed for presses that came 63-70 s after the page opened; the failure now carries the extension's
 * decisions (with their times) so a late press, a slow call to the app and a press that never came read differently.
 * @param {{what: string, waitedMs: number, email: string, password: string, decisions: string}} found  `email`/`password`: 'filled' | 'not filled' | 'empty' | '?'
 */
export function missedPressNote({what, waitedMs, email, password, decisions}) {
  const lines = String(decisions || '').split('\n').filter(line => SLOW_OR_PRESS.test(line)).slice(-8).map(line => line.slice(0, 200));
  return `${what} was not pressed within ${Math.round(waitedMs / 1000)} s (email box ${email}, password box ${password}); the extension's decisions on this page: ${lines.length ? `\n  ${lines.join('\n  ')}` : 'none read'}`;
}
