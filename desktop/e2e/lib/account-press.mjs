// What a sign-in step says when the site never saw the extension's press: the wait, the boxes, and the extension's own slow calls and press line.
// Job: run the backbone

const SLOW_OR_PRESS = /slow push|account button: pressed|account judge|account judgment|site password given/;

/**
 * -> how the sign-in page's two boxes read now: {email: 'filled' | 'not filled' | 'unreadable: <why>', password: 'filled' | 'empty' | 'unreadable: <why>'}.
 * A box that cannot be read says why in the failure, never a bare "?".
 */
export async function boxesOf(tab, expectedEmail) {
  const read = async (selector, say) => tab.locator(selector).inputValue().then(say, error => `unreadable: ${String(error?.message || error).split('\n')[0].slice(0, 100)}`);
  return {email: await read('#signin_email', value => (value === expectedEmail ? 'filled' : 'not filled')), password: await read('#signin_password', value => (value ? 'filled' : 'empty'))};
}

/**
 * -> the failure text for a press the site did not see within the step's clock.
 * Why (a8, 1 Nov 2026, runs 41262512109 and 41263356357): "never pressed" was printed for presses that came 63-70 s after the page opened; the failure now carries the extension's
 * decisions (with their times) so a late press, a slow call to the app and a press that never came read differently.
 * @param {{what: string, waitedMs: number, email: string, password: string, decisions: string, error?: string}} found  `error`: the last read of the press that threw, if any  `email`/`password`: 'filled' | 'not filled' | 'empty' | '?'
 */
export function missedPressNote({what, waitedMs, email, password, decisions, error = ''}) {
  const lines = String(decisions || '').split('\n').filter(line => SLOW_OR_PRESS.test(line)).slice(-8).map(line => line.slice(0, 200));
  return `${what} was not pressed within ${Math.round(waitedMs / 1000)} s (email box ${email}, password box ${password}${error ? `, last read error: ${error}` : ''}); the extension's decisions on this page: ${lines.length ? `\n  ${lines.join('\n  ')}` : 'none read'}`;
}
